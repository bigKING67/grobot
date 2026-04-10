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


class FakeModelHandler(BaseHTTPRequestHandler):
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

        messages = payload.get("messages")
        has_tool_result = False
        if isinstance(messages, list):
            has_tool_result = any(
                isinstance(item, dict) and item.get("role") == "tool"
                for item in messages
            )

        if not has_tool_result:
            self._write_json(
                200,
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [
                                    {
                                        "id": "call_write_1",
                                        "type": "function",
                                        "function": {
                                            "name": "write",
                                            "arguments": json.dumps(
                                                {"path": "smoke-note.txt", "content": "hello from smoke tool"},
                                                ensure_ascii=False,
                                            ),
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                },
            )
            return

        self._write_json(
            200,
            {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "smoke_tool_ok",
                        }
                    }
                ]
            },
        )


class StartToolSmokeTests(unittest.TestCase):
    def test_start_message_runs_tool_call_and_writes_file(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        FakeModelHandler.requests = []

        with tempfile.TemporaryDirectory() as temp_work_dir, tempfile.TemporaryDirectory() as temp_cfg_dir:
            work_dir = Path(temp_work_dir)
            cfg_path = Path(temp_cfg_dir) / "config.toml"
            (work_dir / "docs").mkdir(parents=True, exist_ok=True)
            (work_dir / "docs" / "note.md").write_text("# smoke\n", encoding="utf-8")

            server = ThreadingHTTPServer(("127.0.0.1", 0), FakeModelHandler)
            host, port = server.server_address
            server_url = f"http://{host}:{port}/v1"
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

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
                            'provider = "mock"',
                            "",
                            "[projects.agent.options]",
                            f'work_dir = "{work_dir}"',
                            'mode = "default"',
                            "",
                            "[[projects.agent.providers]]",
                            'name = "mock"',
                            'api_key = "mock-key"',
                            f'base_url = "{server_url}"',
                            'model = "mock-model"',
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

                result = subprocess.run(
                    [
                        "./grobot",
                        "start",
                        "--project",
                        "grobot",
                        "--work-dir",
                        str(work_dir),
                        "--config",
                        str(cfg_path),
                        "--message",
                        "请先看@docs/note.md，然后创建一个 smoke-note.txt 文件并写入 hello",
                    ],
                    cwd=str(repo_root),
                    text=True,
                    capture_output=True,
                    check=False,
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertIn("smoke_tool_ok", result.stdout)

            note_path = work_dir / "smoke-note.txt"
            self.assertTrue(note_path.exists(), "tool write file should exist")
            self.assertEqual(note_path.read_text(encoding="utf-8"), "hello from smoke tool")

            self.assertGreaterEqual(len(FakeModelHandler.requests), 2)
            first_req = FakeModelHandler.requests[0]
            first_messages = first_req.get("messages")
            self.assertIsInstance(first_messages, list)
            if isinstance(first_messages, list):
                user_messages = [
                    item.get("content")
                    for item in first_messages
                    if isinstance(item, dict) and item.get("role") == "user"
                ]
                self.assertTrue(any("[Resolved @file mentions]" in str(msg) for msg in user_messages))
                self.assertTrue(any("@docs/note.md => docs/note.md" in str(msg) for msg in user_messages))
            first_tools = first_req.get("tools")
            self.assertIsInstance(first_tools, list)
            function_names: list[str] = []
            if isinstance(first_tools, list):
                for item in first_tools:
                    if not isinstance(item, dict):
                        continue
                    fn = item.get("function")
                    if isinstance(fn, dict) and isinstance(fn.get("name"), str):
                        function_names.append(fn["name"])
            self.assertIn("read", function_names)
            self.assertIn("list", function_names)
            self.assertIn("glob", function_names)
            self.assertIn("search", function_names)
            self.assertIn("write", function_names)
            self.assertIn("edit", function_names)
            self.assertIn("bash", function_names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
