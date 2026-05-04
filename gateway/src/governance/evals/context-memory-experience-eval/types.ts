import { type runHarness } from "../hill-climb";

export type HarnessReport = ReturnType<typeof runHarness>;
export type HarnessVariantReport = HarnessReport["variants"][string];
export type HarnessCaseRow = HarnessVariantReport["cases"][number];

export type MetricName =
  | "task_success"
  | "tool_use_quality"
  | "context_retention"
  | "safety_compliance"
  | "latency_cost";

export type SaturationMetricName = "task_success" | "tool_use_quality" | "context_retention";
export type DimensionName = "context_compression" | "memory_lineage" | "experience_learning";

export interface DimensionThreshold {
  minCaseCount: number;
  minAverageScore: number;
  minPassRate: number;
  minPassRateLowerBound: number;
  minMetricAverages: Partial<Record<MetricName, number>>;
}

export interface DimensionSummary {
  dimension: DimensionName;
  case_count: number;
  pass_count: number;
  pass_rate: number;
  pass_rate_lower_bound: number;
  average_score: number;
  metric_averages: Record<MetricName, number>;
  failed_case_ids: string[];
}

export interface VariantDimensionReport {
  variant: string;
  harness_gate: {
    passed: boolean;
    failures: string[];
  };
  dimension_gate: {
    passed: boolean;
    failures: string[];
  };
  summary: HarnessVariantReport["summary"];
  splits: HarnessVariantReport["splits"];
  reward_v1: HarnessVariantReport["reward_v1"];
  dimensions: Record<DimensionName, DimensionSummary>;
}

export interface DimensionDelta {
  baseline_average_score: number;
  candidate_average_score: number;
  average_score_drop: number;
  baseline_pass_rate: number;
  candidate_pass_rate: number;
  pass_rate_drop: number;
}

export interface DimensionRegressionGuardReport {
  passed: boolean;
  baseline_variant: string;
  candidate_variant: string;
  max_score_drop: number;
  max_pass_rate_drop: number;
  dimensions: DimensionName[];
  deltas: Record<DimensionName, DimensionDelta>;
  failures: string[];
}

export interface SaturationPolicyPayload {
  max_perfect_case_rate: number;
  max_metric_perfect_rate: number;
  metric_perfect_score_floor: number;
  min_metric_variance: number;
  monitored_metrics: SaturationMetricName[];
}

export interface SaturationMetricSnapshot {
  mean: number;
  perfect_rate: number;
  variance: number;
}

export interface VariantSaturationGuardReport {
  variant: string;
  case_count: number;
  perfect_case_count: number;
  perfect_case_rate: number;
  max_metric_variance: number;
  triggered_metrics: SaturationMetricName[];
  monitored_metrics: Record<SaturationMetricName, SaturationMetricSnapshot>;
  triggered: boolean;
  reasons: string[];
}

export interface ContextMemoryEvalReport {
  schema: "context_memory_experience_eval@v2";
  generated_at: string;
  inputs: {
    cases: string;
    runs: string;
    gate_policy: string | null;
  };
  coverage_policy: {
    min_variant_case_count: number;
    min_holdout_case_count: number;
    min_optimization_case_count: number;
  };
  dimension_policy: Record<DimensionName, {
    min_case_count: number;
    min_average_score: number;
    min_pass_rate: number;
    min_pass_rate_lower_bound: number;
    min_metric_averages: Partial<Record<MetricName, number>>;
  }>;
  saturation_policy: SaturationPolicyPayload;
  variants: Record<string, VariantDimensionReport>;
  saturation_guard: Record<string, VariantSaturationGuardReport>;
  harness_regression_guard: HarnessReport["regression_guard"] | null;
  dimension_regression_guard: DimensionRegressionGuardReport;
  overall_gate: {
    passed: boolean;
    failures: string[];
  };
}
