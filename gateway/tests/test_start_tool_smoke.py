#!/usr/bin/env python3
from __future__ import annotations

import json
import unittest
from pathlib import Path

try:
    from gateway.tests.ts_contract import run_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract


class StartToolSmokeTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
