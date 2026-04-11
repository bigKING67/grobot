#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.skill_router_trend_meta import build_skill_router_trend_meta  # noqa: E402


class SkillRouterTrendMetaTests(unittest.TestCase):
    SCRIPT_PATH = Path(__file__).resolve().parents[1] / "evals" / "skill_router_trend_meta.py"

    def test_build_skill_router_trend_meta_defaults(self) -> None:
        trend_meta = build_skill_router_trend_meta(
            current_report={},
            base_report={},
            trend_mode="",
            trend_reason="",
            trend_required="unknown",
            baseline_available="unknown",
            base_sha="",
            current_policy_blob="",
            base_policy_blob="",
            policy_blob_match="unknown",
        )
        self.assertEqual(trend_meta["mode"], "gate_only")
        self.assertEqual(trend_meta["reason"], "unknown")
        self.assertEqual(trend_meta["required"], False)
        self.assertEqual(trend_meta["executed"], False)
        self.assertIsNone(trend_meta["baseline_available"])
        self.assertIsNone(trend_meta["base_sha"])
        self.assertIsNone(trend_meta["policy_blob_current"])
        self.assertIsNone(trend_meta["policy_blob_base"])
        self.assertIsNone(trend_meta["policy_blob_match"])
        self.assertIsNone(trend_meta["policy_hash_current"])
        self.assertIsNone(trend_meta["policy_hash_base"])
        self.assertIsNone(trend_meta["policy_hash_match"])

    def test_build_skill_router_trend_meta_hash_match(self) -> None:
        trend_meta = build_skill_router_trend_meta(
            current_report={"policy": {"hash": "hash-current"}},
            base_report={"policy_hash": "hash-current"},
            trend_mode="gate_and_trend",
            trend_reason="policy_blob_match",
            trend_required="true",
            baseline_available="true",
            base_sha="abc123",
            current_policy_blob="blob-current",
            base_policy_blob="blob-base",
            policy_blob_match="true",
        )
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
            report_path.write_text(
                json.dumps({"summary": {"accuracy": 0.81}, "policy": {"hash": "hash-next"}}) + "\n",
                encoding="utf-8",
            )
            base_report_path.write_text(
                json.dumps({"summary": {"accuracy": 0.79}, "policy_hash": "hash-prev"}) + "\n",
                encoding="utf-8",
            )
            command = [
                sys.executable,
                str(self.SCRIPT_PATH),
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
                "--print-json",
            ]
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
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
