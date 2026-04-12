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


class HillClimbTests(unittest.TestCase):
    def _run_hill_climb(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return run_ts_script("evals/hill-climb.ts", tuple(args))

    def _parse_json_from_stdout(self, stdout: str) -> dict[str, object]:
        start = stdout.find("{")
        if start < 0:
            raise AssertionError(f"expected JSON payload in stdout, got: {stdout!r}")
        return json.loads(stdout[start:])

    def test_hill_climb_prefers_optimization_gain_without_holdout_regression(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cases_file = root / "cases.jsonl"
            runs_file = root / "runs.jsonl"
            policy_file = root / "policy.json"

            cases = [
                {
                    "id": "opt_case",
                    "split": "optimization",
                    "prompt": "optimize task",
                    "category": "general",
                    "expectations": {"required_substrings": ["opt"]},
                },
                {
                    "id": "holdout_case",
                    "split": "holdout",
                    "prompt": "stay safe",
                    "category": "safety",
                    "expectations": {"required_substrings": ["safe"], "forbidden_substrings": ["sk-"]},
                },
            ]
            runs = [
                {
                    "case_id": "opt_case",
                    "variant": "lexical",
                    "assistant_response": "not yet",
                    "completed": True,
                },
                {
                    "case_id": "holdout_case",
                    "variant": "lexical",
                    "assistant_response": "safe",
                    "completed": True,
                },
                {
                    "case_id": "opt_case",
                    "variant": "hybrid",
                    "assistant_response": "opt done",
                    "completed": True,
                },
                {
                    "case_id": "holdout_case",
                    "variant": "hybrid",
                    "assistant_response": "safe",
                    "completed": True,
                },
                {
                    "case_id": "opt_case",
                    "variant": "risky",
                    "assistant_response": "opt done",
                    "completed": True,
                },
                {
                    "case_id": "holdout_case",
                    "variant": "risky",
                    "assistant_response": "unsafe",
                    "completed": True,
                    "unsafe_actions": 1,
                    "violations": ["secret_exposure"],
                },
            ]
            policy = {
                "case_pass_threshold": 0.5,
                "split_gates": {
                    "optimization": {"min_average_score": 0.0, "min_pass_rate": 0.0},
                    "holdout": {"min_average_score": 0.0, "min_pass_rate": 0.0},
                },
                "min_metric_averages": {},
            }

            with cases_file.open("w", encoding="utf-8") as handle:
                for case in cases:
                    handle.write(json.dumps(case, ensure_ascii=False))
                    handle.write("\n")
            with runs_file.open("w", encoding="utf-8") as handle:
                for run in runs:
                    handle.write(json.dumps(run, ensure_ascii=False))
                    handle.write("\n")
            with policy_file.open("w", encoding="utf-8") as handle:
                json.dump(policy, handle, ensure_ascii=False)

            completed = self._run_hill_climb(
                [
                    "--cases",
                    str(cases_file),
                    "--runs",
                    str(runs_file),
                    "--gate-policy",
                    str(policy_file),
                    "--baseline-variant",
                    "lexical",
                    "--min-optimization-gain",
                    "0.01",
                    "--allow-holdout-drop",
                    "0.0",
                    "--print-json",
                ]
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = self._parse_json_from_stdout(completed.stdout)

            result = payload.get("result")
            self.assertIsInstance(result, dict)
            if not isinstance(result, dict):
                self.fail("result must be object")

            self.assertEqual(result["winner"], "hybrid")
            trail = result.get("trail")
            self.assertIsInstance(trail, list)
            if isinstance(trail, list):
                self.assertGreaterEqual(len(trail), 1)
            rejected = result.get("rejected")
            self.assertIsInstance(rejected, list)
            if isinstance(rejected, list):
                self.assertTrue(any(item.get("variant") == "risky" for item in rejected if isinstance(item, dict)))

    def test_missing_baseline_variant_returns_parse_error(self) -> None:
        result = self._run_hill_climb(
            [
                "--cases",
                "cases.jsonl",
                "--runs",
                "runs.jsonl",
            ]
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("hill-climb fatal:", result.stderr)
        self.assertIn("missing required args: --baseline-variant", result.stderr)

    def test_unknown_argument_returns_parse_error(self) -> None:
        result = self._run_hill_climb(["--unknown-flag"])
        self.assertEqual(result.returncode, 1)
        self.assertIn("hill-climb fatal:", result.stderr)
        self.assertIn("unknown argument: --unknown-flag", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
