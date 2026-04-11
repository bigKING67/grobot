#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class SkillRouterCiGateTests(unittest.TestCase):
    SCRIPT_PATH = Path(__file__).resolve().parents[1] / "evals" / "skill_router_ci_gate.py"

    def _write_fake_eval_script(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env python3",
                    "from __future__ import annotations",
                    "",
                    "import argparse",
                    "import json",
                    "import os",
                    "from pathlib import Path",
                    "",
                    "parser = argparse.ArgumentParser()",
                    "parser.add_argument('--policy')",
                    "parser.add_argument('--compare-report', default=None)",
                    "parser.add_argument('--fail-on-gate', action='store_true')",
                    "parser.add_argument('--fail-on-trend', action='store_true')",
                    "parser.add_argument('--print-json', action='store_true')",
                    "parser.add_argument('--output', required=True)",
                    "args = parser.parse_args()",
                    "",
                    "log_path = os.environ.get('SKILL_ROUTER_FAKE_LOG')",
                    "if isinstance(log_path, str) and log_path:",
                    "    with open(log_path, 'a', encoding='utf-8') as handle:",
                    "        handle.write(",
                    "            json.dumps(",
                    "                {",
                    "                    'compare_report': args.compare_report,",
                    "                    'fail_on_gate': args.fail_on_gate,",
                    "                    'fail_on_trend': args.fail_on_trend,",
                    "                },",
                    "                ensure_ascii=False,",
                    "            ) + '\\n'",
                    "        )",
                    "",
                    "policy_hash = os.environ.get('SKILL_ROUTER_FAKE_POLICY_HASH', 'hash-default')",
                    "payload = {",
                    "    'summary': {'accuracy': 1.0, 'forbidden_violations': 0, 'total_cases': 1},",
                    "    'gate': {'passed': True},",
                    "    'policy': {'hash': policy_hash},",
                    "}",
                    "if isinstance(args.compare_report, str) and args.compare_report:",
                    "    trend_pass = os.environ.get('SKILL_ROUTER_FAKE_TREND_PASS', 'true').strip().lower() == 'true'",
                    "    payload['trend'] = {'passed': trend_pass}",
                    "",
                    "output_path = Path(args.output)",
                    "output_path.parent.mkdir(parents=True, exist_ok=True)",
                    "output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\\n', encoding='utf-8')",
                    "",
                    "if args.print_json:",
                    "    print(json.dumps(payload, ensure_ascii=False))",
                    "",
                    "if os.environ.get('SKILL_ROUTER_FAKE_FAIL_GATE', '0') == '1' and not args.compare_report:",
                    "    raise SystemExit(4)",
                    "if os.environ.get('SKILL_ROUTER_FAKE_FAIL_TREND', '0') == '1' and args.compare_report:",
                    "    raise SystemExit(6)",
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
        command = [
            sys.executable,
            str(self.SCRIPT_PATH),
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
            "gateway/evals/skill_router_eval.py",
            "--print-json",
        ]
        command_env = os.environ.copy()
        if isinstance(env, dict):
            command_env.update(env)
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            env=command_env,
        )

    def test_gate_only_when_baseline_unavailable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            head_sha = self._init_git_repo_with_policy(repo_root, policy_text='{"schema":"v1"}\n')
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.py")
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
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.py")
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
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.py")
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
            self._write_fake_eval_script(repo_root / "gateway" / "evals" / "skill_router_eval.py")
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
