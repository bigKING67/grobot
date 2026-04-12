#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    from gateway.tests.ts_contract import run_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract

HISTORY_COMPACT_HEADER = "[Compact Context Snapshot v1]"


def run_history_contract(
    command: str,
    payload: dict[str, object],
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return run_node_contract(
        "history-compaction-contract.mjs",
        command,
        ("--payload", json.dumps(payload, ensure_ascii=False)),
        env=env,
    )


class HistoryCompactionTests(unittest.TestCase):
    def test_trim_history_keeps_under_limit_messages_unchanged(self) -> None:
        history = [
            {"role": "user", "content": "u1"},
            {"role": "assistant", "content": "a1"},
            {"role": "user", "content": "u2"},
            {"role": "assistant", "content": "a2"},
        ]
        result = run_history_contract("trim", {"history": history, "max_turns": 3})
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        trimmed = payload["trimmed"]
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
        result = run_history_contract("trim", {"history": history, "max_turns": 3})
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        trimmed = payload["trimmed"]
        self.assertEqual(len(trimmed), 6)
        compacted = trimmed[0]
        self.assertEqual(compacted.get("role"), "assistant")
        content = str(compacted.get("content"))

        self.assertIn(HISTORY_COMPACT_HEADER, content)
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
                HISTORY_COMPACT_HEADER,
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
        result = run_history_contract("trim", {"history": history, "max_turns": 3})
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        compacted = str(payload["trimmed"][0]["content"])
        self.assertEqual(compacted.count(HISTORY_COMPACT_HEADER), 1)
        self.assertIn("Architecture decision: keep provider failover deterministic", compacted)
        self.assertIn("PASS: npm run check passed", compacted)

    def test_save_history_persists_structured_compact_memory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
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
            result = run_history_contract(
                "save-history",
                {
                    "root": str(Path(temp_dir) / ".grobot" / "sessions"),
                    "session_key": "feishu:test:dm:workspace",
                    "history": history,
                    "max_turns": 3,
                },
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            body = json.loads(result.stdout)
            self.assertEqual(body["warnings"], [])
            payload = body["payload"]
            compact_memory = payload["compact_memory"]
            sections = compact_memory["sections"]
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
                HISTORY_COMPACT_HEADER,
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
        result = run_history_contract(
            "retrieved-block",
            {
                "history": history,
                "user_prompt": "现在优化 failover 的 trim_history_messages 架构",
                "retrieval_config": None,
            },
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        retrieved = json.loads(result.stdout)["block"]
        self.assertIsInstance(retrieved, str)
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
        config = {
            "enabled": True,
            "candidate_limit": 8,
            "selected_limit": 4,
            "embedding": {
                "base_url": "https://example.invalid/v1",
                "api_key": "test-key",
                "model": "embed-test",
            },
            "rerank": {
                "base_url": "https://example.invalid/v1",
                "api_key": "test-key",
                "model": "rerank-test",
            },
        }
        result = run_history_contract(
            "retrieved-block",
            {
                "history": history,
                "user_prompt": "help me optimize support chatbot workflow",
                "retrieval_config": config,
            },
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        retrieved = json.loads(result.stdout)["block"]
        self.assertIsInstance(retrieved, str)
        self.assertIn("USER: 客户支持流程v2改成状态机驱动", retrieved)

    def test_resolve_context_retrieval_config_from_env(self) -> None:
        result = run_history_contract(
            "resolve-config",
            {
                "project_toml": {},
                "global_toml": {},
                "fallback_api_key": None,
            },
            env={
                "GROBOT_RETRIEVAL_API_KEY": "env-key",
                "GROBOT_EMBEDDING_MODEL": "Qwen/Qwen3-Embedding-4B",
                "GROBOT_RERANK_MODEL": "Qwen/Qwen3-Reranker-8B",
                "GROBOT_RETRIEVAL_BASE_URL": "https://api.siliconflow.cn/v1",
            },
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        config = json.loads(result.stdout)
        self.assertTrue(config["enabled"])
        self.assertIsNotNone(config["embedding"])
        self.assertIsNotNone(config["rerank"])
        if config["embedding"] is not None and config["rerank"] is not None:
            self.assertEqual(config["embedding"]["model"], "Qwen/Qwen3-Embedding-4B")
            self.assertEqual(config["rerank"]["model"], "Qwen/Qwen3-Reranker-8B")
        self.assertEqual(config["source"], "env")
        self.assertEqual(config["embedding_source"], "env")
        self.assertEqual(config["rerank_source"], "env")

    def test_resolve_context_retrieval_config_from_global_config(self) -> None:
        global_toml = {
            "retrieval": {
                "enabled": True,
                "selected_limit": 6,
                "candidate_limit": 12,
                "base_url": "https://global.example/v1",
                "api_key": "global-shared-key",
                "embedding": {
                    "model": "embed-global",
                },
                "rerank": {
                    "model": "rerank-global",
                },
            }
        }
        result = run_history_contract(
            "resolve-config",
            {"project_toml": {}, "global_toml": global_toml, "fallback_api_key": None},
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        config = json.loads(result.stdout)
        self.assertTrue(config["enabled"])
        self.assertEqual(config["source"], "global")
        self.assertEqual(config["selected_limit"], 6)
        self.assertEqual(config["selected_limit_source"], "global")
        self.assertEqual(config["candidate_limit"], 12)
        self.assertEqual(config["candidate_limit_source"], "global")
        self.assertEqual(config["shared_base_url"], "https://global.example/v1")
        self.assertEqual(config["shared_base_url_source"], "global")
        self.assertEqual(config["shared_api_key_source"], "global")
        self.assertIsNotNone(config["embedding"])
        self.assertIsNotNone(config["rerank"])
        if config["embedding"] is not None and config["rerank"] is not None:
            self.assertEqual(config["embedding"]["model"], "embed-global")
            self.assertEqual(config["rerank"]["model"], "rerank-global")
        self.assertEqual(config["embedding_source"], "global")
        self.assertEqual(config["rerank_source"], "global")

    def test_resolve_context_retrieval_config_project_overrides_global(self) -> None:
        project_toml = {
            "context_retrieval": {
                "selected_limit": 5,
                "embedding": {
                    "model": "embed-project",
                },
            }
        }
        global_toml = {
            "retrieval": {
                "selected_limit": 3,
                "candidate_limit": 10,
                "api_key": "global-shared-key",
                "base_url": "https://global.example/v1",
                "embedding": {
                    "model": "embed-global",
                },
                "rerank": {
                    "model": "rerank-global",
                },
            }
        }
        result = run_history_contract(
            "resolve-config",
            {"project_toml": project_toml, "global_toml": global_toml, "fallback_api_key": None},
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        config = json.loads(result.stdout)
        self.assertTrue(config["enabled"])
        self.assertEqual(config["source"], "project")
        self.assertEqual(config["selected_limit"], 5)
        self.assertEqual(config["selected_limit_source"], "project")
        self.assertEqual(config["candidate_limit"], 10)
        self.assertEqual(config["candidate_limit_source"], "global")
        self.assertIsNotNone(config["embedding"])
        self.assertIsNotNone(config["rerank"])
        if config["embedding"] is not None and config["rerank"] is not None:
            self.assertEqual(config["embedding"]["model"], "embed-project")
            self.assertEqual(config["rerank"]["model"], "rerank-global")
        self.assertEqual(config["embedding_source"], "project")
        self.assertEqual(config["rerank_source"], "global")

    def test_resolve_context_retrieval_config_disabled_sets_remote_reason(self) -> None:
        result = run_history_contract(
            "resolve-config",
            {
                "project_toml": {"context_retrieval": {"enabled": False}},
                "global_toml": {},
                "fallback_api_key": "provider-key",
            },
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        config = json.loads(result.stdout)
        self.assertFalse(config["enabled"])
        self.assertIsNone(config["embedding"])
        self.assertIsNone(config["rerank"])
        self.assertEqual(config["embedding_disabled_reason"], "context_retrieval_disabled")
        self.assertEqual(config["rerank_disabled_reason"], "context_retrieval_disabled")

    def test_compute_embedding_similarity_scores_parses_indexed_vectors(self) -> None:
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
        result = run_history_contract(
            "embedding-scores",
            {"candidates": candidates, "response": mocked_response},
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        scores = json.loads(result.stdout)["scores"]
        self.assertIn("0", scores)
        self.assertIn("1", scores)
        self.assertGreater(scores["0"], scores["1"])

    def test_compute_rerank_scores_supports_results_or_data(self) -> None:
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
        result = run_history_contract(
            "rerank-scores",
            {"candidates": candidates, "response": mocked_response},
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        scores = json.loads(result.stdout)["scores"]
        self.assertIn("0", scores)
        self.assertIn("1", scores)
        self.assertIn("2", scores)
        self.assertGreater(scores["2"], scores["0"])
        self.assertGreater(scores["0"], scores["1"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
