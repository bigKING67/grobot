import { readFileSync } from "node:fs";
import { relative as relativePath, resolve as resolvePath } from "node:path";
import { SessionStoreRuntime } from "../services/session-store";
import {
  SessionInteractiveControls,
  type SessionInteractiveRewindCheckpointSummary,
  type SessionInteractiveRewindMode,
  type SessionMenuMode,
} from "./session-interactive";
import { printRunStartBanner } from "./run-start-banner";
import { createRunStartInteractiveHandler } from "./run-start-interactive-handler";
import {
  renderInteractiveInputChromeLines,
  resolveInlineAttachmentsFromInput,
  resolveInteractiveInputBodyWidth,
  runSessionInputLoop,
  runTerminalSelectMenu,
} from "./run-start-io";
import { isNaturalPlanExecutionIntent } from "./plan-command";
import { type RunStartModelSnapshot } from "./run-start-model-ops";
import {
  type PlanInterruptSource,
  type PlanReadyApprovalDecision,
  type PlanReadyApprovalRequest,
} from "./run-start-plan-mode";
import { type RunStartSessionSummary } from "./run-start-session-ops";
import { listRunStartSlashSuggestions } from "./run-start-slash-suggestions";
import { type RunStartPlanSuggestionState } from "./plan-suggestion-state";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import { inferModelApiContextWindowTokens } from "./run-start-model-context";
import { readPromptQualityWindowSummary } from "../../../../tools/context";
import {
  createInteractiveActivityTracker,
  type InteractiveActivityTracker,
} from "../ui/interactive/activity-state";
import {
  clearTerminalWindowTitle,
  setTerminalWindowTitle,
} from "../ui/interactive/terminal-text-sanitizer";
import { measureDisplayWidth } from "../ui/interactive/display-width";
import { type SessionPromptLayout } from "../ui/interactive/interactive-frame";
import { renderBottomPaneFooter } from "../ui/screens/bottom-pane-screen";
import { type StatusLineConfig } from "../ui/screens/status-line-screen";
import {
  renderStatusIndicatorLine,
  type StatusIndicatorMode,
} from "../ui/screens/status-indicator-screen";
import { type RuntimeAttachment } from "../../../../models/types";

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

function resolveProjectFolder(projectRoot: string, fallbackName: string): string {
  const normalized = projectRoot.replace(/[\\/]+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < normalized.length - 1) {
    return normalized.slice(slashIndex + 1);
  }
  return fallbackName;
}

function resolveDisplayPlanPath(input: {
  workDir: string;
  planPath: string;
}): string {
  const resolvedWorkDir = resolvePath(input.workDir);
  const resolvedPlanPath = resolvePath(input.planPath);
  const relativePlanPath = relativePath(resolvedWorkDir, resolvedPlanPath);
  if (
    relativePlanPath
    && !relativePlanPath.startsWith("..")
    && !relativePlanPath.startsWith("/")
  ) {
    return relativePlanPath;
  }
  return input.planPath;
}

function resolveExternalEditorDisplayName(): string {
  const rawEditor = String(process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (rawEditor.length === 0) {
    return "editor";
  }
  const command = rawEditor.split(/\s+/)[0] ?? rawEditor;
  const parts = command.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? command;
}

function readPlanContentAfterExternalEdit(planPath: string, fallback: string): string {
  try {
    const content = readFileSync(planPath, "utf8");
    return content.length > 0 ? content : fallback;
  } catch {
    return fallback;
  }
}

function isEmptyPlanApprovalContent(content: string): boolean {
  const normalized = content.trim();
  return normalized.length === 0 || normalized.includes("__REQUIRED__");
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
  promptSlot?: SessionPromptLayout["promptSlot"];
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
    promptSlot: input.promptSlot,
  };
}

function resolveTerminalRows(): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    rows?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.rows === "number"
    && Number.isFinite(stdout.rows)
    && stdout.rows > 0
  ) {
    return Math.floor(stdout.rows);
  }
  return undefined;
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

function resolveInlineStatusIndicatorMode(input: {
  planMode: boolean;
  activityKind?: string;
  stageId?: string;
}): StatusIndicatorMode {
  const stageId = input.stageId ?? "";
  if (
    stageId.startsWith("runtime_model")
    || stageId.startsWith("runtime_route")
    || stageId.startsWith("runtime_retry")
  ) {
    return "requesting";
  }
  if (input.activityKind === "ask-user") {
    return "tool-input";
  }
  if (
    input.activityKind === "context"
    || input.activityKind === "governance"
    || input.activityKind === "memory"
    || input.activityKind === "plan"
  ) {
    return "thinking";
  }
  return input.planMode ? "thinking" : "responding";
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
      promptPrelude?: string;
      autoOpenAskUserPanel?: boolean;
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
  let pendingInputFrameEnabled = false;
  let pendingInputFrameLineCount = 0;
  let pendingInputFrameCursorLineIndex = 0;
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
    if (pendingInputFrameEnabled) {
      rerenderPendingInputFrame();
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
    if (pendingInputFrameEnabled) {
      rerenderPendingInputFrame();
      inlineActivityTick += 1;
      return;
    }
    const defaultActivityText = input.isPlanMode() ? "正在设计实现方案" : "正在执行";
    const activitySnapshot = activityTracker.readActivitySnapshot();
    const activityText = compactSummaryText(
      activitySnapshot?.title ?? activityTracker.readPromptActivity() ?? defaultActivityText,
    );
    const activityDetail = compactSummaryText(activitySnapshot?.detail ?? "");
    const statusMode = resolveInlineStatusIndicatorMode({
      planMode: input.isPlanMode(),
      activityKind: activitySnapshot?.kind,
      stageId: activitySnapshot?.stageId,
    });
    writeProgressLine(renderStatusIndicatorLine({
      message: activityText,
      startedAtMs: activeTurnStartedAtMs,
      nowMs: Date.now(),
      tick: inlineActivityTick,
      terminalColumns: resolveTerminalColumns(),
      mode: statusMode,
      thinkingText: activityDetail || undefined,
      thinkingStatus: statusMode === "thinking" && activityDetail.length === 0
        ? "thinking"
        : undefined,
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
    clearPendingInputFrame();
    ensureInteractiveStdoutLineBoundary();
    stopInlineActivityTicker(false);
    process.stdout.write(`${parts.join(" ")}\n`);
    renderPendingInputFrame();
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
      clearPendingInputFrame();
      ensureInteractiveStdoutLineBoundary();
      process.stderr.write(message);
      renderPendingInputFrameAfterStderr(message);
      return;
    }
    const forwarded = activityTracker.consumeStderrChunk(message);
    if (forwarded.length > 0) {
      stopInlineActivityTicker(true);
      clearPendingInputFrame();
      ensureInteractiveStdoutLineBoundary();
      process.stderr.write(forwarded);
      if (typeof activeTurnStartedAtMs === "number" && !pendingInputFrameEnabled) {
        renderInlineActivityTicker();
      }
      renderPendingInputFrameAfterStderr(forwarded);
      return;
    }
    if (typeof activeTurnStartedAtMs === "number" && !pendingInputFrameEnabled) {
      startInlineActivityTicker();
    }
  };
  const writeInteractiveStdout = (message: string): void => {
    stopInlineActivityTicker(true);
    clearPendingInputFrame();
    process.stdout.write(message);
    if (message.length > 0) {
      stdoutNeedsLineBreak = !message.endsWith("\n");
    }
    renderPendingInputFrameAfterStdout();
  };
  const runInteractiveActivityScope = async (
    inputScope: {
      traceEvent: string;
      startActivity?: Parameters<InteractiveActivityTracker["markTurnStart"]>[0];
      operation: () => Promise<number>;
    },
  ): Promise<number> => {
    if (typeof activeTurnStartedAtMs === "number") {
      return inputScope.operation();
    }
    activeTurnStartedAtMs = Date.now();
    activityTracker.markTurnStart(inputScope.startActivity);
    startInlineActivityTicker();
    writeInteractiveTrace(`event=turn_start mode=${interactiveDiagnosticsMode} source=${inputScope.traceEvent}`);
    try {
      const code = await inputScope.operation();
      if (suppressDiagnosticStderr) {
        const buffered = activityTracker.flushBufferedStderr();
        if (buffered.length > 0) {
          stopInlineActivityTicker(true);
          clearPendingInputFrame();
          ensureInteractiveStdoutLineBoundary();
          process.stderr.write(buffered);
          renderPendingInputFrameAfterStderr(buffered);
        }
      }
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
        `event=turn_finish mode=${interactiveDiagnosticsMode} source=${inputScope.traceEvent} result=${
          code === TURN_INTERRUPTED_EXIT_CODE
            ? "interrupted"
            : code === 0
              ? "ok"
              : "error"
        } exit_code=${String(code)} duration_ms=${String(elapsedMs)}`,
      );
      activeTurnStartedAtMs = undefined;
      return code;
    } catch (error) {
      if (suppressDiagnosticStderr) {
        const buffered = activityTracker.flushBufferedStderr();
        if (buffered.length > 0) {
          stopInlineActivityTicker(true);
          clearPendingInputFrame();
          ensureInteractiveStdoutLineBoundary();
          process.stderr.write(buffered);
          renderPendingInputFrameAfterStderr(buffered);
        }
      }
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
        `event=turn_finish mode=${interactiveDiagnosticsMode} source=${inputScope.traceEvent} result=error exit_code=<exception> duration_ms=${String(
          elapsedMs,
        )}`,
      );
      activeTurnStartedAtMs = undefined;
      throw error;
    }
  };
  const requestReadyPlanApproval = (
    withInputPaused: SessionInteractiveControls["withInputPaused"] | undefined,
  ) =>
    async (request: PlanReadyApprovalRequest): Promise<PlanReadyApprovalDecision> => {
      if (!process.stdin.isTTY || typeof withInputPaused !== "function") {
        return "unavailable";
      }
      const displayPath = resolveDisplayPlanPath({
        workDir: request.workDir,
        planPath: request.planPath,
      });
      let currentPlanContent = request.planContent;
      let planEdited = false;
      let draftFeedback = "";
      while (true) {
        const isEmptyPlan = isEmptyPlanApprovalContent(currentPlanContent);
        const result = await withInputPaused(() =>
          runTerminalSelectMenu({
            title: isEmptyPlan ? "Exit plan mode?" : "Ready to code?",
            hint: isEmptyPlan
              ? "Enter 确认 · Esc 返回输入框"
              : "↑/↓ 选择 · Enter 确认 · Esc 返回输入框",
            variant: "plan_approval",
            visibleOptionCount: 2,
            planApprovalMeta: {
              agentName: "Grobot",
              editorName: resolveExternalEditorDisplayName(),
              planContent: currentPlanContent,
              planPath: displayPath,
              planEdited,
              emptyPlan: isEmptyPlan,
            },
            items: isEmptyPlan
              ? [
                {
                  id: "approve",
                  label: "Yes",
                },
                {
                  id: "keep_planning",
                  label: "No",
                },
              ]
              : [
                {
                  id: "approve",
                  label: "Yes, Implement the plan.",
                  description: "Start implementation from this approved plan.",
                },
                {
                  id: "keep_planning",
                  label: "No, keep planning",
                  description: "shift+tab to approve with this feedback",
                  input: {
                    placeholder: "Tell Grobot what to change",
                    initialValue: draftFeedback,
                    showLabelWithValue: true,
                    labelValueSeparator: ": ",
                    resetCursorOnUpdate: true,
                  },
                },
              ],
          }),
        );
        if (result.kind === "edit_plan") {
          draftFeedback = result.inputValue ?? draftFeedback;
          await input.openPlanInEditor(withInputPaused, {
            writeStdout: writeInteractiveStdout,
            writeStderr: writeInteractiveStderr,
            suppressOpenPlanEditorNotice: true,
          });
          currentPlanContent = readPlanContentAfterExternalEdit(
            request.planPath,
            currentPlanContent,
          );
          planEdited = currentPlanContent !== request.planContent;
          continue;
        }
        if (result.kind === "selected" && result.item.id === "approve") {
          if (isEmptyPlan) {
            return {
              action: "exit_plan_mode",
              planContent: currentPlanContent,
              silent: true,
            };
          }
          const feedback = result.inputValue?.trim();
          return {
            action: "approve",
            ...(feedback && feedback.length > 0 ? { feedback } : {}),
            planContent: currentPlanContent,
          };
        }
        if (result.kind === "selected" && result.item.id === "keep_planning") {
          if (isEmptyPlan) {
            return {
              action: "keep_planning",
              planContent: currentPlanContent,
              silent: true,
            };
          }
          draftFeedback = result.inputValue ?? draftFeedback;
          const feedback = draftFeedback.trim();
          if (feedback.length <= 0) {
            continue;
          }
          return {
            action: "keep_planning",
            feedback,
            planContent: currentPlanContent,
          };
        }
        if (result.kind === "cancelled") {
          return {
            action: "keep_planning",
            planContent: currentPlanContent,
            silent: true,
          };
        }
        return {
          action: "keep_planning",
          planContent: currentPlanContent,
        };
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
    enterPlan: (goal, withInputPaused) =>
      runInteractiveActivityScope({
        traceEvent: "plan_enter",
        startActivity: {
          stageId: "plan_turn_start",
          text: "正在进入计划模式并准备计划上下文",
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
      runInteractiveActivityScope({
        traceEvent: "plan_apply",
        startActivity: {
          stageId: "plan_apply_start",
          text: "正在准备执行已批准计划",
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
      runInteractiveActivityScope({
        traceEvent: "plan_turn",
        startActivity: {
          stageId: "plan_turn_start",
          text: "正在读取目标并准备计划上下文",
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
            promptPrelude: options?.promptPrelude,
            autoOpenAskUserPanel: options?.autoOpenAskUserPanel,
            writeStdout: writeInteractiveStdout,
            writeStderr: options?.writeStderr ?? writeInteractiveStderr,
          },
        );
        if (suppressDiagnosticStderr) {
          const buffered = activityTracker.flushBufferedStderr();
          if (buffered.length > 0) {
            stopInlineActivityTicker(true);
            clearPendingInputFrame();
            ensureInteractiveStdoutLineBoundary();
            process.stderr.write(buffered);
            renderPendingInputFrameAfterStderr(buffered);
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
            clearPendingInputFrame();
            ensureInteractiveStdoutLineBoundary();
            process.stderr.write(buffered);
            renderPendingInputFrameAfterStderr(buffered);
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
          ? (() => {
            const activitySnapshot = activityTracker.readActivitySnapshot();
            if (!activitySnapshot) {
              return activityTracker.readPromptActivity();
            }
            return activitySnapshot.detail
              ? `${activitySnapshot.title} · ${activitySnapshot.detail}`
              : activitySnapshot.title;
          })()
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
      promptSlot: {
        pendingAskCount,
        running: typeof activeTurnStartedAtMs === "number",
        hasStatusLine: renderedPrompt.trim().length > 0,
        terminalRows: resolveTerminalRows(),
        fullscreen: input.isPlanMode() ? false : true,
      },
    });
  };

  function buildPendingInputFrame(): {
    lines: string[];
    cursorLineIndex: number;
    cursorColumn: number;
  } {
    const resolvedPrompt = dynamicPrompt();
    const terminalColumns = Math.max(32, resolveTerminalColumns() ?? 96);
    const promptLabel = resolvedPrompt.inlinePrompt.length > 0
      ? resolvedPrompt.inlinePrompt
      : "❯ ";
    const promptLabelWidth = Math.max(1, measureDisplayWidth(promptLabel));
    const inputBodyWidth = resolveInteractiveInputBodyWidth({
      terminalColumns,
      promptLabelWidth,
    });
    const footerLines = (resolvedPrompt.suffix ?? "")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    return {
      lines: [
        ...renderInteractiveInputChromeLines({
          bodyLines: [`${promptLabel}`],
          inputBodyWidth,
        }),
        ...footerLines,
      ],
      cursorLineIndex: 1,
      cursorColumn: promptLabelWidth,
    };
  }

  function clearPendingInputFrame(): void {
    if (!pendingInputFrameEnabled || pendingInputFrameLineCount <= 0) {
      return;
    }
    process.stdout.write("\r");
    if (pendingInputFrameCursorLineIndex > 0) {
      process.stdout.write(`\x1b[${String(pendingInputFrameCursorLineIndex)}A`);
    }
    process.stdout.write("\x1b[J");
    pendingInputFrameLineCount = 0;
    pendingInputFrameCursorLineIndex = 0;
  }

  function renderPendingInputFrame(): void {
    if (!pendingInputFrameEnabled || !inlineProgressSupported || pendingInputFrameLineCount > 0) {
      return;
    }
    const frame = buildPendingInputFrame();
    if (frame.lines.length <= 0) {
      return;
    }
    process.stdout.write(frame.lines.join("\n"));
    pendingInputFrameLineCount = frame.lines.length;
    pendingInputFrameCursorLineIndex = frame.cursorLineIndex;
    const linesDown = Math.max(0, frame.lines.length - 1 - frame.cursorLineIndex);
    if (linesDown > 0) {
      process.stdout.write(`\x1b[${String(linesDown)}A`);
    }
    process.stdout.write("\r");
    if (frame.cursorColumn > 0) {
      process.stdout.write(`\x1b[${String(frame.cursorColumn)}C`);
    }
  }

  function renderPendingInputFrameAfterStdout(): void {
    if (pendingInputFrameEnabled) {
      ensureInteractiveStdoutLineBoundary();
    }
    renderPendingInputFrame();
  }

  function renderPendingInputFrameAfterStderr(message: string): void {
    if (
      pendingInputFrameEnabled
      && message.length > 0
      && !message.endsWith("\n")
    ) {
      process.stderr.write("\n");
    }
    renderPendingInputFrame();
  }

  function rerenderPendingInputFrame(): void {
    if (!pendingInputFrameEnabled) {
      return;
    }
    clearPendingInputFrame();
    renderPendingInputFrame();
  }

  const handleInteractiveInputWithPendingFrame = async (
    userInputRaw: string,
    controls: SessionInteractiveControls,
  ): Promise<"continue" | "break"> => {
    pendingInputFrameEnabled = true;
    try {
      return await handleInteractiveInput(userInputRaw, controls);
    } finally {
      clearPendingInputFrame();
      pendingInputFrameEnabled = false;
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
