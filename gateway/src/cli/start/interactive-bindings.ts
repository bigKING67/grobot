import { normalizeStatusLineConfig } from "../tui/components/status-line/reducer";
import type {
  StatusLineConfig,
  StatusLineConfigInput,
} from "../tui/components/status-line/contract";
import { runTerminalSelectMenu } from "../tui/components/select-menu/controller";
import { createRunStartUserCommandsRuntime } from "./user-commands";
import { resolveRunStartPlanSuggestionState } from "./plan-suggestion-state";
import { TURN_INTERRUPTED_EXIT_CODE } from "./turn";
import { openPlanInEditor as openPlanFileInEditor } from "./interactive-bindings/plan-editor-action";
import {
  buildStatusLayoutUsageSurface,
  buildStatusSegmentUsageSurface,
  buildStatusThemeUsageSurface,
  formatStatusLayoutModeLabel,
  formatStatusSegmentLabel,
  formatStatusThemeLabel,
  formatStatusLineCurrentSnapshot,
  normalizeStatusSegmentId,
  resolveStatusLayoutMode,
  resolveStatusTheme,
} from "./interactive-bindings/status-line-settings";
import { openStatusMenu as openStatusLineMenu } from "./interactive-bindings/status-menu";
import { resolveSessionTopicBySessionId } from "./interactive-bindings/session-topic";
import { buildCompactNotice } from "./interactive-bindings/notice-surface";
import {
  createInteractiveCommandRuntimes,
} from "./interactive-bindings/command-runtimes";
import {
  createOpenHistorySearch,
} from "./interactive-bindings/history-search-runtime";
import {
  createPendingAskRuntime,
} from "./interactive-bindings/pending-ask-runtime";
import {
  createInteractiveStatusSurfaces,
} from "./interactive-bindings/status-surfaces";
import type {
  CreateRunStartInteractiveModeInput,
} from "./interactive-bindings/contract";
import type {
  RunStartInteractiveModeInput,
} from "./interactive-mode";
import type { RunStartModelSnapshot } from "./model-ops";
import type { RunStartPlanSuggestionState } from "./plan-suggestion-state";

export type { CreateRunStartInteractiveModeInput } from "./interactive-bindings/contract";

export function createRunStartInteractiveModeInput(
  input: CreateRunStartInteractiveModeInput,
): RunStartInteractiveModeInput {
  const runSelectMenu = input.runSelectMenu ?? runTerminalSelectMenu;
  const userCommandsRuntime = createRunStartUserCommandsRuntime({
    homeDir: input.homeDir,
    writeStdout: input.output.writeStdout,
    runSelectMenu,
    executeTurn: input.executeTurn,
    markFailureObserved: input.runtimeState.markFailureObserved,
  });
  const getModelSnapshot = (): RunStartModelSnapshot =>
    input.modelOps.getCurrentModelSnapshot();
  const statusLineState = createStatusLineState(input.statusLineConfig);
  const shouldMarkFailure = (code: number): boolean =>
    code !== 0 && code !== TURN_INTERRUPTED_EXIT_CODE;
  const sessionTopic = createSessionTopicResolver(input, statusLineState.getStatusLineConfig);
  const pendingAskRuntime = createPendingAskRuntime(input);
  const statusSurfaces = createInteractiveStatusSurfaces(input, getModelSnapshot);
  const commandRuntimes = createInteractiveCommandRuntimes(input, shouldMarkFailure);
  const openHistorySearch = createOpenHistorySearch(input, runSelectMenu);

  const getPlanSuggestionState = ():
    | RunStartPlanSuggestionState
    | undefined => {
    const planMeta = input.runtimeState.getPlanMeta();
    return resolveRunStartPlanSuggestionState({
      workDir: input.workDir,
      sessionId: input.runtimeState.getSessionKey(),
      mode: input.planMode.isPlanMode() ? "plan_only" : "normal",
      persistedActivePlanStatus: planMeta?.active_plan_status,
      persistedActivePlanPhase: planMeta?.active_plan_phase,
      persistedActivePlanPath: planMeta?.active_plan_path,
    });
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
    contextWindowTokens: input.contextWindowTokens,
    interactiveDiagnosticsEnabled: input.interactiveDiagnosticsEnabled,
    interactiveDiagnosticsMode: input.interactiveDiagnosticsMode,
    restoredTurns: input.runtimeState.getRestoredTurns(),
    restoreSource: input.runtimeState.getRestoreSource(),
    buildHelpText: input.buildHelpText,
    hasPendingAsk: () =>
      input.gaMechanismRuntime.getPendingAskQueueSize(
        input.runtimeState.getSessionKey(),
      ) > 0,
    getPendingAskQueueSize: () =>
      input.gaMechanismRuntime.getPendingAskQueueSize(
        input.runtimeState.getSessionKey(),
      ),
    ...pendingAskRuntime,
    ...statusSurfaces,
    getCachedModelContextWindowTokens:
      input.modelOps.getCachedModelContextWindowTokens,
    refreshModelCatalogCache: input.modelOps.refreshModelCatalogCache,
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
        sessionTopic.refreshSessionTopic(targetSessionId);
      }
      return switched;
    },
    continueFromSession: input.wire.sessionOps.continueFromSession,
    writeManualHandoff: () => {
      input.wire.handoff.writeHandoff("manual-command", false);
    },
    isPlanMode: input.planMode.isPlanMode,
    getPlanSuggestionState,
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
    openCommandsMenu: userCommandsRuntime.openManagementMenu,
    openPlanInEditor: (withInputPaused, options) =>
      openPlanFileInEditor({
        workDir: input.workDir,
        planMode: input.planMode,
        withInputPaused,
        suppressOpenPlanEditorNotice: options?.suppressOpenPlanEditorNotice,
        writeStdout: input.output.writeStdout,
      }),
    showHistory: statusSurfaces.showHistory,
    openHistorySearch,
    ...commandRuntimes,
    tryRunUserCommand: userCommandsRuntime.tryRunUserCommand,
    executeTurn: input.executeTurn,
    markFailureObserved: input.runtimeState.markFailureObserved,
    getHistoryMessagesCount: () =>
      input.runtimeState.getHistoryMessages().length,
    writeAutoExitHandoffIfNeeded: () => {
      input.wire.handoff.writeAutoExitHandoffIfNeeded(false);
    },
    getActiveSessionId: input.runtimeState.getActiveSessionId,
    listRewindCheckpoints: input.wire.sessionOps.listRewindCheckpoints,
    rewindSession: input.wire.sessionOps.rewindSession,
    getActiveSessionTopic: sessionTopic.getActiveSessionTopic,
    getModelSnapshot,
    getStatusLineConfig: statusLineState.getStatusLineConfig,
    listSessionSummaries: input.wire.sessionOps.listSessions,
    showStatusCurrent: () => {
      input.output.writeStdout(
        formatStatusLineCurrentSnapshot(statusLineState.getStatusLineConfig()),
      );
    },
    setStatusTheme: (rawTheme) => {
      const theme = resolveStatusTheme(rawTheme);
      if (!theme) {
        input.output.writeStdout(
          buildStatusThemeUsageSurface("Invalid status theme"),
        );
        return;
      }
      statusLineState.updateStatusLineConfig({ theme });
      input.output.writeStdout(
        buildCompactNotice("Status theme updated", [`theme ${formatStatusThemeLabel(theme)}`]),
      );
    },
    setStatusLayoutMode: (rawLayoutMode) => {
      const layoutMode = resolveStatusLayoutMode(rawLayoutMode);
      if (!layoutMode) {
        input.output.writeStdout(
          buildStatusLayoutUsageSurface("Invalid status layout"),
        );
        return;
      }
      statusLineState.updateStatusLineConfig({ layoutMode });
      input.output.writeStdout(
        buildCompactNotice("Status layout updated", [`layout ${formatStatusLayoutModeLabel(layoutMode)}`]),
      );
    },
    setStatusSegmentEnabled: (rawSegmentId, enabled) => {
      const segmentId = normalizeStatusSegmentId(rawSegmentId);
      if (!segmentId) {
        input.output.writeStdout(
          buildStatusSegmentUsageSurface("Invalid status segment"),
        );
        return;
      }
      statusLineState.updateStatusLineConfig({
        segments: {
          [segmentId]: enabled,
        },
      });
      const segmentLabel = formatStatusSegmentLabel(segmentId);
      input.output.writeStdout(
        buildCompactNotice("Status segment updated", [
          `segment ${segmentLabel}`,
          enabled ? "enabled" : "disabled",
        ]),
      );
    },
    openStatusMenu: (withInputPaused) =>
      openStatusLineMenu({
        sessionKey: input.runtimeState.getSessionKey(),
        runSelectMenu,
        withInputPaused,
        getStatusLineConfig: statusLineState.getStatusLineConfig,
        updateStatusLineConfig: statusLineState.updateStatusLineConfig,
        writeStdout: input.output.writeStdout,
      }),
  };
}

function createStatusLineState(initial?: StatusLineConfigInput): {
  getStatusLineConfig(): StatusLineConfig;
  updateStatusLineConfig(partial: StatusLineConfigInput): void;
} {
  let statusLineConfigState = normalizeStatusLineConfig(initial);
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
  return {
    getStatusLineConfig,
    updateStatusLineConfig,
  };
}

function createSessionTopicResolver(
  input: CreateRunStartInteractiveModeInput,
  getStatusLineConfig: () => StatusLineConfig,
): {
  refreshSessionTopic(sessionId: string): string | undefined;
  getActiveSessionTopic(): string | undefined;
} {
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
      sessionTopicCache.sessionId === activeSessionId &&
      now - sessionTopicCache.resolvedAtMs <= ttlMs
    ) {
      return sessionTopicCache.topic;
    }
    return refreshSessionTopic(activeSessionId);
  };

  return {
    refreshSessionTopic,
    getActiveSessionTopic,
  };
}
