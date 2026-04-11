#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


def _normalize_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _load_summary(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {}
    return payload


def _extract_labels(payload: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    labels_raw = payload.get("suggested_labels")
    if isinstance(labels_raw, list):
        for item in labels_raw:
            normalized = _normalize_optional_text(item)
            if normalized is not None:
                labels.append(normalized)
    return labels


def build_harness_gate_outputs(payload: dict[str, Any]) -> dict[str, Any]:
    labels = _extract_labels(payload)
    overall_pass_raw = payload.get("overall_pass")
    if isinstance(overall_pass_raw, bool):
        overall_state = "pass" if overall_pass_raw else "fail"
    else:
        overall_state = "unknown"

    skill_router = payload.get("skill_router") if isinstance(payload.get("skill_router"), dict) else {}
    policy_drift = payload.get("policy_drift") if isinstance(payload.get("policy_drift"), dict) else {}

    trend_owner = _normalize_optional_text(skill_router.get("trend_owner")) or "unknown-owner"
    trend_decision_tag = _normalize_optional_text(skill_router.get("trend_decision_tag")) or "TREND_UNKNOWN_MODE"
    trend_decision_severity = _normalize_optional_text(skill_router.get("trend_decision_severity")) or "warn"
    trend_action_hint = _normalize_optional_text(skill_router.get("trend_action_hint")) or "n/a"

    policy_drift_severity = _normalize_optional_text(policy_drift.get("severity")) or "none"
    policy_drift_reason = _normalize_optional_text(policy_drift.get("reason")) or "shape_ok"
    policy_drift_state = f"{policy_drift_severity}:{policy_drift_reason}"
    policy_drift_transition = (
        _normalize_optional_text(policy_drift.get("transition")) or f"none->{policy_drift_severity}"
    )
    policy_drift_transition_state = (
        _normalize_optional_text(policy_drift.get("transition_state")) or "stable_none"
    )
    policy_drift_severity_delta_raw = policy_drift.get("severity_delta")
    if isinstance(policy_drift_severity_delta_raw, int):
        policy_drift_severity_delta = str(policy_drift_severity_delta_raw)
    else:
        policy_drift_severity_delta = "0"
    policy_drift_owner = _normalize_optional_text(policy_drift.get("owner")) or "release-owner"
    policy_drift_action_hint = _normalize_optional_text(policy_drift.get("action_hint")) or "n/a"

    policy_drift_worsening_streak_raw = policy_drift.get("worsening_streak")
    if isinstance(policy_drift_worsening_streak_raw, int):
        policy_drift_worsening_streak = str(max(0, policy_drift_worsening_streak_raw))
    else:
        policy_drift_worsening_streak = "0"
    policy_drift_worsening_alert = "true" if policy_drift.get("worsening_alert") is True else "false"
    policy_drift_worsening_label = (
        _normalize_optional_text(policy_drift.get("worsening_label")) or "ci/policy-drift-worsening"
    )

    labels_csv = ",".join(labels)

    return {
        "overall_state": overall_state,
        "trend_owner": trend_owner,
        "trend_decision_tag": trend_decision_tag,
        "trend_decision_severity": trend_decision_severity,
        "trend_action_hint": trend_action_hint,
        "policy_drift_state": policy_drift_state,
        "policy_drift_severity": policy_drift_severity,
        "policy_drift_reason": policy_drift_reason,
        "policy_drift_transition": policy_drift_transition,
        "policy_drift_transition_state": policy_drift_transition_state,
        "policy_drift_severity_delta": policy_drift_severity_delta,
        "policy_drift_owner": policy_drift_owner,
        "policy_drift_action_hint": policy_drift_action_hint,
        "policy_drift_worsening_streak": policy_drift_worsening_streak,
        "policy_drift_worsening_alert": policy_drift_worsening_alert,
        "policy_drift_worsening_label": policy_drift_worsening_label,
        "suggested_labels_csv": labels_csv,
        "suggested_labels_json": labels,
    }


def _write_github_outputs(*, github_output_path: Path, outputs: dict[str, Any]) -> None:
    labels_json_text = json.dumps(outputs["suggested_labels_json"], ensure_ascii=False)
    with github_output_path.open("a", encoding="utf-8") as handle:
        for key, value in outputs.items():
            if key == "suggested_labels_json":
                continue
            handle.write(f"{key}={value}\n")
        handle.write("suggested_labels_json<<EOF\n")
        handle.write(labels_json_text + "\n")
        handle.write("EOF\n")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export harness gate outputs from harness_ci_summary.json")
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("gateway/evals/data/harness_ci_summary.json"),
        help="harness summary JSON path",
    )
    parser.add_argument(
        "--github-output",
        type=Path,
        default=None,
        help="GitHub Actions output file path (default: $GITHUB_OUTPUT when present)",
    )
    parser.add_argument("--print-json", action="store_true", help="print exported outputs as JSON")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    payload = _load_summary(args.summary)
    outputs = build_harness_gate_outputs(payload)

    github_output_path: Path | None = args.github_output
    if github_output_path is None:
        env_output_path = _normalize_optional_text(os.environ.get("GITHUB_OUTPUT"))
        if env_output_path is not None:
            github_output_path = Path(env_output_path)
    if isinstance(github_output_path, Path):
        github_output_path.parent.mkdir(parents=True, exist_ok=True)
        _write_github_outputs(github_output_path=github_output_path, outputs=outputs)

    print(json.dumps(outputs, ensure_ascii=False))


if __name__ == "__main__":
    main()
