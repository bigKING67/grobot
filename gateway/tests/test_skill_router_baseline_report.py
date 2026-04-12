#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

try:
    from gateway.tests.ts_contract import run_ts_script
except ModuleNotFoundError:
    from ts_contract import run_ts_script


class SkillRouterBaselineReportTests(unittest.TestCase):
    def _run_cli(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return run_ts_script("evals/skill-router-baseline-report.ts", tuple([*args, "--print-json"]))

    def test_resolve_base_sha_prefers_event_specific_field(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_path = root / "baseline.json"

            pull_request_result = self._run_cli(
                [
                    "--event-name",
                    "pull_request",
                    "--pr-base-sha",
                    "abc123",
                    "--before-sha",
                    "def456",
                    "--repo-root",
                    str(root),
                    "--output",
                    str(output_path),
                ]
            )
            self.assertEqual(pull_request_result.returncode, 0)
            pull_request_payload = json.loads(pull_request_result.stdout)
            self.assertEqual(pull_request_payload.get("base_sha"), "abc123")

            push_result = self._run_cli(
                [
                    "--event-name",
                    "push",
                    "--pr-base-sha",
                    "abc123",
                    "--before-sha",
                    "def456",
                    "--repo-root",
                    str(root),
                    "--output",
                    str(output_path),
                ]
            )
            self.assertEqual(push_result.returncode, 0)
            push_payload = json.loads(push_result.stdout)
            self.assertEqual(push_payload.get("base_sha"), "def456")

            zero_sha_result = self._run_cli(
                [
                    "--event-name",
                    "push",
                    "--before-sha",
                    "0000000000000000000000000000000000000000",
                    "--repo-root",
                    str(root),
                    "--output",
                    str(output_path),
                ]
            )
            self.assertEqual(zero_sha_result.returncode, 0)
            zero_sha_payload = json.loads(zero_sha_result.stdout)
            self.assertEqual(zero_sha_payload.get("reason"), "no_base_sha")
            self.assertIsNone(zero_sha_payload.get("base_sha"))

    def test_main_writes_unavailable_when_base_sha_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_path = root / "baseline.json"
            github_output_path = root / "github-output.txt"
            completed = self._run_cli(
                [
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
                ]
            )
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
            completed = self._run_cli(
                [
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
                ]
            )
            self.assertEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            self.assertEqual(payload.get("available"), False)
            self.assertEqual(payload.get("reason"), "worktree_add_failed")
            self.assertIn("available=false", github_output_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
