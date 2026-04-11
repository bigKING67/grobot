#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.skill_router_policy_guard import (  # noqa: E402
    build_policy_result,
    validate_policy_config,
    validate_policy_file,
)


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

    def test_repository_policies_are_valid(self) -> None:
        evals_dir = Path(__file__).resolve().parents[1] / "evals"
        for profile in ("dev", "ci", "prod"):
            policy_file = evals_dir / f"skill_router_policy.{profile}.json"
            config, errors = validate_policy_file(policy_file)
            self.assertIsNotNone(config)
            self.assertEqual(errors, [], msg=f"{profile} policy errors: {errors}")

    def test_validate_policy_config_rejects_schema_name_mismatch(self) -> None:
        config = self._base_config()
        config["schema"] = "other_policy"
        errors = validate_policy_config(config)
        self.assertTrue(any("unsupported schema" in item for item in errors))

    def test_validate_policy_config_requires_trend_gate_fields(self) -> None:
        config = self._base_config()
        gates = config["gates"]
        assert isinstance(gates, dict)
        del gates["max_accuracy_drop"]
        errors = validate_policy_config(config)
        self.assertIn("gates missing field: max_accuracy_drop", errors)

    def test_validate_policy_file_reports_json_error(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "broken.json"
            policy_file.write_text("{not-json", encoding="utf-8")
            config, errors = validate_policy_file(policy_file)
            self.assertIsNone(config)
            self.assertTrue(any("Expecting property name enclosed in double quotes" in item for item in errors))

    def test_validate_policy_file_rejects_unknown_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            policy_file = Path(temp_dir) / "unknown.json"
            policy_file.write_text(json.dumps({"unknown_field": 1}), encoding="utf-8")
            config, errors = validate_policy_file(policy_file)
            self.assertIsNone(config)
            self.assertTrue(any("unknown fields" in item for item in errors))

    def test_build_policy_result_includes_hash_and_canonical_payload(self) -> None:
        evals_dir = Path(__file__).resolve().parents[1] / "evals"
        policy_file = evals_dir / "skill_router_policy.ci.json"
        result = build_policy_result(policy_file, include_details=True)
        self.assertTrue(result["ok"], msg=result["errors"])
        self.assertTrue(str(result.get("policy_hash", "")).startswith("sha256:"))
        canonical = result.get("canonical_policy")
        self.assertIsInstance(canonical, dict)
        assert isinstance(canonical, dict)
        self.assertEqual(canonical.get("schema"), "skill_router_eval_policy")
        self.assertEqual(canonical.get("schema_version"), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
