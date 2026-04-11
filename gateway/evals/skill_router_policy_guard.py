#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from evals.skill_router_eval import (  # type: ignore[import-not-found]
        SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS,
        SKILL_ROUTER_POLICY_SCHEMA,
        SKILL_ROUTER_POLICY_VERSION,
        compute_skill_router_policy_fingerprint,
        load_skill_router_eval_policy,
    )
else:
    from .skill_router_eval import (
        SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS,
        SKILL_ROUTER_POLICY_SCHEMA,
        SKILL_ROUTER_POLICY_VERSION,
        compute_skill_router_policy_fingerprint,
        load_skill_router_eval_policy,
    )


_REQUIRED_FIELDS: tuple[str, ...] = (
    "schema",
    "schema_version",
    "profile",
    "cases",
    "global_skills_dir",
    "project_skills_dir",
    "router_overrides",
    "gates",
)
_REQUIRED_GATE_FIELDS: tuple[str, ...] = (
    "min_accuracy",
    "max_forbidden_violations",
    "max_accuracy_drop",
    "max_forbidden_increase",
)


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_policy_config(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    for key in _REQUIRED_FIELDS:
        if key not in config:
            errors.append(f"missing required field: {key}")

    schema_raw = config.get("schema")
    if not _is_non_empty_string(schema_raw):
        errors.append("schema must be non-empty string")
    elif schema_raw != SKILL_ROUTER_POLICY_SCHEMA:
        errors.append(f"unsupported schema: {schema_raw} (expected {SKILL_ROUTER_POLICY_SCHEMA})")

    profile_raw = config.get("profile")
    if not _is_non_empty_string(profile_raw):
        errors.append("profile must be non-empty string")

    schema_version_raw = config.get("schema_version")
    if isinstance(schema_version_raw, bool) or not isinstance(schema_version_raw, int):
        errors.append("schema_version must be int")
    elif schema_version_raw != SKILL_ROUTER_POLICY_VERSION:
        errors.append(
            f"unsupported schema_version: {schema_version_raw} (expected {SKILL_ROUTER_POLICY_VERSION})"
        )

    for path_key in ("cases", "global_skills_dir", "project_skills_dir"):
        if not _is_non_empty_string(config.get(path_key)):
            errors.append(f"{path_key} must be non-empty string")

    router_overrides_raw = config.get("router_overrides")
    if not isinstance(router_overrides_raw, dict):
        errors.append("router_overrides must be object")
        router_overrides: dict[str, Any] = {}
    else:
        router_overrides = router_overrides_raw
        for field in SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS:
            if field not in router_overrides:
                errors.append(f"router_overrides missing field: {field}")
    score_threshold = router_overrides.get("score_threshold")
    if isinstance(score_threshold, bool) or not isinstance(score_threshold, (int, float)):
        errors.append("router_overrides.score_threshold must be number")
    elif float(score_threshold) < 0.0:
        errors.append("router_overrides.score_threshold must be >= 0")
    min_score_gap = router_overrides.get("min_score_gap")
    if isinstance(min_score_gap, bool) or not isinstance(min_score_gap, (int, float)):
        errors.append("router_overrides.min_score_gap must be number")
    elif float(min_score_gap) < 0.0:
        errors.append("router_overrides.min_score_gap must be >= 0")
    max_descriptors = router_overrides.get("max_descriptors")
    if isinstance(max_descriptors, bool) or not isinstance(max_descriptors, int):
        errors.append("router_overrides.max_descriptors must be int")
    elif max_descriptors <= 0:
        errors.append("router_overrides.max_descriptors must be > 0")
    descriptor_scan_lines = router_overrides.get("descriptor_scan_lines")
    if isinstance(descriptor_scan_lines, bool) or not isinstance(descriptor_scan_lines, int):
        errors.append("router_overrides.descriptor_scan_lines must be int")
    elif descriptor_scan_lines <= 0:
        errors.append("router_overrides.descriptor_scan_lines must be > 0")

    gates_raw = config.get("gates")
    if not isinstance(gates_raw, dict):
        errors.append("gates must be object")
        gates: dict[str, Any] = {}
    else:
        gates = gates_raw
        for field in _REQUIRED_GATE_FIELDS:
            if field not in gates:
                errors.append(f"gates missing field: {field}")
    min_accuracy = gates.get("min_accuracy")
    if isinstance(min_accuracy, bool) or not isinstance(min_accuracy, (int, float)):
        errors.append("gates.min_accuracy must be number")
    elif float(min_accuracy) < 0.0 or float(min_accuracy) > 1.0:
        errors.append("gates.min_accuracy must be within [0, 1]")
    max_forbidden_violations = gates.get("max_forbidden_violations")
    if isinstance(max_forbidden_violations, bool) or not isinstance(max_forbidden_violations, int):
        errors.append("gates.max_forbidden_violations must be int")
    elif max_forbidden_violations < 0:
        errors.append("gates.max_forbidden_violations must be >= 0")
    max_accuracy_drop = gates.get("max_accuracy_drop")
    if isinstance(max_accuracy_drop, bool) or not isinstance(max_accuracy_drop, (int, float)):
        errors.append("gates.max_accuracy_drop must be number")
    elif float(max_accuracy_drop) < 0.0 or float(max_accuracy_drop) > 1.0:
        errors.append("gates.max_accuracy_drop must be within [0, 1]")
    max_forbidden_increase = gates.get("max_forbidden_increase")
    if isinstance(max_forbidden_increase, bool) or not isinstance(max_forbidden_increase, int):
        errors.append("gates.max_forbidden_increase must be int")
    elif max_forbidden_increase < 0:
        errors.append("gates.max_forbidden_increase must be >= 0")

    return errors


def validate_policy_file(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    try:
        policy = load_skill_router_eval_policy(path)
    except ValueError as exc:
        return None, [str(exc)]
    config = policy.to_dict()
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
        policy_hash, canonical = compute_skill_router_policy_fingerprint(policy_path)
    except ValueError as exc:
        result["ok"] = False
        result["errors"].append(str(exc))
        return result
    result["policy_hash"] = f"sha256:{policy_hash}"
    if include_details:
        result["normalized_keys"] = sorted(config.keys())
        result["canonical_policy"] = canonical
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate skill-router policy files")
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
