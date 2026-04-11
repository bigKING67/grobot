#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ZERO_SHA = "0000000000000000000000000000000000000000"


def _normalize_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized or normalized == ZERO_SHA:
        return None
    return normalized


def _normalize_optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    return None


def _load_report(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict):
        return payload
    return {}


def _extract_policy_hash(report: dict[str, Any]) -> str | None:
    policy = report.get("policy")
    if isinstance(policy, dict):
        hash_value = _normalize_optional_text(policy.get("hash"))
        if hash_value is not None:
            return hash_value
    return _normalize_optional_text(report.get("policy_hash"))


def build_skill_router_trend_meta(
    *,
    current_report: dict[str, Any],
    base_report: dict[str, Any],
    trend_mode: str,
    trend_reason: str,
    trend_required: Any,
    baseline_available: Any,
    base_sha: Any,
    current_policy_blob: Any,
    base_policy_blob: Any,
    policy_blob_match: Any,
) -> dict[str, Any]:
    current_policy_hash = _extract_policy_hash(current_report)
    base_policy_hash = _extract_policy_hash(base_report)

    policy_hash_match: bool | None = None
    if current_policy_hash is not None and base_policy_hash is not None:
        policy_hash_match = current_policy_hash == base_policy_hash

    normalized_trend_mode = _normalize_optional_text(trend_mode) or "gate_only"
    normalized_trend_reason = _normalize_optional_text(trend_reason) or "unknown"

    return {
        "mode": normalized_trend_mode,
        "reason": normalized_trend_reason,
        "required": _normalize_optional_bool(trend_required) is True,
        "executed": normalized_trend_mode == "gate_and_trend",
        "baseline_available": _normalize_optional_bool(baseline_available),
        "base_sha": _normalize_optional_text(base_sha),
        "policy_blob_current": _normalize_optional_text(current_policy_blob),
        "policy_blob_base": _normalize_optional_text(base_policy_blob),
        "policy_blob_match": _normalize_optional_bool(policy_blob_match),
        "policy_hash_current": current_policy_hash,
        "policy_hash_base": base_policy_hash,
        "policy_hash_match": policy_hash_match,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Attach skill-router trend metadata onto CI report JSON."
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("gateway/evals/data/skill_router_ci_report.json"),
        help="path to current skill-router report JSON",
    )
    parser.add_argument(
        "--base-report",
        type=Path,
        default=Path("gateway/evals/data/skill_router_ci_report.base.json"),
        help="path to baseline skill-router report JSON",
    )
    parser.add_argument("--trend-mode", default="gate_only", help="trend mode")
    parser.add_argument("--trend-reason", default="unknown", help="trend reason")
    parser.add_argument("--trend-required", default="false", help="whether trend check was required")
    parser.add_argument("--baseline-available", default="false", help="whether baseline report exists")
    parser.add_argument("--base-sha", default="", help="baseline commit SHA")
    parser.add_argument("--current-policy-blob", default="", help="current policy blob SHA")
    parser.add_argument("--base-policy-blob", default="", help="baseline policy blob SHA")
    parser.add_argument("--policy-blob-match", default="unknown", help="whether policy blob matched")
    parser.add_argument("--print-json", action="store_true", help="print trend metadata JSON payload")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    payload = _load_report(args.report)
    base_payload = _load_report(args.base_report)

    trend_meta = build_skill_router_trend_meta(
        current_report=payload,
        base_report=base_payload,
        trend_mode=args.trend_mode,
        trend_reason=args.trend_reason,
        trend_required=args.trend_required,
        baseline_available=args.baseline_available,
        base_sha=args.base_sha,
        current_policy_blob=args.current_policy_blob,
        base_policy_blob=args.base_policy_blob,
        policy_blob_match=args.policy_blob_match,
    )
    payload["trend_meta"] = trend_meta

    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    if args.print_json:
        print(json.dumps({"skill_router_trend_meta": trend_meta}, ensure_ascii=False))


if __name__ == "__main__":
    main()
