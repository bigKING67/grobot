#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.ci_summary_export import build_harness_gate_outputs  # noqa: E402


class HarnessCiSummaryExportTests(unittest.TestCase):
    SCRIPT_PATH = Path(__file__).resolve().parents[1] / "evals" / "ci_summary_export.py"

    def test_build_harness_gate_outputs_defaults_when_summary_empty(self) -> None:
        outputs = build_harness_gate_outputs({})
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
        outputs = build_harness_gate_outputs(
            {
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
        )
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
            summary_path.write_text(
                json.dumps(
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
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--summary",
                str(summary_path),
                "--github-output",
                str(output_path),
                "--print-json",
            ]
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(completed.returncode, 0)
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
