#!/usr/bin/env python3
from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

try:
    from gateway.tests.ts_contract import run_ts_script
except ModuleNotFoundError:
    from ts_contract import run_ts_script

REDACTED_SECRET = "[REDACTED_SECRET]"


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for item in rows:
            handle.write(json.dumps(item, ensure_ascii=False))
            handle.write("\n")


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            rows.append(json.loads(stripped))
    return rows


class TraceCleanTests(unittest.TestCase):
    def _run_trace_clean(self, args: list[str]) -> dict[str, object]:
        result = run_ts_script("evals/trace-clean.ts", tuple(args))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return json.loads(result.stdout)

    def test_clean_trace_dataset_dedupes_redacts_and_drops_orphan_runs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cases_input = root / "cases.input.jsonl"
            runs_input = root / "runs.input.jsonl"
            cases_output = root / "cases.output.jsonl"
            runs_output = root / "runs.output.jsonl"
            report_output = root / "report.json"
            whitelist_file = root / "whitelist.txt"

            cases = [
                {
                    "id": "case1",
                    "split": "optimization",
                    "prompt": "请检查 sk-abcdefghijklmnopqrstuvwx",
                    "expectations": {"required_substrings": ["sk-abcdefghijk"]},
                },
                {
                    "id": "case2",
                    "split": "optimization",
                    "prompt": "请检查 sk-abcdefghijklmnopqrstuvwx",
                    "expectations": {"required_substrings": ["正常"]},
                },
                {
                    "id": "case3",
                    "split": "holdout",
                    "prompt": "ok",
                    "expectations": {"required_substrings": ["ok", "api_key=abc123"]},
                },
                {
                    "id": "case4",
                    "split": "optimization",
                    "prompt": "请检查 token 泄露并修复",
                    "expectations": {"required_substrings": ["敏感信息"]},
                },
                {
                    "id": "case5",
                    "split": "optimization",
                    "prompt": "请检查 token 泄露并修复流程",
                    "expectations": {"required_substrings": ["流程"]},
                },
                {
                    "id": "case6",
                    "split": "optimization",
                    "prompt": "请检查 token 泄露并修复方案",
                    "expectations": {"required_substrings": ["方案"]},
                },
            ]
            runs = [
                {
                    "case_id": "case1",
                    "variant": "trace_baseline",
                    "assistant_response": "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
                },
                {
                    "case_id": "case1",
                    "variant": "trace_baseline",
                    "assistant_response": "duplicate",
                },
                {
                    "case_id": "case2",
                    "variant": "trace_baseline",
                    "assistant_response": "orphan because case2 dropped as duplicate",
                },
                {
                    "case_id": "case3",
                    "variant": "trace_baseline",
                    "assistant_response": "no",
                },
                {
                    "case_id": "case5",
                    "variant": "trace_baseline",
                    "assistant_response": "处理完成，未泄露任何敏感信息。",
                },
                {
                    "case_id": "case6",
                    "variant": "trace_baseline",
                    "assistant_response": "处理完成，方案见上文。",
                },
            ]
            _write_jsonl(cases_input, cases)
            _write_jsonl(runs_input, runs)
            whitelist_file.write_text("case5\n", encoding="utf-8")

            _ = self._run_trace_clean(
                [
                    "--cases-input",
                    str(cases_input),
                    "--runs-input",
                    str(runs_input),
                    "--cases-output",
                    str(cases_output),
                    "--runs-output",
                    str(runs_output),
                    "--report-output",
                    str(report_output),
                    "--min-prompt-chars",
                    "4",
                    "--min-response-chars",
                    "4",
                    "--max-exact-duplicates-per-prompt",
                    "1",
                    "--similarity-threshold",
                    "0.7",
                    "--max-near-duplicates-per-anchor",
                    "0",
                    "--whitelist-case-ids-file",
                    str(whitelist_file),
                    "--min-cases-per-split",
                    "0",
                ]
            )
            report = json.loads(report_output.read_text(encoding="utf-8"))

            self.assertEqual(report["stats"]["input_cases"], 6)
            self.assertEqual(report["stats"]["output_cases"], 3)
            self.assertEqual(report["stats"]["dropped_duplicate_prompt_cases"], 1)
            self.assertEqual(report["stats"]["dropped_short_prompt_cases"], 1)
            self.assertEqual(report["stats"]["dropped_near_duplicate_cases"], 1)
            self.assertEqual(report["stats"]["kept_by_whitelist_cases"], 1)
            self.assertEqual(report["stats"]["output_runs"], 2)
            self.assertGreaterEqual(report["stats"]["dropped_orphan_runs"], 1)
            self.assertGreaterEqual(report["stats"]["redacted_run_responses"], 1)

            cleaned_cases = _read_jsonl(cases_output)
            cleaned_runs = _read_jsonl(runs_output)
            self.assertEqual(len(cleaned_cases), 3)
            self.assertEqual(len(cleaned_runs), 2)

            by_id = {str(item["id"]): item for item in cleaned_cases}
            self.assertIn("case1", by_id)
            self.assertIn("case4", by_id)
            self.assertIn("case5", by_id)
            self.assertIn(REDACTED_SECRET, str(by_id["case1"]["prompt"]))
            self.assertTrue(by_id["case5"].get("metadata", {}).get("whitelisted"))

            expectations = by_id["case1"].get("expectations")
            self.assertIsInstance(expectations, dict)
            if isinstance(expectations, dict):
                required = expectations.get("required_substrings")
                self.assertIsInstance(required, list)
                if isinstance(required, list):
                    self.assertTrue(any(REDACTED_SECRET in str(item) for item in required))

            run_by_case = {str(item["case_id"]): item for item in cleaned_runs}
            self.assertIn(REDACTED_SECRET, str(run_by_case["case1"]["assistant_response"]))
            self.assertIn("case5", run_by_case)
            self.assertNotIn("case4", run_by_case)

    def test_clean_trace_dataset_keeps_minimum_cases_per_split(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cases_input = root / "cases.input.jsonl"
            runs_input = root / "runs.input.jsonl"
            cases_output = root / "cases.output.jsonl"
            runs_output = root / "runs.output.jsonl"
            report_output = root / "report.json"

            cases = [
                {
                    "id": "h1",
                    "split": "holdout",
                    "prompt": "请检查 token 泄露并修复流程",
                    "expectations": {"required_substrings": ["流程"]},
                },
                {
                    "id": "h2",
                    "split": "holdout",
                    "prompt": "请检查 token 泄露并修复方案",
                    "expectations": {"required_substrings": ["方案"]},
                },
                {
                    "id": "o1",
                    "split": "optimization",
                    "prompt": "请读取文件并给出摘要",
                    "expectations": {"required_substrings": ["摘要"]},
                },
            ]
            runs = [
                {"case_id": "h1", "variant": "trace_baseline", "assistant_response": "流程已修复。"},
                {"case_id": "h2", "variant": "trace_baseline", "assistant_response": "方案已修复。"},
                {"case_id": "o1", "variant": "trace_baseline", "assistant_response": "已给出摘要。"},
            ]
            _write_jsonl(cases_input, cases)
            _write_jsonl(runs_input, runs)

            _ = self._run_trace_clean(
                [
                    "--cases-input",
                    str(cases_input),
                    "--runs-input",
                    str(runs_input),
                    "--cases-output",
                    str(cases_output),
                    "--runs-output",
                    str(runs_output),
                    "--report-output",
                    str(report_output),
                    "--min-prompt-chars",
                    "4",
                    "--min-response-chars",
                    "2",
                    "--max-exact-duplicates-per-prompt",
                    "2",
                    "--similarity-threshold",
                    "0.6",
                    "--max-near-duplicates-per-anchor",
                    "0",
                    "--min-cases-per-split",
                    "2",
                ]
            )
            report = json.loads(report_output.read_text(encoding="utf-8"))

            self.assertEqual(report["stats"]["output_cases"], 3)
            self.assertEqual(report["stats"]["kept_by_split_minimum_cases"], 1)
            self.assertEqual(report["stats"]["dropped_near_duplicate_cases"], 0)
            split_minimum = report.get("split_minimum")
            self.assertIsInstance(split_minimum, dict)
            if isinstance(split_minimum, dict):
                self.assertEqual(split_minimum.get("min_cases_per_split"), 2)
                retained = split_minimum.get("retained_counts")
                self.assertIsInstance(retained, dict)
                if isinstance(retained, dict):
                    self.assertEqual(retained.get("holdout"), 1)

            cleaned_cases = _read_jsonl(cases_output)
            holdout_cases = [item for item in cleaned_cases if item.get("split") == "holdout"]
            self.assertEqual(len(holdout_cases), 2)
            by_id = {str(item["id"]): item for item in cleaned_cases}
            self.assertTrue(by_id["h2"].get("metadata", {}).get("retained_by_split_minimum"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
