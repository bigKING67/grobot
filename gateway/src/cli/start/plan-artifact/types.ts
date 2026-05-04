export type PlanArtifactStatus =
  | "draft"
  | "blocked"
  | "review_failed"
  | "ready"
  | "approved"
  | "applying"
  | "apply_failed"
  | "applied"
  | "discarded";

export interface PlanArtifactEntry {
  plan_id: string;
  seq: number;
  title: string;
  task_slug: string;
  filename: string;
  status: PlanArtifactStatus;
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  review_fail_count?: number;
  blocked_count?: number;
  apply_started_at?: string;
  approved_at?: string;
  approved_hash?: string;
  approval_ticket_id?: string;
  approved_snapshot_path?: string;
  approved_by?: string;
  apply_failed_at?: string;
  applied_at?: string;
  discarded_at?: string;
}

export interface PlanArtifactIndex {
  version: number;
  session_id: string;
  active_plan_id?: string;
  updated_at: string;
  entries: PlanArtifactEntry[];
}

export interface CreatedPlanArtifact {
  index: PlanArtifactIndex;
  entry: PlanArtifactEntry;
  planPath: string;
  sessionPlanDir: string;
}

export interface ActivePlanArtifact {
  index: PlanArtifactIndex;
  entry: PlanArtifactEntry;
  planPath: string;
  content: string;
  sessionPlanDir: string;
}

export interface PlanArtifactEvent {
  at: string;
  event: string;
  session_id: string;
  plan_id?: string;
  source?: "cli" | "bridge" | "system";
  detail?: string;
  status_from?: PlanArtifactStatus;
  status_to?: PlanArtifactStatus;
}

export interface PlanLatestFailureDiagnostic {
  at: string;
  event: string;
  planId?: string;
  detail?: string;
  exitCode?: number;
  policyAction?: "fail" | "degrade";
  policyReason?: string;
  diagnosticCode?: string;
  providerName?: string;
  errorClass?: string;
  reviewBlocked?: boolean;
  findingsCount?: number;
}

export interface PlanLatestVerificationDiagnostic {
  at: string;
  event: "plan_verification_pending" | "plan_verification_passed" | "plan_verification_failed";
  planId?: string;
  detail?: string;
  status: "pending" | "passed" | "failed";
}

export interface PlanReviewFinding {
  code: string;
  section?: string;
  message: string;
}

export interface PlanReviewResult {
  ok: boolean;
  blocked: boolean;
  findings: PlanReviewFinding[];
  checked_at: string;
}

export interface PlanQualitySummary {
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  findingCount: number;
  blocked: boolean;
  recommendation: string;
  rewriteHints: string[];
}

export interface PlanQualityTrendSummary {
  trend: "up" | "down" | "flat" | "none";
  previousPlanId?: string;
  previousScore?: number;
  deltaFromPrevious?: number;
}

export interface PlanQualityGuardSummary {
  level: "healthy" | "watch" | "critical";
  regressionStreak: number;
  reason: string;
}

export type PlanQualityGuardMode = "off" | "warn" | "strict";

export interface PlanQualityRepairAction {
  id: string;
  priority: "p0" | "p1" | "p2";
  title: string;
  command: string;
  rationale: string;
}

export interface PlanQualityBenchmarkCandidate {
  label: string;
  content: string;
  sourcePath?: string;
}

export interface PlanQualityBenchmarkRow {
  rank: number;
  label: string;
  sourcePath?: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  findingCount: number;
  blocked: boolean;
  guardLevel: "healthy" | "watch" | "critical";
  guardReason: string;
  repairActionCount: number;
  topHint: string;
  topRepairAction: string;
}

export interface PlanQualityBenchmarkResult {
  rows: PlanQualityBenchmarkRow[];
  winner: PlanQualityBenchmarkRow;
}

export interface PlanQualityBenchmarkPresetCandidate {
  label: string;
  path: string;
}

export interface PlanQualityBenchmarkPresetResolution {
  preset: "generic" | "core";
  candidates: PlanQualityBenchmarkPresetCandidate[];
  missingLabels: string[];
  policySource: "builtin_default" | "workdir_profile" | "cwd_profile" | "env_path" | "invalid_fallback";
  policyPath?: string;
  policyWarning?: string;
}

export interface PlanQualityBenchmarkEventDetailInput {
  comparedCount: number;
  winnerLabel: string;
  winnerScore: number;
  winnerGrade: "A" | "B" | "C" | "D" | "E";
  winnerTopHint?: string;
  winnerTopRepairAction?: string;
  runnerUpLabel?: string;
  runnerUpScore?: number;
  winnerLeadScore?: number;
  preset?: string;
  guardMode?: PlanQualityGuardMode;
  guardPolicyProfile?: string;
  assertBest?: string;
  assertPassed?: boolean;
  assertActual?: string;
}

export interface PlanQualityBenchmarkHistoryRun {
  at: string;
  planId?: string;
  comparedCount: number;
  winnerLabel: string;
  winnerScore: number;
  winnerGrade: "A" | "B" | "C" | "D" | "E";
  winnerTopHint?: string;
  winnerTopRepairAction?: string;
  runnerUpLabel?: string;
  runnerUpScore?: number;
  winnerLeadScore?: number;
  preset?: string;
  guardMode?: PlanQualityGuardMode;
  guardPolicyProfile?: string;
  assertBest?: string;
  assertPassed?: boolean;
  assertActual?: string;
}

export interface PlanQualityBenchmarkHistorySummary {
  totalRuns: number;
  recentRuns: PlanQualityBenchmarkHistoryRun[];
  latestWinnerLabel?: string;
  latestWinnerScore?: number;
  latestWinnerGrade?: "A" | "B" | "C" | "D" | "E";
  latestWinnerTopHint?: string;
  latestWinnerTopRepairAction?: string;
  latestWinnerLeadScore?: number;
  latestRunAt?: string;
  winnerChangedFromPrevious?: boolean;
  winnerSequence: string[];
  winnerReasonSequence: string[];
  winnerSwitchCount: number;
  scoreTrend: "up" | "down" | "flat" | "none";
  deltaFromPrevious?: number;
  assertCount: number;
  assertPassCount: number;
  assertFailCount: number;
  assertPassRate?: number;
}

export interface PlanQualityBenchmarkSemanticCorrelation {
  level: "none" | "watch" | "high";
  reason: string;
}

export interface PlanQualityBenchmarkHealthSummary {
  score: number;
  level: "good" | "watch" | "risk";
  reason: string;
  components: {
    trend: number;
    stability: number;
    assertion: number;
    semantic: number;
  };
}

export interface PlanQualityBenchmarkRecommendation {
  action: string;
  reason: string;
}

export interface PlanQualityGuardPolicy {
  schema: "plan_quality_guard_policy";
  schema_version: 1;
  profile: string;
  defaults: {
    mode: PlanQualityGuardMode;
  };
  thresholds: {
    critical_score: number;
    watch_score: number;
    severe_drop_delta: number;
    critical_regression_streak: number;
    watch_on_trend_down: boolean;
  };
}

export type PlanQualityGuardPolicySource =
  | "builtin_default"
  | "workdir_profile"
  | "cwd_profile"
  | "env_path"
  | "invalid_fallback";

export interface ResolvedPlanQualityGuardPolicy {
  policy: PlanQualityGuardPolicy;
  source: PlanQualityGuardPolicySource;
  policyPath?: string;
  warning?: string;
}

export interface PlanApprovalResult {
  approved: boolean;
  entry?: PlanArtifactEntry;
  planHash?: string;
  ticketId?: string;
  snapshotPath?: string;
}
