import { relative as relativePath, resolve as resolvePath } from "node:path";
import {
  derivePlanPhaseFromStatus,
  resolvePlanStatusRecommendation,
} from "../../cli/start/plan-state";
import { evaluateLivePlanDecisionSnapshot } from "../../cli/start/plan-mode/live-status";
import {
  evaluatePlanQualityBenchmarkHealth,
  evaluatePlanQualityBenchmarkSemanticCorrelation,
  loadActivePlanArtifact,
  loadLatestPlanFailureDiagnostic,
  loadLatestPlanVerificationDiagnostic,
  loadPlanArtifactIndex,
  loadPlanQualityBenchmarkHistory,
  resolvePlanQualityBenchmarkRecommendation,
  resolvePlanQualityGuardMode,
  resolvePlanQualityGuardPolicy,
} from "../../cli/start/plan-artifact";
import type { BridgePlanPhase, BridgePlanStatus } from "./types";

export function isPlanOnlyStatus(status: BridgePlanStatus): boolean {
  return status !== "applied" && status !== "discarded";
}

function buildPlanBenchmarkHistoryView(
  history: ReturnType<typeof loadPlanQualityBenchmarkHistory>,
): {
  plan_quality_benchmark_total_runs: number;
  plan_quality_benchmark_recent_count?: number;
  plan_quality_benchmark_latest_winner?: string;
  plan_quality_benchmark_latest_score?: number;
  plan_quality_benchmark_latest_grade?: "A" | "B" | "C" | "D" | "E";
  plan_quality_benchmark_latest_top_hint?: string;
  plan_quality_benchmark_latest_top_repair_action?: string;
  plan_quality_benchmark_latest_lead_score?: number;
  plan_quality_benchmark_latest_at?: string;
  plan_quality_benchmark_score_trend?: "up" | "down" | "flat" | "none";
  plan_quality_benchmark_score_delta?: number;
  plan_quality_benchmark_winner_changed?: boolean;
  plan_quality_benchmark_winner_sequence?: string[];
  plan_quality_benchmark_winner_reason_sequence?: string[];
  plan_quality_benchmark_winner_switch_count?: number;
  plan_quality_benchmark_assert_count?: number;
  plan_quality_benchmark_assert_pass_count?: number;
  plan_quality_benchmark_assert_fail_count?: number;
  plan_quality_benchmark_assert_pass_rate?: number;
  plan_quality_benchmark_recent_runs?: Array<{
    at: string;
    plan_id?: string;
    compared_count: number;
    winner_label: string;
    winner_score: number;
    winner_grade: "A" | "B" | "C" | "D" | "E";
    winner_top_hint?: string;
    winner_top_repair_action?: string;
    runner_up_label?: string;
    runner_up_score?: number;
    winner_lead_score?: number;
    preset?: string;
    guard_mode?: "off" | "warn" | "strict";
    guard_policy_profile?: string;
    assert_best?: string;
    assert_passed?: boolean;
    assert_actual?: string;
  }>;
} {
  if (history.totalRuns <= 0) {
    return {
      plan_quality_benchmark_total_runs: 0,
    };
  }
  return {
    plan_quality_benchmark_total_runs: history.totalRuns,
    plan_quality_benchmark_recent_count: history.recentRuns.length,
    plan_quality_benchmark_latest_winner: history.latestWinnerLabel,
    plan_quality_benchmark_latest_score: history.latestWinnerScore,
    plan_quality_benchmark_latest_grade: history.latestWinnerGrade,
    plan_quality_benchmark_latest_top_hint: history.latestWinnerTopHint,
    plan_quality_benchmark_latest_top_repair_action: history.latestWinnerTopRepairAction,
    plan_quality_benchmark_latest_lead_score: history.latestWinnerLeadScore,
    plan_quality_benchmark_latest_at: history.latestRunAt,
    plan_quality_benchmark_score_trend: history.scoreTrend,
    plan_quality_benchmark_score_delta: history.deltaFromPrevious,
    plan_quality_benchmark_winner_changed: history.winnerChangedFromPrevious,
    plan_quality_benchmark_winner_sequence: history.winnerSequence,
    plan_quality_benchmark_winner_reason_sequence: history.winnerReasonSequence,
    plan_quality_benchmark_winner_switch_count: history.winnerSwitchCount,
    plan_quality_benchmark_assert_count: history.assertCount,
    plan_quality_benchmark_assert_pass_count: history.assertPassCount,
    plan_quality_benchmark_assert_fail_count: history.assertFailCount,
    plan_quality_benchmark_assert_pass_rate: history.assertPassRate,
    plan_quality_benchmark_recent_runs: history.recentRuns.map((run) => ({
      at: run.at,
      plan_id: run.planId,
      compared_count: run.comparedCount,
      winner_label: run.winnerLabel,
      winner_score: run.winnerScore,
      winner_grade: run.winnerGrade,
      winner_top_hint: run.winnerTopHint,
      winner_top_repair_action: run.winnerTopRepairAction,
      runner_up_label: run.runnerUpLabel,
      runner_up_score: run.runnerUpScore,
      winner_lead_score: run.winnerLeadScore,
      preset: run.preset,
      guard_mode: run.guardMode,
      guard_policy_profile: run.guardPolicyProfile,
      assert_best: run.assertBest,
      assert_passed: run.assertPassed,
      assert_actual: run.assertActual,
    })),
  };
}

export function currentPlanView(workDir: string, sessionId: string): {
  mode: "normal" | "plan_only";
  active_plan_id?: string;
  active_plan_status?: BridgePlanStatus;
  active_plan_phase?: BridgePlanPhase;
  active_plan_path?: string;
  active_plan_seq?: number;
  active_plan_title?: string;
  active_plan_status_source?: "stored" | "live_snapshot";
  active_plan_stored_status?: BridgePlanStatus;
  active_plan_stored_phase?: BridgePlanPhase;
  active_plan_decision_ready?: boolean;
  active_plan_approval_stale?: boolean;
  active_plan_recommendation_action?: string;
  active_plan_recommendation_reason?: string;
  blocked_count?: number;
  review_fail_count?: number;
  approval_ticket_id?: string;
  approved_hash?: string;
  approved_snapshot_path?: string;
  latest_failure_event?: string;
  latest_failure_at?: string;
  latest_failure_exit_code?: number;
  latest_failure_policy_action?: "fail" | "degrade";
  latest_failure_policy_reason?: string;
  latest_failure_diagnostic_code?: string;
  latest_failure_provider?: string;
  latest_failure_error_class?: string;
  latest_failure_review_blocked?: boolean;
  latest_failure_findings_count?: number;
  latest_verification_event?: string;
  latest_verification_status?: "pending" | "passed" | "failed";
  latest_verification_at?: string;
  plan_quality_score?: number;
  plan_quality_grade?: "A" | "B" | "C" | "D" | "E";
  plan_quality_findings_count?: number;
  plan_quality_blocked?: boolean;
  plan_quality_recommendation?: string;
  plan_quality_rewrite_hints?: string[];
  plan_quality_repair_actions?: Array<{
    id: string;
    priority: "p0" | "p1" | "p2";
    title: string;
    command: string;
    rationale: string;
  }>;
  plan_quality_trend?: "up" | "down" | "flat" | "none";
  plan_quality_previous_plan_id?: string;
  plan_quality_previous_score?: number;
  plan_quality_delta_from_previous?: number;
  plan_quality_guard_mode?: "off" | "warn" | "strict";
  plan_quality_guard_level?: "healthy" | "watch" | "critical";
  plan_quality_regression_streak?: number;
  plan_quality_guard_reason?: string;
  plan_quality_guard_policy_profile?: string;
  plan_quality_guard_policy_source?: string;
  plan_quality_guard_policy_path?: string;
  plan_quality_guard_policy_warning?: string;
  plan_quality_benchmark_total_runs?: number;
  plan_quality_benchmark_recent_count?: number;
  plan_quality_benchmark_latest_winner?: string;
  plan_quality_benchmark_latest_score?: number;
  plan_quality_benchmark_latest_grade?: "A" | "B" | "C" | "D" | "E";
  plan_quality_benchmark_latest_top_hint?: string;
  plan_quality_benchmark_latest_top_repair_action?: string;
  plan_quality_benchmark_latest_lead_score?: number;
  plan_quality_benchmark_latest_at?: string;
  plan_quality_benchmark_score_trend?: "up" | "down" | "flat" | "none";
  plan_quality_benchmark_score_delta?: number;
  plan_quality_benchmark_winner_changed?: boolean;
  plan_quality_benchmark_winner_sequence?: string[];
  plan_quality_benchmark_winner_reason_sequence?: string[];
  plan_quality_benchmark_winner_switch_count?: number;
  plan_quality_benchmark_assert_count?: number;
  plan_quality_benchmark_assert_pass_count?: number;
  plan_quality_benchmark_assert_fail_count?: number;
  plan_quality_benchmark_assert_pass_rate?: number;
  plan_quality_benchmark_semantic_correlation?: "none" | "watch" | "high";
  plan_quality_benchmark_semantic_reason?: string;
  plan_quality_benchmark_health_score?: number;
  plan_quality_benchmark_health_level?: "good" | "watch" | "risk";
  plan_quality_benchmark_health_reason?: string;
  plan_quality_benchmark_health_components?: {
    trend: number;
    stability: number;
    assertion: number;
    semantic: number;
  };
  plan_quality_benchmark_recommended_next_action?: string;
  plan_quality_benchmark_recommendation_reason?: string;
  plan_quality_benchmark_recent_runs?: Array<{
    at: string;
    plan_id?: string;
    compared_count: number;
    winner_label: string;
    winner_score: number;
    winner_grade: "A" | "B" | "C" | "D" | "E";
    winner_top_hint?: string;
    winner_top_repair_action?: string;
    runner_up_label?: string;
    runner_up_score?: number;
    winner_lead_score?: number;
    preset?: string;
    guard_mode?: "off" | "warn" | "strict";
    guard_policy_profile?: string;
    assert_best?: string;
    assert_passed?: boolean;
    assert_actual?: string;
  }>;
  latest_plan_id?: string;
  latest_plan_status?: BridgePlanStatus;
  latest_plan_phase?: BridgePlanPhase;
} {
  const benchmarkHistory = loadPlanQualityBenchmarkHistory(workDir, sessionId, { limit: 3 });
  const benchmarkHistoryView = buildPlanBenchmarkHistoryView(benchmarkHistory);
  const active = loadActivePlanArtifact(workDir, sessionId);
  if (!active || !isPlanOnlyStatus(active.entry.status)) {
    const latest = resolveLatestPlanEntry(workDir, sessionId, [
      "applied",
      "apply_failed",
      "discarded",
    ]);
    if (!latest) {
      const benchmarkSemantic = evaluatePlanQualityBenchmarkSemanticCorrelation({
        history: benchmarkHistory,
      });
      const benchmarkHealth = evaluatePlanQualityBenchmarkHealth({
        history: benchmarkHistory,
        semanticCorrelation: benchmarkSemantic.level,
      });
      const benchmarkRecommendation = resolvePlanQualityBenchmarkRecommendation({
        history: benchmarkHistory,
        semanticCorrelation: benchmarkSemantic.level,
        health: benchmarkHealth,
      });
      return {
        mode: "normal",
        ...benchmarkHistoryView,
        plan_quality_benchmark_semantic_correlation: benchmarkSemantic.level,
        plan_quality_benchmark_semantic_reason: benchmarkSemantic.reason,
        plan_quality_benchmark_health_score: benchmarkHealth.score,
        plan_quality_benchmark_health_level: benchmarkHealth.level,
        plan_quality_benchmark_health_reason: benchmarkHealth.reason,
        plan_quality_benchmark_health_components: benchmarkHealth.components,
        plan_quality_benchmark_recommended_next_action: benchmarkRecommendation.action,
        plan_quality_benchmark_recommendation_reason: benchmarkRecommendation.reason,
      };
    }
    const latestFailure = loadLatestPlanFailureDiagnostic(workDir, sessionId, {
      planId: latest.plan_id,
    });
    const latestVerification = loadLatestPlanVerificationDiagnostic(workDir, sessionId, {
      planId: latest.plan_id,
    });
    const benchmarkSemantic = evaluatePlanQualityBenchmarkSemanticCorrelation({
      latestFailure,
      history: benchmarkHistory,
    });
    const benchmarkHealth = evaluatePlanQualityBenchmarkHealth({
      history: benchmarkHistory,
      semanticCorrelation: benchmarkSemantic.level,
    });
    const benchmarkRecommendation = resolvePlanQualityBenchmarkRecommendation({
      history: benchmarkHistory,
      semanticCorrelation: benchmarkSemantic.level,
      health: benchmarkHealth,
    });
    return {
      mode: "normal",
      ...benchmarkHistoryView,
      latest_plan_id: latest.plan_id,
      latest_plan_status: latest.status,
      latest_plan_phase: derivePlanPhaseFromStatus(latest.status),
      latest_failure_event: latestFailure?.event,
      latest_failure_at: latestFailure?.at,
      latest_failure_exit_code: latestFailure?.exitCode,
      latest_failure_policy_action: latestFailure?.policyAction,
      latest_failure_policy_reason: latestFailure?.policyReason,
      latest_failure_diagnostic_code: latestFailure?.diagnosticCode,
      latest_failure_provider: latestFailure?.providerName,
      latest_failure_error_class: latestFailure?.errorClass,
      latest_failure_review_blocked: latestFailure?.reviewBlocked,
      latest_failure_findings_count: latestFailure?.findingsCount,
      latest_verification_event: latestVerification?.event,
      latest_verification_status: latestVerification?.status,
      latest_verification_at: latestVerification?.at,
      plan_quality_benchmark_semantic_correlation: benchmarkSemantic.level,
      plan_quality_benchmark_semantic_reason: benchmarkSemantic.reason,
      plan_quality_benchmark_health_score: benchmarkHealth.score,
      plan_quality_benchmark_health_level: benchmarkHealth.level,
      plan_quality_benchmark_health_reason: benchmarkHealth.reason,
      plan_quality_benchmark_health_components: benchmarkHealth.components,
      plan_quality_benchmark_recommended_next_action: benchmarkRecommendation.action,
      plan_quality_benchmark_recommendation_reason: benchmarkRecommendation.reason,
    };
  }
  const latestFailure = loadLatestPlanFailureDiagnostic(workDir, sessionId, {
    planId: active.entry.plan_id,
  });
  const latestVerification = loadLatestPlanVerificationDiagnostic(workDir, sessionId, {
    planId: active.entry.plan_id,
  });
  const benchmarkSemantic = evaluatePlanQualityBenchmarkSemanticCorrelation({
    latestFailure,
    history: benchmarkHistory,
  });
  const benchmarkHealth = evaluatePlanQualityBenchmarkHealth({
    history: benchmarkHistory,
    semanticCorrelation: benchmarkSemantic.level,
  });
  const benchmarkRecommendation = resolvePlanQualityBenchmarkRecommendation({
    history: benchmarkHistory,
    semanticCorrelation: benchmarkSemantic.level,
    health: benchmarkHealth,
  });
  const qualityGuardRuntime = resolvePlanQualityGuardPolicy({
    workDir,
  });
  const qualityGuardMode = resolvePlanQualityGuardMode(
    process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
    qualityGuardRuntime.policy.defaults.mode,
  );
  const liveSnapshot = evaluateLivePlanDecisionSnapshot({
    workDir,
    sessionId,
    mode: "plan_only",
    entry: active.entry,
    planContent: active.content,
    latestVerificationStatus: latestVerification?.status,
    guardPolicy: qualityGuardRuntime.policy,
    guardMode: qualityGuardMode,
  });
  return {
    mode: "plan_only",
    ...benchmarkHistoryView,
    active_plan_id: active.entry.plan_id,
    active_plan_status: liveSnapshot.liveStatus,
    active_plan_phase: liveSnapshot.livePhase,
    active_plan_path: active.planPath,
    active_plan_seq: active.entry.seq,
    active_plan_title: active.entry.title,
    active_plan_status_source: liveSnapshot.statusSource,
    active_plan_stored_status: liveSnapshot.storedStatus,
    active_plan_stored_phase: liveSnapshot.storedPhase,
    active_plan_decision_ready: liveSnapshot.decisionReady,
    active_plan_approval_stale: liveSnapshot.approvalStale,
    active_plan_recommendation_action: liveSnapshot.recommendation.action,
    active_plan_recommendation_reason: liveSnapshot.recommendation.reason,
    blocked_count: active.entry.blocked_count,
    review_fail_count: active.entry.review_fail_count,
    approval_ticket_id: active.entry.approval_ticket_id,
    approved_hash: active.entry.approved_hash,
    approved_snapshot_path: active.entry.approved_snapshot_path,
    latest_failure_event: latestFailure?.event,
    latest_failure_at: latestFailure?.at,
    latest_failure_exit_code: latestFailure?.exitCode,
    latest_failure_policy_action: latestFailure?.policyAction,
    latest_failure_policy_reason: latestFailure?.policyReason,
    latest_failure_diagnostic_code: latestFailure?.diagnosticCode,
    latest_failure_provider: latestFailure?.providerName,
    latest_failure_error_class: latestFailure?.errorClass,
    latest_failure_review_blocked: latestFailure?.reviewBlocked,
    latest_failure_findings_count: latestFailure?.findingsCount,
    latest_verification_event: latestVerification?.event,
    latest_verification_status: latestVerification?.status,
    latest_verification_at: latestVerification?.at,
    plan_quality_score: liveSnapshot.quality.score,
    plan_quality_grade: liveSnapshot.quality.grade,
    plan_quality_findings_count: liveSnapshot.quality.findingCount,
    plan_quality_blocked: liveSnapshot.quality.blocked,
    plan_quality_recommendation: liveSnapshot.quality.recommendation,
    plan_quality_rewrite_hints: liveSnapshot.quality.rewriteHints,
    plan_quality_repair_actions: liveSnapshot.repairActions,
    plan_quality_trend: liveSnapshot.qualityTrend.trend,
    plan_quality_previous_plan_id: liveSnapshot.qualityTrend.previousPlanId,
    plan_quality_previous_score: liveSnapshot.qualityTrend.previousScore,
    plan_quality_delta_from_previous: liveSnapshot.qualityTrend.deltaFromPrevious,
    plan_quality_guard_mode: liveSnapshot.qualityGuardMode,
    plan_quality_guard_level: liveSnapshot.qualityGuard.level,
    plan_quality_regression_streak: liveSnapshot.qualityGuard.regressionStreak,
    plan_quality_guard_reason: liveSnapshot.qualityGuard.reason,
    plan_quality_guard_policy_profile: qualityGuardRuntime.policy.profile,
    plan_quality_guard_policy_source: qualityGuardRuntime.source,
    plan_quality_guard_policy_path: qualityGuardRuntime.policyPath,
    plan_quality_guard_policy_warning: qualityGuardRuntime.warning,
    plan_quality_benchmark_semantic_correlation: benchmarkSemantic.level,
    plan_quality_benchmark_semantic_reason: benchmarkSemantic.reason,
    plan_quality_benchmark_health_score: benchmarkHealth.score,
    plan_quality_benchmark_health_level: benchmarkHealth.level,
    plan_quality_benchmark_health_reason: benchmarkHealth.reason,
    plan_quality_benchmark_health_components: benchmarkHealth.components,
    plan_quality_benchmark_recommended_next_action: benchmarkRecommendation.action,
    plan_quality_benchmark_recommendation_reason: benchmarkRecommendation.reason,
  };
}

export function resolvePlanRecommendation(plan: ReturnType<typeof currentPlanView>): {
  action: string;
  reason: string;
} {
  if (
    typeof plan.active_plan_recommendation_action === "string"
    && plan.active_plan_recommendation_action.trim().length > 0
    && typeof plan.active_plan_recommendation_reason === "string"
    && plan.active_plan_recommendation_reason.trim().length > 0
  ) {
    return {
      action: plan.active_plan_recommendation_action.trim(),
      reason: plan.active_plan_recommendation_reason.trim(),
    };
  }
  const firstRepairAction = Array.isArray(plan.plan_quality_repair_actions) && plan.plan_quality_repair_actions.length > 0
    ? plan.plan_quality_repair_actions[0]
    : undefined;
  return resolvePlanStatusRecommendation({
    mode: plan.mode,
    status: (plan.active_plan_status ?? plan.latest_plan_status) as BridgePlanStatus | undefined,
    latestVerificationStatus: plan.latest_verification_status,
    planQualityScore: plan.plan_quality_score,
    planQualityTopHint: firstRepairAction?.title
      ?? (Array.isArray(plan.plan_quality_rewrite_hints) ? plan.plan_quality_rewrite_hints[0] : undefined),
    planQualityGuardLevel: plan.plan_quality_guard_level,
    planQualityGuardReason: plan.plan_quality_guard_reason,
    interactiveMenuFirst: false,
  });
}

export function formatBridgePlanPath(input: {
  workDir: string;
  planPath?: string;
}): string | undefined {
  const rawPath = input.planPath?.trim();
  if (!rawPath) {
    return undefined;
  }
  const resolvedPlanPath = resolvePath(rawPath);
  const relativePlanPath = relativePath(input.workDir, resolvedPlanPath);
  if (relativePlanPath && !relativePlanPath.startsWith("..") && !relativePlanPath.startsWith("/")) {
    return relativePlanPath;
  }
  return rawPath;
}

export function resolveLatestPlanEntry(
  workDir: string,
  sessionId: string,
  statuses?: readonly BridgePlanStatus[],
) {
  const index = loadPlanArtifactIndex(workDir, sessionId);
  const matcher = Array.isArray(statuses) && statuses.length > 0
    ? new Set(statuses)
    : undefined;
  const sorted = [...index.entries].sort((left, right) => {
    if (left.seq !== right.seq) {
      return right.seq - left.seq;
    }
    return right.updated_at.localeCompare(left.updated_at);
  });
  for (const entry of sorted) {
    if (!matcher || matcher.has(entry.status)) {
      return entry;
    }
  }
  return undefined;
}
