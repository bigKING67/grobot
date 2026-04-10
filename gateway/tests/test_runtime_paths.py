#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
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


class RuntimePathsTests(unittest.TestCase):
    def test_resolve_runtime_paths_uses_home_and_repo_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_work_dir:
            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=temp_work_dir,
                config_override=None,
                home_override=temp_home,
                project_root_override=None,
            )

            expected_repo_root = Path(__file__).resolve().parents[2]
            self.assertEqual(paths.home, Path(temp_home).resolve())
            self.assertEqual(paths.project_root, expected_repo_root.resolve())
            self.assertEqual(paths.project_toml, expected_repo_root.resolve() / ".grobot" / "project.toml")
            self.assertEqual(paths.config_toml, Path(temp_home).resolve() / "config.toml")
            self.assertEqual(paths.sessions_dir, Path(temp_home).resolve() / "runtime" / "sessions")

    def test_resolve_runtime_paths_discovers_project_from_work_dir(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "schema_version = 1\nmode = \"mvp\"\n",
                encoding="utf-8",
            )

            nested_work_dir = project_root / "apps" / "backend"
            nested_work_dir.mkdir(parents=True, exist_ok=True)

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(nested_work_dir),
                config_override=None,
                home_override=temp_home,
                project_root_override=None,
            )

            self.assertEqual(paths.project_root, project_root.resolve())
            self.assertEqual(paths.project_toml, (project_grobot / "project.toml").resolve())
            self.assertEqual(paths.project_memory_dir, (project_grobot / "memory").resolve())

    def test_resolve_session_store_config_supports_session_root_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "custom" / "sessions"
            store = grobot_cli.resolve_session_store_config(
                project_toml={
                    "runtime": {"storage": {"hot_cache": "redis"}},
                    "session": {"resume_ttl_secs": 321},
                },
                root=Path(temp_dir),
                session_root=session_root,
                session_backend_arg="file",
                redis_url_arg=None,
                ttl_secs_arg=None,
            )
            self.assertEqual(store.root, session_root)
            self.assertEqual(store.ttl_secs, 321)

    def test_persist_memory_layers_writes_session_project_and_global_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "schema_version = 1\nmode = \"mvp\"\n",
                encoding="utf-8",
            )

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)

            selection = grobot_cli.ProjectSelection(
                name="demo",
                work_dir=project_root,
                platform="feishu",
                provider=grobot_cli.ProviderConfig(
                    name="mock",
                    api_key="mock-key",
                    base_url="https://api.example.com/v1",
                    model="mock-model",
                ),
            )

            compact_memory = {
                "version": 1,
                "sections": {
                    grobot_cli.HISTORY_COMPACT_SECTION_ARCHITECTURE: ["Architecture decisions must be kept"],
                    grobot_cli.HISTORY_COMPACT_SECTION_VERIFICATION: ["PASS: smoke"],
                    grobot_cli.HISTORY_COMPACT_SECTION_TODO: ["TODO: add metrics"],
                },
            }
            warnings = grobot_cli.persist_memory_layers(
                paths=paths,
                selection=selection,
                session_key="feishu:demo:dm:workspace",
                compact_memory=compact_memory,
            )
            self.assertEqual(warnings, [])

            session_snapshot = paths.session_memory_dir / "feishu_demo_dm_workspace.json"
            project_log = paths.project_memory_dir / "memory.jsonl"
            global_log = paths.global_memory_dir / "memory.jsonl"
            self.assertTrue(session_snapshot.exists())
            self.assertTrue(project_log.exists())
            self.assertTrue(global_log.exists())

            snapshot_payload = json.loads(session_snapshot.read_text(encoding="utf-8"))
            self.assertEqual(snapshot_payload["session_key"], "feishu:demo:dm:workspace")

            project_rows = [
                json.loads(line)
                for line in project_log.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            global_rows = [
                json.loads(line)
                for line in global_log.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertGreaterEqual(len(project_rows), 1)
            self.assertGreaterEqual(len(global_rows), 1)

    def test_run_init_uses_fallback_templates_when_repo_templates_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project, tempfile.TemporaryDirectory() as temp_repo:
            original_repo_root = grobot_cli.repo_root
            try:
                grobot_cli.repo_root = lambda: Path(temp_repo)
                args = type(
                    "InitArgs",
                    (),
                    {
                        "init_global": True,
                        "init_project": True,
                        "home": temp_home,
                        "project_root": temp_project,
                        "force": False,
                    },
                )()
                exit_code = grobot_cli.run_init(args)
                self.assertEqual(exit_code, 0)
            finally:
                grobot_cli.repo_root = original_repo_root

            global_config = Path(temp_home) / "config.toml"
            project_toml = Path(temp_project) / ".grobot" / "project.toml"
            project_mcp = Path(temp_project) / ".grobot" / "mcp.toml"
            self.assertTrue(global_config.exists())
            self.assertTrue(project_toml.exists())
            self.assertTrue(project_mcp.exists())
            self.assertIn("replace-with-api-key", global_config.read_text(encoding="utf-8"))
            self.assertIn("schema_version = 1", project_toml.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
