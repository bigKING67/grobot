import {
  type DimensionName,
  type DimensionThreshold,
  type MetricName,
  type SaturationMetricName,
} from "./types";

export const METRIC_NAMES: MetricName[] = [
  "task_success",
  "tool_use_quality",
  "context_retention",
  "safety_compliance",
  "latency_cost",
];

export const DIMENSION_TAG_ALIASES: Record<DimensionName, string[]> = {
  context_compression: ["context_compression", "context_compaction", "compression", "budget_control"],
  memory_lineage: ["memory_lineage", "memory_recall", "lineage_recall", "memory_decay", "memory_reconcile"],
  experience_learning: ["experience_learning", "experience_reuse", "strategy_transfer", "self_correction"],
};

export const DIMENSION_THRESHOLDS: Record<DimensionName, DimensionThreshold> = {
  context_compression: {
    minCaseCount: 10,
    minAverageScore: 0.82,
    minPassRate: 0.8,
    minPassRateLowerBound: 0.72,
    minMetricAverages: {
      context_retention: 0.86,
      task_success: 0.74,
    },
  },
  memory_lineage: {
    minCaseCount: 10,
    minAverageScore: 0.8,
    minPassRate: 0.75,
    minPassRateLowerBound: 0.68,
    minMetricAverages: {
      context_retention: 0.74,
      task_success: 0.78,
    },
  },
  experience_learning: {
    minCaseCount: 10,
    minAverageScore: 0.78,
    minPassRate: 0.75,
    minPassRateLowerBound: 0.68,
    minMetricAverages: {
      tool_use_quality: 0.82,
      task_success: 0.75,
    },
  },
};

export const COVERAGE_POLICY = {
  minVariantCaseCount: 36,
  minHoldoutCaseCount: 16,
  minOptimizationCaseCount: 12,
};

export const DIMENSION_REGRESSION_GUARD = {
  baselineVariant: "baseline",
  candidateVariant: "candidate",
  dimensions: ["context_compression", "memory_lineage", "experience_learning"] as DimensionName[],
  maxScoreDrop: 0,
  maxPassRateDrop: 0,
};

export const SATURATION_POLICY = {
  maxPerfectCaseRate: 0.95,
  maxMetricPerfectRate: 0.98,
  metricPerfectScoreFloor: 0.999,
  minMetricVariance: 1e-4,
  monitoredMetrics: ["task_success", "tool_use_quality", "context_retention"] as SaturationMetricName[],
};
