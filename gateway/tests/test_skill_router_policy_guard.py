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


class SkillRouterPolicyGuardTests(unittest.TestCase):
    def _base_config(self) -> dict[str, object]:
        return {
            "schema": "skill_router_eval_policy",
            "schema_version": 1,
            "profile": "ci",
            "cases": "/tmp/cases.jsonl",
            "global_skills_dir": "/tmp/skills-global",
            "project_skills_dir": "/tmp/skills-project",
            "project_toml": "/tmp/project.toml",
            "router_overrides": {
                "score_threshold": 2.0,
                "min_score_gap": 0.8,
                "max_descriptors": 64,
                "descriptor_scan_lines": 180,
            },
            "gates": {
                "min_accuracy": 1.0,
                "max_forbidden_violations": 0,
                "max_accuracy_drop": 0.01,
                "max_forbidden_increase": 0,
            },
        }

    def _run_guard(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return run_ts_script("evals/skill-router-policy-guard.ts", tuple(args))

    def test_repository_policies_are_valid(self) -> None:
        evals_dir = Path(__file__).resolve().parents[1] / "evals"
        result = self._run_guard(
            [
                "--policy",
                str(evals_dir / "skill_router_policy.dev.json"),
                "--policy",
                str(evals_dir / "skill_router_policy.ci.json"),
                "--policy",
                str(evals_dir / "skill_router_policy.prod.json"),
                "--print-json",
            ]
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        policies = payload.get("policies")
        self.assertIsInstance(policies, list)
        if not isinstance(policies, list):
            self.fail("policies must be list")
        self.assertEqual(len(policies), 3)
        for item in policies:
            self.assertIsInstance(item, dict)
            if isinstance(item, dict):
                self.assertTrue(item.get("ok"), msg=item.get("errors"))

    def test_validate_policy_config_rejects_schema_name_mismatch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "schema-mismatch.json"
            config = self._base_config()
            config["schema"] = "other_policy"
            policy_file.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
            result = self._run_guard(["--policy", str(policy_file), "--print-json"])
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertTrue(any("policy schema must be skill_router_eval_policy" in item for item in errors))

    def test_validate_policy_config_requires_trend_gate_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "missing-gate-field.json"
            config = self._base_config()
            gates = config["gates"]
            self.assertIsInstance(gates, dict)
            if isinstance(gates, dict):
                del gates["max_accuracy_drop"]
            policy_file.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
            result = self._run_guard(["--policy", str(policy_file), "--print-json"])
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertIn("gates missing field: max_accuracy_drop", errors)

    def test_validate_policy_file_reports_json_error(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "broken.json"
            policy_file.write_text("{not-json", encoding="utf-8")
            result = self._run_guard(["--policy", str(policy_file), "--print-json"])
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertTrue(any("SyntaxError" in item for item in errors))

    def test_validate_policy_file_rejects_unknown_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "unknown.json"
            policy_file.write_text(json.dumps({"unknown_field": 1}), encoding="utf-8")
            result = self._run_guard(["--policy", str(policy_file), "--print-json"])
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            errors = payload["policies"][0]["errors"]
            self.assertTrue(any("policy contains unknown fields" in item for item in errors))

    def test_build_policy_result_includes_hash_and_canonical_payload(self) -> None:
        evals_dir = Path(__file__).resolve().parents[1] / "evals"
        policy_file = evals_dir / "skill_router_policy.ci.json"
        result = self._run_guard(["--policy", str(policy_file), "--print-json"])
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        item = payload["policies"][0]
        self.assertTrue(item["ok"], msg=item["errors"])
        self.assertTrue(str(item.get("policy_hash", "")).startswith("sha256:"))
        canonical = item.get("canonical_policy")
        self.assertIsInstance(canonical, dict)
        if isinstance(canonical, dict):
            self.assertEqual(canonical.get("schema"), "skill_router_eval_policy")
            self.assertEqual(canonical.get("schema_version"), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
