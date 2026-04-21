#!/usr/bin/env python3
"""Run eval + description-improvement loop with pluggable runners."""

from __future__ import annotations

import argparse
import json
import random
import sys
import tempfile
import time
import webbrowser
from pathlib import Path
from typing import Any

try:
    from scripts.generate_report import generate_html
    from scripts.improve_description import improve_description, parse_provider_config
    from scripts.run_eval import (
        find_project_root,
        load_eval_set,
        parse_runner_config,
        run_eval,
    )
    from scripts.utils import parse_skill_md
except ModuleNotFoundError:
    # Support direct execution: python scripts/run_loop.py ...
    from generate_report import generate_html
    from improve_description import improve_description, parse_provider_config
    from run_eval import find_project_root, load_eval_set, parse_runner_config, run_eval
    from utils import parse_skill_md


def split_eval_set(
    eval_set: list[dict[str, Any]],
    holdout: float,
    seed: int = 42,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split eval set into train and test subsets."""
    random.seed(seed)
    positive = [item for item in eval_set if item["should_trigger"]]
    negative = [item for item in eval_set if not item["should_trigger"]]
    random.shuffle(positive)
    random.shuffle(negative)

    n_pos_test = max(1, int(len(positive) * holdout)) if positive else 0
    n_neg_test = max(1, int(len(negative) * holdout)) if negative else 0

    test_set = positive[:n_pos_test] + negative[:n_neg_test]
    train_set = positive[n_pos_test:] + negative[n_neg_test:]
    if not train_set:
        train_set = test_set
        test_set = []
    return train_set, test_set


def run_loop(
    eval_set: list[dict[str, Any]],
    skill_path: Path,
    description_override: str | None,
    num_workers: int,
    timeout: int,
    max_iterations: int,
    runs_per_query: int,
    trigger_threshold: float,
    holdout: float,
    eval_model: str | None,
    improver_model: str,
    verbose: bool,
    runner: str,
    runner_config: dict[str, Any],
    improver_provider: str,
    improver_config: dict[str, Any],
    project_root: Path,
    live_report_path: Path | None = None,
    log_dir: Path | None = None,
) -> dict[str, Any]:
    """Run iterative eval and description optimization loop."""
    skill_name, original_description, skill_content = parse_skill_md(skill_path)
    current_description = description_override or original_description

    if holdout > 0:
        train_set, test_set = split_eval_set(eval_set, holdout)
    else:
        train_set = eval_set
        test_set = []

    if verbose:
        print(
            f"runner={runner} train={len(train_set)} test={len(test_set)} holdout={holdout}",
            file=sys.stderr,
        )

    history: list[dict[str, Any]] = []
    exit_reason = "unknown"

    for iteration in range(1, max_iterations + 1):
        if verbose:
            print(f"\n{'=' * 64}", file=sys.stderr)
            print(f"Iteration {iteration}/{max_iterations}", file=sys.stderr)
            print(f"Description: {current_description}", file=sys.stderr)

        all_queries = train_set + test_set
        eval_start = time.time()
        all_results = run_eval(
            eval_set=all_queries,
            skill_name=skill_name,
            description=current_description,
            num_workers=num_workers,
            timeout=timeout,
            project_root=project_root,
            runs_per_query=runs_per_query,
            trigger_threshold=trigger_threshold,
            model=eval_model,
            runner_name=runner,
            runner_config=runner_config,
        )
        eval_elapsed = time.time() - eval_start

        train_queries = {item["query"] for item in train_set}
        train_result_list = [item for item in all_results["results"] if item["query"] in train_queries]
        test_result_list = [item for item in all_results["results"] if item["query"] not in train_queries]

        train_summary = {
            "passed": sum(1 for item in train_result_list if item["pass"]),
            "failed": sum(1 for item in train_result_list if not item["pass"]),
            "total": len(train_result_list),
        }
        test_summary = {
            "passed": sum(1 for item in test_result_list if item["pass"]),
            "failed": sum(1 for item in test_result_list if not item["pass"]),
            "total": len(test_result_list),
        }

        history.append(
            {
                "iteration": iteration,
                "description": current_description,
                "train_passed": train_summary["passed"],
                "train_failed": train_summary["failed"],
                "train_total": train_summary["total"],
                "train_results": train_result_list,
                "test_passed": test_summary["passed"] if test_set else None,
                "test_failed": test_summary["failed"] if test_set else None,
                "test_total": test_summary["total"] if test_set else None,
                "test_results": test_result_list if test_set else None,
                # Backward compatibility fields for report tooling.
                "passed": train_summary["passed"],
                "failed": train_summary["failed"],
                "total": train_summary["total"],
                "results": train_result_list,
            }
        )

        if live_report_path:
            partial = {
                "original_description": original_description,
                "best_description": current_description,
                "best_score": "in progress",
                "iterations_run": len(history),
                "holdout": holdout,
                "train_size": len(train_set),
                "test_size": len(test_set),
                "history": history,
            }
            live_report_path.write_text(generate_html(partial, auto_refresh=True, skill_name=skill_name))

        if verbose:
            print(
                f"Train: {train_summary['passed']}/{train_summary['total']} | "
                f"Test: {test_summary['passed']}/{test_summary['total'] if test_set else 0} | "
                f"elapsed={eval_elapsed:.1f}s",
                file=sys.stderr,
            )

        if train_summary["failed"] == 0:
            exit_reason = f"all_passed (iteration {iteration})"
            break

        if iteration == max_iterations:
            exit_reason = f"max_iterations ({max_iterations})"
            break

        blinded_history = [{k: v for k, v in item.items() if not k.startswith("test_")} for item in history]
        improved = improve_description(
            skill_name=skill_name,
            skill_content=skill_content,
            current_description=current_description,
            eval_results={"results": train_result_list, "summary": train_summary},
            history=blinded_history,
            model=improver_model,
            provider=improver_provider,
            provider_config=improver_config,
            test_results={"results": test_result_list, "summary": test_summary} if test_set else None,
            log_dir=log_dir,
            iteration=iteration,
        )
        current_description = improved

    if test_set:
        best = max(history, key=lambda item: item.get("test_passed") or 0)
        best_score = f"{best['test_passed']}/{best['test_total']}"
    else:
        best = max(history, key=lambda item: item["train_passed"])
        best_score = f"{best['train_passed']}/{best['train_total']}"

    return {
        "exit_reason": exit_reason,
        "original_description": original_description,
        "best_description": best["description"],
        "best_score": best_score,
        "best_train_score": f"{best['train_passed']}/{best['train_total']}",
        "best_test_score": f"{best['test_passed']}/{best['test_total']}" if test_set else None,
        "final_description": current_description,
        "iterations_run": len(history),
        "holdout": holdout,
        "train_size": len(train_set),
        "test_size": len(test_set),
        "metadata": {
            "runner": runner,
            "improver_provider": improver_provider,
            "eval_model": eval_model,
            "improver_model": improver_model,
            "project_root": str(project_root),
        },
        "history": history,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run eval + improve loop")
    parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override starting description")
    parser.add_argument("--num-workers", type=int, default=10, help="Parallel workers")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds")
    parser.add_argument("--max-iterations", type=int, default=5, help="Max iterations")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Runs per query")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger threshold")
    parser.add_argument("--holdout", type=float, default=0.4, help="Holdout fraction")
    parser.add_argument(
        "--model",
        default=None,
        help="Shared model for both eval and improver (backward compatible)",
    )
    parser.add_argument(
        "--eval-model",
        default=None,
        help="Model used by trigger evaluation runner (optional if runner config already defines one)",
    )
    parser.add_argument(
        "--improver-model",
        default=None,
        help="Model used by description improver provider",
    )
    parser.add_argument(
        "--runner",
        default="claude-cli",
        choices=["claude-cli", "codex-cli", "openai-compatible"],
        help="Trigger-eval runner backend",
    )
    parser.add_argument(
        "--runner-config",
        default="{}",
        help="JSON string or JSON file path for runner settings",
    )
    parser.add_argument(
        "--improver-provider",
        default="anthropic",
        choices=["anthropic", "openai-compatible"],
        help="Provider for description optimization",
    )
    parser.add_argument(
        "--improver-config",
        default="{}",
        help="JSON string or JSON file path for improver provider",
    )
    parser.add_argument("--project-root", default=None, help="Project root override")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    parser.add_argument(
        "--report",
        default="auto",
        help="Report path, 'auto' for temp file, 'none' to disable",
    )
    parser.add_argument(
        "--results-dir",
        default=None,
        help="Persist outputs under a timestamped directory",
    )
    args = parser.parse_args()

    skill_path = Path(args.skill_path)
    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    try:
        eval_set = load_eval_set(Path(args.eval_set))
        runner_config = parse_runner_config(args.runner_config)
        improver_config = parse_provider_config(args.improver_config)
    except Exception as exc:
        print(f"Error: failed to parse input files/config: {exc}", file=sys.stderr)
        sys.exit(1)

    skill_name, _, _ = parse_skill_md(skill_path)
    eval_model = args.eval_model or args.model
    improver_model = args.improver_model or args.model
    if not improver_model:
        print(
            "Error: improver model is required. Use --improver-model or --model.",
            file=sys.stderr,
        )
        sys.exit(1)

    project_root = (
        Path(args.project_root).resolve()
        if args.project_root
        else find_project_root(skill_path.parent)
    )

    if args.report != "none":
        if args.report == "auto":
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            live_report_path = (
                Path(tempfile.gettempdir()) / f"skill_description_report_{skill_path.name}_{timestamp}.html"
            )
        else:
            live_report_path = Path(args.report)
        live_report_path.write_text(
            "<html><body><h1>Starting optimization loop...</h1>"
            "<meta http-equiv='refresh' content='5'></body></html>"
        )
        webbrowser.open(str(live_report_path))
    else:
        live_report_path = None

    if args.results_dir:
        timestamp = time.strftime("%Y-%m-%d_%H%M%S")
        results_dir = Path(args.results_dir) / timestamp
        results_dir.mkdir(parents=True, exist_ok=True)
    else:
        results_dir = None
    log_dir = results_dir / "logs" if results_dir else None

    output = run_loop(
        eval_set=eval_set,
        skill_path=skill_path,
        description_override=args.description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        max_iterations=args.max_iterations,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        holdout=args.holdout,
        eval_model=eval_model,
        improver_model=improver_model,
        verbose=args.verbose,
        runner=args.runner,
        runner_config=runner_config,
        improver_provider=args.improver_provider,
        improver_config=improver_config,
        project_root=project_root,
        live_report_path=live_report_path,
        log_dir=log_dir,
    )

    payload = json.dumps(output, indent=2)
    print(payload)

    if results_dir:
        (results_dir / "results.json").write_text(payload)

    if live_report_path:
        live_report_path.write_text(generate_html(output, auto_refresh=False, skill_name=skill_name))
        print(f"\nReport: {live_report_path}", file=sys.stderr)

    if results_dir and live_report_path:
        (results_dir / "report.html").write_text(
            generate_html(output, auto_refresh=False, skill_name=skill_name)
        )

    if results_dir:
        print(f"Results saved to: {results_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
