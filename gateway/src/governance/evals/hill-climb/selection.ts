import { readFileSync, writeFileSync } from "node:fs";

import { asObject } from "./parsing";
import { type HarnessReport, type JsonObject, type VariantMetrics } from "./types";

export function mergeJsonl(inputPaths: string[], outputPath: string): void {
  const outputRows: string[] = [];
  inputPaths.forEach((path) => {
    const raw = readFileSync(path, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("#")) {
        return;
      }
      outputRows.push(stripped);
    });
  });
  if (outputRows.length > 0) {
    writeFileSync(outputPath, `${outputRows.join("\n")}\n`, "utf8");
    return;
  }
  writeFileSync(outputPath, "", "utf8");
}

function parseVariantMetrics(name: string, payload: JsonObject): VariantMetrics {
  const gate = asObject(payload.gate) ?? {};
  const splits = asObject(payload.splits) ?? {};
  const optimization = asObject(splits.optimization) ?? {};
  const holdout = asObject(splits.holdout) ?? {};
  const reward = asObject(payload.reward_v1) ?? {};
  return {
    name,
    gatePassed: gate.passed === true,
    optimizationAvg:
      typeof optimization.average_score === "number" && Number.isFinite(optimization.average_score)
        ? optimization.average_score
        : 0,
    optimizationPassRate:
      typeof optimization.pass_rate === "number" && Number.isFinite(optimization.pass_rate)
        ? optimization.pass_rate
        : 0,
    holdoutAvg:
      typeof holdout.average_score === "number" && Number.isFinite(holdout.average_score)
        ? holdout.average_score
        : 0,
    holdoutPassRate:
      typeof holdout.pass_rate === "number" && Number.isFinite(holdout.pass_rate)
        ? holdout.pass_rate
        : 0,
    rewardComposite:
      typeof reward.composite_score === "number" && Number.isFinite(reward.composite_score)
        ? reward.composite_score
        : 0,
  };
}

export function hillClimbFromReport(
  report: HarnessReport,
  baselineVariant: string,
  minOptimizationGain: number,
  allowHoldoutDrop: number
): JsonObject {
  const variantsPayload = asObject(report.variants);
  if (variantsPayload == null) {
    throw new Error("report.variants must be a dict");
  }
  const metricsMap = new Map<string, VariantMetrics>();
  Object.entries(variantsPayload).forEach(([variantName, payload]) => {
    const item = asObject(payload);
    if (item == null) {
      return;
    }
    metricsMap.set(variantName, parseVariantMetrics(variantName, item));
  });
  if (!metricsMap.has(baselineVariant)) {
    throw new Error(`baseline variant not found: ${baselineVariant}`);
  }
  let current = metricsMap.get(baselineVariant) as VariantMetrics;
  const remaining = new Set(Array.from(metricsMap.keys()).filter((item) => item !== baselineVariant));
  const trail: JsonObject[] = [];
  const rejected: JsonObject[] = [];

  while (remaining.size > 0) {
    let bestCandidate: VariantMetrics | null = null;
    let bestGain = 0;
    Array.from(remaining)
      .sort((left, right) => left.localeCompare(right))
      .forEach((candidateName) => {
        const candidate = metricsMap.get(candidateName) as VariantMetrics;
        if (!candidate.gatePassed) {
          rejected.push({ variant: candidateName, reason: "gate_failed" });
          return;
        }
        const holdoutDrop = current.holdoutAvg - candidate.holdoutAvg;
        const holdoutPassDrop = current.holdoutPassRate - candidate.holdoutPassRate;
        if (holdoutDrop > allowHoldoutDrop || holdoutPassDrop > allowHoldoutDrop) {
          rejected.push({
            variant: candidateName,
            reason: "holdout_regression",
            holdout_drop: holdoutDrop,
            holdout_pass_rate_drop: holdoutPassDrop,
          });
          return;
        }
        const gain = candidate.optimizationAvg - current.optimizationAvg;
        if (gain <= minOptimizationGain) {
          rejected.push({ variant: candidateName, reason: "insufficient_optimization_gain", gain });
          return;
        }
        if (bestCandidate == null || gain > bestGain) {
          bestCandidate = candidate;
          bestGain = gain;
        }
      });
    if (bestCandidate == null) {
      break;
    }
    const nextCandidate: VariantMetrics = bestCandidate;
    trail.push({
      from: current.name,
      to: nextCandidate.name,
      optimization_gain: nextCandidate.optimizationAvg - current.optimizationAvg,
      holdout_delta: nextCandidate.holdoutAvg - current.holdoutAvg,
      holdout_pass_rate_delta: nextCandidate.holdoutPassRate - current.holdoutPassRate,
    });
    current = nextCandidate;
    remaining.delete(nextCandidate.name);
  }

  return {
    winner: current.name,
    winner_metrics: {
      name: current.name,
      gate_passed: current.gatePassed,
      optimization_avg: current.optimizationAvg,
      optimization_pass_rate: current.optimizationPassRate,
      holdout_avg: current.holdoutAvg,
      holdout_pass_rate: current.holdoutPassRate,
      reward_v1_composite: current.rewardComposite,
    },
    baseline: baselineVariant,
    trail,
    rejected,
    metrics: Object.fromEntries(
      Array.from(metricsMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, metric]) => [
          name,
          {
            name: metric.name,
            gate_passed: metric.gatePassed,
            optimization_avg: metric.optimizationAvg,
            optimization_pass_rate: metric.optimizationPassRate,
            holdout_avg: metric.holdoutAvg,
            holdout_pass_rate: metric.holdoutPassRate,
            reward_v1_composite: metric.rewardComposite,
          },
        ])
    ),
  };
}
