#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


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


class SessionStoreFallbackTests(unittest.TestCase):
    def test_load_history_fallbacks_to_file_when_redis_read_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            store = grobot_cli.SessionStoreConfig(
                backend="redis",
                redis_url="redis://127.0.0.1:6379/0",
                ttl_secs=1800,
                root=root / ".grobot" / "sessions",
            )
            session_key = "feishu:test:dm:workspace"
            file_path = grobot_cli.session_file_path(store, session_key)
            grobot_cli.write_json_file(
                file_path,
                {
                    "version": 1,
                    "messages": [
                        {"role": "user", "content": "hello"},
                        {"role": "assistant", "content": "hi"},
                    ],
                },
            )

            with mock.patch.object(grobot_cli, "redis_get_json", side_effect=RuntimeError("redis down")):
                messages, source, warnings = grobot_cli.load_history_from_store(
                    store,
                    session_key,
                    max_turns=12,
                )

            self.assertEqual(source, "file")
            self.assertEqual(len(messages), 2)
            self.assertTrue(any("redis read failed" in item for item in warnings))

    def test_save_history_fallbacks_to_file_when_redis_write_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            store = grobot_cli.SessionStoreConfig(
                backend="redis",
                redis_url="redis://127.0.0.1:6379/0",
                ttl_secs=1800,
                root=root / ".grobot" / "sessions",
            )
            session_key = "feishu:test:dm:workspace"
            history = [
                {"role": "user", "content": "r1"},
                {"role": "assistant", "content": "a1"},
            ]

            with mock.patch.object(grobot_cli, "redis_set_json", side_effect=RuntimeError("redis down")):
                warnings = grobot_cli.save_history_to_store(
                    store,
                    session_key,
                    history,
                    max_turns=12,
                )

            file_path = grobot_cli.session_file_path(store, session_key)
            persisted = grobot_cli.read_json_file(file_path)
            self.assertIsInstance(persisted, dict)
            if isinstance(persisted, dict):
                messages = persisted.get("messages")
                self.assertIsInstance(messages, list)
                self.assertEqual(len(messages), 2)
            self.assertTrue(any("redis write failed" in item for item in warnings))


if __name__ == "__main__":
    unittest.main(verbosity=2)
