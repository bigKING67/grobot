#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CASES_INPUT = Path("gateway/evals/data/cases.trace.jsonl")
DEFAULT_RUNS_INPUT = Path("gateway/evals/data/runs.trace_baseline.jsonl")
DEFAULT_CASES_OUTPUT = Path("gateway/evals/data/cases.trace.cleaned.jsonl")
DEFAULT_RUNS_OUTPUT = Path("gateway/evals/data/runs.trace.cleaned.jsonl")
DEFAULT_REPORT_OUTPUT = Path("gateway/evals/data/trace_clean_report.json")
REDACTED_SECRET = "[REDACTED_SECRET]"

SENSITIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"sk-[A-Za-z0-9_-]{8,}", re.IGNORECASE),
    re.compile(r"api[_-]?key\s*[:=]\s*[A-Za-z0-9._-]+", re.IGNORECASE),
    re.compile(r"authorization\s*:\s*bearer\s+[A-Za-z0-9._-]+", re.IGNORECASE),
    re.compile(r"bearer\s+[A-Za-z0-9._-]{12,}", re.IGNORECASE),
)


@dataclass(frozen=True)
class CleanStats:
    input_cases: int
    output_cases: int
    input_runs: int
    output_runs: int
    dropped_duplicate_prompt_cases: int
    dropped_near_duplicate_cases: int
    dropped_short_prompt_cases: int
    dropped_invalid_cases: int
    kept_by_whitelist_cases: int
    kept_by_split_minimum_cases: int
    dropped_orphan_runs: int
    dropped_duplicate_runs: int
    dropped_short_runs: int
    dropped_invalid_runs: int
    redacted_case_prompts: int
    redacted_case_expectations: int
    redacted_run_responses: int

    def to_dict(self) -> dict[str, int]:
        return {
            "input_cases": self.input_cases,
            "output_cases": self.output_cases,
            "input_runs": self.input_runs,
            "output_runs": self.output_runs,
            "dropped_duplicate_prompt_cases": self.dropped_duplicate_prompt_cases,
            "dropped_near_duplicate_cases": self.dropped_near_duplicate_cases,
            "dropped_short_prompt_cases": self.dropped_short_prompt_cases,
            "dropped_invalid_cases": self.dropped_invalid_cases,
            "kept_by_whitelist_cases": self.kept_by_whitelist_cases,
            "kept_by_split_minimum_cases": self.kept_by_split_minimum_cases,
            "dropped_orphan_runs": self.dropped_orphan_runs,
            "dropped_duplicate_runs": self.dropped_duplicate_runs,
            "dropped_short_runs": self.dropped_short_runs,
            "dropped_invalid_runs": self.dropped_invalid_runs,
            "redacted_case_prompts": self.redacted_case_prompts,
            "redacted_case_expectations": self.redacted_case_expectations,
            "redacted_run_responses": self.redacted_run_responses,
        }


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            try:
                item = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid json: {exc}") from exc
            if not isinstance(item, dict):
                raise ValueError(f"{path}:{line_number}: each row must be object")
            rows.append(item)
    return rows


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for item in rows:
            handle.write(json.dumps(item, ensure_ascii=False))
            handle.write("\n")


def _normalize_text(value: str) -> str:
    collapsed = " ".join(value.strip().lower().split())
    return collapsed


def _tokenize_for_similarity(value: str) -> set[str]:
    lowered = value.lower()
    # Keep latin words and treat CJK chars as atomic tokens to support mixed zh/en prompts.
    raw_tokens = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]", lowered)
    return {token for token in raw_tokens if token}


def _jaccard_similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    intersection = len(left.intersection(right))
    union = len(left.union(right))
    if union <= 0:
        return 0.0
    return float(intersection) / float(union)


def _load_whitelist_ids(path: Path | None) -> set[str]:
    if path is None:
        return set()
    ids: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            candidate = line.strip()
            if not candidate or candidate.startswith("#"):
                continue
            ids.add(candidate)
    return ids


def _redact_sensitive(text: str) -> tuple[str, bool]:
    redacted = text
    changed = False
    for pattern in SENSITIVE_PATTERNS:
        if pattern.search(redacted):
            redacted = pattern.sub(REDACTED_SECRET, redacted)
            changed = True
    return redacted, changed


def _redact_string_list(raw: Any) -> tuple[list[str], bool]:
    if not isinstance(raw, list):
        return [], False
    output: list[str] = []
    changed = False
    for item in raw:
        if not isinstance(item, str):
            continue
        cleaned, hit = _redact_sensitive(item)
        changed = changed or hit
        output.append(cleaned)
    return output, changed


def _prepare_clean_case_row(
    row: dict[str, Any],
    *,
    prompt_clean: str,
    is_whitelisted: bool,
    retained_by_split_minimum: bool,
) -> tuple[dict[str, Any], bool, bool]:
    case_row: dict[str, Any] = dict(row)
    prompt_redacted, prompt_hit = _redact_sensitive(prompt_clean)

    expectations = case_row.get("expectations")
    expectation_hit = False
    if isinstance(expectations, dict):
        patched_expectations: dict[str, Any] = dict(expectations)
        for key in (
            "required_substrings",
            "forbidden_substrings",
            "required_context_items",
        ):
            values, changed = _redact_string_list(expectations.get(key))
            if isinstance(expectations.get(key), list):
                patched_expectations[key] = values
            if changed:
                expectation_hit = True
        case_row["expectations"] = patched_expectations

    case_row["prompt"] = prompt_redacted
    metadata = case_row.get("metadata")
    metadata_dict = dict(metadata) if isinstance(metadata, dict) else {}
    metadata_dict["cleaned"] = True
    metadata_dict["review_required"] = True
    metadata_dict["whitelisted"] = is_whitelisted
    if retained_by_split_minimum:
        metadata_dict["retained_by_split_minimum"] = True
    case_row["metadata"] = metadata_dict
    return case_row, prompt_hit, expectation_hit


def clean_trace_dataset(
    *,
    cases_input: Path,
    runs_input: Path,
    cases_output: Path,
    runs_output: Path,
    report_output: Path,
    min_prompt_chars: int,
    min_response_chars: int,
    max_exact_duplicates_per_prompt: int,
    similarity_threshold: float,
    max_near_duplicates_per_anchor: int,
    whitelist_case_ids_file: Path | None,
    min_cases_per_split: int = 0,
) -> dict[str, Any]:
    if min_prompt_chars < 1:
        raise ValueError("min_prompt_chars must be >= 1")
    if min_response_chars < 1:
        raise ValueError("min_response_chars must be >= 1")
    if max_exact_duplicates_per_prompt < 1:
        raise ValueError("max_exact_duplicates_per_prompt must be >= 1")
    if similarity_threshold < 0.0 or similarity_threshold > 1.0:
        raise ValueError("similarity_threshold must be within [0, 1]")
    if max_near_duplicates_per_anchor < 0:
        raise ValueError("max_near_duplicates_per_anchor must be >= 0")
    if min_cases_per_split < 0:
        raise ValueError("min_cases_per_split must be >= 0")

    raw_cases = _load_jsonl(cases_input)
    raw_runs = _load_jsonl(runs_input)
    cleaned_cases: list[dict[str, Any]] = []
    cleaned_runs: list[dict[str, Any]] = []
    review_items: list[dict[str, Any]] = []

    whitelist_case_ids = _load_whitelist_ids(whitelist_case_ids_file)

    seen_prompt_keys: set[str] = set()
    prompt_occurrence_count: dict[tuple[str, str], int] = {}
    split_accepted_prompts: dict[str, list[tuple[str, set[str], str]]] = {}
    near_duplicate_accept_count: dict[str, int] = {}
    kept_case_ids: set[str] = set()
    split_candidate_counts: dict[str, int] = {}
    fallback_candidates_by_split: dict[str, list[dict[str, Any]]] = {}
    dropped_duplicate_prompt_cases = 0
    dropped_near_duplicate_cases = 0
    dropped_short_prompt_cases = 0
    dropped_invalid_cases = 0
    kept_by_whitelist_cases = 0
    kept_by_split_minimum_cases = 0
    retained_by_split_minimum: dict[str, int] = {}
    redacted_case_prompts = 0
    redacted_case_expectations = 0

    for row in raw_cases:
        case_id = row.get("id")
        prompt = row.get("prompt")
        if not isinstance(case_id, str) or not case_id.strip():
            dropped_invalid_cases += 1
            continue
        if not isinstance(prompt, str):
            dropped_invalid_cases += 1
            continue
        prompt_clean = prompt.strip()
        if len(prompt_clean) < min_prompt_chars:
            dropped_short_prompt_cases += 1
            continue
        split = str(row.get("split") or "optimization")
        split_candidate_counts[split] = split_candidate_counts.get(split, 0) + 1
        prompt_key = _normalize_text(prompt_clean)
        is_whitelisted = case_id in whitelist_case_ids
        occurrence_key = (split, prompt_key)
        occurrence = prompt_occurrence_count.get(occurrence_key, 0)
        if (not is_whitelisted) and occurrence >= max_exact_duplicates_per_prompt:
            dropped_duplicate_prompt_cases += 1
            fallback_candidates_by_split.setdefault(split, []).append(
                {
                    "id": case_id,
                    "reason": "duplicate_prompt",
                    "prompt": prompt_clean,
                    "row": copy.deepcopy(row),
                }
            )
            continue

        prompt_tokens = _tokenize_for_similarity(prompt_clean)
        if (not is_whitelisted) and prompt_tokens:
            accepted = split_accepted_prompts.get(split, [])
            best_anchor_id = ""
            best_similarity = 0.0
            best_anchor_key = ""
            for anchor_id, anchor_tokens, anchor_prompt_key in accepted:
                if anchor_prompt_key == prompt_key:
                    continue
                similarity = _jaccard_similarity(prompt_tokens, anchor_tokens)
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_anchor_id = anchor_id
                    best_anchor_key = anchor_prompt_key
            if best_anchor_id and best_similarity >= similarity_threshold:
                accepted_near = near_duplicate_accept_count.get(best_anchor_id, 0)
                if accepted_near >= max_near_duplicates_per_anchor:
                    dropped_near_duplicate_cases += 1
                    review_items.append(
                        {
                            "type": "case_near_duplicate_dropped",
                            "id": case_id,
                            "anchor_id": best_anchor_id,
                            "similarity": round(best_similarity, 4),
                            "anchor_prompt_key": best_anchor_key,
                        }
                    )
                    fallback_candidates_by_split.setdefault(split, []).append(
                        {
                            "id": case_id,
                            "reason": "near_duplicate",
                            "prompt": prompt_clean,
                            "anchor_id": best_anchor_id,
                            "similarity": round(best_similarity, 4),
                            "row": copy.deepcopy(row),
                        }
                    )
                    continue
                near_duplicate_accept_count[best_anchor_id] = accepted_near + 1

        prompt_occurrence_count[occurrence_key] = occurrence + 1
        seen_prompt_keys.add(prompt_key)

        case_row, prompt_hit, expectation_hit = _prepare_clean_case_row(
            row,
            prompt_clean=prompt_clean,
            is_whitelisted=is_whitelisted,
            retained_by_split_minimum=False,
        )
        if prompt_hit:
            redacted_case_prompts += 1
            review_items.append({"type": "case_prompt_redacted", "id": case_id})
        if expectation_hit:
            redacted_case_expectations += 1
            review_items.append({"type": "case_expectation_redacted", "id": case_id})

        if is_whitelisted:
            kept_by_whitelist_cases += 1
            review_items.append({"type": "case_whitelist_kept", "id": case_id})

        cleaned_cases.append(case_row)
        kept_case_ids.add(case_id)
        split_accepted_prompts.setdefault(split, []).append((case_id, prompt_tokens, prompt_key))
        near_duplicate_accept_count.setdefault(case_id, 0)

    if min_cases_per_split > 0:
        split_kept_counts: dict[str, int] = {}
        for item in cleaned_cases:
            split = str(item.get("split") or "optimization")
            split_kept_counts[split] = split_kept_counts.get(split, 0) + 1
        for split, available in split_candidate_counts.items():
            required = min(min_cases_per_split, available)
            current = split_kept_counts.get(split, 0)
            if current >= required:
                continue
            for candidate in fallback_candidates_by_split.get(split, []):
                if current >= required:
                    break
                case_id = str(candidate.get("id") or "")
                if not case_id or case_id in kept_case_ids:
                    continue
                source_row = candidate.get("row")
                prompt_value = candidate.get("prompt")
                if not isinstance(source_row, dict) or not isinstance(prompt_value, str):
                    continue
                case_row, prompt_hit, expectation_hit = _prepare_clean_case_row(
                    source_row,
                    prompt_clean=prompt_value,
                    is_whitelisted=False,
                    retained_by_split_minimum=True,
                )
                if prompt_hit:
                    redacted_case_prompts += 1
                    review_items.append({"type": "case_prompt_redacted", "id": case_id})
                if expectation_hit:
                    redacted_case_expectations += 1
                    review_items.append({"type": "case_expectation_redacted", "id": case_id})
                reason = str(candidate.get("reason") or "")
                if reason == "duplicate_prompt" and dropped_duplicate_prompt_cases > 0:
                    dropped_duplicate_prompt_cases -= 1
                if reason == "near_duplicate" and dropped_near_duplicate_cases > 0:
                    dropped_near_duplicate_cases -= 1
                review_items.append(
                    {
                        "type": "case_split_minimum_kept",
                        "id": case_id,
                        "split": split,
                        "reason": reason or "fallback",
                    }
                )
                cleaned_cases.append(case_row)
                kept_case_ids.add(case_id)
                kept_by_split_minimum_cases += 1
                retained_by_split_minimum[split] = retained_by_split_minimum.get(split, 0) + 1
                current += 1
            split_kept_counts[split] = current

    seen_run_keys: set[tuple[str, str]] = set()
    dropped_orphan_runs = 0
    dropped_duplicate_runs = 0
    dropped_short_runs = 0
    dropped_invalid_runs = 0
    redacted_run_responses = 0

    for row in raw_runs:
        case_id = row.get("case_id")
        variant = row.get("variant")
        response = row.get("assistant_response")
        if not isinstance(case_id, str) or not isinstance(variant, str):
            dropped_invalid_runs += 1
            continue
        if case_id not in kept_case_ids:
            dropped_orphan_runs += 1
            continue
        key = (case_id, variant)
        if key in seen_run_keys:
            dropped_duplicate_runs += 1
            continue
        seen_run_keys.add(key)

        if not isinstance(response, str):
            dropped_invalid_runs += 1
            continue
        if len(response.strip()) < min_response_chars:
            dropped_short_runs += 1
            continue

        response_redacted, response_hit = _redact_sensitive(response)
        if response_hit:
            redacted_run_responses += 1
            review_items.append({"type": "run_response_redacted", "id": case_id, "variant": variant})
        row["assistant_response"] = response_redacted
        metadata = row.get("metadata")
        metadata_dict = dict(metadata) if isinstance(metadata, dict) else {}
        metadata_dict["cleaned"] = True
        row["metadata"] = metadata_dict
        cleaned_runs.append(row)

    _write_jsonl(cases_output, cleaned_cases)
    _write_jsonl(runs_output, cleaned_runs)

    stats = CleanStats(
        input_cases=len(raw_cases),
        output_cases=len(cleaned_cases),
        input_runs=len(raw_runs),
        output_runs=len(cleaned_runs),
        dropped_duplicate_prompt_cases=dropped_duplicate_prompt_cases,
        dropped_near_duplicate_cases=dropped_near_duplicate_cases,
        dropped_short_prompt_cases=dropped_short_prompt_cases,
        dropped_invalid_cases=dropped_invalid_cases,
        kept_by_whitelist_cases=kept_by_whitelist_cases,
        kept_by_split_minimum_cases=kept_by_split_minimum_cases,
        dropped_orphan_runs=dropped_orphan_runs,
        dropped_duplicate_runs=dropped_duplicate_runs,
        dropped_short_runs=dropped_short_runs,
        dropped_invalid_runs=dropped_invalid_runs,
        redacted_case_prompts=redacted_case_prompts,
        redacted_case_expectations=redacted_case_expectations,
        redacted_run_responses=redacted_run_responses,
    )
    report = {
        "stats": stats.to_dict(),
        "inputs": {"cases": str(cases_input), "runs": str(runs_input)},
        "outputs": {"cases": str(cases_output), "runs": str(runs_output)},
        "split_minimum": {
            "enabled": min_cases_per_split > 0,
            "min_cases_per_split": min_cases_per_split,
            "candidate_counts": split_candidate_counts,
            "retained_counts": retained_by_split_minimum,
        },
        "review_items": review_items,
    }
    report_output.parent.mkdir(parents=True, exist_ok=True)
    with report_output.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return report


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Clean mined trace eval dataset: dedupe, redact secrets, and generate review report"
    )
    parser.add_argument("--cases-input", type=Path, default=DEFAULT_CASES_INPUT)
    parser.add_argument("--runs-input", type=Path, default=DEFAULT_RUNS_INPUT)
    parser.add_argument("--cases-output", type=Path, default=DEFAULT_CASES_OUTPUT)
    parser.add_argument("--runs-output", type=Path, default=DEFAULT_RUNS_OUTPUT)
    parser.add_argument("--report-output", type=Path, default=DEFAULT_REPORT_OUTPUT)
    parser.add_argument("--min-prompt-chars", type=int, default=8)
    parser.add_argument("--min-response-chars", type=int, default=8)
    parser.add_argument("--max-exact-duplicates-per-prompt", type=int, default=2)
    parser.add_argument("--similarity-threshold", type=float, default=0.88)
    parser.add_argument("--max-near-duplicates-per-anchor", type=int, default=1)
    parser.add_argument(
        "--min-cases-per-split",
        type=int,
        default=0,
        help="Keep at least N cases per split (if enough candidates exist in input)",
    )
    parser.add_argument(
        "--whitelist-case-ids-file",
        type=Path,
        default=None,
        help="Optional file with case ids (one per line) that should be kept even if duplicate",
    )
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    report = clean_trace_dataset(
        cases_input=args.cases_input,
        runs_input=args.runs_input,
        cases_output=args.cases_output,
        runs_output=args.runs_output,
        report_output=args.report_output,
        min_prompt_chars=args.min_prompt_chars,
        min_response_chars=args.min_response_chars,
        max_exact_duplicates_per_prompt=args.max_exact_duplicates_per_prompt,
        similarity_threshold=args.similarity_threshold,
        max_near_duplicates_per_anchor=args.max_near_duplicates_per_anchor,
        whitelist_case_ids_file=args.whitelist_case_ids_file,
        min_cases_per_split=args.min_cases_per_split,
    )
    print(json.dumps({"stats": report["stats"], "report_output": report["outputs"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
