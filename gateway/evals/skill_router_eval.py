#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import grobot_cli  # type: ignore[import-not-found]
else:
    import grobot_cli


@dataclass(frozen=True)
class SkillRouterEvalCase:
    id: str
    prompt: str
    expected_skill: str | None
    forbidden_skills: tuple[str, ...]


SKILL_ROUTER_POLICY_SCHEMA = "skill_router_eval_policy"
SKILL_ROUTER_POLICY_VERSION = 1
SKILL_ROUTER_POLICY_ALLOWED_FIELDS: tuple[str, ...] = (
    "schema",
    "schema_version",
    "profile",
    "cases",
    "global_skills_dir",
    "project_skills_dir",
    "project_toml",
    "router_overrides",
    "gates",
)
SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS: tuple[str, ...] = (
    "score_threshold",
    "min_score_gap",
    "max_descriptors",
    "descriptor_scan_lines",
)
SKILL_ROUTER_POLICY_GATES_FIELDS: tuple[str, ...] = (
    "min_accuracy",
    "max_forbidden_violations",
    "max_accuracy_drop",
    "max_forbidden_increase",
)


@dataclass(frozen=True)
class SkillRouterEvalPolicy:
    source: Path
    schema: str
    schema_version: int
    profile: str
    cases: Path
    global_skills_dir: Path
    project_skills_dir: Path
    project_toml: Path | None
    score_threshold: float | None
    min_score_gap: float | None
    max_descriptors: int | None
    descriptor_scan_lines: int | None
    min_accuracy: float | None
    max_forbidden_violations: int | None
    max_accuracy_drop: float | None
    max_forbidden_increase: int | None

    def to_dict(self) -> dict[str, Any]:
        router_overrides: dict[str, Any] = {}
        if self.score_threshold is not None:
            router_overrides["score_threshold"] = self.score_threshold
        if self.min_score_gap is not None:
            router_overrides["min_score_gap"] = self.min_score_gap
        if self.max_descriptors is not None:
            router_overrides["max_descriptors"] = self.max_descriptors
        if self.descriptor_scan_lines is not None:
            router_overrides["descriptor_scan_lines"] = self.descriptor_scan_lines
        gates: dict[str, Any] = {}
        if self.min_accuracy is not None:
            gates["min_accuracy"] = self.min_accuracy
        if self.max_forbidden_violations is not None:
            gates["max_forbidden_violations"] = self.max_forbidden_violations
        if self.max_accuracy_drop is not None:
            gates["max_accuracy_drop"] = self.max_accuracy_drop
        if self.max_forbidden_increase is not None:
            gates["max_forbidden_increase"] = self.max_forbidden_increase
        return {
            "schema": self.schema,
            "schema_version": self.schema_version,
            "profile": self.profile,
            "cases": str(self.cases),
            "global_skills_dir": str(self.global_skills_dir),
            "project_skills_dir": str(self.project_skills_dir),
            "project_toml": str(self.project_toml) if self.project_toml is not None else None,
            "router_overrides": router_overrides,
            "gates": gates,
        }

def _normalize_string_list(raw_value: Any) -> tuple[str, ...]:
    if not isinstance(raw_value, list):
        return ()
    cleaned: list[str] = []
    for item in raw_value:
        if not isinstance(item, str):
            continue
        stripped = item.strip()
        if stripped:
            cleaned.append(stripped)
    return tuple(cleaned)


def _resolve_policy_path(base_dir: Path, raw_value: Any, field_name: str) -> Path:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise ValueError(f"policy field {field_name} must be non-empty string")
    candidate = Path(raw_value.strip()).expanduser()
    if not candidate.is_absolute():
        candidate = (base_dir / candidate).resolve()
    return candidate.resolve()


def _parse_router_override_float(raw_value: Any, field_name: str) -> float | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
        raise ValueError(f"policy router_overrides.{field_name} must be number")
    value = float(raw_value)
    if value < 0.0:
        raise ValueError(f"policy router_overrides.{field_name} must be >= 0")
    return value


def _parse_router_override_int(raw_value: Any, field_name: str) -> int | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool) or not isinstance(raw_value, int):
        raise ValueError(f"policy router_overrides.{field_name} must be int")
    if raw_value <= 0:
        raise ValueError(f"policy router_overrides.{field_name} must be > 0")
    return raw_value


def _parse_gate_accuracy(raw_value: Any) -> float | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
        raise ValueError("policy gates.min_accuracy must be number")
    value = float(raw_value)
    if value < 0.0 or value > 1.0:
        raise ValueError("policy gates.min_accuracy must be within [0, 1]")
    return value


def _parse_gate_max_forbidden(raw_value: Any) -> int | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool) or not isinstance(raw_value, int):
        raise ValueError("policy gates.max_forbidden_violations must be int")
    if raw_value < 0:
        raise ValueError("policy gates.max_forbidden_violations must be >= 0")
    return raw_value


def _parse_gate_max_accuracy_drop(raw_value: Any) -> float | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
        raise ValueError("policy gates.max_accuracy_drop must be number")
    value = float(raw_value)
    if value < 0.0 or value > 1.0:
        raise ValueError("policy gates.max_accuracy_drop must be within [0, 1]")
    return value


def _parse_gate_max_forbidden_increase(raw_value: Any) -> int | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, bool) or not isinstance(raw_value, int):
        raise ValueError("policy gates.max_forbidden_increase must be int")
    if raw_value < 0:
        raise ValueError("policy gates.max_forbidden_increase must be >= 0")
    return raw_value


def load_skill_router_eval_policy(path: Path) -> SkillRouterEvalPolicy:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("policy must be a JSON object")
    unknown_fields = sorted(set(payload.keys()) - set(SKILL_ROUTER_POLICY_ALLOWED_FIELDS))
    if unknown_fields:
        raise ValueError(f"policy contains unknown fields: {', '.join(unknown_fields)}")

    schema = payload.get("schema")
    if schema != SKILL_ROUTER_POLICY_SCHEMA:
        raise ValueError(f"policy schema must be {SKILL_ROUTER_POLICY_SCHEMA}")
    schema_version = payload.get("schema_version")
    if isinstance(schema_version, bool) or not isinstance(schema_version, int):
        raise ValueError("policy schema_version must be int")
    if schema_version != SKILL_ROUTER_POLICY_VERSION:
        raise ValueError(
            f"unsupported policy schema_version: {schema_version} (supported={SKILL_ROUTER_POLICY_VERSION})"
        )
    profile_raw = payload.get("profile")
    if not isinstance(profile_raw, str) or not profile_raw.strip():
        raise ValueError("policy profile must be non-empty string")
    profile = profile_raw.strip()

    base_dir = path.parent.resolve()
    cases = _resolve_policy_path(base_dir, payload.get("cases"), "cases")
    global_skills_dir = _resolve_policy_path(base_dir, payload.get("global_skills_dir"), "global_skills_dir")
    project_skills_dir = _resolve_policy_path(base_dir, payload.get("project_skills_dir"), "project_skills_dir")
    project_toml_raw = payload.get("project_toml")
    project_toml: Path | None = None
    if project_toml_raw is not None:
        project_toml = _resolve_policy_path(base_dir, project_toml_raw, "project_toml")

    router_overrides_raw = payload.get("router_overrides")
    router_overrides = router_overrides_raw if isinstance(router_overrides_raw, dict) else {}
    unknown_router_fields = sorted(set(router_overrides.keys()) - set(SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS))
    if unknown_router_fields:
        raise ValueError(
            "policy router_overrides contains unknown fields: " + ", ".join(unknown_router_fields)
        )
    score_threshold = _parse_router_override_float(router_overrides.get("score_threshold"), "score_threshold")
    min_score_gap = _parse_router_override_float(router_overrides.get("min_score_gap"), "min_score_gap")
    max_descriptors = _parse_router_override_int(router_overrides.get("max_descriptors"), "max_descriptors")
    descriptor_scan_lines = _parse_router_override_int(
        router_overrides.get("descriptor_scan_lines"),
        "descriptor_scan_lines",
    )

    gates_raw = payload.get("gates")
    gates = gates_raw if isinstance(gates_raw, dict) else {}
    unknown_gate_fields = sorted(set(gates.keys()) - set(SKILL_ROUTER_POLICY_GATES_FIELDS))
    if unknown_gate_fields:
        raise ValueError("policy gates contains unknown fields: " + ", ".join(unknown_gate_fields))
    min_accuracy = _parse_gate_accuracy(gates.get("min_accuracy"))
    max_forbidden_violations = _parse_gate_max_forbidden(gates.get("max_forbidden_violations"))
    max_accuracy_drop = _parse_gate_max_accuracy_drop(gates.get("max_accuracy_drop"))
    max_forbidden_increase = _parse_gate_max_forbidden_increase(gates.get("max_forbidden_increase"))

    return SkillRouterEvalPolicy(
        source=path.resolve(),
        schema=schema,
        schema_version=schema_version,
        profile=profile,
        cases=cases,
        global_skills_dir=global_skills_dir,
        project_skills_dir=project_skills_dir,
        project_toml=project_toml,
        score_threshold=score_threshold,
        min_score_gap=min_score_gap,
        max_descriptors=max_descriptors,
        descriptor_scan_lines=descriptor_scan_lines,
        min_accuracy=min_accuracy,
        max_forbidden_violations=max_forbidden_violations,
        max_accuracy_drop=max_accuracy_drop,
        max_forbidden_increase=max_forbidden_increase,
    )


def compute_skill_router_policy_fingerprint(path: Path) -> tuple[str, dict[str, Any]]:
    policy = load_skill_router_eval_policy(path)
    canonical = policy.to_dict()
    canonical_json = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest(), canonical


def load_skill_router_cases(path: Path) -> list[SkillRouterEvalCase]:
    cases: list[SkillRouterEvalCase] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSON at line {line_no}: {exc}") from exc
            if not isinstance(payload, dict):
                raise ValueError(f"line {line_no}: expected object")
            case_id = payload.get("id")
            prompt = payload.get("prompt")
            if not isinstance(case_id, str) or not case_id.strip():
                raise ValueError(f"line {line_no}: missing id")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError(f"line {line_no}: missing prompt")
            expected_skill = payload.get("expected_skill")
            if not isinstance(expected_skill, str):
                expected_skill = None
            elif not expected_skill.strip():
                expected_skill = None
            else:
                expected_skill = expected_skill.strip()
            forbidden_skills = _normalize_string_list(payload.get("forbidden_skills"))
            cases.append(
                SkillRouterEvalCase(
                    id=case_id.strip(),
                    prompt=prompt.strip(),
                    expected_skill=expected_skill,
                    forbidden_skills=forbidden_skills,
                )
            )
    return cases


def evaluate_skill_router_cases(
    *,
    cases: list[SkillRouterEvalCase],
    descriptors: tuple[grobot_cli.SkillDescriptor, ...],
    score_threshold: float,
    min_score_gap: float,
) -> dict[str, Any]:
    tp = 0
    tn = 0
    fp = 0
    fn = 0
    passed = 0
    forbidden_violations = 0
    case_results: list[dict[str, Any]] = []

    for case in cases:
        route = grobot_cli.route_skill_for_prompt(
            case.prompt,
            descriptors,
            score_threshold=score_threshold,
            min_score_gap=min_score_gap,
        )
        selected_skill = route.descriptor.name if route is not None else None
        expected_skill = case.expected_skill
        match = selected_skill == expected_skill
        violation = selected_skill in set(case.forbidden_skills) if selected_skill is not None else False
        if violation:
            forbidden_violations += 1
        case_passed = match and not violation
        if case_passed:
            passed += 1

        expected_positive = expected_skill is not None
        selected_positive = selected_skill is not None
        if expected_positive and selected_skill == expected_skill:
            tp += 1
        elif expected_positive:
            fn += 1
            if selected_positive:
                fp += 1
        elif selected_positive:
            fp += 1
        else:
            tn += 1

        case_results.append(
            {
                "id": case.id,
                "prompt": case.prompt,
                "expected_skill": expected_skill,
                "selected_skill": selected_skill,
                "passed": case_passed,
                "forbidden_violation": violation,
                "forbidden_skills": list(case.forbidden_skills),
                "score": round(route.score, 4) if route is not None else None,
                "reason": route.reason if route is not None else "no-route",
                "positive_hits": list(route.positive_hits) if route is not None else [],
                "negative_hits": list(route.negative_hits) if route is not None else [],
            }
        )

    total = len(cases)
    accuracy = (passed / total) if total > 0 else 0.0
    precision = (tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = (tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    summary = {
        "total_cases": total,
        "passed_cases": passed,
        "failed_cases": total - passed,
        "forbidden_violations": forbidden_violations,
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
    }
    return {
        "summary": summary,
        "cases": case_results,
    }


def evaluate_skill_router_gate(
    *,
    summary: dict[str, Any],
    min_accuracy: float | None,
    max_forbidden_violations: int | None,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    passed = True

    if min_accuracy is not None:
        actual = float(summary.get("accuracy", 0.0))
        check_passed = actual >= min_accuracy
        checks.append(
            {
                "name": "min_accuracy",
                "expected": min_accuracy,
                "actual": actual,
                "passed": check_passed,
            }
        )
        if not check_passed:
            passed = False

    if max_forbidden_violations is not None:
        actual_forbidden = int(summary.get("forbidden_violations", 0))
        check_passed = actual_forbidden <= max_forbidden_violations
        checks.append(
            {
                "name": "max_forbidden_violations",
                "expected": max_forbidden_violations,
                "actual": actual_forbidden,
                "passed": check_passed,
            }
        )
        if not check_passed:
            passed = False

    return {
        "passed": passed,
        "checks": checks,
    }


def evaluate_skill_router_trend(
    *,
    current_summary: dict[str, Any],
    baseline_summary: dict[str, Any],
    max_accuracy_drop: float | None,
    max_forbidden_increase: int | None,
) -> dict[str, Any]:
    current_accuracy = float(current_summary.get("accuracy", 0.0))
    baseline_accuracy = float(baseline_summary.get("accuracy", 0.0))
    current_forbidden = int(current_summary.get("forbidden_violations", 0))
    baseline_forbidden = int(baseline_summary.get("forbidden_violations", 0))
    accuracy_drop = baseline_accuracy - current_accuracy
    forbidden_increase = current_forbidden - baseline_forbidden

    checks: list[dict[str, Any]] = []
    passed = True
    if max_accuracy_drop is not None:
        accuracy_check = accuracy_drop <= max_accuracy_drop
        checks.append(
            {
                "name": "max_accuracy_drop",
                "expected": max_accuracy_drop,
                "actual": accuracy_drop,
                "passed": accuracy_check,
            }
        )
        if not accuracy_check:
            passed = False
    if max_forbidden_increase is not None:
        forbidden_check = forbidden_increase <= max_forbidden_increase
        checks.append(
            {
                "name": "max_forbidden_increase",
                "expected": max_forbidden_increase,
                "actual": forbidden_increase,
                "passed": forbidden_check,
            }
        )
        if not forbidden_check:
            passed = False

    return {
        "passed": passed,
        "checks": checks,
        "current": {
            "accuracy": current_accuracy,
            "forbidden_violations": current_forbidden,
        },
        "baseline": {
            "accuracy": baseline_accuracy,
            "forbidden_violations": baseline_forbidden,
        },
        "deltas": {
            "accuracy_drop": accuracy_drop,
            "forbidden_increase": forbidden_increase,
        },
    }


def _load_project_toml(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists() or not path.is_file():
        return {}
    return grobot_cli.load_toml(path)


def _load_report_summary(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("compare report must be JSON object")
    summary = payload.get("summary")
    if isinstance(summary, dict):
        return summary
    if "accuracy" in payload or "forbidden_violations" in payload:
        return payload
    raise ValueError("compare report must include summary or top-level accuracy/forbidden_violations")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate grobot skill router accuracy with JSONL cases")
    parser.add_argument("--policy", type=Path, default=None, help="Path to skill-router eval policy JSON")
    parser.add_argument("--cases", type=Path, default=None, help="Path to skill-router cases JSONL")
    parser.add_argument(
        "--global-skills-dir",
        type=Path,
        default=None,
        help="Global skills directory",
    )
    parser.add_argument(
        "--project-skills-dir",
        type=Path,
        default=None,
        help="Project skills directory",
    )
    parser.add_argument(
        "--project-toml",
        type=Path,
        default=None,
        help="Project TOML for router defaults",
    )
    parser.add_argument("--score-threshold", type=float, default=None, help="Override score threshold")
    parser.add_argument("--min-score-gap", type=float, default=None, help="Override min score gap")
    parser.add_argument("--max-descriptors", type=int, default=None, help="Override descriptor limit")
    parser.add_argument("--descriptor-scan-lines", type=int, default=None, help="Override descriptor scan lines")
    parser.add_argument(
        "--compare-report",
        type=Path,
        default=None,
        help="Compare against baseline report JSON (full report or summary payload)",
    )
    parser.add_argument(
        "--max-accuracy-drop",
        type=float,
        default=None,
        help="Allowed accuracy drop vs compare report baseline",
    )
    parser.add_argument(
        "--max-forbidden-increase",
        type=int,
        default=None,
        help="Allowed forbidden violation increase vs compare report baseline",
    )
    parser.add_argument("--output", type=Path, default=None, help="Write report JSON to path")
    parser.add_argument("--print-json", action="store_true", help="Print full JSON report")
    parser.add_argument(
        "--fail-on-forbidden",
        action="store_true",
        help="Exit non-zero when forbidden route violation exists",
    )
    parser.add_argument(
        "--min-accuracy",
        type=float,
        default=None,
        help="Exit non-zero when accuracy is below threshold",
    )
    parser.add_argument(
        "--max-forbidden-violations",
        type=int,
        default=None,
        help="Exit non-zero when forbidden violations exceed threshold",
    )
    parser.add_argument(
        "--fail-on-gate",
        action="store_true",
        help="Exit non-zero when policy/cli gate checks fail",
    )
    parser.add_argument(
        "--dry-validate-only",
        action="store_true",
        help="Validate policy and effective config only, then exit",
    )
    parser.add_argument(
        "--fail-on-trend",
        action="store_true",
        help="Exit non-zero when compare-report trend checks fail",
    )
    return parser


def _with_source(value: Any, source: str) -> dict[str, Any]:
    return {
        "value": value,
        "source": source,
    }


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    policy: SkillRouterEvalPolicy | None = None
    policy_hash: str | None = None
    policy_canonical: dict[str, Any] | None = None
    if isinstance(args.policy, Path):
        policy = load_skill_router_eval_policy(args.policy)
        policy_hash, policy_canonical = compute_skill_router_policy_fingerprint(args.policy)

    cases_path = args.cases if isinstance(args.cases, Path) else (policy.cases if policy is not None else None)
    if not isinstance(cases_path, Path):
        raise SystemExit("Either --cases or --policy must provide cases path")
    global_skills_dir = (
        args.global_skills_dir
        if isinstance(args.global_skills_dir, Path)
        else (policy.global_skills_dir if policy is not None else Path.home() / ".grobot" / "skills")
    )
    project_skills_dir = (
        args.project_skills_dir
        if isinstance(args.project_skills_dir, Path)
        else (policy.project_skills_dir if policy is not None else Path.cwd() / ".grobot" / "skills")
    )
    project_toml_path = (
        args.project_toml
        if isinstance(args.project_toml, Path)
        else (policy.project_toml if policy is not None else (Path.cwd() / ".grobot" / "project.toml"))
    )
    project_toml = _load_project_toml(project_toml_path)
    router_config = grobot_cli.resolve_skill_router_config(project_toml)

    max_descriptors = router_config.max_descriptors
    max_descriptors_source = "project_toml_default"
    if isinstance(args.max_descriptors, int) and args.max_descriptors > 0:
        max_descriptors = args.max_descriptors
        max_descriptors_source = "cli"
    elif policy is not None and isinstance(policy.max_descriptors, int):
        max_descriptors = policy.max_descriptors
        max_descriptors_source = "policy"
    descriptor_scan_lines = router_config.descriptor_scan_lines
    descriptor_scan_lines_source = "project_toml_default"
    if isinstance(args.descriptor_scan_lines, int) and args.descriptor_scan_lines > 0:
        descriptor_scan_lines = args.descriptor_scan_lines
        descriptor_scan_lines_source = "cli"
    elif policy is not None and isinstance(policy.descriptor_scan_lines, int):
        descriptor_scan_lines = policy.descriptor_scan_lines
        descriptor_scan_lines_source = "policy"
    score_threshold = router_config.score_threshold
    score_threshold_source = "project_toml_default"
    if isinstance(args.score_threshold, float):
        score_threshold = args.score_threshold
        score_threshold_source = "cli"
    elif policy is not None and isinstance(policy.score_threshold, float):
        score_threshold = policy.score_threshold
        score_threshold_source = "policy"
    min_score_gap = router_config.min_score_gap
    min_score_gap_source = "project_toml_default"
    if isinstance(args.min_score_gap, float):
        min_score_gap = args.min_score_gap
        min_score_gap_source = "cli"
    elif policy is not None and isinstance(policy.min_score_gap, float):
        min_score_gap = policy.min_score_gap
        min_score_gap_source = "policy"

    min_accuracy = args.min_accuracy
    min_accuracy_source = "unset"
    if min_accuracy is not None:
        min_accuracy_source = "cli"
    if min_accuracy is None and policy is not None:
        min_accuracy = policy.min_accuracy
        if min_accuracy is not None:
            min_accuracy_source = "policy"
    max_forbidden_violations = args.max_forbidden_violations
    max_forbidden_violations_source = "unset"
    if max_forbidden_violations is not None:
        max_forbidden_violations_source = "cli"
    if max_forbidden_violations is None and policy is not None:
        max_forbidden_violations = policy.max_forbidden_violations
        if max_forbidden_violations is not None:
            max_forbidden_violations_source = "policy"
    if args.fail_on_forbidden and max_forbidden_violations is None:
        max_forbidden_violations = 0
        max_forbidden_violations_source = "fail_on_forbidden_flag"
    max_accuracy_drop = args.max_accuracy_drop
    max_accuracy_drop_source = "unset"
    if max_accuracy_drop is not None:
        max_accuracy_drop_source = "cli"
    if max_accuracy_drop is None and policy is not None:
        max_accuracy_drop = policy.max_accuracy_drop
        if max_accuracy_drop is not None:
            max_accuracy_drop_source = "policy"
    max_forbidden_increase = args.max_forbidden_increase
    max_forbidden_increase_source = "unset"
    if max_forbidden_increase is not None:
        max_forbidden_increase_source = "cli"
    if max_forbidden_increase is None and policy is not None:
        max_forbidden_increase = policy.max_forbidden_increase
        if max_forbidden_increase is not None:
            max_forbidden_increase_source = "policy"
    if args.fail_on_trend:
        if max_accuracy_drop is None:
            max_accuracy_drop = 0.0
            max_accuracy_drop_source = "fail_on_trend_default"
        if max_forbidden_increase is None:
            max_forbidden_increase = 0
            max_forbidden_increase_source = "fail_on_trend_default"

    effective_sources = {
        "score_threshold": _with_source(score_threshold, score_threshold_source),
        "min_score_gap": _with_source(min_score_gap, min_score_gap_source),
        "max_descriptors": _with_source(max_descriptors, max_descriptors_source),
        "descriptor_scan_lines": _with_source(descriptor_scan_lines, descriptor_scan_lines_source),
        "min_accuracy": _with_source(min_accuracy, min_accuracy_source),
        "max_forbidden_violations": _with_source(
            max_forbidden_violations,
            max_forbidden_violations_source,
        ),
    }
    trend_config = {
        "compare_report": str(args.compare_report) if isinstance(args.compare_report, Path) else None,
        "max_accuracy_drop": max_accuracy_drop,
        "max_forbidden_increase": max_forbidden_increase,
    }
    trend_sources = {
        "max_accuracy_drop": _with_source(max_accuracy_drop, max_accuracy_drop_source),
        "max_forbidden_increase": _with_source(
            max_forbidden_increase,
            max_forbidden_increase_source,
        ),
    }

    if args.dry_validate_only:
        payload = {
            "status": "ok",
            "effective": {
                "cases": str(cases_path),
                "global_skills_dir": str(global_skills_dir),
                "project_skills_dir": str(project_skills_dir),
                "project_toml": str(project_toml_path) if isinstance(project_toml_path, Path) else None,
                "score_threshold": score_threshold,
                "min_score_gap": min_score_gap,
                "max_descriptors": max_descriptors,
                "descriptor_scan_lines": descriptor_scan_lines,
                "min_accuracy": min_accuracy,
                "max_forbidden_violations": max_forbidden_violations,
            },
            "effective_sources": effective_sources,
            "trend_config": trend_config,
            "trend_sources": trend_sources,
            "policy": {
                "path": str(policy.source) if policy is not None else None,
                "hash": policy_hash,
                "canonical": policy_canonical,
            },
        }
        if args.print_json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(
                "validated policy={} cases={} global_skills={} project_skills={}".format(
                    str(policy.source) if policy is not None else "none",
                    cases_path,
                    global_skills_dir,
                    project_skills_dir,
                )
            )
        return

    descriptors = grobot_cli.discover_skill_descriptors(
        global_skills_dir,
        project_skills_dir,
        max_descriptors=max_descriptors,
        descriptor_scan_lines=descriptor_scan_lines,
    )
    cases = load_skill_router_cases(cases_path)
    report = evaluate_skill_router_cases(
        cases=cases,
        descriptors=descriptors,
        score_threshold=score_threshold,
        min_score_gap=min_score_gap,
    )
    summary = report["summary"]
    gate = evaluate_skill_router_gate(
        summary=summary,
        min_accuracy=min_accuracy,
        max_forbidden_violations=max_forbidden_violations,
    )
    trend: dict[str, Any] | None = None
    if isinstance(args.compare_report, Path):
        baseline_summary = _load_report_summary(args.compare_report)
        trend = evaluate_skill_router_trend(
            current_summary=summary,
            baseline_summary=baseline_summary,
            max_accuracy_drop=max_accuracy_drop,
            max_forbidden_increase=max_forbidden_increase,
        )
    report["gate"] = gate
    report["effective"] = {
        "cases": str(cases_path),
        "global_skills_dir": str(global_skills_dir),
        "project_skills_dir": str(project_skills_dir),
        "project_toml": str(project_toml_path) if isinstance(project_toml_path, Path) else None,
        "score_threshold": score_threshold,
        "min_score_gap": min_score_gap,
        "max_descriptors": max_descriptors,
        "descriptor_scan_lines": descriptor_scan_lines,
        "min_accuracy": min_accuracy,
        "max_forbidden_violations": max_forbidden_violations,
    }
    report["effective_sources"] = effective_sources
    report["trend_config"] = trend_config
    report["trend_sources"] = trend_sources
    report["trend"] = trend
    report["policy"] = {
        "path": str(policy.source) if policy is not None else None,
        "hash": policy_hash,
        "canonical": policy_canonical,
    }
    trend_state = "n/a"
    if isinstance(trend, dict):
        trend_state = "pass" if bool(trend.get("passed", False)) else "fail"

    print(
        "cases={total} passed={passed} accuracy={accuracy:.3f} "
        "precision={precision:.3f} recall={recall:.3f} "
        "forbidden_violations={forbidden} gate={gate} trend={trend}".format(
            total=summary["total_cases"],
            passed=summary["passed_cases"],
            accuracy=summary["accuracy"],
            precision=summary["precision"],
            recall=summary["recall"],
            forbidden=summary["forbidden_violations"],
            gate="pass" if gate["passed"] else "fail",
            trend=trend_state,
        )
    )

    if args.print_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    if args.fail_on_forbidden and summary["forbidden_violations"] > 0:
        raise SystemExit(2)
    if isinstance(args.min_accuracy, float) and summary["accuracy"] < args.min_accuracy:
        raise SystemExit(3)
    if (
        isinstance(args.max_forbidden_violations, int)
        and summary["forbidden_violations"] > args.max_forbidden_violations
    ):
        raise SystemExit(5)
    if args.fail_on_trend:
        if trend is None:
            raise SystemExit("--fail-on-trend requires --compare-report")
        if not bool(trend.get("passed", False)):
            raise SystemExit(6)
    if args.fail_on_gate and not gate["passed"]:
        raise SystemExit(4)


if __name__ == "__main__":
    main()
