import {
  listPrimarySlashCommandHelpLines,
  listSlashCommandCompatibilityNotes,
  listUtilitySlashCommandHelpLines,
} from "../../../commands/slash/registry";
import { resolveCliRenderMode } from "../../kernel/render-mode";
import { renderReactHelpScreen } from "../../react/help-screen";
import {
  compactSpaces,
} from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import type {
  BuildHelpScreenInput,
  HelpCommandItem,
  HelpScreenViewModel,
  HelpShortcutItem,
  RenderHelpScreenOptions,
} from "./contract";

const DEFAULT_HELP_COLUMNS = 96;

const DEFAULT_SHORTCUTS: readonly HelpShortcutItem[] = [
  {
    key: "Ctrl+R",
    description: "历史搜索并填入选中提示",
  },
  {
    key: "Esc",
    description: "中断运行中回合 / 计划空闲时退出",
  },
  {
    key: "Ctrl+C",
    description: "退出交互循环",
  },
];

const PRIMARY_COMMAND_OVERVIEW = new Set([
  "/sessions",
  "/resume [query]",
  "/rewind [query]",
  "/commands",
  "/model",
  "/plan",
  "/exit、/quit",
]);

const UTILITY_COMMAND_OVERVIEW = new Set([
  "/health",
  "/context",
  "/memory",
  "/skills",
  "/mcp",
]);

const HELP_OVERVIEW_DESCRIPTIONS = new Map<string, string>([
  ["/sessions", "管理会话"],
  ["/resume [query]", "恢复历史会话"],
  ["/rewind [query]", "回退到检查点"],
  ["/commands", "浏览全部命令"],
  ["/model", "切换模型"],
  ["/plan", "进入或查看计划模式"],
  ["/exit、/quit", "退出交互模式"],
  ["/health", "查看模型通道状态"],
  ["/context", "查看上下文组装状态"],
  ["/memory", "查看持久记忆状态"],
  ["/skills", "查看已配置技能"],
  ["/mcp", "查看 MCP 服务状态"],
  ["/status", "查看状态栏与运行状态"],
]);

function sanitizeLine(value: string): string {
  return sanitizeTerminalDisplayText(value).trim();
}

function parseHelpLine(line: string): HelpCommandItem | undefined {
  const sanitized = sanitizeLine(line);
  if (!sanitized) {
    return undefined;
  }
  const match = /^(.+?)\s{2,}(.+)$/.exec(sanitized);
  if (match) {
    return {
      command: compactSpaces(match[1] ?? ""),
      description: compactSpaces(match[2] ?? ""),
    };
  }
  const fallbackMatch = /^(\S+)\s+(.+)$/.exec(sanitized);
  if (!fallbackMatch) {
    return undefined;
  }
  return {
    command: compactSpaces(fallbackMatch[1] ?? ""),
    description: compactSpaces(fallbackMatch[2] ?? ""),
  };
}

function parseHelpLines(lines: readonly string[]): HelpCommandItem[] {
  return lines
    .map(parseHelpLine)
    .filter((item): item is HelpCommandItem => {
      return item !== undefined
        && item.command.length > 0
        && item.description.length > 0;
    });
}

function parseCompatibilityNote(line: string): string {
  return compactSpaces(sanitizeLine(line).replace(/^-\s*/, ""));
}

function buildOverviewNotes(lines: readonly string[]): string[] {
  const parsed = lines
    .map(parseCompatibilityNote)
    .filter(Boolean);
  const hasSessionCompatibility = parsed.some((note) =>
    note.includes("/switch") || note.includes("/continue")
  );
  const hasCheckpointAlias = parsed.some((note) =>
    note.includes("/checkpoint")
  );
  return [
    ...(hasSessionCompatibility
      ? ["兼容入口: /switch、/continue；优先用 /sessions、/resume、/rewind。"]
      : []),
    ...(hasCheckpointAlias
      ? ["别名: /checkpoint -> /rewind。"]
      : []),
  ];
}

function compactHelpItems(input: {
  items: readonly HelpCommandItem[];
  overviewCommands: ReadonlySet<string>;
  browseCommand: string;
  browseDescription?: string;
  maxItems: number;
}): HelpCommandItem[] {
  const selected = input.items.filter((item) => input.overviewCommands.has(item.command));
  if (input.items.length <= input.maxItems || selected.length === 0) {
    return [...input.items];
  }
  const withoutBrowse = selected.filter((item) => item.command !== input.browseCommand);
  const visible = withoutBrowse.slice(0, Math.max(1, input.maxItems - 1));
  const hiddenCount = Math.max(0, input.items.length - visible.length - 1);
  return [
    ...visible,
    {
      command: input.browseCommand,
      description: input.browseDescription ?? `浏览全部命令（还有 ${String(hiddenCount)} 条）`,
    },
  ];
}

function withOverviewDescriptions(
  items: readonly HelpCommandItem[],
): HelpCommandItem[] {
  return items.map((item) => ({
    ...item,
    description: HELP_OVERVIEW_DESCRIPTIONS.get(item.command) ?? item.description,
  }));
}

function buildPrimaryHelpItems(
  items: readonly HelpCommandItem[],
): HelpCommandItem[] {
  return withOverviewDescriptions(compactHelpItems({
    items,
    overviewCommands: PRIMARY_COMMAND_OVERVIEW,
    browseCommand: "/commands",
    maxItems: 8,
  }));
}

function buildUtilityHelpItems(
  items: readonly HelpCommandItem[],
): HelpCommandItem[] {
  return withOverviewDescriptions(compactHelpItems({
    items,
    overviewCommands: UTILITY_COMMAND_OVERVIEW,
    browseCommand: "/status",
    browseDescription: "查看状态栏与更多运行状态",
    maxItems: 6,
  }));
}

function resolveTerminalColumns(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(40, Math.floor(value));
  }
  return DEFAULT_HELP_COLUMNS;
}

export function buildInteractiveHelpViewModel(
  input: BuildHelpScreenInput = {},
): HelpScreenViewModel {
  const primaryHelpLines = input.primaryHelpLines ?? listPrimarySlashCommandHelpLines();
  const utilityHelpLines = input.utilityHelpLines ?? listUtilitySlashCommandHelpLines();
  const compatibilityNotes = input.compatibilityNotes ?? listSlashCommandCompatibilityNotes();
  const primaryItems = parseHelpLines(primaryHelpLines);
  const utilityItems = parseHelpLines(utilityHelpLines);
  return {
    title: "Help",
    subtitle:
      "Grobot 在终端里处理项目上下文、会话、计划、工具和记忆。",
    shortcutsTitle: "快捷键",
    shortcuts: DEFAULT_SHORTCUTS,
    sections: [
      {
        title: "命令",
        items: buildPrimaryHelpItems(primaryItems),
      },
      {
        title: "状态与工具",
        items: buildUtilityHelpItems(utilityItems),
      },
    ],
    notesTitle: "说明",
    notes: buildOverviewNotes(compatibilityNotes),
    footer: "/sessions 管理会话 · /status 查看状态 · /help 显示帮助",
    terminalColumns: resolveTerminalColumns(input.terminalColumns),
    interactiveMode: input.interactiveMode,
  };
}

export function renderInteractiveHelpScreen(
  viewModel: HelpScreenViewModel,
  options: RenderHelpScreenOptions = {},
): string {
  const mode = options.interactiveMode ?? viewModel.interactiveMode;
  const renderMode = typeof mode === "boolean"
    ? mode ? "interactive_tty" : "plain_tty"
    : resolveCliRenderMode(options);
  const rendered = renderReactHelpScreen({
    ...viewModel,
    terminalColumns: resolveTerminalColumns(
      options.terminalColumns ?? viewModel.terminalColumns,
    ),
    interactiveMode: renderMode === "interactive_tty",
  });
  return `${rendered}\n\n`;
}

export function buildInteractiveHelpScreen(
  options: RenderHelpScreenOptions = {},
): string {
  const viewModel = buildInteractiveHelpViewModel({
    terminalColumns: options.terminalColumns,
    interactiveMode: options.interactiveMode,
  });
  return renderInteractiveHelpScreen(viewModel, options);
}
