import { createRunStartInteractiveModeInput } from "../../orchestration/entrypoints/dev-cli/start/run-start-interactive-bindings";
import { type ChatHistoryMessage } from "../../orchestration/entrypoints/dev-cli/start/session-history";
import { type GaSessionStateSnapshot } from "../../orchestration/entrypoints/dev-cli/services/ga-mechanism-runtime";
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
    enterPlan: async () => 0,
    showPlanStatus: async () => 0,
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
    },
    executeTurn: async () => 0,
  };

  const interactiveModeInput = createRunStartInteractiveModeInput({
    homeDir: "/tmp/home",
    projectRoot: "/tmp/project",
    projectName: "grobot",
    workDir: "/tmp/work",
    sessionNamespaceKey: "feishu:grobot:dm:interactive-binding-contract",
    sessionStoreRuntime,
    sessionRegistryFilePathValue: "/tmp/home/session/contract.sessions.json",
    handoffAutoOnExit: true,
    handoffRecentTurns: 6,
    handoffPath: "/tmp/work/HANDOFF.md",
    buildHelpText: () => "contract-help",
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeState,
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
  interactiveModeInput.writeManualHandoff();
  interactiveModeInput.writeAutoExitHandoffIfNeeded();

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
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
