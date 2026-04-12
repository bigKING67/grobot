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


class SkillRouterCiGateTests(unittest.TestCase):
    def _write_fake_eval_script(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env node",
                    "const fs = require('node:fs');",
                    "const path = require('node:path');",
                    "",
                    "const argv = process.argv.slice(2);",
                    "const hasFlag = (flag) => argv.includes(flag);",
                    "const getArg = (flag) => {",
                    "  const idx = argv.indexOf(flag);",
                    "  if (idx < 0) return null;",
                    "  const value = argv[idx + 1];",
                    "  return typeof value === 'string' ? value : null;",
                    "};",
                    "",
                    "const compareReport = getArg('--compare-report');",
                    "const outputPath = getArg('--output');",
                    "if (!outputPath) {",
                    "  process.stderr.write('missing --output\\n');",
                    "  process.exit(2);",
                    "}",
                    "",
                    "const logPath = process.env.SKILL_ROUTER_FAKE_LOG;",
                    "if (typeof logPath === 'string' && logPath.length > 0) {",
                    "  fs.appendFileSync(",
                    "    logPath,",
                    "    JSON.stringify(",
                    "      {",
                    "        compare_report: compareReport,",
                    "        fail_on_gate: hasFlag('--fail-on-gate'),",
                    "        fail_on_trend: hasFlag('--fail-on-trend'),",
                    "      },",
                    "      null,",
                    "      0,",
                    "    ) + '\\n',",
                    "    'utf8',",
                    "  );",
                    "}",
                    "",
                    "const policyHash = process.env.SKILL_ROUTER_FAKE_POLICY_HASH || 'hash-default';",
                    "const payload = {",
                    "  summary: { accuracy: 1.0, forbidden_violations: 0, total_cases: 1 },",
                    "  gate: { passed: true },",
                    "  policy: { hash: policyHash },",
                    "};",
                    "if (typeof compareReport === 'string' && compareReport.length > 0) {",
                    "  const trendPass = String(process.env.SKILL_ROUTER_FAKE_TREND_PASS || 'true').trim().toLowerCase() === 'true';",
                    "  payload.trend = { passed: trendPass };",
                    "}",
                    "",
                    "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
                    "fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\\n`, 'utf8');",
                    "",
                    "if (hasFlag('--print-json')) {",
                    "  process.stdout.write(`${JSON.stringify(payload)}\\n`);",
                    "}",
                    "",
                    "if (process.env.SKILL_ROUTER_FAKE_FAIL_GATE === '1' && !compareReport) {",
                    "  process.exit(4);",
                    "}",
                    "if (process.env.SKILL_ROUTER_FAKE_FAIL_TREND === '1' && compareReport) {",
                    "  process.exit(6);",
                    "}",
                ]
            ),
            encoding="utf-8",
        )

    def _init_git_repo_with_policy(self, repo_root: Path, *, policy_text: str) -> str:
        subprocess.run(["git", "init"], cwd=str(repo_root), check=True, capture_output=True, text=True)
        subprocess.run(
            ["git", "config", "user.email", "ci@example.com"],
            cwd=str(repo_root),
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "ci-bot"],
            cwd=str(repo_root),
            check=True,
            capture_output=True,
            text=True,
        )
        policy_path = repo_root / "gateway" / "evals" / "skill_router_policy.ci.json"
        policy_path.parent.mkdir(parents=True, exist_ok=True)
        policy_path.write_text(policy_text, encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=str(repo_root), check=True, capture_output=True, text=True)
        subprocess.run(
            ["git", "commit", "-m", "init policy"],
            cwd=str(repo_root),
            check=True,
            capture_output=True,
            text=True,
        )
        return (
            subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(repo_root),
                check=True,
                capture_output=True,
                text=True,
            )
            .stdout.strip()
        )

    def _run_ci_gate(
        self,
        *,
        repo_root: Path,
        before_sha: str,
        baseline_available: str,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        output_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.json"
        base_report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.base.json"
        args = [
            "--event-name",
            "push",
            "--before-sha",
            before_sha,
            "--baseline-available",
            baseline_available,
            "--repo-root",
            str(repo_root),
            "--output",
            str(output_path),
            "--base-report",
            str(base_report_path),
            "--policy",
            "gateway/evals/skill_router_policy.ci.json",
            "--policy-blob-path",
            "gateway/evals/skill_router_policy.ci.json",
            "--eval-script",
            "gateway/evals/skill_router_eval.js",
            "--print-json",
        ]
        return run_ts_script("evals/skill-router-ci-gate.ts", tuple(args), env=env)

    def test_gate_only_when_baseline_unavailable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            head_sha = self._init_git_repo_with_policy(repo_root, policy_text='{"schema":"v1"}\n')
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.js")
            log_path = repo_root / "eval-call-log.jsonl"
            completed = self._run_ci_gate(
                repo_root=repo_root,
                before_sha=head_sha,
                baseline_available="false",
                env={
                    "SKILL_ROUTER_FAKE_LOG": str(log_path),
                    "SKILL_ROUTER_FAKE_POLICY_HASH": "hash-head",
                },
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            trend_meta = report.get("trend_meta")
            self.assertIsInstance(trend_meta, dict)
            assert isinstance(trend_meta, dict)
            self.assertEqual(trend_meta.get("mode"), "gate_only")
            self.assertEqual(trend_meta.get("reason"), "baseline_unavailable")
            self.assertEqual(trend_meta.get("required"), False)
            self.assertEqual(trend_meta.get("executed"), False)
            log_entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            self.assertEqual(len(log_entries), 1)
            self.assertIsNone(log_entries[0].get("compare_report"))

    def test_executes_trend_when_policy_blob_matches(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            head_sha = self._init_git_repo_with_policy(repo_root, policy_text='{"schema":"v1"}\n')
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.js")
            base_report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.base.json"
            base_report_path.parent.mkdir(parents=True, exist_ok=True)
            base_report_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 1},
                        "policy": {"hash": "hash-head"},
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            log_path = repo_root / "eval-call-log.jsonl"
            completed = self._run_ci_gate(
                repo_root=repo_root,
                before_sha=head_sha,
                baseline_available="true",
                env={
                    "SKILL_ROUTER_FAKE_LOG": str(log_path),
                    "SKILL_ROUTER_FAKE_POLICY_HASH": "hash-head",
                },
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            trend_meta = report.get("trend_meta")
            self.assertIsInstance(trend_meta, dict)
            assert isinstance(trend_meta, dict)
            self.assertEqual(trend_meta.get("mode"), "gate_and_trend")
            self.assertEqual(trend_meta.get("reason"), "policy_blob_match")
            self.assertEqual(trend_meta.get("required"), True)
            self.assertEqual(trend_meta.get("executed"), True)
            self.assertEqual(trend_meta.get("policy_blob_match"), True)
            log_entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            self.assertEqual(len(log_entries), 2)
            self.assertIsNone(log_entries[0].get("compare_report"))
            self.assertTrue(isinstance(log_entries[1].get("compare_report"), str))

    def test_skips_trend_when_policy_blob_mismatch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            base_sha = self._init_git_repo_with_policy(repo_root, policy_text='{"schema":"v1"}\n')
            policy_path = repo_root / "gateway" / "evals" / "skill_router_policy.ci.json"
            policy_path.write_text('{"schema":"v2"}\n', encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=str(repo_root), check=True, capture_output=True, text=True)
            subprocess.run(
                ["git", "commit", "-m", "update policy"],
                cwd=str(repo_root),
                check=True,
                capture_output=True,
                text=True,
            )
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.js")
            base_report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.base.json"
            base_report_path.parent.mkdir(parents=True, exist_ok=True)
            base_report_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 1},
                        "policy": {"hash": "hash-base"},
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            log_path = repo_root / "eval-call-log.jsonl"
            completed = self._run_ci_gate(
                repo_root=repo_root,
                before_sha=base_sha,
                baseline_available="true",
                env={
                    "SKILL_ROUTER_FAKE_LOG": str(log_path),
                    "SKILL_ROUTER_FAKE_POLICY_HASH": "hash-head",
                },
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            trend_meta = report.get("trend_meta")
            self.assertIsInstance(trend_meta, dict)
            assert isinstance(trend_meta, dict)
            self.assertEqual(trend_meta.get("mode"), "gate_only")
            self.assertEqual(trend_meta.get("reason"), "policy_blob_mismatch")
            self.assertEqual(trend_meta.get("required"), False)
            self.assertEqual(trend_meta.get("policy_blob_match"), False)
            log_entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            self.assertEqual(len(log_entries), 1)

    def test_trend_failure_returns_non_zero_and_skips_trend_meta_patch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            head_sha = self._init_git_repo_with_policy(repo_root, policy_text='{"schema":"v1"}\n')
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.js")
            base_report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.base.json"
            base_report_path.parent.mkdir(parents=True, exist_ok=True)
            base_report_path.write_text(
                json.dumps(
                    {
                        "summary": {"accuracy": 1.0, "forbidden_violations": 0, "total_cases": 1},
                        "policy": {"hash": "hash-head"},
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            log_path = repo_root / "eval-call-log.jsonl"
            completed = self._run_ci_gate(
                repo_root=repo_root,
                before_sha=head_sha,
                baseline_available="true",
                env={
                    "SKILL_ROUTER_FAKE_LOG": str(log_path),
                    "SKILL_ROUTER_FAKE_POLICY_HASH": "hash-head",
                    "SKILL_ROUTER_FAKE_FAIL_TREND": "1",
                },
            )
            self.assertEqual(completed.returncode, 6, msg=completed.stderr)
            report_path = repo_root / "gateway" / "evals" / "data" / "skill_router_ci_report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertNotIn("trend_meta", report)
            log_entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            self.assertEqual(len(log_entries), 2)
            self.assertTrue(isinstance(log_entries[1].get("compare_report"), str))


if __name__ == "__main__":
    unittest.main(verbosity=2)
