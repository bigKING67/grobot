#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


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


class SessionLifecycleTests(unittest.TestCase):
    def test_build_session_key_uses_identity_not_work_dir(self) -> None:
        identity = grobot_cli.IdentityContext(scope="dm", subject="open_id_123")
        key_one = grobot_cli.build_session_key(
            "my-project",
            "feishu",
            Path("/tmp/workspace-a"),
            identity=identity,
        )
        key_two = grobot_cli.build_session_key(
            "my-project",
            "feishu",
            Path("/tmp/workspace-b"),
            identity=identity,
        )
        self.assertEqual(key_one, "feishu:my-project:dm:open_id_123")
        self.assertEqual(key_two, "feishu:my-project:dm:open_id_123")

    def test_session_registry_supports_main_and_new_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".grobot" / "sessions"
            store = grobot_cli.SessionStoreConfig(
                backend="file",
                redis_url=None,
                ttl_secs=1800,
                root=root,
            )
            namespace_key = "feishu:grobot:dm:open_abc"
            registry, warnings = grobot_cli.load_session_registry(store, namespace_key)
            self.assertEqual(warnings, [])
            self.assertEqual(registry["active_id"], grobot_cli.SESSION_REGISTRY_MAIN_ID)

            main_record = grobot_cli.find_session_record(registry, grobot_cli.SESSION_REGISTRY_MAIN_ID)
            self.assertIsNotNone(main_record)
            if isinstance(main_record, dict):
                self.assertEqual(main_record["session_key"], namespace_key)

            new_record = grobot_cli.create_session_record(namespace_key)
            grobot_cli.append_session_record(registry, new_record)
            registry["active_id"] = new_record["id"]
            save_warnings = grobot_cli.save_session_registry(store, namespace_key, registry)
            self.assertEqual(save_warnings, [])

            restored, restored_warnings = grobot_cli.load_session_registry(store, namespace_key)
            self.assertEqual(restored_warnings, [])
            self.assertEqual(restored["active_id"], new_record["id"])
            records = restored.get("sessions")
            self.assertIsInstance(records, list)
            if isinstance(records, list):
                self.assertGreaterEqual(len(records), 2)

    def test_continue_bridge_message_is_summary_only(self) -> None:
        source_history = [
            {"role": "user", "content": "Architecture decision: keep deterministic failover ordering."},
            {"role": "assistant", "content": "已记录架构决策并完成第一轮测试。"},
            {"role": "user", "content": "Modified files: gateway/grobot_cli.py, gateway/tests/test_session_lifecycle.py"},
            {"role": "assistant", "content": "PASS: session commands verified locally."},
            {"role": "user", "content": "TODO: add edge-case tests for switch and continue."},
            {"role": "assistant", "content": "收到，稍后补齐。"},
        ]
        bridge = grobot_cli.build_continue_bridge_message(
            source_session_id="s20260411abcd",
            source_session_key="feishu:grobot:dm:open_abc__s_s20260411abcd",
            source_history_messages=source_history,
            max_turns=2,
        )
        self.assertIsInstance(bridge, dict)
        if isinstance(bridge, dict):
            content = bridge.get("content")
            self.assertIsInstance(content, str)
            if isinstance(content, str):
                self.assertIn("[Session Continue Bridge]", content)
                self.assertIn("summary-only", content)
                self.assertIn("Architecture decisions", content)

    def test_build_wiki_context_block_respects_org_flag(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text("schema_version = 1\nmode = \"mvp\"\n", encoding="utf-8")

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)

            (paths.project_wiki_dir / "project-note.md").write_text(
                "接口契约：支付状态统一为 paid/unpaid。",
                encoding="utf-8",
            )
            (paths.global_wiki_dir / "org" / "demo").mkdir(parents=True, exist_ok=True)
            (paths.global_wiki_dir / "org" / "demo" / "org-note.md").write_text(
                "组织标准：所有回滚都要附应急联系人。",
                encoding="utf-8",
            )

            prompt = "接口契约 支付状态"
            block_project_only = grobot_cli.build_wiki_context_block(
                prompt,
                paths=paths,
                session_key="local:demo:dm:tester",
                allow_org_shared=False,
            )
            self.assertIsInstance(block_project_only, str)
            if isinstance(block_project_only, str):
                self.assertIn("project-note.md", block_project_only)
                self.assertNotIn("org-note.md", block_project_only)

            block_with_org = grobot_cli.build_wiki_context_block(
                "所有回滚都要附应急联系人",
                paths=paths,
                session_key="local:demo:group:team-chat",
                allow_org_shared=True,
            )
            self.assertIsInstance(block_with_org, str)
            if isinstance(block_with_org, str):
                self.assertIn("org-note.md", block_with_org)

    def test_parser_accepts_session_identity_flags(self) -> None:
        parser = grobot_cli.build_parser()
        parsed = parser.parse_args(
            [
                "start",
                "--project",
                "demo",
                "--session-scope",
                "group",
                "--session-subject",
                "chat_open_id_1",
            ]
        )
        self.assertEqual(parsed.session_scope, "group")
        self.assertEqual(parsed.session_subject, "chat_open_id_1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
