#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

try:
    from gateway.tests.ts_contract import run_node_contract, spawn_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract, spawn_node_contract


def _resp_simple(text: str = "OK") -> bytes:
    return f"+{text}\r\n".encode("utf-8")


def _resp_error(text: str) -> bytes:
    return f"-{text}\r\n".encode("utf-8")


def _resp_bulk(text: str) -> bytes:
    data = text.encode("utf-8")
    return f"${len(data)}\r\n".encode("utf-8") + data + b"\r\n"


class FakeRedisServer:
    def __init__(
        self,
        handler: Callable[[list[str], int], tuple[list[bytes], bool]],
    ) -> None:
        self._handler = handler
        self._socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._request_index = 0
        self.host = "127.0.0.1"
        self.port = 0

    @property
    def redis_url(self) -> str:
        return f"redis://{self.host}:{self.port}/0"

    def start(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, 0))
        sock.listen()
        sock.settimeout(0.2)
        self._socket = sock
        self.port = sock.getsockname()[1]
        self._thread = threading.Thread(target=self._serve_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        sock = self._socket
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        thread = self._thread
        if thread is not None:
            thread.join(timeout=2)

    def __enter__(self) -> "FakeRedisServer":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()

    def _serve_loop(self) -> None:
        sock = self._socket
        if sock is None:
            return
        while not self._stop_event.is_set():
            try:
                conn, _ = sock.accept()
            except socket.timeout:
                continue
            except OSError:
                if self._stop_event.is_set():
                    break
                continue
            with conn:
                conn.settimeout(0.5)
                while not self._stop_event.is_set():
                    command = self._read_resp_command(conn)
                    if command is None:
                        break
                    chunks, close_after_send = self._handler(command, self._request_index)
                    self._request_index += 1
                    for chunk in chunks:
                        if not chunk:
                            continue
                        conn.sendall(chunk)
                        time.sleep(0.005)
                    if close_after_send:
                        try:
                            conn.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass
                        break

    @staticmethod
    def _read_line(conn: socket.socket) -> bytes | None:
        data = bytearray()
        while True:
            try:
                part = conn.recv(1)
            except socket.timeout:
                continue
            except OSError:
                return None
            if not part:
                return None
            data.extend(part)
            if data.endswith(b"\r\n"):
                return bytes(data[:-2])

    @staticmethod
    def _read_exact(conn: socket.socket, size: int) -> bytes | None:
        data = bytearray()
        while len(data) < size:
            try:
                part = conn.recv(size - len(data))
            except socket.timeout:
                continue
            except OSError:
                return None
            if not part:
                return None
            data.extend(part)
        return bytes(data)

    @classmethod
    def _read_resp_command(cls, conn: socket.socket) -> list[str] | None:
        line = cls._read_line(conn)
        if line is None:
            return None
        if not line.startswith(b"*"):
            return None
        try:
            count = int(line[1:].decode("utf-8"))
        except Exception:
            return None
        if count < 0:
            return None
        parts: list[str] = []
        for _ in range(count):
            header = cls._read_line(conn)
            if header is None or not header.startswith(b"$"):
                return None
            try:
                payload_len = int(header[1:].decode("utf-8"))
            except Exception:
                return None
            if payload_len < 0:
                parts.append("")
                continue
            payload = cls._read_exact(conn, payload_len)
            if payload is None:
                return None
            terminator = cls._read_exact(conn, 2)
            if terminator != b"\r\n":
                return None
            parts.append(payload.decode("utf-8"))
        return parts


class TsRustExecutionTests(unittest.TestCase):
    def _run_start_contract(self, repo_root: Path, command: str) -> dict[str, object]:
        result = run_node_contract("start-smoke-contract.mjs", command, ("--repo-root", str(repo_root)))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        self.assertIsInstance(payload, dict)
        if not isinstance(payload, dict):
            self.fail("start-smoke contract payload must be object")
        return payload

    def _run_serve_contract(self, repo_root: Path, command: str, *args: str) -> dict[str, object]:
        result = run_node_contract(
            "serve-smoke-contract.mjs",
            command,
            ("--repo-root", str(repo_root), *args),
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        self.assertIsInstance(payload, dict)
        if not isinstance(payload, dict):
            self.fail("serve-smoke contract payload must be object")
        return payload

    def test_serve_runs_via_ts_dev_cli_with_management_endpoints(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir, tempfile.TemporaryDirectory() as temp_home_dir:
            work_dir = Path(temp_work_dir)
            home_dir = Path(temp_home_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (home_dir / "config.toml").write_text(
                "\n".join(
                    [
                        '[management]',
                        'token = "raw-management-token-should-not-leak"',
                        'config_read_policy = "auth"',
                        "",
                        "[provider]",
                        'api_key = "sk-raw-provider-key-should-not-leak"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            sock.close()
            bind = f"127.0.0.1:{port}"
            token = "ts-dev-token"
            proc = spawn_node_contract(
                "serve-daemon-contract.mjs",
                "ts-dev-management-endpoints-daemon",
                (
                    "--repo-root",
                    str(repo_root),
                    "--work-dir",
                    str(work_dir),
                    "--home-dir",
                    str(home_dir),
                    "--bind",
                    bind,
                    "--management-token",
                    token,
                ),
                cwd=repo_root,
                text=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            try:
                base_url = f"http://{bind}"
                status_payload: dict[str, object] | None = None
                for _ in range(60):
                    try:
                        with urllib.request.urlopen(f"{base_url}/api/v1/status", timeout=0.5) as resp:
                            raw = resp.read().decode("utf-8")
                        status_payload = json.loads(raw)
                        break
                    except Exception:
                        time.sleep(0.1)

                self.assertIsNotNone(status_payload, "serve status endpoint not ready")
                assert status_payload is not None
                self.assertEqual(status_payload.get("engine"), "ts-dev-cli")
                self.assertEqual(status_payload.get("reload_count"), 0)
                memory_store_payload = status_payload.get("memory_store")
                self.assertIsInstance(memory_store_payload, dict)
                assert isinstance(memory_store_payload, dict)
                self.assertEqual(memory_store_payload.get("backend"), "file")
                self.assertEqual(memory_store_payload.get("requested_backend"), "file")

                with urllib.request.urlopen(f"{base_url}/healthz", timeout=1.0) as resp_healthz:
                    healthz_payload = json.loads(resp_healthz.read().decode("utf-8"))
                self.assertEqual(healthz_payload.get("status"), "ok")
                self.assertEqual(healthz_payload.get("ready"), True)

                req_config_forbidden = urllib.request.Request(
                    f"{base_url}/api/v1/config",
                    method="GET",
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_config_forbidden:
                    urllib.request.urlopen(req_config_forbidden, timeout=1.0)
                self.assertEqual(ctx_config_forbidden.exception.code, 403)

                req_config = urllib.request.Request(
                    f"{base_url}/api/v1/config",
                    method="GET",
                    headers={
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_config, timeout=1.0) as resp_config:
                    config_payload = json.loads(resp_config.read().decode("utf-8"))
                self.assertEqual(config_payload.get("status"), "ok")
                config_json = json.dumps(config_payload, ensure_ascii=False)
                self.assertNotIn("raw-management-token-should-not-leak", config_json)
                self.assertNotIn("sk-raw-provider-key-should-not-leak", config_json)
                self.assertIn("<redacted>", config_json)

                req_forbidden = urllib.request.Request(
                    f"{base_url}/api/v1/reload",
                    method="POST",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_forbidden:
                    urllib.request.urlopen(req_forbidden, timeout=1.0)
                self.assertEqual(ctx_forbidden.exception.code, 403)

                req_reload = urllib.request.Request(
                    f"{base_url}/api/v1/reload",
                    method="POST",
                    data=b"{}",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_reload, timeout=1.0) as resp_reload:
                    reload_payload = json.loads(resp_reload.read().decode("utf-8"))
                self.assertEqual(reload_payload.get("status"), "ok")
                self.assertEqual(reload_payload.get("reload_count"), 1)

                req_mcp_reset_forbidden = urllib.request.Request(
                    f"{base_url}/api/v1/mcp/reset",
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_mcp_forbidden:
                    urllib.request.urlopen(req_mcp_reset_forbidden, timeout=1.0)
                self.assertEqual(ctx_mcp_forbidden.exception.code, 403)

                req_mcp_reset = urllib.request.Request(
                    f"{base_url}/api/v1/mcp/reset",
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_mcp_reset, timeout=1.0) as resp_mcp_reset:
                    mcp_reset_payload = json.loads(resp_mcp_reset.read().decode("utf-8"))
                self.assertEqual(mcp_reset_payload.get("status"), "ok")
                self.assertEqual(mcp_reset_payload.get("scope"), "all")
                self.assertEqual(mcp_reset_payload.get("target"), "all")

                req_mcp_reset_server = urllib.request.Request(
                    f"{base_url}/api/v1/mcp/servers/ctx-project/reset",
                    method="POST",
                    headers={
                        "X-Grobot-Token": token,
                    },
                )
                with urllib.request.urlopen(req_mcp_reset_server, timeout=1.0) as resp_mcp_reset_server:
                    mcp_reset_server_payload = json.loads(resp_mcp_reset_server.read().decode("utf-8"))
                self.assertEqual(mcp_reset_server_payload.get("status"), "ok")
                self.assertEqual(mcp_reset_server_payload.get("scope"), "server")
                self.assertEqual(mcp_reset_server_payload.get("target"), "ctx-project")

                req_memory_list_forbidden = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory?limit=20",
                    method="GET",
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_memory_forbidden:
                    urllib.request.urlopen(req_memory_list_forbidden, timeout=1.0)
                self.assertEqual(ctx_memory_forbidden.exception.code, 403)

                req_memory_list = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory?limit=20",
                    method="GET",
                    headers={
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_list, timeout=1.0) as resp_memory_list:
                    memory_list_payload = json.loads(resp_memory_list.read().decode("utf-8"))
                self.assertEqual(memory_list_payload.get("status"), "ok")
                self.assertEqual(memory_list_payload.get("count"), 0)
                self.assertEqual(memory_list_payload.get("has_more"), False)
                self.assertIsInstance(memory_list_payload.get("records"), list)

                req_memory_export = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory/export?limit=20",
                    method="GET",
                    headers={
                        "X-Grobot-Token": token,
                    },
                )
                with urllib.request.urlopen(req_memory_export, timeout=1.0) as resp_memory_export:
                    memory_export_payload = json.loads(resp_memory_export.read().decode("utf-8"))
                self.assertEqual(memory_export_payload.get("status"), "ok")
                self.assertEqual(memory_export_payload.get("count"), 0)
                self.assertEqual(memory_export_payload.get("has_more"), False)
                self.assertIsInstance(memory_export_payload.get("records"), list)

                req_memory_import_forbidden = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory/import",
                    method="POST",
                    data=json.dumps({"records": [{"text": "hello"}]}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_memory_import_forbidden:
                    urllib.request.urlopen(req_memory_import_forbidden, timeout=1.0)
                self.assertEqual(ctx_memory_import_forbidden.exception.code, 403)

                req_memory_import_invalid = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory/import",
                    method="POST",
                    data=json.dumps({"records": [{"kind": "episodic"}]}).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_memory_import_invalid:
                    urllib.request.urlopen(req_memory_import_invalid, timeout=1.0)
                self.assertEqual(ctx_memory_import_invalid.exception.code, 400)
                memory_import_invalid_payload = json.loads(ctx_memory_import_invalid.exception.read().decode("utf-8"))
                self.assertEqual(memory_import_invalid_payload.get("error"), "memory_import_failed")
                self.assertEqual(memory_import_invalid_payload.get("detail_error"), "invalid_record_schema")

                req_memory_import = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory/import",
                    method="POST",
                    data=json.dumps(
                        {
                            "scope": "auto",
                            "records": [
                                {
                                    "id": "mem-1",
                                    "text": "Alpha episodic memory",
                                    "kind": "episodic",
                                    "classification": "internal",
                                    "tags": ["alpha"],
                                },
                                {
                                    "id": "mem-2",
                                    "text": "Beta policy memory",
                                    "kind": "policy",
                                    "classification": "restricted",
                                    "state": "archived",
                                },
                            ],
                        }
                    ).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_import, timeout=1.0) as resp_memory_import:
                    memory_import_payload = json.loads(resp_memory_import.read().decode("utf-8"))
                self.assertEqual(memory_import_payload.get("status"), "ok")
                self.assertEqual(memory_import_payload.get("imported_count"), 2)
                self.assertEqual(memory_import_payload.get("archived_on_import_count"), 1)

                req_memory_import_second_session = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user-2/memory/import",
                    method="POST",
                    data=json.dumps(
                        {
                            "scope": "auto",
                            "records": [
                                {
                                    "id": "mem-3",
                                    "text": "Gamma semantic memory",
                                    "kind": "semantic",
                                    "classification": "internal",
                                }
                            ],
                        }
                    ).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_import_second_session, timeout=1.0) as resp_memory_import_second_session:
                    memory_import_second_session_payload = json.loads(resp_memory_import_second_session.read().decode("utf-8"))
                self.assertEqual(memory_import_second_session_payload.get("status"), "ok")
                self.assertEqual(memory_import_second_session_payload.get("imported_count"), 1)

                memory_store_path = home_dir / "runtime" / "memory" / "ts-dev-cli-memory.json"
                self.assertTrue(memory_store_path.exists())
                memory_store_payload = json.loads(memory_store_path.read_text(encoding="utf-8"))
                sessions_payload = memory_store_payload.get("sessions")
                self.assertIsInstance(sessions_payload, dict)
                assert isinstance(sessions_payload, dict)
                self.assertIn("feishu:grobot:dm:test-user", sessions_payload)
                self.assertIn("feishu:grobot:dm:test-user-2", sessions_payload)

                req_memory_list_after_import = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory?limit=20",
                    method="GET",
                    headers={
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_list_after_import, timeout=1.0) as resp_memory_list_after_import:
                    memory_list_after_import_payload = json.loads(resp_memory_list_after_import.read().decode("utf-8"))
                self.assertEqual(memory_list_after_import_payload.get("status"), "ok")
                self.assertEqual(memory_list_after_import_payload.get("count"), 1)

                req_memory_export_after_import = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory/export?limit=20&include_archived=true&include_restricted=true",
                    method="GET",
                    headers={
                        "X-Grobot-Token": token,
                    },
                )
                with urllib.request.urlopen(req_memory_export_after_import, timeout=1.0) as resp_memory_export_after_import:
                    memory_export_after_import_payload = json.loads(resp_memory_export_after_import.read().decode("utf-8"))
                self.assertEqual(memory_export_after_import_payload.get("status"), "ok")
                self.assertEqual(memory_export_after_import_payload.get("count"), 2)
                self.assertEqual(memory_export_after_import_payload.get("has_more"), False)

                req_memory_forget = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory/forget",
                    method="POST",
                    data=json.dumps({"id": "mem-1"}).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_forget, timeout=1.0) as resp_memory_forget:
                    memory_forget_payload = json.loads(resp_memory_forget.read().decode("utf-8"))
                self.assertEqual(memory_forget_payload.get("status"), "ok")
                self.assertEqual(memory_forget_payload.get("forgotten_count"), 1)

                req_memory_list_after_forget = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory?limit=20",
                    method="GET",
                    headers={
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_list_after_forget, timeout=1.0) as resp_memory_list_after_forget:
                    memory_list_after_forget_payload = json.loads(resp_memory_list_after_forget.read().decode("utf-8"))
                self.assertEqual(memory_list_after_forget_payload.get("status"), "ok")
                self.assertEqual(memory_list_after_forget_payload.get("count"), 0)

                req_memory_lifecycle = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory/lifecycle",
                    method="POST",
                    data=json.dumps({"dry_run": True}).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_lifecycle, timeout=1.0) as resp_memory_lifecycle:
                    memory_lifecycle_payload = json.loads(resp_memory_lifecycle.read().decode("utf-8"))
                self.assertEqual(memory_lifecycle_payload.get("status"), "ok")
                lifecycle_lines = memory_lifecycle_payload.get("lines")
                self.assertIsInstance(lifecycle_lines, list)
                assert isinstance(lifecycle_lines, list)
                self.assertTrue(any("memory lifecycle: dry_run=on" in str(line) for line in lifecycle_lines))

                req_memory_lifecycle_run_missing_targets = urllib.request.Request(
                    f"{base_url}/api/v1/memory/lifecycle/run",
                    method="POST",
                    data=json.dumps({"dry_run": True}).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_memory_lifecycle_run_missing_targets:
                    urllib.request.urlopen(req_memory_lifecycle_run_missing_targets, timeout=1.0)
                self.assertEqual(ctx_memory_lifecycle_run_missing_targets.exception.code, 400)
                memory_lifecycle_run_missing_targets_payload = json.loads(
                    ctx_memory_lifecycle_run_missing_targets.exception.read().decode("utf-8")
                )
                self.assertEqual(memory_lifecycle_run_missing_targets_payload.get("error"), "no_target_sessions")

                req_memory_lifecycle_run = urllib.request.Request(
                    f"{base_url}/api/v1/memory/lifecycle/run",
                    method="POST",
                    data=json.dumps(
                        {
                            "dry_run": True,
                            "sessions": [
                                "feishu:grobot:dm:test-user",
                                "feishu:grobot:dm:test-user-2",
                            ],
                        }
                    ).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                with urllib.request.urlopen(req_memory_lifecycle_run, timeout=1.0) as resp_memory_lifecycle_run:
                    memory_lifecycle_run_payload = json.loads(resp_memory_lifecycle_run.read().decode("utf-8"))
                self.assertEqual(memory_lifecycle_run_payload.get("status"), "ok")
                self.assertEqual(memory_lifecycle_run_payload.get("requested_count"), 2)
                self.assertEqual(memory_lifecycle_run_payload.get("success_count"), 2)
                self.assertEqual(memory_lifecycle_run_payload.get("failed_count"), 0)
                self.assertIsInstance(memory_lifecycle_run_payload.get("results"), list)

                req_memory_invalid_scope = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/memory?scope=invalid",
                    method="GET",
                    headers={
                        "Authorization": f"Bearer {token}",
                    },
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_memory_invalid_scope:
                    urllib.request.urlopen(req_memory_invalid_scope, timeout=1.0)
                self.assertEqual(ctx_memory_invalid_scope.exception.code, 400)
                invalid_scope_payload = json.loads(ctx_memory_invalid_scope.exception.read().decode("utf-8"))
                self.assertEqual(invalid_scope_payload.get("error"), "invalid_scope")

                session_id = "feishu:grobot:dm:test-user"
                req_interrupt = urllib.request.Request(
                    f"{base_url}/api/v1/sessions/feishu%3Agrobot%3Adm%3Atest-user/interrupt",
                    method="POST",
                    data=b'{"ttl_secs":120}',
                    headers={
                        "Content-Type": "application/json",
                        "X-Grobot-Token": token,
                    },
                )
                with urllib.request.urlopen(req_interrupt, timeout=1.0) as resp_interrupt:
                    interrupt_payload = json.loads(resp_interrupt.read().decode("utf-8"))
                self.assertEqual(interrupt_payload.get("status"), "ok")
                self.assertEqual(interrupt_payload.get("session_id"), session_id)
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=3)

    def test_serve_config_read_policy_auto_is_public_on_loopback(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir, tempfile.TemporaryDirectory() as temp_home_dir:
            work_dir = Path(temp_work_dir)
            home_dir = Path(temp_home_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (home_dir / "config.toml").write_text(
                "\n".join(
                    [
                        "[management]",
                        'token = "ops-token"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            sock.close()
            bind = f"127.0.0.1:{port}"
            payload = self._run_serve_contract(
                repo_root,
                "config-read-policy-auto",
                "--work-dir",
                str(work_dir),
                "--home-dir",
                str(home_dir),
                "--bind",
                bind,
            )
            self.assertTrue(payload.get("ready"))

            status_endpoint = payload.get("status_endpoint")
            self.assertIsInstance(status_endpoint, dict)
            assert isinstance(status_endpoint, dict)
            self.assertEqual(status_endpoint.get("status"), 200)
            status_body = status_endpoint.get("body")
            self.assertIsInstance(status_body, dict)
            assert isinstance(status_body, dict)
            management_auth = status_body.get("management_auth")
            self.assertIsInstance(management_auth, dict)
            assert isinstance(management_auth, dict)
            self.assertEqual(management_auth.get("config_read_policy"), "public")
            self.assertEqual(management_auth.get("config_read_policy_configured"), "auto")

            config_endpoint = payload.get("config_endpoint")
            self.assertIsInstance(config_endpoint, dict)
            assert isinstance(config_endpoint, dict)
            self.assertEqual(config_endpoint.get("status"), 200)
            config_body = config_endpoint.get("body")
            self.assertIsInstance(config_body, dict)
            assert isinstance(config_body, dict)
            self.assertEqual(config_body.get("status"), "ok")

    def test_serve_session_store_redis_fallbacks_to_file_when_unavailable(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            sock.close()
            bind = f"127.0.0.1:{port}"
            payload = self._run_serve_contract(
                repo_root,
                "session-store-redis-unavailable",
                "--work-dir",
                str(work_dir),
                "--bind",
                bind,
                "--management-token",
                "fallback-token",
                "--redis-url",
                "redis://127.0.0.1:1/0",
            )
            self.assertTrue(payload.get("ready"))

            status_endpoint = payload.get("status_endpoint")
            self.assertIsInstance(status_endpoint, dict)
            assert isinstance(status_endpoint, dict)
            self.assertEqual(status_endpoint.get("status"), 200)
            status_body = status_endpoint.get("body")
            self.assertIsInstance(status_body, dict)
            assert isinstance(status_body, dict)
            memory_store_payload = status_body.get("memory_store")
            self.assertIsInstance(memory_store_payload, dict)
            assert isinstance(memory_store_payload, dict)
            self.assertEqual(memory_store_payload.get("requested_backend"), "redis")
            self.assertEqual(memory_store_payload.get("backend"), "file")
            fallback_reason = str(memory_store_payload.get("fallback_reason") or "")
            self.assertIn("redis bootstrap failed", fallback_reason)

    def test_serve_session_store_redis_bootstrap_supports_chunked_bulk_reply(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            session_id = "feishu:grobot:dm:test-user"
            memory_payload = json.dumps(
                {
                    "version": 1,
                    "sessions": {
                        session_id: [
                            {
                                "id": "mem-chunked",
                                "text": "Chunked bootstrap memory",
                                "kind": "episodic",
                                "classification": "internal",
                                "state": "active",
                            }
                        ]
                    },
                }
            )
            bulk = _resp_bulk(memory_payload)

            def handler(command: list[str], _request_index: int) -> tuple[list[bytes], bool]:
                if command and command[0] == "GET":
                    return [bulk[:7], bulk[7:17], bulk[17:]], False
                return [_resp_simple()], False

            with FakeRedisServer(handler) as fake_redis:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                sock.close()
                bind = f"127.0.0.1:{port}"
                token = "chunked-token"
                payload = self._run_serve_contract(
                    repo_root,
                    "session-store-redis-status-and-memory-list",
                    "--work-dir",
                    str(work_dir),
                    "--bind",
                    bind,
                    "--management-token",
                    token,
                    "--redis-url",
                    fake_redis.redis_url,
                    "--session-id",
                    session_id,
                )
                self.assertTrue(payload.get("ready"))

                status_endpoint = payload.get("status_endpoint")
                self.assertIsInstance(status_endpoint, dict)
                assert isinstance(status_endpoint, dict)
                self.assertEqual(status_endpoint.get("status"), 200)
                status_body = status_endpoint.get("body")
                self.assertIsInstance(status_body, dict)
                assert isinstance(status_body, dict)
                memory_store_payload = status_body.get("memory_store")
                self.assertIsInstance(memory_store_payload, dict)
                assert isinstance(memory_store_payload, dict)
                self.assertEqual(memory_store_payload.get("requested_backend"), "redis")
                self.assertEqual(memory_store_payload.get("backend"), "redis")
                self.assertIsNone(memory_store_payload.get("fallback_reason"))
                self.assertEqual(memory_store_payload.get("session_count"), 1)

                memory_list_endpoint = payload.get("memory_list_endpoint")
                self.assertIsInstance(memory_list_endpoint, dict)
                assert isinstance(memory_list_endpoint, dict)
                self.assertEqual(memory_list_endpoint.get("status"), 200)
                memory_list_body = memory_list_endpoint.get("body")
                self.assertIsInstance(memory_list_body, dict)
                assert isinstance(memory_list_body, dict)
                self.assertEqual(memory_list_body.get("status"), "ok")
                self.assertEqual(memory_list_body.get("count"), 1)

    def test_serve_session_store_redis_fallbacks_to_file_on_array_reply(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            def handler(command: list[str], _request_index: int) -> tuple[list[bytes], bool]:
                if command and command[0] == "GET":
                    return [b"*2\r\n$5\r\nalpha\r\n$4\r\nbeta\r\n"], False
                return [_resp_simple()], False

            with FakeRedisServer(handler) as fake_redis:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                sock.close()
                bind = f"127.0.0.1:{port}"
                payload = self._run_serve_contract(
                    repo_root,
                    "session-store-redis-unavailable",
                    "--work-dir",
                    str(work_dir),
                    "--bind",
                    bind,
                    "--management-token",
                    "array-token",
                    "--redis-url",
                    fake_redis.redis_url,
                )
                self.assertTrue(payload.get("ready"))

                status_endpoint = payload.get("status_endpoint")
                self.assertIsInstance(status_endpoint, dict)
                assert isinstance(status_endpoint, dict)
                self.assertEqual(status_endpoint.get("status"), 200)
                status_body = status_endpoint.get("body")
                self.assertIsInstance(status_body, dict)
                assert isinstance(status_body, dict)
                memory_store_payload = status_body.get("memory_store")
                self.assertIsInstance(memory_store_payload, dict)
                assert isinstance(memory_store_payload, dict)
                self.assertEqual(memory_store_payload.get("requested_backend"), "redis")
                self.assertEqual(memory_store_payload.get("backend"), "file")
                fallback_reason = str(memory_store_payload.get("fallback_reason") or "")
                self.assertIn("non-string payload", fallback_reason)

    def test_serve_session_store_redis_fallbacks_to_file_on_error_reply(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            def handler(command: list[str], _request_index: int) -> tuple[list[bytes], bool]:
                if command and command[0] == "GET":
                    return [_resp_error("ERR simulated-bootstrap-failure")], False
                return [_resp_simple()], False

            with FakeRedisServer(handler) as fake_redis:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                sock.close()
                bind = f"127.0.0.1:{port}"
                payload = self._run_serve_contract(
                    repo_root,
                    "session-store-redis-unavailable",
                    "--work-dir",
                    str(work_dir),
                    "--bind",
                    bind,
                    "--management-token",
                    "error-token",
                    "--redis-url",
                    fake_redis.redis_url,
                )
                self.assertTrue(payload.get("ready"))

                status_endpoint = payload.get("status_endpoint")
                self.assertIsInstance(status_endpoint, dict)
                assert isinstance(status_endpoint, dict)
                self.assertEqual(status_endpoint.get("status"), 200)
                status_body = status_endpoint.get("body")
                self.assertIsInstance(status_body, dict)
                assert isinstance(status_body, dict)
                memory_store_payload = status_body.get("memory_store")
                self.assertIsInstance(memory_store_payload, dict)
                assert isinstance(memory_store_payload, dict)
                self.assertEqual(memory_store_payload.get("requested_backend"), "redis")
                self.assertEqual(memory_store_payload.get("backend"), "file")
                fallback_reason = str(memory_store_payload.get("fallback_reason") or "")
                self.assertIn("redis error reply", fallback_reason)

    def test_serve_session_store_redis_fallbacks_to_file_on_incomplete_bulk_reply(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            truncated_bulk = b"$18\r\n{\"version\":1"

            def handler(command: list[str], _request_index: int) -> tuple[list[bytes], bool]:
                if command and command[0] == "GET":
                    return [truncated_bulk], True
                return [_resp_simple()], False

            with FakeRedisServer(handler) as fake_redis:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                sock.close()
                bind = f"127.0.0.1:{port}"
                payload = self._run_serve_contract(
                    repo_root,
                    "session-store-redis-unavailable",
                    "--work-dir",
                    str(work_dir),
                    "--bind",
                    bind,
                    "--management-token",
                    "incomplete-token",
                    "--redis-url",
                    fake_redis.redis_url,
                )
                self.assertTrue(payload.get("ready"))

                status_endpoint = payload.get("status_endpoint")
                self.assertIsInstance(status_endpoint, dict)
                assert isinstance(status_endpoint, dict)
                self.assertEqual(status_endpoint.get("status"), 200)
                status_body = status_endpoint.get("body")
                self.assertIsInstance(status_body, dict)
                assert isinstance(status_body, dict)
                memory_store_payload = status_body.get("memory_store")
                self.assertIsInstance(memory_store_payload, dict)
                assert isinstance(memory_store_payload, dict)
                self.assertEqual(memory_store_payload.get("requested_backend"), "redis")
                self.assertEqual(memory_store_payload.get("backend"), "file")
                fallback_reason = str(memory_store_payload.get("fallback_reason") or "")
                self.assertIn("connection closed before full reply", fallback_reason)

    def test_memory_lifecycle_run_returns_error_when_redis_persist_fails(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            session_id = "feishu:grobot:dm:lifecycle-user"
            memory_payload = json.dumps(
                {
                    "version": 1,
                    "sessions": {
                        session_id: [
                            {
                                "id": "mem-promote-1",
                                "text": "High confidence memory",
                                "kind": "episodic",
                                "classification": "internal",
                                "state": "active",
                                "importance": 0.95,
                                "confidence": 0.95,
                            }
                        ]
                    },
                }
            )

            def handler(command: list[str], _request_index: int) -> tuple[list[bytes], bool]:
                if command and command[0] == "GET":
                    return [_resp_bulk(memory_payload)], False
                if command and command[0] == "SET":
                    return [_resp_error("ERR readonly-store")], False
                return [_resp_simple()], False

            with FakeRedisServer(handler) as fake_redis:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                sock.close()
                bind = f"127.0.0.1:{port}"
                token = "lifecycle-token"
                payload = self._run_serve_contract(
                    repo_root,
                    "memory-lifecycle-run-error",
                    "--work-dir",
                    str(work_dir),
                    "--bind",
                    bind,
                    "--management-token",
                    token,
                    "--redis-url",
                    fake_redis.redis_url,
                    "--session-id",
                    session_id,
                )
                self.assertTrue(payload.get("ready"))

                status_endpoint = payload.get("status_endpoint")
                self.assertIsInstance(status_endpoint, dict)
                assert isinstance(status_endpoint, dict)
                self.assertEqual(status_endpoint.get("status"), 200)
                status_body = status_endpoint.get("body")
                self.assertIsInstance(status_body, dict)
                assert isinstance(status_body, dict)
                memory_store_payload = status_body.get("memory_store")
                self.assertIsInstance(memory_store_payload, dict)
                assert isinstance(memory_store_payload, dict)
                self.assertEqual(memory_store_payload.get("backend"), "redis")

                lifecycle_run_endpoint = payload.get("lifecycle_run_endpoint")
                self.assertIsInstance(lifecycle_run_endpoint, dict)
                assert isinstance(lifecycle_run_endpoint, dict)
                self.assertEqual(lifecycle_run_endpoint.get("status"), 400)
                lifecycle_run_body = lifecycle_run_endpoint.get("body")
                self.assertIsInstance(lifecycle_run_body, dict)
                assert isinstance(lifecycle_run_body, dict)
                self.assertEqual(lifecycle_run_body.get("error"), "memory_lifecycle_failed")
                self.assertEqual(lifecycle_run_body.get("detail_error"), "memory_store_persist_failed")
                self.assertIn("redis error reply", str(lifecycle_run_body.get("detail", "")))

    def test_status_prefers_ts_dev_cli_in_source_checkout(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_start_contract(repo_root, "status-ts-rust")
        self.assertEqual(payload.get("exit_code"), 0, msg=str(payload.get("stderr", "")))
        self.assertIn("engine: ts-dev-cli", str(payload.get("stdout", "")))
        self.assertIn("execution: gateway=ts(cli) runtime=rust(cli)", str(payload.get("stdout", "")))

    def test_source_checkout_reports_deprecated_ts_dev_flag(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_start_contract(repo_root, "status-ts-rust-deprecated-flag")
        self.assertEqual(payload.get("exit_code"), 0, msg=str(payload.get("stderr", "")))
        self.assertIn("engine: ts-dev-cli", str(payload.get("stdout", "")))
        self.assertIn("--ts-dev-cli is deprecated", str(payload.get("stderr", "")))

    def test_source_checkout_rejects_legacy_python_flag(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_start_contract(repo_root, "status-reject-legacy-flag")
        self.assertEqual(payload.get("exit_code"), 2)
        self.assertIn("legacy python execution path is removed", str(payload.get("stderr", "")))

    def test_source_checkout_rejects_python_gateway_impl(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_start_contract(repo_root, "status-reject-python-gateway")
        self.assertEqual(payload.get("exit_code"), 2)
        self.assertIn("legacy python execution path is removed", str(payload.get("stderr", "")))

    def test_source_checkout_rejects_legacy_python_env(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_start_contract(repo_root, "status-reject-legacy-env")
        self.assertEqual(payload.get("exit_code"), 2)
        self.assertIn("legacy python execution path is removed", str(payload.get("stderr", "")))

    def test_serve_config_read_policy_disabled_blocks_config_endpoint(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            (work_dir / ".grobot" / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            sock.close()
            bind = f"127.0.0.1:{port}"
            token = "disabled-policy-token"
            payload = self._run_serve_contract(
                repo_root,
                "config-read-policy-disabled",
                "--work-dir",
                str(work_dir),
                "--bind",
                bind,
                "--management-token",
                token,
            )
            self.assertTrue(payload.get("ready"))

            status_endpoint = payload.get("status_endpoint")
            self.assertIsInstance(status_endpoint, dict)
            assert isinstance(status_endpoint, dict)
            self.assertEqual(status_endpoint.get("status"), 200)

            config_endpoint = payload.get("config_endpoint")
            self.assertIsInstance(config_endpoint, dict)
            assert isinstance(config_endpoint, dict)
            self.assertEqual(config_endpoint.get("status"), 403)
            config_body = config_endpoint.get("body")
            self.assertIsInstance(config_body, dict)
            assert isinstance(config_body, dict)
            self.assertIn("disabled", str(config_body.get("detail", "")))

    def test_reload_refreshes_memory_store_runtime_from_project_toml(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir:
            work_dir = Path(temp_work_dir)
            project_toml_path = work_dir / ".grobot" / "project.toml"
            (work_dir / ".grobot").mkdir(parents=True, exist_ok=True)
            project_toml_path.write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[execution]",
                        'gateway_impl = "ts"',
                        'runtime_impl = "rust"',
                        "shadow_mode = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            def handler(command: list[str], _request_index: int) -> tuple[list[bytes], bool]:
                if command and command[0] == "GET":
                    return [b"$-1\r\n"], False
                return [_resp_simple()], False

            with FakeRedisServer(handler) as fake_redis:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                sock.close()
                bind = f"127.0.0.1:{port}"
                token = "reload-memory-store-token"
                payload = self._run_serve_contract(
                    repo_root,
                    "reload-memory-store-from-project-toml",
                    "--work-dir",
                    str(work_dir),
                    "--bind",
                    bind,
                    "--management-token",
                    token,
                    "--redis-url",
                    fake_redis.redis_url,
                    "--project-toml-path",
                    str(project_toml_path),
                )
                self.assertTrue(payload.get("ready"))

                status_before = payload.get("status_before")
                self.assertIsInstance(status_before, dict)
                assert isinstance(status_before, dict)
                self.assertEqual(status_before.get("status"), 200)
                status_before_body = status_before.get("body")
                self.assertIsInstance(status_before_body, dict)
                assert isinstance(status_before_body, dict)
                memory_store_payload = status_before_body.get("memory_store")
                self.assertIsInstance(memory_store_payload, dict)
                assert isinstance(memory_store_payload, dict)
                self.assertEqual(memory_store_payload.get("backend"), "file")
                self.assertEqual(memory_store_payload.get("requested_backend"), "file")

                reload_endpoint = payload.get("reload_endpoint")
                self.assertIsInstance(reload_endpoint, dict)
                assert isinstance(reload_endpoint, dict)
                self.assertEqual(reload_endpoint.get("status"), 200)
                reload_body = reload_endpoint.get("body")
                self.assertIsInstance(reload_body, dict)
                assert isinstance(reload_body, dict)
                self.assertEqual(reload_body.get("status"), "ok")
                self.assertEqual(reload_body.get("reload_count"), 1)
                reload_memory_store_payload = reload_body.get("memory_store")
                self.assertIsInstance(reload_memory_store_payload, dict)
                assert isinstance(reload_memory_store_payload, dict)
                self.assertEqual(reload_memory_store_payload.get("backend"), "redis")
                self.assertEqual(reload_memory_store_payload.get("requested_backend"), "redis")
                self.assertEqual(reload_memory_store_payload.get("source"), f"project_toml:{project_toml_path}")
                self.assertIsNone(reload_memory_store_payload.get("fallback_reason"))

                status_after = payload.get("status_after")
                self.assertIsInstance(status_after, dict)
                assert isinstance(status_after, dict)
                self.assertEqual(status_after.get("status"), 200)
                status_after_body = status_after.get("body")
                self.assertIsInstance(status_after_body, dict)
                assert isinstance(status_after_body, dict)
                memory_store_after_reload = status_after_body.get("memory_store")
                self.assertIsInstance(memory_store_after_reload, dict)
                assert isinstance(memory_store_after_reload, dict)
                self.assertEqual(memory_store_after_reload.get("backend"), "redis")
                self.assertEqual(memory_store_after_reload.get("requested_backend"), "redis")

    def test_start_message_runs_via_ts_gateway_and_rust_runtime(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        payload = self._run_start_contract(repo_root, "start-message-smoke")
        self.assertEqual(payload.get("exit_code"), 0, msg=str(payload.get("stderr", "")))
        self.assertIn("[rust-runtime]", str(payload.get("stdout", "")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
