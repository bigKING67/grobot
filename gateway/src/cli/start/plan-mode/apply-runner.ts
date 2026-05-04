import { isNaturalPlanExecutionIntent } from "../plan-command";
import { resolvePlanFailureDecision } from "../plan-failure-policy";
import {
  appendPlanEvent,
  approvePlanArtifact,
  buildPlanApplyPrompt,
  evaluatePlanQuality,
  evaluatePlanQualityGuard,
  evaluatePlanQualityTrend,
  recordPlanReviewResult,
  recoverStaleApprovedPlan,
  reviewPlanContent,
  updatePlanArtifactStatus,
  type ActivePlanArtifact,
  type PlanArtifactEntry,
} from "../plan-artifact";
import { TURN_INTERRUPTED_EXIT_CODE } from "../turn";
import type { RunStartRuntimeState } from "../runtime-state";
import { PLAN_REVIEW_BLOCKED_CODE, PLAN_REVIEW_FAILED_CODE } from "./constants";
import { parseApprovedPlanContent } from "./content";
import type { PlanStablePoint, RunStartPlanTurnOptions } from "./contract";
import { buildPlanMeta, humanizePlanStatus } from "./meta";
import type { PlanQualityGuardRuntime } from "./quality-runtime";
import {
  buildApprovedPlanExecutionSurface,
  buildPlanApplyStateSurface,
  createPlanTurnDiagnosticStderr,
  shouldRenderCompactPlanFailureSurface,
  writePlanFailureSurface,
  writePlanQualityGuardBlockedSurface,
  writePlanReviewFailureSurface,
} from "./surfaces";
import { writePlanActivityDiagnostic } from "./activity";

export interface RunPlanApplyInput {
  workDir: string;
  runtimeState: Pick<RunStartRuntimeState, "getProviderRuntimeStates">;
  extraRaw: string;
  options?: RunStartPlanTurnOptions;
  stablePoint: PlanStablePoint;
  planSessionKey(): string;
  resolveActivePlan(): ActivePlanArtifact | undefined;
  resolveQualityGuardRuntime(): PlanQualityGuardRuntime;
  consumePendingInterrupt(
    snapshot: PlanStablePoint,
    stage: string,
  ): Promise<boolean>;
  persistPlanState(
    planMode: "normal" | "plan_only",
    planMeta: ReturnType<typeof buildPlanMeta> | undefined,
  ): Promise<void>;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      promptPrelude?: string;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
  markFailureObserved(): void;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export async function runPlanApply(input: RunPlanApplyInput): Promise<number> {
  const writeStdout = input.options?.writeStdout ?? input.writeStdout;
  if (
    await input.consumePendingInterrupt(input.stablePoint, "before_apply_start")
  ) {
    return 0;
  }
  const recovered = recoverStaleApprovedPlan(
    input.workDir,
    input.planSessionKey(),
    {
      source: "cli",
    },
  );
  const active = input.resolveActivePlan();
  if (!active) {
    input.writeStderr(
      buildPlanApplyStateSurface({
        kind: "no_active",
        diagnostic: "PLAN_APPLY_NO_ACTIVE_PLAN",
      }),
    );
    return 1;
  }
  if (recovered.recovered) {
    writeStdout(
      buildPlanApplyStateSurface({
        kind: "lock_recovered",
        workDir: input.workDir,
        planPath: active.planPath,
        staleMs: recovered.stale_ms,
      }),
    );
  }
  if (active.entry.status === "applying") {
    writeStdout(
      buildPlanApplyStateSurface({
        kind: "already_applying",
        workDir: input.workDir,
        planPath: active.planPath,
      }),
    );
    return 0;
  }
  if (
    active.entry.status === "applied" ||
    active.entry.status === "discarded"
  ) {
    input.writeStderr(
      buildPlanApplyStateSurface({
        kind: "invalid_status",
        workDir: input.workDir,
        planPath: active.planPath,
        statusLabel: humanizePlanStatus(active.entry.status),
        diagnostic: "PLAN_APPLY_INVALID_STATUS",
      }),
    );
    return 1;
  }
  const quality = evaluatePlanQuality(active.content);
  const qualityTrend = evaluatePlanQualityTrend({
    workDir: input.workDir,
    sessionId: input.planSessionKey(),
    currentPlanId: active.entry.plan_id,
    currentScore: quality.score,
  });
  const qualityGuardRuntime = input.resolveQualityGuardRuntime();
  const qualityGuard = evaluatePlanQualityGuard({
    workDir: input.workDir,
    sessionId: input.planSessionKey(),
    currentPlanId: active.entry.plan_id,
    quality,
    trend: qualityTrend,
    policy: qualityGuardRuntime.policy,
  });
  const qualityGuardMode = qualityGuardRuntime.guardMode;
  const compactFailureSurface = shouldRenderCompactPlanFailureSurface(
    input.options?.diagnosticsMode,
  );
  if (qualityGuardMode === "strict" && qualityGuard.level === "critical") {
    appendPlanEvent(input.workDir, input.planSessionKey(), {
      event: "plan_apply_blocked",
      plan_id: active.entry.plan_id,
      source: "cli",
      detail: [
        "reason=quality_guard_critical",
        `guard_mode=${qualityGuardMode}`,
        `guard_profile=${qualityGuardRuntime.policy.profile}`,
        `guard_source=${qualityGuardRuntime.source}`,
        `guard_level=${qualityGuard.level}`,
        `guard_reason=${qualityGuard.reason.replace(/\s+/g, "_")}`,
      ].join(" "),
    });
    writePlanQualityGuardBlockedSurface({
      qualityGuardMode,
      guardLevel: qualityGuard.level,
      guardReason: qualityGuard.reason,
      compactFailureSurface,
      writeStderr: input.writeStderr,
    });
    return 2;
  }

  let approvedEntry: PlanArtifactEntry = active.entry;
  let approvedHash = active.entry.approved_hash;
  let approvalTicketId = active.entry.approval_ticket_id;
  let approvedSnapshotPath = active.entry.approved_snapshot_path;

  const shouldReviewAndApprove =
    active.entry.status !== "approved" || !approvedHash || !approvalTicketId;
  if (shouldReviewAndApprove) {
    const review = reviewPlanContent(active.content);
    const reviewedEntry = recordPlanReviewResult(
      input.workDir,
      input.planSessionKey(),
      active.entry.plan_id,
      review,
      "cli",
    );
    if (!reviewedEntry) {
      input.writeStderr(
        buildPlanApplyStateSurface({
          kind: "internal_failure",
          workDir: input.workDir,
          planPath: active.planPath,
          detail: "计划评审记录更新失败。",
          diagnostic: "PLAN_REVIEW_ENTRY_MISSING",
        }),
      );
      return 1;
    }
    await input.persistPlanState(
      "plan_only",
      buildPlanMeta(reviewedEntry, active.planPath),
    );
    if (!review.ok) {
      const reviewCode = review.blocked
        ? PLAN_REVIEW_BLOCKED_CODE
        : PLAN_REVIEW_FAILED_CODE;
      writePlanReviewFailureSurface({
        reviewCode,
        planId: active.entry.plan_id,
        compactFailureSurface,
        review,
        writeStderr: input.writeStderr,
      });
      return 2;
    }

    const approval = approvePlanArtifact(
      input.workDir,
      input.planSessionKey(),
      active.entry.plan_id,
      {
        approvedBy: "cli",
        source: "cli",
      },
    );
    if (
      !approval.approved ||
      !approval.entry ||
      !approval.planHash ||
      !approval.ticketId
    ) {
      input.writeStderr(
        buildPlanApplyStateSurface({
          kind: "internal_failure",
          workDir: input.workDir,
          planPath: active.planPath,
          detail: "计划确认元数据写入失败。",
          diagnostic: "PLAN_APPROVAL_FAILED",
        }),
      );
      return 1;
    }

    approvedEntry = approval.entry;
    approvedHash = approval.planHash;
    approvalTicketId = approval.ticketId;
    approvedSnapshotPath = approval.snapshotPath;
    await input.persistPlanState(
      "plan_only",
      buildPlanMeta(approval.entry, active.planPath),
    );
  } else {
    await input.persistPlanState(
      "plan_only",
      buildPlanMeta(active.entry, active.planPath),
    );
  }

  const applying = updatePlanArtifactStatus(
    input.workDir,
    input.planSessionKey(),
    active.entry.plan_id,
    "applying",
  );
  if (!applying) {
    input.writeStderr(
      buildPlanApplyStateSurface({
        kind: "internal_failure",
        workDir: input.workDir,
        planPath: active.planPath,
        detail: "无法把计划状态切换为执行中。",
        diagnostic: "PLAN_APPLY_STATUS_UPDATE_FAILED",
      }),
    );
    return 1;
  }
  await input.persistPlanState(
    "plan_only",
    buildPlanMeta(applying, active.planPath),
  );
  if (!approvedHash || !approvalTicketId) {
    input.writeStderr(
      buildPlanApplyStateSurface({
        kind: "internal_failure",
        workDir: input.workDir,
        planPath: active.planPath,
        detail: "缺少确认票据或计划快照，无法执行。",
        diagnostic: "PLAN_APPLY_APPROVAL_METADATA_MISSING",
      }),
    );
    return 1;
  }

  const approvedPlanContent = parseApprovedPlanContent(
    approvedSnapshotPath,
    active.content,
  );
  writeStdout(
    buildApprovedPlanExecutionSurface({
      workDir: input.workDir,
      planPath: active.planPath,
      title: approvedEntry.title,
      approvedHash,
      ticketId: approvalTicketId,
      approvedPlanContent,
    }),
  );
  const extraInstruction = isNaturalPlanExecutionIntent(input.extraRaw)
    ? ""
    : input.extraRaw.trim();
  const prompt = buildPlanApplyPrompt({
    approvedPlanContent,
    approvedHash,
    ticketId: approvalTicketId,
    extra: extraInstruction,
  });
  const applyStderr = createPlanTurnDiagnosticStderr({
    writeStderr: input.options?.writeStderr ?? input.writeStderr,
    compactFailureSurface,
  });
  writePlanActivityDiagnostic(input.options, "apply_model_running");
  let code: number;
  try {
    code = await input.executeTurn(prompt, true, {
      writeStdout,
      writeStderr: applyStderr.writeStderr,
    });
  } finally {
    applyStderr.flush();
  }
  if (code === TURN_INTERRUPTED_EXIT_CODE) {
    const approvedAgain = updatePlanArtifactStatus(
      input.workDir,
      input.planSessionKey(),
      active.entry.plan_id,
      "approved",
    );
    await input.persistPlanState(
      "plan_only",
      buildPlanMeta(approvedAgain ?? approvedEntry, active.planPath),
    );
    appendPlanEvent(input.workDir, input.planSessionKey(), {
      event: "plan_apply_interrupted",
      plan_id: active.entry.plan_id,
      source: "cli",
      detail: `exit_code=${String(code)}`,
    });
    return code;
  }
  if (code !== 0) {
    const failureDecision = resolvePlanFailureDecision({
      phase: "applying",
      exitCode: code,
      providerStates: input.runtimeState.getProviderRuntimeStates(),
    });
    const applyFailed = updatePlanArtifactStatus(
      input.workDir,
      input.planSessionKey(),
      active.entry.plan_id,
      "apply_failed",
    );
    await input.persistPlanState(
      "plan_only",
      buildPlanMeta(applyFailed ?? applying, active.planPath),
    );
    appendPlanEvent(input.workDir, input.planSessionKey(), {
      event: "plan_apply_failed",
      plan_id: active.entry.plan_id,
      source: "cli",
      detail: [
        `exit_code=${String(code)}`,
        "policy_action=fail",
        `policy_reason=${failureDecision.reason}`,
        `diagnostic_code=${failureDecision.diagnosticCode}`,
        failureDecision.providerName
          ? `provider=${failureDecision.providerName}`
          : "",
        failureDecision.errorClass ? `class=${failureDecision.errorClass}` : "",
      ]
        .filter((item) => item.length > 0)
        .join(" "),
    });
    input.markFailureObserved();
    writePlanFailureSurface({
      phase: "applying",
      planId: active.entry.plan_id,
      workDir: input.workDir,
      planPath: active.planPath,
      exitCode: code,
      compactFailureSurface,
      failureDecision,
      writeStderr: input.writeStderr,
    });
    return code;
  }

  writePlanActivityDiagnostic(input.options, "apply_finished");
  updatePlanArtifactStatus(
    input.workDir,
    input.planSessionKey(),
    active.entry.plan_id,
    "applied",
  );
  await input.persistPlanState("normal", undefined);
  appendPlanEvent(input.workDir, input.planSessionKey(), {
    event: "plan_apply_succeeded",
    plan_id: active.entry.plan_id,
    source: "cli",
    detail: "plan applied and exited plan_only",
  });
  appendPlanEvent(input.workDir, input.planSessionKey(), {
    event: "plan_verification_pending",
    plan_id: active.entry.plan_id,
    source: "cli",
    detail: "verification_status=pending",
  });
  return code;
}
