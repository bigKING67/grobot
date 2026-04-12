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


class SkillRouterEvalTests(unittest.TestCase):
    def _run_eval(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return run_ts_script("evals/skill-router-eval.ts", tuple(args))

    def _parse_json_from_stdout(self, stdout: str) -> dict[str, object]:
        start = stdout.find("{")
        if start < 0:
            raise AssertionError(f"expected JSON payload in stdout, got: {stdout!r}")
        return json.loads(stdout[start:])

    def _write_case_file(self, path: Path, rows: list[dict[str, object]]) -> Path:
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False))
                handle.write("\n")
        return path

    def _prepare_sample_skills(self, root: Path) -> tuple[Path, Path]:
        global_skills = root / "global"
        project_skills = root / "project"

        debug_dir = global_skills / "debug-assistant"
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / "SKILL.md").write_text(
            "\n".join(
                [
                    "# Debug Assistant",
                    "Use when: 排查错误; 调试失败",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        deploy_dir = project_skills / "deploy-ops"
        deploy_dir.mkdir(parents=True, exist_ok=True)
        (deploy_dir / "SKILL.md").write_text(
            "\n".join(
                [
                    "# Deploy Ops",
                    "Use when: 部署生产; 发布版本",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        return global_skills, project_skills

    def test_eval_reports_metrics_and_forbidden_violation(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            global_skills, project_skills = self._prepare_sample_skills(root)
            cases_file = self._write_case_file(
                root / "cases.jsonl",
                [
                    {
                        "id": "c-debug",
                        "prompt": "请排查错误并定位根因",
                        "expected_skill": "debug-assistant",
                    },
                    {
                        "id": "c-none",
                        "prompt": "hello world",
                        "expected_skill": None,
                    },
                    {
                        "id": "c-forbidden",
                        "prompt": "请部署生产环境",
                        "expected_skill": None,
                        "forbidden_skills": ["deploy-ops"],
                    },
                ],
            )
            result = self._run_eval(
                [
                    "--cases",
                    str(cases_file),
                    "--global-skills-dir",
                    str(global_skills),
                    "--project-skills-dir",
                    str(project_skills),
                    "--score-threshold",
                    "2.0",
                    "--min-score-gap",
                    "0.8",
                    "--print-json",
                ]
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = self._parse_json_from_stdout(result.stdout)
            summary = payload.get("summary")
            self.assertIsInstance(summary, dict)
            if not isinstance(summary, dict):
                self.fail("summary must be object")
            self.assertEqual(summary["total_cases"], 3)
            self.assertEqual(summary["passed_cases"], 2)
            self.assertEqual(summary["forbidden_violations"], 1)
            self.assertAlmostEqual(float(summary["accuracy"]), 2 / 3, places=6)
            self.assertAlmostEqual(float(summary["precision"]), 0.5, places=6)
            self.assertAlmostEqual(float(summary["recall"]), 1.0, places=6)

    def test_main_dry_validate_reports_effective_sources_and_cli_precedence(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cases = root / "cases.jsonl"
            cases.write_text(
                json.dumps(
                    {"id": "c1", "prompt": "请排查错误", "expected_skill": "debug-assistant"},
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            global_skills, project_skills = self._prepare_sample_skills(root)
            policy_file = root / "policy.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "skill_router_eval_policy",
                        "schema_version": 1,
                        "profile": "ci",
                        "cases": "./cases.jsonl",
                        "global_skills_dir": "./global",
                        "project_skills_dir": "./project",
                        "router_overrides": {
                            "score_threshold": 2.1,
                            "min_score_gap": 0.8,
                            "max_descriptors": 12,
                            "descriptor_scan_lines": 18,
                        },
                        "gates": {
                            "min_accuracy": 0.7,
                            "max_forbidden_violations": 1,
                            "max_accuracy_drop": 0.15,
                            "max_forbidden_increase": 1,
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            result = self._run_eval(
                [
                    "--policy",
                    str(policy_file),
                    "--dry-validate-only",
                    "--print-json",
                    "--score-threshold",
                    "3.3",
                    "--max-descriptors",
                    "5",
                    "--max-forbidden-violations",
                    "0",
                ]
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["status"], "ok")
            effective = payload["effective"]
            self.assertEqual(effective["score_threshold"], 3.3)
            self.assertEqual(effective["max_descriptors"], 5)
            self.assertEqual(effective["min_score_gap"], 0.8)
            self.assertEqual(effective["descriptor_scan_lines"], 18)
            self.assertEqual(effective["max_forbidden_violations"], 0)
            self.assertEqual(float(payload["trend_config"]["max_accuracy_drop"]), 0.15)
            self.assertEqual(int(payload["trend_config"]["max_forbidden_increase"]), 1)

            sources = payload["effective_sources"]
            self.assertEqual(sources["score_threshold"]["source"], "cli")
            self.assertEqual(sources["max_descriptors"]["source"], "cli")
            self.assertEqual(sources["min_score_gap"]["source"], "policy")
            self.assertEqual(sources["descriptor_scan_lines"]["source"], "policy")
            self.assertEqual(sources["max_forbidden_violations"]["source"], "cli")
            trend_sources = payload["trend_sources"]
            self.assertEqual(trend_sources["max_accuracy_drop"]["source"], "policy")
            self.assertEqual(trend_sources["max_forbidden_increase"]["source"], "policy")

            self.assertEqual(Path(effective["global_skills_dir"]).resolve(), global_skills.resolve())
            self.assertEqual(Path(effective["project_skills_dir"]).resolve(), project_skills.resolve())

            policy = payload["policy"]
            self.assertTrue(str(policy["hash"]).startswith("sha256:"))
            canonical = policy["canonical"]
            self.assertIsInstance(canonical, dict)
            if isinstance(canonical, dict):
                self.assertEqual(canonical["schema"], "skill_router_eval_policy")

    def test_main_max_forbidden_violations_cli_threshold_exits_nonzero(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            global_skills, project_skills = self._prepare_sample_skills(root)
            cases_file = self._write_case_file(
                root / "cases.jsonl",
                [
                    {
                        "id": "c-forbidden",
                        "prompt": "请部署生产环境",
                        "expected_skill": None,
                        "forbidden_skills": ["deploy-ops"],
                    }
                ],
            )

            result = self._run_eval(
                [
                    "--cases",
                    str(cases_file),
                    "--global-skills-dir",
                    str(global_skills),
                    "--project-skills-dir",
                    str(project_skills),
                    "--score-threshold",
                    "2.0",
                    "--min-score-gap",
                    "0.8",
                    "--max-forbidden-violations",
                    "0",
                ]
            )
            self.assertEqual(result.returncode, 5)
            self.assertIn("forbidden_violations=1", result.stdout)

    def test_main_fail_on_trend_exits_nonzero(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            global_skills, project_skills = self._prepare_sample_skills(root)
            cases_file = self._write_case_file(
                root / "cases.jsonl",
                [
                    {
                        "id": "c-trend",
                        "prompt": "hello world",
                        "expected_skill": "debug-assistant",
                    }
                ],
            )
            baseline_file = root / "baseline.json"
            baseline_file.write_text(
                json.dumps({"summary": {"accuracy": 1.0, "forbidden_violations": 0}}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

            result = self._run_eval(
                [
                    "--cases",
                    str(cases_file),
                    "--global-skills-dir",
                    str(global_skills),
                    "--project-skills-dir",
                    str(project_skills),
                    "--score-threshold",
                    "2.0",
                    "--min-score-gap",
                    "0.8",
                    "--compare-report",
                    str(baseline_file),
                    "--max-accuracy-drop",
                    "0.01",
                    "--max-forbidden-increase",
                    "0",
                    "--fail-on-trend",
                ]
            )
            self.assertEqual(result.returncode, 6)
            self.assertIn("trend=fail", result.stdout)

    def test_main_fail_on_trend_uses_policy_thresholds(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cases_file = root / "cases.jsonl"
            cases_file.write_text(
                json.dumps(
                    {
                        "id": "c-trend-policy",
                        "prompt": "hello world",
                        "expected_skill": "debug-assistant",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            self._prepare_sample_skills(root)
            baseline_file = root / "baseline.json"
            baseline_file.write_text(
                json.dumps({"summary": {"accuracy": 1.0, "forbidden_violations": 0}}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            policy_file = root / "policy.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "skill_router_eval_policy",
                        "schema_version": 1,
                        "profile": "ci",
                        "cases": "./cases.jsonl",
                        "global_skills_dir": "./global",
                        "project_skills_dir": "./project",
                        "router_overrides": {
                            "score_threshold": 2.0,
                            "min_score_gap": 0.8,
                        },
                        "gates": {
                            "min_accuracy": 0.0,
                            "max_forbidden_violations": 10,
                            "max_accuracy_drop": 0.01,
                            "max_forbidden_increase": 0,
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            result = self._run_eval(
                [
                    "--policy",
                    str(policy_file),
                    "--compare-report",
                    str(baseline_file),
                    "--fail-on-trend",
                ]
            )
            self.assertEqual(result.returncode, 6)
            self.assertIn("trend=fail", result.stdout)

    def test_policy_validation_rejects_unknown_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy_file = root / "policy.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "skill_router_eval_policy",
                        "schema_version": 1,
                        "profile": "dev",
                        "cases": "./cases.jsonl",
                        "global_skills_dir": "./skills-global",
                        "project_skills_dir": "./skills-project",
                        "router_overrides": {},
                        "gates": {},
                        "unexpected": "x",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            result = self._run_eval(["--policy", str(policy_file), "--dry-validate-only", "--print-json"])
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("policy contains unknown fields", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
