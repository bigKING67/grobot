export type JsonObject = Record<string, unknown>;
export type PolicyDriftSeverity = "none" | "low" | "medium" | "high";

export interface ParsedCliArgs {
  traceReportPath: string;
  skillRouterReportPath: string;
  contextMemoryReportPath: string | undefined;
  weeklyRegressionReportPath: string | undefined;
  autoLoopReportPath: string | undefined;
  policyDriftReportPath: string | undefined;
  outputPath: string | undefined;
  markdownOutputPath: string | undefined;
  labelsOutputPath: string | undefined;
  printJson: boolean;
  printMarkdown: boolean;
  printLabels: boolean;
  emitGithubAnnotations: boolean;
  failOnOverallFail: boolean;
}

export interface PolicyDriftSummary {
  severity: PolicyDriftSeverity;
  reason: string;
  label: string;
  previous_severity: PolicyDriftSeverity;
  previous_reason: string;
  worsening_streak: number;
  worsening_alert: boolean;
  worsening_alert_threshold: number;
  worsening_label: string;
  transition: string;
  transition_state: string;
  severity_delta: number;
  owner: string;
  action_hint: string;
}

export interface HarnessCiSummary {
  overall_pass: boolean;
  suggested_labels: string[];
  policy_drift: PolicyDriftSummary;
  auto_loop: {
    available: boolean;
    run_id: string | null;
    baseline_variant: string | null;
    proposal_count: number;
    evaluation_count: number;
    selected_proposal_id: string | null;
    selected_variant: string | null;
    promotion_state: string | null;
    circuit_breaker_triggered: boolean;
    circuit_breaker_reason: string | null;
    selected_reward_v1_composite: number | null;
    selected_optimization_gain: number | null;
    selected_holdout_drop: number | null;
  };
  trace: {
    sample_guard_pass: boolean;
    clean_cases: number;
    clean_runs: number;
    split_counts: {
      holdout: number;
      optimization: number;
    };
    policy_hash: string | null;
  };
  skill_router: {
    gate_pass: boolean;
    trend_required: boolean;
    trend_pass: boolean | null;
    trend_mode: string | null;
    trend_reason: string | null;
    trend_decision_tag: string;
    trend_decision_severity: string;
    trend_action_hint: string;
    trend_owner: string;
    suggested_labels: string[];
    baseline_available: unknown;
    policy_blob_match: unknown;
    policy_hash_current: unknown;
    policy_hash_base: unknown;
    policy_hash_match: unknown;
    accuracy: number;
    forbidden_violations: number;
    total_cases: number;
    policy_hash: string | null;
  };
  context_memory: {
    gate_pass: boolean;
    trend_required: boolean;
    trend_pass: boolean | null;
    trend_mode: string | null;
    trend_reason: string | null;
    trend_decision_tag: string;
    trend_decision_severity: string;
    trend_action_hint: string;
    trend_owner: string;
    baseline_available: unknown;
    policy_blob_match: unknown;
    policy_hash_current: unknown;
    policy_hash_base: unknown;
    policy_hash_match: unknown;
    pass_rate: number;
    average_score: number;
    case_count: number;
    policy_hash: string | null;
  };
  weekly_regression: {
    gate_pass: boolean;
    trend_required: boolean;
    trend_pass: boolean | null;
    trend_mode: string | null;
    trend_reason: string | null;
    success_rate: number;
    first_pass_rate: number;
    token_cost: number;
    rollback_rate: number;
    policy_hash: string | null;
  };
}
