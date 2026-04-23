import {
  createRunStartInteractiveModeInput,
  resolvePlanMenuInitialItemId,
  resolvePlanMenuPrimaryAction,
  resolvePlanMenuPrimaryReason,
  resolvePlanMenuTailItemOrder,
} from "../../orchestration/entrypoints/dev-cli/start/run-start-interactive-bindings";
import { type ChatHistoryMessage } from "../../orchestration/entrypoints/dev-cli/start/session-history";
import {
  createGaMechanismRuntime,
  type GaSessionStateSnapshot,
} from "../../orchestration/entrypoints/dev-cli/services/ga-mechanism-runtime";
import { normalizeAskUserEnvelopeFromPayload } from "../../tools/ask-user";
import {
  type SessionPlanMeta,
  type SessionPlanMode,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
} from "../../orchestration/entrypoints/dev-cli/start/session-registry";
import { type SessionStoreRuntime } from "../../orchestration/entrypoints/dev-cli/services/session-store";
import { type RunStartModelOps } from "../../orchestration/entrypoints/dev-cli/start/run-start-model-ops";
import { type RunStartPlanMode } from "../../orchestration/entrypoints/dev-cli/start/run-start-plan-mode";
import { type RunStartRuntimeState } from "../../orchestration/entrypoints/dev-cli/start/run-start-runtime-state";
import { type RunStartSessionMenuOps } from "../../orchestration/entrypoints/dev-cli/start/run-start-session-menu-ops";
import {
  type RuntimeFailoverConfig,
  type RuntimeProviderCandidate,
} from "../../orchestration/entrypoints/dev-cli/start/run-start-turn";
import { type RunStartWire } from "../../orchestration/entrypoints/dev-cli/start/run-start-wire";

async function withStdinTty<T>(stdinIsTty: boolean, operation: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  try {
    Object.defineProperty(process.stdin, "isTTY", {
      value: stdinIsTty,
      configurable: true,
    });
    return await operation();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, "isTTY", descriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
}

function createRuntimeStateMock(input: {
  sessionKey: string;
  activeSessionId: string;
  historyMessages: ChatHistoryMessage[];
  stickyProvider?: string;
  providerRuntimeStates: SessionProviderRuntimeState[];
}): RunStartRuntimeState {
  const sessionRegistry: SessionRegistryPayload = {
    version: 1,
    namespace_key: "feishu:grobot:dm:interactive-binding-contract",
    active_id: input.activeSessionId,
    sessions: [],
  };
  let activeSessionId = input.activeSessionId;
  let sessionKey = input.sessionKey;
  let historyMessages = [...input.historyMessages];
  let stickyProvider = input.stickyProvider;
    let providerRuntimeStates = [...input.providerRuntimeStates];
    let planMode: SessionPlanMode = "normal";
    let planMeta: SessionPlanMeta | undefined;
    let gaState: GaSessionStateSnapshot | undefined;
    let historyCompacted = false;
    let failureObserved = false;
  return {
    getSessionRegistry: () => sessionRegistry,
    getActiveSessionId: () => activeSessionId,
    setActiveSessionId: (value) => {
      activeSessionId = value;
    },
    getSessionKey: () => sessionKey,
    setSessionKey: (value) => {
      sessionKey = value;
    },
    getHistoryMessages: () => historyMessages,
    setHistoryMessages: (rows) => {
      historyMessages = [...rows];
    },
    getRestoreSource: () => "store",
    markHistoryCompacted: () => {
      historyCompacted = true;
    },
    hasHistoryCompacted: () => historyCompacted,
    markFailureObserved: () => {
      failureObserved = true;
    },
    hasFailureObserved: () => failureObserved,
    getRestoredTurns: () => historyMessages.length / 2,
    getStickyProvider: () => stickyProvider,
    setStickyProvider: (value) => {
      stickyProvider = value;
    },
    getProviderRuntimeStates: () => providerRuntimeStates,
    setProviderRuntimeStates: (rows) => {
      providerRuntimeStates = [...rows];
    },
    getPlanMode: () => planMode,
    setPlanMode: (value) => {
      planMode = value;
    },
      getPlanMeta: () => planMeta,
      setPlanMeta: (value) => {
        planMeta = value;
      },
      getGaState: () => gaState,
      setGaState: (value) => {
        gaState = value;
      },
    };
  }

async function main(): Promise<void> {
  const stdoutChunks: string[] = [];
  const historyMessages: ChatHistoryMessage[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
  ];
  const providerStates: SessionProviderRuntimeState[] = [
    {
      provider_name: "alpha",
      consecutive_failures: 0,
      circuit_open_until_ms: 0,
      ewma_latency_ms: 123.4,
      ewma_error_rate: 0.02,
    },
  ];
  const runtimeState = createRuntimeStateMock({
    sessionKey: "feishu:grobot:dm:interactive-binding-contract",
    activeSessionId: "main",
    historyMessages,
    stickyProvider: "alpha",
    providerRuntimeStates: providerStates,
  });
  const runtimeProviderChain: RuntimeProviderCandidate[] = [
    {
      name: "alpha",
      source: "contract",
      modelConfig: { model: "alpha-model" },
      maxInFlight: 3,
      requestsPerMinute: 60,
      burst: 60,
    },
  ];
  const runtimeFailoverConfig: RuntimeFailoverConfig = {
    circuitFailures: 2,
    circuitCooldownSecs: 30,
    stickyMode: "session_key",
  };
  const sessionStoreRuntime: SessionStoreRuntime = {
    backend: "file",
    requestedBackend: "file",
    source: "contract",
  };

  let applyModelOverrideCount = 0;
  const modelOps: RunStartModelOps = {
    getCurrentModelSnapshot: () => ({
      providerName: "alpha",
      model: "alpha-model",
      source: "contract:model",
    }),
    getCachedModelContextWindowTokens: () => undefined,
    refreshModelCatalogCache: async () => undefined,
    showModelCurrent: async () => undefined,
    listModels: async () => undefined,
    useModel: async () => undefined,
    resetModel: async () => undefined,
    openModelMenu: async () => undefined,
    applyModelOverrideForSession: () => undefined,
    applyModelOverrideForActiveSession: () => {
      applyModelOverrideCount += 1;
    },
  };
  const sessionMenuOps: RunStartSessionMenuOps = {
    openSessionMenu: async () => undefined,
  };
  const planMode: RunStartPlanMode = {
    isPlanMode: () => false,
    getActivePlanPath: () => undefined,
    enterPlan: async () => 0,
    showPlanStatus: async () => 0,
    approvePlan: async () => 0,
    rejectPlan: async () => 0,
    verifyPlan: async () => 0,
    runPlanTurn: async () => 0,
    applyPlan: async () => 0,
    cancelPlan: async () => 0,
    requestPlanInterrupt: async () => ({
      code: "PLAN_INTERRUPT_NOT_RUNNING",
      accepted: false,
      phase: "idle",
    }),
    handleMessageInput: async () => ({ handled: false, code: 0 }),
  };

  let switchResult = true;
  const switchEvents: string[] = [];
  const gaMechanismRuntime = createGaMechanismRuntime();
  let handoffReason = "";
  let handoffToStderr = true;
  let autoExitToStderr = true;
  const wire: RunStartWire = {
    handoff: {
      writeHandoff: (reason, toStderr) => {
        handoffReason = reason;
        handoffToStderr = toStderr;
      },
      writeAutoExitHandoffIfNeeded: (toStderr) => {
        autoExitToStderr = toStderr;
      },
    },
    sessionOps: {
      listSessions: () => [],
      printSessionOverview: () => undefined,
      createNewSession: async () => "new-session-id",
      switchActiveSession: async (targetSessionId, reason) => {
        switchEvents.push(`${targetSessionId}:${reason}`);
        return switchResult;
      },
      continueFromSession: async () => undefined,
      resumeFromSession: async () => false,
      forkFromSession: async () => false,
      listRewindCheckpoints: () => [],
      rewindSession: async () => false,
    },
    executeTurn: async (userInput) => {
      void userInput;
      return 0;
    },
  };

  const interactiveModeInput = createRunStartInteractiveModeInput({
    homeDir: "/tmp/home",
    projectRoot: "/tmp/project",
    projectName: "grobot",
    workDir: "/tmp/work",
    sessionNamespaceKey: "feishu:grobot:dm:interactive-binding-contract",
    sessionStoreRuntime,
    sessionRegistryFilePathValue: "/tmp/home/sessions/contract.sessions.json",
    handoffAutoOnExit: true,
    handoffRecentTurns: 6,
    handoffPath: "/tmp/work/HANDOFF.md",
    buildHelpText: () => "contract-help",
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeState,
    gaMechanismRuntime,
    output: {
      writeStdout: (message) => {
        stdoutChunks.push(message);
      },
    },
    modelOps,
    sessionMenuOps,
    wire,
    planMode,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    executeTurn: wire.executeTurn,
  });

  await interactiveModeInput.switchActiveSession("session-a", "switch");
  switchResult = false;
  await interactiveModeInput.switchActiveSession("session-b", "switch");
  interactiveModeInput.showHealthStatus();
  interactiveModeInput.showStatusCurrent();
  interactiveModeInput.setStatusTheme("nerd");
  interactiveModeInput.setStatusLayoutMode("compact");
  interactiveModeInput.setStatusSegmentEnabled("tokens", false);
  interactiveModeInput.writeManualHandoff();
  interactiveModeInput.writeAutoExitHandoffIfNeeded();
  const planMenuNonTtyStart = stdoutChunks.join("").length;
  await withStdinTty(false, async () => {
    await interactiveModeInput.openPlanMenu(async (operation) => operation());
    return undefined;
  });
  const planMenuNonTtyText = stdoutChunks.join("").slice(planMenuNonTtyStart);
  interactiveModeInput.showPendingAskQueue();
  const buildPendingAsk = (
    suffix: string,
    options: string[] = ["safe", "fast"],
  ) => normalizeAskUserEnvelopeFromPayload({
    question_id: `ask_q_contract_${suffix}`,
    blocking_node_id: "node.contract.ask",
    question: "Choose profile",
    options,
    default_on_timeout: "safe",
    resume_token: `resume_contract_${suffix}`,
  });
  const pendingAskPrimary = buildPendingAsk("001", [
    "safe",
    "fast",
    "aggressive",
    "balanced",
    "retry",
    "fallback",
  ]);
  const pendingAskSecondary = buildPendingAsk("002", ["yes", "no"]);
  if (!pendingAskPrimary || !pendingAskSecondary) {
    throw new Error("failed to build contract ask-user envelope");
  }
  gaMechanismRuntime.registerPendingAsk(runtimeState.getSessionKey(), pendingAskPrimary);
  gaMechanismRuntime.registerPendingAsk(runtimeState.getSessionKey(), pendingAskSecondary);
  const askStatusCompactStart = stdoutChunks.join("").length;
  await withStdinTty(true, async () => {
    interactiveModeInput.showPendingAskQueue();
    return undefined;
  });
  const askStatusCompactText = stdoutChunks.join("").slice(askStatusCompactStart);
  interactiveModeInput.showPendingAskQueue();
  interactiveModeInput.showPendingAskQueue(-1);
  const statusConfigAfter = interactiveModeInput.getStatusLineConfig();
  const planMenuInitialDraft = resolvePlanMenuInitialItemId({
    planMode: true,
    state: {
      activePlanStatus: "draft",
      latestPlanStatus: "draft",
    },
  });
  const planMenuInitialApproved = resolvePlanMenuInitialItemId({
    planMode: true,
    state: {
      activePlanStatus: "approved",
      latestPlanStatus: "approved",
    },
  });
  const planMenuInitialAppliedPending = resolvePlanMenuInitialItemId({
    planMode: false,
    state: {
      latestPlanStatus: "applied",
      latestVerificationStatus: "pending",
    },
  });
  const planMenuTailDraft = resolvePlanMenuTailItemOrder({
    state: {
      activePlanStatus: "draft",
      latestPlanStatus: "draft",
    },
  });
  const planMenuTailApproved = resolvePlanMenuTailItemOrder({
    state: {
      activePlanStatus: "approved",
      latestPlanStatus: "approved",
    },
  });
  const planMenuTailAppliedPending = resolvePlanMenuTailItemOrder({
    planMode: false,
    state: {
      latestPlanStatus: "applied",
      latestVerificationStatus: "pending",
    },
  });
  const planMenuPrimaryDraft = resolvePlanMenuPrimaryAction({
    planMode: true,
    state: {
      activePlanStatus: "draft",
      latestPlanStatus: "draft",
    },
  });
  const planMenuPrimaryApproved = resolvePlanMenuPrimaryAction({
    planMode: true,
    state: {
      activePlanStatus: "approved",
      latestPlanStatus: "approved",
    },
  });
  const planMenuPrimaryReasonDraft = resolvePlanMenuPrimaryReason({
    planMode: true,
    state: {
      activePlanStatus: "draft",
      latestPlanStatus: "draft",
    },
  });
  const planMenuPrimaryReasonApproved = resolvePlanMenuPrimaryReason({
    planMode: true,
    state: {
      activePlanStatus: "approved",
      latestPlanStatus: "approved",
    },
  });

  const outputText = stdoutChunks.join("");
  const payload = {
    pass_through_project_name: interactiveModeInput.projectName === "grobot",
    pass_through_session_runtime:
      interactiveModeInput.sessionStoreRuntime.backend === "file",
    switch_calls: switchEvents.length,
    switch_first_call: switchEvents[0] ?? "",
    switch_second_call: switchEvents[1] ?? "",
    model_override_count: applyModelOverrideCount,
    health_has_header: outputText.includes("[provider-health]"),
    health_has_sticky_provider: outputText.includes("sticky_provider: alpha"),
    health_has_provider_row: outputText.includes("- alpha status=CLOSED"),
    manual_handoff_reason: handoffReason,
    manual_handoff_to_stderr: handoffToStderr,
    auto_exit_to_stderr: autoExitToStderr,
    history_count: interactiveModeInput.getHistoryMessagesCount(),
    help_text: interactiveModeInput.buildHelpText(),
    active_session_id: interactiveModeInput.getActiveSessionId(),
    active_session_topic: interactiveModeInput.getActiveSessionTopic() ?? "",
    model_snapshot_model: interactiveModeInput.getModelSnapshot().model,
    model_snapshot_provider: interactiveModeInput.getModelSnapshot().providerName,
    prompt_budget_ctx_ratio: 0.42,
    prompt_budget_estimated_tokens: 512,
    prompt_budget_target_tokens: 2048,
    status_snapshot_has_header: outputText.includes("[status]"),
    status_theme_after_update: statusConfigAfter.theme,
    status_layout_after_update: statusConfigAfter.layoutMode,
    status_tokens_segment_after_update: statusConfigAfter.segments.tokens,
    ask_status_no_pending_warned: outputText.includes("[ask-user] no pending question."),
    ask_status_has_options_preview: outputText.includes("options_preview: "),
    ask_status_has_output_mode_full: outputText.includes("ask_status_output_mode: full"),
    ask_status_has_options_more: outputText.includes("options_more: +1"),
    ask_status_has_followups_total: outputText.includes("pending_followups_total: 1"),
    ask_status_has_followup_row: outputText.includes("pending_followup_1: ask_q_contract_002"),
    ask_status_hint_mentions_reply_direct:
      outputText.includes("hint: reply directly in chat to answer active question"),
    ask_status_hint_mentions_status_only:
      outputText.includes("hint: ask-user actions are automatic; there is no /ask command"),
    ask_status_compact_has_header:
      askStatusCompactText.includes("[ask-user] active question"),
    ask_status_compact_has_output_mode:
      askStatusCompactText.includes("ask_status_output_mode: compact"),
    ask_status_compact_has_detail_hint:
      askStatusCompactText.includes("ask_status_detail_hint: set GROBOT_ASK_STATUS_VERBOSE=1 and rerun status display"),
    ask_status_compact_has_followups_total:
      askStatusCompactText.includes("pending_followups_total: 1"),
    ask_status_compact_hides_followup_rows:
      !askStatusCompactText.includes("pending_followup_1: "),
    ask_status_compact_hides_status_only_hint:
      !askStatusCompactText.includes("hint: ask-user actions are automatic; there is no /ask command"),
    plan_menu_initial_draft_is_check: planMenuInitialDraft === "check",
    plan_menu_initial_approved_is_apply: planMenuInitialApproved === "apply",
    plan_menu_initial_applied_pending_is_verify: planMenuInitialAppliedPending === "verify",
    plan_menu_non_tty_has_suggested_line:
      planMenuNonTtyText.includes("[plan] suggested now: "),
    plan_menu_non_tty_suggests_goal:
      planMenuNonTtyText.includes("[plan] suggested now: /plan <goal>"),
    plan_menu_tail_draft_check_first: planMenuTailDraft[0] === "check",
    plan_menu_tail_approved_apply_first: planMenuTailApproved[0] === "apply",
    plan_menu_tail_applied_pending_verify_first: planMenuTailAppliedPending[0] === "verify",
    plan_menu_primary_draft_command_is_check:
      planMenuPrimaryDraft.command === "/plan check",
    plan_menu_primary_approved_command_is_apply:
      planMenuPrimaryApproved.command === "/plan apply [extra]",
    plan_menu_primary_reason_draft_mentions_check:
      planMenuPrimaryReasonDraft.includes("quick check"),
    plan_menu_primary_reason_approved_mentions_apply:
      planMenuPrimaryReasonApproved.includes("apply"),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
