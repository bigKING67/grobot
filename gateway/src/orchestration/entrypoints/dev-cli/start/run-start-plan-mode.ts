import { parsePlanCommand, parsePlanQuickReply } from "./plan-command";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  buildPlanApplyPrompt,
  createPlanArtifact,
  loadActivePlanArtifact,
  recoverStaleApprovedPlan,
  updatePlanArtifactStatus,
} from "./plan-artifact";
import { type RunStartPersistence } from "./run-start-persistence";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { setSessionPlanState, type SessionPlanMeta, type SessionPlanMode } from "./session-registry";

interface CreateRunStartPlanModeInput {
  workDir: string;
  runtimeState: RunStartRuntimeState;
  persistence: RunStartPersistence;
  executeTurn(userInput: string, interactiveMode: boolean): Promise<number>;
  markFailureObserved(): void;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

interface PlanMessageHandleResult {
  handled: boolean;
  code: number;
}

const PLAN_GUARD_CODE = "PLAN_GUARD_DENIED";

export interface RunStartPlanMode {
  isPlanMode(): boolean;
  enterPlan(goal: string): Promise<number>;
  showPlanStatus(): Promise<number>;
  showPlanContent(): Promise<number>;
  showPlanOptions(): Promise<number>;
  runPlanTurn(note: string): Promise<number>;
  applyPlan(extra: string): Promise<number>;
  discardPlan(): Promise<number>;
  handleMessageInput(message: string): Promise<PlanMessageHandleResult>;
}

function buildPlanMetaFromActive(active: {
  entry: {
    plan_id: string;
    status: "draft" | "approved" | "apply_failed" | "applied" | "discarded";
    seq: number;
    title: string;
    updated_at: string;
  };
  planPath: string;
}): SessionPlanMeta {
  return {
    active_plan_id: active.entry.plan_id,
    active_plan_status: active.entry.status,
    active_plan_path: active.planPath,
    active_plan_seq: active.entry.seq,
    active_plan_title: active.entry.title,
    updated_at: active.entry.updated_at,
  };
}

export function createRunStartPlanMode(input: CreateRunStartPlanModeInput): RunStartPlanMode {
  const planSessionKey = (): string => input.runtimeState.getSessionKey();
  const planOptionsText = (): string =>
    [
      "[plan-options]",
      "1) apply current plan (/plan apply)",
      "2) show plan markdown (/plan show)",
      "3) continue planning (send text to append)",
      "4) discard plan (/plan discard)",
      "none of these: <note> (append custom note)",
      "",
    ].join("\n");

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

  const enterPlan = async (goalRaw: string): Promise<number> => {
    const goal = goalRaw.trim();
    if (!goal) {
      input.writeStdout("Usage: /plan <goal>\n\n");
      return 0;
    }
    const created = createPlanArtifact(input.workDir, planSessionKey(), goal);
    const planMeta = buildPlanMetaFromActive({
      entry: created.entry,
      planPath: created.planPath,
    });
    await persistPlanState("plan_only", planMeta);
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_mode_entered",
      plan_id: created.entry.plan_id,
      source: "cli",
      detail: "entered plan_only mode",
    });
    input.writeStdout(
      `[plan] entered PLAN_ONLY session_key=${planSessionKey()} plan_id=${created.entry.plan_id} file=${created.planPath}\n\n`,
    );
    input.writeStdout(planOptionsText());
    return 0;
  };

  const resolveActivePlan = () => loadActivePlanArtifact(input.workDir, planSessionKey());

  const showPlanStatus = async (): Promise<number> => {
    const mode = input.runtimeState.getPlanMode();
    const meta = input.runtimeState.getPlanMeta();
    const active = resolveActivePlan();
    input.writeStdout("[plan-status]\n");
    input.writeStdout(`mode: ${mode}\n`);
    if (meta?.active_plan_id) {
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
    } else if (active) {
      input.writeStdout(`active_plan_id: ${active.entry.plan_id}\n`);
      input.writeStdout(`active_plan_status: ${active.entry.status}\n`);
      input.writeStdout(`active_plan_path: ${active.planPath}\n`);
      input.writeStdout(`active_plan_seq: ${String(active.entry.seq)}\n`);
      input.writeStdout(`active_plan_title: ${active.entry.title}\n`);
    } else {
      input.writeStdout("active_plan_id: <none>\n");
    }
    input.writeStdout("\n");
    return 0;
  };

  const showPlanContent = async (): Promise<number> => {
    const active = resolveActivePlan();
    if (!active) {
      input.writeStdout("[plan] no active plan. Use /plan <goal> first.\n\n");
      return 0;
    }
    input.writeStdout(`[plan] file=${active.planPath}\n`);
    input.writeStdout(`${active.content.trimEnd()}\n\n`);
    return 0;
  };

  const showPlanOptions = async (): Promise<number> => {
    input.writeStdout(planOptionsText());
    return 0;
  };

  const runPlanTurn = async (noteRaw: string): Promise<number> => {
    const note = noteRaw.trim();
    if (!note) {
      return 0;
    }
    const quickReply = parsePlanQuickReply(note);
    if (quickReply.kind === "option") {
      if (quickReply.value === 1) {
        return applyPlan("");
      }
      if (quickReply.value === 2) {
        return showPlanContent();
      }
      if (quickReply.value === 3) {
        input.writeStdout("[plan] continue planning. Send your update and it will be appended.\n\n");
        return 0;
      }
      return discardPlan();
    }
    if (quickReply.kind === "none") {
      if (!quickReply.note) {
        input.writeStdout("[plan] please provide note after `none of these:`.\n\n");
        return 0;
      }
      return runPlanTurn(quickReply.note);
    }
    if (quickReply.kind === "empty") {
      return 0;
    }
    const normalizedNote = quickReply.note;
    const meta = input.runtimeState.getPlanMeta();
    if (!meta?.active_plan_id) {
      return enterPlan(normalizedNote);
    }
    const appended = appendPlanProgressNote(
      input.workDir,
      planSessionKey(),
      meta.active_plan_id,
      normalizedNote,
    );
    if (!appended.updated) {
      input.writeStderr("[plan] failed to update active plan progress.\n");
      return 1;
    }
    const active = resolveActivePlan();
    if (active) {
      await persistPlanState("plan_only", buildPlanMetaFromActive(active));
    }
    input.writeStdout(`[plan] updated file=${appended.planPath ?? "<unknown>"}\n\n`);
    return 0;
  };

  const discardPlan = async (): Promise<number> => {
    const meta = input.runtimeState.getPlanMeta();
    if (!meta?.active_plan_id) {
      input.writeStdout("[plan] no active plan to discard.\n\n");
      return 0;
    }
    const updated = updatePlanArtifactStatus(
      input.workDir,
      planSessionKey(),
      meta.active_plan_id,
      "discarded",
    );
    if (!updated) {
      input.writeStderr(`[plan] discard failed, plan not found: ${meta.active_plan_id}\n`);
      return 1;
    }
    await persistPlanState("normal", {
      ...meta,
      active_plan_status: "discarded",
      updated_at: updated.updated_at,
    });
    input.writeStdout(`[plan] discarded plan_id=${meta.active_plan_id}\n\n`);
    return 0;
  };

  const applyPlan = async (extra: string): Promise<number> => {
    const recovered = recoverStaleApprovedPlan(input.workDir, planSessionKey(), {
      source: "cli",
    });
    const active = resolveActivePlan();
    if (!active) {
      input.writeStdout("[plan] no active plan to apply. Use /plan <goal> first.\n\n");
      return 1;
    }
    if (recovered.recovered) {
      input.writeStdout(
        `[plan] recovered stale apply lock plan_id=${active.entry.plan_id} stale_ms=${String(recovered.stale_ms ?? 0)}\n`,
      );
    }
    if (active.entry.status === "approved") {
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_apply_idempotent_hit",
        plan_id: active.entry.plan_id,
        source: "cli",
        detail: "status=approved",
      });
      input.writeStdout(`[plan] apply already in progress plan_id=${active.entry.plan_id}\n\n`);
      return 0;
    }
    if (active.entry.status !== "draft" && active.entry.status !== "apply_failed") {
      input.writeStderr(`[plan] apply blocked by status=${active.entry.status} plan_id=${active.entry.plan_id}\n`);
      return 1;
    }
    const approved = updatePlanArtifactStatus(
      input.workDir,
      planSessionKey(),
      active.entry.plan_id,
      "approved",
    );
    if (!approved) {
      input.writeStderr(`[plan] apply failed, plan not found: ${active.entry.plan_id}\n`);
      return 1;
    }
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_apply_started",
      plan_id: active.entry.plan_id,
      source: "cli",
      detail: "status moved to approved",
    });
    await persistPlanState("plan_only", {
      ...buildPlanMetaFromActive(active),
      active_plan_status: "approved",
      updated_at: approved.updated_at,
    });
    const prompt = buildPlanApplyPrompt(active.content, extra);
    const code = await input.executeTurn(prompt, true);
    if (code !== 0) {
      const applyFailed = updatePlanArtifactStatus(
        input.workDir,
        planSessionKey(),
        active.entry.plan_id,
        "apply_failed",
      );
      await persistPlanState("plan_only", {
        ...buildPlanMetaFromActive(active),
        active_plan_status: "apply_failed",
        updated_at: applyFailed?.updated_at ?? active.entry.updated_at,
      });
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_apply_failed",
        plan_id: active.entry.plan_id,
        source: "cli",
        detail: `exit_code=${String(code)}`,
      });
      input.markFailureObserved();
      input.writeStderr(`[plan] apply failed plan_id=${active.entry.plan_id} exit_code=${String(code)}\n`);
      return code;
    }
    const applied = updatePlanArtifactStatus(
      input.workDir,
      planSessionKey(),
      active.entry.plan_id,
      "applied",
    );
    await persistPlanState("normal", {
      ...buildPlanMetaFromActive(active),
      active_plan_status: "applied",
      updated_at: applied?.updated_at ?? active.entry.updated_at,
    });
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_apply_succeeded",
      plan_id: active.entry.plan_id,
      source: "cli",
      detail: "plan applied and exited plan_only",
    });
    return code;
  };

  const handleMessageInput = async (messageRaw: string): Promise<PlanMessageHandleResult> => {
    const message = messageRaw.trim();
    if (!message) {
      return { handled: false, code: 0 };
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
      if (parsed.kind === "show") {
        return { handled: true, code: await showPlanContent() };
      }
      if (parsed.kind === "options") {
        return { handled: true, code: await showPlanOptions() };
      }
      if (parsed.kind === "apply") {
        return { handled: true, code: await applyPlan(parsed.extra) };
      }
      return { handled: true, code: await discardPlan() };
    }
    if (input.runtimeState.getPlanMode() === "plan_only") {
      const quickReply = parsePlanQuickReply(message);
      if (quickReply.kind === "option") {
        if (quickReply.value === 1) {
          return { handled: true, code: await applyPlan("") };
        }
        if (quickReply.value === 2) {
          return { handled: true, code: await showPlanContent() };
        }
        if (quickReply.value === 3) {
          return { handled: true, code: await showPlanOptions() };
        }
        return { handled: true, code: await discardPlan() };
      }
      if (quickReply.kind === "none" && quickReply.note) {
        return { handled: true, code: await runPlanTurn(quickReply.note) };
      }
      input.writeStderr(
        `[plan-guard] code=${PLAN_GUARD_CODE} detail=plan_only blocks normal execution; use /plan apply to execute.\n\n`,
      );
      const active = resolveActivePlan();
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_guard_denied",
        plan_id: active?.entry.plan_id ?? input.runtimeState.getPlanMeta()?.active_plan_id,
        source: "cli",
        detail: "plan_only blocked non-plan command",
      });
      return { handled: true, code: 2 };
    }
    return { handled: false, code: 0 };
  };

  return {
    isPlanMode: (): boolean => input.runtimeState.getPlanMode() === "plan_only",
    enterPlan,
    showPlanStatus,
    showPlanContent,
    showPlanOptions,
    runPlanTurn,
    applyPlan,
    discardPlan,
    handleMessageInput,
  };
}
