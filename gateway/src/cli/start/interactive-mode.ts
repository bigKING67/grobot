import { SessionStoreRuntime } from "../services/session-store";
import {
  SessionInteractiveControls,
  type SessionInteractiveRewindCheckpointSummary,
  type SessionInteractiveRewindMode,
  type SessionMenuMode,
} from "./session-interactive";
import { printRunStartBanner } from "./startup/banner";
import { createRunStartInteractiveHandler } from "./interactive-handler";
import {
  runSessionInputLoop,
} from "../tui/components/prompt-input/controller";
import {
  resolveInlineAttachmentsFromInput,
} from "../tui/components/prompt-input/attachments";
import { isNaturalPlanExecutionIntent } from "./plan-command";
import { type RunStartModelSnapshot } from "./model-ops";
import {
  type PlanInterruptSource,
  type PlanReadyApprovalDecision,
  type PlanReadyApprovalRequest,
} from "./plan-mode";
import { type RunStartSessionSummary } from "./session/ops";
import { listRunStartSlashSuggestions } from "./slash-suggestions";
import { type RunStartPlanSuggestionState } from "./plan-suggestion-state";
import {
  clearTerminalWindowTitle,
  setTerminalWindowTitle,
} from "../tui/terminal/text-sanitizer";
import { type SessionPromptLayout } from "../tui/interactive/interactive-frame";
import { renderBottomPaneFooter } from "../tui/components/bottom-pane/render";
import { type StatusLineConfig } from "../tui/components/status-line/contract";
import { type RuntimeAttachment, type RuntimeEvent } from "../../models/types";
import {
  type InteractiveDiagnosticsMode,
} from "./interactive-mode/process-summary";
import {
  buildInteractivePromptLayout,
  buildInteractiveWindowTitle,
  createPromptBudgetSnapshotReader,
  resolveModelContextWindowTokens,
  resolveProjectFolder,
  resolveTerminalColumns,
  resolveTerminalRows,
} from "./interactive-mode/prompt-surface";
import { createPlanReadyApprovalRequester } from "./interactive-mode/plan-approval";
import {
  createPendingInputFrameController,
  type PendingInputFrameController,
} from "./interactive-mode/pending-input-frame";
import { createInteractiveActivityController } from "./interactive-mode/activity-controller";

export type { InteractiveDiagnosticsMode } from "./interactive-mode/process-summary";

export interface RunStartInteractiveTurnOptions {
  promptPrelude?: string;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
  diagnosticsMode?: InteractiveDiagnosticsMode;
  showWorkingNotice?: boolean;
  suppressOpenPlanEditorNotice?: boolean;
  requestReadyPlanApproval?: (
    request: PlanReadyApprovalRequest,
  ) => Promise<PlanReadyApprovalDecision>;
}

const PENDING_ASK_ALLOWED_SUGGESTION_HEADS = new Set<string>([
  "/sessions",
  "/resume",
  "/rewind",
  "/help",
  "/interrupt",
  "/exit",
  "/quit",
]);

const INTERACTIVE_SLASH_SUGGESTION_LIMIT = 64;

export function shouldSuppressRunStartSubmitTranscript(input: {
  value: string;
  planMode: boolean;
  pendingAskCount: number;
}): boolean {
  if (input.pendingAskCount > 0) {
    const normalized = input.value.trim();
    return normalized.length === 0 || normalized === "?";
  }
  return input.planMode && isNaturalPlanExecutionIntent(input.value);
}

export interface RunStartInteractiveModeInput {
  homeDir: string;
  projectRoot: string;
  projectName: string;
  workDir: string;
  sessionKey: string;
  sessionNamespaceKey: string;
  activeSessionId: string;
  sessionStoreRuntime: SessionStoreRuntime;
  sessionRegistryFilePathValue: string;
  handoffAutoOnExit: boolean;
  handoffRecentTurns: number;
  handoffPath: string;
  restoredTurns: number;
  restoreSource: "store" | "empty";
  contextWindowTokens?: number;
  interactiveDiagnosticsEnabled?: boolean;
  interactiveDiagnosticsMode?: InteractiveDiagnosticsMode;
  buildHelpText(): string;
  showHealthStatus(): void;
  showContextStatus(): void;
  showMemoryStatus(): void;
  showSkillsStatus(): void;
  showMcpStatus(): void;
  hasPendingAsk(): boolean;
  getPendingAskQueueSize(): number;
  getPendingAskPromptSummary?(): string | undefined;
  showPendingAskQueue(limit?: number): void;
  selectPendingAskAnswer(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<string | undefined>;
  getCachedModelContextWindowTokens(modelId: string): number | undefined;
  refreshModelCatalogCache(): Promise<void>;
  openModelMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  showStatusCurrent(): void;
  setStatusTheme(theme: string): void;
  setStatusLayoutMode(layoutMode: string): void;
  setStatusSegmentEnabled(segmentId: string, enabled: boolean): void;
  openStatusMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  openSessionMenu(mode: SessionMenuMode, withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  createNewSession(): Promise<string>;
  switchActiveSession(targetSessionId: string, reason: string): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeManualHandoff(): void;
  isPlanMode(): boolean;
  getPlanSuggestionState?(): RunStartPlanSuggestionState | undefined;
  showPlanStatus(): Promise<number>;
  enterPlan(goal: string, options?: RunStartInteractiveTurnOptions): Promise<number>;
  applyPlan(extra: string, options?: RunStartInteractiveTurnOptions): Promise<number>;
  cancelPlan(): Promise<number>;
  requestPlanInterrupt(source: PlanInterruptSource): Promise<void>;
  requestRuntimeInterrupt(source: PlanInterruptSource): Promise<void>;
  runPlanTurn(
    userInput: string,
    options?: RunStartInteractiveTurnOptions,
  ): Promise<number>;
  handleUserCommandsCommand(userInput: string): Promise<void>;
  openCommandsMenu(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<void>;
  openPlanInEditor(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
    options?: RunStartInteractiveTurnOptions,
  ): Promise<void>;
  showHistory(query?: string): Promise<void>;
  openHistorySearch(input: {
    currentInput: string;
  }): Promise<string | undefined>;
  promptSkillCreatorRequirement(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<string | undefined>;
  runSkillCreator(
    requirement: string,
    options?: RunStartInteractiveTurnOptions,
  ): Promise<void>;
  runInitProjectInstructions(
    options?: RunStartInteractiveTurnOptions,
  ): Promise<void>;
  tryRunUserCommand(
    userInput: string,
    options?: RunStartInteractiveTurnOptions,
  ): Promise<boolean>;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      attachments?: RuntimeAttachment[];
      promptPrelude?: string;
      autoOpenAskUserPanel?: boolean;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
      onRuntimeEvent?: (event: RuntimeEvent) => void;
    },
  ): Promise<number>;
  markFailureObserved(): void;
  getHistoryMessagesCount(): number;
  writeAutoExitHandoffIfNeeded(): void;
  getActiveSessionId(): string;
  listRewindCheckpoints(
    sessionId: string,
    limit?: number,
  ): SessionInteractiveRewindCheckpointSummary[];
  rewindSession(input: {
    sessionId: string;
    checkpointId?: string;
    mode: SessionInteractiveRewindMode;
    fileFilter?: readonly string[];
    reason?: string;
    summaryLimit?: number;
  }): Promise<boolean>;
  getActiveSessionTopic(): string | undefined;
  getModelSnapshot(): RunStartModelSnapshot;
  getStatusLineConfig(): StatusLineConfig;
  listSessionSummaries(): RunStartSessionSummary[];
}

export async function runStartInteractiveMode(input: RunStartInteractiveModeInput): Promise<void> {
  try {
    await input.refreshModelCatalogCache();
  } catch {
    // keep interactive mode available even if model catalog prefetch fails
  }
  const startupModelSnapshot = input.getModelSnapshot();
  const startupSessionTopic = input.getActiveSessionTopic();
  const startupCatalogContextWindowTokens =
    input.getCachedModelContextWindowTokens(startupModelSnapshot.model);
  const startupRecentSessions = input.listSessionSummaries()
    .filter((session) => !session.active && session.id !== input.getActiveSessionId())
    .slice(0, 3)
    .map((session) => ({
      id: session.id,
      title: session.title,
      summary: session.summary,
      updatedAt: session.updatedAt,
    }));
  printRunStartBanner({
    homeDir: input.homeDir,
    projectRoot: input.projectRoot,
    projectName: input.projectName,
    workDir: input.workDir,
    sessionKey: input.sessionKey,
    sessionNamespaceKey: input.sessionNamespaceKey,
    activeSessionId: input.activeSessionId,
    sessionStoreRuntime: input.sessionStoreRuntime,
    sessionRegistryFilePathValue: input.sessionRegistryFilePathValue,
    handoffAutoOnExit: input.handoffAutoOnExit,
    handoffRecentTurns: input.handoffRecentTurns,
    handoffPath: input.handoffPath,
    restoredTurns: input.restoredTurns,
    restoreSource: input.restoreSource,
    providerName: startupModelSnapshot.providerName,
    modelName: startupModelSnapshot.model,
    sessionTopic: startupSessionTopic,
    contextWindowTokens: startupCatalogContextWindowTokens,
    recentSessions: startupRecentSessions,
  });
  const activityController = createInteractiveActivityController({
    interactiveDiagnosticsEnabled: input.interactiveDiagnosticsEnabled,
    interactiveDiagnosticsMode: input.interactiveDiagnosticsMode,
    isPlanMode: input.isPlanMode,
    getPendingAskQueueSize: input.getPendingAskQueueSize,
  });
  const interactiveDiagnosticsMode = activityController.diagnosticsMode;
  let pendingInputFrame: PendingInputFrameController;
  const writeInteractiveStdout = activityController.writeStdout;
  const writeInteractiveStderr = activityController.writeStderr;
  const requestReadyPlanApproval = createPlanReadyApprovalRequester({
    writeStdout: writeInteractiveStdout,
    writeStderr: writeInteractiveStderr,
    openPlanInEditor: input.openPlanInEditor,
  });

  const handleInteractiveInput = createRunStartInteractiveHandler({
    writeStdout: writeInteractiveStdout,
    writeStderr: writeInteractiveStderr,
    hasPendingAsk: input.hasPendingAsk,
    getPendingAskQueueSize: input.getPendingAskQueueSize,
    getPendingAskPromptSummary: input.getPendingAskPromptSummary,
    showPendingAskQueue: (limit) => {
      input.showPendingAskQueue(limit);
    },
    selectPendingAskAnswer: input.selectPendingAskAnswer,
    showHelp: () => {
      writeInteractiveStdout(input.buildHelpText());
    },
    showHealthStatus: () => {
      input.showHealthStatus();
    },
    showContextStatus: () => {
      input.showContextStatus();
    },
    showMemoryStatus: () => {
      input.showMemoryStatus();
    },
    showSkillsStatus: () => {
      input.showSkillsStatus();
    },
    showMcpStatus: () => {
      input.showMcpStatus();
    },
    openModelMenu: input.openModelMenu,
    showStatusCurrent: input.showStatusCurrent,
    setStatusTheme: input.setStatusTheme,
    setStatusLayoutMode: input.setStatusLayoutMode,
    setStatusSegmentEnabled: input.setStatusSegmentEnabled,
    openStatusMenu: input.openStatusMenu,
    openSessionMenu: async (mode, withInputPaused) => {
      await input.openSessionMenu(mode, withInputPaused);
    },
    listSessionSummaries: input.listSessionSummaries,
    getActiveSessionId: input.getActiveSessionId,
    listRewindCheckpoints: input.listRewindCheckpoints,
    rewindSession: input.rewindSession,
    createNewSession: input.createNewSession,
    switchActiveSession: input.switchActiveSession,
    continueFromSession: input.continueFromSession,
    writeHandoff: input.writeManualHandoff,
    isPlanMode: input.isPlanMode,
    showPlanStatus: input.showPlanStatus,
    enterPlan: (goal, withInputPaused) =>
      activityController.runActivityScope({
        traceEvent: "plan_enter",
        startActivity: {
          stageId: "plan_turn_start",
          text: "Entering plan mode and preparing plan context",
          planMode: true,
        },
        operation: () =>
          input.enterPlan(goal, {
            writeStdout: writeInteractiveStdout,
            writeStderr: writeInteractiveStderr,
            diagnosticsMode: interactiveDiagnosticsMode,
            showWorkingNotice: true,
            requestReadyPlanApproval: requestReadyPlanApproval(withInputPaused),
          }),
      }),
    applyPlan: (extra) =>
      activityController.runActivityScope({
        traceEvent: "plan_apply",
        startActivity: {
          stageId: "plan_apply_start",
          text: "Preparing approved plan execution",
          planMode: true,
        },
        operation: () =>
          input.applyPlan(extra, {
            writeStdout: writeInteractiveStdout,
            writeStderr: writeInteractiveStderr,
            diagnosticsMode: interactiveDiagnosticsMode,
            showWorkingNotice: true,
          }),
      }),
    cancelPlan: input.cancelPlan,
    requestPlanInterrupt: input.requestPlanInterrupt,
    requestRuntimeInterrupt: input.requestRuntimeInterrupt,
    runPlanTurn: (userInput, withInputPaused) =>
      activityController.runActivityScope({
        traceEvent: "plan_turn",
        startActivity: {
          stageId: "plan_turn_start",
          text: "Reading goal and preparing plan context",
          planMode: true,
        },
        operation: () =>
          input.runPlanTurn(userInput, {
            writeStdout: writeInteractiveStdout,
            writeStderr: writeInteractiveStderr,
            diagnosticsMode: interactiveDiagnosticsMode,
            showWorkingNotice: true,
            requestReadyPlanApproval: requestReadyPlanApproval(withInputPaused),
          }),
      }),
    handleUserCommandsCommand: input.handleUserCommandsCommand,
    openCommandsMenu: input.openCommandsMenu,
    openPlanInEditor: (withInputPaused) =>
      input.openPlanInEditor(withInputPaused, {
        writeStderr: writeInteractiveStderr,
      }),
    showHistory: (query) => input.showHistory(query),
    promptSkillCreatorRequirement: input.promptSkillCreatorRequirement,
    runSkillCreator: (requirement) =>
      input.runSkillCreator(requirement, {
        writeStderr: writeInteractiveStderr,
      }),
    runInitProjectInstructions: () =>
      input.runInitProjectInstructions({
        writeStderr: writeInteractiveStderr,
      }),
    tryRunUserCommand: (userInput) =>
      input.tryRunUserCommand(userInput, {
        writeStderr: writeInteractiveStderr,
      }),
    executeTurn: async (userInput, interactiveMode, options) => {
      const inlineAttachmentResolution = resolveInlineAttachmentsFromInput(userInput);
      return activityController.runInteractiveTurn({
        interactiveMode,
        operation: () => input.executeTurn(
          inlineAttachmentResolution.userInput,
          interactiveMode,
          {
            attachments: inlineAttachmentResolution.attachments,
            promptPrelude: options?.promptPrelude,
            autoOpenAskUserPanel: options?.autoOpenAskUserPanel,
            writeStdout: writeInteractiveStdout,
            writeStderr: options?.writeStderr ?? writeInteractiveStderr,
            onRuntimeEvent: activityController.observeRuntimeEvent,
          },
        ),
      });
    },
    markFailureObserved: input.markFailureObserved,
  });

  const projectFolder = resolveProjectFolder(input.projectRoot, input.projectName);
  const readPromptBudgetSnapshot = createPromptBudgetSnapshotReader({
    workDir: input.workDir,
  });
  let terminalTitleSnapshot = "";
  const queuedInputPreview: string[] = [];
  const dynamicPrompt = (): SessionPromptLayout => {
    const modelSnapshot = input.getModelSnapshot();
    const statusLineConfig = input.getStatusLineConfig();
    const budgetSnapshot = readPromptBudgetSnapshot(statusLineConfig);
    const terminalColumns = resolveTerminalColumns();
    const statusContextWindowTokens = resolveModelContextWindowTokens({
      modelName: modelSnapshot.model,
      getCachedModelContextWindowTokens: input.getCachedModelContextWindowTokens,
      fallback: input.contextWindowTokens,
    });
    const pendingAskCount = input.getPendingAskQueueSize();
    const renderedPrompt = renderBottomPaneFooter({
      model: `${modelSnapshot.providerName}/${modelSnapshot.model}`,
      projectFolder,
      contextWindowUsageRatio: budgetSnapshot.contextWindowUsageRatio,
      estimatedTokens: budgetSnapshot.estimatedTokens,
      targetTokenLimit: budgetSnapshot.targetTokenLimit,
      contextWindowTokens: statusContextWindowTokens,
      sessionId: input.getActiveSessionId(),
      sessionTopic: input.getActiveSessionTopic(),
      planMode: input.isPlanMode(),
      terminalColumns,
      activityText: pendingAskCount <= 0
        ? activityController.readPromptActivityText()
        : undefined,
      promptLabel: "❯ ",
      pendingAskCount,
      pendingAskSummary: input.getPendingAskPromptSummary?.(),
      queuedInputCount: queuedInputPreview.length,
      queuedInputPreview: queuedInputPreview[0],
      running: activityController.isTurnActive(),
      config: statusLineConfig,
    });
    const nextTitle = buildInteractiveWindowTitle({
      projectFolder,
      providerName: modelSnapshot.providerName,
      modelName: modelSnapshot.model,
      sessionId: input.getActiveSessionId(),
      sessionTopic: input.getActiveSessionTopic(),
      planMode: input.isPlanMode(),
    });
    if (nextTitle !== terminalTitleSnapshot) {
      setTerminalWindowTitle(nextTitle);
      terminalTitleSnapshot = nextTitle;
    }
    return buildInteractivePromptLayout({
      renderedPrompt,
      promptLabel: "❯ ",
      promptSlot: {
        pendingAskCount,
        running: activityController.isTurnActive(),
        hasStatusLine: renderedPrompt.trim().length > 0,
        terminalRows: resolveTerminalRows(),
        fullscreen: input.isPlanMode() ? false : true,
      },
    });
  };

  pendingInputFrame = createPendingInputFrameController({
    inlineProgressSupported: activityController.isInlineProgressSupported,
    resolvePrompt: dynamicPrompt,
    ensureStdoutLineBoundary: activityController.ensureStdoutLineBoundary,
  });
  activityController.setPendingInputFrame(pendingInputFrame);

  const handleInteractiveInputWithPendingFrame = async (
    userInputRaw: string,
    controls: SessionInteractiveControls,
  ): Promise<"continue" | "break"> => {
    pendingInputFrame.enable();
    try {
      return await handleInteractiveInput(userInputRaw, controls);
    } finally {
      pendingInputFrame.clear();
      pendingInputFrame.disable();
    }
  };

  const getSlashSuggestions = (lineInput: string) => {
    const pendingAskCount = input.getPendingAskQueueSize();
    const normalizedLineInput = lineInput.trimStart().toLowerCase();
    const planSuggestionState = normalizedLineInput.startsWith("/plan")
      ? input.getPlanSuggestionState?.()
      : undefined;
    const suggestions = listRunStartSlashSuggestions({
      homeDir: input.homeDir,
      userInput: lineInput,
      pendingAskCount,
      planMode: input.isPlanMode(),
      planSuggestionState,
      maxItems: INTERACTIVE_SLASH_SUGGESTION_LIMIT,
    });
    if (pendingAskCount <= 0) {
      return suggestions;
    }
    return suggestions.filter((item) => {
      const commandHead = (item.command.trim().split(/\s+/, 1)[0] ?? "").toLowerCase();
      return PENDING_ASK_ALLOWED_SUGGESTION_HEADS.has(commandHead);
    });
  };

  try {
    await runSessionInputLoop(handleInteractiveInputWithPendingFrame, dynamicPrompt, {
      getSlashSuggestions,
      getInlineImageHighlightTheme: () => input.getStatusLineConfig().theme,
      shouldSuppressSubmitTranscript: (value) => {
        return shouldSuppressRunStartSubmitTranscript({
          value,
          planMode: input.isPlanMode(),
          pendingAskCount: input.getPendingAskQueueSize(),
        });
      },
      onQueueInputWhileRunning: (value) => {
        queuedInputPreview.push(value);
        pendingInputFrame.rerender();
      },
      onQueuedInputConsumed: () => {
        queuedInputPreview.shift();
        pendingInputFrame.rerender();
      },
      openHistorySearch: (historyInput) =>
        input.openHistorySearch({
          currentInput: historyInput.currentInput,
        }),
      onEscapeInterrupt: async (phase) => {
        if (input.isPlanMode()) {
          if (phase === "idle") {
            await input.cancelPlan();
            return;
          }
          await input.requestPlanInterrupt("cli_esc");
          return;
        }
        if (phase === "running") {
          await input.requestRuntimeInterrupt("cli_esc");
        }
      },
    });
  } finally {
    activityController.stopInlineActivityTicker(false);
    clearTerminalWindowTitle();
  }

  if (input.handoffAutoOnExit && input.getHistoryMessagesCount() > 0) {
    input.writeAutoExitHandoffIfNeeded();
  }
}
