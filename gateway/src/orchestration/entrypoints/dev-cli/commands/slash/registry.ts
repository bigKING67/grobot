import { parsePlanCommand } from "../../start/plan-command";
import { resolveRewindQueryMatches } from "../../start/session-rewind-search";
import { resolveResumeQueryMatches } from "../../start/session-resume-search";
import { terminalStyle } from "../../ui/theme/terminal-style";
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

function buildSlashNotice(title: string, details: readonly string[]): string {
  const lines = [`${terminalStyle.accent("●")} ${title}`];
  for (const detail of details) {
    lines.push(`  ${terminalStyle.muted(detail)}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
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
    return { kind: "invalid", reason: "命令必须以 /model 开头" };
  }
  const rest = input.slice("/model".length).trim();
  if (!rest) {
    return { kind: "menu" };
  }
  const legacyMatch = rest.match(/^(current|list|use|reset)(?:\s|$)/i);
  if (legacyMatch) {
    return {
      kind: "legacy_subcommand",
      reason: "[model] 旧子命令已移除。使用 /model 打开选择器（Enter 确认）。",
    };
  }
  return {
    kind: "invalid",
    reason: "用法: /model",
  };
}

function parseStatusCommand(inputRaw: string): ParsedStatusCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/status")) {
    return { kind: "invalid", reason: "命令必须以 /status 开头" };
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
      return { kind: "invalid", reason: "用法: /status layout <adaptive|full|compact>" };
    }
    return { kind: "layout", layoutMode: tail };
  }
  if (head === "theme") {
    if (!tail) {
      return { kind: "invalid", reason: "用法: /status theme <plain|nerd|ccline>" };
    }
    return { kind: "theme", theme: tail };
  }
  if (head === "segment") {
    const segmentTokens = tail.split(/\s+/).filter((token) => token.length > 0);
    if (segmentTokens.length !== 2) {
      return {
        kind: "invalid",
        reason: "用法: /status segment <model|project|context|tokens|session> <on|off>",
      };
    }
    const segmentId = segmentTokens[0];
    const state = segmentTokens[1].toLowerCase();
    if (state !== "on" && state !== "off") {
      return {
        kind: "invalid",
        reason: "用法: /status segment <model|project|context|tokens|session> <on|off>",
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
      "用法: /status | /status current | /status layout <adaptive|full|compact> | /status theme <plain|nerd|ccline> | /status segment <model|project|context|tokens|session> <on|off>",
  };
}

function parseSessionMenuCommand(
  inputRaw: string,
  command: "/switch" | "/continue",
): ParsedSessionMenuCommand {
  const input = inputRaw.trim();
  if (!input.startsWith(command)) {
    return { kind: "invalid", reason: `命令必须以 ${command} 开头` };
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
    return { kind: "invalid", reason: "命令必须以 /resume 开头" };
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
          reason: "用法: /resume find <id|title|summary|updated-at>",
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
  return `\n- ... 还有 ${String(totalCount - listedCount)} 项`;
}

function formatQuickPickBlock(
  tag: "[session]" | "[rewind]",
  quickPickHints: readonly string[],
): string {
  if (quickPickHints.length <= 0) {
    return "";
  }
  if (tag === "[rewind]") {
    return `\n快速选择:\n${quickPickHints.join("\n")}`;
  }
  return `\n${tag} 快速选择:\n${quickPickHints.join("\n")}`;
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
  return `[session] 没有匹配 "${query}" 的会话。使用 /resume 打开菜单。\n[session] 提示：可匹配 ID、标题、摘要或更新时间；紧凑查询会忽略空格、"_" 和 "-"。\n\n`;
}

function buildRewindNoMatchMessage(
  query: string,
  command: "/rewind" | "/checkpoint",
  activeSessionId: string,
): string {
  return buildSlashNotice(
    "没有匹配的检查点",
    [
      `会话: ${activeSessionId}`,
      `查询: ${query}`,
      `使用 ${command} 打开菜单。`,
      '提示：可匹配检查点 ID、创建时间、用户文本或助手回复；紧凑查询会忽略空格、"_" 和 "-"。',
    ],
  );
}

function parseRewindCommand(
  inputRaw: string,
  command: "/rewind" | "/checkpoint" = "/rewind",
): ParsedRewindCommand {
  const input = inputRaw.trim();
  if (!input.startsWith(command)) {
    return { kind: "invalid", reason: `命令必须以 ${command} 开头` };
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
        reason: `用法: ${command} summarize`,
      };
    }
    return { kind: "summarize" };
  }
  if (!isInteractiveTerminal()) {
    return {
      kind: "invalid",
      reason: `用法: ${command} | ${command} summarize`,
    };
  }
  const queryMatch = rest.match(/^(?:find|search)\s*([\s\S]*)$/i);
  const hasExplicitQueryPrefix = Boolean(queryMatch);
  const querySource = queryMatch ? (queryMatch[1] ?? "").trim() : rest;
  if (!querySource) {
    return {
      kind: "invalid",
      reason: `用法: ${command} [find|search] <检查点 ID|文本> [both|conversation|code]`,
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
        reason: `用法: ${command} [find|search] <检查点 ID|文本> [both|conversation|code]`,
      };
    }
  }
  if (!query) {
    return {
      kind: "invalid",
      reason: `用法: ${command} [find|search] <检查点 ID|文本> [both|conversation|code]`,
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
    return { kind: "invalid", reason: "命令必须以 /skill-creator 开头" };
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
    return { kind: "invalid", reason: "命令必须以 /history 开头" };
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
      buildSlashNotice(
        `${command} 命令不可用`,
        [parsed.reason ?? `${command} 命令无效`],
      ),
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
      buildSlashNotice(
        "当前会话不可用于回退",
        [`使用 ${command} 打开菜单。`],
      ),
    );
  }
  if (!input.handlers.rewindSession) {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      buildSlashNotice(
        "回退快速路径不可用",
        [`使用 ${command} 打开菜单。`],
      ),
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
        `- ${checkpoint.checkpointId} | ${checkpoint.createdAt} | 文件=${String(
          checkpoint.changedFilesCount,
        )} | 用户=${formatSingleLinePreview(checkpoint.userText, 44)} | 助手=${formatSingleLinePreview(checkpoint.assistantText, 44)}`);
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
      [
        `${terminalStyle.accent("●")} 找到多个匹配的检查点`,
        `  ${terminalStyle.muted(`会话: ${activeSessionId}`)}`,
        `  ${terminalStyle.muted(`查询: ${query}`)}`,
        rows.join("\n"),
        `${disambiguationBlock}`,
        `${terminalStyle.muted(`使用 ${command} 明确选择一个。`)}`,
        "",
      ].join("\n"),
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
      "  /exit | /quit        退出交互模式",
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
      "  /help                显示交互帮助",
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
      "  /sessions            打开会话操作菜单（新建/切换/恢复/回退/继续）",
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
        handlers.writeStdout(buildSlashNotice(
          "已打开命令管理",
          ["交互模式仅保留主入口 /commands。"],
        ));
        await handlers.openCommandsMenu(controls.withInputPaused);
        return "continue";
      }
      handlers.writeStdout(buildSlashNotice(
        "正在执行兼容子命令",
        ["非交互模式仍支持该写法；交互模式建议使用 /commands 菜单。"],
      ));
      await handlers.handleUserCommandsCommand(userInput);
      return "continue";
    },
    helpLines: [
      "  /commands            打开用户命令管理器（仅 ~/.grobot/commands）",
    ],
  },
  {
    id: "skill-creator",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/skill-creator"),
    execute: async ({ userInput, controls, handlers }) => {
      const parsed = parseSkillCreatorCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(buildSlashNotice(
          "skill-creator 命令不可用",
          [parsed.reason ?? "无效 skill-creator 命令"],
        ));
        return "continue";
      }
      if (parsed.kind === "run") {
        await handlers.runSkillCreator(parsed.requirement ?? "");
        return "continue";
      }
      if (!isInteractiveTerminal()) {
        handlers.writeStdout(buildSlashNotice(
          "需要提供技能需求",
          ["用法: /skill-creator [需求]"],
        ));
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
      "  /skill-creator       根据需求创建 skill（空输入时在 TTY 中询问）",
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
      "  /health              查看 provider failover 与 circuit 状态",
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
      "  /init                创建带项目指令的 AGENTS.md",
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
      "  /context             查看当前回合上下文组装状态",
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
      "  /memory              查看持久 memory 层状态",
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
      "  /skills              查看已配置 skill 目录和数量",
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
      "  /mcp                 查看 MCP 指令和 server 状态",
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
        handlers.writeStdout(`${parsed.reason ?? "无效 model 命令"}\n\n`);
        return "continue";
      }
      return "continue";
    },
    helpLines: [
      "  /model               打开模型选择器（同步 config provider.model）",
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
        handlers.writeStdout(`${parsed.reason ?? "无效 status 命令"}\n\n`);
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
      "  /status              查看/调整状态栏（theme/layout/segment）",
    ],
  },
  {
    id: "history",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/history"),
    execute: async ({ userInput, handlers }) => {
      const parsed = parseHistoryCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "无效 history 命令"}\n\n`);
        return "continue";
      }
      await handlers.showHistory(parsed.query);
      return "continue";
    },
    helpLines: [
      "  /history [keyword]   查看最近对话历史（可选关键词过滤）",
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
      "  /plan                进入 plan mode；已在计划中时显示当前计划状态",
      "  /plan open           在编辑器中打开当前计划文件（交互模式）",
      "  /plan <goal>         带目标进入 plan mode 并运行首轮规划",
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
      "  /interrupt           中断当前运行回合（Esc: 运行中=中断，plan idle=退出 plan mode）",
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
      "  /new                 新建并切换到新会话",
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
        handlers.writeStdout(`${parsed.reason ?? "无效 switch 命令"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "legacy_with_id") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
      }
      await handlers.openSessionMenu("switch", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /switch              打开会话切换器",
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
          `${parsed.reason ?? "无效 resume 命令"}\n\n`,
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
              `- ${session.id}${session.active ? "（当前）" : ""} | ${session.updatedAt} | 标题=${formatSingleLinePreview(session.title, 40)} | 摘要=${formatSingleLinePreview(session.summary, 40)}`);
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
            `[session] 找到 ${String(matches.length)} 个匹配 "${query}" 的会话。\n${rows.join("\n")}${disambiguationBlock}\n[session] 使用 /resume 明确选择一个。\n\n`,
          );
        }
        const target = matches[0];
        if (target.active) {
          return writeMenuHintAndMaybeOpen(
            input,
            "resume",
            `[session] 会话 "${target.id}" 已是当前会话。使用 /resume 打开菜单。\n\n`,
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
      "  /resume [query]      打开完整恢复选择器（快速查询: /resume <query> 或 /resume find <id|title|summary|updated-at>）",
    ],
  },
  {
    id: "rewind",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/rewind"),
    execute: async (input) => executeRewindSlashCommand(input, "/rewind"),
    helpLines: [
      "  /rewind [query]      按检查点查询回退当前会话，或打开回退菜单",
    ],
  },
  {
    id: "checkpoint",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/checkpoint"),
    execute: async (input) => executeRewindSlashCommand(input, "/checkpoint"),
    helpLines: [
      "  /checkpoint [query]  /rewind 的别名（支持查询和菜单）",
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
        handlers.writeStdout(`${parsed.reason ?? "无效 continue 命令"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "legacy_with_id") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
      }
      await handlers.openSessionMenu("continue", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /continue            打开 summary-bridge 选择器",
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
      "  /handoff             写入 HANDOFF.md",
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
  { command: "/sessions", description: "打开会话菜单（新建/切换/恢复/回退/继续）" },
  { command: "/resume", description: "恢复并完整还原历史会话" },
  { command: "/rewind", description: "打开当前或选中会话的检查点回退菜单" },
  { command: "/checkpoint", description: "/rewind 的别名（打开检查点回退菜单）" },
  { command: "/commands", description: "管理用户自定义 / 命令" },
  { command: "/skill-creator", description: "创建 skill（可直接追加需求文本）" },
  { command: "/history [keyword]", description: "按可选关键词查看最近历史" },
  { command: "/init", description: "创建带项目指令的 AGENTS.md" },
  { command: "/context", description: "查看当前回合上下文组装状态" },
  { command: "/memory", description: "查看持久记忆层状态" },
  { command: "/health", description: "查看供应商 failover 与熔断状态" },
  { command: "/skills", description: "查看已配置 skill 目录和数量" },
  { command: "/mcp", description: "查看 MCP 指令和服务状态" },
  { command: "/model", description: "打开模型选择器" },
  { command: "/status", description: "查看当前状态栏配置快照" },
  { command: "/plan", description: "进入 plan mode；已在计划中时显示计划状态" },
  { command: "/interrupt", description: "中断运行中回合（Esc: 运行中断，plan idle 退出）" },
  { command: "/handoff", description: "写入 HANDOFF.md" },
  { command: "/help", description: "显示交互帮助" },
  { command: "/exit", description: "退出交互模式" },
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
    "  - /switch /continue 保留为兼容快捷入口；优先使用 /sessions + /resume + /rewind。",
    "  - /checkpoint 是 /rewind 的别名。",
    "  - 交互模式优先使用 /sessions 和 /status 菜单。",
    "  - /plan 仅支持: /plan、/plan <goal>、/plan open。",
    "  - 非交互脚本按需保留兼容快捷入口。",
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
      handlers.writeStdout(buildSlashNotice(
        "plan mode 中暂不可用",
        [
          `命令: ${commandName}`,
          "可使用: /plan、/plan open、/interrupt 或 /exit",
        ],
      ));
      return "continue";
    }
    return command.execute(payload);
  }
  return undefined;
}
