import { resolvePlanFailureDecision } from "./plan-failure-policy";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  createPlanArtifact,
  loadActivePlanArtifact,
  resolvePlanQualityGuardPolicy,
  resolvePlanQualityGuardMode,
  replacePlanArtifactContent,
} from "./plan-artifact";
import { runPlanApply } from "./plan-mode/apply-runner";
import { runPlanCancel } from "./plan-mode/cancel-runner";
import { createPlanInterruptController } from "./plan-mode/interrupt-controller";
import { runPlanMessageInput } from "./plan-mode/message-handler";
import {
  reviewActivePlanDecisionState as reviewActivePlanDecisionStateCore,
  type PlanQualityGuardRuntime,
} from "./plan-mode/quality-runtime";
import {
  normalizePlanReadyApprovalDecision,
  type PlanInterruptResult,
  type PlanInterruptSource,
  type PlanMessageHandleResult,
  type PlanReadyApprovalDecision,
  type PlanReadyApprovalRequest,
  type PlanStablePoint,
  type RunStartPlanMode,
  type RunStartPlanTurnOptions,
  type PlanTurnPhase,
} from "./plan-mode/contract";
import { writePlanActivityDiagnostic } from "./plan-mode/activity";
import { buildPlanMeta, humanizePlanPhase } from "./plan-mode/meta";
import { extractLatestAssistantProposedPlan } from "./plan-mode/proposal";
import {
  buildExitedPlanModeSurface,
  buildPlanApplyStateSurface,
  buildPlanKeptInPlanningSurface,
  buildPlanModeEnteredSurface,
  buildPlanNeedsRefinementSurface,
  buildPlanUpdatedSurface,
  buildReadyToCodeSurface,
  createPlanTurnDiagnosticStderr,
  formatHumanPlanFilePath,
  shouldRenderCompactPlanFailureSurface,
  writePlanFailureSurface,
} from "./plan-mode/surfaces";
import { renderPlanSurface } from "./plan-mode/info-surface";
import { showPlanStatus as showRunStartPlanStatus } from "./plan-mode/status";
import { buildPlanModeWorkflowPrompt } from "./plan-mode/workflow-prompt";
import { type RunStartPersistence } from "./persistence";
import { type RunStartRuntimeState } from "./runtime-state";
import { derivePlanPhaseFromStatus, PLAN_EXECUTION_REPLY } from "./plan-state";
import {
  setSessionPlanState,
  type SessionPlanMeta,
  type SessionPlanMode,
} from "./session-registry";
import { TURN_INTERRUPTED_EXIT_CODE } from "./turn";
import { terminalStyle } from "../tui/theme/terminal-style";

export type {
  PlanInterruptResult,
  PlanInterruptSource,
  PlanReadyApprovalDecision,
  PlanReadyApprovalRequest,
  RunStartPlanMode,
  RunStartPlanTurnOptions,
} from "./plan-mode/contract";

interface CreateRunStartPlanModeInput {
  workDir: string;
  runtimeState: RunStartRuntimeState;
  persistence: RunStartPersistence;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      promptPrelude?: string;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
  requestRuntimeInterrupt(source: PlanInterruptSource): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  markFailureObserved(): void;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export function createRunStartPlanMode(
  input: CreateRunStartPlanModeInput,
): RunStartPlanMode {
  const planSessionKey = (): string => input.runtimeState.getSessionKey();
  const resolveQualityGuardRuntime = (): PlanQualityGuardRuntime => {
    const policyResolved = resolvePlanQualityGuardPolicy({
      workDir: input.workDir,
    });
    const guardMode = resolvePlanQualityGuardMode(
      process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
      policyResolved.policy.defaults.mode,
    );
    return {
      ...policyResolved,
      guardMode,
    };
  };
  let activeTurnPhase: PlanTurnPhase = "idle";

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

  const planInterrupts = createPlanInterruptController({
    workDir: input.workDir,
    planSessionKey,
    getPlanMode: () => input.runtimeState.getPlanMode(),
    getActiveTurnPhase: () => activeTurnPhase,
    resolveActivePlanId,
    persistPlanState,
    requestRuntimeInterrupt: input.requestRuntimeInterrupt,
    writeStdout: input.writeStdout,
  });

  const consumePendingInterrupt = planInterrupts.consume;
  const clearPendingInterruptAsIgnored = planInterrupts.clearAsIgnored;
  const requestPlanInterrupt = planInterrupts.request;

  const resolveActivePlan = () =>
    loadActivePlanArtifact(input.workDir, planSessionKey());

  const printPlanModeHint = (
    writeStdout: (message: string) => void = input.writeStdout,
  ): void => {
    writeStdout(
      [
        "计划模式只读；直接输入需求即可继续完善计划。",
        "可执行计划需要明确范围、里程碑、验证命令/预期结果和回滚步骤。",
        "使用 /plan open 查看计划文件。",
        "确认后回复“开始实现计划”即可执行。",
        "",
      ].join("\n"),
    );
  };

  const createPlanModeDraft = async (
    goalForTitleRaw: string,
    options?: {
      printHint?: boolean;
      printModeReadyOnly?: boolean;
      writeStdout?: (message: string) => void;
    },
  ): Promise<number> => {
    const writeStdout = options?.writeStdout ?? input.writeStdout;
    const compactGoal = goalForTitleRaw.trim();
    const draftTitle = compactGoal.length > 0 ? compactGoal : "plan session";
    const created = createPlanArtifact(
      input.workDir,
      planSessionKey(),
      draftTitle,
    );
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
    void options?.printModeReadyOnly;
    writeStdout(
      buildPlanModeEnteredSurface({
        workDir: input.workDir,
        planPath: created.planPath,
        goal: compactGoal,
      }),
    );
    if (options?.printHint !== false) {
      printPlanModeHint(writeStdout);
    }
    return 0;
  };

  const enterPlan = async (
    goalRaw: string,
    options?: RunStartPlanTurnOptions,
  ): Promise<number> => {
    const goal = goalRaw.trim();
    writePlanActivityDiagnostic(options, "enter_started");
    if (!goal) {
      const created = await createPlanModeDraft("", {
        printHint: false,
        printModeReadyOnly: true,
        writeStdout: options?.writeStdout,
      });
      writePlanActivityDiagnostic(options, "draft_created");
      return created;
    }
    const entered = await createPlanModeDraft(goal, {
      printHint: false,
      printModeReadyOnly: false,
      writeStdout: options?.writeStdout,
    });
    writePlanActivityDiagnostic(options, "draft_created");
    if (entered !== 0) {
      return entered;
    }
    return runPlanTurn(goal, options);
  };

  const showPlanStatus = async (): Promise<number> => {
    return showRunStartPlanStatus({
      workDir: input.workDir,
      runtimeState: input.runtimeState,
      writeStdout: input.writeStdout,
    });
  };

  const reviewActivePlanDecisionState = (
    active: NonNullable<ReturnType<typeof resolveActivePlan>>,
  ) =>
    reviewActivePlanDecisionStateCore({
      workDir: input.workDir,
      sessionId: planSessionKey(),
      active,
      resolveQualityGuardRuntime,
      persistPlanMeta: (planMeta) => persistPlanState("plan_only", planMeta),
    });

  const runPlanTurn = async (
    noteRaw: string,
    options?: RunStartPlanTurnOptions,
  ): Promise<number> => {
    const writeStdout = options?.writeStdout ?? input.writeStdout;
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
      let meta = input.runtimeState.getPlanMeta();
      if (!meta?.active_plan_id) {
        if (await consumePendingInterrupt(stablePoint, "before_plan_create")) {
          return 0;
        }
        const entered = await createPlanModeDraft(note, {
          printHint: false,
          printModeReadyOnly: false,
          writeStdout,
        });
        if (entered !== 0) {
          return entered;
        }
        meta = input.runtimeState.getPlanMeta();
        if (!meta?.active_plan_id) {
          input.writeStderr(
            buildPlanApplyStateSurface({
              kind: "internal_failure",
              detail: "进入计划模式后没有生成活动计划。",
              diagnostic: "PLAN_ENTER_ACTIVE_PLAN_MISSING",
            }),
          );
          return 1;
        }
      }
      if (
        await consumePendingInterrupt(
          stablePoint,
          "before_plan_progress_append",
        )
      ) {
        return 0;
      }
      const appended = appendPlanProgressNote(
        input.workDir,
        planSessionKey(),
        meta.active_plan_id,
        note,
      );
      if (!appended.updated) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "internal_failure",
            workDir: input.workDir,
            planPath: meta.active_plan_path,
            detail: "无法写入计划进度备注。",
            diagnostic: "PLAN_PROGRESS_APPEND_FAILED",
          }),
        );
        return 1;
      }
      writePlanActivityDiagnostic(options, "progress_saved");
      if (
        await consumePendingInterrupt(stablePoint, "after_plan_progress_append")
      ) {
        return 0;
      }
      const active = resolveActivePlan();
      if (active) {
        await persistPlanState(
          "plan_only",
          buildPlanMeta(active.entry, active.planPath),
        );
      }
      if (
        await consumePendingInterrupt(stablePoint, "after_plan_state_persist")
      ) {
        return 0;
      }
      if (options?.skipExecution) {
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_turn_skipped",
          plan_id: meta.active_plan_id,
          source: "cli",
          detail: "message_mode_execution_skipped",
        });
        writeStdout("计划备注已保存。\n\n");
        return 0;
      }
      const historyLengthBeforeExecution =
        input.runtimeState.getHistoryMessages().length;
      const compactFailureSurface = shouldRenderCompactPlanFailureSurface(
        options?.diagnosticsMode,
      );
      const planTurnStderr = createPlanTurnDiagnosticStderr({
        writeStderr: options?.writeStderr ?? input.writeStderr,
        compactFailureSurface,
      });
      if (options?.showWorkingNotice) {
        writeStdout(renderPlanSurface({
          title: "正在规划...",
          rows: [{
            title: "模型正在生成计划草稿。",
          }],
        }));
      }
      writePlanActivityDiagnostic(options, "model_planning", "phase=planning");
      let code: number;
      const activeForPrompt = resolveActivePlan();
      try {
        code = await input.executeTurn(note, true, {
          promptPrelude: buildPlanModeWorkflowPrompt({
            planFilePath: activeForPrompt?.planPath
              ? formatHumanPlanFilePath({
                  workDir: input.workDir,
                  planPath: activeForPrompt.planPath,
                })
              : undefined,
          }),
          writeStdout,
          writeStderr: planTurnStderr.writeStderr,
        });
      } finally {
        planTurnStderr.flush();
      }
      if (code === TURN_INTERRUPTED_EXIT_CODE) {
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_turn_interrupted",
          plan_id: meta.active_plan_id,
          source: "cli",
          detail: `exit_code=${String(code)}`,
        });
        return code;
      }
      if (code !== 0) {
        const failureDecision = resolvePlanFailureDecision({
          phase: "planning",
          exitCode: code,
          providerStates: input.runtimeState.getProviderRuntimeStates(),
        });
        if (failureDecision.action === "degrade") {
          const detailParts = [
            `exit_code=${String(code)}`,
            "policy_action=degrade",
            `policy_reason=${failureDecision.reason}`,
            `diagnostic_code=${failureDecision.diagnosticCode}`,
          ];
          if (failureDecision.providerName) {
            detailParts.push(`provider=${failureDecision.providerName}`);
          }
          if (failureDecision.errorClass) {
            detailParts.push(`class=${failureDecision.errorClass}`);
          }
          appendPlanEvent(input.workDir, planSessionKey(), {
            event: "plan_turn_degraded",
            plan_id: meta.active_plan_id,
            source: "cli",
            detail: `${detailParts.join(" ")} degraded=true`,
          });
          const hint =
            failureDecision.hint ?? "请检查 semantic index 和检索配置。";
          writeStdout(`计划上下文已降级 · 草稿已保留。${hint}\n\n`);
          return 0;
        }
        const detailParts = [
          `exit_code=${String(code)}`,
          "policy_action=fail",
          `policy_reason=${failureDecision.reason}`,
          `diagnostic_code=${failureDecision.diagnosticCode}`,
        ];
        if (failureDecision.providerName) {
          detailParts.push(`provider=${failureDecision.providerName}`);
        }
        if (failureDecision.errorClass) {
          detailParts.push(`class=${failureDecision.errorClass}`);
        }
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_turn_failed",
          plan_id: meta.active_plan_id,
          source: "cli",
          detail: detailParts.join(" "),
        });
        input.markFailureObserved();
        writePlanFailureSurface({
          phase: "planning",
          planId: meta.active_plan_id,
          workDir: input.workDir,
          planPath: meta.active_plan_path,
          exitCode: code,
          compactFailureSurface,
          failureDecision,
          writeStderr: input.writeStderr,
        });
        return code;
      }
      writePlanActivityDiagnostic(options, "model_returned");
      const assistantProposedPlan = extractLatestAssistantProposedPlan(
        input.runtimeState.getHistoryMessages(),
        historyLengthBeforeExecution,
      );
      if (assistantProposedPlan && meta.active_plan_id) {
        const replaced = replacePlanArtifactContent(
          input.workDir,
          planSessionKey(),
          meta.active_plan_id,
          assistantProposedPlan.content,
          {
            source: "system",
            detail: `ingested <proposed_plan> from assistant history_index=${String(assistantProposedPlan.historyIndex)}`,
          },
        );
        if (replaced.updated && replaced.planPath) {
          if (replaced.replaced) {
            const refreshedActive = resolveActivePlan();
            if (refreshedActive) {
              await persistPlanState(
                "plan_only",
                buildPlanMeta(refreshedActive.entry, refreshedActive.planPath),
              );
            }
            appendPlanEvent(input.workDir, planSessionKey(), {
              event: "plan_proposed_plan_ingested",
              plan_id: meta.active_plan_id,
              source: "system",
              detail: `history_index=${String(assistantProposedPlan.historyIndex)} chars=${String(assistantProposedPlan.content.length)}`,
            });
            writePlanActivityDiagnostic(options, "proposed_plan_ingested");
          }
        }
      }
      const reviewedActive = resolveActivePlan();
      if (!reviewedActive) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "internal_failure",
            workDir: input.workDir,
            planPath: meta.active_plan_path,
            detail: "计划更新后活动计划消失，无法继续评审。",
            diagnostic: "PLAN_REVIEW_ACTIVE_PLAN_MISSING",
          }),
        );
        return 1;
      }
      writePlanActivityDiagnostic(options, "review_started");
      const decisionState = await reviewActivePlanDecisionState(reviewedActive);
      if (!decisionState) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "internal_failure",
            workDir: input.workDir,
            planPath: meta.active_plan_path,
            detail: "未找到计划记录，无法完成评审。",
            diagnostic: "PLAN_REVIEW_ENTRY_MISSING",
          }),
        );
        return 1;
      }
      const planPhase =
        derivePlanPhaseFromStatus(decisionState.reviewedEntry.status) ??
        "drafting";
      if (!decisionState.review.ok) {
        writePlanActivityDiagnostic(options, "review_needs_refinement");
        const topRepairAction = decisionState.repairActions[0];
        writeStdout(
          buildPlanNeedsRefinementSurface(
            topRepairAction?.title ?? decisionState.recommendation.reason,
          ),
        );
        return 0;
      }
      if (decisionState.reviewedEntry.status === "ready") {
        const readyApprovalRequest = {
          workDir: input.workDir,
          planPath: reviewedActive.planPath,
          planContent: reviewedActive.content,
        };
        writePlanActivityDiagnostic(options, "approval_waiting");
        const approvalDecision = normalizePlanReadyApprovalDecision(
          await options?.requestReadyPlanApproval?.(readyApprovalRequest),
        );
        if (approvalDecision.action === "approve") {
          const feedback = approvalDecision.feedback?.trim();
          return applyPlan(
            feedback && feedback.length > 0 ? feedback : PLAN_EXECUTION_REPLY,
            options,
          );
        }
        if (approvalDecision.action === "exit_plan_mode") {
          await persistPlanState("normal", undefined);
          if (approvalDecision.silent !== true) {
            writeStdout(buildExitedPlanModeSurface());
          }
          return code;
        }
        if (approvalDecision.action === "keep_planning") {
          const feedback = approvalDecision.feedback?.trim();
          if (feedback) {
            writeStdout("已添加计划反馈，继续保持计划模式...\n\n");
            return runPlanTurn(feedback, options);
          }
          if (approvalDecision.silent !== true) {
            writeStdout(buildPlanKeptInPlanningSurface());
          }
          return code;
        }
        writeStdout(buildReadyToCodeSurface(readyApprovalRequest));
      } else {
        writePlanActivityDiagnostic(options, "plan_updated");
        writeStdout(
          buildPlanUpdatedSurface({
            phase: humanizePlanPhase(planPhase),
            nextAction: decisionState.recommendation.action,
          }),
        );
      }
      return code;
    } finally {
      if (planInterrupts.hasPending()) {
        clearPendingInterruptAsIgnored(
          "plan_turn_finalize",
          "turn_completed_without_safe_cancel_point",
        );
      }
      activeTurnPhase = "idle";
    }
  };

  const cancelPlan = async (): Promise<number> => {
    return runPlanCancel({
      workDir: input.workDir,
      planSessionKey,
      resolveActivePlan,
      persistPlanState,
      writeStdout: input.writeStdout,
      writeStderr: input.writeStderr,
    });
  };

  const applyPlan = async (
    extraRaw: string,
    options?: RunStartPlanTurnOptions,
  ): Promise<number> => {
    writePlanActivityDiagnostic(options, "apply_review_started");
    const previousPhase = activeTurnPhase;
    activeTurnPhase = "applying";
    const stablePoint = capturePlanStablePoint();
    try {
      return await runPlanApply({
        workDir: input.workDir,
        runtimeState: input.runtimeState,
        extraRaw,
        options,
        stablePoint,
        planSessionKey,
        resolveActivePlan,
        resolveQualityGuardRuntime,
        consumePendingInterrupt,
        persistPlanState,
        executeTurn: input.executeTurn,
        markFailureObserved: input.markFailureObserved,
        writeStdout: input.writeStdout,
        writeStderr: input.writeStderr,
      });
    } finally {
      if (planInterrupts.hasPending()) {
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
    options?: {
      messageMode?: boolean;
    },
  ): Promise<PlanMessageHandleResult> => {
    return runPlanMessageInput({
      messageRaw,
      messageMode: options?.messageMode,
      isPlanMode: () => input.runtimeState.getPlanMode() === "plan_only",
      writeStdout: input.writeStdout,
      requestInterrupt: () =>
        requestPlanInterrupt("command").then(() => undefined),
      createDraft: createPlanModeDraft,
      enterPlan,
      showStatus: showPlanStatus,
      applyPlan,
      runPlanTurn,
    });
  };

  return {
    isPlanMode: (): boolean => input.runtimeState.getPlanMode() === "plan_only",
    getActivePlanPath: (): string | undefined => {
      const active = resolveActivePlan();
      if (active?.planPath) {
        return active.planPath;
      }
      const metaPath = input.runtimeState.getPlanMeta()?.active_plan_path;
      return typeof metaPath === "string" && metaPath.trim().length > 0
        ? metaPath
        : undefined;
    },
    enterPlan,
    showPlanStatus,
    runPlanTurn,
    applyPlan,
    cancelPlan,
    requestPlanInterrupt,
    handleMessageInput,
  };
}
