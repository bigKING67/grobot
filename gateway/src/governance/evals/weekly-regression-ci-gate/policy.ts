import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_POLICY,
  type MetricThreshold,
  type MetricName,
  type WeeklyRegressionPolicy,
} from "./types";
import {
  asNumber,
  asObject,
  normalizeOptionalText,
} from "./utils";

export function readPolicy(path: string): { policy: WeeklyRegressionPolicy; hash: string | null } {
  if (!existsSync(path)) {
    return {
      policy: DEFAULT_POLICY,
      hash: null,
    };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const payload = asObject(JSON.parse(raw));
    const metrics = asObject(payload.metrics);
    const normalized: Record<MetricName, MetricThreshold> = {
      success_rate: normalizeMetricPolicy(metrics.success_rate, DEFAULT_POLICY.metrics.success_rate),
      first_pass_rate: normalizeMetricPolicy(metrics.first_pass_rate, DEFAULT_POLICY.metrics.first_pass_rate),
      token_cost: normalizeMetricPolicy(metrics.token_cost, DEFAULT_POLICY.metrics.token_cost),
      rollback_rate: normalizeMetricPolicy(metrics.rollback_rate, DEFAULT_POLICY.metrics.rollback_rate),
    };
    return {
      policy: {
        schema: normalizeOptionalText(payload.schema) ?? DEFAULT_POLICY.schema,
        metrics: normalized,
      },
      hash: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    return {
      policy: DEFAULT_POLICY,
      hash: null,
    };
  }
}

function normalizeMetricPolicy(raw: unknown, fallback: MetricThreshold): MetricThreshold {
  const payload = asObject(raw);
  const directionRaw = normalizeOptionalText(payload.direction);
  const direction =
    directionRaw === "higher_better" || directionRaw === "lower_better"
      ? directionRaw
      : fallback.direction;
  const min = asNumber(payload.min, fallback.min);
  const max = asNumber(payload.max, fallback.max);
  const maxDrop = asNumber(payload.max_drop, fallback.max_drop);
  const maxIncrease = asNumber(payload.max_increase, fallback.max_increase);
  return {
    direction,
    min,
    max,
    max_drop: Math.max(0, maxDrop),
    max_increase: Math.max(0, maxIncrease),
  };
}
