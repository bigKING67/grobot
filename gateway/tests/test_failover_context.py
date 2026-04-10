#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar


class FailingProviderHandler(BaseHTTPRequestHandler):
    requests: ClassVar[list[dict[str, Any]]] = []

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _read_json(self) -> dict[str, Any]:
        raw_len = self.headers.get("Content-Length", "0")
        length = int(raw_len)
        body = self.rfile.read(length) if length > 0 else b"{}"
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("payload must be object")
        return payload

    def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/chat/completions":
            self._write_json(404, {"error": "not_found"})
            return
        payload = self._read_json()
        self.__class__.requests.append(payload)
        self._write_json(500, {"error": "provider_down", "detail": "simulated failure"})


class SuccessProviderHandler(BaseHTTPRequestHandler):
    requests: ClassVar[list[dict[str, Any]]] = []

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _read_json(self) -> dict[str, Any]:
        raw_len = self.headers.get("Content-Length", "0")
        length = int(raw_len)
        body = self.rfile.read(length) if length > 0 else b"{}"
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("payload must be object")
        return payload

    def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/chat/completions":
            self._write_json(404, {"error": "not_found"})
            return
        payload = self._read_json()
        self.__class__.requests.append(payload)
        turn = len(self.__class__.requests)
        self._write_json(
            200,
            {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": f"success_turn_{turn}",
                        }
                    }
                ]
            },
        )


class FailoverContextTests(unittest.TestCase):
    def test_failover_keeps_session_history_between_turns(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        FailingProviderHandler.requests = []
        SuccessProviderHandler.requests = []

        with tempfile.TemporaryDirectory() as temp_work_dir, tempfile.TemporaryDirectory() as temp_cfg_dir:
            work_dir = Path(temp_work_dir)
            cfg_path = Path(temp_cfg_dir) / "config.toml"
            (work_dir / "docs").mkdir(parents=True, exist_ok=True)
            (work_dir / "docs" / "session.md").write_text("# session\n", encoding="utf-8")

            failing_server = ThreadingHTTPServer(("127.0.0.1", 0), FailingProviderHandler)
            success_server = ThreadingHTTPServer(("127.0.0.1", 0), SuccessProviderHandler)
            fail_host, fail_port = failing_server.server_address
            success_host, success_port = success_server.server_address
            failing_url = f"http://{fail_host}:{fail_port}/v1"
            success_url = f"http://{success_host}:{success_port}/v1"
            fail_thread = threading.Thread(target=failing_server.serve_forever, daemon=True)
            success_thread = threading.Thread(target=success_server.serve_forever, daemon=True)
            fail_thread.start()
            success_thread.start()

            try:
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
                            'provider = "failing"',
                            "",
                            "[projects.agent.options]",
                            f'work_dir = "{work_dir}"',
                            'mode = "default"',
                            "",
                            "[[projects.agent.providers]]",
                            'name = "failing"',
                            'api_key = "failing-key"',
                            f'base_url = "{failing_url}"',
                            'model = "failing-model"',
                            "",
                            "[[projects.agent.providers]]",
                            'name = "success"',
                            'api_key = "success-key"',
                            f'base_url = "{success_url}"',
                            'model = "success-model"',
                            "",
                            "[[projects.platforms]]",
                            'type = "feishu"',
                            "",
                            "[projects.platforms.options]",
                            'app_id = "x"',
                            'app_secret = "y"',
                        ]
                    ),
                    encoding="utf-8",
                )

                first = subprocess.run(
                    [
                        "./grobot",
                        "start",
                        "--project",
                        "grobot",
                        "--work-dir",
                        str(work_dir),
                        "--config",
                        str(cfg_path),
                        "--session-backend",
                        "file",
                        "--provider",
                        "failing",
                        "--message",
                        "第一轮：请记住关键词 alpha",
                    ],
                    cwd=str(repo_root),
                    text=True,
                    capture_output=True,
                    check=False,
                )
                second = subprocess.run(
                    [
                        "./grobot",
                        "start",
                        "--project",
                        "grobot",
                        "--work-dir",
                        str(work_dir),
                        "--config",
                        str(cfg_path),
                        "--session-backend",
                        "file",
                        "--provider",
                        "failing",
                        "--message",
                        "第二轮：请复述上一轮关键词",
                    ],
                    cwd=str(repo_root),
                    text=True,
                    capture_output=True,
                    check=False,
                )
            finally:
                failing_server.shutdown()
                success_server.shutdown()
                failing_server.server_close()
                success_server.server_close()
                fail_thread.join(timeout=2)
                success_thread.join(timeout=2)

            self.assertEqual(first.returncode, 0, msg=first.stderr)
            self.assertEqual(second.returncode, 0, msg=second.stderr)
            self.assertIn("success_turn_1", first.stdout)
            self.assertIn("success_turn_2", second.stdout)
            self.assertIn("[failover]", first.stderr)
            self.assertIn("[failover]", second.stderr)

            self.assertGreaterEqual(len(FailingProviderHandler.requests), 2)
            self.assertGreaterEqual(len(SuccessProviderHandler.requests), 2)

            second_success = SuccessProviderHandler.requests[1]
            second_messages = second_success.get("messages")
            self.assertIsInstance(second_messages, list)
            if isinstance(second_messages, list):
                user_contents = [
                    item.get("content")
                    for item in second_messages
                    if isinstance(item, dict) and item.get("role") == "user"
                ]
                assistant_contents = [
                    item.get("content")
                    for item in second_messages
                    if isinstance(item, dict) and item.get("role") == "assistant"
                ]
                self.assertTrue(any("第一轮：请记住关键词 alpha" in str(item) for item in user_contents))
                self.assertTrue(any("success_turn_1" in str(item) for item in assistant_contents))
                self.assertTrue(any("第二轮：请复述上一轮关键词" in str(item) for item in user_contents))


if __name__ == "__main__":
    unittest.main(verbosity=2)
