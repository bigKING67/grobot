#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from evals.models import (  # type: ignore[import-not-found]
        METRIC_NAMES,
        EvalCase,
        EvalGatePolicy,
        EvalRun,
        RegressionGuard,
        load_eval_cases,
        load_eval_runs,
        load_gate_policy,
    )
    from evals.scoring import (  # type: ignore[import-not-found]
        CaseScore,
        evaluate_case,
        missing_run_score,
        summarize_by_split,
        summarize_overall,
    )
else:
    from .models import (
        METRIC_NAMES,
        EvalCase,
        EvalGatePolicy,
        EvalRun,
        RegressionGuard,
        load_eval_cases,
        load_eval_runs,
        load_gate_policy,
    )
    from .scoring import CaseScore, evaluate_case, missing_run_score, summarize_by_split, summarize_overall


@dataclass(frozen=True)
class GateResult:
    passed: bool
    failures: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {"passed": self.passed, "failures": list(self.failures)}


def _group_runs_by_variant(runs: list[EvalRun]) -> dict[str, dict[str, EvalRun]]:
    grouped: dict[str, dict[str, EvalRun]] = {}
    for run in runs:
        variant_runs = grouped.setdefault(run.variant, {})
        if run.case_id in variant_runs:
            raise ValueError(f"duplicate run for case_id={run.case_id} variant={run.variant}")
        variant_runs[run.case_id] = run
    return grouped


def _evaluate_variant(
    *,
    variant: str,
    cases: list[EvalCase],
    runs_by_case: dict[str, EvalRun],
    policy: EvalGatePolicy,
) -> dict[str, Any]:
    case_scores: list[CaseScore] = []
    for case in cases:
        run = runs_by_case.get(case.case_id)
        if run is None:
            case_scores.append(
                missing_run_score(case, variant=variant, case_pass_threshold=policy.case_pass_threshold)
            )
            continue
        case_scores.append(
            evaluate_case(case, run, case_pass_threshold=policy.case_pass_threshold)
        )

    split_summary = summarize_by_split(case_scores)
    overall_summary = summarize_overall(case_scores)
    gate_result = _apply_variant_gate(policy, split_summary, overall_summary)

    worst_cases = sorted(case_scores, key=lambda item: item.overall_score)[:10]
    return {
        "variant": variant,
        "summary": overall_summary.to_dict(),
        "splits": {name: data.to_dict() for name, data in split_summary.items()},
        "gate": gate_result.to_dict(),
        "worst_cases": [score.to_dict() for score in worst_cases],
        "cases": [score.to_dict() for score in case_scores],
    }


def _apply_variant_gate(
    policy: EvalGatePolicy,
    split_summary: dict[str, Any],
    overall_summary: Any,
) -> GateResult:
    failures: list[str] = []
    for split_name, gate in policy.split_gates.items():
        split_data = split_summary.get(split_name)
        if split_data is None:
            failures.append(f"missing split summary for {split_name}")
            continue
        if split_data.average_score < gate.min_average_score:
            failures.append(
                f"split={split_name} average_score {split_data.average_score:.4f} < {gate.min_average_score:.4f}"
            )
        if split_data.pass_rate < gate.min_pass_rate:
            failures.append(
                f"split={split_name} pass_rate {split_data.pass_rate:.4f} < {gate.min_pass_rate:.4f}"
            )

    for metric_name, minimum_value in policy.min_metric_averages.items():
        metric_average = overall_summary.metric_averages.get(metric_name, 0.0)
        if metric_average < minimum_value:
            failures.append(
                f"metric={metric_name} average {metric_average:.4f} < {minimum_value:.4f}"
            )
    return GateResult(passed=not failures, failures=tuple(failures))


def _apply_regression_guard(
    report: dict[str, Any],
    guard: RegressionGuard,
) -> dict[str, Any] | None:
    variants = report.get("variants")
    if not isinstance(variants, dict):
        return None
    baseline = variants.get(guard.baseline_variant)
    candidate = variants.get(guard.candidate_variant)
    if not isinstance(baseline, dict) or not isinstance(candidate, dict):
        return {
            "passed": False,
            "reason": "baseline or candidate variant missing for regression guard",
        }

    candidate_gate = candidate.get("gate")
    if not isinstance(candidate_gate, dict):
        return None
    failures = candidate_gate.get("failures")
    if not isinstance(failures, list):
        failures = []

    guard_failures: list[str] = []
    for split in guard.splits:
        baseline_split = baseline.get("splits", {}).get(split)
        candidate_split = candidate.get("splits", {}).get(split)
        if not isinstance(baseline_split, dict) or not isinstance(candidate_split, dict):
            guard_failures.append(f"split={split} missing in regression comparison")
            continue
        baseline_score = float(baseline_split.get("average_score", 0.0))
        candidate_score = float(candidate_split.get("average_score", 0.0))
        baseline_pass_rate = float(baseline_split.get("pass_rate", 0.0))
        candidate_pass_rate = float(candidate_split.get("pass_rate", 0.0))

        score_drop = baseline_score - candidate_score
        pass_rate_drop = baseline_pass_rate - candidate_pass_rate
        if score_drop > guard.max_score_drop:
            guard_failures.append(
                f"regression guard: split={split} average_score drop {score_drop:.4f} > {guard.max_score_drop:.4f}"
            )
        if pass_rate_drop > guard.max_pass_rate_drop:
            guard_failures.append(
                f"regression guard: split={split} pass_rate drop {pass_rate_drop:.4f} > {guard.max_pass_rate_drop:.4f}"
            )

    if guard_failures:
        failures.extend(guard_failures)
        candidate_gate["failures"] = failures
        candidate_gate["passed"] = False
    return {
        "passed": not guard_failures,
        "baseline_variant": guard.baseline_variant,
        "candidate_variant": guard.candidate_variant,
        "splits": list(guard.splits),
        "max_score_drop": guard.max_score_drop,
        "max_pass_rate_drop": guard.max_pass_rate_drop,
        "failures": guard_failures,
    }


def run_harness(
    *,
    case_file: Path,
    run_file: Path,
    gate_policy_file: Path | None = None,
) -> dict[str, Any]:
    cases = load_eval_cases(case_file)
    runs = load_eval_runs(run_file)
    policy = load_gate_policy(gate_policy_file)
    grouped_runs = _group_runs_by_variant(runs)
    if not grouped_runs:
        grouped_runs = {"default": {}}

    report: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "case_file": str(case_file),
        "run_file": str(run_file),
        "gate_policy": policy.to_dict(),
        "variants": {},
    }

    for variant_name, runs_by_case in sorted(grouped_runs.items(), key=lambda item: item[0]):
        report["variants"][variant_name] = _evaluate_variant(
            variant=variant_name,
            cases=cases,
            runs_by_case=runs_by_case,
            policy=policy,
        )

    if policy.regression_guard is not None:
        report["regression_guard"] = _apply_regression_guard(report, policy.regression_guard)
    return report


def _print_summary(report: dict[str, Any]) -> None:
    variants = report.get("variants", {})
    if not isinstance(variants, dict):
        print("no variants evaluated")
        return

    for variant, payload in sorted(variants.items(), key=lambda item: item[0]):
        if not isinstance(payload, dict):
            continue
        summary = payload.get("summary", {})
        gate = payload.get("gate", {})
        average_score = float(summary.get("average_score", 0.0))
        pass_rate = float(summary.get("pass_rate", 0.0))
        case_count = int(summary.get("case_count", 0))
        gate_status = "PASS" if bool(gate.get("passed", False)) else "FAIL"
        print(
            f"[variant={variant}] cases={case_count} avg_score={average_score:.4f} "
            f"pass_rate={pass_rate:.4f} gate={gate_status}"
        )
        split_map = payload.get("splits", {})
        if isinstance(split_map, dict):
            for split, split_info in sorted(split_map.items(), key=lambda item: item[0]):
                if not isinstance(split_info, dict):
                    continue
                split_avg = float(split_info.get("average_score", 0.0))
                split_pass_rate = float(split_info.get("pass_rate", 0.0))
                print(
                    f"  - split={split} avg_score={split_avg:.4f} pass_rate={split_pass_rate:.4f}"
                )
        failures = gate.get("failures", [])
        if isinstance(failures, list) and failures:
            for failure in failures:
                print(f"    gate_failure: {failure}")

    regression_guard = report.get("regression_guard")
    if isinstance(regression_guard, dict):
        passed = bool(regression_guard.get("passed", False))
        status = "PASS" if passed else "FAIL"
        print(f"[regression_guard] {status}")
        failures = regression_guard.get("failures", [])
        if isinstance(failures, list):
            for failure in failures:
                print(f"  - {failure}")


def report_has_gate_failure(report: dict[str, Any]) -> bool:
    variants = report.get("variants")
    if isinstance(variants, dict):
        for payload in variants.values():
            if not isinstance(payload, dict):
                continue
            gate = payload.get("gate")
            if isinstance(gate, dict) and not bool(gate.get("passed", False)):
                return True
    regression_guard = report.get("regression_guard")
    if isinstance(regression_guard, dict) and not bool(regression_guard.get("passed", False)):
        return True
    return False


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Agent-level eval harness runner (optimization + holdout + regression guard)"
    )
    parser.add_argument("--cases", required=True, type=Path, help="Path to eval cases JSONL")
    parser.add_argument("--runs", required=True, type=Path, help="Path to run results JSONL")
    parser.add_argument(
        "--gate-policy",
        type=Path,
        default=None,
        help="Optional gate policy JSON path",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional report JSON output path",
    )
    parser.add_argument(
        "--print-json",
        action="store_true",
        help="Print full report JSON to stdout",
    )
    parser.add_argument(
        "--fail-on-gate",
        action="store_true",
        help="Exit with non-zero code if any variant gate (or regression guard) fails",
    )
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    report = run_harness(case_file=args.cases, run_file=args.runs, gate_policy_file=args.gate_policy)
    _print_summary(report)
    if args.print_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    if args.fail_on_gate and report_has_gate_failure(report):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
