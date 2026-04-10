#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CASES_OUTPUT = Path("gateway/evals/data/cases.trace.jsonl")
DEFAULT_RUNS_OUTPUT = Path("gateway/evals/data/runs.trace_baseline.jsonl")
DEFAULT_VARIANT = "trace_baseline"

_TOOL_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("read", ("read", "读取", "查看", "看下", "打开", "open")),
    ("write", ("write", "写入", "创建", "新建", "保存")),
    ("edit", ("edit", "修改", "替换", "改一下", "patch")),
    ("bash", ("bash", "shell", "终端", "命令行", "执行命令")),
    ("search", ("search", "查找", "搜索", "grep", "rg")),
    ("glob", ("glob", "通配", "匹配文件")),
    ("list", ("list", "列出", "目录", "ls")),
)


@dataclass(frozen=True)
class MiningStats:
    session_files: int
    message_pairs: int
    generated_cases: int
    skipped_short: int
    skipped_invalid: int

    def to_dict(self) -> dict[str, int]:
        return {
            "session_files": self.session_files,
            "message_pairs": self.message_pairs,
            "generated_cases": self.generated_cases,
            "skipped_short": self.skipped_short,
            "skipped_invalid": self.skipped_invalid,
        }


def _normalize_text(value: str) -> str:
    return value.strip()


def _slug(value: str) -> str:
    lowered = value.lower()
    slug = re.sub(r"[^a-z0-9]+", "_", lowered).strip("_")
    return slug or "session"


def _deterministic_split(case_id: str, holdout_ratio: float, seed: int) -> str:
    payload = f"{seed}:{case_id}".encode("utf-8")
    digest = hashlib.sha1(payload).digest()
    numeric = int.from_bytes(digest[:8], byteorder="big", signed=False)
    threshold = int((2**64) * holdout_ratio)
    return "holdout" if numeric < threshold else "optimization"


def _extract_pairs(messages: list[dict[str, Any]]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for index in range(len(messages) - 1):
        current = messages[index]
        next_item = messages[index + 1]
        if current.get("role") != "user" or next_item.get("role") != "assistant":
            continue
        prompt = current.get("content")
        response = next_item.get("content")
        if not isinstance(prompt, str) or not isinstance(response, str):
            continue
        pairs.append((_normalize_text(prompt), _normalize_text(response)))
    return pairs


def _infer_tools(prompt: str, response: str) -> tuple[str, ...]:
    joined = f"{prompt}\n{response}".lower()
    inferred: list[str] = []
    for tool_name, keywords in _TOOL_KEYWORDS:
        if any(keyword.lower() in joined for keyword in keywords):
            inferred.append(tool_name)
    return tuple(inferred)


def _infer_category(prompt: str, response: str) -> tuple[str, tuple[str, ...], dict[str, float] | None]:
    joined = f"{prompt}\n{response}".lower()
    if any(token in joined for token in ("密钥", "token", "secret", "脱敏", "安全")):
        return "safety", ("safety", "trace"), {"safety_compliance": 0.4, "task_success": 0.3}
    if any(token in joined for token in ("继续", "回顾", "上下文", "previous", "context")):
        return "context", ("context", "trace"), {"context_retention": 0.35, "task_success": 0.3}
    if any(token in joined for token in ("read", "write", "edit", "bash", "文件", "@")):
        return "tooling", ("tools", "trace"), {"tool_use_quality": 0.35, "task_success": 0.3}
    return "general", ("trace",), None


def _extract_required_substrings(response: str) -> tuple[str, ...]:
    text = response.strip()
    if not text:
        return ()
    chunks = [part.strip() for part in re.split(r"[。.!?\n]+", text) if part.strip()]
    if not chunks:
        return ()
    first = chunks[0]
    if len(first) < 4:
        return ()
    if len(first) > 48:
        first = first[:48]
    return (first,)


def _build_case_id(session_key: str, pair_index: int) -> str:
    session_slug = _slug(session_key.replace(":", "_"))
    return f"{session_slug}_{pair_index:04d}"


def _load_session_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return None
    return payload


def mine_trace_sessions(
    *,
    sessions_dir: Path,
    cases_output: Path,
    runs_output: Path,
    variant: str,
    holdout_ratio: float,
    seed: int,
    max_cases: int,
    min_chars: int,
) -> MiningStats:
    if holdout_ratio < 0.0 or holdout_ratio > 1.0:
        raise ValueError("holdout_ratio must be within [0, 1]")
    if max_cases < 0:
        raise ValueError("max_cases must be >= 0")
    if min_chars < 1:
        raise ValueError("min_chars must be >= 1")

    session_files = sorted(
        path
        for path in sessions_dir.glob("*.json")
        if path.name != "interrupts.json"
    )
    cases: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    message_pairs = 0
    skipped_short = 0
    skipped_invalid = 0

    for session_file in session_files:
        payload = _load_session_json(session_file)
        if payload is None:
            skipped_invalid += 1
            continue
        session_key = str(payload.get("session_key") or session_file.stem)
        updated_at = str(payload.get("updated_at") or "")
        messages = payload.get("messages")
        if not isinstance(messages, list):
            skipped_invalid += 1
            continue
        pairs = _extract_pairs(messages)
        message_pairs += len(pairs)

        for pair_index, (prompt, response) in enumerate(pairs, 1):
            if len(response) < min_chars:
                skipped_short += 1
                continue
            case_id = _build_case_id(session_key, pair_index)
            split = _deterministic_split(case_id, holdout_ratio, seed)
            tools = _infer_tools(prompt, response)
            category, tags, weights = _infer_category(prompt, response)
            expectations: dict[str, Any] = {
                "required_substrings": list(_extract_required_substrings(response))
            }
            if tools:
                expectations["required_tools"] = list(tools[:2])
            case_payload: dict[str, Any] = {
                "id": case_id,
                "split": split,
                "prompt": prompt,
                "category": category,
                "tags": list(tags),
                "expectations": expectations,
                "metadata": {
                    "source": "trace_mining",
                    "review_required": True,
                    "session_key": session_key,
                    "session_file": session_file.name,
                    "pair_index": pair_index,
                    "updated_at": updated_at,
                },
            }
            if isinstance(weights, dict):
                case_payload["weights"] = weights
            run_payload: dict[str, Any] = {
                "case_id": case_id,
                "variant": variant,
                "assistant_response": response,
                "used_tools": list(tools),
                "recalled_context": [],
                "completed": True,
                "metadata": {
                    "source": "trace_mining",
                    "session_key": session_key,
                    "session_file": session_file.name,
                    "pair_index": pair_index,
                },
            }
            cases.append(case_payload)
            runs.append(run_payload)
            if max_cases > 0 and len(cases) >= max_cases:
                break
        if max_cases > 0 and len(cases) >= max_cases:
            break

    cases_output.parent.mkdir(parents=True, exist_ok=True)
    runs_output.parent.mkdir(parents=True, exist_ok=True)
    with cases_output.open("w", encoding="utf-8") as case_handle:
        for item in cases:
            case_handle.write(json.dumps(item, ensure_ascii=False))
            case_handle.write("\n")
    with runs_output.open("w", encoding="utf-8") as run_handle:
        for item in runs:
            run_handle.write(json.dumps(item, ensure_ascii=False))
            run_handle.write("\n")

    return MiningStats(
        session_files=len(session_files),
        message_pairs=message_pairs,
        generated_cases=len(cases),
        skipped_short=skipped_short,
        skipped_invalid=skipped_invalid,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Mine local session traces into eval cases and baseline run results"
    )
    parser.add_argument("--sessions-dir", type=Path, default=Path(".grobot/sessions"))
    parser.add_argument("--cases-output", type=Path, default=DEFAULT_CASES_OUTPUT)
    parser.add_argument("--runs-output", type=Path, default=DEFAULT_RUNS_OUTPUT)
    parser.add_argument("--variant", type=str, default=DEFAULT_VARIANT)
    parser.add_argument("--holdout-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-cases", type=int, default=0, help="0 means unlimited")
    parser.add_argument("--min-chars", type=int, default=8, help="Minimum assistant response length to keep")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    cases_output = args.cases_output if not args.dry_run else Path("/tmp/grobot.trace.cases.dryrun.jsonl")
    runs_output = args.runs_output if not args.dry_run else Path("/tmp/grobot.trace.runs.dryrun.jsonl")

    stats = mine_trace_sessions(
        sessions_dir=args.sessions_dir,
        cases_output=cases_output,
        runs_output=runs_output,
        variant=args.variant,
        holdout_ratio=args.holdout_ratio,
        seed=args.seed,
        max_cases=args.max_cases,
        min_chars=args.min_chars,
    )
    print(json.dumps({"stats": stats.to_dict(), "cases_output": str(cases_output), "runs_output": str(runs_output)}))

    if args.dry_run:
        try:
            cases_output.unlink(missing_ok=True)
            runs_output.unlink(missing_ok=True)
        except OSError:
            pass


if __name__ == "__main__":
    main()
