#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


def build_config_text(work_dir: Path) -> str:
    return (
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
                'base_url = "http://127.0.0.1:65534/v1"',
                'model = "failing-model"',
                "",
                "[[projects.agent.providers]]",
                'name = "success"',
                'api_key = "success-key"',
                'base_url = "http://127.0.0.1:65533/v1"',
                'model = "success-model"',
                "",
                "[[projects.platforms]]",
                'type = "feishu"',
                "",
                "[projects.platforms.options]",
                'app_id = "x"',
                'app_secret = "y"',
            ]
        )
        + "\n"
    )


class FailoverContextTests(unittest.TestCase):
    def test_start_rejects_legacy_python_execution_plane(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir, tempfile.TemporaryDirectory() as temp_cfg_dir:
            work_dir = Path(temp_work_dir)
            cfg_path = Path(temp_cfg_dir) / "config.toml"
            cfg_path.write_text(build_config_text(work_dir), encoding="utf-8")

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
                    "--gateway-impl",
                    "python",
                    "--runtime-impl",
                    "python",
                    "--message",
                    "legacy path should be rejected",
                ],
                cwd=str(repo_root),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 2)
            self.assertIn("legacy python execution path is removed", result.stderr)

    def test_start_runs_with_ts_rust_and_multi_provider_config(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir, tempfile.TemporaryDirectory() as temp_cfg_dir:
            work_dir = Path(temp_work_dir)
            cfg_path = Path(temp_cfg_dir) / "config.toml"
            cfg_path.write_text(build_config_text(work_dir), encoding="utf-8")

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
                    "--gateway-impl",
                    "ts",
                    "--runtime-impl",
                    "rust",
                    "--no-shadow-mode",
                    "--provider",
                    "failing",
                    "--message",
                    "ts rust hard-cut",
                ],
                cwd=str(repo_root),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertIn("[rust-runtime]", result.stdout)
            self.assertIn("[governance]", result.stderr)
            self.assertIn("[execution]", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
