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


class TracePipelinePolicyGuardTests(unittest.TestCase):
    def _run_guard(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return run_ts_script("evals/trace-policy-guard.ts", tuple(args))

    def _base_policy(self) -> dict[str, object]:
        return {
            "schema": "trace_pipeline_policy",
            "schema_version": 2,
            "profile": "test",
            "sessions_dir": "sessions",
            "trace_cases_output": "out/cases.jsonl",
            "trace_runs_output": "out/runs.jsonl",
            "variant": "trace_baseline",
            "holdout_ratio": 0.2,
            "seed": 42,
            "max_cases": 10,
            "min_chars": 1,
            "clean_cases_output": "out/cases.clean.jsonl",
            "clean_runs_output": "out/runs.clean.jsonl",
            "clean_report_output": "out/report.json",
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
        result = self._run_guard(
            [
                "--policy",
                str(evals_dir / "trace_pipeline_policy.dev.json"),
                "--policy",
                str(evals_dir / "trace_pipeline_policy.ci.json"),
                "--policy",
                str(evals_dir / "trace_pipeline_policy.prod.json"),
                "--print-json",
            ]
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        policies = payload.get("policies", [])
        self.assertEqual(len(policies), 3)
        for item in policies:
            self.assertTrue(item.get("ok"), msg=item.get("errors"))

    def test_validate_policy_config_requires_positive_min_clean_cases(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy = self._base_policy()
            policy["min_clean_cases"] = 0
            policy["fail_on_low_sample"] = True
            policy_path = root / "policy.json"
            policy_path.write_text(json.dumps(policy, ensure_ascii=False), encoding="utf-8")

            result = self._run_guard(["--policy", str(policy_path), "--print-json"])
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertIn("fail_on_low_sample=true requires min_clean_cases > 0", errors)

    def test_validate_policy_config_requires_split_thresholds(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy = self._base_policy()
            policy["fail_on_split_underflow"] = True
            policy_path = root / "policy.json"
            policy_path.write_text(json.dumps(policy, ensure_ascii=False), encoding="utf-8")

            result = self._run_guard(["--policy", str(policy_path), "--print-json"])
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertIn("fail_on_split_underflow=true requires non-empty min_clean_cases_by_split", errors)

    def test_validate_policy_config_rejects_schema_name_mismatch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy = self._base_policy()
            policy["schema"] = "other_policy"
            policy_path = root / "policy.json"
            policy_path.write_text(json.dumps(policy, ensure_ascii=False), encoding="utf-8")

            result = self._run_guard(["--policy", str(policy_path), "--print-json"])
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertTrue(any("unsupported policy schema" in item for item in errors))

    def test_validate_policy_config_rejects_schema_version_mismatch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy = self._base_policy()
            policy["schema_version"] = 99
            policy_path = root / "policy.json"
            policy_path.write_text(json.dumps(policy, ensure_ascii=False), encoding="utf-8")

            result = self._run_guard(["--policy", str(policy_path), "--print-json"])
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertTrue(any("schema_version too new" in item for item in errors))

    def test_validate_policy_file_reports_json_error(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "broken.json"
            policy_file.write_text("{not-json", encoding="utf-8")
            result = self._run_guard(["--policy", str(policy_file), "--print-json"])
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertTrue(any("invalid policy json" in item for item in errors))

    def test_validate_policy_file_rejects_unknown_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "unknown.json"
            policy_file.write_text(json.dumps({"unknown_field": 1}), encoding="utf-8")
            result = self._run_guard(["--policy", str(policy_file), "--print-json"])
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertTrue(any("unknown policy fields" in item for item in errors))

    def test_build_policy_result_includes_hash_and_canonical_payload(self) -> None:
        evals_dir = Path(__file__).resolve().parents[1] / "evals"
        policy_file = evals_dir / "trace_pipeline_policy.ci.json"
        result = self._run_guard(["--policy", str(policy_file), "--print-json"])
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        policy = payload["policies"][0]
        self.assertTrue(policy["ok"], msg=policy["errors"])
        self.assertTrue(str(policy.get("policy_hash", "")).startswith("sha256:"))
        canonical = policy.get("canonical_policy")
        self.assertIsInstance(canonical, dict)
        if isinstance(canonical, dict):
            self.assertEqual(canonical.get("schema"), "trace_pipeline_policy")
            self.assertEqual(canonical.get("schema_version"), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
