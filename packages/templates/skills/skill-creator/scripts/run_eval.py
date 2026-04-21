#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Supports multiple backends through a runner adapter layer:
- claude-cli
- codex-cli
- openai-compatible
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from scripts.runner_adapters import RunnerContext, build_runner
    from scripts.utils import parse_skill_md
except ModuleNotFoundError:
    # Support direct execution: python scripts/run_eval.py ...
    from runner_adapters import RunnerContext, build_runner
    from utils import parse_skill_md


def find_project_root(start_dir: Path | None = None) -> Path:
    """Find project root by walking up for .claude/, else fallback to cwd."""
    current = (start_dir or Path.cwd()).resolve()
    for parent in [current, *current.parents]:
        if (parent / ".claude").is_dir():
            return parent
    return current


def load_eval_set(eval_path: Path) -> list[dict[str, Any]]:
    """Load and normalize eval-set JSON formats."""
    raw = json.loads(eval_path.read_text())

    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict) and "evals" in raw:
        # Support generic evals.json by mapping prompt -> query when present.
        items = []
        for index, entry in enumerate(raw["evals"]):
            query = entry.get("query") or entry.get("prompt")
            if not query:
                raise ValueError(f"evals[{index}] missing query/prompt")
            if "should_trigger" not in entry:
                raise ValueError(
                    f"evals[{index}] missing should_trigger. "
                    "Trigger-eval requires explicit positive/negative labels."
                )
            items.append(
                {
                    "query": query,
                    "should_trigger": bool(entry["should_trigger"]),
                }
            )
    else:
        raise ValueError("Eval set must be a JSON array or an object with an 'evals' array.")

    normalized: list[dict[str, Any]] = []
    for idx, entry in enumerate(items):
        query = entry.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ValueError(f"Entry {idx} has invalid query")
        if "should_trigger" not in entry:
            raise ValueError(f"Entry {idx} missing should_trigger")
        normalized.append(
            {
                "query": query.strip(),
                "should_trigger": bool(entry["should_trigger"]),
            }
        )
    return normalized


def parse_runner_config(raw: str | None) -> dict[str, Any]:
    """Parse runner config from JSON string or file path."""
    if not raw:
        return {}
    candidate_path = Path(raw)
    if candidate_path.exists():
        return json.loads(candidate_path.read_text())
    return json.loads(raw)


def evaluate_single_run(
    query: str,
    runner_name: str,
    context: RunnerContext,
) -> bool:
    """Execute one trigger evaluation run."""
    runner = build_runner(runner_name)
    return runner.detect_trigger(query, context)


def run_eval(
    eval_set: list[dict[str, Any]],
    skill_name: str,
    description: str,
    num_workers: int,
    timeout: int,
    project_root: Path,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
    runner_name: str = "claude-cli",
    runner_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run full trigger eval and return aggregated results."""
    context = RunnerContext(
        skill_name=skill_name,
        skill_description=description,
        project_root=project_root,
        timeout_seconds=timeout,
        model=model,
        runner_config=runner_config or {},
    )

    future_to_query: dict[Any, str] = {}
    query_items: dict[str, dict[str, Any]] = {}
    query_triggers: dict[str, list[bool]] = {}

    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        for item in eval_set:
            query = item["query"]
            query_items[query] = item
            query_triggers.setdefault(query, [])
            for _ in range(runs_per_query):
                future = executor.submit(evaluate_single_run, query, runner_name, context)
                future_to_query[future] = query

        for future in as_completed(future_to_query):
            query = future_to_query[future]
            try:
                query_triggers[query].append(bool(future.result()))
            except Exception as exc:
                print(f"Warning: query failed ({query[:80]}): {exc}", file=sys.stderr)
                query_triggers[query].append(False)

    results: list[dict[str, Any]] = []
    for query, triggers in query_triggers.items():
        item = query_items[query]
        trigger_rate = sum(triggers) / len(triggers) if triggers else 0.0
        should_trigger = bool(item["should_trigger"])
        did_pass = (
            trigger_rate >= trigger_threshold
            if should_trigger
            else trigger_rate < trigger_threshold
        )
        results.append(
            {
                "query": query,
                "should_trigger": should_trigger,
                "trigger_rate": trigger_rate,
                "triggers": sum(triggers),
                "runs": len(triggers),
                "pass": did_pass,
            }
        )

    results.sort(key=lambda item: item["query"])
    passed = sum(1 for item in results if item["pass"])
    total = len(results)

    return {
        "skill_name": skill_name,
        "description": description,
        "results": results,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": total - passed,
        },
        "metadata": {
            "runner": runner_name,
            "model": model,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "project_root": str(project_root),
            "runs_per_query": runs_per_query,
            "trigger_threshold": trigger_threshold,
            "timeout_seconds": timeout,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run trigger evaluation for a skill description")
    parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override description to test")
    parser.add_argument("--num-workers", type=int, default=10, help="Number of parallel workers")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Runs per query")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger threshold")
    parser.add_argument("--model", default=None, help="Model override for selected runner")
    parser.add_argument(
        "--runner",
        default="claude-cli",
        choices=["claude-cli", "codex-cli", "openai-compatible"],
        help="Runner backend",
    )
    parser.add_argument(
        "--runner-config",
        default="{}",
        help="JSON string or path to JSON config file for the selected runner",
    )
    parser.add_argument(
        "--project-root",
        default=None,
        help="Optional project root (defaults to auto-detected root for claude-cli behavior)",
    )
    parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
    args = parser.parse_args()

    skill_path = Path(args.skill_path)
    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    try:
        eval_set = load_eval_set(Path(args.eval_set))
        runner_config = parse_runner_config(args.runner_config)
    except Exception as exc:
        print(f"Error: failed to parse input data: {exc}", file=sys.stderr)
        sys.exit(1)

    skill_name, original_description, _ = parse_skill_md(skill_path)
    description = args.description or original_description
    project_root = (
        Path(args.project_root).resolve()
        if args.project_root
        else find_project_root(skill_path.parent)
    )

    if args.verbose:
        print(f"Runner: {args.runner}", file=sys.stderr)
        print(f"Project root: {project_root}", file=sys.stderr)
        print(f"Description under test: {description}", file=sys.stderr)

    output = run_eval(
        eval_set=eval_set,
        skill_name=skill_name,
        description=description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        project_root=project_root,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        model=args.model,
        runner_name=args.runner,
        runner_config=runner_config,
    )

    if args.verbose:
        summary = output["summary"]
        print(f"Results: {summary['passed']}/{summary['total']} passed", file=sys.stderr)
        for result in output["results"]:
            status = "PASS" if result["pass"] else "FAIL"
            print(
                f"  [{status}] {result['triggers']}/{result['runs']} "
                f"expected={result['should_trigger']}: {result['query'][:70]}",
                file=sys.stderr,
            )

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
