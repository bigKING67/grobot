import { dispatchSlashCommand } from "../commands/slash/registry";
import { buildInteractiveHelpScreen } from "../ui/screens/help-screen";

export type SessionInteractiveAction = "continue" | "break";
export type SessionMenuMode = "sessions" | "switch" | "continue" | "resume" | "rewind";

export interface SessionInteractiveSessionSummary {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  active: boolean;
}

export interface SessionInteractiveControls {
  withInputPaused<T>(operation: () => Promise<T>): Promise<T>;
}

export interface SessionInteractiveHandlers {
  writeStdout(message: string): void;
  hasPendingAsk(): boolean;
  getPendingAskQueueSize(): number;
  showPendingAskQueue(limit?: number): void;
  openPendingAskMenu(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<void>;
  cancelPendingAsk(): void;
  parkPendingAsk(): void;
  clearPendingAsk(): void;
  answerPendingAsk(answer: string): Promise<void>;
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
  openPlanMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
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
  "ask",
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

function consumePendingAskBlockedNotice(queueSize: number): string | undefined {
  const now = Date.now();
  const queueChanged = pendingAskBlockNoticeState.lastQueueSize !== queueSize;
  const shouldThrottle = !queueChanged
    && pendingAskBlockNoticeState.lastShownAtMs > 0
    && now - pendingAskBlockNoticeState.lastShownAtMs < PENDING_ASK_BLOCK_NOTICE_COOLDOWN_MS;
  pendingAskBlockNoticeState.lastQueueSize = queueSize;
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
  return `[ask-user] 当前有 ${String(queueSize)} 个待确认问题，请先直接回复，或使用 /ask menu、/ask answer <n|default|text>。/ask 查看队列，/ask cancel 跳过当前，/ask park(/ask next) 暂缓当前，/ask clear 清空队列。${compactSuffix}\n\n`;
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

export async function dispatchSessionInteractiveInput(
  userInputRaw: string,
  controls: SessionInteractiveControls,
  handlers: SessionInteractiveHandlers,
): Promise<SessionInteractiveAction> {
  const userInput = userInputRaw.trim();
  if (!userInput) {
    return "continue";
  }
  if (handlers.hasPendingAsk() && !isPendingAskAllowedInput(userInput)) {
    const queueSize = handlers.getPendingAskQueueSize();
    const blockedNotice = consumePendingAskBlockedNotice(queueSize);
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
    await handlers.runPlanTurn(userInput);
    return "continue";
  }

  try {
    await handlers.runTurn(userInput);
  } catch (error) {
    handlers.onTurnError(error);
  }
  return "continue";
}
