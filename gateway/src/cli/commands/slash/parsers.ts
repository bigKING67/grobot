import { type SessionInteractiveRewindMode } from "../../start/session-interactive";
import {
  buildSlashNotice,
  buildSlashUsageNotice,
  formatUsageLine,
  isInteractiveTerminal,
} from "./shared";

export interface ParsedModelCommand {
  kind: "menu" | "legacy_subcommand" | "invalid";
  reason?: string;
}

export interface ParsedStatusCommand {
  kind: "current" | "theme" | "segment" | "layout" | "invalid";
  theme?: string;
  segmentId?: string;
  segmentEnabled?: boolean;
  layoutMode?: string;
  reason?: string;
}

export interface ParsedSessionMenuCommand {
  kind: "menu" | "legacy_with_id" | "invalid";
  sessionId?: string;
  reason?: string;
}

export interface ParsedResumeCommand {
  kind: "menu" | "query" | "legacy_with_id" | "invalid";
  sessionId?: string;
  query?: string;
  reason?: string;
}

export interface ParsedRewindCommand {
  kind: "menu" | "query" | "summarize" | "invalid";
  query?: string;
  mode?: Exclude<SessionInteractiveRewindMode, "summarize">;
  reason?: string;
}

export interface ParsedSkillCreatorCommand {
  kind: "run" | "prompt" | "invalid";
  requirement?: string;
  reason?: string;
}

export interface ParsedHistoryCommand {
  kind: "show" | "invalid";
  query?: string;
  reason?: string;
}

function buildModelUsageNotice(): string {
  return buildSlashUsageNotice("模型命令", [
    {
      command: "/model",
      description: "打开模型选择器。",
    },
  ]);
}

function buildStatusUsageNotice(): string {
  return buildSlashUsageNotice("状态栏命令", [
    {
      command: "/status",
      description: "显示当前状态栏快照。",
    },
    {
      command: "/status 当前",
      description: "显示当前状态栏快照。",
    },
    {
      command: "/status 布局 <自适应|完整|紧凑>",
      description: "调整状态栏布局。",
    },
    {
      command: "/status 主题 <极简|双行|图标增强>",
      description: "调整状态栏主题。",
    },
    {
      command: "/status 状态段 <模型|项目|上下文|Token|会话> <开启|关闭>",
      description: "开启或关闭指定状态段。",
    },
  ]);
}

function buildStatusLayoutUsageNotice(): string {
  return buildSlashUsageNotice("状态栏布局", [
    {
      command: formatUsageLine("/status 布局 <自适应|完整|紧凑>"),
    },
  ]);
}

function buildStatusThemeUsageNotice(): string {
  return buildSlashUsageNotice("状态栏主题", [
    {
      command: formatUsageLine("/status 主题 <极简|双行|图标增强>"),
    },
  ]);
}

function buildStatusSegmentUsageNotice(): string {
  return buildSlashUsageNotice("状态栏状态段", [
    {
      command: formatUsageLine("/status 状态段 <模型|项目|上下文|Token|会话> <开启|关闭>"),
    },
  ]);
}

function buildResumeFindUsageNotice(): string {
  return buildSlashUsageNotice("恢复会话查询", [
    {
      command: formatUsageLine("/resume find <id|title|summary|updated-at>"),
    },
  ]);
}

function buildRewindSummaryUsageNotice(command: "/rewind" | "/checkpoint"): string {
  return buildSlashUsageNotice("回退汇总命令", [
    {
      command: formatUsageLine(`${command} summarize`),
      description: "显示最近检查点摘要，不执行恢复。",
    },
  ]);
}

function buildRewindNonInteractiveUsageNotice(command: "/rewind" | "/checkpoint"): string {
  return buildSlashUsageNotice("回退命令", [
    {
      command,
      description: "打开回退菜单。",
    },
    {
      command: `${command} summarize`,
      description: "显示最近检查点摘要。",
    },
  ]);
}

function buildRewindQueryUsageNotice(command: "/rewind" | "/checkpoint"): string {
  return buildSlashUsageNotice("回退查询命令", [
    {
      command: formatUsageLine(`${command} [find|search] <检查点 ID|文本> [both|conversation|code]`),
    },
  ]);
}

export function parseModelCommand(inputRaw: string): ParsedModelCommand {
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
      reason: buildSlashNotice("模型选择", [
        "旧子命令已移除。",
        "使用 /model 打开选择器（Enter 确认）。",
      ]).trimEnd(),
    };
  }
  return {
    kind: "invalid",
    reason: buildModelUsageNotice(),
  };
}

export function parseStatusCommand(inputRaw: string): ParsedStatusCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/status")) {
    return { kind: "invalid", reason: "命令必须以 /status 开头" };
  }
  const rest = input.slice("/status".length).trim();
  if (!rest || rest.toLowerCase() === "current" || rest === "当前") {
    return { kind: "current" };
  }
  const normalizedRest = rest.toLowerCase();
  if (rest === "完整" || normalizedRest === "full") {
    return {
      kind: "layout",
      layoutMode: "full",
    };
  }
  if (rest === "紧凑" || normalizedRest === "compact") {
    return {
      kind: "layout",
      layoutMode: "compact",
    };
  }
  if (rest === "自适应" || normalizedRest === "adaptive") {
    return {
      kind: "layout",
      layoutMode: "adaptive",
    };
  }
  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest)
    .trim()
    .toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();
  if (head === "layout" || head === "布局") {
    if (!tail) {
      return {
        kind: "invalid",
        reason: buildStatusLayoutUsageNotice(),
      };
    }
    return { kind: "layout", layoutMode: tail };
  }
  if (head === "theme" || head === "主题") {
    if (!tail) {
      return {
        kind: "invalid",
        reason: buildStatusThemeUsageNotice(),
      };
    }
    return { kind: "theme", theme: tail };
  }
  if (head === "segment" || head === "状态段") {
    const segmentTokens = tail
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (segmentTokens.length !== 2) {
      return {
        kind: "invalid",
        reason: buildStatusSegmentUsageNotice(),
      };
    }
    const segmentId = segmentTokens[0];
    const state = segmentTokens[1].toLowerCase();
    const enabled = state === "on" || state === "开启" || state === "开";
    const disabled = state === "off" || state === "关闭" || state === "关";
    if (!enabled && !disabled) {
      return {
        kind: "invalid",
        reason: buildStatusSegmentUsageNotice(),
      };
    }
    return {
      kind: "segment",
      segmentId,
      segmentEnabled: enabled,
    };
  }
  return {
    kind: "invalid",
    reason: buildStatusUsageNotice(),
  };
}

export function parseSessionMenuCommand(
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
      reason: buildSlashNotice("会话命令已改为菜单选择", [
        `${command} <id> 已移除。`,
        `请使用 ${command} 打开菜单后再选择目标会话。`,
      ]).trimEnd(),
    };
  }
  const sessionId = rest.split(/\s+/, 1)[0] ?? "";
  return {
    kind: "legacy_with_id",
    sessionId: sessionId.trim(),
    reason: buildSlashNotice("会话命令兼容模式", [
      `${command} <id> 已废弃；非交互场景保留兼容。`,
      `建议改用 ${command} 菜单。`,
    ]).trimEnd(),
  };
}

export function parseResumeCommand(inputRaw: string): ParsedResumeCommand {
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
          reason: buildResumeFindUsageNotice(),
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
    reason: buildSlashNotice("恢复会话", [
      "/resume <id> 已废弃；非交互场景保留兼容。",
      "建议改用 /resume 菜单。",
    ]).trimEnd(),
  };
}

export function parseRewindCommand(
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
        reason: buildRewindSummaryUsageNotice(command),
      };
    }
    return { kind: "summarize" };
  }
  if (!isInteractiveTerminal()) {
    return {
      kind: "invalid",
      reason: buildRewindNonInteractiveUsageNotice(command),
    };
  }
  const queryMatch = rest.match(/^(?:find|search)\s*([\s\S]*)$/i);
  const hasExplicitQueryPrefix = Boolean(queryMatch);
  const querySource = queryMatch ? (queryMatch[1] ?? "").trim() : rest;
  if (!querySource) {
    return {
      kind: "invalid",
      reason: buildRewindQueryUsageNotice(command),
    };
  }
  const queryTokens = querySource
    .split(/\s+/)
    .filter((token) => token.length > 0);
  let mode: Exclude<SessionInteractiveRewindMode, "summarize"> = "both";
  let query = querySource;
  if (queryTokens.length > 1) {
    const maybeMode = (queryTokens[queryTokens.length - 1] ?? "").toLowerCase();
    if (
      maybeMode === "both" ||
      maybeMode === "conversation" ||
      maybeMode === "code"
    ) {
      mode = maybeMode;
      query = queryTokens.slice(0, -1).join(" ").trim();
    }
  } else {
    const onlyToken = (queryTokens[0] ?? "").toLowerCase();
    if (
      !hasExplicitQueryPrefix &&
      (onlyToken === "both" ||
        onlyToken === "conversation" ||
        onlyToken === "code")
    ) {
      return {
        kind: "invalid",
        reason: buildRewindQueryUsageNotice(command),
      };
    }
  }
  if (!query) {
    return {
      kind: "invalid",
      reason: buildRewindQueryUsageNotice(command),
    };
  }
  return {
    kind: "query",
    query,
    mode,
  };
}

export function parseSkillCreatorCommand(
  inputRaw: string,
): ParsedSkillCreatorCommand {
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

export function parseHistoryCommand(inputRaw: string): ParsedHistoryCommand {
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
