export type JsonObject = Record<string, unknown>;
export type MetricName = "success_rate" | "first_pass_rate" | "token_cost" | "rollback_rate";

export interface ParsedCliArgs {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  baselineAvailable: string;
  repoRoot: string;
  outputPath: string;
  contextMemoryReportPath: string;
  contextMemoryBaseReportPath: string;
  runsPath: string;
  ledgerPath: string;
  autoLoopReportPath: string;
  policyPath: string;
  policyBlobPath: string;
  printJson: boolean;
}

export interface WeeklyRegressionCiGateInput {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  baselineAvailable: unknown;
  repoRoot: string;
  outputPath: string;
  contextMemoryReportPath: string;
  contextMemoryBaseReportPath: string;
  runsPath: string;
  ledgerPath: string;
  autoLoopReportPath: string;
  policyPath: string;
  policyBlobPath: string;
}

export interface WeeklyRegressionCiGateResult {
  exit_code: number;
  phase: string;
  trend_mode?: string;
  trend_reason?: string;
}

export interface MetricThreshold {
  direction: "higher_better" | "lower_better";
  min: number;
  max: number;
  max_drop: number;
  max_increase: number;
}

export interface WeeklyRegressionPolicy {
  schema: string;
  metrics: Record<MetricName, MetricThreshold>;
}

export interface MetricSnapshot {
  value: number;
  sample_size: number;
  source: string;
}

export interface WeeklySnapshot {
  metrics: Record<MetricName, MetricSnapshot>;
}

export interface TrendCompareResult {
  passed: boolean;
  failures: string[];
  baseline: Record<MetricName, number>;
  current: Record<MetricName, number>;
  deltas: Record<MetricName, number>;
}

export type BaselineAvailabilityMode = "force_on" | "force_off" | "auto";

export const METRIC_NAMES: MetricName[] = [
  "success_rate",
  "first_pass_rate",
  "token_cost",
  "rollback_rate",
];

export const DEFAULT_POLICY: WeeklyRegressionPolicy = {
  schema: "weekly_regression_policy@v1",
  metrics: {
    success_rate: {
      direction: "higher_better",
      min: 1,
      max: 1,
      max_drop: 0,
      max_increase: 0,
    },
    first_pass_rate: {
      direction: "higher_better",
      min: 1,
      max: 1,
      max_drop: 0,
      max_increase: 0,
    },
    token_cost: {
      direction: "lower_better",
      min: 0,
      max: 0.011,
      max_drop: 0,
      max_increase: 0,
    },
    rollback_rate: {
      direction: "lower_better",
      min: 0,
      max: 0,
      max_drop: 0,
      max_increase: 0,
    },
  },
};
