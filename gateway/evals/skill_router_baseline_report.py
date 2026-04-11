#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ZERO_SHA = "0000000000000000000000000000000000000000"


def _normalize_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized or normalized == ZERO_SHA:
        return None
    return normalized


def resolve_base_sha(*, event_name: str, pr_base_sha: Any, before_sha: Any) -> str | None:
    if event_name == "pull_request":
        return _normalize_optional_text(pr_base_sha)
    return _normalize_optional_text(before_sha)


def _write_github_output(*, github_output_path: Path, available: bool) -> None:
    with github_output_path.open("a", encoding="utf-8") as handle:
        handle.write(f"available={'true' if available else 'false'}\n")


def _run_subprocess(command: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd) if isinstance(cwd, Path) else None,
        capture_output=True,
        text=True,
        check=False,
    )


def build_skill_router_baseline_report(
    *,
    event_name: str,
    pr_base_sha: str | None,
    before_sha: str | None,
    repo_root: Path,
    output_path: Path,
    python_bin: str,
    policy_rel_path: str = "gateway/evals/skill_router_policy.ci.json",
    eval_rel_path: str = "gateway/evals/skill_router_eval.py",
) -> dict[str, Any]:
    base_sha = resolve_base_sha(
        event_name=event_name,
        pr_base_sha=pr_base_sha,
        before_sha=before_sha,
    )
    if base_sha is None:
        return {"available": False, "reason": "no_base_sha", "base_sha": None}

    worktree_dir = Path(tempfile.mkdtemp(prefix="grobot-skill-router-base-", dir="/tmp"))
    try:
        add_result = _run_subprocess(
            ["git", "worktree", "add", "--detach", str(worktree_dir), base_sha],
            cwd=repo_root,
        )
        if add_result.returncode != 0:
            return {
                "available": False,
                "reason": "worktree_add_failed",
                "base_sha": base_sha,
                "stderr": add_result.stderr.strip(),
            }

        eval_path = worktree_dir / eval_rel_path
        policy_path = worktree_dir / policy_rel_path
        if not eval_path.exists() or not policy_path.exists():
            return {
                "available": False,
                "reason": "required_files_missing",
                "base_sha": base_sha,
            }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        run_result = _run_subprocess(
            [
                python_bin,
                str(eval_path),
                "--policy",
                str(policy_path),
                "--print-json",
                "--output",
                str(output_path),
            ],
            cwd=worktree_dir,
        )
        available = output_path.exists()
        return {
            "available": available,
            "reason": "output_present" if available else "output_missing",
            "base_sha": base_sha,
            "eval_returncode": run_result.returncode,
            "eval_stderr": run_result.stderr.strip(),
        }
    finally:
        _run_subprocess(["git", "worktree", "remove", "--force", str(worktree_dir)], cwd=repo_root)
        shutil.rmtree(worktree_dir, ignore_errors=True)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build skill-router baseline report from base commit via git worktree."
    )
    parser.add_argument("--event-name", default="", help="GitHub event name")
    parser.add_argument("--pr-base-sha", default="", help="PR base SHA for pull_request events")
    parser.add_argument("--before-sha", default="", help="github.event.before SHA for push events")
    parser.add_argument("--repo-root", type=Path, default=Path("."), help="repository root path")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("gateway/evals/data/skill_router_ci_report.base.json"),
        help="output path for baseline report",
    )
    parser.add_argument(
        "--github-output",
        type=Path,
        default=None,
        help="GitHub output file path; writes available=true|false",
    )
    parser.add_argument(
        "--python-bin",
        default=sys.executable,
        help="python executable used to run skill_router_eval.py",
    )
    parser.add_argument("--print-json", action="store_true", help="print result JSON")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    try:
        result = build_skill_router_baseline_report(
            event_name=args.event_name,
            pr_base_sha=args.pr_base_sha,
            before_sha=args.before_sha,
            repo_root=args.repo_root.resolve(),
            output_path=args.output.resolve(),
            python_bin=args.python_bin,
        )
    except Exception as error:  # noqa: BLE001
        result = {
            "available": False,
            "reason": "runtime_error",
            "error": f"{type(error).__name__}: {error}",
        }

    if isinstance(args.github_output, Path):
        args.github_output.parent.mkdir(parents=True, exist_ok=True)
        _write_github_output(github_output_path=args.github_output, available=bool(result.get("available")))

    if args.print_json:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
