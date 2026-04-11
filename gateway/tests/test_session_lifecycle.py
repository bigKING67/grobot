#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


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
    @staticmethod
    def _pick_free_tcp_port() -> int:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", 0))
            _, port = sock.getsockname()
            return int(port)
        finally:
            sock.close()

    @staticmethod
    def _http_json(
        url: str,
        *,
        method: str = "GET",
        token: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        data_bytes: bytes | None = None
        headers: dict[str, str] = {}
        if payload is not None:
            data_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if isinstance(token, str) and token.strip():
            headers["Authorization"] = f"Bearer {token.strip()}"

        req = Request(url=url, data=data_bytes, headers=headers, method=method)
        try:
            with urlopen(req, timeout=3) as resp:
                status = int(getattr(resp, "status", 200))
                body = resp.read().decode("utf-8")
                parsed = json.loads(body) if body.strip() else {}
                if not isinstance(parsed, dict):
                    raise RuntimeError("response JSON must be object")
                return status, parsed
        except HTTPError as exc:
            raw = exc.read().decode("utf-8")
            parsed = json.loads(raw) if raw.strip() else {}
            if not isinstance(parsed, dict):
                parsed = {}
            return int(exc.code), parsed

    @staticmethod
    def _wait_healthz(base_url: str, *, timeout_secs: float = 6.0) -> bool:
        deadline = time.time() + timeout_secs
        while time.time() < deadline:
            try:
                status, payload = SessionLifecycleTests._http_json(f"{base_url}/healthz")
                if status == 200 and payload.get("status") == "ok":
                    return True
            except Exception:
                pass
            time.sleep(0.05)
        return False

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

    def test_parser_accepts_memory_subcommand(self) -> None:
        parser = grobot_cli.build_parser()
        parsed = parser.parse_args(
            [
                "memory",
                "--project",
                "demo",
                "--session-scope",
                "group",
                "--session-subject",
                "chat_open_id_1",
                "write",
                "--text",
                "接口契约优先于风格偏好",
                "--kind",
                "policy",
                "--scope",
                "group",
            ]
        )
        self.assertEqual(parsed.command, "memory")
        self.assertEqual(parsed.memory_command, "write")
        self.assertEqual(parsed.kind, "policy")
        self.assertEqual(parsed.scope, "group")
        self.assertEqual(parsed.session_scope, "group")
        self.assertEqual(parsed.session_subject, "chat_open_id_1")

        parsed_query = parser.parse_args(
            [
                "memory",
                "--project",
                "demo",
                "query",
                "--query",
                "补偿审批",
                "--include-restricted",
            ]
        )
        self.assertEqual(parsed_query.memory_command, "query")
        self.assertTrue(parsed_query.include_restricted)
        self.assertFalse(parsed_query.include_secret)

        parsed_lifecycle = parser.parse_args(
            [
                "memory",
                "--project",
                "demo",
                "lifecycle",
                "--scope",
                "group",
                "--dry-run",
            ]
        )
        self.assertEqual(parsed_lifecycle.memory_command, "lifecycle")
        self.assertEqual(parsed_lifecycle.scope, "group")
        self.assertTrue(parsed_lifecycle.dry_run)

    def test_interactive_memory_write_and_review(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[memory]",
                        "allow_org_shared_read = false",
                        "",
                        "[memory.v1]",
                        "enabled = true",
                        'default_scope = "auto"',
                        'write_mode = "review_first"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)
            memory_config = grobot_cli.resolve_memory_v1_config(grobot_cli.load_toml(paths.project_toml))
            session_key = "feishu:demo:group:chat_001"

            write_code, write_lines = grobot_cli.run_interactive_memory_command(
                user_input='/memory write --kind policy --scope auto --tags "api,contract" 接口契约优先于风格偏好',
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
            )
            self.assertEqual(write_code, 0)
            proposal_line = next(
                (line for line in write_lines if line.startswith("memory write proposal created:")),
                "",
            )
            self.assertTrue(proposal_line)
            proposal_id = proposal_line.split(":", 1)[1].strip()
            self.assertTrue(proposal_id.startswith("mp"))

            review_code, review_lines = grobot_cli.run_interactive_memory_command(
                user_input=f"/memory review apply {proposal_id} looks-good",
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
            )
            self.assertEqual(review_code, 0)
            self.assertTrue(any("memory review applied" in line for line in review_lines))

            query_code, query_lines = grobot_cli.run_interactive_memory_command(
                user_input="/memory query 接口契约 优先",
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
            )
            self.assertEqual(query_code, 0)
            self.assertTrue(any("memory query: top=" in line for line in query_lines))

            lifecycle_code, lifecycle_lines = grobot_cli.run_interactive_memory_command(
                user_input="/memory lifecycle --dry-run",
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
            )
            self.assertEqual(lifecycle_code, 0)
            self.assertTrue(any("memory lifecycle: dry_run=on" in line for line in lifecycle_lines))

    def test_management_api_memory_endpoints_auth_acl_and_flow(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with (
            tempfile.TemporaryDirectory() as temp_home,
            tempfile.TemporaryDirectory() as temp_project,
            tempfile.TemporaryDirectory() as temp_cfg_dir,
        ):
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[memory.v1]",
                        "enabled = true",
                        'default_scope = "auto"',
                        'write_mode = "direct"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            cfg_path = Path(temp_cfg_dir) / "config.toml"
            token_read = "memory-read-token"
            token_write = "memory-write-token"
            session_id = "feishu:grobot:dm:open_memory_1"
            registry_namespace = "feishu:grobot:dm:ops_namespace"
            registry_store = grobot_cli.SessionStoreConfig(
                backend="file",
                redis_url=None,
                ttl_secs=1800,
                root=Path(temp_home) / "runtime" / "sessions",
            )
            registry_payload = grobot_cli.normalize_session_registry_payload(
                {
                    "namespace_key": registry_namespace,
                    "active_id": grobot_cli.SESSION_REGISTRY_MAIN_ID,
                    "sessions": [
                        {
                            "id": grobot_cli.SESSION_REGISTRY_MAIN_ID,
                            "session_key": session_id,
                        }
                    ],
                },
                registry_namespace,
            )
            save_warnings = grobot_cli.save_session_registry(
                registry_store,
                registry_namespace,
                registry_payload,
            )
            self.assertEqual(save_warnings, [])
            cfg_path.write_text(
                "\n".join(
                    [
                        'language = "zh"',
                        "",
                        "[[projects]]",
                        'name = "grobot"',
                        "",
                        "[projects.agent]",
                        'type = "claudecode"',
                        'provider = "mock"',
                        "",
                        "[projects.agent.options]",
                        f'work_dir = "{project_root}"',
                        'mode = "default"',
                        "",
                        "[[projects.agent.providers]]",
                        'name = "mock"',
                        'api_key = "mock-key"',
                        'base_url = "http://127.0.0.1:9/v1"',
                        'model = "mock-model"',
                        "",
                        "[[projects.platforms]]",
                        'type = "feishu"',
                        "",
                        "[projects.platforms.options]",
                        'app_id = "x"',
                        'app_secret = "y"',
                        "",
                        "[management]",
                        "enabled = true",
                        "",
                        "[[management.tokens]]",
                        'name = "memory-read"',
                        f'token = "{token_read}"',
                        'actions = ["memory_read"]',
                        'interrupt_session_prefixes = ["feishu:grobot:dm:"]',
                        "",
                        "[[management.tokens]]",
                        'name = "memory-write"',
                        f'token = "{token_write}"',
                        'actions = ["memory_import", "memory_forget", "memory_lifecycle"]',
                        'interrupt_session_prefixes = ["feishu:grobot:dm:"]',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            port = self._pick_free_tcp_port()
            bind = f"127.0.0.1:{port}"
            process = subprocess.Popen(
                [
                    "./grobot",
                    "serve",
                    "--project",
                    "grobot",
                    "--work-dir",
                    str(project_root),
                    "--project-root",
                    str(project_root),
                    "--home",
                    temp_home,
                    "--config",
                    str(cfg_path),
                    "--bind",
                    bind,
                ],
                cwd=str(repo_root),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            base_url = f"http://{bind}"
            try:
                ready = self._wait_healthz(base_url)
                self.assertTrue(ready, msg="management API did not become ready in time")
                if not ready:
                    return

                encoded_session = quote(session_id, safe="")
                list_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory?limit=20"
                list_page_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory?limit=1"

                status_unauth, body_unauth = self._http_json(list_url, method="GET", token=None)
                self.assertEqual(status_unauth, 401)
                self.assertEqual(body_unauth.get("error"), "management_auth_required")

                denied_session_id = "telegram:grobot:dm:open_denied"
                denied_url = f"{base_url}/api/v1/sessions/{quote(denied_session_id, safe='')}/memory"
                status_denied, body_denied = self._http_json(denied_url, method="GET", token=token_read)
                self.assertEqual(status_denied, 403)
                self.assertEqual(body_denied.get("error"), "management_acl_denied")

                status_invalid_scope, body_invalid_scope = self._http_json(
                    f"{list_url}&scope=invalid_scope",
                    method="GET",
                    token=token_read,
                )
                self.assertEqual(status_invalid_scope, 400)
                self.assertEqual(body_invalid_scope.get("error"), "invalid_scope")

                status_invalid_kind, body_invalid_kind = self._http_json(
                    f"{list_url}&kind=not_a_kind",
                    method="GET",
                    token=token_read,
                )
                self.assertEqual(status_invalid_kind, 400)
                self.assertEqual(body_invalid_kind.get("error"), "invalid_kind")

                import_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory/import"
                status_import_denied, body_import_denied = self._http_json(
                    import_url,
                    method="POST",
                    token=token_read,
                    payload={"scope": "auto", "records": [{"text": "should-deny"}]},
                )
                self.assertEqual(status_import_denied, 403)
                self.assertEqual(body_import_denied.get("error"), "management_acl_denied")

                status_import, body_import = self._http_json(
                    import_url,
                    method="POST",
                    token=token_write,
                    payload={
                        "scope": "auto",
                        "records": [
                            {
                                "text": "退款 SLA 为 24 小时",
                                "kind": "semantic",
                                "classification": "internal",
                                "importance": 0.9,
                                "confidence": 0.8,
                                "tags": ["sla", "refund"],
                            },
                            {
                                "text": "退款升级路径：先客服，再值班负责人",
                                "kind": "policy",
                                "classification": "internal",
                                "importance": 0.7,
                                "confidence": 0.9,
                                "tags": ["refund", "escalation"],
                            }
                        ],
                    },
                )
                self.assertEqual(status_import, 200)
                self.assertEqual(body_import.get("imported_count"), 2)

                status_list_denied, body_list_denied = self._http_json(
                    list_page_url,
                    method="GET",
                    token=token_write,
                )
                self.assertEqual(status_list_denied, 403)
                self.assertEqual(body_list_denied.get("error"), "management_acl_denied")

                status_list_page_1, body_list_page_1 = self._http_json(list_page_url, method="GET", token=token_read)
                self.assertEqual(status_list_page_1, 200)
                page_1_records = body_list_page_1.get("records")
                self.assertIsInstance(page_1_records, list)
                self.assertEqual(body_list_page_1.get("count"), 1)
                self.assertTrue(body_list_page_1.get("has_more"))
                page_1_next_cursor = body_list_page_1.get("next_cursor")
                self.assertIsInstance(page_1_next_cursor, str)
                page_1_first_id = ""
                if isinstance(page_1_records, list) and page_1_records:
                    first_row = page_1_records[0]
                    if isinstance(first_row, dict):
                        page_1_first_id = str(first_row.get("id") or "")
                self.assertTrue(page_1_first_id)

                status_list_page_2, body_list_page_2 = self._http_json(
                    f"{list_page_url}&cursor={page_1_next_cursor}",
                    method="GET",
                    token=token_read,
                )
                self.assertEqual(status_list_page_2, 200)
                self.assertEqual(body_list_page_2.get("count"), 1)
                page_2_records = body_list_page_2.get("records")
                self.assertIsInstance(page_2_records, list)
                page_2_first_id = ""
                if isinstance(page_2_records, list) and page_2_records:
                    second_row = page_2_records[0]
                    if isinstance(second_row, dict):
                        page_2_first_id = str(second_row.get("id") or "")
                self.assertTrue(page_2_first_id)
                self.assertNotEqual(page_2_first_id, page_1_first_id)

                status_invalid_cursor, body_invalid_cursor = self._http_json(
                    f"{list_page_url}&cursor=not_a_number",
                    method="GET",
                    token=token_read,
                )
                self.assertEqual(status_invalid_cursor, 400)
                self.assertEqual(body_invalid_cursor.get("error"), "invalid_cursor")

                status_import_invalid, body_import_invalid = self._http_json(
                    import_url,
                    method="POST",
                    token=token_write,
                    payload={
                        "scope": "auto",
                        "records": [
                            {
                                "text": "这条是无效数据",
                                "importance": "very-high",
                            }
                        ],
                    },
                )
                self.assertEqual(status_import_invalid, 400)
                self.assertEqual(body_import_invalid.get("error"), "memory_import_failed")
                self.assertEqual(body_import_invalid.get("detail_error"), "invalid_record_schema")
                self.assertEqual(body_import_invalid.get("invalid_count"), 1)
                invalid_rows = body_import_invalid.get("invalid_rows")
                self.assertIsInstance(invalid_rows, list)
                if isinstance(invalid_rows, list) and invalid_rows:
                    row0 = invalid_rows[0]
                    self.assertIsInstance(row0, dict)
                    errors = row0.get("errors")
                    self.assertIsInstance(errors, list)
                    if isinstance(errors, list):
                        self.assertIn("importance", json.dumps(errors, ensure_ascii=False))

                status_list, body_list = self._http_json(list_url, method="GET", token=token_read)
                self.assertEqual(status_list, 200)
                records = body_list.get("records")
                self.assertIsInstance(records, list)
                target_id = ""
                if isinstance(records, list):
                    self.assertGreaterEqual(len(records), 1)
                    target = next((row for row in records if "退款 SLA" in str(row.get("text"))), None)
                    self.assertIsNotNone(target)
                    if isinstance(target, dict):
                        target_id = str(target.get("id") or "")
                self.assertTrue(target_id)

                forget_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory/forget"
                status_forget, body_forget = self._http_json(
                    forget_url,
                    method="POST",
                    token=token_write,
                    payload={"ids": [target_id], "reason": "ops_cleanup", "dry_run": False},
                )
                self.assertEqual(status_forget, 200)
                self.assertEqual(body_forget.get("forgotten_count"), 1)

                lifecycle_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory/lifecycle"
                status_lifecycle_denied, body_lifecycle_denied = self._http_json(
                    lifecycle_url,
                    method="POST",
                    token=token_read,
                    payload={"scope": "auto", "dry_run": True},
                )
                self.assertEqual(status_lifecycle_denied, 403)
                self.assertEqual(body_lifecycle_denied.get("error"), "management_acl_denied")

                status_lifecycle, body_lifecycle = self._http_json(
                    lifecycle_url,
                    method="POST",
                    token=token_write,
                    payload={"scope": "auto", "dry_run": True},
                )
                self.assertEqual(status_lifecycle, 200)
                self.assertTrue(body_lifecycle.get("dry_run"))
                self.assertIsInstance(body_lifecycle.get("lines"), list)

                batch_lifecycle_url = f"{base_url}/api/v1/memory/lifecycle/run"
                status_batch_lifecycle_denied, body_batch_lifecycle_denied = self._http_json(
                    batch_lifecycle_url,
                    method="POST",
                    token=token_read,
                    payload={"scope": "auto", "dry_run": True, "sessions": [session_id]},
                )
                self.assertEqual(status_batch_lifecycle_denied, 403)
                self.assertEqual(body_batch_lifecycle_denied.get("error"), "management_acl_denied")

                status_batch_lifecycle, body_batch_lifecycle = self._http_json(
                    batch_lifecycle_url,
                    method="POST",
                    token=token_write,
                    payload={
                        "scope": "auto",
                        "dry_run": True,
                        "session_prefix": "feishu:grobot:dm:",
                        "limit": 10,
                    },
                )
                self.assertEqual(status_batch_lifecycle, 200)
                self.assertGreaterEqual(int(body_batch_lifecycle.get("requested_count") or 0), 1)
                self.assertGreaterEqual(int(body_batch_lifecycle.get("success_count") or 0), 1)
                self.assertEqual(int(body_batch_lifecycle.get("failed_count") or 0), 0)

                export_url = (
                    f"{base_url}/api/v1/sessions/{encoded_session}/memory/export"
                    "?include_archived=true&include_restricted=true&limit=1"
                )
                status_export_1, body_export_1 = self._http_json(export_url, method="GET", token=token_read)
                self.assertEqual(status_export_1, 200)
                export_records = body_export_1.get("records")
                self.assertIsInstance(export_records, list)
                self.assertEqual(body_export_1.get("count"), 1)
                self.assertTrue(body_export_1.get("has_more"))
                export_next_cursor = body_export_1.get("next_cursor")
                self.assertIsInstance(export_next_cursor, str)

                status_export_2, body_export_2 = self._http_json(
                    f"{export_url}&cursor={export_next_cursor}",
                    method="GET",
                    token=token_read,
                )
                self.assertEqual(status_export_2, 200)
                export_records_2 = body_export_2.get("records")
                self.assertIsInstance(export_records_2, list)
                self.assertGreaterEqual(body_export_2.get("count", 0), 1)

                if isinstance(export_records, list):
                    archived_hit = any(
                        isinstance(row, dict)
                        and str(row.get("id") or "") == target_id
                        and row.get("state") == "archived"
                        for row in export_records
                    )
                    if not archived_hit and isinstance(export_records_2, list):
                        archived_hit = any(
                            isinstance(row, dict)
                            and str(row.get("id") or "") == target_id
                            and row.get("state") == "archived"
                            for row in export_records_2
                        )
                    self.assertTrue(archived_hit)

                status_status, body_status = self._http_json(f"{base_url}/api/v1/status", method="GET", token=None)
                self.assertEqual(status_status, 200)
                management_auth = body_status.get("management_auth")
                self.assertIsInstance(management_auth, dict)
                if isinstance(management_auth, dict):
                    protected_actions = management_auth.get("protected_endpoint_actions")
                    self.assertIsInstance(protected_actions, dict)
                    if isinstance(protected_actions, dict):
                        self.assertEqual(
                            protected_actions.get("POST /api/v1/memory/lifecycle/run"),
                            "memory_lifecycle",
                        )
                memory_management = body_status.get("memory_management")
                self.assertIsInstance(memory_management, dict)
                if isinstance(memory_management, dict):
                    lifecycle_metrics = memory_management.get("lifecycle")
                    self.assertIsInstance(lifecycle_metrics, dict)
                    if isinstance(lifecycle_metrics, dict):
                        self.assertGreaterEqual(int(lifecycle_metrics.get("total_runs") or 0), 2)
                        self.assertGreaterEqual(int(lifecycle_metrics.get("success_runs") or 0), 2)
                        self.assertEqual(lifecycle_metrics.get("last_scope"), "auto")
                        self.assertTrue(bool(lifecycle_metrics.get("last_dry_run")))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
