#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from evals.trace_pipeline import (  # type: ignore[import-not-found]
        TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION,
        TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION,
        TRACE_PIPELINE_POLICY_SCHEMA,
        compute_trace_pipeline_policy_fingerprint,
        load_trace_pipeline_policy,
    )
else:
    from .trace_pipeline import (
        TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION,
        TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION,
        TRACE_PIPELINE_POLICY_SCHEMA,
        compute_trace_pipeline_policy_fingerprint,
        load_trace_pipeline_policy,
    )


_REQUIRED_FIELDS: tuple[str, ...] = (
    "schema",
    "schema_version",
    "profile",
    "sessions_dir",
    "trace_cases_output",
    "trace_runs_output",
    "variant",
    "holdout_ratio",
    "seed",
    "max_cases",
    "min_chars",
    "clean_cases_output",
    "clean_runs_output",
    "clean_report_output",
    "min_prompt_chars",
    "min_response_chars",
    "max_exact_duplicates_per_prompt",
    "similarity_threshold",
    "max_near_duplicates_per_anchor",
    "min_cases_per_split",
    "min_clean_cases",
    "fail_on_low_sample",
    "min_clean_cases_by_split",
    "fail_on_split_underflow",
)


def validate_policy_config(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    for key in _REQUIRED_FIELDS:
        if key not in config:
            errors.append(f"missing required field: {key}")

    schema_raw = config.get("schema")
    if not isinstance(schema_raw, str) or not schema_raw.strip():
        errors.append("schema must be non-empty string")
    elif schema_raw != TRACE_PIPELINE_POLICY_SCHEMA:
        errors.append(f"unsupported schema: {schema_raw} (expected {TRACE_PIPELINE_POLICY_SCHEMA})")

    profile_raw = config.get("profile")
    if not isinstance(profile_raw, str) or not profile_raw.strip():
        errors.append("profile must be non-empty string")

    schema_version_raw = config.get("schema_version")
    if isinstance(schema_version_raw, bool) or not isinstance(schema_version_raw, int):
        errors.append("schema_version must be int")
    elif (
        schema_version_raw < TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION
        or schema_version_raw > TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION
    ):
        errors.append(
            "unsupported schema_version: "
            f"{schema_version_raw} "
            f"(supported {TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION}-{TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION})"
        )

    fail_on_low_sample = bool(config.get("fail_on_low_sample", False))
    min_clean_cases_raw = config.get("min_clean_cases", 0)
    min_clean_cases = int(min_clean_cases_raw) if isinstance(min_clean_cases_raw, int) else -1
    if min_clean_cases < 0:
        errors.append("min_clean_cases must be >= 0")
    if fail_on_low_sample and min_clean_cases <= 0:
        errors.append("fail_on_low_sample=true requires min_clean_cases > 0")

    min_cases_per_split_raw = config.get("min_cases_per_split", 0)
    if isinstance(min_cases_per_split_raw, int):
        if min_cases_per_split_raw < 0:
            errors.append("min_cases_per_split must be >= 0")
    else:
        errors.append("min_cases_per_split must be int")

    split_thresholds_raw = config.get("min_clean_cases_by_split", {})
    if not isinstance(split_thresholds_raw, dict):
        errors.append("min_clean_cases_by_split must be object")
        split_thresholds: dict[str, int] = {}
    else:
        split_thresholds = {}
        for split_name, value in split_thresholds_raw.items():
            split = str(split_name).strip()
            if not split:
                errors.append("split threshold key must not be empty")
                continue
            if isinstance(value, bool) or not isinstance(value, int):
                errors.append(f"split threshold for {split} must be int")
                continue
            if value <= 0:
                errors.append(f"split threshold for {split} must be > 0")
                continue
            split_thresholds[split] = value

    fail_on_split_underflow = bool(config.get("fail_on_split_underflow", False))
    if fail_on_split_underflow and not split_thresholds:
        errors.append("fail_on_split_underflow=true requires non-empty min_clean_cases_by_split")

    return errors


def validate_policy_file(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    try:
        config = load_trace_pipeline_policy(path)
    except ValueError as exc:
        return None, [str(exc)]
    return config, validate_policy_config(config)


def build_policy_result(policy_path: Path, *, include_details: bool) -> dict[str, Any]:
    config, errors = validate_policy_file(policy_path)
    result: dict[str, Any] = {
        "policy": str(policy_path),
        "ok": len(errors) == 0,
        "errors": list(errors),
    }
    if config is None:
        return result
    try:
        policy_hash, canonical = compute_trace_pipeline_policy_fingerprint(policy_path)
    except ValueError as exc:
        result["ok"] = False
        result["errors"].append(str(exc))
        return result
    result["policy_hash"] = policy_hash
    if include_details:
        result["normalized_keys"] = sorted(config.keys())
        result["canonical_policy"] = canonical
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate trace pipeline policy files")
    parser.add_argument("--policy", type=Path, action="append", required=True, help="Policy file path")
    parser.add_argument("--print-json", action="store_true")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    results: list[dict[str, Any]] = []
    has_error = False

    for policy_path in args.policy:
        result = build_policy_result(policy_path, include_details=args.print_json)
        if not bool(result.get("ok", False)):
            has_error = True
        results.append(result)

    output = {"policies": results}
    print(json.dumps(output, ensure_ascii=False, indent=2 if args.print_json else None))
    if has_error:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
