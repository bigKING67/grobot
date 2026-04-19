import { SessionStoreRuntime } from "../services/session-store";
import { SessionInteractiveControls, type SessionMenuMode } from "./session-interactive";
import { printRunStartBanner } from "./run-start-banner";
import { createRunStartInteractiveHandler } from "./run-start-interactive-handler";
import { resolveInlineAttachmentsFromInput, runSessionInputLoop } from "./run-start-io";
import { type RunStartModelSnapshot } from "./run-start-model-ops";
import { type PlanInterruptSource } from "./run-start-plan-mode";
import { type RunStartSessionSummary } from "./run-start-session-ops";
import { listRunStartSlashSuggestions } from "./run-start-slash-suggestions";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import { inferModelApiContextWindowTokens } from "./run-start-model-context";
import { readPromptQualityWindowSummary } from "../../../../tools/context";
import { createInteractiveActivityTracker } from "../ui/interactive/activity-state";
import { type SessionPromptLayout } from "../ui/interactive/interactive-frame";
import { renderStatusLinePrompt, type StatusLineConfig } from "../ui/screens/status-line-screen";
import { type RuntimeAttachment } from "../../../../models/types";

function resolveProjectFolder(projectRoot: string, fallbackName: string): string {
  const normalized = projectRoot.replace(/[\\/]+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < normalized.length - 1) {
    return normalized.slice(slashIndex + 1);
  }
  return fallbackName;
}

function resolveTerminalColumns(): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.columns === "number"
    && Number.isFinite(stdout.columns)
    && stdout.columns > 0
  ) {
    return stdout.columns;
  }
  return undefined;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const ANSI_PATTERN = /\u001B\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function buildInteractivePromptLayout(input: {
  renderedPrompt: string;
  terminalColumns?: number;
  promptLabel: string;
}): SessionPromptLayout {
  const lines = input.renderedPrompt.split("\n").filter((line) => line.length > 0);
  const promptBlockStartIndex = lines.findIndex(
    (line) => line.includes("╭") && line.includes("╮"),
  );
  const statusLines = promptBlockStartIndex > 0
    ? lines.slice(0, promptBlockStartIndex)
    : lines.slice(0, 1);
  const promptTopBorder = promptBlockStartIndex >= 0
    ? lines[promptBlockStartIndex] ?? ""
    : "";
  const dividerWidth = (() => {
    const firstStatusLine = statusLines[0] ?? "";
    if (
      typeof input.terminalColumns === "number"
      && Number.isFinite(input.terminalColumns)
      && input.terminalColumns > 8
    ) {
      return Math.max(16, Math.floor(input.terminalColumns) - 4);
    }
    return Math.max(48, stripAnsi(firstStatusLine).length + 6);
  })();
  const divider = `\u001B[90m${"─".repeat(dividerWidth)}\u001B[0m`;
  const prefixLines = [
    divider,
    ...statusLines,
    promptTopBorder,
  ].filter((line) => line.length > 0);
  return {
    prefix: prefixLines.join("\n"),
    inlinePrompt: input.promptLabel,
    suffix: "",
    renderSuffixWhileTyping: false,
  };
}

function resolvePromptBudgetSnapshot(workDir: string): {
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
} {
  const summary = readPromptQualityWindowSummary({
    workDir,
    size: 1,
  });
  return {
    contextWindowUsageRatio: summary.tokenBudget.averageUtilizationRatio ?? undefined,
    estimatedTokens: summary.tokenBudget.averageEstimatedTokens ?? undefined,
    targetTokenLimit: summary.tokenBudget.averageTargetTokenLimit ?? undefined,
  };
}

function hasBudgetSnapshotValue(input: {
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
}): boolean {
  return (
    typeof input.contextWindowUsageRatio === "number"
    || typeof input.estimatedTokens === "number"
    || typeof input.targetTokenLimit === "number"
  );
}

function createPromptBudgetSnapshotReader(input: {
  workDir: string;
}): (config: StatusLineConfig) => {
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
} {
  let cacheResolvedAtMs = 0;
  let cachedSnapshot: {
    contextWindowUsageRatio?: number;
    estimatedTokens?: number;
    targetTokenLimit?: number;
  } = {};
  let lastKnownGoodSnapshot: {
    contextWindowUsageRatio?: number;
    estimatedTokens?: number;
    targetTokenLimit?: number;
  } | undefined;

  return (config: StatusLineConfig): {
    contextWindowUsageRatio?: number;
    estimatedTokens?: number;
    targetTokenLimit?: number;
  } => {
    const now = Date.now();
    if (now - cacheResolvedAtMs <= config.budgetSnapshotCacheTtlMs) {
      return cachedSnapshot;
    }
    cacheResolvedAtMs = now;
    try {
      const snapshot = resolvePromptBudgetSnapshot(input.workDir);
      cachedSnapshot = snapshot;
      if (hasBudgetSnapshotValue(snapshot)) {
        lastKnownGoodSnapshot = snapshot;
      }
      return snapshot;
    } catch {
      if (lastKnownGoodSnapshot) {
        cachedSnapshot = lastKnownGoodSnapshot;
        return lastKnownGoodSnapshot;
      }
      cachedSnapshot = {};
      return cachedSnapshot;
    }
  };
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
  buildHelpText(): string;
  showHealthStatus(): void;
  getCachedModelContextWindowTokens(modelId: string): number | undefined;
  refreshModelCatalogCache(): Promise<void>;
  showModelCurrent(): Promise<void>;
  listModels(): Promise<void>;
  useModel(modelId: string): Promise<void>;
  resetModel(): Promise<void>;
  openModelMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  showStatusCurrent(): void;
  setStatusTheme(theme: string): void;
  setStatusLayoutMode(layoutMode: string): void;
  setStatusSegmentEnabled(segmentId: string, enabled: boolean): void;
  openSessionMenu(mode: SessionMenuMode, withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  createNewSession(): Promise<string>;
  switchActiveSession(targetSessionId: string, reason: string): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeManualHandoff(): void;
  isPlanMode(): boolean;
  showPlanStatus(): Promise<number>;
  enterPlan(goal: string): Promise<number>;
  applyPlan(extra: string): Promise<number>;
  cancelPlan(): Promise<number>;
  requestPlanInterrupt(source: PlanInterruptSource): Promise<void>;
  requestRuntimeInterrupt(source: PlanInterruptSource): Promise<void>;
  runPlanTurn(userInput: string): Promise<number>;
  handleUserCommandsCommand(userInput: string): Promise<void>;
  tryRunUserCommand(userInput: string): Promise<boolean>;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      attachments?: RuntimeAttachment[];
    },
  ): Promise<number>;
  markFailureObserved(): void;
  getHistoryMessagesCount(): number;
  writeAutoExitHandoffIfNeeded(): void;
  getActiveSessionId(): string;
  getActiveSessionTopic(): string | undefined;
  getModelSnapshot(): RunStartModelSnapshot;
  getStatusLineConfig(): StatusLineConfig;
  listSessionSummaries(): RunStartSessionSummary[];
}

function resolveModelContextWindowTokens(input: {
  modelName: string;
  fallback?: number;
  getCachedModelContextWindowTokens(modelId: string): number | undefined;
}): number | undefined {
  const cachedTokens = input.getCachedModelContextWindowTokens(input.modelName);
  if (
    typeof cachedTokens === "number"
    && Number.isFinite(cachedTokens)
    && cachedTokens > 0
  ) {
    return Math.floor(cachedTokens);
  }
  return inferModelApiContextWindowTokens({
    modelName: input.modelName,
    fallback: input.fallback,
  });
}

export async function runStartInteractiveMode(input: RunStartInteractiveModeInput): Promise<void> {
  try {
    await input.refreshModelCatalogCache();
  } catch {
    // keep interactive mode available even if model catalog prefetch fails
  }
  const startupModelSnapshot = input.getModelSnapshot();
  const startupSessionTopic = input.getActiveSessionTopic();
  const startupPromptBudget = resolvePromptBudgetSnapshot(input.workDir);
  const startupContextWindowTokens = resolveModelContextWindowTokens({
    modelName: startupModelSnapshot.model,
    getCachedModelContextWindowTokens: input.getCachedModelContextWindowTokens,
    fallback:
      typeof input.contextWindowTokens === "number"
      && Number.isFinite(input.contextWindowTokens)
      && input.contextWindowTokens > 0
        ? input.contextWindowTokens
        : startupPromptBudget.targetTokenLimit,
  });
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
    contextWindowTokens: startupContextWindowTokens,
    recentSessions: startupRecentSessions,
  });

  const interactiveDiagnosticsEnabled = isTruthyEnvFlag(
    process.env.GROBOT_INTERACTIVE_DIAGNOSTICS,
  );
  const activityTracker = createInteractiveActivityTracker({
    writeProgressLine: (line) => {
      process.stdout.write(line);
    },
  });

  const handleInteractiveInput = createRunStartInteractiveHandler({
    writeStdout: (message) => {
      process.stdout.write(message);
    },
    writeStderr: (message) => {
      if (interactiveDiagnosticsEnabled) {
        activityTracker.observeStderrChunk(message);
        process.stderr.write(message);
        return;
      }
      const forwarded = activityTracker.consumeStderrChunk(message);
      if (forwarded.length > 0) {
        process.stderr.write(forwarded);
      }
    },
    showHelp: () => {
      process.stdout.write(input.buildHelpText());
    },
    showHealthStatus: () => {
      input.showHealthStatus();
    },
    showModelCurrent: input.showModelCurrent,
    listModels: input.listModels,
    useModel: input.useModel,
    resetModel: input.resetModel,
    openModelMenu: input.openModelMenu,
    showStatusCurrent: input.showStatusCurrent,
    setStatusTheme: input.setStatusTheme,
    setStatusLayoutMode: input.setStatusLayoutMode,
    setStatusSegmentEnabled: input.setStatusSegmentEnabled,
    openSessionMenu: async (mode, withInputPaused) => {
      await input.openSessionMenu(mode, withInputPaused);
    },
    createNewSession: input.createNewSession,
    switchActiveSession: input.switchActiveSession,
    continueFromSession: input.continueFromSession,
    writeHandoff: input.writeManualHandoff,
    isPlanMode: input.isPlanMode,
    showPlanStatus: input.showPlanStatus,
    enterPlan: input.enterPlan,
    applyPlan: input.applyPlan,
    cancelPlan: input.cancelPlan,
    requestPlanInterrupt: input.requestPlanInterrupt,
    requestRuntimeInterrupt: input.requestRuntimeInterrupt,
    runPlanTurn: input.runPlanTurn,
    handleUserCommandsCommand: input.handleUserCommandsCommand,
    tryRunUserCommand: input.tryRunUserCommand,
    executeTurn: async (userInput, interactiveMode) => {
      const inlineAttachmentResolution = resolveInlineAttachmentsFromInput(userInput);
      if (interactiveMode) {
        activityTracker.markTurnStart();
      }
      try {
        const code = await input.executeTurn(
          inlineAttachmentResolution.userInput,
          interactiveMode,
          {
            attachments: inlineAttachmentResolution.attachments,
          },
        );
        if (!interactiveDiagnosticsEnabled) {
          const buffered = activityTracker.flushBufferedStderr();
          if (buffered.length > 0) {
            process.stderr.write(buffered);
          }
        }
        if (interactiveMode) {
          activityTracker.markTurnFinished(
            code === TURN_INTERRUPTED_EXIT_CODE
              ? "interrupted"
              : code === 0
                ? "ok"
                : "error",
          );
        }
        return code;
      } catch (error) {
        if (!interactiveDiagnosticsEnabled) {
          const buffered = activityTracker.flushBufferedStderr();
          if (buffered.length > 0) {
            process.stderr.write(buffered);
          }
        }
        if (interactiveMode) {
          activityTracker.markTurnFinished("error");
        }
        throw error;
      }
    },
    markFailureObserved: input.markFailureObserved,
  });

  const projectFolder = resolveProjectFolder(input.projectRoot, input.projectName);
  const readPromptBudgetSnapshot = createPromptBudgetSnapshotReader({
    workDir: input.workDir,
  });
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
    const renderedPrompt = renderStatusLinePrompt({
      model: `${modelSnapshot.providerName}/${modelSnapshot.model}`,
      projectFolder,
      contextWindowUsageRatio: budgetSnapshot.contextWindowUsageRatio,
      estimatedTokens: budgetSnapshot.estimatedTokens,
      targetTokenLimit: budgetSnapshot.targetTokenLimit,
      contextWindowTokens: statusContextWindowTokens,
      sessionId: input.getActiveSessionId(),
      sessionTopic: input.getActiveSessionTopic(),
      terminalColumns,
      activityText: activityTracker.readPromptActivity(),
      promptLabel: "› ",
      config: statusLineConfig,
    });
    return buildInteractivePromptLayout({
      renderedPrompt,
      terminalColumns,
      promptLabel: "› ",
    });
  };
  const getSlashSuggestions = (lineInput: string) =>
    listRunStartSlashSuggestions({
      homeDir: input.homeDir,
      userInput: lineInput,
      maxItems: 8,
    });

  await runSessionInputLoop(handleInteractiveInput, dynamicPrompt, {
    getSlashSuggestions,
    getInlineImageHighlightTheme: () => input.getStatusLineConfig().theme,
    onEscapeInterrupt: async () => {
      if (input.isPlanMode()) {
        await input.requestPlanInterrupt("cli_esc");
        return;
      }
      await input.requestRuntimeInterrupt("cli_esc");
    },
  });

  if (input.handoffAutoOnExit && input.getHistoryMessagesCount() > 0) {
    input.writeAutoExitHandoffIfNeeded();
  }
}
