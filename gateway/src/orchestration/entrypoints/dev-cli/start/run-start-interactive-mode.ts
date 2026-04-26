import { SessionStoreRuntime } from "../services/session-store";
import {
  SessionInteractiveControls,
  type SessionInteractiveRewindCheckpointSummary,
  type SessionInteractiveRewindMode,
  type SessionMenuMode,
} from "./session-interactive";
import { printRunStartBanner } from "./run-start-banner";
import { createRunStartInteractiveHandler } from "./run-start-interactive-handler";
import { resolveInlineAttachmentsFromInput, runSessionInputLoop } from "./run-start-io";
import { type RunStartModelSnapshot } from "./run-start-model-ops";
import { type PlanInterruptSource } from "./run-start-plan-mode";
import { type RunStartSessionSummary } from "./run-start-session-ops";
import { listRunStartSlashSuggestions } from "./run-start-slash-suggestions";
import { type RunStartPlanSuggestionState } from "./plan-suggestion-state";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import { inferModelApiContextWindowTokens } from "./run-start-model-context";
import { readPromptQualityWindowSummary } from "../../../../tools/context";
import { createInteractiveActivityTracker } from "../ui/interactive/activity-state";
import {
  clearTerminalWindowTitle,
  setTerminalWindowTitle,
} from "../ui/interactive/terminal-text-sanitizer";
import { type SessionPromptLayout } from "../ui/interactive/interactive-frame";
import { renderBottomPaneFooter } from "../ui/screens/bottom-pane-screen";
import { type StatusLineConfig } from "../ui/screens/status-line-screen";
import { renderStatusIndicatorLine } from "../ui/screens/status-indicator-screen";
import { type RuntimeAttachment } from "../../../../models/types";

export interface RunStartInteractiveTurnOptions {
  writeStderr?: (message: string) => void;
}

export type InteractiveDiagnosticsMode = "compact" | "verbose" | "trace";

const PENDING_ASK_ALLOWED_SUGGESTION_HEADS = new Set<string>([
  "/sessions",
  "/resume",
  "/rewind",
  "/help",
  "/interrupt",
  "/exit",
  "/quit",
]);

const INLINE_ACTIVITY_TICK_MS = 120;
const INTERACTIVE_SLASH_SUGGESTION_LIMIT = 64;

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

function buildInteractivePromptLayout(input: {
  renderedPrompt: string;
  promptLabel: string;
}): SessionPromptLayout {
  const suffix = input.renderedPrompt
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
  return {
    prefix: "",
    inlinePrompt: input.promptLabel,
    suffix,
    renderSuffixWhileTyping: true,
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

function formatTurnElapsedCompact(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours)}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${String(seconds)}s`;
}

function compactSummaryText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

type ProcessFailureCategory = "runtime" | "context" | "ask-user" | "interrupt";
type ProcessSummaryDetail = "none" | "compact" | "full";

interface ProcessActivitySnapshot {
  stageId: string;
  text: string;
}

function resolveProcessFailureCategory(input: {
  result: "ok" | "error" | "interrupted";
  activitySnapshot?: ProcessActivitySnapshot;
  pendingAskCount?: number;
}): ProcessFailureCategory | undefined {
  if (input.result === "ok") {
    return undefined;
  }
  const stageId = input.activitySnapshot?.stageId ?? "";
  if (stageId.startsWith("ask_user")) {
    return "ask-user";
  }
  if (stageId.startsWith("context_")) {
    return "context";
  }
  if ((input.pendingAskCount ?? 0) > 0) {
    return "ask-user";
  }
  if (input.result === "interrupted" || stageId === "interrupt") {
    return "interrupt";
  }
  return "runtime";
}

function resolveProcessResultCode(result: "ok" | "error" | "interrupted"): "ok" | "err" | "int" {
  if (result === "error") {
    return "err";
  }
  if (result === "interrupted") {
    return "int";
  }
  return "ok";
}

function resolveProcessSummaryDetail(): ProcessSummaryDetail {
  const raw = process.env.GROBOT_PROCESS_SUMMARY_DETAIL?.trim().toLowerCase();
  if (raw === "none") {
    return "none";
  }
  if (raw === "full") {
    return "full";
  }
  if (raw === "compact") {
    return "compact";
  }
  return "none";
}

function resolveInteractiveDiagnosticsMode(input: {
  interactiveDiagnosticsMode?: InteractiveDiagnosticsMode;
  interactiveDiagnosticsEnabled?: boolean;
}): InteractiveDiagnosticsMode {
  if (input.interactiveDiagnosticsMode === "trace") {
    return "trace";
  }
  if (input.interactiveDiagnosticsMode === "verbose") {
    return "verbose";
  }
  if (input.interactiveDiagnosticsMode === "compact") {
    return "compact";
  }
  return input.interactiveDiagnosticsEnabled ? "verbose" : "compact";
}

function buildInteractiveWindowTitle(input: {
  projectFolder: string;
  providerName: string;
  modelName: string;
  sessionId: string;
  sessionTopic?: string;
  planMode: boolean;
}): string {
  const sessionLabel = input.sessionTopic?.trim().length
    ? input.sessionTopic.trim()
    : input.sessionId;
  const planLabel = input.planMode ? " · PLAN" : "";
  return `Grobot · ${input.projectFolder} · ${sessionLabel} · ${input.providerName}/${input.modelName}${planLabel}`;
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
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
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
  const interactiveDiagnosticsMode = resolveInteractiveDiagnosticsMode({
    interactiveDiagnosticsEnabled: input.interactiveDiagnosticsEnabled,
    interactiveDiagnosticsMode: input.interactiveDiagnosticsMode,
  });
  const traceDiagnosticsEnabled = interactiveDiagnosticsMode === "trace";
  const progressDiagnosticsEnabled = interactiveDiagnosticsMode === "verbose";
  const processSummaryDetail = resolveProcessSummaryDetail();
  const suppressDiagnosticStderr = !traceDiagnosticsEnabled;
  const inlineProgressSupported = Boolean((process.stdout as { isTTY?: boolean }).isTTY)
    && !traceDiagnosticsEnabled;
  let inlineProgressActive = false;
  let inlineProgressText = "";
  let inlineActivityTicker: ReturnType<typeof setInterval> | undefined;
  let inlineActivityTick = 0;
  let stdoutNeedsLineBreak = false;
  const ensureInteractiveStdoutLineBoundary = (): void => {
    if (!stdoutNeedsLineBreak) {
      return;
    }
    process.stdout.write("\n");
    stdoutNeedsLineBreak = false;
  };
  const clearInlineProgress = (insertNewline: boolean): void => {
    if (!inlineProgressSupported || !inlineProgressActive) {
      return;
    }
    process.stdout.write("\r\x1b[2K");
    if (insertNewline) {
      process.stdout.write("\n");
    }
    inlineProgressActive = false;
    inlineProgressText = "";
  };
  const writeProgressLine = (line: string): void => {
    if (!inlineProgressSupported) {
      process.stdout.write(line);
      return;
    }
    const rendered = line.replace(/\r?\n$/, "");
    if (!rendered || rendered === inlineProgressText) {
      return;
    }
    process.stdout.write(`\r\x1b[2K${rendered}`);
    inlineProgressActive = true;
    inlineProgressText = rendered;
  };
  const renderInlineActivityTicker = (): void => {
    if (!inlineProgressSupported || typeof activeTurnStartedAtMs !== "number") {
      return;
    }
    const activityText = compactSummaryText(activityTracker.readPromptActivity() ?? "正在执行");
    writeProgressLine(renderStatusIndicatorLine({
      message: activityText,
      startedAtMs: activeTurnStartedAtMs,
      nowMs: Date.now(),
      tick: inlineActivityTick,
      terminalColumns: resolveTerminalColumns(),
    }));
    inlineActivityTick += 1;
  };
  const startInlineActivityTicker = (): void => {
    if (!inlineProgressSupported || inlineActivityTicker) {
      return;
    }
    inlineActivityTick = 0;
    renderInlineActivityTicker();
    inlineActivityTicker = setInterval(() => {
      if (typeof activeTurnStartedAtMs !== "number") {
        return;
      }
      renderInlineActivityTicker();
    }, INLINE_ACTIVITY_TICK_MS);
  };
  const stopInlineActivityTicker = (insertNewline: boolean): void => {
    if (inlineActivityTicker) {
      clearInterval(inlineActivityTicker);
      inlineActivityTicker = undefined;
    }
    clearInlineProgress(insertNewline);
  };
  const writeTurnSummaryLine = (inputSummary: {
    result: "ok" | "error" | "interrupted";
    elapsedMs: number;
    exitCode?: number | "<exception>";
    pendingAskCount?: number;
    activitySnapshot?: ProcessActivitySnapshot;
  }): void => {
    if (!progressDiagnosticsEnabled || traceDiagnosticsEnabled || processSummaryDetail === "none") {
      return;
    }
    const durationText = formatTurnElapsedCompact(inputSummary.elapsedMs);
    const failureCategory = resolveProcessFailureCategory({
      result: inputSummary.result,
      activitySnapshot: inputSummary.activitySnapshot,
      pendingAskCount: inputSummary.pendingAskCount,
    });
    const parts = [
      "[process-summary]",
      resolveProcessResultCode(inputSummary.result),
      durationText,
    ];
    if (failureCategory) {
      parts.push(`t=${failureCategory}`);
    }
    if (typeof inputSummary.exitCode === "number" || inputSummary.exitCode === "<exception>") {
      parts.push(`x=${String(inputSummary.exitCode)}`);
    }
    if ((inputSummary.pendingAskCount ?? 0) > 0) {
      parts.push(`ask=${String(inputSummary.pendingAskCount)}`);
    }
    const shouldShowStage = processSummaryDetail === "full"
      || inputSummary.result !== "ok"
      || inputSummary.elapsedMs >= 5_000;
    if (inputSummary.activitySnapshot && shouldShowStage) {
      parts.push(`s="${compactSummaryText(inputSummary.activitySnapshot.text).replace(/"/g, "'")}"`);
    }
    ensureInteractiveStdoutLineBoundary();
    stopInlineActivityTicker(false);
    process.stdout.write(`${parts.join(" ")}\n`);
  };
  const activityTracker = createInteractiveActivityTracker(
    progressDiagnosticsEnabled
      ? {
        writeProgressLine,
      }
      : {},
  );
  const writeInteractiveTrace = (message: string): void => {
    if (!traceDiagnosticsEnabled) {
      return;
    }
    process.stderr.write(`[trace] ${message}\n`);
  };
  let activeTurnStartedAtMs: number | undefined;
  const writeInteractiveStderr = (message: string): void => {
    if (!suppressDiagnosticStderr) {
      activityTracker.observeStderrChunk(message);
      stopInlineActivityTicker(true);
      process.stderr.write(message);
      return;
    }
    const forwarded = activityTracker.consumeStderrChunk(message);
    if (forwarded.length > 0) {
      stopInlineActivityTicker(true);
      process.stderr.write(forwarded);
      if (typeof activeTurnStartedAtMs === "number") {
        renderInlineActivityTicker();
      }
    }
  };
  const writeInteractiveStdout = (message: string): void => {
    stopInlineActivityTicker(true);
    process.stdout.write(message);
    if (message.length > 0) {
      stdoutNeedsLineBreak = !message.endsWith("\n");
    }
  };

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
    enterPlan: (goal) =>
      input.enterPlan(goal, {
        writeStderr: writeInteractiveStderr,
      }),
    applyPlan: (extra) =>
      input.applyPlan(extra, {
        writeStderr: writeInteractiveStderr,
      }),
    cancelPlan: input.cancelPlan,
    requestPlanInterrupt: input.requestPlanInterrupt,
    requestRuntimeInterrupt: input.requestRuntimeInterrupt,
    runPlanTurn: (userInput) =>
      input.runPlanTurn(userInput, {
        writeStderr: writeInteractiveStderr,
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
    executeTurn: async (userInput, interactiveMode) => {
      const inlineAttachmentResolution = resolveInlineAttachmentsFromInput(userInput);
      if (interactiveMode) {
        activeTurnStartedAtMs = Date.now();
        activityTracker.markTurnStart();
        startInlineActivityTicker();
        writeInteractiveTrace(`event=turn_start mode=${interactiveDiagnosticsMode}`);
      }
      try {
        const code = await input.executeTurn(
          inlineAttachmentResolution.userInput,
          interactiveMode,
          {
            attachments: inlineAttachmentResolution.attachments,
            writeStdout: writeInteractiveStdout,
            writeStderr: writeInteractiveStderr,
          },
        );
        if (suppressDiagnosticStderr) {
          const buffered = activityTracker.flushBufferedStderr();
          if (buffered.length > 0) {
            stopInlineActivityTicker(true);
            process.stderr.write(buffered);
          }
        }
        if (interactiveMode) {
          stopInlineActivityTicker(false);
          const elapsedMs = Math.max(0, Date.now() - (activeTurnStartedAtMs ?? Date.now()));
          const activitySnapshot = activityTracker.readPromptActivitySnapshot();
          activityTracker.markTurnFinished(
            code === TURN_INTERRUPTED_EXIT_CODE
              ? "interrupted"
              : code === 0
                ? "ok"
                : "error",
          );
          ensureInteractiveStdoutLineBoundary();
          writeTurnSummaryLine({
            result: code === TURN_INTERRUPTED_EXIT_CODE
              ? "interrupted"
              : code === 0
                ? "ok"
                : "error",
            elapsedMs,
            exitCode: code === 0 || code === TURN_INTERRUPTED_EXIT_CODE ? undefined : code,
            pendingAskCount: input.getPendingAskQueueSize(),
            activitySnapshot: activitySnapshot
              ? {
                stageId: activitySnapshot.stageId,
                text: activitySnapshot.text,
              }
              : undefined,
          });
          writeInteractiveTrace(
            `event=turn_finish mode=${interactiveDiagnosticsMode} result=${
              code === TURN_INTERRUPTED_EXIT_CODE
                ? "interrupted"
                : code === 0
                  ? "ok"
                  : "error"
            } exit_code=${String(code)} duration_ms=${String(elapsedMs)}`,
          );
          activeTurnStartedAtMs = undefined;
        }
        return code;
      } catch (error) {
        if (suppressDiagnosticStderr) {
          const buffered = activityTracker.flushBufferedStderr();
          if (buffered.length > 0) {
            stopInlineActivityTicker(true);
            process.stderr.write(buffered);
          }
        }
        if (interactiveMode) {
          stopInlineActivityTicker(false);
          const elapsedMs = Math.max(0, Date.now() - (activeTurnStartedAtMs ?? Date.now()));
          const activitySnapshot = activityTracker.readPromptActivitySnapshot();
          activityTracker.markTurnFinished("error");
          ensureInteractiveStdoutLineBoundary();
          writeTurnSummaryLine({
            result: "error",
            elapsedMs,
            exitCode: "<exception>",
            pendingAskCount: input.getPendingAskQueueSize(),
            activitySnapshot: activitySnapshot
              ? {
                stageId: activitySnapshot.stageId,
                text: activitySnapshot.text,
              }
              : undefined,
          });
          writeInteractiveTrace(
            `event=turn_finish mode=${interactiveDiagnosticsMode} result=error exit_code=<exception> duration_ms=${String(
              elapsedMs,
            )}`,
          );
          activeTurnStartedAtMs = undefined;
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
  let terminalTitleSnapshot = "";
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
      activityText:
        pendingAskCount <= 0
          ? (activityTracker.readActivitySnapshot()?.title ?? activityTracker.readPromptActivity())
          : undefined,
      promptLabel: "❯ ",
      pendingAskCount,
      pendingAskSummary: input.getPendingAskPromptSummary?.(),
      running: typeof activeTurnStartedAtMs === "number",
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
    });
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
    await runSessionInputLoop(handleInteractiveInput, dynamicPrompt, {
      getSlashSuggestions,
      getInlineImageHighlightTheme: () => input.getStatusLineConfig().theme,
      shouldSuppressSubmitTranscript: (value) => {
        if (input.getPendingAskQueueSize() <= 0) {
          return false;
        }
        const normalized = value.trim();
        return normalized.length === 0 || normalized === "?";
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
    stopInlineActivityTicker(false);
    clearTerminalWindowTitle();
  }

  if (input.handoffAutoOnExit && input.getHistoryMessagesCount() > 0) {
    input.writeAutoExitHandoffIfNeeded();
  }
}
