#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from evals.skill_router_baseline_report import resolve_base_sha  # type: ignore[import-not-found]
    from evals.skill_router_trend_meta import build_skill_router_trend_meta  # type: ignore[import-not-found]
else:
    from .skill_router_baseline_report import resolve_base_sha
    from .skill_router_trend_meta import build_skill_router_trend_meta


def _normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if not isinstance(value, str):
        return False
    normalized = value.strip().lower()
    return normalized == "true"


def _run_passthrough(command: list[str], *, cwd: Path) -> int:
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        check=False,
    )
    return int(completed.returncode)


def _run_capture(command: list[str], *, cwd: Path) -> str | None:
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    output = completed.stdout.strip()
    return output if output else None


def _load_report(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict):
        return payload
    return {}


def _write_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _run_eval(
    *,
    python_bin: str,
    eval_script: Path,
    policy_path: Path,
    output_path: Path,
    repo_root: Path,
    compare_report: Path | None = None,
) -> int:
    command = [
        python_bin,
        str(eval_script),
        "--policy",
        str(policy_path),
        "--fail-on-gate",
        "--print-json",
        "--output",
        str(output_path),
    ]
    if isinstance(compare_report, Path):
        command.extend(
            [
                "--compare-report",
                str(compare_report),
                "--fail-on-trend",
            ]
        )
    return _run_passthrough(command, cwd=repo_root)


def run_skill_router_ci_gate(
    *,
    event_name: str,
    pr_base_sha: str | None,
    before_sha: str | None,
    baseline_available: Any,
    repo_root: Path,
    output_path: Path,
    base_report_path: Path,
    policy_path: Path,
    policy_blob_path: str,
    eval_script: Path,
    python_bin: str,
) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    output_path = output_path.resolve()
    base_report_path = base_report_path.resolve()
    policy_path = policy_path.resolve()
    eval_script = eval_script.resolve()

    output_path.parent.mkdir(parents=True, exist_ok=True)

    gate_exit_code = _run_eval(
        python_bin=python_bin,
        eval_script=eval_script,
        policy_path=policy_path,
        output_path=output_path,
        repo_root=repo_root,
        compare_report=None,
    )
    if gate_exit_code != 0:
        return {
            "exit_code": gate_exit_code,
            "phase": "gate_eval",
        }

    base_sha = resolve_base_sha(
        event_name=event_name,
        pr_base_sha=pr_base_sha,
        before_sha=before_sha,
    )
    baseline_available_flag = _normalize_bool(baseline_available)

    current_policy_blob = _run_capture(
        ["git", "rev-parse", f"HEAD:{policy_blob_path}"],
        cwd=repo_root,
    )
    base_policy_blob: str | None = None
    if baseline_available_flag and isinstance(base_sha, str):
        base_policy_blob = _run_capture(
            ["git", "rev-parse", f"{base_sha}:{policy_blob_path}"],
            cwd=repo_root,
        )

    trend_mode = "gate_only"
    trend_reason = "baseline_unavailable"
    trend_required = "false"
    policy_blob_match = "unknown"

    if baseline_available_flag:
        trend_reason = "baseline_report_missing"
        if base_report_path.exists():
            trend_reason = "policy_blob_unavailable"
            if isinstance(current_policy_blob, str) and isinstance(base_policy_blob, str):
                if current_policy_blob == base_policy_blob:
                    trend_required = "true"
                    policy_blob_match = "true"
                    trend_exit_code = _run_eval(
                        python_bin=python_bin,
                        eval_script=eval_script,
                        policy_path=policy_path,
                        output_path=output_path,
                        repo_root=repo_root,
                        compare_report=base_report_path,
                    )
                    if trend_exit_code != 0:
                        return {
                            "exit_code": trend_exit_code,
                            "phase": "trend_eval",
                            "trend_mode": "gate_and_trend",
                            "trend_reason": "policy_blob_match",
                        }
                    trend_mode = "gate_and_trend"
                    trend_reason = "policy_blob_match"
                else:
                    policy_blob_match = "false"
                    trend_reason = "policy_blob_mismatch"

    current_report = _load_report(output_path)
    base_report = _load_report(base_report_path)
    trend_meta = build_skill_router_trend_meta(
        current_report=current_report,
        base_report=base_report,
        trend_mode=trend_mode,
        trend_reason=trend_reason,
        trend_required=trend_required,
        baseline_available=baseline_available,
        base_sha=base_sha,
        current_policy_blob=current_policy_blob,
        base_policy_blob=base_policy_blob,
        policy_blob_match=policy_blob_match,
    )
    current_report["trend_meta"] = trend_meta
    _write_report(output_path, current_report)

    return {
        "exit_code": 0,
        "phase": "done",
        "trend_mode": trend_mode,
        "trend_reason": trend_reason,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run skill-router CI gate and patch trend metadata into report."
    )
    parser.add_argument("--event-name", default="", help="GitHub event name")
    parser.add_argument("--pr-base-sha", default="", help="PR base SHA for pull_request events")
    parser.add_argument("--before-sha", default="", help="github.event.before SHA for push events")
    parser.add_argument(
        "--baseline-available",
        default="false",
        help="whether skill-router baseline report is available",
    )
    parser.add_argument("--repo-root", type=Path, default=Path("."), help="repository root path")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("gateway/evals/data/skill_router_ci_report.json"),
        help="path to write current skill-router CI report",
    )
    parser.add_argument(
        "--base-report",
        type=Path,
        default=Path("gateway/evals/data/skill_router_ci_report.base.json"),
        help="path to baseline skill-router report JSON",
    )
    parser.add_argument(
        "--policy",
        type=Path,
        default=Path("gateway/evals/skill_router_policy.ci.json"),
        help="skill-router policy JSON path",
    )
    parser.add_argument(
        "--policy-blob-path",
        default="gateway/evals/skill_router_policy.ci.json",
        help="repository-relative policy path used for git blob comparison",
    )
    parser.add_argument(
        "--eval-script",
        type=Path,
        default=Path("gateway/evals/skill_router_eval.py"),
        help="skill-router eval script path",
    )
    parser.add_argument(
        "--python-bin",
        default=sys.executable,
        help="python executable used to run evaluation scripts",
    )
    parser.add_argument("--print-json", action="store_true", help="print runtime result JSON")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    result = run_skill_router_ci_gate(
        event_name=args.event_name,
        pr_base_sha=args.pr_base_sha,
        before_sha=args.before_sha,
        baseline_available=args.baseline_available,
        repo_root=args.repo_root,
        output_path=args.output,
        base_report_path=args.base_report,
        policy_path=(args.repo_root / args.policy),
        policy_blob_path=args.policy_blob_path,
        eval_script=(args.repo_root / args.eval_script),
        python_bin=args.python_bin,
    )

    if args.print_json:
        print(json.dumps({"skill_router_ci_gate": result}, ensure_ascii=False))

    exit_code = int(result.get("exit_code", 1))
    if exit_code != 0:
        raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
