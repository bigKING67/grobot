#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

CI_LABEL_POLICY_SCHEMA = "ci_label_policy"
CI_LABEL_POLICY_VERSION = 1
_REQUIRED_FIELDS: tuple[str, ...] = (
    "schema",
    "schema_version",
    "safe_label_pattern",
    "comment_marker",
    "comment_trigger",
    "comment_template",
    "policy_drift",
    "managed_label_prefixes",
    "default_color",
    "default_description",
    "label_rules",
)
_ALLOWED_FIELDS: set[str] = set(_REQUIRED_FIELDS)
_COMMENT_TEMPLATE_ALLOWED_KEYS: set[str] = {
    "overall",
    "trend_tag",
    "trend_severity",
    "policy_drift",
    "owner",
    "action",
    "suggested_labels",
}
_COMMENT_TEMPLATE_ALLOWED_FORMATS: set[str] = {"text", "code"}
_COMMENT_TRIGGER_ALLOWED_KEYS: set[str] = {"overall_states", "trend_severities"}
_COMMENT_TRIGGER_OVERALL_STATES: set[str] = {"pass", "fail", "unknown"}
_COMMENT_TRIGGER_TREND_SEVERITIES: set[str] = {"info", "warn", "error"}
_POLICY_DRIFT_ALLOWED_KEYS: set[str] = {
    "label_prefix",
    "worsening_alert_threshold",
    "worsening_label",
    "comment_trigger_severities",
    "action_hints",
}
_POLICY_DRIFT_ALLOWED_SEVERITIES: set[str] = {"high", "medium", "low", "none"}


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_color(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-fA-F]{6}", value.strip()))


def _normalize_policy(policy: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": str(policy.get("schema", "")).strip(),
        "schema_version": int(policy.get("schema_version", 0)),
        "safe_label_pattern": str(policy.get("safe_label_pattern", "")).strip(),
        "comment_marker": str(policy.get("comment_marker", "")).strip(),
        "comment_trigger": {
            "overall_states": [
                str(value).strip()
                for value in policy.get("comment_trigger", {}).get("overall_states", [])
                if isinstance(policy.get("comment_trigger"), dict) and isinstance(value, str)
            ],
            "trend_severities": [
                str(value).strip()
                for value in policy.get("comment_trigger", {}).get("trend_severities", [])
                if isinstance(policy.get("comment_trigger"), dict) and isinstance(value, str)
            ],
        },
        "comment_template": {
            "title": str(policy.get("comment_template", {}).get("title", "")).strip()
            if isinstance(policy.get("comment_template"), dict)
            else "",
            "fields": [
                {
                    "key": str(field.get("key", "")).strip(),
                    "label": str(field.get("label", "")).strip(),
                    "format": str(field.get("format", "")).strip(),
                }
                for field in policy.get("comment_template", {}).get("fields", [])
                if isinstance(policy.get("comment_template"), dict) and isinstance(field, dict)
            ],
        },
        "policy_drift": {
            "label_prefix": str(policy.get("policy_drift", {}).get("label_prefix", "")).strip()
            if isinstance(policy.get("policy_drift"), dict)
            else "",
            "worsening_alert_threshold": (
                int(policy.get("policy_drift", {}).get("worsening_alert_threshold", 0))
                if isinstance(policy.get("policy_drift"), dict)
                and isinstance(policy.get("policy_drift", {}).get("worsening_alert_threshold"), int)
                else 0
            ),
            "worsening_label": str(policy.get("policy_drift", {}).get("worsening_label", "")).strip()
            if isinstance(policy.get("policy_drift"), dict)
            else "",
            "comment_trigger_severities": [
                str(value).strip()
                for value in policy.get("policy_drift", {}).get("comment_trigger_severities", [])
                if isinstance(policy.get("policy_drift"), dict) and isinstance(value, str)
            ],
            "action_hints": {
                str(key).strip(): str(value).strip()
                for key, value in policy.get("policy_drift", {}).get("action_hints", {}).items()
                if isinstance(policy.get("policy_drift"), dict)
                and isinstance(policy.get("policy_drift", {}).get("action_hints"), dict)
                and isinstance(key, str)
                and isinstance(value, str)
            },
        },
        "managed_label_prefixes": [
            str(prefix).strip() for prefix in policy.get("managed_label_prefixes", []) if isinstance(prefix, str)
        ],
        "default_color": str(policy.get("default_color", "")).strip().lower(),
        "default_description": str(policy.get("default_description", "")).strip(),
        "label_rules": [
            {
                "prefix": str(rule.get("prefix", "")).strip(),
                "color": str(rule.get("color", "")).strip().lower(),
                "description": str(rule.get("description", "")).strip(),
            }
            for rule in policy.get("label_rules", [])
            if isinstance(rule, dict)
        ],
    }


def compute_ci_label_policy_fingerprint(policy_path: Path) -> tuple[str, dict[str, Any]]:
    policy = load_ci_label_policy(policy_path)
    canonical = _normalize_policy(policy)
    encoded = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest(), canonical


def validate_ci_label_policy_config(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    for key in _REQUIRED_FIELDS:
        if key not in config:
            errors.append(f"missing required field: {key}")

    unknown_fields = sorted(key for key in config.keys() if key not in _ALLOWED_FIELDS)
    if unknown_fields:
        errors.append(f"unknown fields: {', '.join(unknown_fields)}")

    schema_raw = config.get("schema")
    if not _is_non_empty_string(schema_raw):
        errors.append("schema must be non-empty string")
    elif schema_raw != CI_LABEL_POLICY_SCHEMA:
        errors.append(f"unsupported schema: {schema_raw} (expected {CI_LABEL_POLICY_SCHEMA})")

    schema_version_raw = config.get("schema_version")
    if isinstance(schema_version_raw, bool) or not isinstance(schema_version_raw, int):
        errors.append("schema_version must be int")
    elif schema_version_raw != CI_LABEL_POLICY_VERSION:
        errors.append(
            f"unsupported schema_version: {schema_version_raw} (expected {CI_LABEL_POLICY_VERSION})"
        )

    safe_label_pattern = config.get("safe_label_pattern")
    safe_label_regex: re.Pattern[str] | None = None
    if not _is_non_empty_string(safe_label_pattern):
        errors.append("safe_label_pattern must be non-empty string")
    else:
        try:
            safe_label_regex = re.compile(str(safe_label_pattern))
            if safe_label_regex.match("ci/harness-pass") is None:
                errors.append("safe_label_pattern must match ci/harness-pass")
        except re.error as exc:
            errors.append(f"safe_label_pattern is invalid regex: {exc}")

    comment_marker = config.get("comment_marker")
    if not _is_non_empty_string(comment_marker):
        errors.append("comment_marker must be non-empty string")
    elif "<!--" not in str(comment_marker):
        errors.append("comment_marker must include HTML marker syntax")

    comment_trigger_raw = config.get("comment_trigger")
    if not isinstance(comment_trigger_raw, dict):
        errors.append("comment_trigger must be object")
        comment_trigger: dict[str, Any] = {}
    else:
        comment_trigger = comment_trigger_raw
        unknown_comment_trigger_fields = sorted(
            key for key in comment_trigger.keys() if key not in _COMMENT_TRIGGER_ALLOWED_KEYS
        )
        if unknown_comment_trigger_fields:
            errors.append(
                "comment_trigger has unknown fields: "
                + ", ".join(unknown_comment_trigger_fields)
            )
    overall_states_raw = comment_trigger.get("overall_states")
    if not isinstance(overall_states_raw, list):
        errors.append("comment_trigger.overall_states must be array")
        overall_states: list[str] = []
    else:
        overall_states = []
        seen_overall_states: set[str] = set()
        for index, value in enumerate(overall_states_raw):
            if not _is_non_empty_string(value):
                errors.append(f"comment_trigger.overall_states[{index}] must be non-empty string")
                continue
            normalized = str(value).strip()
            if normalized not in _COMMENT_TRIGGER_OVERALL_STATES:
                errors.append(
                    f"comment_trigger.overall_states[{index}] must be one of {sorted(_COMMENT_TRIGGER_OVERALL_STATES)}"
                )
            if normalized in seen_overall_states:
                errors.append(f"duplicate comment_trigger.overall_states value: {normalized}")
            else:
                seen_overall_states.add(normalized)
            overall_states.append(normalized)
    trend_severities_raw = comment_trigger.get("trend_severities")
    if not isinstance(trend_severities_raw, list):
        errors.append("comment_trigger.trend_severities must be array")
        trend_severities: list[str] = []
    else:
        trend_severities = []
        seen_trend_severities: set[str] = set()
        for index, value in enumerate(trend_severities_raw):
            if not _is_non_empty_string(value):
                errors.append(f"comment_trigger.trend_severities[{index}] must be non-empty string")
                continue
            normalized = str(value).strip()
            if normalized not in _COMMENT_TRIGGER_TREND_SEVERITIES:
                errors.append(
                    "comment_trigger.trend_severities"
                    f"[{index}] must be one of {sorted(_COMMENT_TRIGGER_TREND_SEVERITIES)}"
                )
            if normalized in seen_trend_severities:
                errors.append(f"duplicate comment_trigger.trend_severities value: {normalized}")
            else:
                seen_trend_severities.add(normalized)
            trend_severities.append(normalized)
    if not overall_states and not trend_severities:
        errors.append("comment_trigger must include at least one overall_state or trend_severity")

    comment_template_raw = config.get("comment_template")
    if not isinstance(comment_template_raw, dict):
        errors.append("comment_template must be object")
        comment_template: dict[str, Any] = {}
    else:
        comment_template = comment_template_raw
    comment_template_title = comment_template.get("title")
    if not _is_non_empty_string(comment_template_title):
        errors.append("comment_template.title must be non-empty string")
    comment_template_fields_raw = comment_template.get("fields")
    if not isinstance(comment_template_fields_raw, list):
        errors.append("comment_template.fields must be array")
        comment_template_fields: list[dict[str, Any]] = []
    else:
        comment_template_fields = [field for field in comment_template_fields_raw if isinstance(field, dict)]
        if len(comment_template_fields) != len(comment_template_fields_raw):
            errors.append("comment_template.fields entries must be objects")
    if not comment_template_fields:
        errors.append("comment_template.fields must not be empty")

    seen_comment_field_keys: set[str] = set()
    for index, field in enumerate(comment_template_fields):
        key_raw = field.get("key")
        label_raw = field.get("label")
        format_raw = field.get("format")

        if not _is_non_empty_string(key_raw):
            errors.append(f"comment_template.fields[{index}].key must be non-empty string")
            key = ""
        else:
            key = str(key_raw).strip()
            if key not in _COMMENT_TEMPLATE_ALLOWED_KEYS:
                errors.append(
                    f"comment_template.fields[{index}].key must be one of {sorted(_COMMENT_TEMPLATE_ALLOWED_KEYS)}"
                )
            if key in seen_comment_field_keys:
                errors.append(f"duplicate comment_template field key: {key}")
            seen_comment_field_keys.add(key)
        if not _is_non_empty_string(label_raw):
            errors.append(f"comment_template.fields[{index}].label must be non-empty string")
        if not _is_non_empty_string(format_raw):
            errors.append(f"comment_template.fields[{index}].format must be non-empty string")
        else:
            fmt = str(format_raw).strip()
            if fmt not in _COMMENT_TEMPLATE_ALLOWED_FORMATS:
                errors.append(
                    f"comment_template.fields[{index}].format must be one of {sorted(_COMMENT_TEMPLATE_ALLOWED_FORMATS)}"
                )

    policy_drift_raw = config.get("policy_drift")
    if not isinstance(policy_drift_raw, dict):
        errors.append("policy_drift must be object")
        policy_drift: dict[str, Any] = {}
    else:
        policy_drift = policy_drift_raw
        unknown_policy_drift_fields = sorted(
            key for key in policy_drift.keys() if key not in _POLICY_DRIFT_ALLOWED_KEYS
        )
        if unknown_policy_drift_fields:
            errors.append("policy_drift has unknown fields: " + ", ".join(unknown_policy_drift_fields))

    label_prefix_raw = policy_drift.get("label_prefix")
    if not _is_non_empty_string(label_prefix_raw):
        errors.append("policy_drift.label_prefix must be non-empty string")
        policy_drift_label_prefix = ""
    else:
        policy_drift_label_prefix = str(label_prefix_raw).strip()
        if not policy_drift_label_prefix.startswith("ci/"):
            errors.append("policy_drift.label_prefix must start with ci/")
        if safe_label_regex is not None and safe_label_regex.match(f"{policy_drift_label_prefix}x") is None:
            errors.append(
                "policy_drift.label_prefix is incompatible with safe_label_pattern: "
                + policy_drift_label_prefix
            )

    worsening_alert_threshold_raw = policy_drift.get("worsening_alert_threshold")
    if isinstance(worsening_alert_threshold_raw, bool) or not isinstance(worsening_alert_threshold_raw, int):
        errors.append("policy_drift.worsening_alert_threshold must be int")
        worsening_alert_threshold = 0
    else:
        worsening_alert_threshold = worsening_alert_threshold_raw
        if worsening_alert_threshold < 1:
            errors.append("policy_drift.worsening_alert_threshold must be >= 1")

    worsening_label_raw = policy_drift.get("worsening_label")
    if not _is_non_empty_string(worsening_label_raw):
        errors.append("policy_drift.worsening_label must be non-empty string")
        policy_drift_worsening_label = ""
    else:
        policy_drift_worsening_label = str(worsening_label_raw).strip()
        if not policy_drift_worsening_label.startswith("ci/"):
            errors.append("policy_drift.worsening_label must start with ci/")
        if policy_drift_label_prefix and not policy_drift_worsening_label.startswith(policy_drift_label_prefix):
            errors.append(
                "policy_drift.worsening_label must start with policy_drift.label_prefix: "
                + policy_drift_worsening_label
            )
        if safe_label_regex is not None and safe_label_regex.match(policy_drift_worsening_label) is None:
            errors.append(
                "policy_drift.worsening_label is incompatible with safe_label_pattern: "
                + policy_drift_worsening_label
            )

    policy_drift_trigger_raw = policy_drift.get("comment_trigger_severities")
    if not isinstance(policy_drift_trigger_raw, list):
        errors.append("policy_drift.comment_trigger_severities must be array")
        policy_drift_trigger_severities: list[str] = []
    else:
        policy_drift_trigger_severities = []
        seen_policy_drift_trigger_severities: set[str] = set()
        for index, value in enumerate(policy_drift_trigger_raw):
            if not _is_non_empty_string(value):
                errors.append(
                    f"policy_drift.comment_trigger_severities[{index}] must be non-empty string"
                )
                continue
            normalized = str(value).strip()
            if normalized not in _POLICY_DRIFT_ALLOWED_SEVERITIES:
                errors.append(
                    "policy_drift.comment_trigger_severities"
                    f"[{index}] must be one of {sorted(_POLICY_DRIFT_ALLOWED_SEVERITIES)}"
                )
            if normalized in seen_policy_drift_trigger_severities:
                errors.append(
                    "duplicate policy_drift.comment_trigger_severities value: " + normalized
                )
            else:
                seen_policy_drift_trigger_severities.add(normalized)
            policy_drift_trigger_severities.append(normalized)
        if not policy_drift_trigger_severities:
            errors.append("policy_drift.comment_trigger_severities must not be empty")

    policy_drift_action_hints_raw = policy_drift.get("action_hints")
    if not isinstance(policy_drift_action_hints_raw, dict):
        errors.append("policy_drift.action_hints must be object")
        policy_drift_action_hints: dict[str, Any] = {}
    else:
        policy_drift_action_hints = policy_drift_action_hints_raw
        unknown_action_hint_keys = sorted(
            str(key) for key in policy_drift_action_hints.keys() if key not in _POLICY_DRIFT_ALLOWED_SEVERITIES
        )
        if unknown_action_hint_keys:
            errors.append(
                "policy_drift.action_hints has unknown keys: " + ", ".join(unknown_action_hint_keys)
            )
    for severity in sorted(_POLICY_DRIFT_ALLOWED_SEVERITIES):
        if severity not in policy_drift_action_hints:
            errors.append(f"policy_drift.action_hints.{severity} must be non-empty string")
            continue
        value = policy_drift_action_hints.get(severity)
        if not _is_non_empty_string(value):
            errors.append(f"policy_drift.action_hints.{severity} must be non-empty string")

    if not _is_color(config.get("default_color")):
        errors.append("default_color must be 6-digit hex")
    if not _is_non_empty_string(config.get("default_description")):
        errors.append("default_description must be non-empty string")

    managed_prefixes_raw = config.get("managed_label_prefixes")
    if not isinstance(managed_prefixes_raw, list):
        errors.append("managed_label_prefixes must be array")
        managed_prefixes: list[str] = []
    else:
        managed_prefixes = []
        for index, value in enumerate(managed_prefixes_raw):
            if not _is_non_empty_string(value):
                errors.append(f"managed_label_prefixes[{index}] must be non-empty string")
                continue
            prefix = str(value).strip()
            managed_prefixes.append(prefix)
        if not managed_prefixes:
            errors.append("managed_label_prefixes must not be empty")
    seen_managed_prefixes: set[str] = set()
    for index, prefix in enumerate(managed_prefixes):
        if not prefix.startswith("ci/"):
            errors.append(f"managed_label_prefixes[{index}] must start with ci/")
        if prefix in seen_managed_prefixes:
            errors.append(f"duplicate managed label prefix: {prefix}")
        seen_managed_prefixes.add(prefix)
        if safe_label_regex is not None and safe_label_regex.match(f"{prefix}x") is None:
            errors.append(
                f"managed_label_prefixes[{index}] is incompatible with safe_label_pattern: {prefix}"
            )
    if (
        policy_drift_label_prefix
        and managed_prefixes
        and policy_drift_label_prefix not in managed_prefixes
    ):
        errors.append(
            "policy_drift.label_prefix must be included in managed_label_prefixes: "
            + policy_drift_label_prefix
        )
    if (
        policy_drift_worsening_label
        and managed_prefixes
        and policy_drift_worsening_label not in managed_prefixes
    ):
        errors.append(
            "policy_drift.worsening_label must be included in managed_label_prefixes: "
            + policy_drift_worsening_label
        )

    label_rules_raw = config.get("label_rules")
    if not isinstance(label_rules_raw, list):
        errors.append("label_rules must be array")
        label_rules: list[dict[str, Any]] = []
    else:
        label_rules = [rule for rule in label_rules_raw if isinstance(rule, dict)]
        if len(label_rules) != len(label_rules_raw):
            errors.append("label_rules entries must be objects")
    if not label_rules:
        errors.append("label_rules must not be empty")

    seen_prefixes: set[str] = set()
    for index, rule in enumerate(label_rules):
        prefix = rule.get("prefix")
        color = rule.get("color")
        description = rule.get("description")

        if not _is_non_empty_string(prefix):
            errors.append(f"label_rules[{index}].prefix must be non-empty string")
            normalized_prefix = ""
        else:
            normalized_prefix = str(prefix).strip()
            if not normalized_prefix.startswith("ci/"):
                errors.append(f"label_rules[{index}].prefix must start with ci/")
            if normalized_prefix in seen_prefixes:
                errors.append(f"duplicate label rule prefix: {normalized_prefix}")
            seen_prefixes.add(normalized_prefix)
            if managed_prefixes and not any(
                normalized_prefix.startswith(managed_prefix) for managed_prefix in managed_prefixes
            ):
                errors.append(
                    f"label_rules[{index}].prefix is not covered by managed_label_prefixes: {normalized_prefix}"
                )

        if not _is_color(color):
            errors.append(f"label_rules[{index}].color must be 6-digit hex")
        if not _is_non_empty_string(description):
            errors.append(f"label_rules[{index}].description must be non-empty string")

    return errors


def load_ci_label_policy(policy_path: Path) -> dict[str, Any]:
    with policy_path.open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"{policy_path} must be a JSON object")
    return loaded


def validate_ci_label_policy_file(policy_path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    try:
        policy = load_ci_label_policy(policy_path)
    except (ValueError, json.JSONDecodeError) as exc:
        return None, [str(exc)]
    return policy, validate_ci_label_policy_config(policy)


def build_policy_result(policy_path: Path, *, include_details: bool) -> dict[str, Any]:
    config, errors = validate_ci_label_policy_file(policy_path)
    result: dict[str, Any] = {
        "policy": str(policy_path),
        "ok": len(errors) == 0,
        "errors": list(errors),
    }
    if config is None:
        return result
    try:
        policy_hash, canonical = compute_ci_label_policy_fingerprint(policy_path)
    except ValueError as exc:
        result["ok"] = False
        result["errors"].append(str(exc))
        return result
    result["policy_hash"] = f"sha256:{policy_hash}"
    if include_details:
        result["normalized_keys"] = sorted(canonical.keys())
        result["canonical_policy"] = canonical
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate ci-label policy files")
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
