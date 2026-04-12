#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


class StartToolSmokeTests(unittest.TestCase):
    def test_package_launcher_rejects_python_execution_plane(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [
                "./packages/cli/bin/grobot",
                "status",
                "--gateway-impl=python",
            ],
            cwd=str(repo_root),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("legacy python execution path is removed", result.stderr)

    def test_start_message_runs_via_ts_rust(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp_work_dir, tempfile.TemporaryDirectory() as temp_cfg_dir:
            work_dir = Path(temp_work_dir)
            cfg_path = Path(temp_cfg_dir) / "config.toml"
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
                        'base_url = "http://127.0.0.1:65534/v1"',
                        'model = "mock-model"',
                        "",
                        "[[projects.platforms]]",
                        'type = "feishu"',
                        "",
                        "[projects.platforms.options]",
                        'app_id = "x"',
                        'app_secret = "y"',
                    ]
                )
                + "\n",
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
                    "--gateway-impl",
                    "ts",
                    "--runtime-impl",
                    "rust",
                    "--no-shadow-mode",
                    "--message",
                    "ts rust execution smoke",
                ],
                cwd=str(repo_root),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertIn("[rust-runtime]", result.stdout)
            self.assertIn("[governance]", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
