import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { updatePlanArtifactStatus } from "../../../cli/start/plan-artifact";
import { createRunStartPlanMode } from "../../../cli/start/plan-mode";
import {
  createRuntimeState,
  persistence,
  sanitizePlanSessionSegment,
  stripAnsi,
  validPlan,
} from "./helpers";

export async function runApprovalAndControlFlow(workDir: string) {
  const approvalWorkDir = resolve(workDir, "interactive-approval");
  mkdirSync(approvalWorkDir, { recursive: true });
  const approvalSessionKey = "feishu:grobot:dm:plan-mode-interactive-approval-contract";
  const approvalRuntimeState = createRuntimeState(approvalSessionKey);
  const approvalExecuteInputs: string[] = [];
  let approvalStdout = "";
  const approvalPlanMode = createRunStartPlanMode({
    workDir: approvalWorkDir,
    runtimeState: approvalRuntimeState,
    persistence,
    executeTurn: async (userInput) => {
      approvalExecuteInputs.push(userInput);
      return 0;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      approvalRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      approvalStdout += message;
    },
    writeStderr: () => undefined,
  });
  await approvalPlanMode.handleMessageInput("/plan approval flow", {
    messageMode: true,
  });
  const approvalPlanPath = approvalPlanMode.getActivePlanPath();
  if (!approvalPlanPath) {
    throw new Error("expected active plan path for approval contract");
  }
  writeFileSync(approvalPlanPath, `${validPlan}\n`, "utf8");
  const approvalRunResult = await approvalPlanMode.runPlanTurn("ready approval menu accepted", {
    requestReadyPlanApproval: async () => "approve",
  });

  const cancelApprovalWorkDir = resolve(workDir, "interactive-approval-cancel");
  mkdirSync(cancelApprovalWorkDir, { recursive: true });
  const cancelApprovalSessionKey = "feishu:grobot:dm:plan-mode-approval-cancel-contract";
  const cancelApprovalRuntimeState = createRuntimeState(cancelApprovalSessionKey);
  let cancelApprovalStdout = "";
  const cancelApprovalPlanMode = createRunStartPlanMode({
    workDir: cancelApprovalWorkDir,
    runtimeState: cancelApprovalRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      cancelApprovalRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      cancelApprovalStdout += message;
    },
    writeStderr: () => undefined,
  });
  await cancelApprovalPlanMode.handleMessageInput("/plan approval cancel", {
    messageMode: true,
  });
  const cancelApprovalPlanPath = cancelApprovalPlanMode.getActivePlanPath();
  if (!cancelApprovalPlanPath) {
    throw new Error("expected active plan path for approval cancel contract");
  }
  writeFileSync(cancelApprovalPlanPath, `${validPlan}\n`, "utf8");
  const cancelApprovalStdoutBeforeReady = cancelApprovalStdout;
  const cancelApprovalRunResult = await cancelApprovalPlanMode.runPlanTurn(
    "ready approval menu cancelled",
    {
      requestReadyPlanApproval: async () => ({
        action: "keep_planning",
        silent: true,
      }),
    },
  );
  const cancelApprovalOutput =
    cancelApprovalStdout.slice(cancelApprovalStdoutBeforeReady.length);

  const exitApprovalWorkDir = resolve(workDir, "interactive-approval-empty-exit");
  mkdirSync(exitApprovalWorkDir, { recursive: true });
  const exitApprovalSessionKey = "feishu:grobot:dm:plan-mode-approval-empty-exit-contract";
  const exitApprovalRuntimeState = createRuntimeState(exitApprovalSessionKey);
  const exitApprovalExecuteInputs: string[] = [];
  let exitApprovalStdout = "";
  const exitApprovalPlanMode = createRunStartPlanMode({
    workDir: exitApprovalWorkDir,
    runtimeState: exitApprovalRuntimeState,
    persistence,
    executeTurn: async (userInput) => {
      exitApprovalExecuteInputs.push(userInput);
      return 0;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      exitApprovalRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      exitApprovalStdout += message;
    },
    writeStderr: () => undefined,
  });
  await exitApprovalPlanMode.handleMessageInput("/plan empty exit", {
    messageMode: true,
  });
  const exitApprovalPlanPath = exitApprovalPlanMode.getActivePlanPath();
  if (!exitApprovalPlanPath) {
    throw new Error("expected active plan path for approval empty exit contract");
  }
  writeFileSync(exitApprovalPlanPath, `${validPlan}\n`, "utf8");
  const exitApprovalStdoutBeforeReady = exitApprovalStdout;
  const exitApprovalRunResult = await exitApprovalPlanMode.runPlanTurn(
    "ready approval exits without implementation",
    {
      requestReadyPlanApproval: async () => ({
        action: "exit_plan_mode",
        silent: true,
      }),
    },
  );
  const exitApprovalOutput =
    exitApprovalStdout.slice(exitApprovalStdoutBeforeReady.length);

  const approvalFeedbackWorkDir = resolve(workDir, "interactive-approval-with-feedback");
  mkdirSync(approvalFeedbackWorkDir, { recursive: true });
  const approvalFeedbackSessionKey = "feishu:grobot:dm:plan-mode-approval-feedback-contract";
  const approvalFeedbackRuntimeState = createRuntimeState(approvalFeedbackSessionKey);
  const approvalFeedbackExecuteInputs: string[] = [];
  const approvalFeedbackPlanMode = createRunStartPlanMode({
    workDir: approvalFeedbackWorkDir,
    runtimeState: approvalFeedbackRuntimeState,
    persistence,
    executeTurn: async (userInput) => {
      approvalFeedbackExecuteInputs.push(userInput);
      return 0;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      approvalFeedbackRuntimeState.markFailureObserved();
    },
    writeStdout: () => undefined,
    writeStderr: () => undefined,
  });
  await approvalFeedbackPlanMode.handleMessageInput("/plan approval with feedback", {
    messageMode: true,
  });
  const approvalFeedbackPlanPath = approvalFeedbackPlanMode.getActivePlanPath();
  if (!approvalFeedbackPlanPath) {
    throw new Error("expected active plan path for approval-with-feedback contract");
  }
  writeFileSync(approvalFeedbackPlanPath, `${validPlan}\n`, "utf8");
  const approvalFeedbackRunResult = await approvalFeedbackPlanMode.runPlanTurn(
    "ready approval menu accepted with feedback",
    {
      requestReadyPlanApproval: async () => ({
        action: "approve",
        feedback: "also tighten validation docs",
      }),
    },
  );

  const feedbackWorkDir = resolve(workDir, "interactive-approval-feedback");
  mkdirSync(feedbackWorkDir, { recursive: true });
  const feedbackSessionKey = "feishu:grobot:dm:plan-mode-feedback-contract";
  const feedbackRuntimeState = createRuntimeState(feedbackSessionKey);
  const feedbackExecuteInputs: string[] = [];
  let feedbackStdout = "";
  let feedbackApprovalCalls = 0;
  const feedbackPlanMode = createRunStartPlanMode({
    workDir: feedbackWorkDir,
    runtimeState: feedbackRuntimeState,
    persistence,
    executeTurn: async (userInput) => {
      feedbackExecuteInputs.push(userInput);
      return 0;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      feedbackRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      feedbackStdout += message;
    },
    writeStderr: () => undefined,
  });
  await feedbackPlanMode.handleMessageInput("/plan approval feedback", {
    messageMode: true,
  });
  const feedbackPlanPath = feedbackPlanMode.getActivePlanPath();
  if (!feedbackPlanPath) {
    throw new Error("expected active plan path for approval feedback contract");
  }
  writeFileSync(feedbackPlanPath, `${validPlan}\n`, "utf8");
  const feedbackRunResult = await feedbackPlanMode.runPlanTurn("ready approval menu feedback", {
    requestReadyPlanApproval: async () => {
      feedbackApprovalCalls += 1;
      if (feedbackApprovalCalls === 1) {
        return {
          action: "keep_planning",
          feedback: "make validation stricter",
        };
      }
      return "keep_planning";
    },
  });

  const normalInterruptWorkDir = resolve(workDir, "interrupt-normal-mode");
  mkdirSync(normalInterruptWorkDir, { recursive: true });
  const normalInterruptRuntimeState = createRuntimeState(
    "feishu:grobot:dm:plan-mode-interrupt-normal-contract",
  );
  let normalInterruptStdout = "";
  const normalInterruptPlanMode = createRunStartPlanMode({
    workDir: normalInterruptWorkDir,
    runtimeState: normalInterruptRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      normalInterruptRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      normalInterruptStdout += message;
    },
    writeStderr: () => undefined,
  });
  const normalInterruptHandled = await normalInterruptPlanMode.handleMessageInput("/interrupt");

  const idleInterruptWorkDir = resolve(workDir, "interrupt-idle-plan-mode");
  mkdirSync(idleInterruptWorkDir, { recursive: true });
  const idleInterruptRuntimeState = createRuntimeState(
    "feishu:grobot:dm:plan-mode-interrupt-idle-contract",
  );
  idleInterruptRuntimeState.setPlanMode("plan_only");
  let idleInterruptStdout = "";
  const idleInterruptPlanMode = createRunStartPlanMode({
    workDir: idleInterruptWorkDir,
    runtimeState: idleInterruptRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      idleInterruptRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      idleInterruptStdout += message;
    },
    writeStderr: () => undefined,
  });
  const idleInterruptResult = await idleInterruptPlanMode.requestPlanInterrupt("command");

  const emptyCancelWorkDir = resolve(workDir, "cancel-empty");
  mkdirSync(emptyCancelWorkDir, { recursive: true });
  const emptyCancelRuntimeState = createRuntimeState(
    "feishu:grobot:dm:plan-mode-cancel-empty-contract",
  );
  emptyCancelRuntimeState.setPlanMode("plan_only");
  let emptyCancelStdout = "";
  const emptyCancelPlanMode = createRunStartPlanMode({
    workDir: emptyCancelWorkDir,
    runtimeState: emptyCancelRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      emptyCancelRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      emptyCancelStdout += message;
    },
    writeStderr: () => undefined,
  });
  const emptyCancelResult = await emptyCancelPlanMode.cancelPlan();

  const activeCancelWorkDir = resolve(workDir, "cancel-active");
  mkdirSync(activeCancelWorkDir, { recursive: true });
  const activeCancelRuntimeState = createRuntimeState(
    "feishu:grobot:dm:plan-mode-cancel-active-contract",
  );
  let activeCancelStdout = "";
  const activeCancelPlanMode = createRunStartPlanMode({
    workDir: activeCancelWorkDir,
    runtimeState: activeCancelRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      activeCancelRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      activeCancelStdout += message;
    },
    writeStderr: () => undefined,
  });
  await activeCancelPlanMode.handleMessageInput("/plan active cancel surface", {
    messageMode: true,
  });
  const activeCancelStdoutBeforeCancel = activeCancelStdout;
  const activeCancelResult = await activeCancelPlanMode.cancelPlan();
  const activeCancelOutput = activeCancelStdout.slice(activeCancelStdoutBeforeCancel.length);

  const noActiveApplyWorkDir = resolve(workDir, "apply-no-active");
  mkdirSync(noActiveApplyWorkDir, { recursive: true });
  const noActiveApplyRuntimeState = createRuntimeState(
    "feishu:grobot:dm:plan-mode-apply-no-active-contract",
  );
  let noActiveApplyStderr = "";
  const noActiveApplyPlanMode = createRunStartPlanMode({
    workDir: noActiveApplyWorkDir,
    runtimeState: noActiveApplyRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      noActiveApplyRuntimeState.markFailureObserved();
    },
    writeStdout: () => undefined,
    writeStderr: (message) => {
      noActiveApplyStderr += message;
    },
  });
  const noActiveApplyResult = await noActiveApplyPlanMode.applyPlan("Implement the plan.");

  const applyingApplyWorkDir = resolve(workDir, "apply-already-applying");
  mkdirSync(applyingApplyWorkDir, { recursive: true });
  const applyingApplySessionKey = "feishu:grobot:dm:plan-mode-apply-applying-contract";
  const applyingApplyRuntimeState = createRuntimeState(applyingApplySessionKey);
  let applyingApplyStdout = "";
  const applyingApplyPlanMode = createRunStartPlanMode({
    workDir: applyingApplyWorkDir,
    runtimeState: applyingApplyRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      applyingApplyRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      applyingApplyStdout += message;
    },
    writeStderr: () => undefined,
  });
  await applyingApplyPlanMode.handleMessageInput("/plan already applying surface", {
    messageMode: true,
  });
  const applyingPlanId = applyingApplyRuntimeState.getPlanMeta()?.active_plan_id;
  if (!applyingPlanId) {
    throw new Error("expected active plan id for applying surface contract");
  }
  updatePlanArtifactStatus(
    applyingApplyWorkDir,
    applyingApplySessionKey,
    applyingPlanId,
    "applying",
  );
  const applyingApplyStdoutBeforeApply = applyingApplyStdout;
  const applyingApplyResult = await applyingApplyPlanMode.applyPlan("Implement the plan.");
  const applyingApplyOutput = applyingApplyStdout.slice(applyingApplyStdoutBeforeApply.length);

  const discardedApplyWorkDir = resolve(workDir, "apply-discarded");
  mkdirSync(discardedApplyWorkDir, { recursive: true });
  const discardedApplySessionKey = "feishu:grobot:dm:plan-mode-apply-discarded-contract";
  const discardedApplyRuntimeState = createRuntimeState(discardedApplySessionKey);
  let discardedApplyStderr = "";
  const discardedApplyPlanMode = createRunStartPlanMode({
    workDir: discardedApplyWorkDir,
    runtimeState: discardedApplyRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      discardedApplyRuntimeState.markFailureObserved();
    },
    writeStdout: () => undefined,
    writeStderr: (message) => {
      discardedApplyStderr += message;
    },
  });
  await discardedApplyPlanMode.handleMessageInput("/plan discarded apply surface", {
    messageMode: true,
  });
  const discardedPlanId = discardedApplyRuntimeState.getPlanMeta()?.active_plan_id;
  if (!discardedPlanId) {
    throw new Error("expected active plan id for discarded apply contract");
  }
  updatePlanArtifactStatus(
    discardedApplyWorkDir,
    discardedApplySessionKey,
    discardedPlanId,
    "discarded",
  );
  const discardedIndexPath = resolve(
    discardedApplyWorkDir,
    ".grobot/plans",
    sanitizePlanSessionSegment(discardedApplySessionKey),
    "index.json",
  );
  const discardedIndexPayload = JSON.parse(
    readFileSync(discardedIndexPath, "utf8"),
  ) as { active_plan_id?: string };
  discardedIndexPayload.active_plan_id = discardedPlanId;
  writeFileSync(discardedIndexPath, JSON.stringify(discardedIndexPayload, null, 2), "utf8");
  const discardedApplyResult = await discardedApplyPlanMode.applyPlan("Implement the plan.");

  return {
    ready_approval_cancel_returns_input_without_status_surface:
      cancelApprovalRunResult === 0
      && cancelApprovalRuntimeState.getPlanMode() === "plan_only"
      && !cancelApprovalOutput.includes("已继续留在 plan mode")
      && !cancelApprovalOutput.includes("准备开始实现？"),
    ready_approval_empty_exit_leaves_plan_mode:
      exitApprovalRunResult === 0
      && exitApprovalRuntimeState.getPlanMode() === "normal",
    ready_approval_empty_exit_does_not_apply:
      exitApprovalExecuteInputs.every((item) => !item.includes("[Approved Plan Execution]")),
    ready_approval_empty_exit_is_quiet:
      !exitApprovalOutput.includes("准备开始实现？")
      && !exitApprovalOutput.includes("计划已确认")
      && !exitApprovalOutput.includes("已继续留在 plan mode"),
    ready_approval_yes_executes_plan:
      approvalRunResult === 0
      && approvalExecuteInputs.length === 2
      && approvalExecuteInputs[1]?.includes("[Approved Plan Execution]"),
    ready_approval_yes_skips_text_fallback:
      approvalStdout.includes("计划已确认")
      && !approvalStdout.includes("准备开始实现？"),
    ready_approval_yes_matches_exit_plan_reference:
      approvalStdout.includes("计划已确认")
      && approvalStdout.includes("已确认 · 计划已保存: .grobot/plans/")
      && approvalStdout.includes("/plan open 编辑"),
    ready_approval_yes_exits_plan_mode:
      approvalRuntimeState.getPlanMode() === "normal",
    ready_approval_yes_with_feedback_adds_instruction:
      approvalFeedbackRunResult === 0
      && approvalFeedbackExecuteInputs.length === 2
      && approvalFeedbackExecuteInputs[1]?.includes("Additional user instruction:")
      && approvalFeedbackExecuteInputs[1]?.includes("also tighten validation docs"),
    ready_approval_yes_with_feedback_exits_plan_mode:
      approvalFeedbackRuntimeState.getPlanMode() === "normal",
    ready_approval_feedback_runs_followup_plan_turn:
      feedbackRunResult === 0
      && feedbackApprovalCalls === 2
      && feedbackExecuteInputs.includes("make validation stricter"),
    ready_approval_feedback_keeps_plan_mode:
      feedbackRuntimeState.getPlanMode() === "plan_only"
      && feedbackStdout.includes("已添加计划反馈，继续保持 plan mode"),
    plan_interrupt_command_normal_mode_is_human:
      normalInterruptHandled.handled
      && normalInterruptHandled.code === 0
      && stripAnsi(normalInterruptStdout).includes("当前不在 plan mode")
      && stripAnsi(normalInterruptStdout).includes("没有可中断的计划回合。")
      && !stripAnsi(normalInterruptStdout).includes("PLAN_INTERRUPT_NOT_PLAN_MODE")
      && !stripAnsi(normalInterruptStdout).includes("诊断:")
      && !normalInterruptStdout.includes("[plan-interrupt]"),
    plan_interrupt_idle_plan_mode_is_human:
      idleInterruptResult.code === "PLAN_INTERRUPT_NOT_RUNNING"
      && idleInterruptResult.accepted === false
      && idleInterruptResult.phase === "idle"
      && stripAnsi(idleInterruptStdout).includes("当前没有运行中的 plan 回合")
      && stripAnsi(idleInterruptStdout).includes("如果想退出 plan mode，可按 Esc 或使用 /exit。")
      && !stripAnsi(idleInterruptStdout).includes("PLAN_INTERRUPT_NOT_RUNNING")
      && !stripAnsi(idleInterruptStdout).includes("诊断:")
      && !idleInterruptStdout.includes("[plan-interrupt]"),
    plan_cancel_empty_surface_is_human:
      emptyCancelResult === 0
      && emptyCancelRuntimeState.getPlanMode() === "normal"
      && stripAnsi(emptyCancelStdout).includes("当前没有可取消的计划")
      && stripAnsi(emptyCancelStdout).includes('使用 "/plan <goal>" 开始新计划')
      && !emptyCancelStdout.includes("[plan]")
      && !emptyCancelStdout.includes("plan_id="),
    plan_cancel_active_surface_is_human:
      activeCancelResult === 0
      && activeCancelRuntimeState.getPlanMode() === "normal"
      && stripAnsi(activeCancelOutput).includes("已取消计划")
      && !activeCancelOutput.includes("[plan]")
      && !activeCancelOutput.includes("plan_id="),
    plan_apply_no_active_surface_is_human:
      noActiveApplyResult === 1
      && stripAnsi(noActiveApplyStderr).includes("当前没有可执行的计划")
      && stripAnsi(noActiveApplyStderr).includes('请先使用 "/plan <goal>" 写出计划。')
      && stripAnsi(noActiveApplyStderr).includes("诊断: PLAN_APPLY_NO_ACTIVE_PLAN")
      && !noActiveApplyStderr.includes("[plan]")
      && !noActiveApplyStderr.includes("plan_id="),
    plan_apply_already_applying_surface_is_human:
      applyingApplyResult === 0
      && stripAnsi(applyingApplyOutput).includes("计划正在执行中")
      && stripAnsi(applyingApplyOutput).includes("请等待当前执行完成；需要停止时按 Esc。")
      && !applyingApplyOutput.includes("[plan]")
      && !applyingApplyOutput.includes("plan_id="),
    plan_apply_invalid_status_surface_is_human:
      discardedApplyResult === 1
      && stripAnsi(discardedApplyStderr).includes("当前计划不能执行")
      && stripAnsi(discardedApplyStderr).includes("状态: 已取消")
      && stripAnsi(discardedApplyStderr).includes("诊断: PLAN_APPLY_INVALID_STATUS")
      && !discardedApplyStderr.includes("[plan]")
      && !discardedApplyStderr.includes("plan_id="),
  };
}
