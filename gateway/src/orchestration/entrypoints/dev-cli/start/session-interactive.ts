import { dispatchSlashCommand } from "../commands/slash/registry";
import { buildInteractiveHelpScreen } from "../ui/screens/help-screen";
import { isNaturalPlanExecutionIntent } from "./plan-command";

export type SessionInteractiveAction = "continue" | "break";
export type SessionMenuMode = "sessions" | "switch" | "continue" | "resume" | "rewind";
export type SessionInteractiveRewindMode = "both" | "conversation" | "code" | "summarize";

export interface SessionInteractiveSessionSummary {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  active: boolean;
}

export interface SessionInteractiveRewindCheckpointSummary {
  checkpointId: string;
  createdAt: string;
  userText: string;
  assistantText: string;
  historyBeforeCount: number;
  historyAfterCount: number;
  changedFilesCount: number;
}

export interface SessionInteractiveControls {
  withInputPaused<T>(operation: () => Promise<T>): Promise<T>;
}

export interface SessionInteractiveHandlers {
  writeStdout(message: string): void;
  hasPendingAsk(): boolean;
  getPendingAskQueueSize(): number;
  getPendingAskPromptSummary?(): string | undefined;
  showPendingAskQueue(limit?: number): void;
  showHelp(): void;
  showHealthStatus(): void;
  openModelMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  showStatusCurrent(): void;
  setStatusTheme(theme: string): void;
  setStatusLayoutMode(layoutMode: string): void;
  setStatusSegmentEnabled(segmentId: string, enabled: boolean): void;
  openStatusMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  openSessionMenu(
    mode: SessionMenuMode,
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<void>;
  listSessionSummaries?(): SessionInteractiveSessionSummary[];
  getActiveSessionId?(): string;
  listRewindCheckpoints?(
    sessionId: string,
    limit?: number,
  ): SessionInteractiveRewindCheckpointSummary[];
  rewindSession?(input: {
    sessionId: string;
    checkpointId?: string;
    mode: SessionInteractiveRewindMode;
    fileFilter?: readonly string[];
    reason?: string;
    summaryLimit?: number;
  }): Promise<boolean>;
  createAndSwitchSession(): Promise<void>;
  switchSession(targetSessionId: string): Promise<void>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeHandoff(): void;
  isPlanMode(): boolean;
  showPlanStatus(): Promise<void>;
  enterPlan(goal: string): Promise<void>;
  applyPlan(extra: string): Promise<void>;
  cancelPlan(): Promise<void>;
  requestPlanInterrupt(source: "command"): Promise<void>;
  requestRuntimeInterrupt(source: "command"): Promise<void>;
  runPlanTurn(userInput: string): Promise<void>;
  handleUserCommandsCommand(userInput: string): Promise<void>;
  openCommandsMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  openPlanInEditor(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  showHistory(query?: string): Promise<void>;
  promptSkillCreatorRequirement(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<string | undefined>;
  runSkillCreator(requirement: string): Promise<void>;
  tryRunUserCommand(userInput: string): Promise<boolean>;
  runTurn(userInput: string): Promise<void>;
  onTurnError(error: unknown): void;
}

export function buildInteractiveHelpText(): string {
  return buildInteractiveHelpScreen();
}

const PENDING_ASK_ALLOWED_SLASH_COMMANDS = new Set([
  "help",
  "sessions",
  "resume",
  "rewind",
  "exit",
  "quit",
  "interrupt",
]);

const PENDING_ASK_BLOCK_NOTICE_COOLDOWN_MS = 2_200;
const pendingAskBlockNoticeState: {
  lastShownAtMs: number;
  lastQueueSize: number;
  suppressedCount: number;
} = {
  lastShownAtMs: 0,
  lastQueueSize: 0,
  suppressedCount: 0,
};

function consumePendingAskBlockedNotice(input: {
  queueSize: number;
  promptSummary?: string;
}): string | undefined {
  const now = Date.now();
  const queueChanged = pendingAskBlockNoticeState.lastQueueSize !== input.queueSize;
  const shouldThrottle = !queueChanged
    && pendingAskBlockNoticeState.lastShownAtMs > 0
    && now - pendingAskBlockNoticeState.lastShownAtMs < PENDING_ASK_BLOCK_NOTICE_COOLDOWN_MS;
  pendingAskBlockNoticeState.lastQueueSize = input.queueSize;
  if (shouldThrottle) {
    pendingAskBlockNoticeState.suppressedCount += 1;
    return undefined;
  }
  const suppressed = pendingAskBlockNoticeState.suppressedCount;
  pendingAskBlockNoticeState.lastShownAtMs = now;
  pendingAskBlockNoticeState.suppressedCount = 0;
  const compactSuffix = suppressed > 0
    ? ` 已折叠 ${String(suppressed)} 条重复提示。`
    : "";
  return `[ask-user] 当前有待确认问题，请先直接回复。${compactSuffix}\n\n`;
}

function parseSlashCommandName(userInput: string): string | undefined {
  if (!userInput.startsWith("/")) {
    return undefined;
  }
  const token = userInput.slice(1).trim().split(/\s+/)[0] ?? "";
  const normalized = token.toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function isPendingAskAllowedInput(userInput: string): boolean {
  const normalized = userInput.trim().toLowerCase();
  if (normalized === "exit" || normalized === "quit") {
    return true;
  }
  const slashCommand = parseSlashCommandName(normalized);
  if (!slashCommand) {
    return true;
  }
  return PENDING_ASK_ALLOWED_SLASH_COMMANDS.has(slashCommand);
}

function isRemovedAskCommand(userInput: string): boolean {
  return parseSlashCommandName(userInput) === "ask";
}

export async function dispatchSessionInteractiveInput(
  userInputRaw: string,
  controls: SessionInteractiveControls,
  handlers: SessionInteractiveHandlers,
): Promise<SessionInteractiveAction> {
  const userInput = userInputRaw.trim();
  if (!userInput) {
    return "continue";
  }
  if (isRemovedAskCommand(userInput)) {
    handlers.writeStdout(
      "[slash] unknown command: /ask. ask-user 机制已改为直接回复，不再提供状态命令。\n\n",
    );
    return "continue";
  }
  if (handlers.hasPendingAsk() && !isPendingAskAllowedInput(userInput)) {
    const queueSize = handlers.getPendingAskQueueSize();
    const blockedNotice = consumePendingAskBlockedNotice({
      queueSize,
      promptSummary: handlers.getPendingAskPromptSummary?.(),
    });
    if (blockedNotice) {
      handlers.writeStdout(blockedNotice);
    }
    return "continue";
  }

  const slashAction = await dispatchSlashCommand(userInput, controls, handlers);
  if (slashAction) {
    return slashAction;
  }
  if (await handlers.tryRunUserCommand(userInput)) {
    return "continue";
  }
  if (handlers.isPlanMode()) {
    if (isNaturalPlanExecutionIntent(userInput)) {
      await handlers.applyPlan(userInput);
    } else {
      await handlers.runPlanTurn(userInput);
    }
    return "continue";
  }

  try {
    await handlers.runTurn(userInput);
  } catch (error) {
    handlers.onTurnError(error);
  }
  return "continue";
}
