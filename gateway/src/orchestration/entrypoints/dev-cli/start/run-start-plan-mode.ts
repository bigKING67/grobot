import { readFileSync } from "node:fs";
import { parsePlanCommand } from "./plan-command";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  approvePlanArtifact,
  buildPlanApplyPrompt,
  createPlanArtifact,
  loadActivePlanArtifact,
  recoverStaleApprovedPlan,
  recordPlanReviewResult,
  reviewPlanContent,
  type PlanArtifactEntry,
  updatePlanArtifactStatus,
} from "./plan-artifact";
import { type RunStartPersistence } from "./run-start-persistence";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import {
  setSessionPlanState,
  type SessionPlanMeta,
  type SessionPlanMode,
} from "./session-registry";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";

interface CreateRunStartPlanModeInput {
  workDir: string;
  runtimeState: RunStartRuntimeState;
  persistence: RunStartPersistence;
  executeTurn(userInput: string, interactiveMode: boolean): Promise<number>;
  requestRuntimeInterrupt(
    source: PlanInterruptSource,
  ): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  markFailureObserved(): void;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

interface PlanMessageHandleResult {
  handled: boolean;
  code: number;
}

const PLAN_REVIEW_FAILED_CODE = "PLAN_REVIEW_FAILED";
const PLAN_REVIEW_BLOCKED_CODE = "PLAN_REVIEW_BLOCKED";
const PLAN_INTERRUPT_OK_CODE = "PLAN_INTERRUPT_OK";
const PLAN_INTERRUPT_NOT_RUNNING_CODE = "PLAN_INTERRUPT_NOT_RUNNING";
const PLAN_INTERRUPT_NOT_PLAN_MODE_CODE = "PLAN_INTERRUPT_NOT_PLAN_MODE";

export type PlanInterruptSource = "command" | "cli_esc";

export interface PlanInterruptResult {
  code:
    | typeof PLAN_INTERRUPT_OK_CODE
    | typeof PLAN_INTERRUPT_NOT_RUNNING_CODE
    | typeof PLAN_INTERRUPT_NOT_PLAN_MODE_CODE;
  accepted: boolean;
  phase: "idle" | "planning" | "applying";
}

interface PlanStablePoint {
  planMode: SessionPlanMode;
  planMeta: SessionPlanMeta | undefined;
}

export interface RunStartPlanMode {
  isPlanMode(): boolean;
  enterPlan(goal: string): Promise<number>;
  showPlanStatus(): Promise<number>;
  runPlanTurn(note: string): Promise<number>;
  applyPlan(extra: string): Promise<number>;
  cancelPlan(): Promise<number>;
  requestPlanInterrupt(source: PlanInterruptSource): Promise<PlanInterruptResult>;
  handleMessageInput(message: string): Promise<PlanMessageHandleResult>;
}

function buildPlanMeta(entry: PlanArtifactEntry, planPath: string): SessionPlanMeta {
  return {
    active_plan_id: entry.plan_id,
    active_plan_status: entry.status,
    active_plan_path: planPath,
    active_plan_seq: entry.seq,
    active_plan_title: entry.title,
    review_status:
      entry.status === "ready"
      || entry.status === "blocked"
      || entry.status === "review_failed"
        ? entry.status
        : undefined,
    blocked_count: entry.blocked_count,
    review_fail_count: entry.review_fail_count,
    approved_hash: entry.approved_hash,
    approval_ticket_id: entry.approval_ticket_id,
    approved_snapshot_path: entry.approved_snapshot_path,
    updated_at: entry.updated_at,
  };
}

function parseApprovedContent(snapshotPath: string | undefined, fallback: string): string {
  if (!snapshotPath) {
    return fallback;
  }
  try {
    const snapshot = readFileSync(snapshotPath, "utf8");
    if (snapshot.trim().length > 0) {
      return snapshot;
    }
  } catch {
    // keep fallback content when snapshot file is unavailable.
  }
  return fallback;
}

function formatReviewFindings(findings: readonly { code: string; section?: string; message: string }[]): string {
  if (findings.length === 0) {
    return "none";
  }
  return findings
    .map((item) => `${item.code}:${item.section ?? "global"}:${item.message}`)
    .join(" | ");
}

export function createRunStartPlanMode(input: CreateRunStartPlanModeInput): RunStartPlanMode {
  const planSessionKey = (): string => input.runtimeState.getSessionKey();
  let activeTurnPhase: "idle" | "planning" | "applying" = "idle";
  let pendingInterruptSource: PlanInterruptSource | undefined;

  const clonePlanMeta = (
    planMeta: SessionPlanMeta | undefined,
  ): SessionPlanMeta | undefined => {
    if (!planMeta) {
      return undefined;
    }
    return { ...planMeta };
  };

  const capturePlanStablePoint = (): PlanStablePoint => ({
    planMode: input.runtimeState.getPlanMode(),
    planMeta: clonePlanMeta(input.runtimeState.getPlanMeta()),
  });

  const resolveActivePlanId = (): string | undefined => {
    const active = loadActivePlanArtifact(input.workDir, planSessionKey());
    if (active?.entry.plan_id) {
      return active.entry.plan_id;
    }
    return input.runtimeState.getPlanMeta()?.active_plan_id;
  };

  const persistPlanState = async (
    planMode: SessionPlanMode,
    planMeta: SessionPlanMeta | undefined,
  ): Promise<void> => {
    input.runtimeState.setPlanMode(planMode);
    input.runtimeState.setPlanMeta(planMeta);
    setSessionPlanState(
      input.runtimeState.getSessionRegistry(),
      input.runtimeState.getActiveSessionId(),
      {
        planMode,
        planMeta,
      },
    );
    await input.persistence.persistSessionRegistryState();
  };

  const consumePendingInterrupt = async (
    snapshot: PlanStablePoint,
    stage: string,
  ): Promise<boolean> => {
    if (!pendingInterruptSource) {
      return false;
    }
    const interruptSource = pendingInterruptSource;
    pendingInterruptSource = undefined;
    const snapshotPlanId = snapshot.planMeta?.active_plan_id?.trim();
    const snapshotPlanStatus = snapshot.planMeta?.active_plan_status;
    if (snapshotPlanId && snapshotPlanStatus) {
      updatePlanArtifactStatus(
        input.workDir,
        planSessionKey(),
        snapshotPlanId,
        snapshotPlanStatus,
      );
    }
    await persistPlanState(snapshot.planMode, clonePlanMeta(snapshot.planMeta));
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_interrupt_applied",
      plan_id: resolveActivePlanId(),
      source: "cli",
      detail: `source=${interruptSource} stage=${stage} rollback=stable_point`,
    });
    input.writeStdout(
      `[plan-interrupt] code=${PLAN_INTERRUPT_OK_CODE} detail=applied stage=${stage} rollback=stable_point\n\n`,
    );
    return true;
  };

  const clearPendingInterruptAsIgnored = (stage: string, reason: string): void => {
    if (!pendingInterruptSource) {
      return;
    }
    const interruptSource = pendingInterruptSource;
    pendingInterruptSource = undefined;
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_interrupt_ignored",
      plan_id: resolveActivePlanId(),
      source: "cli",
      detail: `source=${interruptSource} stage=${stage} reason=${reason}`,
    });
    input.writeStdout(
      `[plan-interrupt] code=${PLAN_INTERRUPT_OK_CODE} detail=ignored stage=${stage} reason=${reason}\n\n`,
    );
  };

  const requestPlanInterrupt = async (
    source: PlanInterruptSource,
  ): Promise<PlanInterruptResult> => {
    if (input.runtimeState.getPlanMode() !== "plan_only") {
      input.writeStdout(
        `[plan-interrupt] code=${PLAN_INTERRUPT_NOT_PLAN_MODE_CODE} detail=interrupt_requires_plan_only\n\n`,
      );
      return {
        code: PLAN_INTERRUPT_NOT_PLAN_MODE_CODE,
        accepted: false,
        phase: activeTurnPhase,
      };
    }
    if (activeTurnPhase === "idle") {
      input.writeStdout(
        `[plan-interrupt] code=${PLAN_INTERRUPT_NOT_RUNNING_CODE} detail=no_active_plan_turn\n\n`,
      );
      return {
        code: PLAN_INTERRUPT_NOT_RUNNING_CODE,
        accepted: false,
        phase: activeTurnPhase,
      };
    }
    if (!pendingInterruptSource) {
      pendingInterruptSource = source;
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_interrupt_requested",
        plan_id: resolveActivePlanId(),
        source: "cli",
        detail: `source=${source} phase=${activeTurnPhase}`,
      });
    }
    if (activeTurnPhase === "applying") {
      const runtimeInterrupt = input.requestRuntimeInterrupt(source);
      input.writeStdout(
        `[plan-interrupt] code=${PLAN_INTERRUPT_OK_CODE} detail=requested phase=applying runtime_interrupt=${runtimeInterrupt.interrupted ? "sent" : "not_running"}\n\n`,
      );
    } else {
      input.writeStdout(
        `[plan-interrupt] code=${PLAN_INTERRUPT_OK_CODE} detail=requested phase=${activeTurnPhase}\n\n`,
      );
    }
    return {
      code: PLAN_INTERRUPT_OK_CODE,
      accepted: true,
      phase: activeTurnPhase,
    };
  };

  const resolveActivePlan = () => loadActivePlanArtifact(input.workDir, planSessionKey());

  const printPlanModeHint = (): void => {
    input.writeStdout(
      [
        "[plan] commands:",
        "  /plan",
        "  (open plan action menu)",
        "  /plan status",
        "  /plan apply [extra]",
        "  /plan cancel",
        "  (send plain text to refine the active plan)",
        "",
      ].join("\n"),
    );
  };

  const enterPlan = async (goalRaw: string): Promise<number> => {
    const goal = goalRaw.trim();
    if (!goal) {
      input.writeStdout("Usage: /plan <goal>\n\n");
      return 0;
    }
    const created = createPlanArtifact(input.workDir, planSessionKey(), goal);
    await persistPlanState(
      "plan_only",
      buildPlanMeta(created.entry, created.planPath),
    );
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_mode_entered",
      plan_id: created.entry.plan_id,
      source: "cli",
      detail: "entered plan_only mode",
    });
    input.writeStdout(
      `[plan] entered PLAN_ONLY session_key=${planSessionKey()} plan_id=${created.entry.plan_id} file=${created.planPath}\n\n`,
    );
    printPlanModeHint();
    return 0;
  };

  const showPlanStatus = async (): Promise<number> => {
    const mode = input.runtimeState.getPlanMode();
    const meta = input.runtimeState.getPlanMeta();
    const active = resolveActivePlan();
    input.writeStdout("[plan-status]\n");
    input.writeStdout(`mode: ${mode}\n`);
    if (active) {
      const activeMeta = buildPlanMeta(active.entry, active.planPath);
      input.writeStdout(`active_plan_id: ${activeMeta.active_plan_id ?? "<none>"}\n`);
      input.writeStdout(`active_plan_status: ${activeMeta.active_plan_status ?? "draft"}\n`);
      input.writeStdout(`active_plan_path: ${activeMeta.active_plan_path ?? "<none>"}\n`);
      input.writeStdout(`active_plan_seq: ${String(activeMeta.active_plan_seq ?? 0)}\n`);
      input.writeStdout(`active_plan_title: ${activeMeta.active_plan_title ?? "<none>"}\n`);
    } else if (mode === "plan_only" && meta?.active_plan_id) {
      input.writeStdout(`active_plan_id: ${meta.active_plan_id}\n`);
      input.writeStdout(`active_plan_status: ${meta.active_plan_status ?? "draft"}\n`);
      if (meta.active_plan_path) {
        input.writeStdout(`active_plan_path: ${meta.active_plan_path}\n`);
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
    } else {
      input.writeStdout("active_plan_id: <none>\n");
    }
    input.writeStdout("\n");
    return 0;
  };

  const runPlanTurn = async (noteRaw: string): Promise<number> => {
    const note = noteRaw.trim();
    if (!note) {
      return 0;
    }
    const stablePoint = capturePlanStablePoint();
    activeTurnPhase = "planning";
    try {
      if (await consumePendingInterrupt(stablePoint, "before_plan_turn")) {
        return 0;
      }
      const meta = input.runtimeState.getPlanMeta();
      if (!meta?.active_plan_id) {
        if (await consumePendingInterrupt(stablePoint, "before_plan_create")) {
          return 0;
        }
        return enterPlan(note);
      }
      if (await consumePendingInterrupt(stablePoint, "before_plan_progress_append")) {
        return 0;
      }
      const appended = appendPlanProgressNote(
        input.workDir,
        planSessionKey(),
        meta.active_plan_id,
        note,
      );
      if (!appended.updated) {
        input.writeStderr("[plan] failed to update active plan progress.\n");
        return 1;
      }
      if (await consumePendingInterrupt(stablePoint, "after_plan_progress_append")) {
        return 0;
      }
      const active = resolveActivePlan();
      if (active) {
        await persistPlanState(
          "plan_only",
          buildPlanMeta(active.entry, active.planPath),
        );
      }
      if (await consumePendingInterrupt(stablePoint, "after_plan_state_persist")) {
        return 0;
      }
      input.writeStdout(`[plan] updated file=${appended.planPath ?? "<unknown>"}\n\n`);
      return 0;
    } finally {
      if (pendingInterruptSource) {
        clearPendingInterruptAsIgnored(
          "plan_turn_finalize",
          "turn_completed_without_safe_cancel_point",
        );
      }
      activeTurnPhase = "idle";
    }
  };

  const cancelPlan = async (): Promise<number> => {
    const active = resolveActivePlan();
    if (!active) {
      input.writeStdout("[plan] no active plan to cancel.\n\n");
      await persistPlanState("normal", undefined);
      return 0;
    }
    const discarded = updatePlanArtifactStatus(
      input.workDir,
      planSessionKey(),
      active.entry.plan_id,
      "discarded",
    );
    if (!discarded) {
      input.writeStderr(
        `[plan] cancel failed, plan not found: ${active.entry.plan_id}\n`,
      );
      return 1;
    }
    await persistPlanState("normal", undefined);
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_mode_cancelled",
      plan_id: active.entry.plan_id,
      source: "cli",
      detail: "cancel command moved plan to discarded",
    });
    input.writeStdout(`[plan] cancelled plan_id=${active.entry.plan_id}\n\n`);
    return 0;
  };

  const applyPlan = async (extraRaw: string): Promise<number> => {
    const previousPhase = activeTurnPhase;
    activeTurnPhase = "applying";
    const stablePoint = capturePlanStablePoint();
    try {
      if (await consumePendingInterrupt(stablePoint, "before_apply_start")) {
        return 0;
      }
      const recovered = recoverStaleApprovedPlan(input.workDir, planSessionKey(), {
        source: "cli",
      });
      const active = resolveActivePlan();
      if (!active) {
        input.writeStderr("[plan] no active plan to apply. Use /plan <goal> first.\n\n");
        return 1;
      }
      if (recovered.recovered) {
        input.writeStdout(
          `[plan] recovered stale apply lock plan_id=${active.entry.plan_id} stale_ms=${String(recovered.stale_ms ?? 0)}\n`,
        );
      }
      if (active.entry.status === "applying") {
        input.writeStdout(
          `[plan] apply already in progress plan_id=${active.entry.plan_id}\n\n`,
        );
        return 0;
      }
      if (active.entry.status === "applied" || active.entry.status === "discarded") {
        input.writeStderr(
          `[plan] apply blocked by status=${active.entry.status} plan_id=${active.entry.plan_id}\n`,
        );
        return 1;
      }

      const review = reviewPlanContent(active.content);
      const reviewedEntry = recordPlanReviewResult(
        input.workDir,
        planSessionKey(),
        active.entry.plan_id,
        review,
        "cli",
      );
      if (!reviewedEntry) {
        input.writeStderr(
          `[plan] review failed, plan not found: ${active.entry.plan_id}\n`,
        );
        return 1;
      }
      await persistPlanState(
        "plan_only",
        buildPlanMeta(reviewedEntry, active.planPath),
      );
      if (!review.ok) {
        const reviewCode = review.blocked
          ? PLAN_REVIEW_BLOCKED_CODE
          : PLAN_REVIEW_FAILED_CODE;
        input.writeStderr(
          `[plan-review] code=${reviewCode} plan_id=${active.entry.plan_id} findings=${formatReviewFindings(review.findings)}\n\n`,
        );
        return 2;
      }

      const approval = approvePlanArtifact(
        input.workDir,
        planSessionKey(),
        active.entry.plan_id,
        {
          approvedBy: "cli",
          source: "cli",
        },
      );
      if (!approval.approved || !approval.entry || !approval.planHash || !approval.ticketId) {
        input.writeStderr(
          `[plan] approval failed plan_id=${active.entry.plan_id}\n`,
        );
        return 1;
      }

      await persistPlanState(
        "plan_only",
        buildPlanMeta(approval.entry, active.planPath),
      );

      const applying = updatePlanArtifactStatus(
        input.workDir,
        planSessionKey(),
        active.entry.plan_id,
        "applying",
      );
      if (!applying) {
        input.writeStderr(
          `[plan] failed to set applying status plan_id=${active.entry.plan_id}\n`,
        );
        return 1;
      }
      await persistPlanState(
        "plan_only",
        buildPlanMeta(applying, active.planPath),
      );

      const approvedPlanContent = parseApprovedContent(
        approval.snapshotPath,
        active.content,
      );
      const prompt = buildPlanApplyPrompt({
        approvedPlanContent,
        approvedHash: approval.planHash,
        ticketId: approval.ticketId,
        extra: extraRaw.trim(),
      });
      const code = await input.executeTurn(prompt, true);
      if (code === TURN_INTERRUPTED_EXIT_CODE) {
        const approvedAgain = updatePlanArtifactStatus(
          input.workDir,
          planSessionKey(),
          active.entry.plan_id,
          "approved",
        );
        await persistPlanState(
          "plan_only",
          buildPlanMeta(approvedAgain ?? approval.entry, active.planPath),
        );
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_apply_interrupted",
          plan_id: active.entry.plan_id,
          source: "cli",
          detail: `exit_code=${String(code)}`,
        });
        return code;
      }
      if (code !== 0) {
        const applyFailed = updatePlanArtifactStatus(
          input.workDir,
          planSessionKey(),
          active.entry.plan_id,
          "apply_failed",
        );
        await persistPlanState(
          "plan_only",
          buildPlanMeta(applyFailed ?? applying, active.planPath),
        );
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_apply_failed",
          plan_id: active.entry.plan_id,
          source: "cli",
          detail: `exit_code=${String(code)}`,
        });
        input.markFailureObserved();
        input.writeStderr(
          `[plan] apply failed plan_id=${active.entry.plan_id} exit_code=${String(code)}\n`,
        );
        return code;
      }

      const applied = updatePlanArtifactStatus(
        input.workDir,
        planSessionKey(),
        active.entry.plan_id,
        "applied",
      );
      await persistPlanState("normal", undefined);
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_apply_succeeded",
        plan_id: active.entry.plan_id,
        source: "cli",
        detail: "plan applied and exited plan_only",
      });
      return code;
    } finally {
      if (pendingInterruptSource) {
        clearPendingInterruptAsIgnored(
          "apply_finalize",
          "apply_phase_completed_or_failed",
        );
      }
      activeTurnPhase = previousPhase;
    }
  };

  const handleMessageInput = async (
    messageRaw: string,
  ): Promise<PlanMessageHandleResult> => {
    const message = messageRaw.trim();
    if (!message) {
      return { handled: false, code: 0 };
    }
    if (message === "/interrupt") {
      await requestPlanInterrupt("command");
      return { handled: true, code: 0 };
    }
    if (message.startsWith("/plan")) {
      const parsed = parsePlanCommand(message);
      if (parsed.kind === "invalid") {
        input.writeStdout(`${parsed.reason}\n\n`);
        return { handled: true, code: 0 };
      }
      if (parsed.kind === "enter") {
        return { handled: true, code: await enterPlan(parsed.goal) };
      }
      if (parsed.kind === "status") {
        return { handled: true, code: await showPlanStatus() };
      }
      if (parsed.kind === "apply") {
        return { handled: true, code: await applyPlan(parsed.extra) };
      }
      return { handled: true, code: await cancelPlan() };
    }
    if (input.runtimeState.getPlanMode() === "plan_only") {
      return { handled: true, code: await runPlanTurn(message) };
    }
    return { handled: false, code: 0 };
  };

  return {
    isPlanMode: (): boolean => input.runtimeState.getPlanMode() === "plan_only",
    enterPlan,
    showPlanStatus,
    runPlanTurn,
    applyPlan,
    cancelPlan,
    requestPlanInterrupt,
    handleMessageInput,
  };
}
