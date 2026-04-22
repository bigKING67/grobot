import { parsePlanCommand } from "../../start/plan-command";
import {
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
  type SessionInteractiveRewindCheckpointSummary,
  type SessionInteractiveRewindMode,
  type SessionInteractiveSessionSummary,
} from "../../start/session-interactive";
import { type SlashCommandExecutionInput, type SlashCommandSpec } from "./types";

interface ParsedModelCommand {
  kind: "menu" | "legacy_subcommand" | "invalid";
  reason?: string;
}

interface ParsedStatusCommand {
  kind: "current" | "theme" | "segment" | "layout" | "invalid";
  theme?: string;
  segmentId?: string;
  segmentEnabled?: boolean;
  layoutMode?: string;
  reason?: string;
}

interface ParsedSessionMenuCommand {
  kind: "menu" | "legacy_with_id" | "invalid";
  sessionId?: string;
  reason?: string;
}

interface ParsedResumeCommand {
  kind: "menu" | "query" | "legacy_with_id" | "invalid";
  sessionId?: string;
  query?: string;
  reason?: string;
}

interface ParsedRewindCommand {
  kind: "menu" | "query" | "summarize" | "invalid";
  query?: string;
  mode?: Exclude<SessionInteractiveRewindMode, "summarize">;
  reason?: string;
}

interface ParsedSkillCreatorCommand {
  kind: "run" | "prompt" | "invalid";
  requirement?: string;
  reason?: string;
}

interface ParsedHistoryCommand {
  kind: "show" | "invalid";
  query?: string;
  reason?: string;
}

interface ParsedAskCommand {
  kind: "show" | "invalid";
  reason?: string;
}

export interface SlashCommandSuggestion {
  command: string;
  description: string;
}

function matchesInteractiveCommand(input: string, command: string): boolean {
  return input === command || input.startsWith(`${command} `);
}

function matchesUserCommandsManagementCommand(inputRaw: string): boolean {
  const input = inputRaw.trim();
  return /^\/commands(?:\s|$)/i.test(input);
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY);
}

function parseModelCommand(inputRaw: string): ParsedModelCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/model")) {
    return { kind: "invalid", reason: "command must start with /model" };
  }
  const rest = input.slice("/model".length).trim();
  if (!rest) {
    return { kind: "menu" };
  }
  const legacyMatch = rest.match(/^(current|list|use|reset)(?:\s|$)/i);
  if (legacyMatch) {
    return {
      kind: "legacy_subcommand",
      reason: "[model] legacy subcommands removed. Use /model to open picker (Enter/Space to apply).",
    };
  }
  return {
    kind: "invalid",
    reason: "usage: /model",
  };
}

function parseStatusCommand(inputRaw: string): ParsedStatusCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/status")) {
    return { kind: "invalid", reason: "command must start with /status" };
  }
  const rest = input.slice("/status".length).trim();
  if (!rest || rest.toLowerCase() === "current") {
    return { kind: "current" };
  }
  if (rest === "full" || rest === "compact" || rest === "adaptive") {
    return {
      kind: "layout",
      layoutMode: rest,
    };
  }
  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest).trim().toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();
  if (head === "layout") {
    if (!tail) {
      return { kind: "invalid", reason: "usage: /status layout <adaptive|full|compact>" };
    }
    return { kind: "layout", layoutMode: tail };
  }
  if (head === "theme") {
    if (!tail) {
      return { kind: "invalid", reason: "usage: /status theme <plain|nerd|ccline>" };
    }
    return { kind: "theme", theme: tail };
  }
  if (head === "segment") {
    const segmentTokens = tail.split(/\s+/).filter((token) => token.length > 0);
    if (segmentTokens.length !== 2) {
      return {
        kind: "invalid",
        reason: "usage: /status segment <model|project|context|tokens|session> <on|off>",
      };
    }
    const segmentId = segmentTokens[0];
    const state = segmentTokens[1].toLowerCase();
    if (state !== "on" && state !== "off") {
      return {
        kind: "invalid",
        reason: "usage: /status segment <model|project|context|tokens|session> <on|off>",
      };
    }
    return {
      kind: "segment",
      segmentId,
      segmentEnabled: state === "on",
    };
  }
  return {
    kind: "invalid",
    reason:
      "usage: /status | /status current | /status layout <adaptive|full|compact> | /status theme <plain|nerd|ccline> | /status segment <model|project|context|tokens|session> <on|off>",
  };
}

function parseSessionMenuCommand(
  inputRaw: string,
  command: "/switch" | "/continue",
): ParsedSessionMenuCommand {
  const input = inputRaw.trim();
  if (!input.startsWith(command)) {
    return { kind: "invalid", reason: `command must start with ${command}` };
  }
  const rest = input.slice(command.length).trim();
  if (!rest) {
    return { kind: "menu" };
  }
  if (isInteractiveTerminal()) {
    return {
      kind: "invalid",
      reason: `[session] ${command} <id> 已移除，请仅使用 ${command} 打开菜单后再选择目标会话。`,
    };
  }
  const sessionId = rest.split(/\s+/, 1)[0] ?? "";
  return {
    kind: "legacy_with_id",
    sessionId: sessionId.trim(),
    reason: `[session] ${command} <id> 已废弃；非交互场景保留兼容，建议改用 ${command} 菜单。`,
  };
}

function parseResumeCommand(inputRaw: string): ParsedResumeCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/resume")) {
    return { kind: "invalid", reason: "command must start with /resume" };
  }
  const rest = input.slice("/resume".length).trim();
  if (!rest) {
    return { kind: "menu" };
  }
  if (isInteractiveTerminal()) {
    if (/^menu$/i.test(rest)) {
      return { kind: "menu" };
    }
    const queryMatch = rest.match(/^(?:find|search)\s*([\s\S]*)$/i);
    if (queryMatch) {
      const query = (queryMatch[1] ?? "").trim();
      if (!query) {
        return {
          kind: "invalid",
          reason: "usage: /resume find <id|title|summary>",
        };
      }
      return {
        kind: "query",
        query,
      };
    }
    return {
      kind: "query",
      query: rest,
    };
  }
  const sessionId = rest.split(/\s+/, 1)[0] ?? "";
  return {
    kind: "legacy_with_id",
    sessionId: sessionId.trim(),
    reason: "[session] /resume <id> 已废弃；非交互场景保留兼容，建议改用 /resume 菜单。",
  };
}

function parseUpdatedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeResumeQueryText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeResumeDigitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function sortResumeQueryMatches(
  matches: SessionInteractiveSessionSummary[],
): SessionInteractiveSessionSummary[] {
  matches.sort((left: SessionInteractiveSessionSummary, right: SessionInteractiveSessionSummary) => {
    if (left.active !== right.active) {
      return left.active ? 1 : -1;
    }
    const updatedDiff = parseUpdatedAtMs(right.updatedAt) - parseUpdatedAtMs(left.updatedAt);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return left.id.localeCompare(right.id);
  });
  return matches;
}

function resolveResumeQueryMatches(
  queryRaw: string,
  sessions: readonly SessionInteractiveSessionSummary[],
): SessionInteractiveSessionSummary[] {
  const query = normalizeResumeQueryText(queryRaw);
  if (!query) {
    return [];
  }
  const queryDigits = normalizeResumeDigitsOnly(query);
  const byId = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.id) === query);
  if (byId.length > 0) {
    return sortResumeQueryMatches(byId);
  }
  const byExactTitle = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.title) === query);
  if (byExactTitle.length > 0) {
    return sortResumeQueryMatches(byExactTitle);
  }
  const byExactSummary = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.summary) === query);
  if (byExactSummary.length > 0) {
    return sortResumeQueryMatches(byExactSummary);
  }
  const byExactUpdatedAt = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.updatedAt) === query);
  if (byExactUpdatedAt.length > 0) {
    return sortResumeQueryMatches(byExactUpdatedAt);
  }
  const byIdPrefix = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.id).startsWith(query));
  if (byIdPrefix.length > 0) {
    return sortResumeQueryMatches(byIdPrefix);
  }
  const byTitlePrefix = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.title).startsWith(query));
  if (byTitlePrefix.length > 0) {
    return sortResumeQueryMatches(byTitlePrefix);
  }
  const bySummaryPrefix = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.summary).startsWith(query));
  if (bySummaryPrefix.length > 0) {
    return sortResumeQueryMatches(bySummaryPrefix);
  }
  const byUpdatedAtPrefix = sessions.filter((session: SessionInteractiveSessionSummary) =>
    normalizeResumeQueryText(session.updatedAt).startsWith(query));
  if (byUpdatedAtPrefix.length > 0) {
    return sortResumeQueryMatches(byUpdatedAtPrefix);
  }
  if (queryDigits.length > 0) {
    const byUpdatedAtDigitsPrefix = sessions.filter((session: SessionInteractiveSessionSummary) =>
      normalizeResumeDigitsOnly(session.updatedAt).startsWith(queryDigits));
    if (byUpdatedAtDigitsPrefix.length > 0) {
      return sortResumeQueryMatches(byUpdatedAtDigitsPrefix);
    }
  }
  const containsMatches = sessions.filter((session: SessionInteractiveSessionSummary) => {
    const id = normalizeResumeQueryText(session.id);
    const title = normalizeResumeQueryText(session.title);
    const summary = normalizeResumeQueryText(session.summary);
    const updatedAt = normalizeResumeQueryText(session.updatedAt);
    const updatedAtDigits = normalizeResumeDigitsOnly(session.updatedAt);
    return id.includes(query)
      || title.includes(query)
      || summary.includes(query)
      || updatedAt.includes(query)
      || (queryDigits.length > 0 && updatedAtDigits.includes(queryDigits));
  });
  return sortResumeQueryMatches(containsMatches);
}

function normalizeRewindQueryText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDigitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function normalizeCompactText(value: string): string {
  return normalizeRewindQueryText(value).replace(/\s+/g, "");
}

function sortRewindQueryMatches(
  matches: SessionInteractiveRewindCheckpointSummary[],
): SessionInteractiveRewindCheckpointSummary[] {
  matches.sort(
    (
      left: SessionInteractiveRewindCheckpointSummary,
      right: SessionInteractiveRewindCheckpointSummary,
    ) => {
      const createdDiff = parseUpdatedAtMs(right.createdAt) - parseUpdatedAtMs(left.createdAt);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      return right.checkpointId.localeCompare(left.checkpointId);
    },
  );
  return matches;
}

function resolveRewindQueryMatches(
  queryRaw: string,
  checkpoints: readonly SessionInteractiveRewindCheckpointSummary[],
): SessionInteractiveRewindCheckpointSummary[] {
  const query = normalizeRewindQueryText(queryRaw);
  if (!query) {
    return [];
  }
  const compactQuery = normalizeCompactText(query);
  const byExactCheckpointId = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.checkpointId) === query);
  if (byExactCheckpointId.length > 0) {
    return sortRewindQueryMatches(byExactCheckpointId);
  }
  const byExactCreatedAt = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.createdAt) === query);
  if (byExactCreatedAt.length > 0) {
    return sortRewindQueryMatches(byExactCreatedAt);
  }
  const byExactUserText = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.userText) === query);
  if (byExactUserText.length > 0) {
    return sortRewindQueryMatches(byExactUserText);
  }
  const byExactAssistantText = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.assistantText) === query);
  if (byExactAssistantText.length > 0) {
    return sortRewindQueryMatches(byExactAssistantText);
  }
  const byCheckpointIdPrefix = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.checkpointId).startsWith(query));
  if (byCheckpointIdPrefix.length > 0) {
    return sortRewindQueryMatches(byCheckpointIdPrefix);
  }
  const byCreatedAtPrefix = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.createdAt).startsWith(query));
  if (byCreatedAtPrefix.length > 0) {
    return sortRewindQueryMatches(byCreatedAtPrefix);
  }
  const queryDigits = normalizeDigitsOnly(query);
  if (queryDigits.length > 0) {
    const byCreatedAtDigitsPrefix = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
      normalizeDigitsOnly(checkpoint.createdAt).startsWith(queryDigits));
    if (byCreatedAtDigitsPrefix.length > 0) {
      return sortRewindQueryMatches(byCreatedAtDigitsPrefix);
    }
  }
  const byUserTextPrefix = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.userText).startsWith(query));
  if (byUserTextPrefix.length > 0) {
    return sortRewindQueryMatches(byUserTextPrefix);
  }
  const byAssistantTextPrefix = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
    normalizeRewindQueryText(checkpoint.assistantText).startsWith(query));
  if (byAssistantTextPrefix.length > 0) {
    return sortRewindQueryMatches(byAssistantTextPrefix);
  }
  if (compactQuery !== query) {
    const byUserTextCompactPrefix = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
      normalizeCompactText(checkpoint.userText).startsWith(compactQuery));
    if (byUserTextCompactPrefix.length > 0) {
      return sortRewindQueryMatches(byUserTextCompactPrefix);
    }
    const byAssistantTextCompactPrefix = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
      normalizeCompactText(checkpoint.assistantText).startsWith(compactQuery));
    if (byAssistantTextCompactPrefix.length > 0) {
      return sortRewindQueryMatches(byAssistantTextCompactPrefix);
    }
  }
  const containsMatches = checkpoints.filter((checkpoint: SessionInteractiveRewindCheckpointSummary) => {
    const checkpointId = normalizeRewindQueryText(checkpoint.checkpointId);
    const createdAt = normalizeRewindQueryText(checkpoint.createdAt);
    const userText = normalizeRewindQueryText(checkpoint.userText);
    const assistantText = normalizeRewindQueryText(checkpoint.assistantText);
    const checkpointIdCompact = normalizeCompactText(checkpoint.checkpointId);
    const createdAtCompact = normalizeCompactText(checkpoint.createdAt);
    const userTextCompact = normalizeCompactText(checkpoint.userText);
    const assistantTextCompact = normalizeCompactText(checkpoint.assistantText);
    return checkpointId.includes(query)
      || createdAt.includes(query)
      || userText.includes(query)
      || assistantText.includes(query)
      || checkpointIdCompact.includes(compactQuery)
      || createdAtCompact.includes(compactQuery)
      || userTextCompact.includes(compactQuery)
      || assistantTextCompact.includes(compactQuery);
  });
  return sortRewindQueryMatches(containsMatches);
}

function parseRewindCommand(
  inputRaw: string,
  command: "/rewind" | "/checkpoint" = "/rewind",
): ParsedRewindCommand {
  const input = inputRaw.trim();
  if (!input.startsWith(command)) {
    return { kind: "invalid", reason: `command must start with ${command}` };
  }
  const rest = input.slice(command.length).trim();
  if (!rest) {
    return { kind: "menu" };
  }
  if (/^menu$/i.test(rest)) {
    return { kind: "menu" };
  }
  const summarizeMatch = rest.match(/^(summary|summarize)(?:\s+([\s\S]+))?$/i);
  if (summarizeMatch) {
    const trailing = (summarizeMatch[2] ?? "").trim();
    if (trailing.length > 0) {
      return {
        kind: "invalid",
        reason: `usage: ${command} summarize`,
      };
    }
    return { kind: "summarize" };
  }
  if (!isInteractiveTerminal()) {
    return {
      kind: "invalid",
      reason: `usage: ${command} | ${command} summarize`,
    };
  }
  const queryMatch = rest.match(/^(?:find|search)\s*([\s\S]*)$/i);
  const hasExplicitQueryPrefix = Boolean(queryMatch);
  const querySource = queryMatch ? (queryMatch[1] ?? "").trim() : rest;
  if (!querySource) {
    return {
      kind: "invalid",
      reason: `usage: ${command} [find|search] <checkpoint-id|text> [both|conversation|code]`,
    };
  }
  const queryTokens = querySource.split(/\s+/).filter((token) => token.length > 0);
  let mode: Exclude<SessionInteractiveRewindMode, "summarize"> = "both";
  let query = querySource;
  if (queryTokens.length > 1) {
    const maybeMode = (queryTokens[queryTokens.length - 1] ?? "").toLowerCase();
    if (maybeMode === "both" || maybeMode === "conversation" || maybeMode === "code") {
      mode = maybeMode;
      query = queryTokens.slice(0, -1).join(" ").trim();
    }
  } else {
    const onlyToken = (queryTokens[0] ?? "").toLowerCase();
    if (
      !hasExplicitQueryPrefix
      && (onlyToken === "both" || onlyToken === "conversation" || onlyToken === "code")
    ) {
      return {
        kind: "invalid",
        reason: `usage: ${command} [find|search] <checkpoint-id|text> [both|conversation|code]`,
      };
    }
  }
  if (!query) {
    return {
      kind: "invalid",
      reason: `usage: ${command} [find|search] <checkpoint-id|text> [both|conversation|code]`,
    };
  }
  return {
    kind: "query",
    query,
    mode,
  };
}

function parseSkillCreatorCommand(inputRaw: string): ParsedSkillCreatorCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/skill-creator")) {
    return { kind: "invalid", reason: "command must start with /skill-creator" };
  }
  const rest = input.slice("/skill-creator".length).trim();
  if (!rest) {
    return { kind: "prompt" };
  }
  return {
    kind: "run",
    requirement: rest,
  };
}

function parseHistoryCommand(inputRaw: string): ParsedHistoryCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/history")) {
    return { kind: "invalid", reason: "command must start with /history" };
  }
  const rest = input.slice("/history".length).trim();
  if (!rest) {
    return { kind: "show" };
  }
  return {
    kind: "show",
    query: rest,
  };
}

function parseAskCommand(inputRaw: string): ParsedAskCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/ask")) {
    return { kind: "invalid", reason: "command must start with /ask" };
  }
  const restRaw = input.slice("/ask".length).trim();
  const usage = "usage: /ask";
  if (!restRaw) {
    return { kind: "show" };
  }
  return {
    kind: "invalid",
    reason: usage,
  };
}

async function executeRewindSlashCommand(
  input: SlashCommandExecutionInput,
  command: "/rewind" | "/checkpoint",
): Promise<SessionInteractiveAction> {
  const parsed = parseRewindCommand(input.userInput, command);
  if (parsed.kind === "invalid") {
    input.handlers.writeStdout(`${parsed.reason ?? `invalid ${command} command`}\n\n`);
    return "continue";
  }
  if (parsed.kind === "menu") {
    await input.handlers.openSessionMenu("rewind", input.controls.withInputPaused);
    return "continue";
  }
  const activeSessionId = input.handlers.getActiveSessionId?.().trim() ?? "";
  if (!activeSessionId) {
    input.handlers.writeStdout(
      `[rewind] Active session id is unavailable. Use ${command} to open menu.\n\n`,
    );
    return "continue";
  }
  if (!input.handlers.rewindSession) {
    input.handlers.writeStdout(
      `[rewind] quick command path unavailable. Use ${command} to open menu.\n\n`,
    );
    return "continue";
  }
  if (parsed.kind === "summarize") {
    await input.handlers.rewindSession({
      sessionId: activeSessionId,
      mode: "summarize",
      reason: `slash:${command.slice(1)}:summarize`,
    });
    return "continue";
  }
  const query = parsed.query?.trim() ?? "";
  const checkpoints = input.handlers.listRewindCheckpoints?.(activeSessionId, 64) ?? [];
  const matches = resolveRewindQueryMatches(query, checkpoints);
  if (matches.length <= 0) {
    input.handlers.writeStdout(
      `[rewind] No checkpoints matching "${query}" in session "${activeSessionId}". Use ${command} to open menu.\n\n`,
    );
    return "continue";
  }
  if (matches.length > 1) {
    const rows = matches
      .slice(0, 5)
      .map((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
        `- ${checkpoint.checkpointId} | ${checkpoint.createdAt} | files=${String(
          checkpoint.changedFilesCount,
        )} | user=${checkpoint.userText}`);
    const quickPickSuffix = parsed.mode && parsed.mode !== "both"
      ? ` ${parsed.mode}`
      : "";
    const quickPickHints = matches
      .slice(0, 3)
      .map((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
        `- ${command} ${checkpoint.checkpointId}${quickPickSuffix}`);
    const overflow = matches.length > 5
      ? `\n- ... and ${String(matches.length - 5)} more`
      : "";
    const quickPickBlock = quickPickHints.length > 0
      ? `\n[rewind] Quick pick:\n${quickPickHints.join("\n")}`
      : "";
    input.handlers.writeStdout(
      `[rewind] Found ${String(matches.length)} checkpoints matching "${query}" in session "${activeSessionId}".\n${rows.join(
        "\n",
      )}${overflow}${quickPickBlock}\n[rewind] Use ${command} to pick one explicitly.\n\n`,
    );
    return "continue";
  }
  const target = matches[0];
  await input.handlers.rewindSession({
    sessionId: activeSessionId,
    checkpointId: target.checkpointId,
    mode: parsed.mode ?? "both",
    reason: `slash:${command.slice(1)}:query`,
  });
  return "continue";
}

const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  {
    id: "exit",
    matches: (userInput) =>
      userInput === "/exit"
      || userInput === "/quit"
      || userInput === "exit"
      || userInput === "quit",
    execute: async () => "break",
    helpLines: [
      "  /exit | /quit        Exit interactive mode",
    ],
  },
  {
    id: "help",
    matches: (userInput) => userInput === "/help",
    execute: async ({ handlers }) => {
      handlers.showHelp();
      return "continue";
    },
    helpLines: [
      "  /help                Show interactive help",
    ],
  },
  {
    id: "sessions",
    matches: (userInput) => userInput === "/sessions",
    execute: async ({ controls, handlers }) => {
      await handlers.openSessionMenu("sessions", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /sessions            Open session actions menu (create/switch/resume/rewind/continue)",
    ],
  },
  {
    id: "commands",
    matches: (userInput) => matchesUserCommandsManagementCommand(userInput),
    execute: async ({ userInput, controls, handlers }) => {
      const normalizedInput = userInput.trim();
      if (normalizedInput === "/commands") {
        await handlers.openCommandsMenu(controls.withInputPaused);
        return "continue";
      }
      if (isInteractiveTerminal()) {
        handlers.writeStdout("[commands] 交互模式仅保留主入口 /commands；已为你打开菜单。\n\n");
        await handlers.openCommandsMenu(controls.withInputPaused);
        return "continue";
      }
      handlers.writeStdout("[commands] 非交互模式沿用兼容子命令；建议迁移到 /commands 菜单。\n\n");
      await handlers.handleUserCommandsCommand(userInput);
      return "continue";
    },
    helpLines: [
      "  /commands            Open user-command manager (only ~/.grobot/commands)",
    ],
  },
  {
    id: "skill-creator",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/skill-creator"),
    execute: async ({ userInput, controls, handlers }) => {
      const parsed = parseSkillCreatorCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid skill-creator command"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "run") {
        await handlers.runSkillCreator(parsed.requirement ?? "");
        return "continue";
      }
      if (!isInteractiveTerminal()) {
        handlers.writeStdout("usage: /skill-creator [需求]\n\n");
        return "continue";
      }
      const requirement = await handlers.promptSkillCreatorRequirement(
        controls.withInputPaused,
      );
      if (!requirement) {
        return "continue";
      }
      await handlers.runSkillCreator(requirement);
      return "continue";
    },
    helpLines: [
      "  /skill-creator       Create a skill from requirement (no-menu: ask in TTY when empty)",
    ],
  },
  {
    id: "health",
    matches: (userInput) => userInput === "/health",
    execute: async ({ handlers }) => {
      handlers.showHealthStatus();
      return "continue";
    },
    helpLines: [
      "  /health              Show provider failover and circuit status",
    ],
  },
  {
    id: "skills",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/skills"),
    execute: async ({ handlers }) => {
      handlers.writeStdout(
        [
          "[skills]",
          "- project: ./.grobot/skills",
          "- global: ~/.grobot/skills",
          "- tip: run /skill-creator your-requirement to create new skills",
          "- tip: use /commands to manage reusable local command templates",
          "",
        ].join("\n"),
      );
      return "continue";
    },
    helpLines: [
      "  /skills              Show skill directories and quick usage hint",
    ],
  },
  {
    id: "mcp",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/mcp"),
    execute: async ({ handlers }) => {
      handlers.writeStdout(
        [
          "[mcp]",
          "- runtime route is auto-injected by governance policy",
          "- if you need explicit MCP request, ask with `mcp_call(server=..., tool=...)` in prompt",
          "- check route status with /health and start diagnostics",
          "",
        ].join("\n"),
      );
      return "continue";
    },
    helpLines: [
      "  /mcp                 Show MCP usage hints in current CLI session",
    ],
  },
  {
    id: "model",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/model"),
    execute: async ({ userInput, controls, handlers }) => {
      const parsed = parseModelCommand(userInput);
      if (parsed.kind === "menu") {
        await handlers.openModelMenu(controls.withInputPaused);
        return "continue";
      }
      if (parsed.kind === "legacy_subcommand" || parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid model command"}\n\n`);
        return "continue";
      }
      return "continue";
    },
    helpLines: [
      "  /model               Open interactive model picker (syncs config provider.model)",
    ],
  },
  {
    id: "status",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/status"),
    execute: async ({ userInput, controls, handlers }) => {
      if (isInteractiveTerminal()) {
        if (userInput.trim() !== "/status") {
          handlers.writeStdout("[status] 交互模式已收敛为主入口 /status；已为你打开状态栏菜单。\n\n");
        }
        await handlers.openStatusMenu(controls.withInputPaused);
        return "continue";
      }
      const parsed = parseStatusCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid status command"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "current") {
        handlers.showStatusCurrent();
        return "continue";
      }
      if (parsed.kind === "theme") {
        handlers.setStatusTheme(parsed.theme ?? "");
        return "continue";
      }
      if (parsed.kind === "layout") {
        handlers.setStatusLayoutMode(parsed.layoutMode ?? "");
        return "continue";
      }
      handlers.setStatusSegmentEnabled(parsed.segmentId ?? "", parsed.segmentEnabled ?? true);
      return "continue";
    },
    helpLines: [
      "  /status              Show and tune status line (theme/layout/segment)",
    ],
  },
  {
    id: "history",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/history"),
    execute: async ({ userInput, handlers }) => {
      const parsed = parseHistoryCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid history command"}\n\n`);
        return "continue";
      }
      await handlers.showHistory(parsed.query);
      return "continue";
    },
    helpLines: [
      "  /history [keyword]   Show recent conversation history (optional keyword filter)",
    ],
  },
  {
    id: "ask",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/ask"),
    execute: async ({ userInput, handlers }) => {
      const parsed = parseAskCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid ask command"}\n\n`);
        return "continue";
      }
      handlers.showPendingAskQueue();
      return "continue";
    },
    helpLines: [
      "  /ask                 Show ask-user status (reply directly to continue)",
    ],
  },
  {
    id: "plan",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/plan"),
    execute: async ({ userInput, controls, handlers }) => {
      const normalizedInput = userInput.trim();
      if (normalizedInput === "/plan") {
        if (isInteractiveTerminal()) {
          await handlers.openPlanMenu(controls.withInputPaused);
          return "continue";
        }
        await handlers.enterPlan("");
        return "continue";
      }
      const parsed = parsePlanCommand(userInput);
      // Keep direct-goal path ergonomic: `/plan <goal>` should not force users
      // to re-enter the same goal in the menu prompt.
      if (parsed.kind === "enter") {
        await handlers.enterPlan(parsed.goal);
        return "continue";
      }
      if (parsed.kind === "menu") {
        if (isInteractiveTerminal()) {
          await handlers.openPlanMenu(controls.withInputPaused);
          return "continue";
        }
        handlers.writeStdout("[plan] /plan menu|open is interactive-only; showing current status in script mode.\n\n");
        await handlers.showPlanStatus();
        return "continue";
      }
      if (parsed.kind === "enter_mode") {
        if (isInteractiveTerminal()) {
          await handlers.openPlanMenu(controls.withInputPaused);
          return "continue";
        }
        await handlers.enterPlan("");
        return "continue";
      }
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
        return "continue";
      }
      if (isInteractiveTerminal()) {
        handlers.writeStdout("[plan] 交互模式已收敛为主入口 /plan；已为你打开 Plan Actions 菜单。\n\n");
        await handlers.openPlanMenu(controls.withInputPaused);
        return "continue";
      }
      if (parsed.kind === "status") {
        await handlers.showPlanStatus();
        return "continue";
      }
      if (parsed.kind === "approve") {
        await handlers.approvePlan(parsed.note);
        return "continue";
      }
      if (parsed.kind === "reject") {
        await handlers.rejectPlan(parsed.reason);
        return "continue";
      }
      if (parsed.kind === "apply") {
        await handlers.applyPlan(parsed.extra);
        return "continue";
      }
      if (parsed.kind === "verify") {
        await handlers.verifyPlan(parsed.result);
        return "continue";
      }
      if (parsed.kind === "cancel") {
        await handlers.cancelPlan();
        return "continue";
      }
      return "continue";
    },
    helpLines: [
      "  /plan | /plan open   Open plan actions menu (interactive)",
      "  /plan <goal>         Enter plan mode and execute first requirement",
      "  /plan status|approve|reject|apply|verify|cancel (legacy script shortcuts)",
    ],
  },
  {
    id: "interrupt",
    matches: (userInput) => userInput === "/interrupt",
    execute: async ({ handlers }) => {
      if (handlers.isPlanMode()) {
        await handlers.requestPlanInterrupt("command");
        return "continue";
      }
      await handlers.requestRuntimeInterrupt("command");
      return "continue";
    },
    helpLines: [
      "  /interrupt           Interrupt current running turn (Esc: running=interrupt, plan idle=exit plan mode)",
    ],
  },
  {
    id: "new",
    matches: (userInput) => userInput === "/new",
    execute: async ({ controls, handlers }) => {
      if (isInteractiveTerminal()) {
        handlers.writeStdout("[session] 交互模式已收敛为主入口 /sessions；已为你打开会话菜单。\n\n");
        await handlers.openSessionMenu("sessions", controls.withInputPaused);
        return "continue";
      }
      await handlers.createAndSwitchSession();
      return "continue";
    },
    helpLines: [
      "  /new                 Create and switch to a new session",
    ],
  },
  {
    id: "switch",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/switch"),
    execute: async ({ userInput, controls, handlers }) => {
      if (isInteractiveTerminal()) {
        handlers.writeStdout("[session] 交互模式已收敛为主入口 /sessions；已为你打开会话菜单。\n\n");
        await handlers.openSessionMenu("sessions", controls.withInputPaused);
        return "continue";
      }
      const parsed = parseSessionMenuCommand(userInput, "/switch");
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid switch command"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "legacy_with_id") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
      }
      await handlers.openSessionMenu("switch", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /switch              Open switch-session picker",
    ],
  },
  {
    id: "resume",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/resume"),
    execute: async ({ userInput, controls, handlers }) => {
      const parsed = parseResumeCommand(userInput);
      if (parsed.kind === "invalid") {
        if (isInteractiveTerminal()) {
          handlers.writeStdout(`${parsed.reason ?? "invalid resume command"}\n\n`);
          await handlers.openSessionMenu("resume", controls.withInputPaused);
          return "continue";
        }
        handlers.writeStdout(`${parsed.reason ?? "invalid resume command"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "query") {
        const query = parsed.query?.trim() ?? "";
        const matches = resolveResumeQueryMatches(
          query,
          handlers.listSessionSummaries?.() ?? [],
        );
        if (matches.length <= 0) {
          handlers.writeStdout(
            `[session] No sessions matching "${query}". Use /resume to open menu.\n\n`,
          );
          return "continue";
        }
        if (matches.length > 1) {
          const rows = matches
            .slice(0, 5)
            .map((session) =>
              `- ${session.id}${session.active ? " (active)" : ""} | ${session.title}`);
          const quickPickHints = matches
            .slice(0, 3)
            .map((session) => `- /resume ${session.id}`);
          const overflow = matches.length > 5
            ? `\n- ... and ${String(matches.length - 5)} more`
            : "";
          const quickPickBlock = quickPickHints.length > 0
            ? `\n[session] Quick pick:\n${quickPickHints.join("\n")}`
            : "";
          handlers.writeStdout(
            `[session] Found ${String(matches.length)} sessions matching "${query}".\n${rows.join("\n")}${overflow}${quickPickBlock}\n[session] Use /resume to pick one explicitly.\n\n`,
          );
          return "continue";
        }
        const target = matches[0];
        if (target.active) {
          handlers.writeStdout(`Session "${target.id}" is already active.\n\n`);
          return "continue";
        }
        await handlers.switchSession(target.id);
        return "continue";
      }
      if (parsed.kind === "legacy_with_id") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
        if (parsed.sessionId && parsed.sessionId.length > 0) {
          await handlers.switchSession(parsed.sessionId);
          return "continue";
        }
      }
      await handlers.openSessionMenu("resume", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /resume [query]      Open full-restore picker (quick query: /resume <query> or /resume find <id|title|summary>)",
    ],
  },
  {
    id: "rewind",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/rewind"),
    execute: async (input) => executeRewindSlashCommand(input, "/rewind"),
    helpLines: [
      "  /rewind [query]      Rewind active session by checkpoint query, or open menu",
    ],
  },
  {
    id: "checkpoint",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/checkpoint"),
    execute: async (input) => executeRewindSlashCommand(input, "/checkpoint"),
    helpLines: [
      "  /checkpoint [query]  Alias of /rewind (supports query and menu)",
    ],
  },
  {
    id: "continue",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/continue"),
    execute: async ({ userInput, controls, handlers }) => {
      if (isInteractiveTerminal()) {
        handlers.writeStdout("[session] 交互模式已收敛为主入口 /sessions；已为你打开会话菜单。\n\n");
        await handlers.openSessionMenu("sessions", controls.withInputPaused);
        return "continue";
      }
      const parsed = parseSessionMenuCommand(userInput, "/continue");
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid continue command"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "legacy_with_id") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
      }
      await handlers.openSessionMenu("continue", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /continue            Open summary-bridge picker",
    ],
  },
  {
    id: "handoff",
    matches: (userInput) => userInput === "/handoff",
    execute: async ({ handlers }) => {
      handlers.writeHandoff();
      handlers.writeStdout("\n");
      return "continue";
    },
    helpLines: [
      "  /handoff             Write HANDOFF.md",
    ],
  },
];

const HELP_ORDER: readonly string[] = [
  "sessions",
  "resume",
  "rewind",
  "checkpoint",
  "commands",
  "skill-creator",
  "history",
  "ask",
  "model",
  "plan",
  "status",
  "help",
  "exit",
  "health",
  "skills",
  "mcp",
  "interrupt",
  "handoff",
];

const PRIMARY_HELP_ORDER: readonly string[] = [
  "sessions",
  "resume",
  "rewind",
  "checkpoint",
  "commands",
  "skill-creator",
  "history",
  "ask",
  "model",
  "plan",
  "status",
  "help",
  "exit",
];

const UTILITY_HELP_ORDER: readonly string[] = [
  "health",
  "skills",
  "mcp",
  "interrupt",
  "handoff",
];

const SLASH_COMMAND_SUGGESTIONS: readonly SlashCommandSuggestion[] = [
  { command: "/sessions", description: "Open session menu (create/switch/resume/rewind/continue)" },
  { command: "/resume", description: "Resume and fully restore a previous session" },
  { command: "/rewind", description: "Open checkpoint rewind menu for active or selected session" },
  { command: "/checkpoint", description: "Alias of /rewind (open checkpoint rewind menu)" },
  { command: "/commands", description: "Manage user-defined slash commands" },
  { command: "/skill-creator", description: "Create a skill (append requirement text directly)" },
  { command: "/history [keyword]", description: "Show recent history with optional keyword filter" },
  { command: "/ask", description: "Show ask-user status (reply directly to continue)" },
  { command: "/health", description: "Show provider failover and circuit status" },
  { command: "/skills", description: "Show skill directories and quick usage hint" },
  { command: "/mcp", description: "Show MCP usage hints in current CLI session" },
  { command: "/model", description: "Open interactive model picker" },
  { command: "/status", description: "Show current status line config snapshot" },
  { command: "/plan", description: "Open plan actions menu (use /plan <goal> for direct entry)" },
  { command: "/interrupt", description: "Interrupt running turn (Esc: running interrupt, plan idle exits mode)" },
  { command: "/handoff", description: "Write HANDOFF.md" },
  { command: "/help", description: "Show interactive help screen" },
  { command: "/exit", description: "Exit interactive mode" },
];

const PRIMARY_HINT_COMMANDS: readonly string[] = [
  "/help",
  "/sessions",
  "/resume",
  "/rewind",
  "/commands",
  "/skill-creator",
  "/history",
  "/ask",
  "/model",
  "/plan",
  "/exit",
];

const PLAN_MODE_BLOCKED_COMMANDS: Readonly<Record<string, string>> = {
  sessions: "/sessions",
  commands: "/commands",
  "skill-creator": "/skill-creator",
  model: "/model",
  history: "/history",
  new: "/new",
  switch: "/switch",
  resume: "/resume",
  rewind: "/rewind",
  checkpoint: "/checkpoint",
  continue: "/continue",
};

function findSlashCommandById(id: string): SlashCommandSpec | undefined {
  return SLASH_COMMANDS.find((item) => item.id === id);
}

function resolveHelpLinesByOrder(order: readonly string[]): string[] {
  const rows: string[] = [];
  for (const id of order) {
    const command = findSlashCommandById(id);
    if (!command?.helpLines) {
      continue;
    }
    rows.push(...command.helpLines);
  }
  return rows;
}

export function listSlashCommandHelpLines(): string[] {
  return resolveHelpLinesByOrder(HELP_ORDER);
}

export function listPrimarySlashCommandHelpLines(): string[] {
  return resolveHelpLinesByOrder(PRIMARY_HELP_ORDER);
}

export function listUtilitySlashCommandHelpLines(): string[] {
  return resolveHelpLinesByOrder(UTILITY_HELP_ORDER);
}

export function listSlashCommandCompatibilityNotes(): string[] {
  return [
    "  - /switch /continue remain legacy session shortcuts.",
    "  - Prefer /resume for full restore and /rewind for checkpoint rollback.",
    "  - /checkpoint is an alias of /rewind.",
    "  - In interactive mode /new /switch /continue redirect to /sessions.",
    "  - /status subcommands are legacy shortcuts in interactive mode.",
    "  - In interactive mode they redirect to /status menu.",
    "  - In non-interactive scripts they remain compatible.",
    "  - /plan subcommands are legacy shortcuts in interactive mode.",
    "  - In interactive mode they redirect to /plan actions (/plan or /plan open).",
    "  - In non-interactive scripts they remain compatible.",
  ];
}

export function buildSlashCommandHint(): string {
  const wrapped = PRIMARY_HINT_COMMANDS.map((command) => `\`${command}\``);
  return `Enter message (${wrapped.join(", ")}; Ctrl+r: history search, Esc: running interrupt, plan idle exits mode):`;
}

export function listSlashCommandSuggestions(): readonly SlashCommandSuggestion[] {
  return SLASH_COMMAND_SUGGESTIONS;
}

export async function dispatchSlashCommand(
  userInput: string,
  controls: SessionInteractiveControls,
  handlers: SessionInteractiveHandlers,
): Promise<SessionInteractiveAction | undefined> {
  const payload: SlashCommandExecutionInput = {
    userInput,
    controls,
    handlers,
  };
  for (const command of SLASH_COMMANDS) {
    if (!command.matches(userInput)) {
      continue;
    }
    if (handlers.isPlanMode() && command.id in PLAN_MODE_BLOCKED_COMMANDS) {
      const commandName = PLAN_MODE_BLOCKED_COMMANDS[command.id] ?? `/${command.id}`;
      handlers.writeStdout(
        `[plan] ${commandName} is unavailable while PLAN_ONLY is active. Use /plan to open plan actions, /interrupt, or /exit.\n\n`,
      );
      return "continue";
    }
    return command.execute(payload);
  }
  return undefined;
}
