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
    description: "Search history and fill the selected prompt",
  },
  {
    key: "Esc",
    description: "Interrupt a running turn / exit idle plan mode",
  },
  {
    key: "Ctrl+C",
    description: "Exit interactive loop",
  },
];

const PRIMARY_COMMAND_OVERVIEW = new Set([
  "/sessions",
  "/resume [query]",
  "/rewind [query]",
  "/commands",
  "/model",
  "/plan",
  "/exit, /quit",
]);

const UTILITY_COMMAND_OVERVIEW = new Set([
  "/health",
  "/context",
  "/memory",
  "/skills",
  "/mcp",
]);

const HELP_OVERVIEW_DESCRIPTIONS = new Map<string, string>([
  ["/sessions", "Manage sessions"],
  ["/resume [query]", "Resume a historical session"],
  ["/rewind [query]", "Rewind to a checkpoint"],
  ["/commands", "Browse all commands"],
  ["/model", "Switch model"],
  ["/plan", "Enter or view plan mode"],
  ["/exit, /quit", "Exit interactive mode"],
  ["/health", "Show model provider health"],
  ["/context", "Show context assembly status"],
  ["/memory", "Show persistent memory status"],
  ["/skills", "Show configured skills"],
  ["/mcp", "Show MCP services"],
  ["/status", "Show status bar and runtime status"],
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
      ? ["Compatibility: /switch and /continue are shortcuts."]
      : []),
    ...(hasCheckpointAlias
      ? ["Alias: /checkpoint -> /rewind."]
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
      description: input.browseDescription ?? `Browse all commands (${String(hiddenCount)} hidden)`,
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
    browseDescription: "Show status bar and more runtime status",
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
      "Grobot manages project context, sessions, plans, tools, and memory in the terminal.",
    shortcutsTitle: "Shortcuts",
    shortcuts: DEFAULT_SHORTCUTS,
    sections: [
      {
        title: "Commands",
        items: buildPrimaryHelpItems(primaryItems),
      },
      {
        title: "Status and tools",
        items: buildUtilityHelpItems(utilityItems),
      },
    ],
    notesTitle: "Notes",
    notes: buildOverviewNotes(compatibilityNotes),
    footer: "/sessions manage sessions · /status show status · /help show help",
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
