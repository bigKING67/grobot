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


def run_session_store_contract(command: str, root: Path) -> subprocess.CompletedProcess[str]:
    return run_node_contract("session-store-contract.mjs", command, ("--root", str(root)))


class SessionStoreFallbackTests(unittest.TestCase):
    def test_load_history_fallbacks_to_file_when_redis_read_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            result = run_session_store_contract("load-fallback-scenario", root)
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            messages = payload["messages"]
            source = payload["source"]
            warnings = payload["warnings"]
            self.assertEqual(source, "file")
            self.assertEqual(len(messages), 2)
            self.assertTrue(any("redis read failed" in item for item in warnings))

    def test_save_history_fallbacks_to_file_when_redis_write_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            result = run_session_store_contract("save-fallback-scenario", root)
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            warnings = payload["warnings"]
            persisted = payload["persisted"]
            self.assertIsInstance(persisted, dict)
            if isinstance(persisted, dict):
                messages = persisted.get("messages")
                self.assertIsInstance(messages, list)
                self.assertEqual(len(messages), 2)
            self.assertTrue(any("redis write failed" in item for item in warnings))


if __name__ == "__main__":
    unittest.main(verbosity=2)
