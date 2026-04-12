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


class SkillRouterTrendMetaTests(unittest.TestCase):
    def _write_json(self, path: Path, payload: dict) -> None:
        path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")

    def _run_cli(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return run_ts_script("evals/skill-router-trend-meta.ts", tuple([*args, "--print-json"]))

    def test_build_skill_router_trend_meta_defaults(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            report_path = root / "report.json"
            base_report_path = root / "base.json"
            self._write_json(report_path, {})
            self._write_json(base_report_path, {})

            completed = self._run_cli(
                [
                    "--report",
                    str(report_path),
                    "--base-report",
                    str(base_report_path),
                ]
            )
            self.assertEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            trend_meta = payload["skill_router_trend_meta"]

        self.assertEqual(trend_meta["mode"], "gate_only")
        self.assertEqual(trend_meta["reason"], "unknown")
        self.assertEqual(trend_meta["required"], False)
        self.assertEqual(trend_meta["executed"], False)
        self.assertEqual(trend_meta["baseline_available"], False)
        self.assertIsNone(trend_meta["base_sha"])
        self.assertIsNone(trend_meta["policy_blob_current"])
        self.assertIsNone(trend_meta["policy_blob_base"])
        self.assertIsNone(trend_meta.get("policy_blob_match"))
        self.assertIsNone(trend_meta["policy_hash_current"])
        self.assertIsNone(trend_meta["policy_hash_base"])
        self.assertIsNone(trend_meta["policy_hash_match"])

    def test_build_skill_router_trend_meta_hash_match(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            report_path = root / "report.json"
            base_report_path = root / "base.json"
            self._write_json(report_path, {"policy": {"hash": "hash-current"}})
            self._write_json(base_report_path, {"policy_hash": "hash-current"})

            completed = self._run_cli(
                [
                    "--report",
                    str(report_path),
                    "--base-report",
                    str(base_report_path),
                    "--trend-mode",
                    "gate_and_trend",
                    "--trend-reason",
                    "policy_blob_match",
                    "--trend-required",
                    "true",
                    "--baseline-available",
                    "true",
                    "--base-sha",
                    "abc123",
                    "--current-policy-blob",
                    "blob-current",
                    "--base-policy-blob",
                    "blob-base",
                    "--policy-blob-match",
                    "true",
                ]
            )
            self.assertEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            trend_meta = payload["skill_router_trend_meta"]

        self.assertEqual(trend_meta["mode"], "gate_and_trend")
        self.assertEqual(trend_meta["reason"], "policy_blob_match")
        self.assertEqual(trend_meta["required"], True)
        self.assertEqual(trend_meta["executed"], True)
        self.assertEqual(trend_meta["baseline_available"], True)
        self.assertEqual(trend_meta["policy_hash_current"], "hash-current")
        self.assertEqual(trend_meta["policy_hash_base"], "hash-current")
        self.assertEqual(trend_meta["policy_hash_match"], True)

    def test_main_writes_trend_meta_to_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            report_path = root / "report.json"
            base_report_path = root / "report.base.json"
            self._write_json(report_path, {"summary": {"accuracy": 0.81}, "policy": {"hash": "hash-next"}})
            self._write_json(base_report_path, {"summary": {"accuracy": 0.79}, "policy_hash": "hash-prev"})

            completed = self._run_cli(
                [
                    "--report",
                    str(report_path),
                    "--base-report",
                    str(base_report_path),
                    "--trend-mode",
                    "gate_only",
                    "--trend-reason",
                    "policy_blob_mismatch",
                    "--trend-required",
                    "false",
                    "--baseline-available",
                    "true",
                    "--base-sha",
                    "0000000000000000000000000000000000000000",
                    "--current-policy-blob",
                    "blob-next",
                    "--base-policy-blob",
                    "blob-prev",
                    "--policy-blob-match",
                    "false",
                ]
            )
            self.assertEqual(completed.returncode, 0)
            stdout_payload = json.loads(completed.stdout)
            self.assertIn("skill_router_trend_meta", stdout_payload)
            trend_meta = stdout_payload["skill_router_trend_meta"]
            self.assertEqual(trend_meta["mode"], "gate_only")
            self.assertEqual(trend_meta["reason"], "policy_blob_mismatch")
            self.assertEqual(trend_meta["policy_blob_match"], False)
            self.assertEqual(trend_meta["policy_hash_current"], "hash-next")
            self.assertEqual(trend_meta["policy_hash_base"], "hash-prev")
            self.assertEqual(trend_meta["policy_hash_match"], False)
            self.assertIsNone(trend_meta["base_sha"])

            report_payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertIn("trend_meta", report_payload)
            self.assertEqual(report_payload["trend_meta"]["reason"], "policy_blob_mismatch")


if __name__ == "__main__":
    unittest.main(verbosity=2)
