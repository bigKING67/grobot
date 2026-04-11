#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

_POLICY_DRIFT_SEVERITY_ORDER: dict[str, int] = {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must be a JSON object")
    return payload


def _normalize_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _normalize_policy_drift_severity(value: Any) -> str:
    normalized = _normalize_optional_text(value)
    if normalized in _POLICY_DRIFT_SEVERITY_ORDER:
        return normalized
    return "none"


def _compute_policy_drift_transition_state(*, previous_severity: str, severity: str) -> tuple[str, int]:
    previous_order = _POLICY_DRIFT_SEVERITY_ORDER.get(previous_severity, 0)
    current_order = _POLICY_DRIFT_SEVERITY_ORDER.get(severity, 0)
    delta = current_order - previous_order
    if previous_order == 0 and current_order == 0:
        return "stable_none", 0
    if previous_order == 0 and current_order > 0:
        return "introduced", delta
    if previous_order > 0 and current_order == 0:
        return "resolved", delta
    if delta > 0:
        return "worsened", delta
    if delta < 0:
        return "improved", delta
    return "persistent", 0


def _compute_policy_drift_owner(*, severity: str) -> str:
    if severity == "high":
        return "policy-governance"
    if severity == "medium":
        return "policy-maintainers"
    if severity == "low":
        return "policy-maintainers"
    return "release-owner"


def _compute_policy_drift_action_hint(*, severity: str, reason: str, transition_state: str) -> str:
    if severity == "none":
        if transition_state == "resolved":
            return "policy drift resolved; keep ci_label_policy guard and runtime in sync."
        return "n/a"

    reason_action_hints: dict[str, str] = {
        "schema_mismatch": "sync ci_label_policy schema/runtime contract before merge.",
        "missing_fields": "add missing required fields and re-run policy guard.",
        "unknown_fields": "remove or gate unknown fields, then align policy guard.",
        "shape_ok": "re-check policy_drift report generation path.",
    }
    base_hint = reason_action_hints.get(reason, "inspect policy drift diagnostics and align policy definition.")
    if transition_state in {"introduced", "worsened"}:
        return f"policy drift worsened; {base_hint}"
    if transition_state == "improved":
        return f"policy drift improved but still unresolved; {base_hint}"
    return f"policy drift persists; {base_hint}"


def _normalize_policy_drift_report(policy_drift_report: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(policy_drift_report, dict):
        policy_drift_report = {}

    severity = _normalize_policy_drift_severity(policy_drift_report.get("severity"))
    reason = _normalize_optional_text(policy_drift_report.get("reason")) or "shape_ok"
    previous_severity = _normalize_policy_drift_severity(policy_drift_report.get("previous_severity"))
    previous_reason = _normalize_optional_text(policy_drift_report.get("previous_reason")) or "shape_ok"
    worsening_streak_raw = policy_drift_report.get("worsening_streak")
    worsening_streak = int(worsening_streak_raw) if isinstance(worsening_streak_raw, int) else 0
    if worsening_streak < 0:
        worsening_streak = 0
    worsening_alert = bool(policy_drift_report.get("worsening_alert", False))
    worsening_alert_threshold_raw = policy_drift_report.get("worsening_alert_threshold")
    worsening_alert_threshold = (
        int(worsening_alert_threshold_raw)
        if isinstance(worsening_alert_threshold_raw, int) and worsening_alert_threshold_raw > 0
        else 2
    )
    worsening_label_raw = _normalize_optional_text(policy_drift_report.get("worsening_label"))
    worsening_label = worsening_label_raw if worsening_label_raw is not None else "ci/policy-drift-worsening"
    transition = f"{previous_severity}->{severity}"
    transition_state, severity_delta = _compute_policy_drift_transition_state(
        previous_severity=previous_severity,
        severity=severity,
    )
    owner = _compute_policy_drift_owner(severity=severity)
    action_hint = _compute_policy_drift_action_hint(
        severity=severity,
        reason=reason,
        transition_state=transition_state,
    )
    return {
        "severity": severity,
        "reason": reason,
        "label": f"{severity}:{reason}",
        "previous_severity": previous_severity,
        "previous_reason": previous_reason,
        "worsening_streak": worsening_streak,
        "worsening_alert": worsening_alert,
        "worsening_alert_threshold": worsening_alert_threshold,
        "worsening_label": worsening_label,
        "transition": transition,
        "transition_state": transition_state,
        "severity_delta": severity_delta,
        "owner": owner,
        "action_hint": action_hint,
    }


def _compute_trend_decision_tag(
    *,
    trend_required: bool,
    trend_mode: str | None,
    trend_reason: str | None,
    trend_pass: bool | None,
) -> str:
    if trend_required:
        if trend_pass is True:
            return "TREND_REQUIRED_PASS"
        if trend_pass is False:
            return "TREND_REQUIRED_FAIL"
        return "TREND_REQUIRED_MISSING"

    if trend_mode == "gate_and_trend":
        if trend_pass is True:
            return "TREND_EXECUTED_PASS"
        if trend_pass is False:
            return "TREND_EXECUTED_FAIL"
        return "TREND_EXECUTED_NO_RESULT"

    if trend_mode == "gate_only":
        reason_to_tag = {
            "policy_blob_mismatch": "TREND_SKIPPED_POLICY_CHANGED",
            "artifact_missing": "TREND_SKIPPED_ARTIFACT_MISSING",
            "baseline_unavailable": "TREND_SKIPPED_BASELINE_UNAVAILABLE",
            "baseline_report_missing": "TREND_SKIPPED_BASE_REPORT_MISSING",
            "policy_blob_unavailable": "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE",
        }
        return reason_to_tag.get(trend_reason, "TREND_SKIPPED_GATE_ONLY")

    if trend_mode is None:
        if trend_pass is None:
            return "TREND_NOT_REQUESTED"
        return "TREND_RESULT_WITHOUT_MODE"
    return "TREND_UNKNOWN_MODE"


def _compute_trend_decision_severity(tag: str) -> str:
    error_tags = {
        "TREND_REQUIRED_FAIL",
        "TREND_REQUIRED_MISSING",
        "TREND_EXECUTED_FAIL",
    }
    warn_tags = {
        "TREND_EXECUTED_NO_RESULT",
        "TREND_SKIPPED_POLICY_CHANGED",
        "TREND_SKIPPED_ARTIFACT_MISSING",
        "TREND_SKIPPED_BASELINE_UNAVAILABLE",
        "TREND_SKIPPED_BASE_REPORT_MISSING",
        "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE",
        "TREND_SKIPPED_GATE_ONLY",
        "TREND_RESULT_WITHOUT_MODE",
        "TREND_UNKNOWN_MODE",
    }
    if tag in error_tags:
        return "error"
    if tag in warn_tags:
        return "warn"
    return "info"


def _compute_trend_action_hint(tag: str) -> str:
    action_hints = {
        "TREND_REQUIRED_PASS": "required trend checks passed",
        "TREND_REQUIRED_FAIL": "required trend failed; inspect baseline and current report diff",
        "TREND_REQUIRED_MISSING": "required trend missing; ensure compare-report is generated and loaded",
        "TREND_EXECUTED_PASS": "trend executed and passed",
        "TREND_EXECUTED_FAIL": "trend executed and failed; inspect accuracy/forbidden deltas",
        "TREND_EXECUTED_NO_RESULT": "trend execution reported no result; inspect evaluator output",
        "TREND_SKIPPED_POLICY_CHANGED": "trend skipped because policy changed between base and head",
        "TREND_SKIPPED_ARTIFACT_MISSING": "trend skipped because baseline artifact is missing",
        "TREND_SKIPPED_BASELINE_UNAVAILABLE": "trend skipped because base SHA is unavailable",
        "TREND_SKIPPED_BASE_REPORT_MISSING": "trend skipped because baseline report file is missing",
        "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE": "trend skipped because policy blob could not be resolved",
        "TREND_SKIPPED_GATE_ONLY": "trend skipped in gate-only mode",
        "TREND_NOT_REQUESTED": "trend not required for this run",
        "TREND_RESULT_WITHOUT_MODE": "trend result exists but mode is missing",
        "TREND_UNKNOWN_MODE": "trend mode is unknown; check trend_meta payload",
    }
    return action_hints.get(tag, "no action hint available")


def _compute_trend_owner(tag: str) -> str:
    policy_owner_tags = {
        "TREND_SKIPPED_POLICY_CHANGED",
        "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE",
    }
    ci_owner_tags = {
        "TREND_SKIPPED_ARTIFACT_MISSING",
        "TREND_SKIPPED_BASELINE_UNAVAILABLE",
        "TREND_SKIPPED_BASE_REPORT_MISSING",
        "TREND_EXECUTED_NO_RESULT",
        "TREND_RESULT_WITHOUT_MODE",
        "TREND_UNKNOWN_MODE",
    }
    router_owner_tags = {
        "TREND_REQUIRED_FAIL",
        "TREND_REQUIRED_MISSING",
        "TREND_EXECUTED_FAIL",
        "TREND_REQUIRED_PASS",
        "TREND_EXECUTED_PASS",
    }
    if tag in policy_owner_tags:
        return "policy-governance"
    if tag in ci_owner_tags:
        return "ci-infra"
    if tag in router_owner_tags:
        return "router-evals"
    if tag in {"TREND_SKIPPED_GATE_ONLY", "TREND_NOT_REQUESTED"}:
        return "release-owner"
    return "unknown-owner"


def _slugify_label_segment(value: str) -> str:
    normalized = value.strip().lower().replace("/", "-").replace("_", "-")
    parts: list[str] = []
    for raw in normalized.split("-"):
        cleaned = "".join(ch for ch in raw if ch.isalnum())
        if cleaned:
            parts.append(cleaned)
    if parts:
        return "-".join(parts)
    return "unknown"


def _compute_suggested_labels(
    *,
    overall_pass: bool,
    trend_decision_tag: str,
    trend_decision_severity: str,
    trend_owner: str,
) -> list[str]:
    labels: list[str] = [
        f"ci/harness-{'pass' if overall_pass else 'fail'}",
        f"ci/severity-{_slugify_label_segment(trend_decision_severity)}",
        f"ci/owner-{_slugify_label_segment(trend_owner)}",
        f"ci/{_slugify_label_segment(trend_decision_tag)}",
    ]
    if trend_decision_severity == "error":
        labels.append("ci/action-required")
    elif trend_decision_severity == "warn":
        labels.append("ci/action-review")

    deduped: list[str] = []
    seen: set[str] = set()
    for label in labels:
        if label in seen:
            continue
        seen.add(label)
        deduped.append(label)
    return deduped


def build_harness_ci_summary(
    *,
    trace_report: dict[str, Any],
    skill_router_report: dict[str, Any],
    policy_drift_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    trace_clean_stats = trace_report.get("clean_stats") if isinstance(trace_report.get("clean_stats"), dict) else {}
    if not trace_clean_stats:
        clean_payload = trace_report.get("clean") if isinstance(trace_report.get("clean"), dict) else {}
        trace_clean_stats = clean_payload.get("stats") if isinstance(clean_payload.get("stats"), dict) else {}
    trace_sample_guard = trace_report.get("sample_guard") if isinstance(trace_report.get("sample_guard"), dict) else {}
    trace_split = trace_sample_guard.get("split") if isinstance(trace_sample_guard.get("split"), dict) else {}
    trace_split_counts = trace_split.get("counts") if isinstance(trace_split.get("counts"), dict) else {}

    skill_summary = (
        skill_router_report.get("summary") if isinstance(skill_router_report.get("summary"), dict) else {}
    )
    skill_gate = skill_router_report.get("gate") if isinstance(skill_router_report.get("gate"), dict) else {}
    trend = skill_router_report.get("trend") if isinstance(skill_router_report.get("trend"), dict) else None
    trend_meta = skill_router_report.get("trend_meta") if isinstance(skill_router_report.get("trend_meta"), dict) else {}

    trace_pass = bool(trace_sample_guard.get("pass", False))
    skill_gate_pass = bool(skill_gate.get("passed", False))
    policy_drift = _normalize_policy_drift_report(policy_drift_report)
    trend_required = bool(trend_meta.get("required", False))
    trend_mode = _normalize_optional_text(trend_meta.get("mode"))
    trend_reason = _normalize_optional_text(trend_meta.get("reason"))
    skill_trend_pass: bool | None = None
    if isinstance(trend, dict):
        skill_trend_pass = bool(trend.get("passed", False))
    if trend_required and skill_trend_pass is None:
        skill_trend_pass = False
    trend_decision_tag = _compute_trend_decision_tag(
        trend_required=trend_required,
        trend_mode=trend_mode,
        trend_reason=trend_reason,
        trend_pass=skill_trend_pass,
    )
    trend_decision_severity = _compute_trend_decision_severity(trend_decision_tag)
    trend_action_hint = _compute_trend_action_hint(trend_decision_tag)
    trend_owner = _compute_trend_owner(trend_decision_tag)

    trend_pass_for_overall = True if skill_trend_pass is None else skill_trend_pass
    overall_pass = trace_pass and skill_gate_pass and trend_pass_for_overall
    suggested_labels = _compute_suggested_labels(
        overall_pass=overall_pass,
        trend_decision_tag=trend_decision_tag,
        trend_decision_severity=trend_decision_severity,
        trend_owner=trend_owner,
    )

    trace_policy_hash = trace_report.get("policy_hash")
    if trace_policy_hash is None:
        trace_policy = trace_report.get("policy") if isinstance(trace_report.get("policy"), dict) else {}
        if isinstance(trace_policy.get("hash"), str):
            trace_policy_hash = trace_policy["hash"]

    return {
        "overall_pass": overall_pass,
        "suggested_labels": suggested_labels,
        "policy_drift": policy_drift,
        "trace": {
            "sample_guard_pass": trace_pass,
            "clean_cases": int(trace_clean_stats.get("output_cases", 0)),
            "clean_runs": int(trace_clean_stats.get("output_runs", 0)),
            "split_counts": {
                "holdout": int(trace_split_counts.get("holdout", 0)),
                "optimization": int(trace_split_counts.get("optimization", 0)),
            },
            "policy_hash": trace_policy_hash,
        },
        "skill_router": {
            "gate_pass": skill_gate_pass,
            "trend_required": trend_required,
            "trend_pass": skill_trend_pass,
            "trend_mode": trend_mode,
            "trend_reason": trend_reason,
            "trend_decision_tag": trend_decision_tag,
            "trend_decision_severity": trend_decision_severity,
            "trend_action_hint": trend_action_hint,
            "trend_owner": trend_owner,
            "suggested_labels": suggested_labels,
            "baseline_available": trend_meta.get("baseline_available"),
            "policy_blob_match": trend_meta.get("policy_blob_match"),
            "policy_hash_current": trend_meta.get("policy_hash_current"),
            "policy_hash_base": trend_meta.get("policy_hash_base"),
            "policy_hash_match": trend_meta.get("policy_hash_match"),
            "accuracy": float(skill_summary.get("accuracy", 0.0)),
            "forbidden_violations": int(skill_summary.get("forbidden_violations", 0)),
            "total_cases": int(skill_summary.get("total_cases", 0)),
            "policy_hash": skill_router_report.get("policy", {}).get("hash")
            if isinstance(skill_router_report.get("policy"), dict)
            else None,
        },
    }


def render_harness_ci_summary_markdown(summary: dict[str, Any]) -> str:
    trace = summary["trace"] if isinstance(summary.get("trace"), dict) else {}
    skill = summary["skill_router"] if isinstance(summary.get("skill_router"), dict) else {}
    policy_drift = summary["policy_drift"] if isinstance(summary.get("policy_drift"), dict) else {}
    overall_pass = bool(summary.get("overall_pass", False))
    suggested_labels_raw = summary.get("suggested_labels")
    suggested_labels: list[str] = []
    if isinstance(suggested_labels_raw, list):
        for item in suggested_labels_raw:
            if isinstance(item, str) and item.strip():
                suggested_labels.append(item.strip())
    elif isinstance(skill.get("suggested_labels"), list):
        for item in skill.get("suggested_labels"):
            if isinstance(item, str) and item.strip():
                suggested_labels.append(item.strip())
    suggested_labels_text = ", ".join(suggested_labels) if suggested_labels else "n/a"

    trace_split = trace.get("split_counts") if isinstance(trace.get("split_counts"), dict) else {}
    trend_pass_value = skill.get("trend_pass")
    trend_required = bool(skill.get("trend_required", False))
    trend_pass_text = "n/a"
    if isinstance(trend_pass_value, bool):
        trend_pass_text = "pass" if trend_pass_value else "fail"
    trend_mode_raw = skill.get("trend_mode")
    trend_mode = trend_mode_raw.strip() if isinstance(trend_mode_raw, str) and trend_mode_raw.strip() else "n/a"
    trend_reason_raw = skill.get("trend_reason")
    trend_reason = (
        trend_reason_raw.strip() if isinstance(trend_reason_raw, str) and trend_reason_raw.strip() else "n/a"
    )
    trend_decision_tag_raw = skill.get("trend_decision_tag")
    trend_decision_tag = (
        trend_decision_tag_raw.strip()
        if isinstance(trend_decision_tag_raw, str) and trend_decision_tag_raw.strip()
        else "n/a"
    )
    trend_decision_severity_raw = skill.get("trend_decision_severity")
    trend_decision_severity = (
        trend_decision_severity_raw.strip()
        if isinstance(trend_decision_severity_raw, str) and trend_decision_severity_raw.strip()
        else "n/a"
    )
    trend_action_hint_raw = skill.get("trend_action_hint")
    trend_action_hint = (
        trend_action_hint_raw.strip()
        if isinstance(trend_action_hint_raw, str) and trend_action_hint_raw.strip()
        else "n/a"
    )
    trend_owner_raw = skill.get("trend_owner")
    trend_owner = trend_owner_raw.strip() if isinstance(trend_owner_raw, str) and trend_owner_raw.strip() else "n/a"
    baseline_available_value = skill.get("baseline_available")
    baseline_available_text = "n/a"
    if isinstance(baseline_available_value, bool):
        baseline_available_text = "yes" if baseline_available_value else "no"
    policy_blob_match_value = skill.get("policy_blob_match")
    policy_blob_match_text = "n/a"
    if isinstance(policy_blob_match_value, bool):
        policy_blob_match_text = "yes" if policy_blob_match_value else "no"
    policy_hash_current = (
        skill.get("policy_hash_current").strip()
        if isinstance(skill.get("policy_hash_current"), str) and skill.get("policy_hash_current").strip()
        else "n/a"
    )
    policy_hash_base = (
        skill.get("policy_hash_base").strip()
        if isinstance(skill.get("policy_hash_base"), str) and skill.get("policy_hash_base").strip()
        else "n/a"
    )
    policy_hash_match_value = skill.get("policy_hash_match")
    policy_hash_match_text = "n/a"
    if isinstance(policy_hash_match_value, bool):
        policy_hash_match_text = "yes" if policy_hash_match_value else "no"
    policy_drift_severity = (
        policy_drift.get("severity").strip()
        if isinstance(policy_drift.get("severity"), str) and policy_drift.get("severity").strip()
        else "none"
    )
    policy_drift_reason = (
        policy_drift.get("reason").strip()
        if isinstance(policy_drift.get("reason"), str) and policy_drift.get("reason").strip()
        else "shape_ok"
    )
    policy_drift_previous_severity = (
        policy_drift.get("previous_severity").strip()
        if isinstance(policy_drift.get("previous_severity"), str) and policy_drift.get("previous_severity").strip()
        else "none"
    )
    policy_drift_worsening_streak = (
        int(policy_drift.get("worsening_streak"))
        if isinstance(policy_drift.get("worsening_streak"), int)
        else 0
    )
    if policy_drift_worsening_streak < 0:
        policy_drift_worsening_streak = 0
    policy_drift_worsening_alert = bool(policy_drift.get("worsening_alert", False))
    policy_drift_worsening_alert_threshold = (
        int(policy_drift.get("worsening_alert_threshold"))
        if isinstance(policy_drift.get("worsening_alert_threshold"), int)
        else 2
    )
    if policy_drift_worsening_alert_threshold < 1:
        policy_drift_worsening_alert_threshold = 2
    policy_drift_worsening_label = (
        policy_drift.get("worsening_label").strip()
        if isinstance(policy_drift.get("worsening_label"), str) and policy_drift.get("worsening_label").strip()
        else "ci/policy-drift-worsening"
    )
    policy_drift_transition = f"{policy_drift_previous_severity}->{policy_drift_severity}"
    default_transition_state, default_policy_drift_delta = _compute_policy_drift_transition_state(
        previous_severity=policy_drift_previous_severity,
        severity=policy_drift_severity,
    )
    policy_drift_transition_state = (
        policy_drift.get("transition_state").strip()
        if isinstance(policy_drift.get("transition_state"), str) and policy_drift.get("transition_state").strip()
        else default_transition_state
    )
    policy_drift_severity_delta = (
        int(policy_drift.get("severity_delta"))
        if isinstance(policy_drift.get("severity_delta"), int)
        else default_policy_drift_delta
    )
    default_policy_drift_owner = _compute_policy_drift_owner(severity=policy_drift_severity)
    policy_drift_owner = (
        policy_drift.get("owner").strip()
        if isinstance(policy_drift.get("owner"), str) and policy_drift.get("owner").strip()
        else default_policy_drift_owner
    )
    default_policy_drift_action_hint = _compute_policy_drift_action_hint(
        severity=policy_drift_severity,
        reason=policy_drift_reason,
        transition_state=policy_drift_transition_state,
    )
    policy_drift_action_hint = (
        policy_drift.get("action_hint").strip()
        if isinstance(policy_drift.get("action_hint"), str) and policy_drift.get("action_hint").strip()
        else default_policy_drift_action_hint
    )

    lines = [
        "## Harness Gate Summary",
        "",
    ]
    if policy_drift_worsening_alert:
        lines.extend(
            [
                (
                    f"> [!WARNING] policy_drift worsening alert: streak={policy_drift_worsening_streak}; "
                    f"transition={policy_drift_transition}"
                ),
                "",
            ]
        )

    lines.extend(
        [
        f"- overall: {'pass' if overall_pass else 'fail'}",
        f"- suggested-labels: {suggested_labels_text}",
        f"- policy-drift: {policy_drift_severity}:{policy_drift_reason}",
        (
            "- policy-drift-trend: "
            f"transition={policy_drift_transition}; state={policy_drift_transition_state}; "
            f"delta={policy_drift_severity_delta}; streak={policy_drift_worsening_streak}; "
            f"alert={'yes' if policy_drift_worsening_alert else 'no'}; "
            f"threshold={policy_drift_worsening_alert_threshold}; "
            f"worsening_label={policy_drift_worsening_label}"
        ),
        f"- policy-drift-owner: {policy_drift_owner}",
        f"- policy-drift-action: {policy_drift_action_hint}",
        f"- skill-router-trend-tag: {trend_decision_tag}",
        f"- skill-router-trend-severity: {trend_decision_severity}",
        f"- skill-router-trend-owner: {trend_owner}",
        (
            "- skill-router-trend: "
            f"mode={trend_mode}; required={'yes' if trend_required else 'no'}; "
            f"pass={trend_pass_text}; reason={trend_reason}"
        ),
        f"- skill-router-trend-action: {trend_action_hint}",
        "",
        "| Domain | Key | Value |",
        "| --- | --- | --- |",
        f"| meta | suggested_labels | {suggested_labels_text} |",
        f"| policy_drift | severity | {policy_drift_severity} |",
        f"| policy_drift | reason | {policy_drift_reason} |",
        f"| policy_drift | transition | {policy_drift_transition} |",
        f"| policy_drift | transition_state | {policy_drift_transition_state} |",
        f"| policy_drift | severity_delta | {policy_drift_severity_delta} |",
        f"| policy_drift | worsening_streak | {policy_drift_worsening_streak} |",
        f"| policy_drift | worsening_alert | {'yes' if policy_drift_worsening_alert else 'no'} |",
        f"| policy_drift | worsening_alert_threshold | {policy_drift_worsening_alert_threshold} |",
        f"| policy_drift | worsening_label | {policy_drift_worsening_label} |",
        f"| policy_drift | owner | {policy_drift_owner} |",
        f"| policy_drift | action_hint | {policy_drift_action_hint} |",
        f"| trace | sample_guard_pass | {'pass' if bool(trace.get('sample_guard_pass', False)) else 'fail'} |",
        f"| trace | clean_cases | {int(trace.get('clean_cases', 0))} |",
        f"| trace | clean_runs | {int(trace.get('clean_runs', 0))} |",
        f"| trace | holdout_cases | {int(trace_split.get('holdout', 0))} |",
        f"| trace | optimization_cases | {int(trace_split.get('optimization', 0))} |",
        f"| skill_router | gate_pass | {'pass' if bool(skill.get('gate_pass', False)) else 'fail'} |",
        f"| skill_router | trend_decision_tag | {trend_decision_tag} |",
        f"| skill_router | trend_decision_severity | {trend_decision_severity} |",
        f"| skill_router | trend_owner | {trend_owner} |",
        f"| skill_router | trend_action_hint | {trend_action_hint} |",
        f"| skill_router | trend_required | {'yes' if trend_required else 'no'} |",
        f"| skill_router | trend_pass | {trend_pass_text} |",
        f"| skill_router | trend_mode | {trend_mode} |",
        f"| skill_router | trend_reason | {trend_reason} |",
        f"| skill_router | baseline_available | {baseline_available_text} |",
        f"| skill_router | policy_blob_match | {policy_blob_match_text} |",
        f"| skill_router | policy_hash_match | {policy_hash_match_text} |",
        f"| skill_router | policy_hash_current | {policy_hash_current} |",
        f"| skill_router | policy_hash_base | {policy_hash_base} |",
        f"| skill_router | accuracy | {float(skill.get('accuracy', 0.0)):.4f} |",
        f"| skill_router | forbidden_violations | {int(skill.get('forbidden_violations', 0))} |",
        f"| skill_router | total_cases | {int(skill.get('total_cases', 0))} |",
        ]
    )
    return "\n".join(lines) + "\n"


def _extract_suggested_labels(summary: dict[str, Any]) -> list[str]:
    labels_raw = summary.get("suggested_labels")
    labels: list[str] = []
    if isinstance(labels_raw, list):
        for item in labels_raw:
            if isinstance(item, str) and item.strip():
                labels.append(item.strip())
    return labels


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build harness CI summary from trace + skill-router reports")
    parser.add_argument("--trace-report", type=Path, required=True, help="Trace pipeline report JSON path")
    parser.add_argument("--skill-router-report", type=Path, required=True, help="Skill-router report JSON path")
    parser.add_argument(
        "--policy-drift-report",
        type=Path,
        default=None,
        help="Policy drift report JSON path (optional)",
    )
    parser.add_argument("--output", type=Path, default=None, help="Write summary JSON to path")
    parser.add_argument("--markdown-output", type=Path, default=None, help="Write markdown summary to path")
    parser.add_argument("--labels-output", type=Path, default=None, help="Write suggested labels JSON array to path")
    parser.add_argument("--print-json", action="store_true", help="Print summary JSON to stdout")
    parser.add_argument("--print-markdown", action="store_true", help="Print markdown summary to stdout")
    parser.add_argument("--print-labels", action="store_true", help="Print suggested labels as CSV to stdout")
    parser.add_argument(
        "--emit-github-annotations",
        action="store_true",
        help="Emit GitHub Actions workflow annotations based on summary severity",
    )
    parser.add_argument(
        "--fail-on-overall-fail",
        action="store_true",
        help="Exit non-zero when overall summary state is fail",
    )
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    trace_report = _load_json(args.trace_report)
    skill_router_report = _load_json(args.skill_router_report)
    policy_drift_report: dict[str, Any] | None = None
    if isinstance(args.policy_drift_report, Path):
        policy_drift_report = _load_json(args.policy_drift_report)
    summary = build_harness_ci_summary(
        trace_report=trace_report,
        skill_router_report=skill_router_report,
        policy_drift_report=policy_drift_report,
    )
    markdown = render_harness_ci_summary_markdown(summary)
    suggested_labels = _extract_suggested_labels(summary)
    suggested_labels_csv = ",".join(suggested_labels)
    skill_summary = summary.get("skill_router") if isinstance(summary.get("skill_router"), dict) else {}
    trend_tag = str(skill_summary.get("trend_decision_tag", "TREND_NOT_REQUESTED"))
    trend_severity = str(skill_summary.get("trend_decision_severity", "info"))
    trend_action_hint = str(skill_summary.get("trend_action_hint", "n/a"))
    trend_owner = str(skill_summary.get("trend_owner", "unknown-owner"))
    policy_drift_summary = summary.get("policy_drift") if isinstance(summary.get("policy_drift"), dict) else {}
    policy_drift_severity = str(policy_drift_summary.get("severity", "none"))
    policy_drift_reason = str(policy_drift_summary.get("reason", "shape_ok"))
    policy_drift_worsening_streak = (
        int(policy_drift_summary.get("worsening_streak"))
        if isinstance(policy_drift_summary.get("worsening_streak"), int)
        else 0
    )
    if policy_drift_worsening_streak < 0:
        policy_drift_worsening_streak = 0
    policy_drift_worsening_alert = bool(policy_drift_summary.get("worsening_alert", False))
    policy_drift_worsening_alert_threshold = (
        int(policy_drift_summary.get("worsening_alert_threshold"))
        if isinstance(policy_drift_summary.get("worsening_alert_threshold"), int)
        else 2
    )
    if policy_drift_worsening_alert_threshold < 1:
        policy_drift_worsening_alert_threshold = 2
    policy_drift_worsening_label_raw = _normalize_optional_text(policy_drift_summary.get("worsening_label"))
    policy_drift_worsening_label = (
        policy_drift_worsening_label_raw
        if policy_drift_worsening_label_raw is not None
        else "ci/policy-drift-worsening"
    )
    policy_drift_previous_severity = _normalize_policy_drift_severity(policy_drift_summary.get("previous_severity"))
    default_policy_drift_transition = f"{policy_drift_previous_severity}->{policy_drift_severity}"
    default_policy_drift_transition_state, default_policy_drift_delta = _compute_policy_drift_transition_state(
        previous_severity=policy_drift_previous_severity,
        severity=policy_drift_severity,
    )
    policy_drift_transition = str(policy_drift_summary.get("transition", default_policy_drift_transition))
    policy_drift_transition_state = str(
        policy_drift_summary.get("transition_state", default_policy_drift_transition_state)
    )
    policy_drift_severity_delta = (
        int(policy_drift_summary.get("severity_delta"))
        if isinstance(policy_drift_summary.get("severity_delta"), int)
        else default_policy_drift_delta
    )
    default_policy_drift_owner = _compute_policy_drift_owner(severity=policy_drift_severity)
    policy_drift_owner = str(policy_drift_summary.get("owner", default_policy_drift_owner))
    default_policy_drift_action_hint = _compute_policy_drift_action_hint(
        severity=policy_drift_severity,
        reason=policy_drift_reason,
        transition_state=policy_drift_transition_state,
    )
    policy_drift_action_hint = str(policy_drift_summary.get("action_hint", default_policy_drift_action_hint))
    labels_raw = summary.get("suggested_labels")
    labels: list[str] = []
    if isinstance(labels_raw, list):
        for item in labels_raw:
            if isinstance(item, str) and item.strip():
                labels.append(item.strip())
    labels_text = ",".join(labels) if labels else "n/a"
    annotation_message = (
        "skill-router trend decision: "
        f"tag={trend_tag}; severity={trend_severity}; owner={trend_owner}; action={trend_action_hint}; "
        f"policy_drift={policy_drift_severity}:{policy_drift_reason}; "
        f"policy_drift_transition={policy_drift_transition}; "
        f"policy_drift_transition_state={policy_drift_transition_state}; "
        f"policy_drift_delta={policy_drift_severity_delta}; "
        f"policy_drift_owner={policy_drift_owner}; "
        f"policy_drift_action={policy_drift_action_hint}; "
        f"policy_drift_worsening_streak={policy_drift_worsening_streak}; "
        f"policy_drift_worsening_threshold={policy_drift_worsening_alert_threshold}; "
        f"policy_drift_worsening_label={policy_drift_worsening_label}; "
        f"policy_drift_worsening_alert={'yes' if policy_drift_worsening_alert else 'no'}; "
        f"labels={labels_text}"
    )

    if args.print_json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.print_markdown:
        print(markdown)
    if args.print_labels:
        print(suggested_labels_csv)
    if not args.print_json and not args.print_markdown and not args.print_labels:
        print(f"overall={'pass' if bool(summary.get('overall_pass', False)) else 'fail'}")

    if isinstance(args.output, Path):
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    if isinstance(args.markdown_output, Path):
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(markdown, encoding="utf-8")
    if isinstance(args.labels_output, Path):
        args.labels_output.parent.mkdir(parents=True, exist_ok=True)
        with args.labels_output.open("w", encoding="utf-8") as handle:
            json.dump(suggested_labels, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    if args.emit_github_annotations:
        if not bool(summary.get("overall_pass", False)):
            print(f"::error title=Harness Gate Overall Fail::{annotation_message}")
        elif policy_drift_worsening_alert and policy_drift_severity == "high":
            print(f"::error title=Policy Drift Worsening::{annotation_message}")
        elif policy_drift_worsening_alert:
            print(f"::warning title=Policy Drift Worsening::{annotation_message}")
        elif trend_severity == "error":
            print(f"::error title=Skill Router Trend::{annotation_message}")
        elif trend_severity == "warn":
            print(f"::warning title=Skill Router Trend::{annotation_message}")
        else:
            print(f"::notice title=Skill Router Trend::{annotation_message}")

    if args.fail_on_overall_fail and not bool(summary.get("overall_pass", False)):
        raise SystemExit(4)


if __name__ == "__main__":
    main()
