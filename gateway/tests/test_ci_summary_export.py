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


class HarnessCiSummaryExportTests(unittest.TestCase):
    def _write_json(self, path: Path, payload: dict) -> None:
        path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")

    def _build_command(
        self,
        *,
        summary_path: Path,
        github_output_path: Path | None = None,
        extra_args: list[str] | None = None,
    ) -> list[str]:
        command = ["--summary", str(summary_path)]
        if github_output_path is not None:
            command.extend(["--github-output", str(github_output_path)])
        if extra_args:
            command.extend(extra_args)
        return command

    def _run(self, command: list[str]) -> subprocess.CompletedProcess[str]:
        return run_ts_script("evals/ci-summary-export.ts", tuple(command))

    def test_build_harness_gate_outputs_defaults_when_summary_empty(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            summary_path = root / "summary.json"
            self._write_json(summary_path, {})
            completed = self._run(self._build_command(summary_path=summary_path, extra_args=["--print-json"]))
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            outputs = json.loads(completed.stdout)

        self.assertEqual(outputs["overall_state"], "unknown")
        self.assertEqual(outputs["trend_owner"], "unknown-owner")
        self.assertEqual(outputs["trend_decision_tag"], "TREND_UNKNOWN_MODE")
        self.assertEqual(outputs["policy_drift_state"], "none:shape_ok")
        self.assertEqual(outputs["policy_drift_transition"], "none->none")
        self.assertEqual(outputs["policy_drift_transition_state"], "stable_none")
        self.assertEqual(outputs["policy_drift_severity_delta"], "0")
        self.assertEqual(outputs["policy_drift_owner"], "release-owner")
        self.assertEqual(outputs["policy_drift_action_hint"], "n/a")
        self.assertEqual(outputs["policy_drift_worsening_streak"], "0")
        self.assertEqual(outputs["policy_drift_worsening_alert"], "false")
        self.assertEqual(outputs["policy_drift_worsening_label"], "ci/policy-drift-worsening")
        self.assertEqual(outputs["suggested_labels_csv"], "")
        self.assertEqual(outputs["suggested_labels_json"], [])

    def test_build_harness_gate_outputs_uses_summary_values(self) -> None:
        summary_payload = {
            "overall_pass": True,
            "suggested_labels": ["ci/harness-pass", "ci/policy-drift-medium"],
            "skill_router": {
                "trend_owner": "router-evals",
                "trend_decision_tag": "TREND_EXECUTED_PASS",
                "trend_decision_severity": "info",
                "trend_action_hint": "trend executed and passed",
            },
            "policy_drift": {
                "severity": "medium",
                "reason": "missing_fields",
                "transition": "low->medium",
                "transition_state": "worsened",
                "severity_delta": 1,
                "owner": "policy-maintainers",
                "action_hint": "policy drift worsened; add missing required fields and re-run policy guard.",
                "worsening_streak": 2,
                "worsening_alert": True,
                "worsening_label": "ci/policy-drift-worsening",
            },
        }
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            summary_path = root / "summary.json"
            self._write_json(summary_path, summary_payload)
            completed = self._run(self._build_command(summary_path=summary_path, extra_args=["--print-json"]))
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            outputs = json.loads(completed.stdout)

        self.assertEqual(outputs["overall_state"], "pass")
        self.assertEqual(outputs["trend_owner"], "router-evals")
        self.assertEqual(outputs["trend_decision_tag"], "TREND_EXECUTED_PASS")
        self.assertEqual(outputs["policy_drift_state"], "medium:missing_fields")
        self.assertEqual(outputs["policy_drift_transition"], "low->medium")
        self.assertEqual(outputs["policy_drift_transition_state"], "worsened")
        self.assertEqual(outputs["policy_drift_severity_delta"], "1")
        self.assertEqual(outputs["policy_drift_owner"], "policy-maintainers")
        self.assertIn("policy drift worsened", outputs["policy_drift_action_hint"])
        self.assertEqual(outputs["policy_drift_worsening_streak"], "2")
        self.assertEqual(outputs["policy_drift_worsening_alert"], "true")
        self.assertEqual(outputs["suggested_labels_csv"], "ci/harness-pass,ci/policy-drift-medium")
        self.assertEqual(outputs["suggested_labels_json"], ["ci/harness-pass", "ci/policy-drift-medium"])

    def test_main_prints_json_and_writes_github_outputs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            summary_path = root / "summary.json"
            output_path = root / "github-output.txt"
            self._write_json(
                summary_path,
                {
                    "overall_pass": True,
                    "suggested_labels": ["ci/harness-pass"],
                    "skill_router": {"trend_owner": "router-evals"},
                    "policy_drift": {
                        "severity": "low",
                        "reason": "unknown_fields",
                        "transition": "none->low",
                        "transition_state": "introduced",
                        "severity_delta": 1,
                        "owner": "policy-maintainers",
                        "action_hint": "policy drift persists; remove unknown fields.",
                        "worsening_streak": 1,
                        "worsening_alert": False,
                        "worsening_label": "ci/policy-drift-worsening",
                    },
                },
            )
            completed = self._run(
                self._build_command(
                    summary_path=summary_path,
                    github_output_path=output_path,
                    extra_args=["--print-json"],
                )
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            stdout_payload = json.loads(completed.stdout)
            self.assertEqual(stdout_payload["overall_state"], "pass")
            self.assertEqual(stdout_payload["policy_drift_state"], "low:unknown_fields")
            self.assertEqual(stdout_payload["policy_drift_transition"], "none->low")
            self.assertEqual(stdout_payload["policy_drift_transition_state"], "introduced")
            self.assertEqual(stdout_payload["policy_drift_owner"], "policy-maintainers")
            output_text = output_path.read_text(encoding="utf-8")
            self.assertIn("overall_state=pass", output_text)
            self.assertIn("policy_drift_state=low:unknown_fields", output_text)
            self.assertIn("policy_drift_transition=none->low", output_text)
            self.assertIn("policy_drift_transition_state=introduced", output_text)
            self.assertIn("policy_drift_severity_delta=1", output_text)
            self.assertIn("policy_drift_owner=policy-maintainers", output_text)
            self.assertIn(
                "policy_drift_action_hint=policy drift persists; remove unknown fields.",
                output_text,
            )
            self.assertIn("suggested_labels_json<<EOF", output_text)
            self.assertIn('["ci/harness-pass"]', output_text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
