#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from evals.trace_clean import clean_trace_dataset  # type: ignore[import-not-found]
    from evals.trace_mining import mine_trace_sessions  # type: ignore[import-not-found]
else:
    from .trace_clean import clean_trace_dataset
    from .trace_mining import mine_trace_sessions


_PATH_POLICY_FIELDS: tuple[str, ...] = (
    "sessions_dir",
    "trace_cases_output",
    "trace_runs_output",
    "clean_cases_output",
    "clean_runs_output",
    "clean_report_output",
    "whitelist_case_ids_file",
)
_INT_POLICY_FIELDS: tuple[str, ...] = (
    "seed",
    "max_cases",
    "min_chars",
    "min_prompt_chars",
    "min_response_chars",
    "max_exact_duplicates_per_prompt",
    "max_near_duplicates_per_anchor",
    "min_cases_per_split",
    "min_clean_cases",
)
_FLOAT_POLICY_FIELDS: tuple[str, ...] = ("holdout_ratio", "similarity_threshold")
_BOOL_POLICY_FIELDS: tuple[str, ...] = ("fail_on_low_sample", "fail_on_split_underflow")
_META_POLICY_FIELDS: tuple[str, ...] = ("schema", "schema_version", "profile")

TRACE_PIPELINE_POLICY_SCHEMA = "trace_pipeline_policy"
TRACE_PIPELINE_POLICY_VERSION = 2
TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION = 1
TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION = 2


def _parse_split_thresholds(raw: str) -> dict[str, int]:
    if not raw.strip():
        return {}
    thresholds: dict[str, int] = {}
    for token in raw.split(","):
        item = token.strip()
        if not item:
            continue
        if ":" not in item:
            raise ValueError(f"invalid split threshold token: {item}")
        split, threshold_raw = item.split(":", 1)
        split_name = split.strip()
        if not split_name:
            raise ValueError(f"invalid split name in token: {item}")
        try:
            threshold = int(threshold_raw.strip())
        except ValueError as exc:
            raise ValueError(f"invalid split threshold value in token: {item}") from exc
        if threshold < 0:
            raise ValueError("split thresholds must be >= 0")
        thresholds[split_name] = threshold
    return thresholds


def _coerce_split_thresholds(value: Any) -> dict[str, int]:
    if value is None:
        return {}
    if isinstance(value, str):
        return _parse_split_thresholds(value)
    if isinstance(value, dict):
        thresholds: dict[str, int] = {}
        for split_name, threshold_raw in value.items():
            split = str(split_name).strip()
            if not split:
                raise ValueError("split threshold key must not be empty")
            if isinstance(threshold_raw, bool) or not isinstance(threshold_raw, int):
                raise ValueError(f"invalid split threshold for {split}: {threshold_raw}")
            if threshold_raw < 0:
                raise ValueError("split thresholds must be >= 0")
            thresholds[split] = threshold_raw
        return thresholds
    raise ValueError("min_clean_cases_by_split must be string or object")


def _count_cases_by_split(path: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                row = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid json row") from exc
            if not isinstance(row, dict):
                continue
            split = str(row.get("split") or "optimization")
            counts[split] = counts.get(split, 0) + 1
    return counts


def _resolve_policy_path(policy_path: Path, raw: str) -> Path:
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate
    return policy_path.parent / candidate


def _migrate_policy_v1_to_v2(payload: dict[str, Any]) -> dict[str, Any]:
    migrated = dict(payload)
    profile_raw = migrated.get("profile")
    profile = str(profile_raw).strip() if isinstance(profile_raw, str) else ""
    migrated["profile"] = profile or "custom"
    migrated["schema"] = TRACE_PIPELINE_POLICY_SCHEMA
    migrated["schema_version"] = 2
    return migrated


def _upgrade_policy_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    schema_raw = payload.get("schema")
    if not isinstance(schema_raw, str) or not schema_raw.strip():
        raise ValueError("policy field schema must be non-empty string")
    if schema_raw != TRACE_PIPELINE_POLICY_SCHEMA:
        raise ValueError(f"unsupported policy schema: {schema_raw}")

    version_raw = payload.get("schema_version")
    if isinstance(version_raw, bool) or not isinstance(version_raw, int):
        raise ValueError("policy field schema_version must be int")
    if version_raw < TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION:
        raise ValueError(
            "policy schema_version too old: "
            f"{version_raw} < {TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION}"
        )
    if version_raw > TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION:
        raise ValueError(
            "policy schema_version too new: "
            f"{version_raw} > {TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION}"
        )

    migrated = dict(payload)
    applied_migrations: list[str] = []
    current_version = version_raw
    while current_version < TRACE_PIPELINE_POLICY_VERSION:
        if current_version == 1:
            migrated = _migrate_policy_v1_to_v2(migrated)
            applied_migrations.append("1->2")
            current_version = 2
            continue
        raise ValueError(f"missing migrator for schema_version {current_version}")
    return migrated, applied_migrations


def load_trace_pipeline_policy(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"failed to read policy: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid policy json: {path}") from exc
    if not isinstance(payload, dict):
        raise ValueError("policy must be a json object")

    supported_fields = (
        set(_PATH_POLICY_FIELDS)
        | set(_INT_POLICY_FIELDS)
        | set(_FLOAT_POLICY_FIELDS)
        | set(_BOOL_POLICY_FIELDS)
        | set(_META_POLICY_FIELDS)
    )
    supported_fields |= {"variant", "min_clean_cases_by_split"}
    unknown_fields = sorted(key for key in payload.keys() if key not in supported_fields)
    if unknown_fields:
        raise ValueError(f"unknown policy fields: {','.join(unknown_fields)}")
    upgraded_payload, applied_migrations = _upgrade_policy_payload(payload)

    normalized: dict[str, Any] = {}
    for key in _PATH_POLICY_FIELDS:
        if key not in upgraded_payload:
            continue
        value = upgraded_payload[key]
        if value is None and key == "whitelist_case_ids_file":
            normalized[key] = None
            continue
        if not isinstance(value, str):
            raise ValueError(f"policy field {key} must be string path")
        normalized[key] = _resolve_policy_path(path, value)

    for key in _INT_POLICY_FIELDS:
        if key not in upgraded_payload:
            continue
        value = upgraded_payload[key]
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"policy field {key} must be int")
        normalized[key] = value

    for key in _FLOAT_POLICY_FIELDS:
        if key not in upgraded_payload:
            continue
        value = upgraded_payload[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"policy field {key} must be number")
        normalized[key] = float(value)

    for key in _BOOL_POLICY_FIELDS:
        if key not in upgraded_payload:
            continue
        value = upgraded_payload[key]
        if not isinstance(value, bool):
            raise ValueError(f"policy field {key} must be bool")
        normalized[key] = value

    if "variant" in upgraded_payload:
        variant = upgraded_payload["variant"]
        if not isinstance(variant, str) or not variant.strip():
            raise ValueError("policy field variant must be non-empty string")
        normalized["variant"] = variant

    if "min_clean_cases_by_split" in upgraded_payload:
        normalized["min_clean_cases_by_split"] = _coerce_split_thresholds(
            upgraded_payload["min_clean_cases_by_split"]
        )

    if "schema" in upgraded_payload:
        schema = upgraded_payload["schema"]
        if not isinstance(schema, str) or not schema.strip():
            raise ValueError("policy field schema must be non-empty string")
        normalized["schema"] = schema

    if "schema_version" in upgraded_payload:
        schema_version = upgraded_payload["schema_version"]
        if isinstance(schema_version, bool) or not isinstance(schema_version, int):
            raise ValueError("policy field schema_version must be int")
        if schema_version <= 0:
            raise ValueError("policy field schema_version must be > 0")
        normalized["schema_version"] = schema_version
    if "profile" in upgraded_payload:
        profile = upgraded_payload["profile"]
        if not isinstance(profile, str) or not profile.strip():
            raise ValueError("policy field profile must be non-empty string")
        normalized["profile"] = profile.strip()
    if applied_migrations:
        normalized["migrations"] = applied_migrations

    return normalized


def _to_portable_path(policy_path: Path, value: Path | None) -> str | None:
    if value is None:
        return None
    try:
        return value.relative_to(policy_path.parent).as_posix()
    except ValueError:
        return value.as_posix()


def _canonicalize_policy_for_hash(policy_path: Path, config: dict[str, Any]) -> dict[str, Any]:
    canonical: dict[str, Any] = {}
    for key in sorted(config.keys()):
        if key == "migrations":
            continue
        value = config[key]
        if key in _PATH_POLICY_FIELDS:
            if value is None:
                canonical[key] = None
                continue
            if not isinstance(value, Path):
                raise ValueError(f"policy field {key} must be resolved Path before hashing")
            canonical[key] = _to_portable_path(policy_path, value)
            continue
        if key == "min_clean_cases_by_split":
            if not isinstance(value, dict):
                raise ValueError("policy field min_clean_cases_by_split must be object before hashing")
            canonical[key] = {k: int(value[k]) for k in sorted(value.keys())}
            continue
        canonical[key] = value
    return canonical


def compute_trace_pipeline_policy_fingerprint(path: Path) -> tuple[str, dict[str, Any]]:
    config = load_trace_pipeline_policy(path)
    canonical = _canonicalize_policy_for_hash(path, config)
    digest = hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}", canonical


def validate_trace_pipeline_inputs(
    *,
    sessions_dir: Path,
    trace_cases_output: Path,
    trace_runs_output: Path,
    holdout_ratio: float,
    max_cases: int,
    min_chars: int,
    clean_cases_output: Path,
    clean_runs_output: Path,
    clean_report_output: Path,
    min_prompt_chars: int,
    min_response_chars: int,
    max_exact_duplicates_per_prompt: int,
    similarity_threshold: float,
    max_near_duplicates_per_anchor: int,
    whitelist_case_ids_file: Path | None,
    min_cases_per_split: int,
    min_clean_cases: int,
    split_thresholds: dict[str, int],
) -> list[str]:
    errors: list[str] = []
    if not sessions_dir.exists():
        errors.append(f"sessions_dir does not exist: {sessions_dir}")
    elif not sessions_dir.is_dir():
        errors.append(f"sessions_dir is not a directory: {sessions_dir}")
    if whitelist_case_ids_file is not None and not whitelist_case_ids_file.exists():
        errors.append(f"whitelist_case_ids_file does not exist: {whitelist_case_ids_file}")

    if holdout_ratio < 0 or holdout_ratio > 1:
        errors.append("holdout_ratio must be between 0 and 1")
    if similarity_threshold < 0 or similarity_threshold > 1:
        errors.append("similarity_threshold must be between 0 and 1")

    int_checks = {
        "max_cases": max_cases,
        "min_chars": min_chars,
        "min_prompt_chars": min_prompt_chars,
        "min_response_chars": min_response_chars,
        "max_exact_duplicates_per_prompt": max_exact_duplicates_per_prompt,
        "max_near_duplicates_per_anchor": max_near_duplicates_per_anchor,
        "min_cases_per_split": min_cases_per_split,
        "min_clean_cases": min_clean_cases,
    }
    for key, value in int_checks.items():
        if value < 0:
            errors.append(f"{key} must be >= 0")

    for split_name, threshold in split_thresholds.items():
        if threshold < 0:
            errors.append(f"split threshold must be >= 0: {split_name}={threshold}")

    output_paths = {
        "trace_cases_output": trace_cases_output,
        "trace_runs_output": trace_runs_output,
        "clean_cases_output": clean_cases_output,
        "clean_runs_output": clean_runs_output,
        "clean_report_output": clean_report_output,
    }
    for key, target in output_paths.items():
        probe = target.parent
        while not probe.exists() and probe != probe.parent:
            probe = probe.parent
        if not probe.exists():
            errors.append(f"{key} has no existing parent to create from: {target}")
            continue
        if not probe.is_dir():
            errors.append(f"{key} parent is not a directory: {probe}")
            continue
        if not os.access(probe, os.W_OK):
            errors.append(f"{key} parent is not writable: {probe}")
    return errors


def run_trace_pipeline(
    *,
    sessions_dir: Path,
    trace_cases_output: Path,
    trace_runs_output: Path,
    variant: str,
    holdout_ratio: float,
    seed: int,
    max_cases: int,
    min_chars: int,
    clean_cases_output: Path,
    clean_runs_output: Path,
    clean_report_output: Path,
    min_prompt_chars: int,
    min_response_chars: int,
    max_exact_duplicates_per_prompt: int,
    similarity_threshold: float,
    max_near_duplicates_per_anchor: int,
    whitelist_case_ids_file: Path | None,
    min_cases_per_split: int = 0,
    min_clean_cases: int = 0,
    fail_on_low_sample: bool = False,
    min_clean_cases_by_split: dict[str, int] | None = None,
    fail_on_split_underflow: bool = False,
) -> dict[str, Any]:
    if min_clean_cases < 0:
        raise ValueError("min_clean_cases must be >= 0")
    split_thresholds = _coerce_split_thresholds(min_clean_cases_by_split)
    mine_stats = mine_trace_sessions(
        sessions_dir=sessions_dir,
        cases_output=trace_cases_output,
        runs_output=trace_runs_output,
        variant=variant,
        holdout_ratio=holdout_ratio,
        seed=seed,
        max_cases=max_cases,
        min_chars=min_chars,
    )
    clean_report = clean_trace_dataset(
        cases_input=trace_cases_output,
        runs_input=trace_runs_output,
        cases_output=clean_cases_output,
        runs_output=clean_runs_output,
        report_output=clean_report_output,
        min_prompt_chars=min_prompt_chars,
        min_response_chars=min_response_chars,
        max_exact_duplicates_per_prompt=max_exact_duplicates_per_prompt,
        similarity_threshold=similarity_threshold,
        max_near_duplicates_per_anchor=max_near_duplicates_per_anchor,
        whitelist_case_ids_file=whitelist_case_ids_file,
        min_cases_per_split=min_cases_per_split,
    )
    actual_clean_cases = int(clean_report.get("stats", {}).get("output_cases", 0))
    sample_guard = {
        "enabled": min_clean_cases > 0,
        "min_clean_cases": min_clean_cases,
        "actual_clean_cases": actual_clean_cases,
        "pass": (actual_clean_cases >= min_clean_cases) if min_clean_cases > 0 else True,
    }
    split_counts = _count_cases_by_split(clean_cases_output)
    split_results: dict[str, dict[str, int | bool]] = {}
    split_pass = True
    for split_name, threshold in split_thresholds.items():
        actual = split_counts.get(split_name, 0)
        passed = actual >= threshold
        split_results[split_name] = {"required": threshold, "actual": actual, "pass": passed}
        if not passed:
            split_pass = False
    sample_guard["split"] = {
        "enabled": bool(split_thresholds),
        "thresholds": split_thresholds,
        "counts": split_counts,
        "pass": split_pass,
        "results": split_results,
    }
    if fail_on_low_sample and not sample_guard["pass"]:
        raise RuntimeError(
            f"cleaned cases below threshold: actual={actual_clean_cases}, required={min_clean_cases}"
        )
    if fail_on_split_underflow and not split_pass:
        failed_items = [
            f"{split_name}:{payload['actual']}/{payload['required']}"
            for split_name, payload in split_results.items()
            if not bool(payload["pass"])
        ]
        raise RuntimeError(
            "split sample below threshold: " + ",".join(failed_items)
        )
    return {
        "mine": {
            "sessions_dir": str(sessions_dir),
            "cases_output": str(trace_cases_output),
            "runs_output": str(trace_runs_output),
            "stats": mine_stats.to_dict(),
        },
        "clean": clean_report,
        "sample_guard": sample_guard,
    }


def _build_parser(policy_defaults: dict[str, Any] | None = None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run full trace pipeline: mine session traces then clean mined dataset"
    )
    parser.add_argument("--policy", type=Path, default=None, help="Optional policy json to preload pipeline options")
    parser.add_argument("--sessions-dir", type=Path, default=Path(".grobot/sessions"))
    parser.add_argument("--trace-cases-output", type=Path, default=Path("gateway/evals/data/cases.trace.jsonl"))
    parser.add_argument("--trace-runs-output", type=Path, default=Path("gateway/evals/data/runs.trace_baseline.jsonl"))
    parser.add_argument("--variant", type=str, default="trace_baseline")
    parser.add_argument("--holdout-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-cases", type=int, default=0, help="0 means unlimited")
    parser.add_argument("--min-chars", type=int, default=8, help="Minimum assistant response chars for mining")

    parser.add_argument(
        "--clean-cases-output",
        type=Path,
        default=Path("gateway/evals/data/cases.trace.cleaned.jsonl"),
    )
    parser.add_argument(
        "--clean-runs-output",
        type=Path,
        default=Path("gateway/evals/data/runs.trace.cleaned.jsonl"),
    )
    parser.add_argument(
        "--clean-report-output",
        type=Path,
        default=Path("gateway/evals/data/trace_clean_report.json"),
    )
    parser.add_argument("--min-prompt-chars", type=int, default=8)
    parser.add_argument("--min-response-chars", type=int, default=8)
    parser.add_argument("--max-exact-duplicates-per-prompt", type=int, default=2)
    parser.add_argument("--similarity-threshold", type=float, default=0.88)
    parser.add_argument("--max-near-duplicates-per-anchor", type=int, default=1)
    parser.add_argument("--min-cases-per-split", type=int, default=0)
    parser.add_argument("--min-clean-cases", type=int, default=0)
    parser.add_argument("--fail-on-low-sample", action="store_true")
    parser.add_argument("--min-clean-cases-by-split", type=str, default="")
    parser.add_argument("--fail-on-split-underflow", action="store_true")
    parser.add_argument("--whitelist-case-ids-file", type=Path, default=None)
    parser.add_argument(
        "--dry-validate-only",
        action="store_true",
        help="Validate policy/options/path preconditions only, skip mining and cleaning",
    )
    parser.add_argument("--print-json", action="store_true")
    if policy_defaults:
        parser.set_defaults(**policy_defaults)
    return parser


def main() -> None:
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument("--policy", type=Path, default=None)
    pre_args, _ = pre_parser.parse_known_args()
    policy_defaults: dict[str, Any] = {}
    if pre_args.policy is not None:
        policy_defaults = load_trace_pipeline_policy(pre_args.policy)
    parser = _build_parser(policy_defaults=policy_defaults)
    if pre_args.policy is not None:
        parser.set_defaults(policy=pre_args.policy)
    args = parser.parse_args()
    split_thresholds = _coerce_split_thresholds(args.min_clean_cases_by_split)
    validation_errors = validate_trace_pipeline_inputs(
        sessions_dir=args.sessions_dir,
        trace_cases_output=args.trace_cases_output,
        trace_runs_output=args.trace_runs_output,
        holdout_ratio=args.holdout_ratio,
        max_cases=args.max_cases,
        min_chars=args.min_chars,
        clean_cases_output=args.clean_cases_output,
        clean_runs_output=args.clean_runs_output,
        clean_report_output=args.clean_report_output,
        min_prompt_chars=args.min_prompt_chars,
        min_response_chars=args.min_response_chars,
        max_exact_duplicates_per_prompt=args.max_exact_duplicates_per_prompt,
        similarity_threshold=args.similarity_threshold,
        max_near_duplicates_per_anchor=args.max_near_duplicates_per_anchor,
        whitelist_case_ids_file=args.whitelist_case_ids_file,
        min_cases_per_split=args.min_cases_per_split,
        min_clean_cases=args.min_clean_cases,
        split_thresholds=split_thresholds,
    )
    policy_hash = None
    policy_canonical: dict[str, Any] | None = None
    if args.policy:
        policy_hash, policy_canonical = compute_trace_pipeline_policy_fingerprint(args.policy)
    if args.dry_validate_only:
        dry_output: dict[str, Any] = {
            "dry_validate_only": True,
            "ok": len(validation_errors) == 0,
            "errors": validation_errors,
            "policy": str(args.policy) if args.policy else None,
            "policy_profile": getattr(args, "profile", None),
            "policy_schema_version": getattr(args, "schema_version", None),
            "policy_hash": policy_hash,
            "inputs": {
                "sessions_dir": str(args.sessions_dir),
                "trace_cases_output": str(args.trace_cases_output),
                "trace_runs_output": str(args.trace_runs_output),
                "clean_cases_output": str(args.clean_cases_output),
                "clean_runs_output": str(args.clean_runs_output),
                "clean_report_output": str(args.clean_report_output),
            },
        }
        if args.print_json and policy_canonical is not None:
            dry_output["policy_canonical"] = policy_canonical
        print(json.dumps(dry_output, ensure_ascii=False, indent=2 if args.print_json else None))
        if validation_errors:
            raise SystemExit(1)
        return
    if validation_errors:
        raise SystemExit("; ".join(validation_errors))
    report = run_trace_pipeline(
        sessions_dir=args.sessions_dir,
        trace_cases_output=args.trace_cases_output,
        trace_runs_output=args.trace_runs_output,
        variant=args.variant,
        holdout_ratio=args.holdout_ratio,
        seed=args.seed,
        max_cases=args.max_cases,
        min_chars=args.min_chars,
        clean_cases_output=args.clean_cases_output,
        clean_runs_output=args.clean_runs_output,
        clean_report_output=args.clean_report_output,
        min_prompt_chars=args.min_prompt_chars,
        min_response_chars=args.min_response_chars,
        max_exact_duplicates_per_prompt=args.max_exact_duplicates_per_prompt,
        similarity_threshold=args.similarity_threshold,
        max_near_duplicates_per_anchor=args.max_near_duplicates_per_anchor,
        whitelist_case_ids_file=args.whitelist_case_ids_file,
        min_cases_per_split=args.min_cases_per_split,
        min_clean_cases=args.min_clean_cases,
        fail_on_low_sample=args.fail_on_low_sample,
        min_clean_cases_by_split=split_thresholds,
        fail_on_split_underflow=args.fail_on_split_underflow,
    )
    if args.print_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    output = {
        "mine_stats": report["mine"]["stats"],
        "clean_stats": report["clean"]["stats"],
        "sample_guard": report["sample_guard"],
        "policy": str(args.policy) if args.policy else None,
        "policy_profile": getattr(args, "profile", None),
        "policy_schema_version": getattr(args, "schema_version", None),
        "policy_hash": policy_hash,
        "outputs": {
            "trace_cases": report["mine"]["cases_output"],
            "trace_runs": report["mine"]["runs_output"],
            "clean_cases": report["clean"]["outputs"]["cases"],
            "clean_runs": report["clean"]["outputs"]["runs"],
        },
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
