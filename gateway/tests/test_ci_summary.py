#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.ci_summary import (  # noqa: E402
    build_harness_ci_summary,
    render_harness_ci_summary_markdown,
)


class HarnessCiSummaryTests(unittest.TestCase):
    SCRIPT_PATH = Path(__file__).resolve().parents[1] / "evals" / "ci_summary.py"

    def test_build_harness_ci_summary_reports_overall_pass(self) -> None:
        trace_report = {
            "clean_stats": {"output_cases": 3, "output_runs": 3},
            "sample_guard": {
                "pass": True,
                "split": {"counts": {"holdout": 1, "optimization": 2}},
            },
            "policy_hash": "sha256:trace",
        }
        skill_report = {
            "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 3},
            "gate": {"passed": True},
            "trend": {"passed": True},
            "trend_meta": {
                "required": True,
                "mode": "gate_and_trend",
                "reason": "policy_blob_match",
                "policy_hash_current": "sha256:curr",
                "policy_hash_base": "sha256:base",
                "policy_hash_match": False,
            },
            "policy": {"hash": "sha256:skill"},
        }

        summary = build_harness_ci_summary(trace_report=trace_report, skill_router_report=skill_report)
        self.assertTrue(summary["overall_pass"])
        self.assertEqual(summary["trace"]["clean_cases"], 3)
        self.assertEqual(summary["trace"]["split_counts"]["holdout"], 1)
        self.assertEqual(summary["skill_router"]["total_cases"], 3)
        self.assertTrue(summary["skill_router"]["gate_pass"])
        self.assertTrue(summary["skill_router"]["trend_required"])
        self.assertTrue(summary["skill_router"]["trend_pass"])
        self.assertEqual(summary["skill_router"]["trend_decision_tag"], "TREND_REQUIRED_PASS")
        self.assertEqual(summary["skill_router"]["trend_decision_severity"], "info")
        self.assertEqual(summary["skill_router"]["trend_action_hint"], "required trend checks passed")
        self.assertEqual(summary["skill_router"]["trend_owner"], "router-evals")
        self.assertEqual(
            summary["suggested_labels"],
            [
                "ci/harness-pass",
                "ci/severity-info",
                "ci/owner-router-evals",
                "ci/trend-required-pass",
            ],
        )
        self.assertEqual(summary["skill_router"]["trend_mode"], "gate_and_trend")
        self.assertEqual(summary["skill_router"]["trend_reason"], "policy_blob_match")
        self.assertEqual(summary["skill_router"]["policy_hash_current"], "sha256:curr")
        self.assertEqual(summary["skill_router"]["policy_hash_base"], "sha256:base")
        self.assertFalse(summary["skill_router"]["policy_hash_match"])
        self.assertEqual(summary["policy_drift"]["severity"], "none")
        self.assertEqual(summary["policy_drift"]["reason"], "shape_ok")
        self.assertEqual(summary["policy_drift"]["worsening_streak"], 0)
        self.assertFalse(summary["policy_drift"]["worsening_alert"])
        self.assertEqual(summary["policy_drift"]["worsening_alert_threshold"], 2)
        self.assertEqual(summary["policy_drift"]["worsening_label"], "ci/policy-drift-worsening")
        self.assertEqual(summary["policy_drift"]["transition_state"], "stable_none")
        self.assertEqual(summary["policy_drift"]["severity_delta"], 0)
        self.assertEqual(summary["policy_drift"]["owner"], "release-owner")
        self.assertEqual(summary["policy_drift"]["action_hint"], "n/a")

    def test_build_harness_ci_summary_supports_full_trace_report_shape(self) -> None:
        trace_report = {
            "clean": {"stats": {"output_cases": 4, "output_runs": 5}},
            "sample_guard": {
                "pass": True,
                "split": {"counts": {"holdout": 1, "optimization": 3}},
            },
        }
        skill_report = {
            "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 3},
            "gate": {"passed": True},
        }
        summary = build_harness_ci_summary(trace_report=trace_report, skill_router_report=skill_report)
        self.assertEqual(summary["trace"]["clean_cases"], 4)
        self.assertEqual(summary["trace"]["clean_runs"], 5)
        self.assertEqual(summary["trace"]["split_counts"]["optimization"], 3)
        self.assertEqual(summary["skill_router"]["trend_decision_tag"], "TREND_NOT_REQUESTED")
        self.assertEqual(summary["skill_router"]["trend_decision_severity"], "info")
        self.assertEqual(summary["skill_router"]["trend_action_hint"], "trend not required for this run")
        self.assertEqual(summary["skill_router"]["trend_owner"], "release-owner")
        self.assertEqual(
            summary["suggested_labels"],
            [
                "ci/harness-pass",
                "ci/severity-info",
                "ci/owner-release-owner",
                "ci/trend-not-requested",
            ],
        )
        self.assertFalse(summary["skill_router"]["trend_required"])
        self.assertIsNone(summary["skill_router"]["trend_pass"])

    def test_build_harness_ci_summary_fails_when_required_trend_missing(self) -> None:
        trace_report = {
            "clean_stats": {"output_cases": 4, "output_runs": 4},
            "sample_guard": {
                "pass": True,
                "split": {"counts": {"holdout": 2, "optimization": 2}},
            },
        }
        skill_report = {
            "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 4},
            "gate": {"passed": True},
            "trend_meta": {"required": True, "mode": "gate_only", "reason": "missing_trend"},
        }
        summary = build_harness_ci_summary(trace_report=trace_report, skill_router_report=skill_report)
        self.assertFalse(summary["overall_pass"])
        self.assertEqual(summary["skill_router"]["trend_decision_tag"], "TREND_REQUIRED_FAIL")
        self.assertEqual(summary["skill_router"]["trend_decision_severity"], "error")
        self.assertEqual(
            summary["skill_router"]["trend_action_hint"],
            "required trend failed; inspect baseline and current report diff",
        )
        self.assertEqual(summary["skill_router"]["trend_owner"], "router-evals")
        self.assertEqual(
            summary["suggested_labels"],
            [
                "ci/harness-fail",
                "ci/severity-error",
                "ci/owner-router-evals",
                "ci/trend-required-fail",
                "ci/action-required",
            ],
        )
        self.assertTrue(summary["skill_router"]["trend_required"])
        self.assertFalse(summary["skill_router"]["trend_pass"])

    def test_build_harness_ci_summary_includes_policy_drift_report(self) -> None:
        trace_report = {
            "clean_stats": {"output_cases": 2, "output_runs": 2},
            "sample_guard": {"pass": True, "split": {"counts": {"holdout": 1, "optimization": 1}}},
        }
        skill_report = {
            "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 2},
            "gate": {"passed": True},
        }
        policy_drift_report = {
            "severity": "high",
            "reason": "schema_mismatch",
            "previous_severity": "medium",
            "previous_reason": "missing_fields",
            "worsening_streak": 2,
            "worsening_alert": True,
        }
        summary = build_harness_ci_summary(
            trace_report=trace_report,
            skill_router_report=skill_report,
            policy_drift_report=policy_drift_report,
        )
        self.assertEqual(summary["policy_drift"]["severity"], "high")
        self.assertEqual(summary["policy_drift"]["reason"], "schema_mismatch")
        self.assertEqual(summary["policy_drift"]["previous_severity"], "medium")
        self.assertEqual(summary["policy_drift"]["worsening_streak"], 2)
        self.assertTrue(summary["policy_drift"]["worsening_alert"])
        self.assertEqual(summary["policy_drift"]["worsening_alert_threshold"], 2)
        self.assertEqual(summary["policy_drift"]["worsening_label"], "ci/policy-drift-worsening")
        self.assertEqual(summary["policy_drift"]["transition"], "medium->high")
        self.assertEqual(summary["policy_drift"]["transition_state"], "worsened")
        self.assertEqual(summary["policy_drift"]["severity_delta"], 1)
        self.assertEqual(summary["policy_drift"]["owner"], "policy-governance")
        self.assertIn("policy drift worsened", summary["policy_drift"]["action_hint"])

    def test_render_harness_ci_summary_markdown_contains_core_rows(self) -> None:
        summary = {
            "overall_pass": False,
            "suggested_labels": [
                "ci/harness-fail",
                "ci/severity-warn",
                "ci/owner-policy-governance",
                "ci/trend-skipped-policy-changed",
                "ci/action-review",
            ],
            "trace": {
                "sample_guard_pass": True,
                "clean_cases": 2,
                "clean_runs": 2,
                "split_counts": {"holdout": 1, "optimization": 1},
            },
            "skill_router": {
                "gate_pass": False,
                "trend_decision_tag": "TREND_SKIPPED_POLICY_CHANGED",
                "trend_decision_severity": "warn",
                "trend_owner": "policy-governance",
                "trend_action_hint": "trend skipped because policy changed between base and head",
                "trend_required": False,
                "trend_pass": None,
                "trend_mode": None,
                "trend_reason": None,
                "baseline_available": False,
                "policy_blob_match": None,
                "policy_hash_current": None,
                "policy_hash_base": None,
                "policy_hash_match": None,
                "accuracy": 0.9,
                "forbidden_violations": 1,
                "total_cases": 3,
            },
        }
        markdown = render_harness_ci_summary_markdown(summary)
        self.assertIn("overall: fail", markdown)
        self.assertIn(
            "suggested-labels: ci/harness-fail, ci/severity-warn, ci/owner-policy-governance, ci/trend-skipped-policy-changed, ci/action-review",
            markdown,
        )
        self.assertIn("skill-router-trend-tag: TREND_SKIPPED_POLICY_CHANGED", markdown)
        self.assertIn("skill-router-trend-severity: warn", markdown)
        self.assertIn("skill-router-trend-owner: policy-governance", markdown)
        self.assertIn("skill-router-trend-action: trend skipped because policy changed between base and head", markdown)
        self.assertIn("skill-router-trend: mode=n/a; required=no; pass=n/a; reason=n/a", markdown)
        self.assertIn(
            "| meta | suggested_labels | ci/harness-fail, ci/severity-warn, ci/owner-policy-governance, ci/trend-skipped-policy-changed, ci/action-review |",
            markdown,
        )
        self.assertIn("| policy_drift | severity | none |", markdown)
        self.assertIn("| policy_drift | reason | shape_ok |", markdown)
        self.assertIn("| policy_drift | transition | none->none |", markdown)
        self.assertIn("| policy_drift | transition_state | stable_none |", markdown)
        self.assertIn("| policy_drift | severity_delta | 0 |", markdown)
        self.assertIn("| policy_drift | worsening_streak | 0 |", markdown)
        self.assertIn("| policy_drift | worsening_alert | no |", markdown)
        self.assertIn("| policy_drift | worsening_alert_threshold | 2 |", markdown)
        self.assertIn("| policy_drift | worsening_label | ci/policy-drift-worsening |", markdown)
        self.assertIn("| policy_drift | owner | release-owner |", markdown)
        self.assertIn("| policy_drift | action_hint | n/a |", markdown)
        self.assertIn("| trace | clean_cases | 2 |", markdown)
        self.assertIn("| skill_router | gate_pass | fail |", markdown)
        self.assertIn("| skill_router | trend_decision_tag | TREND_SKIPPED_POLICY_CHANGED |", markdown)
        self.assertIn("| skill_router | trend_decision_severity | warn |", markdown)
        self.assertIn("| skill_router | trend_owner | policy-governance |", markdown)
        self.assertIn(
            "| skill_router | trend_action_hint | trend skipped because policy changed between base and head |",
            markdown,
        )
        self.assertIn("| skill_router | trend_required | no |", markdown)
        self.assertIn("| skill_router | trend_pass | n/a |", markdown)
        self.assertIn("| skill_router | trend_mode | n/a |", markdown)
        self.assertIn("| skill_router | trend_reason | n/a |", markdown)
        self.assertIn("| skill_router | baseline_available | no |", markdown)
        self.assertIn("| skill_router | policy_blob_match | n/a |", markdown)
        self.assertIn("| skill_router | policy_hash_match | n/a |", markdown)
        self.assertIn("| skill_router | policy_hash_current | n/a |", markdown)
        self.assertIn("| skill_router | policy_hash_base | n/a |", markdown)

    def test_render_harness_ci_summary_markdown_shows_policy_drift_worsening_alert(self) -> None:
        summary = {
            "overall_pass": True,
            "suggested_labels": ["ci/harness-pass", "ci/severity-info", "ci/owner-release-owner", "ci/trend-not-requested"],
            "policy_drift": {
                "severity": "high",
                "reason": "schema_mismatch",
                "previous_severity": "medium",
                "previous_reason": "missing_fields",
                "worsening_streak": 2,
                "worsening_alert": True,
            },
            "trace": {
                "sample_guard_pass": True,
                "clean_cases": 2,
                "clean_runs": 2,
                "split_counts": {"holdout": 1, "optimization": 1},
            },
            "skill_router": {
                "gate_pass": True,
                "trend_decision_tag": "TREND_NOT_REQUESTED",
                "trend_decision_severity": "info",
                "trend_owner": "release-owner",
                "trend_action_hint": "trend not required for this run",
                "trend_required": False,
                "trend_pass": None,
                "trend_mode": None,
                "trend_reason": None,
                "baseline_available": False,
                "policy_blob_match": None,
                "policy_hash_current": None,
                "policy_hash_base": None,
                "policy_hash_match": None,
                "accuracy": 1.0,
                "forbidden_violations": 0,
                "total_cases": 2,
            },
        }
        markdown = render_harness_ci_summary_markdown(summary)
        self.assertIn("> [!WARNING] policy_drift worsening alert: streak=2; transition=medium->high", markdown)
        self.assertIn("- policy-drift: high:schema_mismatch", markdown)
        self.assertIn(
            "- policy-drift-trend: transition=medium->high; state=worsened; delta=1; streak=2; alert=yes; threshold=2; worsening_label=ci/policy-drift-worsening",
            markdown,
        )
        self.assertIn("- policy-drift-owner: policy-governance", markdown)
        self.assertIn(
            "- policy-drift-action: policy drift worsened; sync ci_label_policy schema/runtime contract before merge.",
            markdown,
        )

    def test_main_fail_on_overall_fail_returns_nonzero(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trace_path = root / "trace.json"
            skill_path = root / "skill.json"
            trace_path.write_text(
                json.dumps(
                    {
                        "clean_stats": {"output_cases": 1, "output_runs": 1},
                        "sample_guard": {"pass": False, "split": {"counts": {"holdout": 0, "optimization": 1}}},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            skill_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 1},
                        "gate": {"passed": True},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--trace-report",
                str(trace_path),
                "--skill-router-report",
                str(skill_path),
                "--fail-on-overall-fail",
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 4)
            self.assertIn("overall=fail", result.stdout)

    def test_main_emit_github_annotations_warning(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trace_path = root / "trace.json"
            skill_path = root / "skill.json"
            trace_path.write_text(
                json.dumps(
                    {
                        "clean_stats": {"output_cases": 2, "output_runs": 2},
                        "sample_guard": {"pass": True, "split": {"counts": {"holdout": 1, "optimization": 1}}},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            skill_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 2},
                        "gate": {"passed": True},
                        "trend_meta": {"required": False, "mode": "gate_only", "reason": "policy_blob_mismatch"},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--trace-report",
                str(trace_path),
                "--skill-router-report",
                str(skill_path),
                "--emit-github-annotations",
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            self.assertIn("::warning title=Skill Router Trend::", result.stdout)
            self.assertIn("TREND_SKIPPED_POLICY_CHANGED", result.stdout)
            self.assertIn("owner=policy-governance", result.stdout)
            self.assertIn(
                "labels=ci/harness-pass,ci/severity-warn,ci/owner-policy-governance,ci/trend-skipped-policy-changed,ci/action-review",
                result.stdout,
            )
            self.assertIn("policy_drift=none:shape_ok", result.stdout)
            self.assertIn("policy_drift_transition=none->none", result.stdout)
            self.assertIn("policy_drift_transition_state=stable_none", result.stdout)
            self.assertIn("policy_drift_delta=0", result.stdout)
            self.assertIn("policy_drift_owner=release-owner", result.stdout)
            self.assertIn("policy_drift_action=n/a", result.stdout)

    def test_main_emit_github_annotations_warning_for_policy_drift_worsening(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trace_path = root / "trace.json"
            skill_path = root / "skill.json"
            policy_drift_path = root / "policy-drift.json"
            trace_path.write_text(
                json.dumps(
                    {
                        "clean_stats": {"output_cases": 2, "output_runs": 2},
                        "sample_guard": {"pass": True, "split": {"counts": {"holdout": 1, "optimization": 1}}},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            skill_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 2},
                        "gate": {"passed": True},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            policy_drift_path.write_text(
                json.dumps(
                    {
                        "severity": "medium",
                        "reason": "missing_fields",
                        "previous_severity": "low",
                        "previous_reason": "unknown_fields",
                        "worsening_streak": 2,
                        "worsening_alert": True,
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--trace-report",
                str(trace_path),
                "--skill-router-report",
                str(skill_path),
                "--policy-drift-report",
                str(policy_drift_path),
                "--emit-github-annotations",
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            self.assertIn("::warning title=Policy Drift Worsening::", result.stdout)
            self.assertIn("policy_drift=medium:missing_fields", result.stdout)
            self.assertIn("policy_drift_transition=low->medium", result.stdout)
            self.assertIn("policy_drift_transition_state=worsened", result.stdout)
            self.assertIn("policy_drift_delta=1", result.stdout)
            self.assertIn("policy_drift_owner=policy-maintainers", result.stdout)
            self.assertIn("policy_drift_worsening_streak=2", result.stdout)
            self.assertIn("policy_drift_worsening_threshold=2", result.stdout)
            self.assertIn("policy_drift_worsening_label=ci/policy-drift-worsening", result.stdout)
            self.assertIn("policy_drift_worsening_alert=yes", result.stdout)

    def test_main_emit_github_annotations_error_when_overall_fail(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trace_path = root / "trace.json"
            skill_path = root / "skill.json"
            trace_path.write_text(
                json.dumps(
                    {
                        "clean_stats": {"output_cases": 1, "output_runs": 1},
                        "sample_guard": {"pass": False, "split": {"counts": {"holdout": 0, "optimization": 1}}},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            skill_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 1},
                        "gate": {"passed": True},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--trace-report",
                str(trace_path),
                "--skill-router-report",
                str(skill_path),
                "--emit-github-annotations",
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            self.assertIn("::error title=Harness Gate Overall Fail::", result.stdout)
            self.assertIn("owner=release-owner", result.stdout)
            self.assertIn(
                "labels=ci/harness-fail,ci/severity-info,ci/owner-release-owner,ci/trend-not-requested",
                result.stdout,
            )

    def test_main_print_labels_outputs_csv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trace_path = root / "trace.json"
            skill_path = root / "skill.json"
            trace_path.write_text(
                json.dumps(
                    {
                        "clean_stats": {"output_cases": 2, "output_runs": 2},
                        "sample_guard": {"pass": True, "split": {"counts": {"holdout": 1, "optimization": 1}}},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            skill_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 2},
                        "gate": {"passed": True},
                        "trend_meta": {"required": False, "mode": "gate_only", "reason": "policy_blob_mismatch"},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--trace-report",
                str(trace_path),
                "--skill-router-report",
                str(skill_path),
                "--print-labels",
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            self.assertIn(
                "ci/harness-pass,ci/severity-warn,ci/owner-policy-governance,ci/trend-skipped-policy-changed,ci/action-review",
                result.stdout,
            )

    def test_main_labels_output_writes_json(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trace_path = root / "trace.json"
            skill_path = root / "skill.json"
            labels_path = root / "labels.json"
            trace_path.write_text(
                json.dumps(
                    {
                        "clean_stats": {"output_cases": 1, "output_runs": 1},
                        "sample_guard": {"pass": False, "split": {"counts": {"holdout": 0, "optimization": 1}}},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            skill_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 1},
                        "gate": {"passed": True},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
                "--trace-report",
                str(trace_path),
                "--skill-router-report",
                str(skill_path),
                "--labels-output",
                str(labels_path),
            ]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            labels_payload = json.loads(labels_path.read_text(encoding="utf-8"))
            self.assertEqual(
                labels_payload,
                [
                    "ci/harness-fail",
                    "ci/severity-info",
                    "ci/owner-release-owner",
                    "ci/trend-not-requested",
                ],
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
