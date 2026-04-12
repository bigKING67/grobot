#!/usr/bin/env python3
from __future__ import annotations

import json
import socket
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from gateway.tests.ts_contract import run_node_contract, spawn_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract, spawn_node_contract


def run_session_lifecycle_contract(command: str, *args: str) -> subprocess.CompletedProcess[str]:
    return run_node_contract("session-lifecycle-contract.mjs", command, args)


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
        result_one = run_session_lifecycle_contract(
            "build-session-key",
            "--project-name",
            "my-project",
            "--platform",
            "feishu",
            "--scope",
            "dm",
            "--subject",
            "open_id_123",
            "--work-dir",
            "/tmp/workspace-a",
        )
        self.assertEqual(result_one.returncode, 0, msg=result_one.stderr)
        payload_one = json.loads(result_one.stdout)

        result_two = run_session_lifecycle_contract(
            "build-session-key",
            "--project-name",
            "my-project",
            "--platform",
            "feishu",
            "--scope",
            "dm",
            "--subject",
            "open_id_123",
            "--work-dir",
            "/tmp/workspace-b",
        )
        self.assertEqual(result_two.returncode, 0, msg=result_two.stderr)
        payload_two = json.loads(result_two.stdout)

        self.assertEqual(payload_one["session_key"], "feishu:my-project:dm:open_id_123")
        self.assertEqual(payload_two["session_key"], "feishu:my-project:dm:open_id_123")

    def test_session_registry_supports_main_and_new_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".grobot" / "sessions"
            namespace_key = "feishu:grobot:dm:open_abc"
            result = run_session_lifecycle_contract(
                "session-registry-flow",
                "--root",
                str(root),
                "--namespace-key",
                namespace_key,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["initial_warnings"], [])
            self.assertEqual(payload["initial_active_id"], "main")
            self.assertEqual(payload["initial_main_session_key"], namespace_key)
            self.assertEqual(payload["save_warnings"], [])
            self.assertEqual(payload["restored_warnings"], [])
            self.assertGreaterEqual(int(payload["restored_session_count"]), 2)
            self.assertTrue(bool(str(payload["restored_active_id"])))

    def test_continue_bridge_message_is_summary_only(self) -> None:
        source_history = [
            {"role": "user", "content": "Architecture decision: keep deterministic failover ordering."},
            {"role": "assistant", "content": "已记录架构决策并完成第一轮测试。"},
            {"role": "user", "content": "Modified files: gateway/grobot_cli.py, gateway/tests/test_session_lifecycle.py"},
            {"role": "assistant", "content": "PASS: session commands verified locally."},
            {"role": "user", "content": "TODO: add edge-case tests for switch and continue."},
            {"role": "assistant", "content": "收到，稍后补齐。"},
        ]
        payload = {
            "source_session_id": "s20260411abcd",
            "source_session_key": "feishu:grobot:dm:open_abc__s_s20260411abcd",
            "source_history_messages": source_history,
            "max_turns": 2,
        }
        result = run_session_lifecycle_contract(
            "continue-bridge-message",
            "--payload",
            json.dumps(payload, ensure_ascii=False),
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        parsed = json.loads(result.stdout)
        bridge = parsed.get("bridge")
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
            project_wiki_dir = project_grobot / "wiki"
            global_wiki_dir = Path(temp_home) / "wiki"
            project_wiki_dir.mkdir(parents=True, exist_ok=True)
            (global_wiki_dir / "org" / "demo").mkdir(parents=True, exist_ok=True)

            (project_wiki_dir / "project-note.md").write_text(
                "接口契约：支付状态统一为 paid/unpaid。",
                encoding="utf-8",
            )
            (global_wiki_dir / "org" / "demo" / "org-note.md").write_text(
                "组织标准：所有回滚都要附应急联系人。",
                encoding="utf-8",
            )

            prompt = "接口契约 支付状态"
            result_project_only = run_session_lifecycle_contract(
                "build-wiki-context",
                "--prompt",
                prompt,
                "--project-wiki-dir",
                str(project_wiki_dir),
                "--global-wiki-dir",
                str(global_wiki_dir),
                "--session-key",
                "local:demo:dm:tester",
                "--allow-org-shared",
                "false",
            )
            self.assertEqual(result_project_only.returncode, 0, msg=result_project_only.stderr)
            block_project_only = json.loads(result_project_only.stdout).get("block")
            self.assertIsInstance(block_project_only, str)
            if isinstance(block_project_only, str):
                self.assertIn("project-note.md", block_project_only)
                self.assertNotIn("org-note.md", block_project_only)

            result_with_org = run_session_lifecycle_contract(
                "build-wiki-context",
                "--prompt",
                "所有回滚都要附应急联系人",
                "--project-wiki-dir",
                str(project_wiki_dir),
                "--global-wiki-dir",
                str(global_wiki_dir),
                "--session-key",
                "local:demo:group:team-chat",
                "--allow-org-shared",
                "true",
            )
            self.assertEqual(result_with_org.returncode, 0, msg=result_with_org.stderr)
            block_with_org = json.loads(result_with_org.stdout).get("block")
            self.assertIsInstance(block_with_org, str)
            if isinstance(block_with_org, str):
                self.assertIn("org-note.md", block_with_org)

    def test_parser_accepts_session_identity_flags(self) -> None:
        argv = [
            "start",
            "--project",
            "demo",
            "--session-scope",
            "group",
            "--session-subject",
            "chat_open_id_1",
        ]
        result = run_session_lifecycle_contract(
            "parse-args",
            "--argv",
            json.dumps(argv, ensure_ascii=False),
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        parsed = json.loads(result.stdout)
        self.assertEqual(parsed["session_scope"], "group")
        self.assertEqual(parsed["session_subject"], "chat_open_id_1")

    def test_parser_accepts_memory_subcommand(self) -> None:
        parsed_result = run_session_lifecycle_contract(
            "parse-args",
            "--argv",
            json.dumps(
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
                ],
                ensure_ascii=False,
            ),
        )
        self.assertEqual(parsed_result.returncode, 0, msg=parsed_result.stderr)
        parsed = json.loads(parsed_result.stdout)
        self.assertEqual(parsed["command"], "memory")
        self.assertEqual(parsed["memory_command"], "write")
        self.assertEqual(parsed["kind"], "policy")
        self.assertEqual(parsed["scope"], "group")
        self.assertEqual(parsed["session_scope"], "group")
        self.assertEqual(parsed["session_subject"], "chat_open_id_1")

        parsed_query_result = run_session_lifecycle_contract(
            "parse-args",
            "--argv",
            json.dumps(
                [
                    "memory",
                    "--project",
                    "demo",
                    "query",
                    "--query",
                    "补偿审批",
                    "--include-restricted",
                ],
                ensure_ascii=False,
            ),
        )
        self.assertEqual(parsed_query_result.returncode, 0, msg=parsed_query_result.stderr)
        parsed_query = json.loads(parsed_query_result.stdout)
        self.assertEqual(parsed_query["memory_command"], "query")
        self.assertTrue(parsed_query["include_restricted"])
        self.assertFalse(parsed_query["include_secret"])

        parsed_lifecycle_result = run_session_lifecycle_contract(
            "parse-args",
            "--argv",
            json.dumps(
                [
                    "memory",
                    "--project",
                    "demo",
                    "lifecycle",
                    "--scope",
                    "group",
                    "--dry-run",
                ],
                ensure_ascii=False,
            ),
        )
        self.assertEqual(parsed_lifecycle_result.returncode, 0, msg=parsed_lifecycle_result.stderr)
        parsed_lifecycle = json.loads(parsed_lifecycle_result.stdout)
        self.assertEqual(parsed_lifecycle["memory_command"], "lifecycle")
        self.assertEqual(parsed_lifecycle["scope"], "group")
        self.assertTrue(parsed_lifecycle["dry_run"])

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
            session_key = "feishu:demo:group:chat_001"
            result = run_session_lifecycle_contract(
                "interactive-memory-flow",
                "--root",
                str(project_root),
                "--session-key",
                session_key,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            write_payload = payload.get("write")
            review_payload = payload.get("review")
            query_payload = payload.get("query")
            lifecycle_payload = payload.get("lifecycle")
            self.assertIsInstance(write_payload, dict)
            self.assertIsInstance(review_payload, dict)
            self.assertIsInstance(query_payload, dict)
            self.assertIsInstance(lifecycle_payload, dict)
            if not isinstance(write_payload, dict):
                return
            self.assertEqual(write_payload.get("code"), 0)
            write_lines = write_payload.get("lines")
            self.assertIsInstance(write_lines, list)
            if not isinstance(write_lines, list):
                return
            proposal_line = next((line for line in write_lines if str(line).startswith("memory write proposal created:")), "")
            self.assertTrue(proposal_line)
            proposal_id = proposal_line.split(":", 1)[1].strip()
            self.assertTrue(proposal_id.startswith("mp"))

            if isinstance(review_payload, dict):
                self.assertEqual(review_payload.get("code"), 0)
                review_lines = review_payload.get("lines")
                self.assertIsInstance(review_lines, list)
                if isinstance(review_lines, list):
                    self.assertTrue(any("memory review applied" in str(line) for line in review_lines))
            if isinstance(query_payload, dict):
                self.assertEqual(query_payload.get("code"), 0)
                query_lines = query_payload.get("lines")
                self.assertIsInstance(query_lines, list)
                if isinstance(query_lines, list):
                    self.assertTrue(any("memory query: top=" in str(line) for line in query_lines))
            if isinstance(lifecycle_payload, dict):
                self.assertEqual(lifecycle_payload.get("code"), 0)
                lifecycle_lines = lifecycle_payload.get("lines")
                self.assertIsInstance(lifecycle_lines, list)
                if isinstance(lifecycle_lines, list):
                    self.assertTrue(any("memory lifecycle: dry_run=on" in str(line) for line in lifecycle_lines))

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
            token = "memory-write-token"
            session_id = "feishu:grobot:dm:open_memory_1"
            registry_namespace = "feishu:grobot:dm:ops_namespace"
            registry_root = Path(temp_home) / "runtime" / "sessions"
            prepare_registry = run_session_lifecycle_contract(
                "prepare-registry",
                "--root",
                str(registry_root),
                "--namespace-key",
                registry_namespace,
                "--session-key",
                session_id,
            )
            self.assertEqual(prepare_registry.returncode, 0, msg=prepare_registry.stderr)
            prepare_payload = json.loads(prepare_registry.stdout)
            self.assertEqual(prepare_payload.get("warnings"), [])
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
                        "[retrieval]",
                        "enabled = true",
                        "selected_limit = 5",
                        "candidate_limit = 9",
                        'base_url = "https://api.siliconflow.cn/v1"',
                        "",
                        "[retrieval.embedding]",
                        'model = "Qwen/Qwen3-Embedding-4B"',
                        "",
                        "[retrieval.rerank]",
                        'model = "Qwen/Qwen3-Reranker-8B"',
                        "",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            port = self._pick_free_tcp_port()
            bind = f"127.0.0.1:{port}"
            process = spawn_node_contract(
                "serve-daemon-contract.mjs",
                "session-lifecycle-management-daemon",
                (
                    "--repo-root",
                    str(repo_root),
                    "--project-root",
                    str(project_root),
                    "--home-dir",
                    temp_home,
                    "--config-path",
                    str(cfg_path),
                    "--bind",
                    bind,
                    "--management-token",
                    token,
                ),
                cwd=repo_root,
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
                list_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory?limit=20&include_restricted=true"
                list_page_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory?limit=1&include_restricted=true"

                status_unauth, body_unauth = self._http_json(list_url, method="GET", token=None)
                self.assertEqual(status_unauth, 403)
                self.assertEqual(body_unauth.get("error"), "forbidden")

                status_invalid_scope, body_invalid_scope = self._http_json(
                    f"{list_url}&scope=invalid_scope",
                    method="GET",
                    token=token,
                )
                self.assertEqual(status_invalid_scope, 400)
                self.assertEqual(body_invalid_scope.get("error"), "invalid_scope")

                status_invalid_kind, body_invalid_kind = self._http_json(
                    f"{list_url}&kind=not_a_kind",
                    method="GET",
                    token=token,
                )
                self.assertEqual(status_invalid_kind, 400)
                self.assertEqual(body_invalid_kind.get("error"), "invalid_kind")

                import_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory/import"
                status_import, body_import = self._http_json(
                    import_url,
                    method="POST",
                    token=token,
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

                status_list_page_1, body_list_page_1 = self._http_json(list_page_url, method="GET", token=token)
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
                    token=token,
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
                    token=token,
                )
                self.assertEqual(status_invalid_cursor, 400)
                self.assertEqual(body_invalid_cursor.get("error"), "invalid_cursor")

                status_import_invalid, body_import_invalid = self._http_json(
                    import_url,
                    method="POST",
                    token=token,
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

                list_query_url = f"{list_url}&query={quote('退款 SLA', safe='')}"
                status_list, body_list = self._http_json(list_query_url, method="GET", token=token)
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
                    token=token,
                    payload={"ids": [target_id], "reason": "ops_cleanup", "dry_run": False},
                )
                self.assertEqual(status_forget, 200)
                self.assertEqual(body_forget.get("forgotten_count"), 1)

                lifecycle_url = f"{base_url}/api/v1/sessions/{encoded_session}/memory/lifecycle"
                status_lifecycle, body_lifecycle = self._http_json(
                    lifecycle_url,
                    method="POST",
                    token=token,
                    payload={"scope": "auto", "dry_run": True},
                )
                self.assertEqual(status_lifecycle, 200)
                self.assertTrue(body_lifecycle.get("dry_run"))
                self.assertIsInstance(body_lifecycle.get("lines"), list)

                batch_lifecycle_url = f"{base_url}/api/v1/memory/lifecycle/run"
                status_batch_lifecycle, body_batch_lifecycle = self._http_json(
                    batch_lifecycle_url,
                    method="POST",
                    token=token,
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
                status_export_1, body_export_1 = self._http_json(export_url, method="GET", token=token)
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
                    token=token,
                )
                self.assertEqual(status_export_2, 200)
                export_records_2 = body_export_2.get("records")
                self.assertIsInstance(export_records_2, list)
                self.assertGreaterEqual(body_export_2.get("count", 0), 1)

                if isinstance(export_records, list):
                    exported_ids = [
                        str(row.get("id") or "")
                        for row in export_records
                        if isinstance(row, dict)
                    ]
                    if isinstance(export_records_2, list):
                        exported_ids.extend(
                            [
                                str(row.get("id") or "")
                                for row in export_records_2
                                if isinstance(row, dict)
                            ]
                        )
                    self.assertTrue(any(item for item in exported_ids))

                status_status, body_status = self._http_json(f"{base_url}/api/v1/status", method="GET", token=None)
                self.assertEqual(status_status, 200)
                execution_plane = body_status.get("execution_plane")
                self.assertIsInstance(execution_plane, dict)
                if isinstance(execution_plane, dict):
                    self.assertEqual(execution_plane.get("gateway_impl"), "ts")
                    self.assertEqual(execution_plane.get("runtime_impl"), "rust")
                    self.assertTrue(bool(execution_plane.get("shadow_mode")))
                    sources = execution_plane.get("sources")
                    self.assertIsInstance(sources, dict)
                    if isinstance(sources, dict):
                        self.assertEqual(sources.get("gateway_impl"), "cli")
                        self.assertEqual(sources.get("runtime_impl"), "cli")
                        self.assertEqual(sources.get("shadow_mode"), "cli")
                management_auth = body_status.get("management_auth")
                self.assertIsInstance(management_auth, dict)
                governance_plane = body_status.get("governance_plane")
                self.assertIsInstance(governance_plane, dict)
                if isinstance(governance_plane, dict):
                    self.assertTrue(bool(governance_plane.get("enabled")))
                    self.assertEqual(governance_plane.get("plane"), "governance.v1")
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
