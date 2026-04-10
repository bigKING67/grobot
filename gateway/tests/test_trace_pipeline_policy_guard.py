#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.policy_guard import (  # noqa: E402
    build_policy_result,
    validate_policy_config,
    validate_policy_file,
)


class TracePipelinePolicyGuardTests(unittest.TestCase):
    def _base_config(self) -> dict[str, object]:
        return {
            "schema": "trace_pipeline_policy",
            "schema_version": 1,
            "profile": "test",
            "sessions_dir": Path("/tmp/sessions"),
            "trace_cases_output": Path("/tmp/cases.jsonl"),
            "trace_runs_output": Path("/tmp/runs.jsonl"),
            "variant": "trace_baseline",
            "holdout_ratio": 0.2,
            "seed": 42,
            "max_cases": 10,
            "min_chars": 1,
            "clean_cases_output": Path("/tmp/cases.clean.jsonl"),
            "clean_runs_output": Path("/tmp/runs.clean.jsonl"),
            "clean_report_output": Path("/tmp/report.json"),
            "min_prompt_chars": 4,
            "min_response_chars": 2,
            "max_exact_duplicates_per_prompt": 1,
            "similarity_threshold": 0.88,
            "max_near_duplicates_per_anchor": 0,
            "min_cases_per_split": 0,
            "min_clean_cases": 1,
            "fail_on_low_sample": False,
            "min_clean_cases_by_split": {},
            "fail_on_split_underflow": False,
        }

    def test_repository_policies_are_valid(self) -> None:
        evals_dir = Path(__file__).resolve().parents[1] / "evals"
        for profile in ("dev", "ci", "prod"):
            policy_file = evals_dir / f"trace_pipeline_policy.{profile}.json"
            config, errors = validate_policy_file(policy_file)
            self.assertIsNotNone(config)
            self.assertEqual(errors, [], msg=f"{profile} policy errors: {errors}")

    def test_validate_policy_config_requires_positive_min_clean_cases(self) -> None:
        config = self._base_config()
        config["min_clean_cases"] = 0
        config["fail_on_low_sample"] = True
        errors = validate_policy_config(config)
        self.assertIn("fail_on_low_sample=true requires min_clean_cases > 0", errors)

    def test_validate_policy_config_requires_split_thresholds(self) -> None:
        config = self._base_config()
        config["fail_on_split_underflow"] = True
        errors = validate_policy_config(config)
        self.assertIn("fail_on_split_underflow=true requires non-empty min_clean_cases_by_split", errors)

    def test_validate_policy_config_rejects_schema_name_mismatch(self) -> None:
        config = self._base_config()
        config["schema"] = "other_policy"
        errors = validate_policy_config(config)
        self.assertTrue(any("unsupported schema" in item for item in errors))

    def test_validate_policy_config_rejects_schema_version_mismatch(self) -> None:
        config = self._base_config()
        config["schema_version"] = 99
        errors = validate_policy_config(config)
        self.assertTrue(any("unsupported schema_version" in item for item in errors))

    def test_validate_policy_file_reports_json_error(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "broken.json"
            policy_file.write_text("{not-json", encoding="utf-8")
            config, errors = validate_policy_file(policy_file)
            self.assertIsNone(config)
            self.assertTrue(any("invalid policy json" in item for item in errors))

    def test_validate_policy_file_rejects_unknown_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "unknown.json"
            policy_file.write_text(json.dumps({"unknown_field": 1}), encoding="utf-8")
            config, errors = validate_policy_file(policy_file)
            self.assertIsNone(config)
            self.assertTrue(any("unknown policy fields" in item for item in errors))

    def test_build_policy_result_includes_hash_and_canonical_payload(self) -> None:
        evals_dir = Path(__file__).resolve().parents[1] / "evals"
        policy_file = evals_dir / "trace_pipeline_policy.ci.json"
        result = build_policy_result(policy_file, include_details=True)
        self.assertTrue(result["ok"], msg=result["errors"])
        self.assertTrue(str(result.get("policy_hash", "")).startswith("sha256:"))
        canonical = result.get("canonical_policy")
        self.assertIsInstance(canonical, dict)
        assert isinstance(canonical, dict)
        self.assertEqual(canonical.get("schema"), "trace_pipeline_policy")
        self.assertEqual(canonical.get("schema_version"), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
