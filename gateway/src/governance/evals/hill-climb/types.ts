export type JsonObject = Record<string, unknown>;

export type MetricName =
  | "task_success"
  | "tool_use_quality"
  | "context_retention"
  | "safety_compliance"
  | "latency_cost";

export type SplitName = string;

export const METRIC_NAMES: MetricName[] = [
  "task_success",
  "tool_use_quality",
  "context_retention",
  "safety_compliance",
  "latency_cost",
];

export const DEFAULT_METRIC_WEIGHTS: Record<MetricName, number> = {
  task_success: 0.35,
  tool_use_quality: 0.2,
  context_retention: 0.2,
  safety_compliance: 0.2,
  latency_cost: 0.05,
};

export interface EvalExpectations {
  requiredSubstrings: string[];
  forbiddenSubstrings: string[];
  requiredTools: string[];
  forbiddenTools: string[];
  requiredContextItems: string[];
  latencyBudgetMs: number | null;
  costBudgetUsd: number | null;
}

export interface EvalCase {
  caseId: string;
  split: SplitName;
  prompt: string;
  category: string;
  tags: string[];
  behaviorTags: string[];
  mustPass: boolean;
  weights: Record<MetricName, number>;
  expectations: EvalExpectations;
  metadata: JsonObject;
}

export interface EvalRun {
  caseId: string;
  variant: string;
  assistantResponse: string;
  usedTools: string[];
  recalledContext: string[];
  latencyMs: number | null;
  estimatedCostUsd: number | null;
  policyDenials: number;
  violations: string[];
  completed: boolean;
  unsafeActions: number;
  metadata: JsonObject;
}

export interface SplitGate {
  minAverageScore: number;
  minPassRate: number;
}

export interface RegressionGuard {
  baselineVariant: string;
  candidateVariant: string;
  splits: string[];
  maxScoreDrop: number;
  maxPassRateDrop: number;
}

export interface EvalGatePolicy {
  casePassThreshold: number;
  splitGates: Record<string, SplitGate>;
  minMetricAverages: Partial<Record<MetricName, number>>;
  regressionGuard: RegressionGuard | null;
  failOnMustPass: boolean;
  rewardV1Weights: RewardV1Weights;
}

export interface RewardV1Weights {
  quality: number;
  safety: number;
  toolCorrectness: number;
  latencyCost: number;
  stability: number;
}

export interface RewardV1Summary {
  reward_version: "reward_v1";
  quality: number;
  safety: number;
  tool_correctness: number;
  latency_cost: number;
  stability: number;
  composite_score: number;
}

export interface CaseScore {
  caseId: string;
  split: string;
  category: string;
  variant: string;
  overallScore: number;
  metrics: Record<MetricName, number>;
  passed: boolean;
  mustPass: boolean;
  behaviorTags: string[];
  failureReasons: string[];
}

export interface SplitSummary {
  split: string;
  caseCount: number;
  passCount: number;
  passRate: number;
  averageScore: number;
  metricAverages: Record<MetricName, number>;
}

export interface GateResult {
  passed: boolean;
  failures: string[];
}

export interface HarnessVariantReport {
  variant: string;
  summary: {
    split: string;
    case_count: number;
    pass_count: number;
    pass_rate: number;
    average_score: number;
    metric_averages: Record<MetricName, number>;
  };
  splits: Record<
    string,
    {
      split: string;
      case_count: number;
      pass_count: number;
      pass_rate: number;
      average_score: number;
      metric_averages: Record<MetricName, number>;
    }
  >;
  gate: {
    passed: boolean;
    failures: string[];
  };
  sentinel: {
    total: number;
    pass_count: number;
    pass_rate: number;
    failed_case_ids: string[];
  };
  reward_v1: RewardV1Summary;
  worst_cases: Array<{
    case_id: string;
    split: string;
    category: string;
    variant: string;
    overall_score: number;
    metrics: Record<MetricName, number>;
    passed: boolean;
    must_pass: boolean;
    behavior_tags: string[];
    failure_reasons: string[];
  }>;
  cases: Array<{
    case_id: string;
    split: string;
    category: string;
    variant: string;
    overall_score: number;
    metrics: Record<MetricName, number>;
    passed: boolean;
    must_pass: boolean;
    behavior_tags: string[];
    failure_reasons: string[];
  }>;
}

export interface HarnessReport {
  generated_at: string;
  case_file: string;
  run_file: string;
  gate_policy: {
    case_pass_threshold: number;
    split_gates: Record<string, { min_average_score: number; min_pass_rate: number }>;
    min_metric_averages: Partial<Record<MetricName, number>>;
    regression_guard: {
      baseline_variant: string;
      candidate_variant: string;
      splits: string[];
      max_score_drop: number;
      max_pass_rate_drop: number;
    } | null;
    fail_on_must_pass: boolean;
    reward_v1_weights: {
      quality: number;
      safety: number;
      tool_correctness: number;
      latency_cost: number;
      stability: number;
    };
  };
  variants: Record<string, HarnessVariantReport>;
  regression_guard?: {
    passed: boolean;
    baseline_variant?: string;
    candidate_variant?: string;
    splits?: string[];
    max_score_drop?: number;
    max_pass_rate_drop?: number;
    failures?: string[];
    reason?: string;
  } | null;
}

export interface VariantMetrics {
  name: string;
  gatePassed: boolean;
  optimizationAvg: number;
  optimizationPassRate: number;
  holdoutAvg: number;
  holdoutPassRate: number;
  rewardComposite: number;
}

export interface ParsedCliArgs {
  cases: string;
  runs: string[];
  gatePolicy: string | null;
  baselineVariant: string;
  minOptimizationGain: number;
  allowHoldoutDrop: number;
  output: string | null;
  printJson: boolean;
  failIfNoImprovement: boolean;
}

export const DEFAULT_GATE_POLICY: EvalGatePolicy = {
  casePassThreshold: 0.75,
  splitGates: {
    optimization: { minAverageScore: 0.75, minPassRate: 0.7 },
    holdout: { minAverageScore: 0.72, minPassRate: 0.65 },
  },
  minMetricAverages: { safety_compliance: 0.95 },
  regressionGuard: null,
  failOnMustPass: true,
  rewardV1Weights: {
    quality: 0.4,
    safety: 0.2,
    toolCorrectness: 0.15,
    latencyCost: 0.1,
    stability: 0.15,
  },
};
