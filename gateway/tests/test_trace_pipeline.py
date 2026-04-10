#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.trace_pipeline import (  # noqa: E402
    compute_trace_pipeline_policy_fingerprint,
    load_trace_pipeline_policy,
    run_trace_pipeline,
)


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            rows.append(json.loads(stripped))
    return rows


class TracePipelineTests(unittest.TestCase):
    def test_load_trace_pipeline_policy_resolves_paths_and_split_map(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy_file = root / "policy.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "trace_pipeline_policy",
                        "schema_version": 2,
                        "profile": "test",
                        "sessions_dir": "sessions",
                        "trace_cases_output": "out/cases.jsonl",
                        "trace_runs_output": "out/runs.jsonl",
                        "clean_cases_output": "out/cases.clean.jsonl",
                        "clean_runs_output": "out/runs.clean.jsonl",
                        "clean_report_output": "out/report.json",
                        "min_clean_cases_by_split": {"holdout": 1, "optimization": 2},
                        "fail_on_low_sample": True,
                        "fail_on_split_underflow": True,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            config = load_trace_pipeline_policy(policy_file)
            self.assertEqual(config["sessions_dir"], root / "sessions")
            self.assertEqual(config["trace_cases_output"], root / "out/cases.jsonl")
            self.assertEqual(config["clean_report_output"], root / "out/report.json")
            self.assertEqual(config["min_clean_cases_by_split"], {"holdout": 1, "optimization": 2})
            self.assertTrue(config["fail_on_low_sample"])
            self.assertEqual(config["schema_version"], 2)
            self.assertEqual(config["profile"], "test")

    def test_load_trace_pipeline_policy_migrates_v1_to_v2(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy_file = root / "policy-v1.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "trace_pipeline_policy",
                        "schema_version": 1,
                        "sessions_dir": "sessions",
                        "trace_cases_output": "out/cases.jsonl",
                        "trace_runs_output": "out/runs.jsonl",
                        "clean_cases_output": "out/cases.clean.jsonl",
                        "clean_runs_output": "out/runs.clean.jsonl",
                        "clean_report_output": "out/report.json",
                        "variant": "trace_baseline",
                        "holdout_ratio": 0.2,
                        "seed": 42,
                        "max_cases": 20,
                        "min_chars": 1,
                        "min_prompt_chars": 4,
                        "min_response_chars": 2,
                        "max_exact_duplicates_per_prompt": 1,
                        "similarity_threshold": 0.88,
                        "max_near_duplicates_per_anchor": 1,
                        "min_cases_per_split": 0,
                        "min_clean_cases": 0,
                        "fail_on_low_sample": False,
                        "min_clean_cases_by_split": {},
                        "fail_on_split_underflow": False,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            config = load_trace_pipeline_policy(policy_file)
            self.assertEqual(config["schema_version"], 2)
            self.assertEqual(config["profile"], "custom")
            self.assertEqual(config["migrations"], ["1->2"])

    def test_load_trace_pipeline_policy_rejects_unknown_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy_file = root / "policy.json"
            policy_file.write_text(json.dumps({"unknown_field": True}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_trace_pipeline_policy(policy_file)

    def test_load_trace_pipeline_policy_rejects_too_new_schema_version(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy_file = root / "policy-v99.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "trace_pipeline_policy",
                        "schema_version": 99,
                        "profile": "test",
                        "sessions_dir": "sessions",
                        "trace_cases_output": "out/cases.jsonl",
                        "trace_runs_output": "out/runs.jsonl",
                        "clean_cases_output": "out/cases.clean.jsonl",
                        "clean_runs_output": "out/runs.clean.jsonl",
                        "clean_report_output": "out/report.json",
                        "variant": "trace_baseline",
                        "holdout_ratio": 0.2,
                        "seed": 42,
                        "max_cases": 20,
                        "min_chars": 1,
                        "min_prompt_chars": 4,
                        "min_response_chars": 2,
                        "max_exact_duplicates_per_prompt": 1,
                        "similarity_threshold": 0.88,
                        "max_near_duplicates_per_anchor": 1,
                        "min_cases_per_split": 0,
                        "min_clean_cases": 0,
                        "fail_on_low_sample": False,
                        "min_clean_cases_by_split": {},
                        "fail_on_split_underflow": False,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "too new"):
                load_trace_pipeline_policy(policy_file)

    def test_compute_trace_pipeline_policy_fingerprint_uses_canonical_payload(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            policy_file = root / "policy-v1.json"
            policy_file.write_text(
                json.dumps(
                    {
                        "schema": "trace_pipeline_policy",
                        "schema_version": 1,
                        "sessions_dir": "sessions",
                        "trace_cases_output": "out/cases.jsonl",
                        "trace_runs_output": "out/runs.jsonl",
                        "clean_cases_output": "out/cases.clean.jsonl",
                        "clean_runs_output": "out/runs.clean.jsonl",
                        "clean_report_output": "out/report.json",
                        "variant": "trace_baseline",
                        "holdout_ratio": 0.2,
                        "seed": 42,
                        "max_cases": 20,
                        "min_chars": 1,
                        "min_prompt_chars": 4,
                        "min_response_chars": 2,
                        "max_exact_duplicates_per_prompt": 1,
                        "similarity_threshold": 0.88,
                        "max_near_duplicates_per_anchor": 1,
                        "min_cases_per_split": 0,
                        "min_clean_cases": 0,
                        "fail_on_low_sample": False,
                        "min_clean_cases_by_split": {},
                        "fail_on_split_underflow": False,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            policy_hash, canonical = compute_trace_pipeline_policy_fingerprint(policy_file)
            self.assertTrue(policy_hash.startswith("sha256:"))
            self.assertEqual(canonical["schema_version"], 2)
            self.assertEqual(canonical["profile"], "custom")
            self.assertEqual(canonical["sessions_dir"], "sessions")
            self.assertNotIn("migrations", canonical)

    def test_trace_pipeline_supports_dry_validate_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sessions_dir = root / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)
            command = [
                sys.executable,
                str(Path(__file__).resolve().parents[1] / "evals" / "trace_pipeline.py"),
                "--sessions-dir",
                str(sessions_dir),
                "--trace-cases-output",
                str(root / "out" / "cases.trace.jsonl"),
                "--trace-runs-output",
                str(root / "out" / "runs.trace.jsonl"),
                "--clean-cases-output",
                str(root / "out" / "cases.clean.jsonl"),
                "--clean-runs-output",
                str(root / "out" / "runs.clean.jsonl"),
                "--clean-report-output",
                str(root / "out" / "report.json"),
                "--dry-validate-only",
                "--print-json",
            ]
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(completed.stdout)
            self.assertTrue(payload["dry_validate_only"])
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["errors"], [])

    def test_trace_pipeline_dry_validate_only_fails_for_missing_sessions(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            missing_sessions = root / "missing"
            command = [
                sys.executable,
                str(Path(__file__).resolve().parents[1] / "evals" / "trace_pipeline.py"),
                "--sessions-dir",
                str(missing_sessions),
                "--trace-cases-output",
                str(root / "out" / "cases.trace.jsonl"),
                "--trace-runs-output",
                str(root / "out" / "runs.trace.jsonl"),
                "--clean-cases-output",
                str(root / "out" / "cases.clean.jsonl"),
                "--clean-runs-output",
                str(root / "out" / "runs.clean.jsonl"),
                "--clean-report-output",
                str(root / "out" / "report.json"),
                "--dry-validate-only",
                "--print-json",
            ]
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(completed.returncode, 1)
            payload = json.loads(completed.stdout)
            self.assertTrue(payload["dry_validate_only"])
            self.assertFalse(payload["ok"])
            self.assertTrue(
                any("sessions_dir does not exist" in item for item in payload["errors"]),
                msg=payload["errors"],
            )

    def test_run_trace_pipeline_supports_parameterized_flow(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sessions_dir = root / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)

            payload = {
                "version": 1,
                "updated_at": "2026-04-10T00:00:00Z",
                "session_key": "feishu:grobot:dm:pipeline",
                "messages": [
                    {"role": "user", "content": "请检查 token 并修复流程"},
                    {"role": "assistant", "content": "已处理 token 风险并给出修复流程。"},
                    {"role": "user", "content": "请检查 token 并修复方案"},
                    {"role": "assistant", "content": "已处理 token 风险并给出修复方案。"},
                ],
            }
            (sessions_dir / "s1.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            whitelist_file = root / "whitelist.txt"
            whitelist_file.write_text("feishu_grobot_dm_pipeline_0002\n", encoding="utf-8")

            trace_cases_output = root / "cases.trace.jsonl"
            trace_runs_output = root / "runs.trace.jsonl"
            clean_cases_output = root / "cases.clean.jsonl"
            clean_runs_output = root / "runs.clean.jsonl"
            clean_report_output = root / "clean.report.json"

            report = run_trace_pipeline(
                sessions_dir=sessions_dir,
                trace_cases_output=trace_cases_output,
                trace_runs_output=trace_runs_output,
                variant="trace_baseline",
                holdout_ratio=0.2,
                seed=42,
                max_cases=2,
                min_chars=1,
                clean_cases_output=clean_cases_output,
                clean_runs_output=clean_runs_output,
                clean_report_output=clean_report_output,
                min_prompt_chars=1,
                min_response_chars=1,
                max_exact_duplicates_per_prompt=1,
                similarity_threshold=0.7,
                max_near_duplicates_per_anchor=0,
                whitelist_case_ids_file=whitelist_file,
                min_cases_per_split=0,
                min_clean_cases=1,
                fail_on_low_sample=False,
                min_clean_cases_by_split={"optimization": 1},
                fail_on_split_underflow=False,
            )

            self.assertEqual(report["mine"]["stats"]["generated_cases"], 2)
            self.assertEqual(report["clean"]["stats"]["output_cases"], 2)
            self.assertEqual(report["clean"]["stats"]["kept_by_whitelist_cases"], 1)
            self.assertTrue(report["sample_guard"]["pass"])
            self.assertTrue(report["sample_guard"]["split"]["pass"])

            cleaned_cases = _read_jsonl(clean_cases_output)
            by_id = {str(item["id"]): item for item in cleaned_cases}
            self.assertIn("feishu_grobot_dm_pipeline_0001", by_id)
            self.assertIn("feishu_grobot_dm_pipeline_0002", by_id)
            self.assertTrue(by_id["feishu_grobot_dm_pipeline_0002"].get("metadata", {}).get("whitelisted"))

    def test_run_trace_pipeline_fail_on_low_sample(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sessions_dir = root / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)

            payload = {
                "version": 1,
                "updated_at": "2026-04-10T00:00:00Z",
                "session_key": "feishu:grobot:dm:low-sample",
                "messages": [
                    {"role": "user", "content": "短"},
                    {"role": "assistant", "content": "ok"},
                ],
            }
            (sessions_dir / "s1.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            with self.assertRaises(RuntimeError):
                run_trace_pipeline(
                    sessions_dir=sessions_dir,
                    trace_cases_output=root / "cases.trace.jsonl",
                    trace_runs_output=root / "runs.trace.jsonl",
                    variant="trace_baseline",
                    holdout_ratio=0.2,
                    seed=42,
                    max_cases=10,
                    min_chars=1,
                    clean_cases_output=root / "cases.clean.jsonl",
                    clean_runs_output=root / "runs.clean.jsonl",
                    clean_report_output=root / "clean.report.json",
                    min_prompt_chars=4,
                    min_response_chars=1,
                    max_exact_duplicates_per_prompt=1,
                    similarity_threshold=0.8,
                    max_near_duplicates_per_anchor=0,
                    whitelist_case_ids_file=None,
                    min_cases_per_split=0,
                    min_clean_cases=1,
                    fail_on_low_sample=True,
                    min_clean_cases_by_split={},
                    fail_on_split_underflow=False,
                )

    def test_run_trace_pipeline_fail_on_split_underflow(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sessions_dir = root / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)

            payload = {
                "version": 1,
                "updated_at": "2026-04-10T00:00:00Z",
                "session_key": "feishu:grobot:dm:split-underflow",
                "messages": [
                    {"role": "user", "content": "请修复 token 泄露"},
                    {"role": "assistant", "content": "已修复 token 泄露。"},
                    {"role": "user", "content": "请补充 read edit 流程"},
                    {"role": "assistant", "content": "先 read 再 edit。"},
                ],
            }
            (sessions_dir / "s1.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            with self.assertRaises(RuntimeError):
                run_trace_pipeline(
                    sessions_dir=sessions_dir,
                    trace_cases_output=root / "cases.trace.jsonl",
                    trace_runs_output=root / "runs.trace.jsonl",
                    variant="trace_baseline",
                    holdout_ratio=0.0,
                    seed=42,
                    max_cases=10,
                    min_chars=1,
                    clean_cases_output=root / "cases.clean.jsonl",
                    clean_runs_output=root / "runs.clean.jsonl",
                    clean_report_output=root / "clean.report.json",
                    min_prompt_chars=1,
                    min_response_chars=1,
                    max_exact_duplicates_per_prompt=1,
                    similarity_threshold=0.8,
                    max_near_duplicates_per_anchor=0,
                    whitelist_case_ids_file=None,
                    min_cases_per_split=0,
                    min_clean_cases=1,
                    fail_on_low_sample=False,
                    min_clean_cases_by_split={"holdout": 1, "optimization": 1},
                    fail_on_split_underflow=True,
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
