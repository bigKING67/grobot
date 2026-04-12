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


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            rows.append(json.loads(stripped))
    return rows


class TraceMiningTests(unittest.TestCase):
    def _run_trace_mining(self, args: list[str]) -> dict[str, object]:
        result = run_ts_script("evals/trace-mining.ts", tuple(args))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return json.loads(result.stdout)

    def test_mine_trace_sessions_builds_cases_and_runs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sessions_dir = root / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)

            session_payload = {
                "version": 1,
                "updated_at": "2026-04-10T00:00:00Z",
                "session_key": "feishu:grobot:dm:alpha",
                "messages": [
                    {"role": "user", "content": "请 read README 并修改一段说明"},
                    {"role": "assistant", "content": "已完成 README 修改并说明原因。"},
                    {"role": "user", "content": "hello"},
                    {"role": "assistant", "content": "OK"},
                ],
            }
            (sessions_dir / "s1.json").write_text(
                json.dumps(session_payload, ensure_ascii=False),
                encoding="utf-8",
            )
            (sessions_dir / "interrupts.json").write_text(
                json.dumps({"items": {}}, ensure_ascii=False),
                encoding="utf-8",
            )

            cases_output = root / "cases.jsonl"
            runs_output = root / "runs.jsonl"
            payload = self._run_trace_mining(
                [
                    "--sessions-dir",
                    str(sessions_dir),
                    "--cases-output",
                    str(cases_output),
                    "--runs-output",
                    str(runs_output),
                    "--variant",
                    "trace_baseline",
                    "--holdout-ratio",
                    "0.5",
                    "--seed",
                    "42",
                    "--max-cases",
                    "0",
                    "--min-chars",
                    "5",
                ]
            )
            stats = payload.get("stats")
            self.assertIsInstance(stats, dict)
            if not isinstance(stats, dict):
                self.fail("stats must be object")

            self.assertEqual(stats["session_files"], 1)
            self.assertEqual(stats["message_pairs"], 2)
            self.assertEqual(stats["generated_cases"], 1)
            self.assertEqual(stats["skipped_short"], 1)

            cases = _read_jsonl(cases_output)
            runs = _read_jsonl(runs_output)
            self.assertEqual(len(cases), 1)
            self.assertEqual(len(runs), 1)

            case = cases[0]
            run = runs[0]
            self.assertEqual(case["id"], run["case_id"])
            self.assertIn(case["split"], ("optimization", "holdout"))
            expectations = case.get("expectations")
            self.assertIsInstance(expectations, dict)
            if not isinstance(expectations, dict):
                self.fail("expectations should be object")
            required_tools = expectations.get("required_tools")
            self.assertIsInstance(required_tools, list)
            if isinstance(required_tools, list):
                self.assertIn("read", required_tools)

    def test_split_is_deterministic_with_seed(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sessions_dir = root / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)
            payload = {
                "version": 1,
                "updated_at": "2026-04-10T00:00:00Z",
                "session_key": "feishu:grobot:dm:beta",
                "messages": [
                    {"role": "user", "content": "请整理计划"},
                    {"role": "assistant", "content": "计划已整理，包含里程碑和验证。"},
                ],
            }
            (sessions_dir / "session.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            case_a = root / "a.cases.jsonl"
            run_a = root / "a.runs.jsonl"
            case_b = root / "b.cases.jsonl"
            run_b = root / "b.runs.jsonl"

            _ = self._run_trace_mining(
                [
                    "--sessions-dir",
                    str(sessions_dir),
                    "--cases-output",
                    str(case_a),
                    "--runs-output",
                    str(run_a),
                    "--variant",
                    "trace_baseline",
                    "--holdout-ratio",
                    "0.33",
                    "--seed",
                    "7",
                    "--max-cases",
                    "0",
                    "--min-chars",
                    "1",
                ]
            )
            _ = self._run_trace_mining(
                [
                    "--sessions-dir",
                    str(sessions_dir),
                    "--cases-output",
                    str(case_b),
                    "--runs-output",
                    str(run_b),
                    "--variant",
                    "trace_baseline",
                    "--holdout-ratio",
                    "0.33",
                    "--seed",
                    "7",
                    "--max-cases",
                    "0",
                    "--min-chars",
                    "1",
                ]
            )

            cases_first = _read_jsonl(case_a)
            cases_second = _read_jsonl(case_b)
            self.assertEqual(cases_first, cases_second)


if __name__ == "__main__":
    unittest.main(verbosity=2)
