import { readFileSync } from "node:fs";
import {
  buildPlanQualityRepairActions,
  evaluatePlanQuality,
  evaluatePlanQualityBenchmarkHealth,
  evaluatePlanQualityBenchmarkSemanticCorrelation,
  evaluatePlanQualityGuard,
  evaluatePlanQualityTrend,
  loadActivePlanArtifact,
  loadLatestPlanFailureDiagnostic,
  loadLatestPlanVerificationDiagnostic,
  loadPlanArtifactIndex,
  loadPlanQualityBenchmarkHistory,
  resolvePlanQualityBenchmarkRecommendation,
  resolvePlanQualityGuardMode,
  resolvePlanQualityGuardPolicy,
  type PlanArtifactEntry,
  type PlanQualityBenchmarkHistorySummary,
} from "../plan-artifact";
import {
  resolvePlanStatusRecommendation,
  resolvePlanStatusRecommendationCommand,
  resolvePlanStatusRecommendationLabel,
} from "../plan-state";
import type { RunStartRuntimeState } from "../runtime-state";
import { evaluateLivePlanDecisionSnapshot } from "./live-status";
import { isEnvTruthy } from "./env";
import {
  buildCurrentPlanDisplay,
  buildPlanDraftStatusDisplay,
  buildPlanStatusPreviewLines,
} from "./plan-preview";
import { buildPlanMeta, humanizePlanStatus } from "./meta";
import { resolvePlanEditorDisplayName } from "./path";
import { renderPlanSurface } from "./info-surface";

interface ShowPlanStatusInput {
  workDir: string;
  runtimeState: Pick<RunStartRuntimeState, "getPlanMode" | "getPlanMeta" | "getSessionKey">;
  writeStdout(message: string): void;
}

function resolveQualityGuardRuntime(workDir: string) {
  const policyResolved = resolvePlanQualityGuardPolicy({
    workDir,
  });
  const guardMode = resolvePlanQualityGuardMode(
    process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
    policyResolved.policy.defaults.mode,
  );
  return {
    ...policyResolved,
    guardMode,
  };
}

function resolveActivePlan(workDir: string, sessionId: string) {
  return loadActivePlanArtifact(workDir, sessionId);
}

function resolveLatestPlanEntry(
  workDir: string,
  sessionId: string,
  statuses?: readonly string[],
): PlanArtifactEntry | undefined {
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

function writeBenchmarkHistoryStatus(input: {
  workDir: string;
  sessionId: string;
  writeStdout(message: string): void;
}): PlanQualityBenchmarkHistorySummary {
  const history = loadPlanQualityBenchmarkHistory(input.workDir, input.sessionId, {
    limit: 3,
  });
  input.writeStdout(`plan_quality_benchmark_total_runs: ${String(history.totalRuns)}\n`);
  if (history.totalRuns <= 0) {
    return history;
  }
  input.writeStdout(`plan_quality_benchmark_recent_count: ${String(history.recentRuns.length)}\n`);
  if (history.latestWinnerLabel) {
    input.writeStdout(`plan_quality_benchmark_latest_winner: ${history.latestWinnerLabel}\n`);
  }
  if (typeof history.latestWinnerScore === "number") {
    input.writeStdout(`plan_quality_benchmark_latest_score: ${String(history.latestWinnerScore)}\n`);
  }
  if (history.latestWinnerGrade) {
    input.writeStdout(`plan_quality_benchmark_latest_grade: ${history.latestWinnerGrade}\n`);
  }
  input.writeStdout(
    `plan_quality_benchmark_latest_top_hint: ${history.latestWinnerTopHint ?? "no_hint_available"}\n`,
  );
  if (history.latestWinnerTopRepairAction) {
    input.writeStdout(`plan_quality_benchmark_latest_top_repair_action: ${history.latestWinnerTopRepairAction}\n`);
  }
  if (typeof history.latestWinnerLeadScore === "number") {
    input.writeStdout(`plan_quality_benchmark_latest_lead_score: ${String(history.latestWinnerLeadScore)}\n`);
  }
  if (history.latestRunAt) {
    input.writeStdout(`plan_quality_benchmark_latest_at: ${history.latestRunAt}\n`);
  }
  input.writeStdout(`plan_quality_benchmark_score_trend: ${history.scoreTrend}\n`);
  if (typeof history.deltaFromPrevious === "number") {
    input.writeStdout(`plan_quality_benchmark_score_delta: ${String(history.deltaFromPrevious)}\n`);
  }
  if (typeof history.winnerChangedFromPrevious === "boolean") {
    input.writeStdout(
      `plan_quality_benchmark_winner_changed: ${history.winnerChangedFromPrevious ? "yes" : "no"}\n`,
    );
  }
  if (history.winnerSequence.length > 0) {
    input.writeStdout(`plan_quality_benchmark_winner_sequence: ${history.winnerSequence.join(" -> ")}\n`);
  }
  if (history.winnerReasonSequence.length > 0) {
    input.writeStdout(`plan_quality_benchmark_winner_reason_sequence: ${history.winnerReasonSequence.join(" -> ")}\n`);
  }
  input.writeStdout(`plan_quality_benchmark_winner_switch_count: ${String(history.winnerSwitchCount)}\n`);
  input.writeStdout(`plan_quality_benchmark_assert_count: ${String(history.assertCount)}\n`);
  input.writeStdout(`plan_quality_benchmark_assert_pass_count: ${String(history.assertPassCount)}\n`);
  input.writeStdout(`plan_quality_benchmark_assert_fail_count: ${String(history.assertFailCount)}\n`);
  if (typeof history.assertPassRate === "number") {
    input.writeStdout(`plan_quality_benchmark_assert_pass_rate: ${String(history.assertPassRate)}\n`);
  }
  const runsPayload = history.recentRuns.map((run) => ({
    at: run.at,
    plan_id: run.planId ?? "",
    compared_count: run.comparedCount,
    winner_label: run.winnerLabel,
    winner_score: run.winnerScore,
    winner_grade: run.winnerGrade,
    preset: run.preset ?? "",
    guard_mode: run.guardMode ?? "",
    guard_policy_profile: run.guardPolicyProfile ?? "",
    winner_top_hint: run.winnerTopHint ?? "",
    winner_top_repair_action: run.winnerTopRepairAction ?? "",
    runner_up_label: run.runnerUpLabel ?? "",
    runner_up_score: typeof run.runnerUpScore === "number" ? run.runnerUpScore : null,
    winner_lead_score: typeof run.winnerLeadScore === "number" ? run.winnerLeadScore : null,
    assert_best: run.assertBest ?? "",
    assert_passed: typeof run.assertPassed === "boolean" ? run.assertPassed : null,
    assert_actual: run.assertActual ?? "",
  }));
  input.writeStdout(`plan_quality_benchmark_recent_runs: ${JSON.stringify(runsPayload)}\n`);
  return history;
}

function writeBenchmarkSignals(input: {
  workDir: string;
  sessionId: string;
  writeStdout(message: string): void;
  latestFailure?: ReturnType<typeof loadLatestPlanFailureDiagnostic>;
}) {
  const history = writeBenchmarkHistoryStatus(input);
  const semantic = evaluatePlanQualityBenchmarkSemanticCorrelation({
    latestFailure: input.latestFailure,
    history,
  });
  const health = evaluatePlanQualityBenchmarkHealth({
    history,
    semanticCorrelation: semantic.level,
  });
  const recommendation = resolvePlanQualityBenchmarkRecommendation({
    history,
    semanticCorrelation: semantic.level,
    health,
  });
  input.writeStdout(`plan_quality_benchmark_semantic_correlation: ${semantic.level}\n`);
  input.writeStdout(`plan_quality_benchmark_semantic_reason: ${semantic.reason}\n`);
  input.writeStdout(`plan_quality_benchmark_health_score: ${String(health.score)}\n`);
  input.writeStdout(`plan_quality_benchmark_health_level: ${health.level}\n`);
  input.writeStdout(`plan_quality_benchmark_health_reason: ${health.reason}\n`);
  input.writeStdout(`plan_quality_benchmark_health_components: ${JSON.stringify(health.components)}\n`);
  input.writeStdout(`plan_quality_benchmark_recommended_next_action: ${recommendation.action}\n`);
  input.writeStdout(`plan_quality_benchmark_recommendation_reason: ${recommendation.reason}\n`);
}

function shouldRenderCompactPlanStatus(): boolean {
  return !isEnvTruthy(process.env.GROBOT_PLAN_STATUS_VERBOSE);
}

function writePlanRecommendationLines(input: {
  writeStdout(message: string): void;
  recommendation: { action: string; reason: string };
}): void {
  const suggestedCommand = resolvePlanStatusRecommendationCommand(input.recommendation.action);
  const suggestedLabel = resolvePlanStatusRecommendationLabel(input.recommendation.action);
  input.writeStdout(`recommended_next_action: ${input.recommendation.action}\n`);
  input.writeStdout(`recommendation_reason: ${input.recommendation.reason}\n`);
  input.writeStdout(`suggested_action_label: ${suggestedLabel}\n`);
  input.writeStdout(`suggested_action_command: ${suggestedCommand}\n`);
  input.writeStdout(`suggested_action_reason: ${input.recommendation.reason}\n`);
}

function buildPlanStatusSummarySurface(input: {
  title: string;
  primary: string;
  detailLines?: readonly string[];
  footerLines?: readonly string[];
}): string {
  return renderPlanSurface({
    title: input.title,
    rows: [
      {
        title: input.primary,
        detailLines: input.detailLines,
      },
    ],
    footerLines: input.footerLines,
  });
}

async function showPlanStatusCompact(input: ShowPlanStatusInput): Promise<number> {
  const sessionId = input.runtimeState.getSessionKey();
  const mode = input.runtimeState.getPlanMode();
  const meta = input.runtimeState.getPlanMeta();
  const active = resolveActivePlan(input.workDir, sessionId);
  if (active) {
    const statusLabel = humanizePlanStatus(active.entry.status);
    const statusDetailLines = active.entry.status === "apply_failed"
      ? [
          '上次实现没有完成；计划仍保留，可修复问题后回复“开始实现计划”。',
        ]
      : undefined;
    input.writeStdout(buildCurrentPlanDisplay({
      workDir: input.workDir,
      planPath: active.planPath,
      planContent: active.content,
      editorName: resolvePlanEditorDisplayName(),
      statusLabel,
      statusDetailLines,
    }));
    return 0;
  }
  if (mode === "plan_only" && meta?.active_plan_id) {
    const planPath = typeof meta.active_plan_path === "string" && meta.active_plan_path.length > 0
      ? meta.active_plan_path
      : undefined;
    input.writeStdout(buildPlanDraftStatusDisplay({
      workDir: input.workDir,
      planPath,
    }));
    return 0;
  }
  const latestApplied = resolveLatestPlanEntry(input.workDir, sessionId, ["applied", "apply_failed"]);
  if (latestApplied) {
    const latestTitle = latestApplied.title.trim();
    const latestSummary = latestTitle && latestTitle !== "plan session"
      ? `${latestTitle} · ${humanizePlanStatus(latestApplied.status)}`
      : humanizePlanStatus(latestApplied.status);
    input.writeStdout(buildPlanStatusSummarySurface({
      title: "最近计划状态",
      primary: "当前没有活跃计划。",
      detailLines: [
        `最近计划 ${latestSummary}`,
        '使用 "/plan <goal>" 开始新计划。',
      ],
    }));
    return 0;
  }
  input.writeStdout(buildPlanStatusSummarySurface({
    title: "当前计划",
    primary: "还没有写入计划。",
    detailLines: [
      '使用 "/plan <goal>" 开始规划。',
    ],
  }));
  return 0;
}

export async function showPlanStatus(input: ShowPlanStatusInput): Promise<number> {
  const sessionId = input.runtimeState.getSessionKey();
  if (shouldRenderCompactPlanStatus()) {
    return showPlanStatusCompact(input);
  }
  const mode = input.runtimeState.getPlanMode();
  const meta = input.runtimeState.getPlanMeta();
  const active = resolveActivePlan(input.workDir, sessionId);
  input.writeStdout("[plan-status]\n");
  input.writeStdout("plan_status_output_mode: full\n");
  input.writeStdout(`mode: ${mode}\n`);
  if (active) {
    const activeMeta = buildPlanMeta(active.entry, active.planPath);
    const previewLines = buildPlanStatusPreviewLines(active.content);
    const activeNonEmptyLineCount = active.content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .length;
    input.writeStdout("[plan-current]\n");
    input.writeStdout(`title: ${activeMeta.active_plan_title ?? "<none>"}\n`);
    const latestFailure = loadLatestPlanFailureDiagnostic(input.workDir, sessionId, {
      planId: activeMeta.active_plan_id,
    });
    const latestVerification = loadLatestPlanVerificationDiagnostic(input.workDir, sessionId, {
      planId: activeMeta.active_plan_id,
    });
    const latestVerificationStatus = latestVerification?.status;
    const qualityGuardRuntime = resolveQualityGuardRuntime(input.workDir);
    const liveSnapshot = evaluateLivePlanDecisionSnapshot({
      workDir: input.workDir,
      sessionId,
      mode: "plan_only",
      entry: active.entry,
      planContent: active.content,
      latestVerificationStatus,
      guardPolicy: qualityGuardRuntime.policy,
      guardMode: qualityGuardRuntime.guardMode,
    });
    input.writeStdout(`status: ${liveSnapshot.liveStatus}\n`);
    input.writeStdout(`path: ${activeMeta.active_plan_path ?? "<none>"}\n`);
    if (previewLines.length > 0) {
      for (let previewIndex = 0; previewIndex < previewLines.length; previewIndex += 1) {
        input.writeStdout(`preview_${String(previewIndex + 1)}: ${previewLines[previewIndex]}\n`);
      }
    }
    if (activeNonEmptyLineCount > previewLines.length) {
      input.writeStdout("preview_more: ...\n");
    }
    input.writeStdout("\n");
    input.writeStdout(`active_plan_id: ${activeMeta.active_plan_id ?? "<none>"}\n`);
    input.writeStdout(`active_plan_status: ${liveSnapshot.liveStatus}\n`);
    input.writeStdout(`active_plan_phase: ${liveSnapshot.livePhase}\n`);
    input.writeStdout(`active_plan_status_source: ${liveSnapshot.statusSource}\n`);
    input.writeStdout(`active_plan_decision_ready: ${liveSnapshot.decisionReady ? "yes" : "no"}\n`);
    input.writeStdout(`active_plan_approval_stale: ${liveSnapshot.approvalStale ? "yes" : "no"}\n`);
    if (liveSnapshot.statusSource === "live_snapshot") {
      input.writeStdout(`active_plan_stored_status: ${liveSnapshot.storedStatus}\n`);
      if (liveSnapshot.storedPhase) {
        input.writeStdout(`active_plan_stored_phase: ${liveSnapshot.storedPhase}\n`);
      }
    }
    input.writeStdout(`active_plan_path: ${activeMeta.active_plan_path ?? "<none>"}\n`);
    if (activeMeta.active_plan_path) {
      input.writeStdout("plan_open_hint: /plan open\n");
    }
    input.writeStdout(`active_plan_seq: ${String(activeMeta.active_plan_seq ?? 0)}\n`);
    input.writeStdout(`active_plan_title: ${activeMeta.active_plan_title ?? "<none>"}\n`);
    if (latestFailure) {
      input.writeStdout(`latest_failure_event: ${latestFailure.event}\n`);
      input.writeStdout(`latest_failure_at: ${latestFailure.at}\n`);
      if (typeof latestFailure.exitCode === "number") {
        input.writeStdout(`latest_failure_exit_code: ${String(latestFailure.exitCode)}\n`);
      }
      if (latestFailure.policyAction) {
        input.writeStdout(`latest_failure_policy_action: ${latestFailure.policyAction}\n`);
      }
      if (latestFailure.policyReason) {
        input.writeStdout(`latest_failure_policy_reason: ${latestFailure.policyReason}\n`);
      }
      if (latestFailure.diagnosticCode) {
        input.writeStdout(`latest_failure_diagnostic_code: ${latestFailure.diagnosticCode}\n`);
      }
      if (latestFailure.providerName) {
        input.writeStdout(`latest_failure_provider: ${latestFailure.providerName}\n`);
      }
      if (latestFailure.errorClass) {
        input.writeStdout(`latest_failure_error_class: ${latestFailure.errorClass}\n`);
      }
      if (typeof latestFailure.reviewBlocked === "boolean") {
        input.writeStdout(`latest_failure_review_blocked: ${latestFailure.reviewBlocked ? "yes" : "no"}\n`);
      }
      if (typeof latestFailure.findingsCount === "number") {
        input.writeStdout(`latest_failure_findings_count: ${String(latestFailure.findingsCount)}\n`);
      }
    } else {
      input.writeStdout("latest_failure_event: <none>\n");
    }
    if (latestVerification) {
      input.writeStdout(`latest_verification_event: ${latestVerification.event}\n`);
      input.writeStdout(`latest_verification_status: ${latestVerification.status}\n`);
      input.writeStdout(`latest_verification_at: ${latestVerification.at}\n`);
    } else {
      input.writeStdout("latest_verification_event: <none>\n");
    }
    input.writeStdout(`plan_quality_score: ${String(liveSnapshot.quality.score)}\n`);
    input.writeStdout(`plan_quality_grade: ${liveSnapshot.quality.grade}\n`);
    input.writeStdout(`plan_quality_findings_count: ${String(liveSnapshot.quality.findingCount)}\n`);
    input.writeStdout(`plan_quality_blocked: ${liveSnapshot.quality.blocked ? "yes" : "no"}\n`);
    input.writeStdout(`plan_quality_recommendation: ${liveSnapshot.quality.recommendation}\n`);
    input.writeStdout(`plan_quality_trend: ${liveSnapshot.qualityTrend.trend}\n`);
    if (typeof liveSnapshot.qualityTrend.previousScore === "number") {
      input.writeStdout(`plan_quality_previous_score: ${String(liveSnapshot.qualityTrend.previousScore)}\n`);
    }
    if (typeof liveSnapshot.qualityTrend.deltaFromPrevious === "number") {
      input.writeStdout(`plan_quality_delta_from_previous: ${String(liveSnapshot.qualityTrend.deltaFromPrevious)}\n`);
    }
    if (liveSnapshot.qualityTrend.previousPlanId) {
      input.writeStdout(`plan_quality_previous_plan_id: ${liveSnapshot.qualityTrend.previousPlanId}\n`);
    }
    input.writeStdout(`plan_quality_guard_mode: ${liveSnapshot.qualityGuardMode}\n`);
    input.writeStdout(`plan_quality_guard_level: ${liveSnapshot.qualityGuard.level}\n`);
    input.writeStdout(`plan_quality_regression_streak: ${String(liveSnapshot.qualityGuard.regressionStreak)}\n`);
    input.writeStdout(`plan_quality_guard_reason: ${liveSnapshot.qualityGuard.reason}\n`);
    input.writeStdout(`plan_quality_guard_policy_profile: ${qualityGuardRuntime.policy.profile}\n`);
    input.writeStdout(`plan_quality_guard_policy_source: ${qualityGuardRuntime.source}\n`);
    if (qualityGuardRuntime.policyPath) {
      input.writeStdout(`plan_quality_guard_policy_path: ${qualityGuardRuntime.policyPath}\n`);
    }
    if (qualityGuardRuntime.warning) {
      input.writeStdout(`plan_quality_guard_policy_warning: ${qualityGuardRuntime.warning}\n`);
    }
    if (liveSnapshot.quality.rewriteHints.length > 0) {
      input.writeStdout(`plan_quality_rewrite_hints: ${liveSnapshot.quality.rewriteHints.join(" | ")}\n`);
    }
    if (liveSnapshot.repairActions.length > 0) {
      const summary = liveSnapshot.repairActions
        .map((item) => `[${item.priority}] ${item.title} => ${item.command}`)
        .join(" || ");
      input.writeStdout(`plan_quality_repair_actions: ${summary}\n`);
    }
    writeBenchmarkSignals({
      workDir: input.workDir,
      sessionId,
      writeStdout: input.writeStdout,
      latestFailure,
    });
    writePlanRecommendationLines({
      writeStdout: input.writeStdout,
      recommendation: liveSnapshot.recommendation,
    });
  } else if (mode === "plan_only" && meta?.active_plan_id) {
    input.writeStdout(`active_plan_id: ${meta.active_plan_id}\n`);
    input.writeStdout(`active_plan_status: ${meta.active_plan_status ?? "draft"}\n`);
    if (meta.active_plan_phase) {
      input.writeStdout(`active_plan_phase: ${meta.active_plan_phase}\n`);
    }
    if (meta.active_plan_path) {
      input.writeStdout(`active_plan_path: ${meta.active_plan_path}\n`);
      input.writeStdout("plan_open_hint: /plan open\n");
    }
    if (typeof meta.active_plan_seq === "number") {
      input.writeStdout(`active_plan_seq: ${String(meta.active_plan_seq)}\n`);
    }
    if (meta.active_plan_title) {
      input.writeStdout(`active_plan_title: ${meta.active_plan_title}\n`);
    }
    if (meta.review_status) {
      input.writeStdout(`review_status: ${meta.review_status}\n`);
    }
    if (typeof meta.blocked_count === "number") {
      input.writeStdout(`blocked_count: ${String(meta.blocked_count)}\n`);
    }
    if (typeof meta.review_fail_count === "number") {
      input.writeStdout(`review_fail_count: ${String(meta.review_fail_count)}\n`);
    }
    if (meta.approved_hash) {
      input.writeStdout(`approved_hash: ${meta.approved_hash}\n`);
    }
    if (meta.approval_ticket_id) {
      input.writeStdout(`approval_ticket_id: ${meta.approval_ticket_id}\n`);
    }
    if (meta.approved_snapshot_path) {
      input.writeStdout(`approved_snapshot_path: ${meta.approved_snapshot_path}\n`);
    }
    const latestFailure = loadLatestPlanFailureDiagnostic(input.workDir, sessionId, {
      planId: meta.active_plan_id,
    });
    if (latestFailure) {
      input.writeStdout(`latest_failure_event: ${latestFailure.event}\n`);
      input.writeStdout(`latest_failure_at: ${latestFailure.at}\n`);
      if (typeof latestFailure.exitCode === "number") {
        input.writeStdout(`latest_failure_exit_code: ${String(latestFailure.exitCode)}\n`);
      }
      if (latestFailure.policyAction) {
        input.writeStdout(`latest_failure_policy_action: ${latestFailure.policyAction}\n`);
      }
      if (latestFailure.policyReason) {
        input.writeStdout(`latest_failure_policy_reason: ${latestFailure.policyReason}\n`);
      }
      if (latestFailure.diagnosticCode) {
        input.writeStdout(`latest_failure_diagnostic_code: ${latestFailure.diagnosticCode}\n`);
      }
      if (latestFailure.providerName) {
        input.writeStdout(`latest_failure_provider: ${latestFailure.providerName}\n`);
      }
      if (latestFailure.errorClass) {
        input.writeStdout(`latest_failure_error_class: ${latestFailure.errorClass}\n`);
      }
      if (typeof latestFailure.reviewBlocked === "boolean") {
        input.writeStdout(`latest_failure_review_blocked: ${latestFailure.reviewBlocked ? "yes" : "no"}\n`);
      }
      if (typeof latestFailure.findingsCount === "number") {
        input.writeStdout(`latest_failure_findings_count: ${String(latestFailure.findingsCount)}\n`);
      }
    } else {
      input.writeStdout("latest_failure_event: <none>\n");
    }
    const latestVerification = loadLatestPlanVerificationDiagnostic(input.workDir, sessionId, {
      planId: meta.active_plan_id,
    });
    const latestVerificationStatus = latestVerification?.status;
    let qualityScore: number | undefined;
    let qualityTopHint: string | undefined;
    let qualityGuardLevel: "healthy" | "watch" | "critical" | undefined;
    let qualityGuardReason: string | undefined;
    let qualityTopRepairActionTitle: string | undefined;
    const qualityGuardRuntime = resolveQualityGuardRuntime(input.workDir);
    if (typeof meta.active_plan_path === "string" && meta.active_plan_path.length > 0) {
      try {
        const fallbackContent = readFileSync(meta.active_plan_path, "utf8");
        const quality = evaluatePlanQuality(fallbackContent);
        const qualityTrend = evaluatePlanQualityTrend({
          workDir: input.workDir,
          sessionId,
          currentPlanId: meta.active_plan_id,
          currentScore: quality.score,
        });
        const qualityGuard = evaluatePlanQualityGuard({
          workDir: input.workDir,
          sessionId,
          currentPlanId: meta.active_plan_id,
          quality,
          trend: qualityTrend,
          policy: qualityGuardRuntime.policy,
        });
        const repairActions = buildPlanQualityRepairActions({
          planContent: fallbackContent,
          quality,
          trend: qualityTrend,
          guard: qualityGuard,
        });
        qualityScore = quality.score;
        qualityTopHint = quality.rewriteHints[0];
        qualityTopRepairActionTitle = repairActions[0]?.title;
        qualityGuardLevel = qualityGuard.level;
        qualityGuardReason = qualityGuard.reason;
        input.writeStdout(`plan_quality_score: ${String(quality.score)}\n`);
        input.writeStdout(`plan_quality_grade: ${quality.grade}\n`);
        input.writeStdout(`plan_quality_findings_count: ${String(quality.findingCount)}\n`);
        input.writeStdout(`plan_quality_blocked: ${quality.blocked ? "yes" : "no"}\n`);
        input.writeStdout(`plan_quality_recommendation: ${quality.recommendation}\n`);
        input.writeStdout(`plan_quality_trend: ${qualityTrend.trend}\n`);
        if (typeof qualityTrend.previousScore === "number") {
          input.writeStdout(`plan_quality_previous_score: ${String(qualityTrend.previousScore)}\n`);
        }
        if (typeof qualityTrend.deltaFromPrevious === "number") {
          input.writeStdout(`plan_quality_delta_from_previous: ${String(qualityTrend.deltaFromPrevious)}\n`);
        }
        if (qualityTrend.previousPlanId) {
          input.writeStdout(`plan_quality_previous_plan_id: ${qualityTrend.previousPlanId}\n`);
        }
        input.writeStdout(`plan_quality_guard_mode: ${qualityGuardRuntime.guardMode}\n`);
        input.writeStdout(`plan_quality_guard_level: ${qualityGuard.level}\n`);
        input.writeStdout(`plan_quality_regression_streak: ${String(qualityGuard.regressionStreak)}\n`);
        input.writeStdout(`plan_quality_guard_reason: ${qualityGuard.reason}\n`);
        input.writeStdout(`plan_quality_guard_policy_profile: ${qualityGuardRuntime.policy.profile}\n`);
        input.writeStdout(`plan_quality_guard_policy_source: ${qualityGuardRuntime.source}\n`);
        if (qualityGuardRuntime.policyPath) {
          input.writeStdout(`plan_quality_guard_policy_path: ${qualityGuardRuntime.policyPath}\n`);
        }
        if (qualityGuardRuntime.warning) {
          input.writeStdout(`plan_quality_guard_policy_warning: ${qualityGuardRuntime.warning}\n`);
        }
        if (quality.rewriteHints.length > 0) {
          input.writeStdout(`plan_quality_rewrite_hints: ${quality.rewriteHints.join(" | ")}\n`);
        }
        if (repairActions.length > 0) {
          const summary = repairActions
            .map((item) => `[${item.priority}] ${item.title} => ${item.command}`)
            .join(" || ");
          input.writeStdout(`plan_quality_repair_actions: ${summary}\n`);
        }
      } catch {
        input.writeStdout("plan_quality_score: <unavailable>\n");
      }
    } else {
      input.writeStdout("plan_quality_score: <unavailable>\n");
    }
    if (latestVerification) {
      input.writeStdout(`latest_verification_event: ${latestVerification.event}\n`);
      input.writeStdout(`latest_verification_status: ${latestVerification.status}\n`);
      input.writeStdout(`latest_verification_at: ${latestVerification.at}\n`);
    } else {
      input.writeStdout("latest_verification_event: <none>\n");
    }
    writeBenchmarkSignals({
      workDir: input.workDir,
      sessionId,
      writeStdout: input.writeStdout,
      latestFailure,
    });
    const recommendation = resolvePlanStatusRecommendation({
      mode: "plan_only",
      status: meta.active_plan_status,
      latestVerificationStatus,
      planQualityScore: qualityScore,
      planQualityTopHint: qualityTopRepairActionTitle ?? qualityTopHint,
      planQualityGuardLevel: qualityGuardLevel,
      planQualityGuardReason: qualityGuardReason,
      interactiveMenuFirst: process.stdin.isTTY,
    });
    writePlanRecommendationLines({
      writeStdout: input.writeStdout,
      recommendation,
    });
  } else {
    const latestApplied = resolveLatestPlanEntry(input.workDir, sessionId, ["applied", "apply_failed"]);
    if (latestApplied) {
      input.writeStdout(`active_plan_id: <none>\n`);
      input.writeStdout(`latest_plan_id: ${latestApplied.plan_id}\n`);
      input.writeStdout(`latest_plan_status: ${latestApplied.status}\n`);
      input.writeStdout(`latest_plan_seq: ${String(latestApplied.seq)}\n`);
      const latestFailure = loadLatestPlanFailureDiagnostic(input.workDir, sessionId, {
        planId: latestApplied.plan_id,
      });
      if (latestFailure) {
        input.writeStdout(`latest_failure_event: ${latestFailure.event}\n`);
        if (latestFailure.diagnosticCode) {
          input.writeStdout(`latest_failure_diagnostic_code: ${latestFailure.diagnosticCode}\n`);
        }
      } else {
        input.writeStdout("latest_failure_event: <none>\n");
      }
      const latestVerification = loadLatestPlanVerificationDiagnostic(input.workDir, sessionId, {
        planId: latestApplied.plan_id,
      });
      const latestVerificationStatus = latestVerification?.status;
      if (latestVerification) {
        input.writeStdout(`latest_verification_event: ${latestVerification.event}\n`);
        input.writeStdout(`latest_verification_status: ${latestVerification.status}\n`);
        input.writeStdout(`latest_verification_at: ${latestVerification.at}\n`);
      } else {
        input.writeStdout("latest_verification_event: <none>\n");
      }
      input.writeStdout("plan_quality_score: <n/a>\n");
      writeBenchmarkSignals({
        workDir: input.workDir,
        sessionId,
        writeStdout: input.writeStdout,
        latestFailure,
      });
      const recommendation = resolvePlanStatusRecommendation({
        mode: "normal",
        status: latestApplied.status,
        latestVerificationStatus,
        interactiveMenuFirst: process.stdin.isTTY,
      });
      writePlanRecommendationLines({
        writeStdout: input.writeStdout,
        recommendation,
      });
    } else {
      input.writeStdout("active_plan_id: <none>\n");
      input.writeStdout("latest_failure_event: <none>\n");
      input.writeStdout("latest_verification_event: <none>\n");
      input.writeStdout("plan_quality_score: <none>\n");
      writeBenchmarkSignals({
        workDir: input.workDir,
        sessionId,
        writeStdout: input.writeStdout,
      });
      const recommendation = resolvePlanStatusRecommendation({
        mode: "normal",
        interactiveMenuFirst: process.stdin.isTTY,
      });
      writePlanRecommendationLines({
        writeStdout: input.writeStdout,
        recommendation,
      });
    }
  }
  input.writeStdout("\n");
  return 0;
}
