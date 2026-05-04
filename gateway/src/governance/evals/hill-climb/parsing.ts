import { readFileSync } from "node:fs";

import {
  DEFAULT_GATE_POLICY,
  DEFAULT_METRIC_WEIGHTS,
  METRIC_NAMES,
  type EvalCase,
  type EvalExpectations,
  type EvalGatePolicy,
  type EvalRun,
  type JsonObject,
  type MetricName,
  type RegressionGuard,
  type RewardV1Weights,
  type SplitGate,
} from "./types";

export function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must not be empty`);
  }
  return normalized;
}

function asOptionalFloat(value: unknown, field: string): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`${field} must be numeric when provided`);
}

function asNonNegativeInt(value: unknown, field: string, defaultValue = 0): number {
  if (value == null) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be an integer >= 0`);
  }
  return value;
}

function asBoolean(value: unknown, field: string, defaultValue = false): boolean {
  if (value == null) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be boolean`);
  }
  return value;
}

function asStringList(value: unknown, field: string): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be a list of strings`);
  }
  const output: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${field}[${index}] must be a string`);
    }
    const normalized = item.trim();
    if (normalized) {
      output.push(normalized);
    }
  });
  return output;
}

function normalizeWeights(weights: Record<MetricName, number>): Record<MetricName, number> {
  const total = METRIC_NAMES.reduce((sum, metric) => sum + weights[metric], 0);
  if (total <= 0) {
    const uniform = 1 / METRIC_NAMES.length;
    return {
      task_success: uniform,
      tool_use_quality: uniform,
      context_retention: uniform,
      safety_compliance: uniform,
      latency_cost: uniform,
    };
  }
  return {
    task_success: weights.task_success / total,
    tool_use_quality: weights.tool_use_quality / total,
    context_retention: weights.context_retention / total,
    safety_compliance: weights.safety_compliance / total,
    latency_cost: weights.latency_cost / total,
  };
}

function parseMetricWeights(raw: unknown): Record<MetricName, number> {
  const weights: Record<MetricName, number> = { ...DEFAULT_METRIC_WEIGHTS };
  if (raw == null) {
    return normalizeWeights(weights);
  }
  const payload = asObject(raw);
  if (payload == null) {
    throw new Error("weights must be an object");
  }
  for (const metric of METRIC_NAMES) {
    if (!(metric in payload)) {
      continue;
    }
    const rawValue = payload[metric];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 0) {
      throw new Error(`weights.${metric} must be numeric >= 0`);
    }
    weights[metric] = rawValue;
  }
  return normalizeWeights(weights);
}

function parseEvalExpectations(raw: unknown): EvalExpectations {
  const payload = asObject(raw) ?? {};
  return {
    requiredSubstrings: asStringList(payload.required_substrings, "expectations.required_substrings"),
    forbiddenSubstrings: asStringList(payload.forbidden_substrings, "expectations.forbidden_substrings"),
    requiredTools: asStringList(payload.required_tools, "expectations.required_tools"),
    forbiddenTools: asStringList(payload.forbidden_tools, "expectations.forbidden_tools"),
    requiredContextItems: asStringList(payload.required_context_items, "expectations.required_context_items"),
    latencyBudgetMs: asOptionalFloat(payload.latency_budget_ms, "expectations.latency_budget_ms"),
    costBudgetUsd: asOptionalFloat(payload.cost_budget_usd, "expectations.cost_budget_usd"),
  };
}

function parseEvalCase(raw: JsonObject): EvalCase {
  const metadata = asObject(raw.metadata) ?? {};
  const tags = asStringList(raw.tags, "tags");
  const behaviorTags = asStringList(raw.behavior_tags, "behavior_tags");
  return {
    caseId: asString(raw.id, "id"),
    split: asString(raw.split ?? "optimization", "split"),
    prompt: asString(raw.prompt ?? "N/A", "prompt"),
    category: asString(raw.category ?? "general", "category"),
    tags,
    behaviorTags: behaviorTags.length > 0 ? behaviorTags : tags,
    mustPass: asBoolean(raw.must_pass, "must_pass", false),
    weights: parseMetricWeights(raw.weights),
    expectations: parseEvalExpectations(raw.expectations),
    metadata,
  };
}

function parseEvalRun(raw: JsonObject): EvalRun {
  const responseRaw = raw.assistant_response;
  const metadata = asObject(raw.metadata) ?? {};
  return {
    caseId: asString(raw.case_id, "case_id"),
    variant: asString(raw.variant ?? "default", "variant"),
    assistantResponse: typeof responseRaw === "string" ? responseRaw : String(responseRaw ?? ""),
    usedTools: asStringList(raw.used_tools, "used_tools"),
    recalledContext: asStringList(raw.recalled_context, "recalled_context"),
    latencyMs: asOptionalFloat(raw.latency_ms, "latency_ms"),
    estimatedCostUsd: asOptionalFloat(raw.estimated_cost_usd, "estimated_cost_usd"),
    policyDenials: asNonNegativeInt(raw.policy_denials, "policy_denials"),
    violations: asStringList(raw.violations, "violations"),
    completed: asBoolean(raw.completed, "completed", true),
    unsafeActions: asNonNegativeInt(raw.unsafe_actions, "unsafe_actions"),
    metadata,
  };
}

function loadJsonl(path: string): JsonObject[] {
  const raw = readFileSync(path, "utf8");
  const rows: JsonObject[] = [];
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, index) => {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${String(error)}`);
    }
    const payload = asObject(parsed);
    if (payload == null) {
      throw new Error(`${path}:${index + 1}: each row must be a JSON object`);
    }
    rows.push(payload);
  });
  return rows;
}

export function loadEvalCases(path: string): EvalCase[] {
  const rows = loadJsonl(path);
  const cases = rows.map((row) => parseEvalCase(row));
  const seen = new Set<string>();
  cases.forEach((item) => {
    if (seen.has(item.caseId)) {
      throw new Error("duplicate case id found in cases file");
    }
    seen.add(item.caseId);
  });
  return cases;
}

export function loadEvalRuns(path: string): EvalRun[] {
  const rows = loadJsonl(path);
  return rows.map((row) => parseEvalRun(row));
}

function parseSplitGate(raw: unknown): SplitGate {
  const payload = asObject(raw) ?? {};
  const minAverage = asOptionalFloat(payload.min_average_score, "split.min_average_score");
  const minPassRate = asOptionalFloat(payload.min_pass_rate, "split.min_pass_rate");
  return {
    minAverageScore: clampScore(minAverage ?? 0),
    minPassRate: clampScore(minPassRate ?? 0),
  };
}

function parseRegressionGuard(raw: unknown): RegressionGuard | null {
  const payload = asObject(raw);
  if (payload == null) {
    return null;
  }
  const splits = asStringList(payload.splits, "regression_guard.splits");
  return {
    baselineVariant: asString(payload.baseline_variant, "regression_guard.baseline_variant"),
    candidateVariant: asString(payload.candidate_variant, "regression_guard.candidate_variant"),
    splits: splits.length > 0 ? splits : ["holdout"],
    maxScoreDrop: asOptionalFloat(payload.max_score_drop, "regression_guard.max_score_drop") ?? 0,
    maxPassRateDrop: asOptionalFloat(payload.max_pass_rate_drop, "regression_guard.max_pass_rate_drop") ?? 0,
  };
}

function parseRewardV1Weights(raw: unknown): RewardV1Weights {
  const defaults = { ...DEFAULT_GATE_POLICY.rewardV1Weights };
  const payload = asObject(raw);
  if (payload == null) {
    return defaults;
  }

  const read = (field: string, defaultValue: number): number => {
    if (!(field in payload)) {
      return defaultValue;
    }
    const value = payload[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`reward_v1_weights.${field} must be numeric >= 0`);
    }
    return value;
  };

  const parsed: RewardV1Weights = {
    quality: read("quality", defaults.quality),
    safety: read("safety", defaults.safety),
    toolCorrectness: read("tool_correctness", defaults.toolCorrectness),
    latencyCost: read("latency_cost", defaults.latencyCost),
    stability: read("stability", defaults.stability),
  };
  const total = parsed.quality + parsed.safety + parsed.toolCorrectness + parsed.latencyCost + parsed.stability;
  if (total <= 0) {
    return defaults;
  }
  return {
    quality: parsed.quality / total,
    safety: parsed.safety / total,
    toolCorrectness: parsed.toolCorrectness / total,
    latencyCost: parsed.latencyCost / total,
    stability: parsed.stability / total,
  };
}

export function loadGatePolicy(path: string | null): EvalGatePolicy {
  if (path == null) {
    return DEFAULT_GATE_POLICY;
  }
  const payload = asObject(JSON.parse(readFileSync(path, "utf8")));
  if (payload == null) {
    throw new Error("gate policy must be JSON object");
  }

  const casePassThreshold = clampScore(
    asOptionalFloat(payload.case_pass_threshold, "case_pass_threshold") ?? 0.75
  );
  const splitGatePayload = asObject(payload.split_gates);
  const splitGates: Record<string, SplitGate> = {};
  if (splitGatePayload != null) {
    Object.entries(splitGatePayload).forEach(([key, value]) => {
      if (!key.trim()) {
        return;
      }
      splitGates[key] = parseSplitGate(value);
    });
  }
  const metricPayload = asObject(payload.min_metric_averages);
  const minMetricAverages: Partial<Record<MetricName, number>> = {};
  if (metricPayload != null) {
    METRIC_NAMES.forEach((metric) => {
      if (!(metric in metricPayload)) {
        return;
      }
      const parsed = asOptionalFloat(metricPayload[metric], `min_metric_averages.${metric}`);
      if (parsed == null) {
        return;
      }
      minMetricAverages[metric] = clampScore(parsed);
    });
  }
  const regressionGuard = parseRegressionGuard(payload.regression_guard);
  const failOnMustPass = asBoolean(payload.fail_on_must_pass, "fail_on_must_pass", true);
  const rewardV1Weights = parseRewardV1Weights(payload.reward_v1_weights);
  const resolvedSplitGates =
    Object.keys(splitGates).length > 0 ? splitGates : { ...DEFAULT_GATE_POLICY.splitGates };
  const resolvedMetricAverages =
    Object.keys(minMetricAverages).length > 0
      ? minMetricAverages
      : { ...DEFAULT_GATE_POLICY.minMetricAverages };

  return {
    casePassThreshold,
    splitGates: resolvedSplitGates,
    minMetricAverages: resolvedMetricAverages,
    regressionGuard,
    failOnMustPass,
    rewardV1Weights,
  };
}
