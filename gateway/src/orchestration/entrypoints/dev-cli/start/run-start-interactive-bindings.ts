import { type SessionStoreRuntime } from "../services/session-store";
import { type RunStartInteractiveModeInput } from "./run-start-interactive-mode";
import {
  type RunStartModelOps,
  type RunStartModelSnapshot,
} from "./run-start-model-ops";
import { type RunStartOutput } from "./run-start-output";
import { type RunStartPlanMode } from "./run-start-plan-mode";
import { formatProviderHealthSnapshot } from "./run-start-provider-health";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type RunStartSessionMenuOps } from "./run-start-session-menu-ops";
import {
  type RuntimeFailoverConfig,
  type RuntimeProviderCandidate,
} from "./run-start-turn";
import { type RunStartWire } from "./run-start-wire";
import {
  normalizeStatusLineConfig,
  type StatusLineConfig,
  type StatusLineConfigInput,
  type StatusLineLayoutMode,
  type StatusLineSegmentId,
  type StatusLineTheme,
} from "../ui/screens/status-line-screen";
import { createRunStartUserCommandsRuntime } from "./run-start-user-commands";

interface CreateRunStartInteractiveModeInput {
  homeDir: string;
  projectRoot: string;
  projectName: string;
  workDir: string;
  sessionNamespaceKey: string;
  sessionStoreRuntime: SessionStoreRuntime;
  sessionRegistryFilePathValue: string;
  handoffAutoOnExit: boolean;
  handoffRecentTurns: number;
  handoffPath: string;
  buildHelpText(): string;
  statusLineConfig?: StatusLineConfigInput;
  runtimeProviderChain: ReadonlyArray<RuntimeProviderCandidate>;
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeState: RunStartRuntimeState;
  output: Pick<RunStartOutput, "writeStdout">;
  modelOps: RunStartModelOps;
  sessionMenuOps: RunStartSessionMenuOps;
  wire: RunStartWire;
  planMode: RunStartPlanMode;
  requestRuntimeInterrupt(
    source: "command" | "cli_esc",
  ): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  executeTurn(userInput: string, interactiveMode: boolean): Promise<number>;
}

function resolveSessionTopicBySessionId(input: {
  wire: RunStartWire;
  sessionId: string;
}): string | undefined {
  const session = input.wire.sessionOps
    .listSessions()
    .find((entry) => entry.id === input.sessionId);
  if (!session) {
    return undefined;
  }
  const title = session.title.trim();
  if (title.length > 0) {
    return title;
  }
  const summary = session.summary.trim();
  return summary.length > 0 ? summary : undefined;
}

function normalizeStatusSegmentId(raw: string): StatusLineSegmentId | undefined {
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "model"
    || normalized === "project"
    || normalized === "context"
    || normalized === "tokens"
    || normalized === "session"
  ) {
    return normalized;
  }
  return undefined;
}

function formatStatusLineCurrentSnapshot(config: StatusLineConfig): string {
  const segmentText = config.segmentOrder
    .map((segmentId) => `${segmentId}=${config.segments[segmentId] ? "on" : "off"}`)
    .join(", ");
  return [
    "[status]",
    `enabled: ${config.enabled ? "on" : "off"}`,
    `layout_mode: ${config.layoutMode}`,
    `theme: ${config.theme}`,
    `separator: ${JSON.stringify(config.separator)}`,
    `segments: ${segmentText}`,
    `warning_threshold: ${String(Math.round(config.warningThresholdRatio * 100))}%`,
    `critical_threshold: ${String(Math.round(config.criticalThresholdRatio * 100))}%`,
    `budget_snapshot_cache_ttl_ms: ${String(config.budgetSnapshotCacheTtlMs)}`,
    `session_topic_cache_ttl_ms: ${String(config.sessionTopicCacheTtlMs)}`,
    `session_topic_max_width: ${String(config.sessionTopicMaxWidth)}`,
    "",
  ].join("\n");
}

function resolveStatusTheme(input: string): StatusLineTheme | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "plain") {
    return "plain";
  }
  if (normalized === "ccline" || normalized === "cometix") {
    return "ccline";
  }
  if (normalized === "nerd" || normalized === "nerd_font" || normalized === "nerd-font") {
    return "nerd_font";
  }
  return undefined;
}

function resolveStatusLayoutMode(input: string): StatusLineLayoutMode | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "adaptive" || normalized === "full" || normalized === "compact") {
    return normalized;
  }
  return undefined;
}

export function createRunStartInteractiveModeInput(
  input: CreateRunStartInteractiveModeInput,
): RunStartInteractiveModeInput {
  const userCommandsRuntime = createRunStartUserCommandsRuntime({
    homeDir: input.homeDir,
    writeStdout: input.output.writeStdout,
    executeTurn: input.executeTurn,
    markFailureObserved: input.runtimeState.markFailureObserved,
  });
  const getModelSnapshot = (): RunStartModelSnapshot =>
    input.modelOps.getCurrentModelSnapshot();
  let statusLineConfigState = normalizeStatusLineConfig(input.statusLineConfig);
  const updateStatusLineConfig = (partial: StatusLineConfigInput): void => {
    statusLineConfigState = normalizeStatusLineConfig({
      ...statusLineConfigState,
      ...partial,
      segmentOrder: partial.segmentOrder ?? statusLineConfigState.segmentOrder,
      segments: {
        ...statusLineConfigState.segments,
        ...(partial.segments ?? {}),
      },
    });
  };
  const getStatusLineConfig = (): StatusLineConfig => statusLineConfigState;

  const sessionTopicCache: {
    sessionId: string;
    topic: string | undefined;
    resolvedAtMs: number;
  } = {
    sessionId: "",
    topic: undefined,
    resolvedAtMs: 0,
  };

  const refreshSessionTopic = (sessionId: string): string | undefined => {
    const topic = resolveSessionTopicBySessionId({
      wire: input.wire,
      sessionId,
    });
    sessionTopicCache.sessionId = sessionId;
    sessionTopicCache.topic = topic;
    sessionTopicCache.resolvedAtMs = Date.now();
    return topic;
  };

  const getActiveSessionTopic = (): string | undefined => {
    const activeSessionId = input.runtimeState.getActiveSessionId();
    const ttlMs = getStatusLineConfig().sessionTopicCacheTtlMs;
    const now = Date.now();
    if (
      sessionTopicCache.sessionId === activeSessionId
      && now - sessionTopicCache.resolvedAtMs <= ttlMs
    ) {
      return sessionTopicCache.topic;
    }
    return refreshSessionTopic(activeSessionId);
  };

  return {
    homeDir: input.homeDir,
    projectRoot: input.projectRoot,
    projectName: input.projectName,
    workDir: input.workDir,
    sessionKey: input.runtimeState.getSessionKey(),
    sessionNamespaceKey: input.sessionNamespaceKey,
    activeSessionId: input.runtimeState.getActiveSessionId(),
    sessionStoreRuntime: input.sessionStoreRuntime,
    sessionRegistryFilePathValue: input.sessionRegistryFilePathValue,
    handoffAutoOnExit: input.handoffAutoOnExit,
    handoffRecentTurns: input.handoffRecentTurns,
    handoffPath: input.handoffPath,
    restoredTurns: input.runtimeState.getRestoredTurns(),
    restoreSource: input.runtimeState.getRestoreSource(),
    buildHelpText: input.buildHelpText,
    showHealthStatus: () => {
      input.output.writeStdout(
        formatProviderHealthSnapshot({
          sessionKey: input.runtimeState.getSessionKey(),
          stickyProvider: input.runtimeState.getStickyProvider(),
          failureThreshold: input.runtimeFailoverConfig.circuitFailures,
          cooldownSecs: input.runtimeFailoverConfig.circuitCooldownSecs,
          providers: input.runtimeProviderChain.map((provider) => ({
            name: provider.name,
            maxInFlight: provider.maxInFlight,
            requestsPerMinute: provider.requestsPerMinute,
            burst: provider.burst,
          })),
          states: input.runtimeState.getProviderRuntimeStates(),
        }),
      );
    },
    showModelCurrent: input.modelOps.showModelCurrent,
    listModels: input.modelOps.listModels,
    useModel: input.modelOps.useModel,
    resetModel: input.modelOps.resetModel,
    openModelMenu: input.modelOps.openModelMenu,
    openSessionMenu: input.sessionMenuOps.openSessionMenu,
    createNewSession: input.wire.sessionOps.createNewSession,
    switchActiveSession: async (targetSessionId, reason) => {
      const switched = await input.wire.sessionOps.switchActiveSession(
        targetSessionId,
        reason,
      );
      if (switched) {
        input.modelOps.applyModelOverrideForActiveSession();
        refreshSessionTopic(targetSessionId);
      }
      return switched;
    },
    continueFromSession: input.wire.sessionOps.continueFromSession,
    writeManualHandoff: () => {
      input.wire.handoff.writeHandoff("manual-command", false);
    },
    isPlanMode: input.planMode.isPlanMode,
    showPlanStatus: input.planMode.showPlanStatus,
    enterPlan: input.planMode.enterPlan,
    applyPlan: input.planMode.applyPlan,
    cancelPlan: input.planMode.cancelPlan,
    requestPlanInterrupt: async (source) => {
      await input.planMode.requestPlanInterrupt(source);
    },
    requestRuntimeInterrupt: async (source) => {
      input.requestRuntimeInterrupt(source);
    },
    runPlanTurn: input.planMode.runPlanTurn,
    handleUserCommandsCommand: userCommandsRuntime.handleManagementCommand,
    tryRunUserCommand: userCommandsRuntime.tryRunUserCommand,
    executeTurn: input.executeTurn,
    markFailureObserved: input.runtimeState.markFailureObserved,
    getHistoryMessagesCount: () => input.runtimeState.getHistoryMessages().length,
    writeAutoExitHandoffIfNeeded: () => {
      input.wire.handoff.writeAutoExitHandoffIfNeeded(false);
    },
    getActiveSessionId: input.runtimeState.getActiveSessionId,
    getActiveSessionTopic,
    getModelSnapshot,
    getStatusLineConfig,
    listSessionSummaries: input.wire.sessionOps.listSessions,
    showStatusCurrent: () => {
      input.output.writeStdout(formatStatusLineCurrentSnapshot(getStatusLineConfig()));
    },
    setStatusTheme: (rawTheme) => {
      const theme = resolveStatusTheme(rawTheme);
      if (!theme) {
        input.output.writeStdout(
          "invalid status theme; usage: /status theme <plain|nerd|ccline>\n\n",
        );
        return;
      }
      updateStatusLineConfig({ theme });
      input.output.writeStdout(`[status] theme set to ${theme}\n\n`);
    },
    setStatusLayoutMode: (rawLayoutMode) => {
      const layoutMode = resolveStatusLayoutMode(rawLayoutMode);
      if (!layoutMode) {
        input.output.writeStdout(
          "invalid status layout; usage: /status layout <adaptive|full|compact>\n\n",
        );
        return;
      }
      updateStatusLineConfig({ layoutMode });
      input.output.writeStdout(`[status] layout_mode set to ${layoutMode}\n\n`);
    },
    setStatusSegmentEnabled: (rawSegmentId, enabled) => {
      const segmentId = normalizeStatusSegmentId(rawSegmentId);
      if (!segmentId) {
        input.output.writeStdout(
          "invalid status segment; usage: /status segment <model|project|context|tokens|session> <on|off>\n\n",
        );
        return;
      }
      updateStatusLineConfig({
        segments: {
          [segmentId]: enabled,
        },
      });
      input.output.writeStdout(
        `[status] segment ${segmentId} ${enabled ? "on" : "off"}\n\n`,
      );
    },
  };
}
