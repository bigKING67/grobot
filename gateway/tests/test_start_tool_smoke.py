#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    from gateway.tests.ts_contract import run_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract

try:
    from gateway.tests.test_ts_rust_execution import FakeRedisServer, _resp_bulk, _resp_error, _resp_simple
except ModuleNotFoundError:
    from test_ts_rust_execution import FakeRedisServer, _resp_bulk, _resp_error, _resp_simple


class StartToolSmokeTests(unittest.TestCase):
    @staticmethod
    def _write_smoke_config(config_path: Path, work_dir: Path) -> None:
        config_path.write_text(
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
                    f'work_dir = "{work_dir}"',
                    'mode = "default"',
                    "",
                    "[[projects.agent.providers]]",
                    'name = "mock"',
                    'api_key = "mock-key"',
                    'base_url = "http://127.0.0.1:65534/v1"',
                    'model = "mock-model"',
                    "",
                    "[[projects.platforms]]",
                    'type = "feishu"',
                    "",
                    "[projects.platforms.options]",
                    'app_id = "x"',
                    'app_secret = "y"',
                    "",
                ]
            ),
            encoding="utf-8",
        )

    def _run_contract(self, command: str, repo_root: Path) -> dict[str, object]:
        result = run_node_contract("start-smoke-contract.mjs", command, ("--repo-root", str(repo_root)))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        self.assertIsInstance(payload, dict)
        if not isinstance(payload, dict):
            self.fail("contract payload must be object")
        return payload

    def test_package_launcher_rejects_python_execution_plane(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_contract("package-launcher-rejects-python", repo_root)
        self.assertEqual(payload.get("exit_code"), 2)
        self.assertIn("legacy python execution path is removed", str(payload.get("stderr", "")))

    def test_start_message_runs_via_ts_rust(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_contract("start-message-smoke", repo_root)
        self.assertEqual(payload.get("exit_code"), 0, msg=str(payload.get("stderr", "")))
        self.assertIn("[rust-runtime]", str(payload.get("stdout", "")))
        self.assertIn("[governance]", str(payload.get("stderr", "")))

    def test_start_session_store_redis_fallback_to_file(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_contract("start-session-store-redis-fallback", repo_root)
        self.assertEqual(payload.get("exit_code"), 0, msg=str(payload.get("stderr", "")))
        self.assertTrue(bool(payload.get("history_exists")))
        self.assertGreaterEqual(int(payload.get("history_message_count", 0)), 2)
        stderr_text = str(payload.get("stderr", ""))
        self.assertIn("fallback", stderr_text.lower())

    def test_start_interactive_session_flow_runs_via_ts_rust(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_contract("start-interactive-session-flow", repo_root)
        self.assertEqual(payload.get("exit_code"), 0, msg=str(payload.get("stderr", "")))
        self.assertGreaterEqual(int(payload.get("session_count", 0)), 2)
        self.assertTrue(bool(str(payload.get("active_session_id", ""))))
        self.assertGreaterEqual(int(payload.get("history_message_count", 0)), 2)
        self.assertTrue(bool(payload.get("handoff_exists")))
        self.assertTrue(bool(payload.get("handoff_has_compact_instructions")))
        self.assertIn("[rust-runtime]", str(payload.get("stdout", "")))

    def test_start_message_skips_auto_handoff_without_trigger(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix="grobot-start-no-auto-handoff-") as tmp_dir:
            root = Path(tmp_dir)
            work_dir = root / "work"
            home_dir = root / "home"
            work_dir.mkdir(parents=True, exist_ok=True)
            home_dir.mkdir(parents=True, exist_ok=True)
            config_path = root / "config.toml"
            self._write_smoke_config(config_path, work_dir)
            handoff_path = work_dir / "HANDOFF.md"

            result = subprocess.run(
                [
                    "./grobot",
                    "start",
                    "--project",
                    "grobot",
                    "--project-root",
                    str(work_dir),
                    "--work-dir",
                    str(work_dir),
                    "--home",
                    str(home_dir),
                    "--config",
                    str(config_path),
                    "--gateway-impl",
                    "ts",
                    "--runtime-impl",
                    "rust",
                    "--message",
                    "status ping only",
                ],
                cwd=repo_root,
                text=True,
                capture_output=True,
                check=False,
            )
            handoff_exists = handoff_path.exists()

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertFalse(handoff_exists)

    def test_start_message_writes_auto_handoff_when_todo_present(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix="grobot-start-auto-handoff-") as tmp_dir:
            root = Path(tmp_dir)
            work_dir = root / "work"
            home_dir = root / "home"
            work_dir.mkdir(parents=True, exist_ok=True)
            home_dir.mkdir(parents=True, exist_ok=True)
            config_path = root / "config.toml"
            self._write_smoke_config(config_path, work_dir)
            handoff_path = work_dir / "HANDOFF.md"

            result = subprocess.run(
                [
                    "./grobot",
                    "start",
                    "--project",
                    "grobot",
                    "--project-root",
                    str(work_dir),
                    "--work-dir",
                    str(work_dir),
                    "--home",
                    str(home_dir),
                    "--config",
                    str(config_path),
                    "--gateway-impl",
                    "ts",
                    "--runtime-impl",
                    "rust",
                    "--message",
                    "TODO: add rollback note to runbook",
                ],
                cwd=repo_root,
                text=True,
                capture_output=True,
                check=False,
            )

            handoff_exists = handoff_path.exists()
            handoff_content = handoff_path.read_text(encoding="utf-8") if handoff_exists else ""

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertTrue(handoff_exists)
        self.assertIn("reason: auto-exit", handoff_content)
        self.assertIn("## Compact Instructions", handoff_content)

    def test_start_interactive_skips_auto_handoff_without_trigger(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix="grobot-start-interactive-no-handoff-") as tmp_dir:
            root = Path(tmp_dir)
            work_dir = root / "work"
            home_dir = root / "home"
            work_dir.mkdir(parents=True, exist_ok=True)
            home_dir.mkdir(parents=True, exist_ok=True)
            config_path = root / "config.toml"
            self._write_smoke_config(config_path, work_dir)
            handoff_path = work_dir / "HANDOFF.md"

            result = subprocess.run(
                [
                    "./grobot",
                    "start",
                    "--project",
                    "grobot",
                    "--project-root",
                    str(work_dir),
                    "--work-dir",
                    str(work_dir),
                    "--home",
                    str(home_dir),
                    "--config",
                    str(config_path),
                    "--gateway-impl",
                    "ts",
                    "--runtime-impl",
                    "rust",
                ],
                cwd=repo_root,
                input="plain chat message\n/exit\n",
                text=True,
                capture_output=True,
                check=False,
            )
            handoff_exists = handoff_path.exists()

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertFalse(handoff_exists)

    def test_start_interactive_writes_auto_handoff_when_history_compacted(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix="grobot-start-compact-handoff-") as tmp_dir:
            root = Path(tmp_dir)
            work_dir = root / "work"
            home_dir = root / "home"
            work_dir.mkdir(parents=True, exist_ok=True)
            home_dir.mkdir(parents=True, exist_ok=True)
            config_path = root / "config.toml"
            self._write_smoke_config(config_path, work_dir)
            handoff_path = work_dir / "HANDOFF.md"

            result = subprocess.run(
                [
                    "./grobot",
                    "start",
                    "--project",
                    "grobot",
                    "--project-root",
                    str(work_dir),
                    "--work-dir",
                    str(work_dir),
                    "--home",
                    str(home_dir),
                    "--config",
                    str(config_path),
                    "--gateway-impl",
                    "ts",
                    "--runtime-impl",
                    "rust",
                    "--history-turns",
                    "1",
                ],
                cwd=repo_root,
                input="alpha turn\nbeta turn\ngamma turn\n/exit\n",
                text=True,
                capture_output=True,
                check=False,
            )

            handoff_exists = handoff_path.exists()
            handoff_content = handoff_path.read_text(encoding="utf-8") if handoff_exists else ""

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertTrue(handoff_exists)
        self.assertIn("reason: auto-exit", handoff_content)
        self.assertIn("## Recent Turns", handoff_content)

    def test_start_session_store_redis_success_persists_registry_and_history(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        redis_store: dict[str, str] = {}
        redis_commands: list[list[str]] = []

        def redis_handler(command: list[str], _request_index: int) -> tuple[list[bytes], bool]:
            redis_commands.append(command)
            if not command:
                return [_resp_error("ERR empty command")], False
            op = command[0].upper()
            if op == "GET" and len(command) >= 2:
                payload = redis_store.get(command[1])
                if payload is None:
                    return [b"$-1\r\n"], False
                return [_resp_bulk(payload)], False
            if op == "SET" and len(command) >= 3:
                redis_store[command[1]] = command[2]
                return [_resp_simple("OK")], False
            return [_resp_error("ERR unsupported command")], False

        with tempfile.TemporaryDirectory(prefix="grobot-start-redis-success-") as tmp_dir:
            root = Path(tmp_dir)
            work_dir = root / "work"
            home_dir = root / "home"
            work_dir.mkdir(parents=True, exist_ok=True)
            home_dir.mkdir(parents=True, exist_ok=True)
            config_path = root / "config.toml"
            self._write_smoke_config(config_path, work_dir)

            with FakeRedisServer(redis_handler) as fake_redis:
                result = subprocess.run(
                    [
                        "./grobot",
                        "start",
                        "--project",
                        "grobot",
                        "--work-dir",
                        str(work_dir),
                        "--home",
                        str(home_dir),
                        "--config",
                        str(config_path),
                        "--gateway-impl",
                        "ts",
                        "--runtime-impl",
                        "rust",
                        "--session-subject",
                        "redis-success-user",
                        "--session-backend",
                        "redis",
                        "--redis-url",
                        fake_redis.redis_url,
                        "--history-turns",
                        "10",
                    ],
                    cwd=repo_root,
                    input="architecture decision: keep redis session backend\n/new\n/continue main\n/exit\n",
                    text=True,
                    capture_output=True,
                    check=False,
                )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        stdout_text = result.stdout
        stderr_text = result.stderr
        self.assertIn("store:     redis", stdout_text)
        self.assertNotIn("store_fallback", stdout_text)
        self.assertNotIn("fallback", stderr_text.lower())
        self.assertIn("[rust-runtime]", stdout_text)

        self.assertTrue(any(cmd and cmd[0].upper() == "GET" for cmd in redis_commands))
        self.assertTrue(any(cmd and cmd[0].upper() == "SET" for cmd in redis_commands))

        namespace = "feishu:grobot:dm:redis-success-user"
        registry_key = f"grobot:ts-dev-cli:session-registry:v1:{quote(namespace, safe='')}"
        registry_raw = redis_store.get(registry_key)
        self.assertIsNotNone(registry_raw)
        if registry_raw is None:
            self.fail("redis registry payload missing")
        registry_payload: dict[str, Any] = json.loads(registry_raw)
        sessions_raw = registry_payload.get("sessions")
        self.assertIsInstance(sessions_raw, list)
        if not isinstance(sessions_raw, list):
            self.fail("session registry sessions must be list")
        self.assertGreaterEqual(len(sessions_raw), 2)
        sessions = [item for item in sessions_raw if isinstance(item, dict)]
        sessions_by_id = {
            str(item.get("id", "")): item
            for item in sessions
            if str(item.get("id", "")).strip()
        }
        active_id = str(registry_payload.get("active_id", ""))
        self.assertTrue(active_id)
        self.assertIn("main", sessions_by_id)
        self.assertIn(active_id, sessions_by_id)
        self.assertNotEqual(active_id, "main")

        main_session_key = str(sessions_by_id["main"].get("session_key", ""))
        active_session_key = str(sessions_by_id[active_id].get("session_key", ""))
        self.assertTrue(main_session_key)
        self.assertTrue(active_session_key)
        self.assertNotEqual(main_session_key, active_session_key)

        main_history_key = f"grobot:ts-dev-cli:session-history:v1:{quote(main_session_key, safe='')}"
        active_history_key = f"grobot:ts-dev-cli:session-history:v1:{quote(active_session_key, safe='')}"
        main_history_raw = redis_store.get(main_history_key)
        active_history_raw = redis_store.get(active_history_key)
        self.assertIsNotNone(main_history_raw)
        self.assertIsNotNone(active_history_raw)
        if main_history_raw is None or active_history_raw is None:
            self.fail("redis history payload missing")
        main_history_payload = json.loads(main_history_raw)
        active_history_payload = json.loads(active_history_raw)
        main_messages = main_history_payload.get("messages")
        active_messages = active_history_payload.get("messages")
        self.assertIsInstance(main_messages, list)
        self.assertIsInstance(active_messages, list)
        if not isinstance(main_messages, list) or not isinstance(active_messages, list):
            self.fail("redis history messages must be list")
        self.assertGreaterEqual(len(main_messages), 2)
        bridge_messages = [
            item
            for item in active_messages
            if isinstance(item, dict) and "[Session Continue Bridge]" in str(item.get("content", ""))
        ]
        self.assertTrue(bridge_messages, msg="expected /continue bridge message in active redis history")


if __name__ == "__main__":
    unittest.main(verbosity=2)
