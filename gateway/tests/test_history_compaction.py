#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


def load_grobot_cli_module() -> Any:
    module_path = Path(__file__).resolve().parents[1] / "grobot_cli.py"
    spec = importlib.util.spec_from_file_location("grobot_cli", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module spec: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


grobot_cli = load_grobot_cli_module()


class HistoryCompactionTests(unittest.TestCase):
    def test_trim_history_keeps_under_limit_messages_unchanged(self) -> None:
        history = [
            {"role": "user", "content": "u1"},
            {"role": "assistant", "content": "a1"},
            {"role": "user", "content": "u2"},
            {"role": "assistant", "content": "a2"},
        ]
        trimmed = grobot_cli.trim_history_messages(history, max_turns=3)
        self.assertEqual(trimmed, history)

    def test_trim_history_compacts_with_priority_sections(self) -> None:
        history = [
            {"role": "user", "content": "Architecture decision: Use event-sourcing for writes"},
            {"role": "assistant", "content": "Modified files: gateway/grobot_cli.py and package.json"},
            {"role": "user", "content": "Verification: npm run check passed"},
            {"role": "assistant", "content": "TODO: keep rollback notes in runbook"},
            {"role": "user", "content": "Command: python3 gateway/tests/test_local_tools.py"},
            {"role": "assistant", "content": "stderr: ERROR timeout while running command"},
            {"role": "user", "content": "最近输入-1"},
            {"role": "assistant", "content": "最近回复-1"},
            {"role": "user", "content": "最近输入-2"},
            {"role": "assistant", "content": "最近回复-2"},
            {"role": "user", "content": "最近输入-3"},
        ]

        trimmed = grobot_cli.trim_history_messages(history, max_turns=3)
        self.assertEqual(len(trimmed), 6)
        compacted = trimmed[0]
        self.assertEqual(compacted.get("role"), "assistant")
        content = str(compacted.get("content"))

        self.assertIn(grobot_cli.HISTORY_COMPACT_HEADER, content)
        self.assertIn("Architecture decision: Use event-sourcing for writes", content)
        self.assertIn("Modified files: gateway/grobot_cli.py and package.json", content)
        self.assertIn("PASS: Verification: npm run check passed", content)
        self.assertIn("TODO: keep rollback notes in runbook", content)
        self.assertIn("FAIL: stderr: ERROR timeout while running command", content)
        self.assertNotIn("Command: python3 gateway/tests/test_local_tools.py", content)

        architecture_idx = content.find("[Architecture decisions]")
        modified_idx = content.find("[Modified files and key changes]")
        verification_idx = content.find("[Current verification status]")
        todo_idx = content.find("[Open TODOs and rollback notes]")
        tool_idx = content.find("[Tool outputs (pass/fail only)]")
        self.assertTrue(architecture_idx < modified_idx < verification_idx < todo_idx < tool_idx)

    def test_trim_history_reuses_existing_compact_snapshot(self) -> None:
        existing_snapshot = "\n".join(
            [
                grobot_cli.HISTORY_COMPACT_HEADER,
                "",
                "[Architecture decisions]",
                "- Architecture decision: keep provider failover deterministic",
                "",
                "[Modified files and key changes]",
                "- gateway/grobot_cli.py",
                "",
                "[Current verification status]",
                "- PASS: npm run check passed",
                "",
                "[Open TODOs and rollback notes]",
                "- TODO: add rollback note",
                "",
                "[Tool outputs (pass/fail only)]",
                "- FAIL: stderr: timeout",
            ]
        )
        history = [
            {"role": "assistant", "content": existing_snapshot},
            {"role": "user", "content": "新输入-1"},
            {"role": "assistant", "content": "新回复-1"},
            {"role": "user", "content": "新输入-2"},
            {"role": "assistant", "content": "新回复-2"},
            {"role": "user", "content": "新输入-3"},
            {"role": "assistant", "content": "新回复-3"},
        ]

        trimmed = grobot_cli.trim_history_messages(history, max_turns=3)
        compacted = str(trimmed[0].get("content"))
        self.assertEqual(compacted.count(grobot_cli.HISTORY_COMPACT_HEADER), 1)
        self.assertIn("Architecture decision: keep provider failover deterministic", compacted)
        self.assertIn("PASS: npm run check passed", compacted)

    def test_save_history_persists_structured_compact_memory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = grobot_cli.SessionStoreConfig(
                backend="file",
                redis_url=None,
                ttl_secs=1800,
                root=Path(temp_dir) / ".grobot" / "sessions",
            )
            session_key = "feishu:test:dm:workspace"
            history = [
                {"role": "user", "content": "Architecture decision: API contract fixed v2"},
                {"role": "assistant", "content": "Modified files: gateway/grobot_cli.py"},
                {"role": "user", "content": "Verification: npm run check passed"},
                {"role": "assistant", "content": "TODO: rollback to commit abc if health check fails"},
                {"role": "user", "content": "最新输入-1"},
                {"role": "assistant", "content": "最新回复-1"},
                {"role": "user", "content": "最新输入-2"},
                {"role": "assistant", "content": "最新回复-2"},
            ]

            warnings = grobot_cli.save_history_to_store(store, session_key, history, max_turns=3)
            self.assertEqual(warnings, [])

            payload = grobot_cli.read_json_file(grobot_cli.session_file_path(store, session_key))
            self.assertIsInstance(payload, dict)
            if not isinstance(payload, dict):
                return
            compact_memory = payload.get("compact_memory")
            self.assertIsInstance(compact_memory, dict)
            if not isinstance(compact_memory, dict):
                return
            sections = compact_memory.get("sections")
            self.assertIsInstance(sections, dict)
            if not isinstance(sections, dict):
                return
            architecture = sections.get("Architecture decisions")
            modified = sections.get("Modified files and key changes")
            verification = sections.get("Current verification status")
            self.assertIsInstance(architecture, list)
            self.assertIsInstance(modified, list)
            self.assertIsInstance(verification, list)
            self.assertTrue(any("API contract fixed v2" in str(item) for item in architecture or []))
            self.assertTrue(any("gateway/grobot_cli.py" in str(item) for item in modified or []))
            self.assertTrue(any("PASS:" in str(item) for item in verification or []))

    def test_retrieval_block_prioritizes_architecture_and_relevant_items(self) -> None:
        snapshot = "\n".join(
            [
                grobot_cli.HISTORY_COMPACT_HEADER,
                "",
                "[Architecture decisions]",
                "- Architecture decision: keep failover deterministic with sticky session key",
                "",
                "[Modified files and key changes]",
                "- gateway/grobot_cli.py updated trim_history_messages",
                "",
                "[Current verification status]",
                "- PASS: npm run check passed",
                "",
                "[Open TODOs and rollback notes]",
                "- TODO: keep rollback note for circuit policy",
                "",
                "[Tool outputs (pass/fail only)]",
                "- FAIL: timeout in smoke test",
            ]
        )
        history = [
            {"role": "assistant", "content": snapshot},
            {"role": "user", "content": "最近聊过 failover 和 trim 方案"},
            {"role": "assistant", "content": "确认过，继续"},
        ]
        retrieved = grobot_cli.build_retrieved_context_block(
            history,
            user_prompt="现在优化 failover 的 trim_history_messages 架构",
        )
        self.assertIsInstance(retrieved, str)
        if not isinstance(retrieved, str):
            return
        self.assertIn("[Retrieved Context]", retrieved)
        self.assertIn("ARCH:", retrieved)
        self.assertIn("FILES:", retrieved)
        self.assertIn("trim_history_messages", retrieved)

    def test_hybrid_retrieval_can_recover_low_lexical_overlap(self) -> None:
        history = [
            {"role": "user", "content": "客户支持流程v2改成状态机驱动"},
            {"role": "assistant", "content": "已记录"},
            {"role": "user", "content": "支付接口回滚策略按蓝绿发布"},
            {"role": "assistant", "content": "确认"},
        ]
        config = grobot_cli.ContextRetrievalConfig(
            enabled=True,
            candidate_limit=8,
            selected_limit=4,
            embedding=grobot_cli.RetrievalRemoteConfig(
                base_url="https://example.invalid/v1",
                api_key="test-key",
                model="embed-test",
            ),
            rerank=grobot_cli.RetrievalRemoteConfig(
                base_url="https://example.invalid/v1",
                api_key="test-key",
                model="rerank-test",
            ),
        )

        with (
            mock.patch.object(
                grobot_cli,
                "compute_embedding_similarity_scores",
                return_value={0: 0.95},
            ),
            mock.patch.object(
                grobot_cli,
                "compute_rerank_scores",
                return_value={0: 0.99},
            ),
        ):
            retrieved = grobot_cli.build_retrieved_context_block(
                history,
                user_prompt="help me optimize support chatbot workflow",
                retrieval_config=config,
            )
        self.assertIsInstance(retrieved, str)
        if not isinstance(retrieved, str):
            return
        self.assertIn("USER: 客户支持流程v2改成状态机驱动", retrieved)

    def test_resolve_context_retrieval_config_from_env(self) -> None:
        with mock.patch.dict(
            os.environ,
            {
                "GROBOT_RETRIEVAL_API_KEY": "env-key",
                "GROBOT_EMBEDDING_MODEL": "Qwen/Qwen3-Embedding-4B",
                "GROBOT_RERANK_MODEL": "Qwen/Qwen3-Reranker-8B",
                "GROBOT_RETRIEVAL_BASE_URL": "https://api.siliconflow.cn/v1",
            },
            clear=False,
        ):
            config = grobot_cli.resolve_context_retrieval_config({}, fallback_api_key=None)
        self.assertTrue(config.enabled)
        self.assertIsNotNone(config.embedding)
        self.assertIsNotNone(config.rerank)
        if config.embedding is not None and config.rerank is not None:
            self.assertEqual(config.embedding.model, "Qwen/Qwen3-Embedding-4B")
            self.assertEqual(config.rerank.model, "Qwen/Qwen3-Reranker-8B")

    def test_compute_embedding_similarity_scores_parses_indexed_vectors(self) -> None:
        remote = grobot_cli.RetrievalRemoteConfig(
            base_url="https://example.invalid/v1",
            api_key="k",
            model="m",
        )
        candidates = [
            {"id": 0, "text": "alpha"},
            {"id": 1, "text": "beta"},
        ]
        mocked_response = {
            "data": [
                {"index": 0, "embedding": [1.0, 0.0]},
                {"index": 1, "embedding": [0.9, 0.1]},
                {"index": 2, "embedding": [0.1, 0.9]},
            ]
        }
        with mock.patch.object(grobot_cli, "http_json_or_raise", return_value=mocked_response):
            scores = grobot_cli.compute_embedding_similarity_scores("query", candidates, remote)
        self.assertIn(0, scores)
        self.assertIn(1, scores)
        self.assertGreater(scores[0], scores[1])

    def test_compute_rerank_scores_supports_results_or_data(self) -> None:
        remote = grobot_cli.RetrievalRemoteConfig(
            base_url="https://example.invalid/v1",
            api_key="k",
            model="m",
        )
        candidates = [
            {"id": 0, "text": "alpha"},
            {"id": 1, "text": "beta"},
            {"id": 2, "text": "gamma"},
        ]
        mocked_response = {
            "results": [
                {"index": 2, "relevance_score": 0.9},
                {"index": 0, "relevance_score": 0.6},
                {"index": 1, "relevance_score": 0.3},
            ]
        }
        with mock.patch.object(grobot_cli, "http_json_or_raise", return_value=mocked_response):
            scores = grobot_cli.compute_rerank_scores("query", candidates, remote)
        self.assertIn(0, scores)
        self.assertIn(1, scores)
        self.assertIn(2, scores)
        self.assertGreater(scores[2], scores[0])
        self.assertGreater(scores[0], scores[1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
