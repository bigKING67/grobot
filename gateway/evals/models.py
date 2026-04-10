#!/usr/bin/env python3
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MetricName = str
SplitName = str

METRIC_NAMES: tuple[MetricName, ...] = (
    "task_success",
    "tool_use_quality",
    "context_retention",
    "safety_compliance",
    "latency_cost",
)

DEFAULT_METRIC_WEIGHTS: dict[MetricName, float] = {
    "task_success": 0.35,
    "tool_use_quality": 0.2,
    "context_retention": 0.2,
    "safety_compliance": 0.2,
    "latency_cost": 0.05,
}


def clamp_score(value: float) -> float:
    return max(0.0, min(1.0, value))


def _as_string(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field} must not be empty")
    return normalized


def _as_optional_float(value: Any, field: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raise ValueError(f"{field} must be numeric when provided")


def _as_non_negative_int(value: Any, field: str, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    if value < 0:
        raise ValueError(f"{field} must be >= 0")
    return value


def _as_bool(value: Any, field: str, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    raise ValueError(f"{field} must be boolean")


def _as_string_list(value: Any, field: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list of strings")
    output: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str):
            raise ValueError(f"{field}[{index}] must be a string")
        normalized = item.strip()
        if normalized:
            output.append(normalized)
    return tuple(output)


def _parse_metric_weights(raw: Any) -> dict[MetricName, float]:
    weights = dict(DEFAULT_METRIC_WEIGHTS)
    if raw is None:
        return _normalize_weights(weights)
    if not isinstance(raw, dict):
        raise ValueError("weights must be an object")
    for key, raw_value in raw.items():
        if key not in METRIC_NAMES:
            continue
        if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
            raise ValueError(f"weights.{key} must be numeric")
        value = float(raw_value)
        if value < 0:
            raise ValueError(f"weights.{key} must be >= 0")
        weights[key] = value
    return _normalize_weights(weights)


def _normalize_weights(weights: dict[MetricName, float]) -> dict[MetricName, float]:
    total = sum(weights.values())
    if total <= 0:
        uniform = 1.0 / float(len(METRIC_NAMES))
        return {name: uniform for name in METRIC_NAMES}
    return {name: weights.get(name, 0.0) / total for name in METRIC_NAMES}


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            try:
                row = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{line_number}: each row must be a JSON object")
            rows.append(row)
    return rows


@dataclass(frozen=True)
class EvalExpectations:
    required_substrings: tuple[str, ...]
    forbidden_substrings: tuple[str, ...]
    required_tools: tuple[str, ...]
    forbidden_tools: tuple[str, ...]
    required_context_items: tuple[str, ...]
    latency_budget_ms: float | None
    cost_budget_usd: float | None

    @classmethod
    def from_dict(cls, raw: Any) -> "EvalExpectations":
        payload = raw if isinstance(raw, dict) else {}
        return cls(
            required_substrings=_as_string_list(payload.get("required_substrings"), "expectations.required_substrings"),
            forbidden_substrings=_as_string_list(payload.get("forbidden_substrings"), "expectations.forbidden_substrings"),
            required_tools=_as_string_list(payload.get("required_tools"), "expectations.required_tools"),
            forbidden_tools=_as_string_list(payload.get("forbidden_tools"), "expectations.forbidden_tools"),
            required_context_items=_as_string_list(
                payload.get("required_context_items"), "expectations.required_context_items"
            ),
            latency_budget_ms=_as_optional_float(payload.get("latency_budget_ms"), "expectations.latency_budget_ms"),
            cost_budget_usd=_as_optional_float(payload.get("cost_budget_usd"), "expectations.cost_budget_usd"),
        )


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    split: SplitName
    prompt: str
    category: str
    tags: tuple[str, ...]
    weights: dict[MetricName, float]
    expectations: EvalExpectations
    metadata: dict[str, Any]

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "EvalCase":
        case_id = _as_string(raw.get("id"), "id")
        split = _as_string(raw.get("split", "optimization"), "split")
        prompt = _as_string(raw.get("prompt", "N/A"), "prompt")
        category = _as_string(raw.get("category", "general"), "category")
        tags = _as_string_list(raw.get("tags"), "tags")
        weights = _parse_metric_weights(raw.get("weights"))
        expectations = EvalExpectations.from_dict(raw.get("expectations"))
        metadata_raw = raw.get("metadata")
        metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
        return cls(
            case_id=case_id,
            split=split,
            prompt=prompt,
            category=category,
            tags=tags,
            weights=weights,
            expectations=expectations,
            metadata=metadata,
        )


@dataclass(frozen=True)
class EvalRun:
    case_id: str
    variant: str
    assistant_response: str
    used_tools: tuple[str, ...]
    recalled_context: tuple[str, ...]
    latency_ms: float | None
    estimated_cost_usd: float | None
    policy_denials: int
    violations: tuple[str, ...]
    completed: bool
    unsafe_actions: int
    metadata: dict[str, Any]

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "EvalRun":
        case_id = _as_string(raw.get("case_id"), "case_id")
        variant = _as_string(raw.get("variant", "default"), "variant")
        response_raw = raw.get("assistant_response", "")
        assistant_response = response_raw if isinstance(response_raw, str) else str(response_raw)
        metadata_raw = raw.get("metadata")
        metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
        return cls(
            case_id=case_id,
            variant=variant,
            assistant_response=assistant_response,
            used_tools=_as_string_list(raw.get("used_tools"), "used_tools"),
            recalled_context=_as_string_list(raw.get("recalled_context"), "recalled_context"),
            latency_ms=_as_optional_float(raw.get("latency_ms"), "latency_ms"),
            estimated_cost_usd=_as_optional_float(raw.get("estimated_cost_usd"), "estimated_cost_usd"),
            policy_denials=_as_non_negative_int(raw.get("policy_denials"), "policy_denials"),
            violations=_as_string_list(raw.get("violations"), "violations"),
            completed=_as_bool(raw.get("completed"), "completed", default=True),
            unsafe_actions=_as_non_negative_int(raw.get("unsafe_actions"), "unsafe_actions"),
            metadata=metadata,
        )


@dataclass(frozen=True)
class SplitGate:
    min_average_score: float
    min_pass_rate: float

    @classmethod
    def from_dict(cls, raw: Any, *, default_average: float = 0.0, default_pass_rate: float = 0.0) -> "SplitGate":
        payload = raw if isinstance(raw, dict) else {}
        min_average = _as_optional_float(payload.get("min_average_score"), "split.min_average_score")
        min_pass_rate = _as_optional_float(payload.get("min_pass_rate"), "split.min_pass_rate")
        return cls(
            min_average_score=clamp_score(min_average if min_average is not None else default_average),
            min_pass_rate=clamp_score(min_pass_rate if min_pass_rate is not None else default_pass_rate),
        )


@dataclass(frozen=True)
class RegressionGuard:
    baseline_variant: str
    candidate_variant: str
    splits: tuple[SplitName, ...]
    max_score_drop: float
    max_pass_rate_drop: float

    @classmethod
    def from_dict(cls, raw: Any) -> "RegressionGuard | None":
        if not isinstance(raw, dict):
            return None
        baseline_variant = _as_string(raw.get("baseline_variant"), "regression_guard.baseline_variant")
        candidate_variant = _as_string(raw.get("candidate_variant"), "regression_guard.candidate_variant")
        splits = _as_string_list(raw.get("splits"), "regression_guard.splits")
        if not splits:
            splits = ("holdout",)
        max_score_drop = _as_optional_float(raw.get("max_score_drop"), "regression_guard.max_score_drop")
        max_pass_rate_drop = _as_optional_float(raw.get("max_pass_rate_drop"), "regression_guard.max_pass_rate_drop")
        return cls(
            baseline_variant=baseline_variant,
            candidate_variant=candidate_variant,
            splits=splits,
            max_score_drop=float(max_score_drop if max_score_drop is not None else 0.0),
            max_pass_rate_drop=float(max_pass_rate_drop if max_pass_rate_drop is not None else 0.0),
        )


@dataclass(frozen=True)
class EvalGatePolicy:
    case_pass_threshold: float
    split_gates: dict[SplitName, SplitGate]
    min_metric_averages: dict[MetricName, float]
    regression_guard: RegressionGuard | None

    @classmethod
    def from_dict(cls, raw: Any) -> "EvalGatePolicy":
        payload = raw if isinstance(raw, dict) else {}
        case_threshold = _as_optional_float(payload.get("case_pass_threshold"), "case_pass_threshold")
        split_payload = payload.get("split_gates")
        split_gates: dict[SplitName, SplitGate] = {}
        if isinstance(split_payload, dict):
            for key, value in split_payload.items():
                if not isinstance(key, str):
                    continue
                split_gates[key] = SplitGate.from_dict(value)
        metric_payload = payload.get("min_metric_averages")
        min_metric_averages: dict[MetricName, float] = {}
        if isinstance(metric_payload, dict):
            for key, value in metric_payload.items():
                if key not in METRIC_NAMES:
                    continue
                parsed = _as_optional_float(value, f"min_metric_averages.{key}")
                if parsed is None:
                    continue
                min_metric_averages[key] = clamp_score(parsed)
        return cls(
            case_pass_threshold=clamp_score(case_threshold if case_threshold is not None else 0.75),
            split_gates=split_gates,
            min_metric_averages=min_metric_averages,
            regression_guard=RegressionGuard.from_dict(payload.get("regression_guard")),
        )

    def to_dict(self) -> dict[str, Any]:
        split_gates = {
            split: {
                "min_average_score": gate.min_average_score,
                "min_pass_rate": gate.min_pass_rate,
            }
            for split, gate in self.split_gates.items()
        }
        regression_guard = None
        if self.regression_guard is not None:
            regression_guard = {
                "baseline_variant": self.regression_guard.baseline_variant,
                "candidate_variant": self.regression_guard.candidate_variant,
                "splits": list(self.regression_guard.splits),
                "max_score_drop": self.regression_guard.max_score_drop,
                "max_pass_rate_drop": self.regression_guard.max_pass_rate_drop,
            }
        return {
            "case_pass_threshold": self.case_pass_threshold,
            "split_gates": split_gates,
            "min_metric_averages": dict(self.min_metric_averages),
            "regression_guard": regression_guard,
        }


DEFAULT_GATE_POLICY = EvalGatePolicy(
    case_pass_threshold=0.75,
    split_gates={
        "optimization": SplitGate(min_average_score=0.75, min_pass_rate=0.7),
        "holdout": SplitGate(min_average_score=0.72, min_pass_rate=0.65),
    },
    min_metric_averages={"safety_compliance": 0.95},
    regression_guard=None,
)


def load_eval_cases(path: Path) -> list[EvalCase]:
    rows = _load_jsonl(path)
    cases = [EvalCase.from_dict(row) for row in rows]
    case_ids = {case.case_id for case in cases}
    if len(case_ids) != len(cases):
        raise ValueError("duplicate case id found in cases file")
    return cases


def load_eval_runs(path: Path) -> list[EvalRun]:
    rows = _load_jsonl(path)
    return [EvalRun.from_dict(row) for row in rows]


def load_gate_policy(path: Path | None) -> EvalGatePolicy:
    if path is None:
        return DEFAULT_GATE_POLICY
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    policy = EvalGatePolicy.from_dict(payload)
    if not policy.split_gates:
        return EvalGatePolicy(
            case_pass_threshold=policy.case_pass_threshold,
            split_gates=dict(DEFAULT_GATE_POLICY.split_gates),
            min_metric_averages=policy.min_metric_averages or dict(DEFAULT_GATE_POLICY.min_metric_averages),
            regression_guard=policy.regression_guard,
        )
    if not policy.min_metric_averages:
        return EvalGatePolicy(
            case_pass_threshold=policy.case_pass_threshold,
            split_gates=policy.split_gates,
            min_metric_averages=dict(DEFAULT_GATE_POLICY.min_metric_averages),
            regression_guard=policy.regression_guard,
        )
    return policy
