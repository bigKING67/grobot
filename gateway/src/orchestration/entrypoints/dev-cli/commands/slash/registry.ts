import { parsePlanCommand } from "../../start/plan-command";
import { resolveRewindQueryMatches } from "../../start/session-rewind-search";
import { resolveResumeQueryMatches } from "../../start/session-resume-search";
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

export interface SlashCommandSuggestion {
  command: string;
  description: string;
}

const MATCH_LIST_LIMIT = 5;
const QUICK_PICK_HINT_LIMIT = 3;

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
          reason: "usage: /resume find <id|title|summary|updated-at>",
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

function formatSingleLinePreview(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const head = Math.max(1, maxLength - 1);
  return `${normalized.slice(0, head).trimEnd()}…`;
}

function formatMatchOverflow(totalCount: number, listedCount: number): string {
  if (totalCount <= listedCount) {
    return "";
  }
  return `\n- ... and ${String(totalCount - listedCount)} more`;
}

function formatQuickPickBlock(
  tag: "[session]" | "[rewind]",
  quickPickHints: readonly string[],
): string {
  if (quickPickHints.length <= 0) {
    return "";
  }
  return `\n${tag} Quick pick:\n${quickPickHints.join("\n")}`;
}

function formatDisambiguationBlock(
  tag: "[session]" | "[rewind]",
  totalCount: number,
  listedCount: number,
  quickPickHints: readonly string[],
): string {
  return `${formatMatchOverflow(totalCount, listedCount)}${formatQuickPickBlock(tag, quickPickHints)}`;
}

async function writeMenuHintAndMaybeOpen(
  input: SlashCommandExecutionInput,
  menu: "resume" | "rewind",
  message: string,
): Promise<SessionInteractiveAction> {
  input.handlers.writeStdout(message);
  if (isInteractiveTerminal()) {
    await input.handlers.openSessionMenu(menu, input.controls.withInputPaused);
  }
  return "continue";
}

function buildResumeNoMatchMessage(query: string): string {
  return `[session] No sessions matching "${query}". Use /resume to open menu.\n[session] Tip: match id/title/summary/updated-at; compact query ignores spaces, "_" and "-".\n\n`;
}

function buildRewindNoMatchMessage(
  query: string,
  command: "/rewind" | "/checkpoint",
  activeSessionId: string,
): string {
  return `[rewind] No checkpoints matching "${query}" in session "${activeSessionId}". Use ${command} to open menu.\n[rewind] Tip: match checkpoint-id/created-at/user/assistant; compact query ignores spaces, "_" and "-".\n\n`;
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

async function executeRewindSlashCommand(
  input: SlashCommandExecutionInput,
  command: "/rewind" | "/checkpoint",
): Promise<SessionInteractiveAction> {
  const parsed = parseRewindCommand(input.userInput, command);
  if (parsed.kind === "invalid") {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      `${parsed.reason ?? `invalid ${command} command`}\n\n`,
    );
  }
  if (parsed.kind === "menu") {
    await input.handlers.openSessionMenu("rewind", input.controls.withInputPaused);
    return "continue";
  }
  const activeSessionId = input.handlers.getActiveSessionId?.().trim() ?? "";
  if (!activeSessionId) {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      `[rewind] Active session id is unavailable. Use ${command} to open menu.\n\n`,
    );
  }
  if (!input.handlers.rewindSession) {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      `[rewind] quick command path unavailable. Use ${command} to open menu.\n\n`,
    );
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
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      buildRewindNoMatchMessage(query, command, activeSessionId),
    );
  }
  if (matches.length > 1) {
    const rows = matches
      .slice(0, MATCH_LIST_LIMIT)
      .map((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
        `- ${checkpoint.checkpointId} | ${checkpoint.createdAt} | files=${String(
          checkpoint.changedFilesCount,
        )} | user=${formatSingleLinePreview(checkpoint.userText, 44)} | assistant=${formatSingleLinePreview(checkpoint.assistantText, 44)}`);
    const quickPickSuffix = parsed.mode && parsed.mode !== "both"
      ? ` ${parsed.mode}`
      : "";
    const quickPickHints = matches
      .slice(0, QUICK_PICK_HINT_LIMIT)
      .map((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
        `- ${command} ${checkpoint.checkpointId}${quickPickSuffix}`);
    const disambiguationBlock = formatDisambiguationBlock(
      "[rewind]",
      matches.length,
      rows.length,
      quickPickHints,
    );
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      `[rewind] Found ${String(matches.length)} checkpoints matching "${query}" in session "${activeSessionId}".\n${rows.join(
        "\n",
      )}${disambiguationBlock}\n[rewind] Use ${command} to pick one explicitly.\n\n`,
    );
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
    id: "init",
    matches: (userInput) => userInput === "/init",
    execute: async ({ handlers }) => {
      await handlers.runInitProjectInstructions();
      return "continue";
    },
    helpLines: [
      "  /init                Create AGENTS.md with project instructions",
    ],
  },
  {
    id: "context",
    matches: (userInput) => userInput === "/context",
    execute: async ({ handlers }) => {
      handlers.showContextStatus();
      return "continue";
    },
    helpLines: [
      "  /context             Show current-turn context assembly status",
    ],
  },
  {
    id: "memory",
    matches: (userInput) => userInput === "/memory",
    execute: async ({ handlers }) => {
      handlers.showMemoryStatus();
      return "continue";
    },
    helpLines: [
      "  /memory              Show durable memory layer status",
    ],
  },
  {
    id: "skills",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/skills"),
    execute: async ({ handlers }) => {
      handlers.showSkillsStatus();
      return "continue";
    },
    helpLines: [
      "  /skills              Show configured skill directories and counts",
    ],
  },
  {
    id: "mcp",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/mcp"),
    execute: async ({ handlers }) => {
      handlers.showMcpStatus();
      return "continue";
    },
    helpLines: [
      "  /mcp                 Show MCP instruction and server status",
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
    id: "plan",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/plan"),
    execute: async ({ userInput, controls, handlers }) => {
      const normalizedInput = userInput.trim();
      if (normalizedInput === "/plan") {
        if (handlers.isPlanMode()) {
          await handlers.showPlanStatus();
          return "continue";
        }
        await handlers.enterPlan("", controls.withInputPaused);
        return "continue";
      }
      if (/^\/plan\s+open$/i.test(normalizedInput)) {
        if (!handlers.isPlanMode()) {
          await handlers.enterPlan("", controls.withInputPaused);
          return "continue";
        }
        if (isInteractiveTerminal()) {
          await handlers.openPlanInEditor(controls.withInputPaused);
          return "continue";
        }
        await handlers.showPlanStatus();
        return "continue";
      }
      const parsed = parsePlanCommand(userInput);
      if (parsed.kind === "enter") {
        if (handlers.isPlanMode()) {
          await handlers.showPlanStatus();
          return "continue";
        }
        await handlers.enterPlan(parsed.goal, controls.withInputPaused);
        return "continue";
      }
      if (parsed.kind === "enter_mode") {
        if (handlers.isPlanMode()) {
          await handlers.showPlanStatus();
          return "continue";
        }
        await handlers.enterPlan("", controls.withInputPaused);
        return "continue";
      }
      if (parsed.kind === "open") {
        if (!handlers.isPlanMode()) {
          await handlers.enterPlan("", controls.withInputPaused);
          return "continue";
        }
        if (isInteractiveTerminal()) {
          await handlers.openPlanInEditor(controls.withInputPaused);
          return "continue";
        }
        await handlers.showPlanStatus();
        return "continue";
      }
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
        return "continue";
      }
      return "continue";
    },
    helpLines: [
      "  /plan                Enter plan mode; in plan mode show current plan status",
      "  /plan open           Open active plan file in editor (interactive)",
      "  /plan <goal>         Enter plan mode and run first planning turn",
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
    execute: async (input) => {
      const { userInput, controls, handlers } = input;
      const parsed = parseResumeCommand(userInput);
      if (parsed.kind === "invalid") {
        return writeMenuHintAndMaybeOpen(
          input,
          "resume",
          `${parsed.reason ?? "invalid resume command"}\n\n`,
        );
      }
      if (parsed.kind === "query") {
        const query = parsed.query?.trim() ?? "";
        const matches = resolveResumeQueryMatches(
          query,
          handlers.listSessionSummaries?.() ?? [],
        );
        if (matches.length <= 0) {
          return writeMenuHintAndMaybeOpen(
            input,
            "resume",
            buildResumeNoMatchMessage(query),
          );
        }
        if (matches.length > 1) {
          const rows = matches
            .slice(0, MATCH_LIST_LIMIT)
            .map((session) =>
              `- ${session.id}${session.active ? " (active)" : ""} | ${session.updatedAt} | title=${formatSingleLinePreview(session.title, 40)} | summary=${formatSingleLinePreview(session.summary, 40)}`);
          const quickPickHints = matches
            .slice(0, QUICK_PICK_HINT_LIMIT)
            .map((session) => `- /resume ${session.id}`);
          const disambiguationBlock = formatDisambiguationBlock(
            "[session]",
            matches.length,
            rows.length,
            quickPickHints,
          );
          return writeMenuHintAndMaybeOpen(
            input,
            "resume",
            `[session] Found ${String(matches.length)} sessions matching "${query}".\n${rows.join("\n")}${disambiguationBlock}\n[session] Use /resume to pick one explicitly.\n\n`,
          );
        }
        const target = matches[0];
        if (target.active) {
          return writeMenuHintAndMaybeOpen(
            input,
            "resume",
            `[session] Session "${target.id}" is already active. Use /resume to open menu.\n\n`,
          );
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
      "  /resume [query]      Open full-restore picker (quick query: /resume <query> or /resume find <id|title|summary|updated-at>)",
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
  "model",
  "plan",
  "status",
  "help",
  "exit",
  "health",
  "init",
  "context",
  "memory",
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
  "model",
  "plan",
  "status",
  "help",
  "exit",
];

const UTILITY_HELP_ORDER: readonly string[] = [
  "health",
  "init",
  "context",
  "memory",
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
  { command: "/init", description: "Create AGENTS.md with project instructions" },
  { command: "/context", description: "Show current-turn context assembly status" },
  { command: "/memory", description: "Show durable memory layer status" },
  { command: "/health", description: "Show provider failover and circuit status" },
  { command: "/skills", description: "Show configured skill directories and counts" },
  { command: "/mcp", description: "Show MCP instruction and server status" },
  { command: "/model", description: "Open interactive model picker" },
  { command: "/status", description: "Show current status line config snapshot" },
  { command: "/plan", description: "Enter plan mode (or show plan status when already in plan mode)" },
  { command: "/interrupt", description: "Interrupt running turn (Esc: running interrupt, plan idle exits mode)" },
  { command: "/handoff", description: "Write HANDOFF.md" },
  { command: "/help", description: "Show interactive help screen" },
  { command: "/exit", description: "Exit interactive mode" },
];

const PLAN_MODE_BLOCKED_COMMANDS: Readonly<Record<string, string>> = {
  sessions: "/sessions",
  commands: "/commands",
  "skill-creator": "/skill-creator",
  init: "/init",
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
    "  - /switch /continue remain compatibility shortcuts; prefer /sessions + /resume + /rewind.",
    "  - /checkpoint is an alias of /rewind.",
    "  - Interactive mode is menu-first for /sessions and /status.",
    "  - /plan only supports: /plan, /plan <goal>, /plan open.",
    "  - Non-interactive scripts keep compatibility shortcuts where applicable.",
  ];
}

export function buildSlashCommandHint(): string {
  return "";
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
        `[plan] ${commandName} is unavailable while PLAN_ONLY is active. Use /plan, /plan open, /interrupt, or /exit.\n\n`,
      );
      return "continue";
    }
    return command.execute(payload);
  }
  return undefined;
}
