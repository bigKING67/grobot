#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

if __package__ in (None, ""):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from evals.runner import run_harness  # type: ignore[import-not-found]
else:
    from .runner import run_harness


@dataclass(frozen=True)
class VariantMetrics:
    name: str
    gate_passed: bool
    optimization_avg: float
    optimization_pass_rate: float
    holdout_avg: float
    holdout_pass_rate: float

    @classmethod
    def from_report_variant(cls, name: str, payload: dict[str, Any]) -> "VariantMetrics":
        gate = payload.get("gate", {})
        splits = payload.get("splits", {})
        optimization = splits.get("optimization", {})
        holdout = splits.get("holdout", {})
        return cls(
            name=name,
            gate_passed=bool(gate.get("passed", False)),
            optimization_avg=float(optimization.get("average_score", 0.0)),
            optimization_pass_rate=float(optimization.get("pass_rate", 0.0)),
            holdout_avg=float(holdout.get("average_score", 0.0)),
            holdout_pass_rate=float(holdout.get("pass_rate", 0.0)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "gate_passed": self.gate_passed,
            "optimization_avg": self.optimization_avg,
            "optimization_pass_rate": self.optimization_pass_rate,
            "holdout_avg": self.holdout_avg,
            "holdout_pass_rate": self.holdout_pass_rate,
        }


def _merge_jsonl(input_paths: list[Path], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as output:
        for input_path in input_paths:
            with input_path.open("r", encoding="utf-8") as source:
                for line in source:
                    stripped = line.strip()
                    if not stripped or stripped.startswith("#"):
                        continue
                    output.write(stripped)
                    output.write("\n")


def hill_climb_from_report(
    *,
    report: dict[str, Any],
    baseline_variant: str,
    min_optimization_gain: float,
    allow_holdout_drop: float,
) -> dict[str, Any]:
    variants_payload = report.get("variants")
    if not isinstance(variants_payload, dict):
        raise ValueError("report.variants must be a dict")

    metrics_map: dict[str, VariantMetrics] = {}
    for variant_name, payload in variants_payload.items():
        if not isinstance(variant_name, str) or not isinstance(payload, dict):
            continue
        metrics_map[variant_name] = VariantMetrics.from_report_variant(variant_name, payload)

    if baseline_variant not in metrics_map:
        raise ValueError(f"baseline variant not found: {baseline_variant}")

    current = metrics_map[baseline_variant]
    remaining = {name for name in metrics_map if name != baseline_variant}
    trail: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    while remaining:
        best_candidate: VariantMetrics | None = None
        best_gain = 0.0

        for candidate_name in sorted(remaining):
            candidate = metrics_map[candidate_name]
            if not candidate.gate_passed:
                rejected.append({"variant": candidate_name, "reason": "gate_failed"})
                continue
            holdout_drop = current.holdout_avg - candidate.holdout_avg
            holdout_pass_drop = current.holdout_pass_rate - candidate.holdout_pass_rate
            if holdout_drop > allow_holdout_drop or holdout_pass_drop > allow_holdout_drop:
                rejected.append(
                    {
                        "variant": candidate_name,
                        "reason": "holdout_regression",
                        "holdout_drop": holdout_drop,
                        "holdout_pass_rate_drop": holdout_pass_drop,
                    }
                )
                continue
            gain = candidate.optimization_avg - current.optimization_avg
            if gain <= min_optimization_gain:
                rejected.append({"variant": candidate_name, "reason": "insufficient_optimization_gain", "gain": gain})
                continue
            if best_candidate is None or gain > best_gain:
                best_candidate = candidate
                best_gain = gain

        if best_candidate is None:
            break

        trail.append(
            {
                "from": current.name,
                "to": best_candidate.name,
                "optimization_gain": best_candidate.optimization_avg - current.optimization_avg,
                "holdout_delta": best_candidate.holdout_avg - current.holdout_avg,
                "holdout_pass_rate_delta": best_candidate.holdout_pass_rate - current.holdout_pass_rate,
            }
        )
        current = best_candidate
        remaining.discard(best_candidate.name)

    return {
        "winner": current.name,
        "winner_metrics": current.to_dict(),
        "baseline": baseline_variant,
        "trail": trail,
        "rejected": rejected,
        "metrics": {name: metric.to_dict() for name, metric in sorted(metrics_map.items(), key=lambda item: item[0])},
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Hill-climb model/prompt/tool strategy variants using harness report metrics"
    )
    parser.add_argument("--cases", required=True, type=Path, help="Path to eval cases JSONL")
    parser.add_argument(
        "--runs",
        required=True,
        type=Path,
        nargs="+",
        help="One or more runs JSONL files (merged before evaluation)",
    )
    parser.add_argument("--gate-policy", type=Path, default=None)
    parser.add_argument("--baseline-variant", required=True, type=str)
    parser.add_argument("--min-optimization-gain", type=float, default=0.0)
    parser.add_argument(
        "--allow-holdout-drop",
        type=float,
        default=0.0,
        help="Allowed drop for holdout average and pass_rate when accepting candidate",
    )
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--print-json", action="store_true")
    parser.add_argument(
        "--fail-if-no-improvement",
        action="store_true",
        help="Exit with non-zero code when winner is baseline variant",
    )
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    with NamedTemporaryFile("w", suffix=".jsonl", delete=True) as handle:
        temp_runs = Path(handle.name)
        _merge_jsonl(args.runs, temp_runs)
        report = run_harness(case_file=args.cases, run_file=temp_runs, gate_policy_file=args.gate_policy)

    result = hill_climb_from_report(
        report=report,
        baseline_variant=args.baseline_variant,
        min_optimization_gain=args.min_optimization_gain,
        allow_holdout_drop=args.allow_holdout_drop,
    )

    winner = result["winner"]
    baseline = result["baseline"]
    improved = winner != baseline
    print(
        f"winner={winner} baseline={baseline} improved={str(improved).lower()} "
        f"trail_steps={len(result['trail'])}"
    )

    if args.print_json:
        print(json.dumps({"result": result, "report": report}, ensure_ascii=False, indent=2))
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8") as handle:
            json.dump({"result": result, "report": report}, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    if args.fail_if_no_improvement and not improved:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
