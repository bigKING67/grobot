#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.skill_router_baseline_report import resolve_base_sha  # noqa: E402


class SkillRouterBaselineReportTests(unittest.TestCase):
    SCRIPT_PATH = Path(__file__).resolve().parents[1] / "evals" / "skill_router_baseline_report.py"

    def test_resolve_base_sha_prefers_event_specific_field(self) -> None:
        self.assertEqual(
            resolve_base_sha(
                event_name="pull_request",
                pr_base_sha="abc123",
                before_sha="def456",
            ),
            "abc123",
        )
        self.assertEqual(
            resolve_base_sha(
                event_name="push",
                pr_base_sha="abc123",
                before_sha="def456",
            ),
            "def456",
        )
        self.assertIsNone(
            resolve_base_sha(
                event_name="push",
                pr_base_sha="",
                before_sha="0000000000000000000000000000000000000000",
            )
        )

    def test_main_writes_unavailable_when_base_sha_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_path = root / "baseline.json"
            github_output_path = root / "github-output.txt"
            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--event-name",
                "pull_request",
                "--pr-base-sha",
                "",
                "--repo-root",
                str(root),
                "--output",
                str(output_path),
                "--github-output",
                str(github_output_path),
                "--print-json",
            ]
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            self.assertEqual(payload.get("available"), False)
            self.assertEqual(payload.get("reason"), "no_base_sha")
            self.assertFalse(output_path.exists())
            self.assertIn("available=false", github_output_path.read_text(encoding="utf-8"))

    def test_main_handles_non_git_repo_as_unavailable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_path = root / "baseline.json"
            github_output_path = root / "github-output.txt"
            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--event-name",
                "push",
                "--before-sha",
                "abc123",
                "--repo-root",
                str(root),
                "--output",
                str(output_path),
                "--github-output",
                str(github_output_path),
                "--print-json",
            ]
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            self.assertEqual(payload.get("available"), False)
            self.assertEqual(payload.get("reason"), "worktree_add_failed")
            self.assertIn("available=false", github_output_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
