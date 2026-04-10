#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
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


class LocalToolsTests(unittest.TestCase):
    def _write_mock_mcp_server(self, target: Path) -> None:
        target.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env python3",
                    "import json",
                    "import sys",
                    "",
                    "def read_message():",
                    "    headers = {}",
                    "    while True:",
                    "        line = sys.stdin.buffer.readline()",
                    "        if not line:",
                    "            return None",
                    "        if line in (b'\\r\\n', b'\\n'):",
                    "            break",
                    "        if b':' not in line:",
                    "            continue",
                    "        key, value = line.decode('ascii', errors='replace').split(':', 1)",
                    "        headers[key.strip().lower()] = value.strip()",
                    "    length = int(headers.get('content-length', '0'))",
                    "    body = sys.stdin.buffer.read(length)",
                    "    if not body:",
                    "        return None",
                    "    return json.loads(body.decode('utf-8'))",
                    "",
                    "def write_message(payload):",
                    "    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')",
                    "    header = f'Content-Length: {len(body)}\\r\\n\\r\\n'.encode('ascii')",
                    "    sys.stdout.buffer.write(header)",
                    "    sys.stdout.buffer.write(body)",
                    "    sys.stdout.buffer.flush()",
                    "",
                    "while True:",
                    "    message = read_message()",
                    "    if message is None:",
                    "        break",
                    "    method = message.get('method')",
                    "    req_id = message.get('id')",
                    "    if method == 'initialize':",
                    "        write_message({",
                    "            'jsonrpc': '2.0',",
                    "            'id': req_id,",
                    "            'result': {",
                    "                'protocolVersion': '2024-11-05',",
                    "                'serverInfo': {'name': 'mock', 'version': '1.0.0'},",
                    "                'capabilities': {'tools': {}},",
                    "            },",
                    "        })",
                    "        continue",
                    "    if method == 'notifications/initialized':",
                    "        continue",
                    "    if method == 'tools/list':",
                    "        write_message({",
                    "            'jsonrpc': '2.0',",
                    "            'id': req_id,",
                    "            'result': {'tools': [{'name': 'echo', 'description': 'echo tool'}]},",
                    "        })",
                    "        continue",
                    "    if method == 'tools/call':",
                    "        params = message.get('params') or {}",
                    "        arguments = params.get('arguments') if isinstance(params, dict) else {}",
                    "        if not isinstance(arguments, dict):",
                    "            arguments = {}",
                    "        text = str(arguments.get('msg', ''))",
                    "        write_message({",
                    "            'jsonrpc': '2.0',",
                    "            'id': req_id,",
                    "            'result': {",
                    "                'isError': False,",
                    "                'content': [{'type': 'text', 'text': f'echo:{text}'}],",
                    "                'structuredContent': {'echo': text},",
                    "            },",
                    "        })",
                    "        continue",
                    "    if req_id is not None:",
                    "        write_message({",
                    "            'jsonrpc': '2.0',",
                    "            'id': req_id,",
                    "            'error': {'code': -32601, 'message': 'method not found'},",
                    "        })",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

    def test_file_mention_enrichment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "main.py").write_text("print('main')\n", encoding="utf-8")
            (work_dir / "src" / "main_test.py").write_text("print('test')\n", encoding="utf-8")
            (work_dir / "docs").mkdir(parents=True, exist_ok=True)
            (work_dir / "docs" / "main.md").write_text("# main\n", encoding="utf-8")

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )
            prompt = "请帮我看@src/main.py, 然后再看@main，另外@missing.py。"
            enriched, lines, mention_index = grobot_cli.enrich_user_prompt_with_file_mentions(
                prompt,
                context,
                None,
            )

            self.assertEqual(len(lines), 3)
            self.assertIn("[Resolved @file mentions]", enriched)
            self.assertIn("@src/main.py => src/main.py", enriched)
            self.assertIn("@main => ambiguous:", enriched)
            self.assertIn("@missing.py => not_found", enriched)
            self.assertIsNotNone(mention_index)

    def test_extract_file_mentions_ignores_non_mentions(self) -> None:
        tokens = grobot_cli.extract_file_mentions("邮箱 test@example.com 和 @a.py、@b.ts。")
        self.assertEqual(tokens, ["a.py", "b.ts"])

    def test_mention_index_incremental_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            file_a = work_dir / "src" / "alpha.py"
            file_b = work_dir / "src" / "beta.py"
            file_a.write_text("print('a')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            initial = grobot_cli.find_mention_candidates(index, "alpha.py", 5)
            self.assertIn("src/alpha.py", initial)
            self.assertNotIn("src/beta.py", initial)

            file_a.unlink()
            file_b.write_text("print('b')\n", encoding="utf-8")
            index = grobot_cli.refresh_mention_path_index(index, force=True)

            refreshed_alpha = grobot_cli.find_mention_candidates(index, "alpha.py", 5)
            refreshed_beta = grobot_cli.find_mention_candidates(index, "beta.py", 5)
            self.assertNotIn("src/alpha.py", refreshed_alpha)
            self.assertIn("src/beta.py", refreshed_beta)

    def test_mention_explicit_token_prefers_exact_matches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "main.py").write_text("print('main')\n", encoding="utf-8")
            (work_dir / "src" / "main.py.backup").write_text("print('backup')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            candidates = grobot_cli.find_mention_candidates(index, "main.py", 5)
            self.assertIn("src/main.py", candidates)
            self.assertNotIn("src/main.py.backup", candidates)

    def test_mention_query_cache_isolated_by_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "tests").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")
            (work_dir / "tests" / "alpha.py").write_text("print('b')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            top1 = grobot_cli.find_mention_candidates(index, "alpha.py", 1)
            top5 = grobot_cli.find_mention_candidates(index, "alpha.py", 5)
            self.assertEqual(len(top1), 1)
            self.assertGreaterEqual(len(top5), 2)

    def test_hard_stale_existing_mention_skips_async_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")
            context = grobot_cli.LocalToolContext(work_dir=work_dir, allow_tokens=("all",))

            index = grobot_cli.build_mention_path_index(work_dir)
            index.last_scan_at = 0.0
            with mock.patch.object(
                grobot_cli,
                "mention_state_schedule_async_refresh",
                wraps=grobot_cli.mention_state_schedule_async_refresh,
            ) as refresh_mock:
                _, lines, _ = grobot_cli.enrich_user_prompt_with_file_mentions(
                    "请检查@alpha.py",
                    context,
                    index,
                )
                self.assertEqual(refresh_mock.call_count, 0)
                self.assertIn("@alpha.py => src/alpha.py", lines)

    def test_hard_stale_deleted_mention_triggers_async_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            deleted = work_dir / "src" / "alpha.py"
            deleted.write_text("print('a')\n", encoding="utf-8")
            context = grobot_cli.LocalToolContext(work_dir=work_dir, allow_tokens=("all",))

            index = grobot_cli.build_mention_path_index(work_dir)
            deleted.unlink()
            index.last_scan_at = 0.0
            with mock.patch.object(
                grobot_cli,
                "mention_state_schedule_async_refresh",
                wraps=grobot_cli.mention_state_schedule_async_refresh,
            ) as refresh_mock:
                _, lines, _ = grobot_cli.enrich_user_prompt_with_file_mentions(
                    "请检查@alpha.py",
                    context,
                    index,
                )
                self.assertGreaterEqual(refresh_mock.call_count, 1)
                self.assertIn("@alpha.py => not_found", lines)

    def test_mention_state_refresh_backoff_after_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            state = grobot_cli.MentionIndexState(active=index)
            state.last_refresh_error = "boom"
            state.last_refresh_started_at = time.time()
            scheduled = grobot_cli.mention_state_schedule_async_refresh(state)
            self.assertFalse(scheduled)
            self.assertEqual(state.last_refresh_status, "backoff")

    def test_mention_state_refresh_inflight_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            state = grobot_cli.MentionIndexState(active=index)

            class AliveThread:
                def is_alive(self) -> bool:
                    return True

            state.refresh_thread = AliveThread()
            scheduled = grobot_cli.mention_state_schedule_async_refresh(state)
            self.assertFalse(scheduled)
            self.assertEqual(state.last_refresh_status, "inflight")

    def test_list_tool_filters(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "a.py").write_text("print('a')\n", encoding="utf-8")
            (work_dir / "src" / "b.txt").write_text("hello\n", encoding="utf-8")

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            listed = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_LIST,
                {"path": "src", "pattern": "*.py", "kind": "file"},
                context,
            )
            self.assertGreaterEqual(listed["count"], 1)
            entry_paths = [item["path"] for item in listed["entries"]]
            self.assertIn("a.py", entry_paths)
            self.assertNotIn("b.txt", entry_paths)

    def test_glob_tool_and_search_context_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src" / "sub").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "a.py").write_text("print('a')\n", encoding="utf-8")
            (work_dir / "src" / "sub" / "b.py").write_text("print('b')\n", encoding="utf-8")
            (work_dir / "src" / "sub" / "c.ts").write_text("console.log('c')\n", encoding="utf-8")
            (work_dir / "src" / "sub" / "note.txt").write_text(
                "line-1\nneedle-line\nline-3\n",
                encoding="utf-8",
            )

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            globbed = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_GLOB,
                {"path": "src", "pattern": "*.py", "kind": "file"},
                context,
            )
            self.assertEqual(globbed["count"], 2)
            self.assertIn("a.py", globbed["matches"])
            self.assertIn("sub/b.py", globbed["matches"])
            self.assertNotIn("sub/c.ts", globbed["matches"])

            searched = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_SEARCH,
                {
                    "query": "needle-line",
                    "path": "src/sub",
                    "regex": False,
                    "case_sensitive": True,
                    "context_before": 1,
                    "context_after": 1,
                    "limit": 1,
                },
                context,
            )
            self.assertEqual(searched["count"], 1)
            self.assertGreaterEqual(searched["records"], 3)
            self.assertTrue(any(item.get("match") is True for item in searched["matches"]))
            self.assertTrue(any(item.get("match") is False for item in searched["matches"]))

    def test_search_tool_fixed_and_regex(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "notes").mkdir(parents=True, exist_ok=True)
            target = work_dir / "notes" / "x.txt"
            target.write_text("hello grobot\nHELLO agent\n", encoding="utf-8")

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            fixed = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_SEARCH,
                {"query": "hello", "path": "notes", "regex": False, "case_sensitive": False},
                context,
            )
            self.assertGreaterEqual(fixed["count"], 2)

            regex = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_SEARCH,
                {"query": "^HELLO", "path": "notes", "regex": True, "case_sensitive": True},
                context,
            )
            self.assertEqual(regex["count"], 1)
            self.assertEqual(regex["matches"][0]["line"], 2)

    def test_read_write_edit_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            write_result = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_WRITE,
                {"path": "note.txt", "content": "line1\nline2\nline3\nline2"},
                context,
            )
            self.assertEqual(write_result["bytes_written"], len("line1\nline2\nline3\nline2".encode("utf-8")))

            read_result = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_READ,
                {"path": "note.txt", "offset": 2, "limit": 2},
                context,
            )
            self.assertEqual(read_result["line_start"], 2)
            self.assertEqual(read_result["line_end"], 3)
            self.assertEqual(read_result["content"], "line2\nline3")

            edit_first = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_EDIT,
                {"path": "note.txt", "old_text": "line2", "new_text": "changed", "replace_all": False},
                context,
            )
            self.assertEqual(edit_first["occurrences_found"], 2)
            self.assertEqual(edit_first["replacements"], 1)

            edit_all = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_EDIT,
                {"path": "note.txt", "old_text": "line2", "new_text": "changed2", "replace_all": True},
                context,
            )
            self.assertEqual(edit_all["replacements"], 1)

    def test_path_escape_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir, tempfile.TemporaryDirectory() as outside_dir:
            work_dir = Path(tmp_dir)
            outside_file = Path(outside_dir) / "outside.txt"
            outside_file.write_text("outside", encoding="utf-8")
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_READ,
                    {"path": str(outside_file)},
                    context,
                )

    def test_bash_tool_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context_shell = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("shell",),
            )
            bash_ok = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_BASH,
                {"command": "echo hello"},
                context_shell,
            )
            self.assertEqual(bash_ok["exit_code"], 0)
            self.assertIn("hello", bash_ok["stdout"])

            context_restricted = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("python3",),
            )
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_BASH,
                    {"command": "echo denied"},
                    context_restricted,
                )

            bash_python = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_BASH,
                {"command": "python3 -c 'print(7)'"},
                context_restricted,
            )
            self.assertEqual(bash_python["exit_code"], 0)
            self.assertIn("7", bash_python["stdout"])

    def test_allowlist_blocks_glob_and_search(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "x.txt").write_text("hello\n", encoding="utf-8")
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=(grobot_cli.LOCAL_TOOL_READ,),
            )

            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_GLOB,
                    {"path": "src", "pattern": "*.txt"},
                    context,
                )

            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_SEARCH,
                    {"path": "src", "query": "hello"},
                    context,
                )

    def test_resolve_mcp_call_policy_from_project_toml(self) -> None:
        policy = grobot_cli.resolve_mcp_call_policy(
            {
                "tools": {
                    "mcp": {
                        "max_concurrency_per_server": 3,
                        "max_queue_per_server": 25,
                        "failure_threshold": 4,
                        "cooldown_secs": 45,
                        "allow_tools": ["echo", "search_code"],
                        "latency_sample_limit": 512,
                    }
                }
            }
        )
        self.assertEqual(policy.max_concurrency_per_server, 3)
        self.assertEqual(policy.max_queue_per_server, 25)
        self.assertEqual(policy.failure_threshold, 4)
        self.assertEqual(policy.cooldown_secs, 45)
        self.assertEqual(policy.allow_tools, ("echo", "search_code"))
        self.assertEqual(policy.latency_sample_limit, 512)

    def test_mcp_server_slot_queue_full(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            context = grobot_cli.LocalToolContext(
                work_dir=Path(tmp_dir),
                allow_tokens=("all",),
                mcp_policy=grobot_cli.MCPCallPolicy(
                    max_concurrency_per_server=1,
                    max_queue_per_server=1,
                    failure_threshold=3,
                    cooldown_secs=20,
                    allow_tools=None,
                    latency_sample_limit=grobot_cli.LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_DEFAULT,
                ),
            )
            state = grobot_cli.acquire_mcp_server_slot(
                context=context,
                server_name="mock",
                timeout_secs=2,
            )
            blocked_event = threading.Event()

            def hold_queue_slot() -> None:
                try:
                    queued_state = grobot_cli.acquire_mcp_server_slot(
                        context=context,
                        server_name="mock",
                        timeout_secs=2,
                    )
                    grobot_cli.release_mcp_server_slot(queued_state)
                except RuntimeError:
                    pass
                finally:
                    blocked_event.set()

            waiter = threading.Thread(target=hold_queue_slot)
            waiter.start()
            time.sleep(0.1)
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.acquire_mcp_server_slot(
                    context=context,
                    server_name="mock",
                    timeout_secs=1,
                )
            snapshot = grobot_cli.mcp_server_state_snapshot(state)
            self.assertEqual(snapshot["gate_rejected_calls"], 1)
            grobot_cli.release_mcp_server_slot(state)
            waiter.join(timeout=2)
            self.assertTrue(blocked_event.is_set())

    def test_mcp_server_circuit_open_blocks_calls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            context = grobot_cli.LocalToolContext(
                work_dir=Path(tmp_dir),
                allow_tokens=("all",),
                mcp_policy=grobot_cli.MCPCallPolicy(
                    max_concurrency_per_server=1,
                    max_queue_per_server=8,
                    failure_threshold=2,
                    cooldown_secs=60,
                    allow_tools=None,
                    latency_sample_limit=grobot_cli.LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_DEFAULT,
                ),
            )
            state = grobot_cli.get_mcp_server_call_state(context, "mock")
            opened_first = grobot_cli.mark_mcp_server_call_failure(
                state=state,
                error_text="first",
                policy=context.mcp_policy,
                elapsed_ms=8.5,
            )
            self.assertFalse(opened_first)
            opened_second = grobot_cli.mark_mcp_server_call_failure(
                state=state,
                error_text="second",
                policy=context.mcp_policy,
                elapsed_ms=9.2,
            )
            self.assertTrue(opened_second)
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.acquire_mcp_server_slot(
                    context=context,
                    server_name="mock",
                    timeout_secs=1,
                )
            snapshot = grobot_cli.mcp_server_state_snapshot(state)
            self.assertEqual(snapshot["failure_calls"], 2)
            self.assertEqual(snapshot["unknown_failures"], 2)
            self.assertEqual(snapshot["gate_rejected_calls"], 1)

    def test_mcp_servers_tool_returns_runtime_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_runtime={
                    "total": 3,
                    "enabled_count": 2,
                    "disabled_count": 1,
                    "ready_count": 1,
                    "unready_count": 1,
                    "effective": [
                        {"name": "a", "enabled": True, "ready": True},
                        {"name": "b", "enabled": True, "ready": False},
                        {"name": "c", "enabled": False, "ready": None},
                    ],
                },
            )

            full = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_SERVERS,
                {"include_disabled": True},
                context,
            )
            self.assertEqual(full["total"], 3)
            self.assertEqual(full["enabled_count"], 2)
            self.assertEqual(full["ready_count"], 1)
            self.assertEqual(len(full["servers"]), 3)
            self.assertIn("policy", full)
            self.assertIn("max_concurrency_per_server", full["policy"])
            self.assertEqual(full["policy"]["allow_tools"], ["*"])
            self.assertEqual(
                full["policy"]["latency_sample_limit"],
                grobot_cli.LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_DEFAULT,
            )
            self.assertIn("runtime_summary", full)
            self.assertEqual(full["runtime_summary"]["servers_considered"], 3)
            self.assertEqual(full["runtime_summary"]["total_calls"], 0)
            self.assertTrue(all("runtime_state" in item for item in full["servers"]))
            self.assertTrue(
                all("p95_latency_ms" in item["runtime_state"] for item in full["servers"])
            )

            ready_only = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_SERVERS,
                {"include_disabled": False, "only_ready": True},
                context,
            )
            self.assertEqual(len(ready_only["servers"]), 1)
            self.assertEqual(ready_only["servers"][0]["name"], "a")
            self.assertEqual(ready_only["runtime_summary"]["servers_considered"], 1)

    def test_mcp_servers_runtime_summary_aggregates_failures_and_top_errors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_runtime={
                    "total": 2,
                    "enabled_count": 2,
                    "disabled_count": 0,
                    "ready_count": 2,
                    "unready_count": 0,
                    "effective": [
                        {"name": "a", "enabled": True, "ready": True},
                        {"name": "b", "enabled": True, "ready": True},
                    ],
                },
            )
            a_state = grobot_cli.get_mcp_server_call_state(context, "a")
            b_state = grobot_cli.get_mcp_server_call_state(context, "b")
            grobot_cli.mark_mcp_server_call_success(
                state=a_state,
                elapsed_ms=12.0,
                policy=context.mcp_policy,
            )
            grobot_cli.mark_mcp_server_call_failure(
                state=b_state,
                error_text="json-rpc read timeout",
                policy=context.mcp_policy,
                elapsed_ms=33.0,
            )
            grobot_cli.mark_mcp_policy_denied(
                state=b_state,
                error_text='MCP tool "x" blocked by [tools.mcp].allow_tools',
            )

            result = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_SERVERS,
                {"include_disabled": True, "include_runtime_state": True},
                context,
            )
            summary = result["runtime_summary"]
            self.assertEqual(summary["servers_considered"], 2)
            self.assertEqual(summary["total_calls"], 2)
            self.assertEqual(summary["success_calls"], 1)
            self.assertEqual(summary["failure_calls"], 1)
            self.assertEqual(summary["timeout_failures"], 1)
            self.assertEqual(summary["transport_failures"], 0)
            self.assertEqual(summary["policy_denied_calls"], 1)
            self.assertGreaterEqual(summary["latency_sample_count"], 2)
            self.assertTrue(summary["top_errors"])

    def test_reset_mcp_server_states_supports_single_and_all(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            context = grobot_cli.LocalToolContext(
                work_dir=Path(tmp_dir),
                allow_tokens=("all",),
            )
            a_state = grobot_cli.get_mcp_server_call_state(context, "a")
            b_state = grobot_cli.get_mcp_server_call_state(context, "b")
            grobot_cli.mark_mcp_server_call_success(
                state=a_state,
                elapsed_ms=10.0,
                policy=context.mcp_policy,
            )
            grobot_cli.mark_mcp_server_call_failure(
                state=b_state,
                error_text="tool not found",
                policy=context.mcp_policy,
                elapsed_ms=20.0,
            )
            self.assertEqual(grobot_cli.mcp_server_state_snapshot(a_state)["total_calls"], 1)
            self.assertEqual(grobot_cli.mcp_server_state_snapshot(b_state)["total_calls"], 1)

            reset_single = grobot_cli.reset_mcp_server_states(context, "a")
            self.assertEqual(reset_single, 1)
            self.assertEqual(grobot_cli.mcp_server_state_snapshot(a_state)["total_calls"], 0)
            self.assertEqual(grobot_cli.mcp_server_state_snapshot(b_state)["total_calls"], 1)

            reset_all = grobot_cli.reset_mcp_server_states(context, None)
            self.assertEqual(reset_all, 2)
            self.assertEqual(grobot_cli.mcp_server_state_snapshot(a_state)["total_calls"], 0)
            self.assertEqual(grobot_cli.mcp_server_state_snapshot(b_state)["total_calls"], 0)

    def test_close_single_mcp_session_closes_target_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            server_script = work_dir / "mock_mcp_server.py"
            self._write_mock_mcp_server(server_script)
            os.chmod(server_script, 0o755)

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_runtime={
                    "effective": [
                        {
                            "name": "mock",
                            "enabled": True,
                            "ready": True,
                            "command": sys.executable,
                            "command_resolved": sys.executable,
                            "args": [str(server_script)],
                            "env": {},
                        }
                    ]
                },
            )
            _ = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_CALL,
                {
                    "server": "mock",
                    "tool": "echo",
                    "arguments": {"msg": "hello"},
                    "timeout_secs": 10,
                },
                context,
            )
            self.assertIn("mock", context.mcp_sessions)
            self.assertTrue(grobot_cli.close_single_mcp_session(context, "mock"))
            self.assertNotIn("mock", context.mcp_sessions)
            self.assertFalse(grobot_cli.close_single_mcp_session(context, "mock"))

    def test_allowlist_blocks_mcp_servers_tool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=(grobot_cli.LOCAL_TOOL_READ,),
                mcp_runtime={"effective": []},
            )
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_MCP_SERVERS,
                    {},
                    context,
                )

    def test_mcp_call_tool_executes_stdio_server(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            server_script = work_dir / "mock_mcp_server.py"
            self._write_mock_mcp_server(server_script)
            os.chmod(server_script, 0o755)

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_runtime={
                    "effective": [
                        {
                            "name": "mock",
                            "enabled": True,
                            "ready": True,
                            "command": sys.executable,
                            "command_resolved": sys.executable,
                            "args": [str(server_script)],
                            "env": {},
                        }
                    ]
                },
            )

            result = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_CALL,
                {
                    "server": "mock",
                    "tool": "echo",
                    "arguments": {"msg": "hello-mcp"},
                    "timeout_secs": 10,
                },
                context,
            )

            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["server"], "mock")
            self.assertEqual(result["tool"], "echo")
            self.assertIn("echo", result["available_tools"])
            self.assertFalse(result["session_reused"])
            self.assertFalse(result["session_recovered"])
            first_pid = result["session_pid"]
            runtime_state = result["runtime_state"]
            self.assertEqual(runtime_state["total_calls"], 1)
            self.assertEqual(runtime_state["success_calls"], 1)
            self.assertEqual(runtime_state["failure_calls"], 0)
            self.assertEqual(runtime_state["retry_calls"], 0)
            self.assertEqual(runtime_state["recovered_calls"], 0)
            self.assertEqual(runtime_state["policy_denied_calls"], 0)
            self.assertEqual(runtime_state["gate_rejected_calls"], 0)
            self.assertGreater(runtime_state["last_latency_ms"], 0)
            self.assertGreaterEqual(runtime_state["p95_latency_ms"], 0)
            normalized_result = result["result"]
            self.assertFalse(normalized_result["is_error"])
            content = normalized_result.get("content")
            self.assertIsInstance(content, list)
            self.assertTrue(any(item.get("text") == "echo:hello-mcp" for item in content if isinstance(item, dict)))
            self.assertIn("hello-mcp", normalized_result.get("raw_preview", ""))
            self.assertIn("hello-mcp", normalized_result.get("structured_content_preview", ""))

            second = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_CALL,
                {
                    "server": "mock",
                    "tool": "echo",
                    "arguments": {"msg": "hello-again"},
                    "timeout_secs": 10,
                },
                context,
            )
            self.assertTrue(second["session_reused"])
            self.assertFalse(second["session_recovered"])
            self.assertEqual(second["session_pid"], first_pid)
            self.assertEqual(second["runtime_state"]["total_calls"], 2)
            self.assertEqual(second["runtime_state"]["success_calls"], 2)
            self.assertEqual(second["runtime_state"]["policy_denied_calls"], 0)
            self.assertIn("hello-again", second["result"].get("raw_preview", ""))
            grobot_cli.close_mcp_sessions(context)

    def test_mcp_call_tool_auto_recovers_when_session_process_exits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            server_script = work_dir / "mock_mcp_server.py"
            self._write_mock_mcp_server(server_script)
            os.chmod(server_script, 0o755)

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_runtime={
                    "effective": [
                        {
                            "name": "mock",
                            "enabled": True,
                            "ready": True,
                            "command": sys.executable,
                            "command_resolved": sys.executable,
                            "args": [str(server_script)],
                            "env": {},
                        }
                    ]
                },
            )

            first = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_CALL,
                {
                    "server": "mock",
                    "tool": "echo",
                    "arguments": {"msg": "first"},
                    "timeout_secs": 10,
                },
                context,
            )
            self.assertFalse(first["session_recovered"])
            first_pid = first["session_pid"]

            live = context.mcp_sessions.get("mock")
            self.assertIsNotNone(live)
            if live is not None:
                live.process.kill()
                live.process.wait(timeout=2)

            second = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_MCP_CALL,
                {
                    "server": "mock",
                    "tool": "echo",
                    "arguments": {"msg": "second"},
                    "timeout_secs": 10,
                },
                context,
            )
            self.assertTrue(second["session_recovered"])
            self.assertNotEqual(second["session_pid"], first_pid)
            self.assertEqual(second["runtime_state"]["total_calls"], 2)
            self.assertEqual(second["runtime_state"]["success_calls"], 2)
            self.assertEqual(second["runtime_state"]["recovered_calls"], 1)
            self.assertEqual(second["runtime_state"]["transport_failures"], 0)
            self.assertIn("second", second["result"].get("raw_preview", ""))
            grobot_cli.close_mcp_sessions(context)

    def test_mcp_call_tool_tracks_tool_failure_kind(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            server_script = work_dir / "mock_mcp_server.py"
            self._write_mock_mcp_server(server_script)
            os.chmod(server_script, 0o755)

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_runtime={
                    "effective": [
                        {
                            "name": "mock",
                            "enabled": True,
                            "ready": True,
                            "command": sys.executable,
                            "command_resolved": sys.executable,
                            "args": [str(server_script)],
                            "env": {},
                        }
                    ]
                },
            )

            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_MCP_CALL,
                    {"server": "mock", "tool": "missing_tool", "arguments": {}, "timeout_secs": 10},
                    context,
                )
            state = grobot_cli.lookup_mcp_server_call_state(context, "mock")
            self.assertIsNotNone(state)
            if state is not None:
                snapshot = grobot_cli.mcp_server_state_snapshot(state)
                self.assertEqual(snapshot["total_calls"], 1)
                self.assertEqual(snapshot["failure_calls"], 1)
                self.assertEqual(snapshot["tool_failures"], 1)
                self.assertEqual(snapshot["unknown_failures"], 0)
            grobot_cli.close_mcp_sessions(context)

    def test_mcp_call_tool_respects_mcp_allow_tools_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_policy=grobot_cli.MCPCallPolicy(
                    max_concurrency_per_server=1,
                    max_queue_per_server=16,
                    failure_threshold=3,
                    cooldown_secs=20,
                    allow_tools=("search_code",),
                    latency_sample_limit=grobot_cli.LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_DEFAULT,
                ),
                mcp_runtime={
                    "effective": [
                        {
                            "name": "mock",
                            "enabled": True,
                            "ready": True,
                            "command": "mock-bin",
                            "command_resolved": "mock-bin",
                            "args": [],
                            "env": {},
                        }
                    ]
                },
            )

            with self.assertRaises(RuntimeError) as ctx:
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_MCP_CALL,
                    {"server": "mock", "tool": "echo", "arguments": {"msg": "x"}},
                    context,
                )
            self.assertIn("allow_tools", str(ctx.exception))
            state = grobot_cli.lookup_mcp_server_call_state(context, "mock")
            self.assertIsNotNone(state)
            if state is not None:
                snapshot = grobot_cli.mcp_server_state_snapshot(state)
                self.assertEqual(snapshot["policy_denied_calls"], 1)
                self.assertEqual(snapshot["total_calls"], 0)
                self.assertEqual(snapshot["failure_calls"], 0)

    def test_allowlist_blocks_mcp_call_tool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=(grobot_cli.LOCAL_TOOL_READ,),
                mcp_runtime={"effective": []},
            )
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_MCP_CALL,
                    {"server": "mock", "tool": "echo", "arguments": {"msg": "x"}},
                    context,
                )

    def test_mcp_call_tool_rejects_unready_server(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
                mcp_runtime={
                    "effective": [
                        {
                            "name": "mock",
                            "enabled": True,
                            "ready": False,
                            "ready_reason": "command not found",
                            "command": "mock-bin",
                            "args": [],
                        }
                    ]
                },
            )
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_MCP_CALL,
                    {"server": "mock", "tool": "echo", "arguments": {"msg": "x"}},
                    context,
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
