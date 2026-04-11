#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import grobot_cli  # noqa: E402
from evals.skill_router_eval import (  # noqa: E402
    compute_skill_router_policy_fingerprint,
    evaluate_skill_router_cases,
    evaluate_skill_router_gate,
    evaluate_skill_router_trend,
    load_skill_router_cases,
    load_skill_router_eval_policy,
)


class SkillRouterEvalTests(unittest.TestCase):
    SCRIPT_PATH = Path(__file__).resolve().parents[1] / "evals" / "skill_router_eval.py"

    def test_load_skill_router_cases(self) -> None:
        with TemporaryDirectory() as temp_dir:
            cases_file = Path(temp_dir) / "cases.jsonl"
            rows = [
                {
                    "id": "c1",
                    "prompt": "请排查线上报错",
                    "expected_skill": "debug-assistant",
                    "forbidden_skills": ["deploy-ops"],
                },
                {
                    "id": "c2",
                    "prompt": "hello",
                    "expected_skill": None,
                },
            ]
            with cases_file.open("w", encoding="utf-8") as handle:
                handle.write("# comment line\n")
                for row in rows:
                    handle.write(json.dumps(row, ensure_ascii=False))
                    handle.write("\n")

            loaded = load_skill_router_cases(cases_file)
            self.assertEqual(len(loaded), 2)
            self.assertEqual(loaded[0].id, "c1")
            self.assertEqual(loaded[0].expected_skill, "debug-assistant")
            self.assertEqual(loaded[0].forbidden_skills, ("deploy-ops",))
            self.assertIsNone(loaded[1].expected_skill)

    def test_evaluate_skill_router_cases_reports_metrics(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            global_skills, project_skills = self._prepare_sample_skills(root)
            descriptors = grobot_cli.discover_skill_descriptors(global_skills, project_skills)
            cases = [
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
            ]
            case_file = self._write_case_file(root / "cases.jsonl", cases)
            case_items = load_skill_router_cases(case_file)

            report = evaluate_skill_router_cases(
                cases=case_items,
                descriptors=descriptors,
                score_threshold=2.0,
                min_score_gap=0.8,
            )
            summary = report["summary"]
            self.assertEqual(summary["total_cases"], 3)
            self.assertEqual(summary["passed_cases"], 2)
            self.assertEqual(summary["forbidden_violations"], 1)
            self.assertAlmostEqual(summary["accuracy"], 2 / 3, places=6)
            self.assertAlmostEqual(summary["precision"], 0.5, places=6)
            self.assertAlmostEqual(summary["recall"], 1.0, places=6)

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
            global_skills, project_skills = self._prepare_sample_skills(root)
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

    def _run_eval(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        command = [sys.executable, str(self.SCRIPT_PATH), *args]
        return subprocess.run(command, capture_output=True, text=True, check=False)

    def test_load_skill_router_eval_policy_and_fingerprint(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cases = root / "cases.jsonl"
            cases.write_text('{"id":"c1","prompt":"hello","expected_skill":null}\n', encoding="utf-8")
            global_skills = root / "skills-global"
            project_skills = root / "skills-project"
            global_skills.mkdir(parents=True, exist_ok=True)
            project_skills.mkdir(parents=True, exist_ok=True)
            policy_file = root / "policy.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "skill_router_eval_policy",
                        "schema_version": 1,
                        "profile": "ci",
                        "cases": "./cases.jsonl",
                        "global_skills_dir": "./skills-global",
                        "project_skills_dir": "./skills-project",
                        "project_toml": "./missing-project.toml",
                          "router_overrides": {"score_threshold": 2.4, "max_descriptors": 20},
                          "gates": {
                              "min_accuracy": 0.9,
                              "max_forbidden_violations": 0,
                              "max_accuracy_drop": 0.02,
                              "max_forbidden_increase": 0,
                          },
                      },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            loaded = load_skill_router_eval_policy(policy_file)
            self.assertEqual(loaded.schema, "skill_router_eval_policy")
            self.assertEqual(loaded.schema_version, 1)
            self.assertEqual(loaded.profile, "ci")
            self.assertEqual(loaded.cases, cases.resolve())
            self.assertEqual(loaded.global_skills_dir, global_skills.resolve())
            self.assertEqual(loaded.project_skills_dir, project_skills.resolve())
            self.assertEqual(loaded.score_threshold, 2.4)
            self.assertEqual(loaded.max_descriptors, 20)
            self.assertEqual(loaded.max_accuracy_drop, 0.02)
            self.assertEqual(loaded.max_forbidden_increase, 0)
            policy_hash, canonical = compute_skill_router_policy_fingerprint(policy_file)
            self.assertTrue(policy_hash)
            self.assertEqual(canonical["schema"], "skill_router_eval_policy")

    def test_load_skill_router_eval_policy_rejects_unknown_fields(self) -> None:
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
                        "unexpected": "x",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                _ = load_skill_router_eval_policy(policy_file)

    def test_evaluate_skill_router_gate(self) -> None:
        summary = {
            "accuracy": 0.8,
            "forbidden_violations": 1,
        }
        gate = evaluate_skill_router_gate(
            summary=summary,
            min_accuracy=0.9,
            max_forbidden_violations=0,
        )
        self.assertFalse(gate["passed"])
        self.assertEqual(len(gate["checks"]), 2)

    def test_evaluate_skill_router_trend(self) -> None:
        trend = evaluate_skill_router_trend(
            current_summary={"accuracy": 0.82, "forbidden_violations": 1},
            baseline_summary={"accuracy": 0.9, "forbidden_violations": 0},
            max_accuracy_drop=0.05,
            max_forbidden_increase=0,
        )
        self.assertFalse(trend["passed"])
        self.assertEqual(len(trend["checks"]), 2)
        self.assertAlmostEqual(float(trend["deltas"]["accuracy_drop"]), 0.08, places=6)
        self.assertEqual(int(trend["deltas"]["forbidden_increase"]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
