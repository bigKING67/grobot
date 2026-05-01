import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  reviewPlanContent,
  updatePlanArtifactStatus,
} from "../../orchestration/entrypoints/dev-cli/start/plan-artifact";
import { createRunStartPlanMode } from "../../orchestration/entrypoints/dev-cli/start/run-start-plan-mode";
import { type RunStartPersistence } from "../../orchestration/entrypoints/dev-cli/start/run-start-persistence";
import { type RunStartRuntimeState } from "../../orchestration/entrypoints/dev-cli/start/run-start-runtime-state";
import { type ChatHistoryMessage } from "../../orchestration/entrypoints/dev-cli/start/session-history";
import {
  type SessionPlanMeta,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
} from "../../orchestration/entrypoints/dev-cli/start/session-registry";

function sanitizePlanSessionSegment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const fallback = normalized.length > 0 ? normalized : "main";
  return fallback.slice(0, 64);
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function createRuntimeState(sessionKey: string): RunStartRuntimeState {
  const now = nowIsoUtc();
  const sessionRegistry: SessionRegistryPayload = {
    version: 1,
    namespace_key: sessionKey,
    active_id: "main",
    sessions: [
      {
        id: "main",
        session_key: sessionKey,
        created_at: now,
        updated_at: now,
        preview: "contract",
      },
    ],
  };
  let planMode: "normal" | "plan_only" = "normal";
  let planMeta: SessionPlanMeta | undefined;
  let providerStates: SessionProviderRuntimeState[] = [];
  let historyMessages: ChatHistoryMessage[] = [];
  let failureObserved = false;
  return {
    getSessionRegistry: () => sessionRegistry,
    getActiveSessionId: () => "main",
    setActiveSessionId: () => undefined,
    getSessionKey: () => sessionKey,
    setSessionKey: () => undefined,
    getHistoryMessages: () => historyMessages,
    setHistoryMessages: (rows: ChatHistoryMessage[]) => {
      historyMessages = rows;
    },
    getRestoreSource: () => "empty",
    markHistoryCompacted: () => undefined,
    hasHistoryCompacted: () => false,
    markFailureObserved: () => {
      failureObserved = true;
    },
    hasFailureObserved: () => failureObserved,
    getRestoredTurns: () => 0,
    getStickyProvider: () => undefined,
    setStickyProvider: () => undefined,
    getProviderRuntimeStates: () => providerStates,
    setProviderRuntimeStates: (rows: SessionProviderRuntimeState[]) => {
      providerStates = rows;
    },
    getPlanMode: () => planMode,
    setPlanMode: (value: "normal" | "plan_only") => {
      planMode = value;
    },
    getPlanMeta: () => planMeta,
    setPlanMeta: (value: SessionPlanMeta | undefined) => {
      planMeta = value;
    },
    getGaState: () => undefined,
    setGaState: () => undefined,
  };
}

async function main(): Promise<void> {
  const workDir = resolve(
    process.cwd(),
    ".grobot-contract-temp",
    `plan-mode-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`,
  );
  mkdirSync(workDir, { recursive: true });
  const sessionKey = "feishu:grobot:dm:plan-mode-contract";
  const runtimeState = createRuntimeState(sessionKey);
  const persistence: RunStartPersistence = {
    persistHistoryState: async () => undefined,
    persistSessionRegistryState: async () => undefined,
  };
  let stdout = "";
  let stderr = "";
  const executeInputs: string[] = [];
  const executePromptPreludes: string[] = [];
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalEditor = process.env.EDITOR;
  const originalVisual = process.env.VISUAL;
  process.env.EDITOR = "vim";
  delete process.env.VISUAL;
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });

  const validPlan = [
    "# Contract Plan",
    "",
    "- session_id: feishu:grobot:dm:plan-mode-contract",
    "- plan_id: p_contract",
    "- seq: 1",
    "- status: draft",
    "",
    "## Goal",
    "",
    "验证精简后的 plan 机制流：只保留 /plan、/plan <goal>、/plan open 与自然语言执行。",
    "",
    "## Scope In",
    "",
    "- 校验旧子命令被软失效。",
    "- 校验 /plan open 会回到状态面。",
    "- 校验 Implement the plan. 仍可触发执行。",
    "",
    "## Scope Out",
    "",
    "- 不恢复 approve/reject/verify/benchmark 命令表面。",
    "",
    "## Milestones",
    "",
    "1. [ ] 收敛命令面",
    "   - 完成判据: 只暴露 /plan、/plan <goal>、/plan open。",
    "   - 验证: contract 断言通过。",
    "   - 回退: 恢复旧命令面前重新评估交互复杂度。",
    "",
    "## Validation",
    "",
    "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/run-start-plan-mode-contract.ts；预期: exit 0 且所有断言通过。",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: 旧帮助文案或 contract 未同步。",
    "- 回退: 恢复精简前 surface 并重新整理说明。",
    "",
  ].join("\n");

  const review = reviewPlanContent(validPlan);
  const weakValidationReview = reviewPlanContent(
    validPlan.replace(
      "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/run-start-plan-mode-contract.ts；预期: exit 0 且所有断言通过。",
      "- 看一下是否正常。",
    ),
  );
  const weakRiskReview = reviewPlanContent(
    validPlan
      .replace("- 风险: 旧帮助文案或 contract 未同步。", "- 风险: 低")
      .replace("- 回退: 恢复精简前 surface 并重新整理说明。", "- 回退: 回滚"),
  );
  const canonicalProposedPlanReview = reviewPlanContent(
    `<proposed_plan>\n${validPlan}\n</proposed_plan>`,
  );

  try {
    const planMode = createRunStartPlanMode({
      workDir,
      runtimeState,
      persistence,
      executeTurn: async (userInput, _interactiveMode, options) => {
        executeInputs.push(userInput);
        executePromptPreludes.push(options?.promptPrelude ?? "");
        return 0;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => {
        runtimeState.markFailureObserved();
      },
      writeStdout: (message) => {
        stdout += message;
      },
      writeStderr: (message) => {
        stderr += message;
      },
    });

    const enter = await planMode.handleMessageInput("/plan contract cleanup", {
      messageMode: true,
    });
    const stdoutAfterEnter = stdout;
    const planModeAfterEnter = runtimeState.getPlanMode();
    const planPath = planMode.getActivePlanPath();
    if (!planPath) {
      throw new Error("expected active plan path after /plan <goal>");
    }
    const stdoutBeforeDraftOpen = stdout;
    const draftOpen = await planMode.handleMessageInput("/plan open");
    const draftOpenOutput = stdout.slice(stdoutBeforeDraftOpen.length);
    const stdoutBeforeRefine = stdout;
    const refine = await planMode.runPlanTurn("refine contract cleanup");
    const refineOutput = stdout.slice(stdoutBeforeRefine.length);
    writeFileSync(planPath, `${validPlan}\n`, "utf8");
    const stdoutBeforeReady = stdout;
    const ready = await planMode.runPlanTurn("ready for approval");
    const readyOutput = stdout.slice(stdoutBeforeReady.length);
    const readyApprovalRequests: Array<{ planPath: string; planContent: string }> = [];
    const stdoutBeforeKeepPlanning = stdout;
    const keepPlanning = await planMode.runPlanTurn("ready approval menu declined", {
      requestReadyPlanApproval: async (request) => {
        readyApprovalRequests.push({
          planPath: request.planPath,
          planContent: request.planContent,
        });
        return "keep_planning";
      },
    });
    const keepPlanningOutput = stdout.slice(stdoutBeforeKeepPlanning.length);

    const stdoutBeforeOpen = stdout;
    const open = await planMode.handleMessageInput("/plan open");
    const openOutput = stdout.slice(stdoutBeforeOpen.length);
    const stdoutBeforeVerboseOpen = stdout;
    const originalVerbose = process.env.GROBOT_PLAN_STATUS_VERBOSE;
    process.env.GROBOT_PLAN_STATUS_VERBOSE = "1";
    const verboseOpen = await planMode.handleMessageInput("/plan open");
    const verboseOpenOutput = stdout.slice(stdoutBeforeVerboseOpen.length);
    if (typeof originalVerbose === "string") {
      process.env.GROBOT_PLAN_STATUS_VERBOSE = originalVerbose;
    } else {
      delete process.env.GROBOT_PLAN_STATUS_VERBOSE;
    }
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    const stdoutBeforeScriptOpen = stdout;
    const scriptOpen = await planMode.handleMessageInput("/plan open");
    const scriptOpenOutput = stdout.slice(stdoutBeforeScriptOpen.length);
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    const executeCountBeforePlanGoalInPlan = executeInputs.length;
    const stdoutBeforePlanGoalInPlan = stdout;
    const planGoalInPlan = await planMode.handleMessageInput("/plan second contract goal");
    const planGoalInPlanOutput = stdout.slice(stdoutBeforePlanGoalInPlan.length);
    const executeCountAfterPlanGoalInPlan = executeInputs.length;
    const activePlanIdBeforeApply = runtimeState.getPlanMeta()?.active_plan_id;
    const executeCountBeforeApply = executeInputs.length;
    const stdoutBeforeApply = stdout;
    const execute = await planMode.handleMessageInput("Implement the plan.");
    const applyOutput = stdout.slice(stdoutBeforeApply.length);
    const applyPrompt = executeInputs[executeInputs.length - 1] ?? "";
    const stdoutBeforeLatestPlanStatus = stdout;
    const latestPlanStatusCode = await planMode.showPlanStatus();
    const latestPlanStatusOutput = stdout.slice(stdoutBeforeLatestPlanStatus.length);

    const eventsPath = resolve(
      workDir,
      ".grobot/plans",
      sanitizePlanSessionSegment(sessionKey),
      "events.jsonl",
    );
    const eventsText = readFileSync(eventsPath, "utf8");

    const failureWorkDir = resolve(workDir, "failure");
    mkdirSync(failureWorkDir, { recursive: true });
    const failureSessionKey = "feishu:grobot:dm:plan-mode-failure-contract";
    const failureRuntimeState = createRuntimeState(failureSessionKey);
    let failureStderr = "";
    const failurePlanMode = createRunStartPlanMode({
      workDir: failureWorkDir,
      runtimeState: failureRuntimeState,
      persistence,
      executeTurn: async (_userInput, _interactiveMode, options) => {
        failureRuntimeState.setProviderRuntimeStates([{
          provider_name: "mock",
          consecutive_failures: 1,
          circuit_open_until_ms: 0,
          last_error_class: "upstream_connect_failed",
          last_error_message: "runtime rpc error -32001",
          last_failed_at: nowIsoUtc(),
        }]);
        options?.writeStderr?.(
          "[runtime-route] failed attempts=1 providers=mock errors=mock:upstream_connect_failed\n",
        );
        options?.writeStderr?.(
          "runtime failed: provider=mock RuntimeRpcError: runtime rpc error -32001\n",
        );
        return 1;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => {
        failureRuntimeState.markFailureObserved();
      },
      writeStdout: () => undefined,
      writeStderr: (message) => {
        failureStderr += message;
      },
    });
    const failureResultCode = await failurePlanMode.enterPlan("provider failure");

    const overrideWorkDir = resolve(workDir, "stdout-override");
    mkdirSync(overrideWorkDir, { recursive: true });
    const overrideSessionKey = "feishu:grobot:dm:plan-mode-stdout-override-contract";
    const overrideRuntimeState = createRuntimeState(overrideSessionKey);
    let fallbackStdout = "";
    let overrideStdout = "";
    const stdoutOverridePlanMode = createRunStartPlanMode({
      workDir: overrideWorkDir,
      runtimeState: overrideRuntimeState,
      persistence,
      executeTurn: async (_userInput, _interactiveMode, options) => {
        options?.writeStdout?.("runtime output through override\n");
        return 0;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => {
        overrideRuntimeState.markFailureObserved();
      },
      writeStdout: (message) => {
        fallbackStdout += message;
      },
      writeStderr: () => undefined,
    });
    const stdoutOverrideResult = await stdoutOverridePlanMode.enterPlan("stdout override", {
      writeStdout: (message) => {
        overrideStdout += message;
      },
      showWorkingNotice: true,
    });

    const verboseFailureWorkDir = resolve(workDir, "verbose-failure");
    mkdirSync(verboseFailureWorkDir, { recursive: true });
    const verboseFailureSessionKey = "feishu:grobot:dm:plan-mode-verbose-failure-contract";
    const verboseFailureRuntimeState = createRuntimeState(verboseFailureSessionKey);
    let verboseFailureStderr = "";
    const originalFailureVerbose = process.env.GROBOT_PLAN_STATUS_VERBOSE;
    process.env.GROBOT_PLAN_STATUS_VERBOSE = "1";
    const verboseFailurePlanMode = createRunStartPlanMode({
      workDir: verboseFailureWorkDir,
      runtimeState: verboseFailureRuntimeState,
      persistence,
      executeTurn: async (_userInput, _interactiveMode, options) => {
        verboseFailureRuntimeState.setProviderRuntimeStates([{
          provider_name: "mock",
          consecutive_failures: 1,
          circuit_open_until_ms: 0,
          last_error_class: "upstream_connect_failed",
          last_error_message: "runtime rpc error -32001",
          last_failed_at: nowIsoUtc(),
        }]);
        options?.writeStderr?.(
          "[runtime-route] failed attempts=1 providers=mock errors=mock:upstream_connect_failed\n",
        );
        options?.writeStderr?.(
          "runtime failed: provider=mock RuntimeRpcError: runtime rpc error -32001\n",
        );
        return 1;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => {
        verboseFailureRuntimeState.markFailureObserved();
      },
      writeStdout: () => undefined,
      writeStderr: (message) => {
        verboseFailureStderr += message;
      },
    });
    const verboseFailureResultCode = await verboseFailurePlanMode.enterPlan(
      "provider verbose failure",
    );
    if (typeof originalFailureVerbose === "string") {
      process.env.GROBOT_PLAN_STATUS_VERBOSE = originalFailureVerbose;
    } else {
      delete process.env.GROBOT_PLAN_STATUS_VERBOSE;
    }

    const applyFailureWorkDir = resolve(workDir, "apply-failure");
    mkdirSync(applyFailureWorkDir, { recursive: true });
    const applyFailureSessionKey = "feishu:grobot:dm:plan-mode-apply-failure-contract";
    const applyFailureRuntimeState = createRuntimeState(applyFailureSessionKey);
    let applyFailureStderr = "";
    const applyFailurePlanMode = createRunStartPlanMode({
      workDir: applyFailureWorkDir,
      runtimeState: applyFailureRuntimeState,
      persistence,
      executeTurn: async (_userInput, _interactiveMode, options) => {
        applyFailureRuntimeState.setProviderRuntimeStates([{
          provider_name: "mock",
          consecutive_failures: 1,
          circuit_open_until_ms: 0,
          last_error_class: "upstream_connect_failed",
          last_error_message: "runtime rpc error -32001",
          last_failed_at: nowIsoUtc(),
        }]);
        options?.writeStderr?.(
          "[runtime-route] failed attempts=1 providers=mock errors=mock:upstream_connect_failed\n",
        );
        options?.writeStderr?.(
          "runtime failed: provider=mock RuntimeRpcError: runtime rpc error -32001\n",
        );
        return 1;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => {
        applyFailureRuntimeState.markFailureObserved();
      },
      writeStdout: () => undefined,
      writeStderr: (message) => {
        applyFailureStderr += message;
      },
    });
    await applyFailurePlanMode.handleMessageInput("/plan implementation failure", {
      messageMode: true,
    });
    const applyFailurePlanPath = applyFailurePlanMode.getActivePlanPath();
    if (!applyFailurePlanPath) {
      throw new Error("expected active plan path for apply failure contract");
    }
    writeFileSync(applyFailurePlanPath, `${validPlan}\n`, "utf8");
    const applyFailureResult = await applyFailurePlanMode.handleMessageInput("Implement the plan.");

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

    const payload = {
      review_passes_for_valid_plan: review.ok && review.blocked === false,
      enter_plan_message_mode_handled: enter.handled && enter.code === 0,
      enter_plan_sets_plan_only: planModeAfterEnter === "plan_only",
      enter_plan_stdout_is_human:
        stdoutAfterEnter.includes("已进入 plan mode")
        && stdoutAfterEnter.includes("Grobot 正在探索")
        && !stdoutAfterEnter.includes("session_key=")
        && !stdoutAfterEnter.includes("plan_id=")
        && !stdoutAfterEnter.includes("file=")
        && !stdoutAfterEnter.includes("[plan] entered PLAN_ONLY"),
      enter_plan_surface_has_relative_planning_path:
        stdoutAfterEnter.includes("计划文件: .grobot/plans/"),
      enter_plan_surface_has_goal:
        stdoutAfterEnter.includes("目标: contract cleanup"),
      enter_plan_surface_has_read_only_boundary:
        stdoutAfterEnter.includes("确认计划前，plan mode 只会读取和规划。"),
      enter_plan_surface_hides_absolute_plan_path:
        !stdoutAfterEnter.includes(workDir),
      enter_plan_surface_order_is_stable:
        stdoutAfterEnter.indexOf("已进入 plan mode") >= 0
        && stdoutAfterEnter.indexOf("计划文件:") > stdoutAfterEnter.indexOf("已进入 plan mode")
        && stdoutAfterEnter.indexOf("目标:") > stdoutAfterEnter.indexOf("计划文件:"),
      draft_plan_surface_handled: draftOpen.handled && draftOpen.code === 0,
      draft_plan_surface_uses_status_title:
        draftOpenOutput.includes("计划草稿"),
      draft_plan_surface_uses_relative_plan_file:
        /^\.grobot\/plans\//m.test(draftOpenOutput),
      draft_plan_surface_has_read_only_boundary:
        draftOpenOutput.includes("确认最终计划前，plan mode 只会读取和规划。"),
      draft_plan_surface_has_refine_hint:
        draftOpenOutput.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
      draft_plan_surface_hides_absolute_path:
        !draftOpenOutput.includes(workDir),
      draft_plan_surface_hides_required_placeholders:
        !draftOpenOutput.includes("__REQUIRED__"),
      draft_plan_surface_avoids_legacy_empty_message:
        !draftOpenOutput.includes("Already in plan mode. No plan written yet."),
      refine_plan_turn_handled: refine === 0,
      refine_plan_turn_surface_matches_reference_shape:
        refineOutput.includes("●")
        && refineOutput.includes("计划需要继续完善")
        && refineOutput.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
      ready_plan_turn_handled: ready === 0,
      ready_surface_matches_reference_shape:
        readyOutput.includes("准备开始实现？")
        && readyOutput.includes("Grobot 的计划：")
        && readyOutput.includes("执行前请确认计划。")
        && readyOutput.includes("是否开始执行？")
        && readyOutput.includes("❯ 确认，开始实现计划")
        && readyOutput.includes("  继续完善计划")
        && readyOutput.includes("编辑: /plan open"),
      ready_surface_has_plan_separators:
        readyOutput.split("\n").some((line) => /^┄{24,}$/.test(line))
        && readyOutput.split("\n").some((line) => /^─{24,}$/.test(line)),
      ready_approval_callback_receives_current_plan:
        keepPlanning === 0
        && readyApprovalRequests.length === 1
        && readyApprovalRequests[0]?.planPath === planPath
        && readyApprovalRequests[0]?.planContent.includes("# Contract Plan"),
      ready_approval_keep_planning_skips_fallback_surface:
        keepPlanningOutput.includes("已继续留在 plan mode")
        && !keepPlanningOutput.includes("准备开始实现？"),
      ready_approval_keep_planning_matches_reference_shape:
        keepPlanningOutput.includes("●")
        && keepPlanningOutput.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
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
        && stripAnsi(normalInterruptStdout).includes("诊断: PLAN_INTERRUPT_NOT_PLAN_MODE")
        && !normalInterruptStdout.includes("[plan-interrupt]"),
      plan_interrupt_idle_plan_mode_is_human:
        idleInterruptResult.code === "PLAN_INTERRUPT_NOT_RUNNING"
        && idleInterruptResult.accepted === false
        && idleInterruptResult.phase === "idle"
        && stripAnsi(idleInterruptStdout).includes("当前没有运行中的 plan 回合")
        && stripAnsi(idleInterruptStdout).includes("如果想退出 plan mode，可按 Esc 或使用 /exit。")
        && stripAnsi(idleInterruptStdout).includes("诊断: PLAN_INTERRUPT_NOT_RUNNING")
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
      plan_turn_injects_plan_workflow_prompt:
        executePromptPreludes.some((item) =>
          item.includes("[Plan Mode Workflow]")
          && item.includes("MUST NOT make any edits")
          && item.includes("Plan File Info:")
          && item.includes("<proposed_plan>")),
      plan_turn_prompt_requires_strict_plan_sections:
        executePromptPreludes.some((item) =>
          item.includes("Validation must include real commands")
          && item.includes("Risk & Rollback must name concrete failure modes")),
      review_rejects_validation_without_command:
        !weakValidationReview.ok
        && weakValidationReview.findings.some((item) => item.code === "validation_missing_command"),
      review_rejects_validation_without_expected_result:
        !weakValidationReview.ok
        && weakValidationReview.findings.some((item) => item.code === "validation_missing_expected_result"),
      review_rejects_vague_risk:
        !weakRiskReview.ok
        && weakRiskReview.findings.some((item) => item.code === "risk_too_vague"),
      review_rejects_vague_rollback:
        !weakRiskReview.ok
        && weakRiskReview.findings.some((item) => item.code === "rollback_too_vague"),
      review_accepts_canonical_proposed_plan_block:
        canonicalProposedPlanReview.ok && canonicalProposedPlanReview.blocked === false,
      active_plan_path_present: typeof planPath === "string" && planPath.length > 0,
      open_plan_surface_handled: open.handled && open.code === 0,
      open_plan_surface_is_current_plan_display:
        openOutput.includes("当前计划")
        && openOutput.includes("# Contract Plan")
        && (
          openOutput.includes('使用 "/plan open" 编辑此计划')
          || openOutput.includes('使用 "/plan open" 在 vim 中编辑此计划')
        ),
      open_plan_surface_has_editor_hint:
        openOutput.includes('使用 "/plan open" 在 vim 中编辑此计划'),
      open_plan_surface_hides_machine_fields_by_default:
        !openOutput.includes("plan_status_output_mode:")
        && !openOutput.includes("active_plan_phase:")
        && !openOutput.includes("suggested_action_command:")
        && !openOutput.includes("session_id:")
        && !openOutput.includes("plan_id:")
        && !openOutput.includes("seq:")
        && !openOutput.includes("status:"),
      open_plan_surface_uses_relative_plan_file:
        /^\.grobot\/plans\//m.test(openOutput),
      open_plan_surface_hides_absolute_plan_file:
        !openOutput.includes(workDir),
      verbose_plan_surface_handled: verboseOpen.handled && verboseOpen.code === 0,
      verbose_plan_surface_preserves_machine_fields:
        verboseOpenOutput.includes("plan_status_output_mode: full")
        && verboseOpenOutput.includes("active_plan_phase: awaiting_decision")
        && verboseOpenOutput.includes("suggested_action_command: Implement the plan."),
      script_plan_surface_defaults_to_human_summary:
        scriptOpen.handled
        && scriptOpen.code === 0
        && scriptOpenOutput.includes("当前计划")
        && scriptOpenOutput.includes("# Contract Plan")
        && (
          scriptOpenOutput.includes('使用 "/plan open" 编辑此计划')
          || scriptOpenOutput.includes('使用 "/plan open" 在 vim 中编辑此计划')
        ),
      script_plan_surface_has_editor_hint:
        scriptOpenOutput.includes('使用 "/plan open" 在 vim 中编辑此计划'),
      script_plan_surface_hides_machine_fields_by_default:
        !scriptOpenOutput.includes("plan_status_output_mode:")
        && !scriptOpenOutput.includes("active_plan_phase:")
        && !scriptOpenOutput.includes("suggested_action_command:")
        && !scriptOpenOutput.includes("session_id:")
        && !scriptOpenOutput.includes("plan_id:")
        && !scriptOpenOutput.includes("seq:")
        && !scriptOpenOutput.includes("status:"),
      script_plan_surface_uses_relative_plan_file:
        /^\.grobot\/plans\//m.test(scriptOpenOutput),
      script_plan_surface_hides_absolute_plan_file:
        !scriptOpenOutput.includes(workDir),
      plan_goal_in_plan_mode_shows_current_plan:
        planGoalInPlan.handled
        && planGoalInPlan.code === 0
        && planGoalInPlanOutput.includes("当前计划")
        && planGoalInPlanOutput.includes("# Contract Plan"),
      plan_goal_in_plan_mode_skips_new_query:
        executeCountAfterPlanGoalInPlan === executeCountBeforePlanGoalInPlan,
      execute_natural_language_handled: execute.handled && execute.code === 0,
      execute_triggered_runtime_turn: executeInputs.length === executeCountBeforeApply + 1,
      execute_payload_is_not_literal_phrase:
        applyPrompt.trim() !== "Implement the plan.",
      execute_payload_has_approved_plan_contract:
        applyPrompt.includes("[Approved Plan Execution]")
        && applyPrompt.includes("Plan approval:")
        && applyPrompt.includes("Execution contract:")
        && applyPrompt.includes("Plan to implement:")
        && applyPrompt.includes("<approved_plan>")
        && applyPrompt.includes("</approved_plan>"),
      execute_payload_has_approval_metadata:
        applyPrompt.includes("- ticket:")
        && applyPrompt.includes("- sha256:"),
      execute_payload_has_scope_guardrails:
        applyPrompt.includes("Do not silently expand scope beyond Scope In")
        && applyPrompt.includes("stop and return to plan mode with the conflict")
        && applyPrompt.includes("validation aligned with the plan's Milestones and Validation sections"),
      execute_payload_contains_approved_plan_snapshot:
        applyPrompt.includes("# Contract Plan")
        && applyPrompt.includes("## Validation")
        && applyPrompt.includes("## Risk & Rollback"),
      execute_payload_omits_plain_trigger_as_extra:
        !applyPrompt.includes("Additional user instruction:\nImplement the plan."),
      apply_surface_shows_approved_plan_start:
        applyOutput.includes("计划已确认")
        && applyOutput.includes("已确认")
        && applyOutput.includes("将要实现的计划")
        && applyOutput.includes("开始按已确认快照实现"),
      apply_surface_has_saved_plan_hint:
        applyOutput.includes("已确认 · 计划已保存: .grobot/plans/")
        && applyOutput.includes("/plan open 编辑"),
      apply_surface_renders_plan_card:
        applyOutput.includes("╭─ 将要实现的计划")
        && applyOutput.includes("│ Contract Plan")
        && applyOutput.includes("│ 目标:")
        && applyOutput.includes("│ 验证:")
        && applyOutput.includes("╰─ 确认"),
      apply_surface_hides_machine_fields:
        !applyOutput.includes("plan_id=")
        && !applyOutput.includes("session_key=")
        && !applyOutput.includes("approved_snapshot_path"),
      latest_plan_status_surface_is_human:
        latestPlanStatusCode === 0
        && stripAnsi(latestPlanStatusOutput).includes("最近计划状态")
        && stripAnsi(latestPlanStatusOutput).includes("当前没有活跃计划。")
        && stripAnsi(latestPlanStatusOutput).includes("最近计划: contract cleanup · 已执行"),
      latest_plan_status_surface_hides_plan_id:
        typeof activePlanIdBeforeApply === "string"
        && !latestPlanStatusOutput.includes(activePlanIdBeforeApply)
        && !latestPlanStatusOutput.includes("plan_id")
        && !latestPlanStatusOutput.includes("p_contract"),
      apply_surface_hides_plan_metadata_preview:
        !applyOutput.includes("session_id:")
        && !applyOutput.includes("plan_id:")
        && !applyOutput.includes("seq:")
        && !applyOutput.includes("status:"),
      apply_surface_does_not_echo_literal_trigger:
        !applyOutput.includes("Implement the plan."),
      execute_exits_plan_only: runtimeState.getPlanMode() === "normal",
      execute_clears_active_plan_meta: runtimeState.getPlanMeta() === undefined,
      events_has_apply_succeeded: eventsText.includes("\"event\":\"plan_apply_succeeded\""),
      events_has_verification_pending: eventsText.includes("\"event\":\"plan_verification_pending\""),
      compact_plan_turn_failure_code_preserved: failureResultCode === 1,
      plan_turn_stdout_override_captures_plan_scaffolding:
        stdoutOverrideResult === 0
        && overrideStdout.includes("已进入 plan mode")
        && overrideStdout.includes("正在规划...")
        && overrideStdout.includes("runtime output through override")
        && overrideStdout.includes("计划需要继续完善"),
      plan_turn_working_notice_has_plan_bullet:
        stripAnsi(overrideStdout).includes("● 正在规划..."),
      plan_turn_stdout_override_skips_fallback_writer: fallbackStdout.length === 0,
      compact_plan_turn_failure_surface_human:
        failureStderr.includes("计划更新失败")
        && failureStderr.includes("Provider 不可用: mock (upstream_connect_failed)。")
        && failureStderr.includes("计划已保存: .grobot/plans/")
        && failureStderr.includes("计划草稿已保留")
        && failureStderr.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。')
        && failureStderr.includes("诊断: PLAN_PROVIDER_RUNTIME_FAILURE"),
      compact_plan_turn_failure_hides_machine_lines:
        !failureStderr.includes("runtime failed:")
        && !failureStderr.includes("[runtime-route] failed attempts=")
        && !failureStderr.includes("plan_id="),
      verbose_plan_turn_failure_preserves_machine_lines:
        verboseFailureResultCode === 1
        && verboseFailureStderr.includes("runtime failed:")
        && verboseFailureStderr.includes("[plan] turn failed plan_id="),
      compact_plan_apply_failure_code_preserved:
        applyFailureResult.handled && applyFailureResult.code === 1,
      compact_plan_apply_failure_surface_human:
        applyFailureStderr.includes("计划实现失败")
        && applyFailureStderr.includes("Provider 不可用: mock (upstream_connect_failed)。")
        && applyFailureStderr.includes("计划已保存: .grobot/plans/")
        && applyFailureStderr.includes("计划仍可用")
        && applyFailureStderr.includes("再回复“开始实现计划”")
        && applyFailureStderr.includes("诊断: PLAN_PROVIDER_RUNTIME_FAILURE"),
      compact_plan_apply_failure_hides_machine_lines:
        !applyFailureStderr.includes("runtime failed:")
        && !applyFailureStderr.includes("[runtime-route] failed attempts=")
        && !applyFailureStderr.includes("plan_id="),
      stderr_empty_on_success_path: stderr.trim().length === 0,
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalStdinIsTTY,
    });
    if (typeof originalEditor === "string") {
      process.env.EDITOR = originalEditor;
    } else {
      delete process.env.EDITOR;
    }
    if (typeof originalVisual === "string") {
      process.env.VISUAL = originalVisual;
    } else {
      delete process.env.VISUAL;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

void main();
