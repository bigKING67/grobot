import {
  METRIC_NAMES,
  type JsonObject,
  type MetricName,
  type TrendCompareResult,
  type WeeklyRegressionPolicy,
  type WeeklySnapshot,
} from "./types";
import { toMetricNumber } from "./utils";

export function evaluateGate(snapshot: WeeklySnapshot, policy: WeeklyRegressionPolicy): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  for (const metric of METRIC_NAMES) {
    const threshold = policy.metrics[metric];
    const value = snapshot.metrics[metric].value;
    if (threshold.direction === "higher_better") {
      if (value < threshold.min) {
        failures.push(`metric=${metric} value ${value.toFixed(6)} < min ${threshold.min.toFixed(6)}`);
      }
    } else if (value > threshold.max) {
      failures.push(`metric=${metric} value ${value.toFixed(6)} > max ${threshold.max.toFixed(6)}`);
    }
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

export function compareTrend(
  current: WeeklySnapshot,
  baseline: WeeklySnapshot,
  policy: WeeklyRegressionPolicy,
): TrendCompareResult {
  const failures: string[] = [];
  const baselineValues: Record<MetricName, number> = {
    success_rate: baseline.metrics.success_rate.value,
    first_pass_rate: baseline.metrics.first_pass_rate.value,
    token_cost: baseline.metrics.token_cost.value,
    rollback_rate: baseline.metrics.rollback_rate.value,
  };
  const currentValues: Record<MetricName, number> = {
    success_rate: current.metrics.success_rate.value,
    first_pass_rate: current.metrics.first_pass_rate.value,
    token_cost: current.metrics.token_cost.value,
    rollback_rate: current.metrics.rollback_rate.value,
  };
  const deltas: Record<MetricName, number> = {
    success_rate: 0,
    first_pass_rate: 0,
    token_cost: 0,
    rollback_rate: 0,
  };
  const epsilon = 1e-9;

  for (const metric of METRIC_NAMES) {
    const threshold = policy.metrics[metric];
    const baseValue = baselineValues[metric];
    const currentValue = currentValues[metric];
    if (threshold.direction === "higher_better") {
      const drop = baseValue - currentValue;
      deltas[metric] = toMetricNumber(drop);
      if (drop - threshold.max_drop > epsilon) {
        failures.push(
          `metric=${metric} drop ${drop.toFixed(6)} > max_drop ${threshold.max_drop.toFixed(6)}`,
        );
      }
    } else {
      const increase = currentValue - baseValue;
      deltas[metric] = toMetricNumber(increase);
      if (increase - threshold.max_increase > epsilon) {
        failures.push(
          `metric=${metric} increase ${increase.toFixed(6)} > max_increase ${threshold.max_increase.toFixed(6)}`,
        );
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    baseline: baselineValues,
    current: currentValues,
    deltas,
  };
}

export function buildTrendMeta(input: {
  mode: string;
  reason: string;
  required: boolean;
  baselineAvailable: boolean;
  baseSha: string | undefined;
  currentPolicyBlob: string | undefined;
  basePolicyBlob: string | undefined;
  policyBlobMatch: boolean | null;
  policyHash: string | null;
}): JsonObject {
  return {
    mode: input.mode,
    reason: input.reason,
    required: input.required,
    executed: input.mode === "gate_and_trend",
    baseline_available: input.baselineAvailable,
    base_sha: input.baseSha ?? null,
    policy_blob_current: input.currentPolicyBlob ?? null,
    policy_blob_base: input.basePolicyBlob ?? null,
    policy_blob_match: input.policyBlobMatch,
    policy_hash_current: input.policyHash,
    policy_hash_base: input.policyHash,
    policy_hash_match: input.policyBlobMatch,
  };
}
