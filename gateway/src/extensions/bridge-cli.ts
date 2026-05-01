import { readFileSync } from "node:fs";
import { relative as relativePath, resolve as resolvePath } from "node:path";
import { runGatewayTurn } from "../orchestration/main";
import { MigrationOptions, SessionKeyParts } from "../models/types";
import {
  isNaturalPlanExecutionIntent,
  parsePlanCommand,
} from "../orchestration/entrypoints/dev-cli/start/plan-command";
import {
  derivePlanPhaseFromStatus,
  PLAN_EXECUTION_REPLY,
  resolvePlanStatusRecommendation,
  type PlanLifecycleStatus,
  type SessionPlanPhase,
} from "../orchestration/entrypoints/dev-cli/start/plan-state";
import { evaluateLivePlanDecisionSnapshot } from "../orchestration/entrypoints/dev-cli/start/plan-live-status";
import { resolveBridgeApplyFailurePolicy } from "./bridge-plan-failure-policy";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  approvePlanArtifact,
  buildPlanQualityRepairActions,
  buildPlanApplyPrompt,
  createPlanArtifact,
  evaluatePlanQualityBenchmarkHealth,
  evaluatePlanQualityBenchmarkSemanticCorrelation,
  evaluatePlanQualityGuard,
  evaluatePlanQuality,
  evaluatePlanQualityTrend,
  loadActivePlanArtifact,
  loadLatestPlanFailureDiagnostic,
  loadPlanQualityBenchmarkHistory,
  loadLatestPlanVerificationDiagnostic,
  loadPlanArtifactIndex,
  resolvePlanQualityBenchmarkRecommendation,
  recoverStaleApprovedPlan,
  recordPlanReviewResult,
  resolvePlanQualityGuardPolicy,
  resolvePlanQualityGuardMode,
  reviewPlanContent,
  updatePlanArtifactStatus,
} from "../orchestration/entrypoints/dev-cli/start/plan-artifact";
import { removeTrailingSlashes } from "../orchestration/entrypoints/dev-cli/services/runtime-paths";

const PLAN_GUARD_CODE = "PLAN_GUARD_DENIED";
const PLAN_ERROR_NO_ACTIVE = "PLAN_NO_ACTIVE";
const PLAN_ERROR_APPLY_BLOCKED = "PLAN_APPLY_STATUS_BLOCKED";
const PLAN_ERROR_REVIEW_PLAN_NOT_FOUND = "PLAN_REVIEW_PLAN_NOT_FOUND";
const PLAN_ERROR_REVIEW_FAILED = "PLAN_REVIEW_FAILED";
const PLAN_ERROR_REVIEW_BLOCKED = "PLAN_REVIEW_BLOCKED";
const PLAN_ERROR_QUALITY_GUARD_BLOCKED = "PLAN_QUALITY_GUARD_BLOCKED";
const PLAN_ERROR_APPROVAL_FAILED = "PLAN_APPROVAL_FAILED";
const PLAN_ERROR_SET_APPLYING_FAILED = "PLAN_SET_APPLYING_FAILED";
const PLAN_ERROR_APPLY_EXEC_FAILED = "PLAN_APPLY_EXEC_FAILED";
const PLAN_ERROR_APPEND_NOTE_FAILED = "PLAN_APPEND_NOTE_FAILED";
const BRIDGE_FATAL_ERROR = "BRIDGE_FATAL";

type BridgePlanStatus = PlanLifecycleStatus;
type BridgePlanPhase = SessionPlanPhase;

interface BridgeInput {
  userMessage: string;
  session: SessionKeyParts;
  context: {
    actorId: string;
    projectId: string;
  };
  workDir?: string;
  migration?: Partial<MigrationOptions>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJsonInput(raw: string): BridgeInput {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error("bridge input must be an object");
  }
  if (!isString(parsed.userMessage)) {
    throw new Error("userMessage is required");
  }
  if (!isObject(parsed.session)) {
    throw new Error("session is required");
  }
  if (!isObject(parsed.context)) {
    throw new Error("context is required");
  }
  const platform = parsed.session.platform;
  const tenant = parsed.session.tenant;
  const scope = parsed.session.scope;
  const subject = parsed.session.subject;
  if (platform !== "feishu" && platform !== "telegram") {
    throw new Error("session.platform must be feishu or telegram");
  }
  if (scope !== "dm" && scope !== "group") {
    throw new Error("session.scope must be dm or group");
  }
  if (!isString(tenant) || !isString(subject)) {
    throw new Error("session.tenant and session.subject are required");
  }
  if (!isString(parsed.context.actorId) || !isString(parsed.context.projectId)) {
    throw new Error("context.actorId and context.projectId are required");
  }
  const migration = isObject(parsed.migration) ? (parsed.migration as Partial<MigrationOptions>) : undefined;
  const workDir = isString(parsed.workDir) ? parsed.workDir.trim() : undefined;
  return {
    userMessage: parsed.userMessage,
    session: {
      platform,
      tenant,
      scope,
      subject,
    },
    context: {
      actorId: parsed.context.actorId,
      projectId: parsed.context.projectId,
    },
    workDir,
    migration,
  };
}

function resolvePlanSessionId(session: SessionKeyParts): string {
  return `${session.platform}:${session.tenant}:${session.scope}:${session.subject}`;
}

function resolveWorkDir(input: BridgeInput): string {
  if (input.workDir && input.workDir.trim().length > 0) {
    return removeTrailingSlashes(input.workDir.trim());
  }
  return removeTrailingSlashes(process.cwd());
}

function isPlanOnlyStatus(status: BridgePlanStatus): boolean {
  return status !== "applied" && status !== "discarded";
}

function isPlanSlashCommand(message: string): boolean {
  return /^\/plan(?:\s|$)/.test(message.trim());
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

function currentPlanView(workDir: string, sessionId: string): {
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

function resolvePlanRecommendation(plan: ReturnType<typeof currentPlanView>): {
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
    status: (plan.active_plan_status ?? plan.latest_plan_status) as PlanLifecycleStatus | undefined,
    latestVerificationStatus: plan.latest_verification_status,
    planQualityScore: plan.plan_quality_score,
    planQualityTopHint: firstRepairAction?.title
      ?? (Array.isArray(plan.plan_quality_rewrite_hints) ? plan.plan_quality_rewrite_hints[0] : undefined),
    planQualityGuardLevel: plan.plan_quality_guard_level,
    planQualityGuardReason: plan.plan_quality_guard_reason,
    interactiveMenuFirst: false,
  });
}

function formatBridgePlanPath(input: {
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

function humanizeBridgePlanStatus(status: BridgePlanStatus | undefined): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "blocked":
      return "被阻止";
    case "review_failed":
      return "需继续完善";
    case "ready":
      return "待确认";
    case "approved":
      return "已确认";
    case "applying":
      return "执行中";
    case "apply_failed":
      return "执行失败";
    case "applied":
      return "已执行";
    case "discarded":
      return "已丢弃";
    default:
      return "未开始";
  }
}

function humanizeBridgePlanPhase(phase: BridgePlanPhase | undefined): string {
  switch (phase) {
    case "drafting":
      return "规划中";
    case "awaiting_decision":
      return "待确认";
    case "applying":
      return "执行中";
    default:
      return "未开始";
  }
}

function humanizeBridgePlanFailure(event: string | undefined): string | undefined {
  switch (event) {
    case "plan_apply_failed":
      return "计划执行失败";
    case "plan_review_failed":
      return "计划评审未通过";
    case "plan_review_blocked":
      return "计划评审被阻止";
    default:
      return event ? "最近一次计划流程失败" : undefined;
  }
}

function buildBridgePlanEnteredMessage(input: {
  goal?: string;
  planPath?: string;
  workDir: string;
}): string {
  const lines = [
    "● 已进入 plan mode",
  ];
  const goal = input.goal?.trim();
  if (goal) {
    lines.push(`  目标: ${goal}`);
  }
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  if (displayPath) {
    lines.push(`  计划文件: ${displayPath}`);
  }
  lines.push(
    "  Grobot 正在探索并设计实现方案。",
    "  确认计划前，plan mode 只会读取和规划。",
    "",
    "直接输入补充内容继续完善，或发送 /plan open 查看计划。",
    `确认后回复“${PLAN_EXECUTION_REPLY}”即可执行。`,
  );
  return lines.join("\n");
}

function buildBridgePlanStatusMessage(input: {
  plan: ReturnType<typeof currentPlanView>;
  workDir: string;
  nextAction: {
    action: string;
    reason: string;
  };
}): string {
  const { plan, nextAction } = input;
  const lines: string[] = [];
  if (plan.mode !== "plan_only") {
    if (!plan.latest_plan_status && !plan.latest_failure_event) {
      return [
        "● 当前没有活跃计划",
        "  使用 /plan <goal> 开始规划。",
        "",
        `下一步: ${nextAction.action}`,
      ].join("\n");
    }
    lines.push("● 最近计划状态");
    lines.push(`  状态: ${humanizeBridgePlanStatus(plan.latest_plan_status)}`);
    const latestFailure = humanizeBridgePlanFailure(plan.latest_failure_event);
    if (latestFailure) {
      lines.push(`  最近失败: ${latestFailure}`);
    }
    if (plan.latest_verification_status) {
      lines.push(`  验证: ${humanizeBridgeVerificationStatus(plan.latest_verification_status)}`);
    }
    lines.push("", `下一步: ${nextAction.action}`);
    return lines.join("\n");
  }

  lines.push("● 当前计划");
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: plan.active_plan_path,
  });
  if (displayPath) {
    lines.push(`  计划文件: ${displayPath}`);
  }
  if (plan.active_plan_title) {
    lines.push(`  标题: ${plan.active_plan_title}`);
  }
  lines.push(
    `  状态: ${humanizeBridgePlanStatus(plan.active_plan_status)}`,
    `  阶段: ${humanizeBridgePlanPhase(plan.active_plan_phase)}`,
  );
  if (typeof plan.plan_quality_score === "number") {
    lines.push(`  计划质量: ${String(plan.plan_quality_score)}/${plan.plan_quality_grade ?? "未评级"}`);
  }
  const latestFailure = humanizeBridgePlanFailure(plan.latest_failure_event);
  if (latestFailure) {
    lines.push(`  最近失败: ${latestFailure}`);
  }
  if (plan.latest_verification_status) {
    lines.push(`  验证: ${humanizeBridgeVerificationStatus(plan.latest_verification_status)}`);
  }
  lines.push(
    "",
    `下一步: ${nextAction.action}`,
    "直接输入补充内容继续完善，或发送 /plan open 查看计划。",
  );
  return lines.join("\n");
}

function humanizeBridgeVerificationStatus(status: "pending" | "passed" | "failed"): string {
  switch (status) {
    case "passed":
      return "已通过";
    case "failed":
      return "未通过";
    case "pending":
    default:
      return "待验证";
  }
}

function buildBridgePlanApplyInProgressMessage(): string {
  return [
    "● 计划正在执行中",
    "  请等待当前执行完成；需要停止时发送 /interrupt。",
  ].join("\n");
}

function buildBridgePlanRecoveredLockMessage(reportMessage: string): string {
  const normalizedReport = reportMessage.trim();
  const header = [
    "● 已恢复计划执行锁",
    "  上次执行锁已过期，已安全恢复。",
  ].join("\n");
  return normalizedReport ? `${header}\n\n${normalizedReport}` : header;
}

function buildBridgePlanGuardDeniedMessage(input: {
  workDir: string;
  planPath?: string;
}): string {
  const lines = [
    "● 已补充到当前计划",
  ];
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  if (displayPath) {
    lines.push(`  计划文件: ${displayPath}`);
  }
  lines.push(
    "  plan mode 仍在规划阶段，未执行代码。",
    "",
    `继续输入补充内容完善计划；确认后回复“${PLAN_EXECUTION_REPLY}”即可执行。`,
  );
  return lines.join("\n");
}

function buildBridgeUnsupportedPlanCommandMessage(): string {
  return [
    "● 不支持这个 /plan 子命令",
    "  可用: /plan、/plan <goal>、/plan open。",
  ].join("\n");
}

function buildPlanStatusPayload(workDir: string, sessionId: string): Record<string, unknown> {
  const plan = currentPlanView(workDir, sessionId);
  const nextAction = resolvePlanRecommendation(plan);
  return {
    status: "ok",
    assistant_message: buildBridgePlanStatusMessage({
      plan,
      workDir,
      nextAction,
    }),
    recommended_next_action: nextAction.action,
    recommendation_reason: nextAction.reason,
    report: null,
    plan,
  };
}

function formatReviewFindings(findings: readonly { code: string; section?: string; message: string }[]): string {
  if (findings.length === 0) {
    return "none";
  }
  return findings
    .map((item) => `${item.code}:${item.section ?? "global"}:${item.message}`)
    .join(" | ");
}

function resolveLatestPlanEntry(
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

function readApprovedPlanContent(snapshotPath: string | undefined, fallback: string): string {
  if (!snapshotPath) {
    return fallback;
  }
  try {
    const snapshot = readFileSync(snapshotPath, "utf8");
    if (snapshot.trim().length > 0) {
      return snapshot;
    }
  } catch {
    // fallback to active content when snapshot is unavailable.
  }
  return fallback;
}

async function main(): Promise<number> {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) {
    process.stderr.write("bridge input is empty\n");
    return 1;
  }
  try {
    const input = parseJsonInput(raw);
    const workDir = resolveWorkDir(input);
    const sessionId = resolvePlanSessionId(input.session);
    const rawMessage = input.userMessage.trim();

    const applyActivePlan = async (
      activeInitial: NonNullable<ReturnType<typeof loadActivePlanArtifact>>,
      extra: string,
      source: "bridge",
    ): Promise<{ code: number; payload: Record<string, unknown> }> => {
      const recovered = recoverStaleApprovedPlan(workDir, sessionId, {
        source,
        expectedPlanId: activeInitial.entry.plan_id,
      });
      const active = recovered.recovered ? loadActivePlanArtifact(workDir, sessionId) : activeInitial;
      if (!active) {
        return {
          code: 1,
          payload: {
            status: "error",
            error_code: PLAN_ERROR_NO_ACTIVE,
            detail: "no active plan to apply",
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
      if (active.entry.status === "applying") {
        appendPlanEvent(workDir, sessionId, {
          event: "plan_apply_idempotent_hit",
          plan_id: active.entry.plan_id,
          source,
          detail: "status=applying",
        });
        return {
          code: 0,
          payload: {
            status: "ok",
            assistant_message: buildBridgePlanApplyInProgressMessage(),
            report: null,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
      if (active.entry.status === "applied" || active.entry.status === "discarded") {
        return {
          code: 1,
          payload: {
            status: "error",
            error_code: PLAN_ERROR_APPLY_BLOCKED,
            detail: `apply blocked by status=${active.entry.status}`,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
      const quality = evaluatePlanQuality(active.content);
      const qualityTrend = evaluatePlanQualityTrend({
        workDir,
        sessionId,
        currentPlanId: active.entry.plan_id,
        currentScore: quality.score,
      });
      const qualityGuardRuntime = resolvePlanQualityGuardPolicy({
        workDir,
      });
      const qualityGuard = evaluatePlanQualityGuard({
        workDir,
        sessionId,
        currentPlanId: active.entry.plan_id,
        quality,
        trend: qualityTrend,
        policy: qualityGuardRuntime.policy,
      });
      const qualityGuardMode = resolvePlanQualityGuardMode(
        process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
        qualityGuardRuntime.policy.defaults.mode,
      );
      if (qualityGuardMode === "strict" && qualityGuard.level === "critical") {
        appendPlanEvent(workDir, sessionId, {
          event: "plan_apply_blocked",
          plan_id: active.entry.plan_id,
          source,
          detail: [
            "reason=quality_guard_critical",
            `guard_mode=${qualityGuardMode}`,
            `guard_profile=${qualityGuardRuntime.policy.profile}`,
            `guard_source=${qualityGuardRuntime.source}`,
            `guard_level=${qualityGuard.level}`,
            `guard_reason=${qualityGuard.reason.replace(/\s+/g, "_")}`,
          ].join(" "),
        });
        return {
          code: 2,
          payload: {
            status: "error",
            error_code: PLAN_ERROR_QUALITY_GUARD_BLOCKED,
            detail: `apply blocked by quality guard: mode=${qualityGuardMode} level=${qualityGuard.level} reason=${qualityGuard.reason}`,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
      let approvedHash = active.entry.approved_hash;
      let approvalTicketId = active.entry.approval_ticket_id;
      let approvedSnapshotPath = active.entry.approved_snapshot_path;
      const shouldReviewAndApprove = active.entry.status !== "approved"
        || !approvedHash
        || !approvalTicketId;
      if (shouldReviewAndApprove) {
        const review = reviewPlanContent(active.content);
        const reviewedEntry = recordPlanReviewResult(
          workDir,
          sessionId,
          active.entry.plan_id,
          review,
          source,
        );
        if (!reviewedEntry) {
          return {
            code: 1,
            payload: {
              status: "error",
              error_code: PLAN_ERROR_REVIEW_PLAN_NOT_FOUND,
              detail: `review failed, plan not found: ${active.entry.plan_id}`,
              plan: currentPlanView(workDir, sessionId),
            },
          };
        }
        if (!review.ok) {
          return {
            code: 2,
            payload: {
              status: "error",
              error_code: review.blocked ? PLAN_ERROR_REVIEW_BLOCKED : PLAN_ERROR_REVIEW_FAILED,
              detail: `[plan-review] blocked=${review.blocked ? "yes" : "no"} findings=${formatReviewFindings(review.findings)}`,
              review_blocked: review.blocked,
              review_findings: review.findings.map((item) => ({
                code: item.code,
                section: item.section,
                message: item.message,
              })),
              plan: currentPlanView(workDir, sessionId),
            },
          };
        }

        const approval = approvePlanArtifact(workDir, sessionId, active.entry.plan_id, {
          approvedBy: source,
          source,
        });
        if (!approval.approved || !approval.entry || !approval.planHash || !approval.ticketId) {
          return {
            code: 1,
            payload: {
              status: "error",
              error_code: PLAN_ERROR_APPROVAL_FAILED,
              detail: `approval failed plan_id=${active.entry.plan_id}`,
              plan: currentPlanView(workDir, sessionId),
            },
          };
        }
        approvedHash = approval.planHash;
        approvalTicketId = approval.ticketId;
        approvedSnapshotPath = approval.snapshotPath;
      }

      const applying = updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "applying");
      if (!applying) {
        return {
          code: 1,
          payload: {
            status: "error",
            error_code: PLAN_ERROR_SET_APPLYING_FAILED,
            detail: `failed to set applying status for ${active.entry.plan_id}`,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }

      try {
        if (!approvedHash || !approvalTicketId) {
          return {
            code: 1,
            payload: {
              status: "error",
              error_code: PLAN_ERROR_APPROVAL_FAILED,
              detail: `approval metadata missing plan_id=${active.entry.plan_id}`,
              plan: currentPlanView(workDir, sessionId),
            },
          };
        }
        const approvedPlanContent = readApprovedPlanContent(approvedSnapshotPath, active.content);
        const report = await runGatewayTurn(
          buildPlanApplyPrompt({
            approvedPlanContent,
            approvedHash,
            ticketId: approvalTicketId,
            extra,
          }),
          input.session,
          input.context,
          input.migration,
        );
        updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "applied");
        appendPlanEvent(workDir, sessionId, {
          event: "plan_apply_succeeded",
          plan_id: active.entry.plan_id,
          source,
          detail: "plan applied and exited plan_only",
        });
        appendPlanEvent(workDir, sessionId, {
          event: "plan_verification_pending",
          plan_id: active.entry.plan_id,
          source,
          detail: "verification_status=pending",
        });
        return {
          code: 0,
          payload: {
            status: "ok",
            assistant_message: recovered.recovered
              ? buildBridgePlanRecoveredLockMessage(report.assistantMessage)
              : report.assistantMessage,
            report,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      } catch (error) {
        updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "apply_failed");
        const detail = error instanceof Error ? error.message : String(error);
        const failurePolicy = resolveBridgeApplyFailurePolicy(detail);
        appendPlanEvent(workDir, sessionId, {
          event: "plan_apply_failed",
          plan_id: active.entry.plan_id,
          source,
          detail: [
            detail,
            `policy_action=${failurePolicy.policyAction}`,
            `policy_reason=${failurePolicy.policyReason}`,
            `diagnostic_code=${failurePolicy.diagnosticCode}`,
            failurePolicy.providerName ? `provider=${failurePolicy.providerName}` : "",
            failurePolicy.errorClass ? `class=${failurePolicy.errorClass}` : "",
          ]
            .filter((item) => item.length > 0)
            .join(" "),
        });
        return {
          code: 1,
          payload: {
            status: "error",
            error_code: PLAN_ERROR_APPLY_EXEC_FAILED,
            detail,
            policy_action: failurePolicy.policyAction,
            policy_reason: failurePolicy.policyReason,
            diagnostic_code: failurePolicy.diagnosticCode,
            error_class: failurePolicy.errorClass,
            provider: failurePolicy.providerName,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
    };

    if (isPlanSlashCommand(rawMessage)) {
      const parsed = parsePlanCommand(rawMessage);
      if (parsed.kind === "invalid") {
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: parsed.reason,
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "enter") {
        const created = createPlanArtifact(workDir, sessionId, parsed.goal);
        appendPlanEvent(workDir, sessionId, {
          event: "plan_mode_entered",
          plan_id: created.entry.plan_id,
          source: "bridge",
          detail: "entered plan_only mode",
        });
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: buildBridgePlanEnteredMessage({
              goal: parsed.goal,
              planPath: created.planPath,
              workDir,
            }),
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "enter_mode") {
        const active = loadActivePlanArtifact(workDir, sessionId);
        if (active && isPlanOnlyStatus(active.entry.status)) {
          process.stdout.write(`${JSON.stringify(buildPlanStatusPayload(workDir, sessionId))}\n`);
          return 0;
        }
        const created = createPlanArtifact(workDir, sessionId, "plan session");
        appendPlanEvent(workDir, sessionId, {
          event: "plan_mode_entered",
          plan_id: created.entry.plan_id,
          source: "bridge",
          detail: "entered plan_only mode",
        });
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: buildBridgePlanEnteredMessage({
              planPath: created.planPath,
              workDir,
            }),
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "open") {
        process.stdout.write(`${JSON.stringify(buildPlanStatusPayload(workDir, sessionId))}\n`);
        return 0;
      }
      process.stdout.write(
        `${JSON.stringify({
          status: "ok",
          assistant_message: buildBridgeUnsupportedPlanCommandMessage(),
          report: null,
          plan: currentPlanView(workDir, sessionId),
        })}\n`,
      );
      return 0;
    }

    const activeDraft = loadActivePlanArtifact(workDir, sessionId);
    if (activeDraft && isPlanOnlyStatus(activeDraft.entry.status)) {
      if (isNaturalPlanExecutionIntent(rawMessage)) {
        const applyResult = await applyActivePlan(activeDraft, rawMessage, "bridge");
        process.stdout.write(`${JSON.stringify(applyResult.payload)}\n`);
        return applyResult.code;
      }
      let appended: ReturnType<typeof appendPlanProgressNote>;
      try {
        appended = appendPlanProgressNote(
          workDir,
          sessionId,
          activeDraft.entry.plan_id,
          rawMessage,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stdout.write(
          `${JSON.stringify({
            status: "error",
            error_code: PLAN_ERROR_APPEND_NOTE_FAILED,
            detail: `append plan note failed: ${detail}`,
            guard_code: PLAN_GUARD_CODE,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 1;
      }
      if (!appended.updated) {
        process.stdout.write(
          `${JSON.stringify({
            status: "error",
            error_code: PLAN_ERROR_APPEND_NOTE_FAILED,
            detail: "failed to append plan note",
            guard_code: PLAN_GUARD_CODE,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 1;
      }
      appendPlanEvent(workDir, sessionId, {
        event: "plan_guard_denied",
        plan_id: activeDraft.entry.plan_id,
        source: "bridge",
        detail: "plan_only blocked normal execution and appended note",
      });
      process.stdout.write(
        `${JSON.stringify({
          status: "ok",
          assistant_message: buildBridgePlanGuardDeniedMessage({
            workDir,
            planPath: appended.planPath ?? activeDraft.planPath,
          }),
          report: null,
          error_code: PLAN_GUARD_CODE,
          guard_code: PLAN_GUARD_CODE,
          plan: currentPlanView(workDir, sessionId),
        })}\n`,
      );
      return 0;
    }

    const report = await runGatewayTurn(
      input.userMessage,
      input.session,
      input.context,
      input.migration,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          assistant_message: report.assistantMessage,
          report,
          plan: currentPlanView(workDir, sessionId),
        },
        null,
        0,
      )}\n`,
    );
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ status: "error", error_code: BRIDGE_FATAL_ERROR, detail })}\n`);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
