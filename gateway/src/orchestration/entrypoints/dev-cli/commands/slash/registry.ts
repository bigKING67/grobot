import { parsePlanCommand } from "../../start/plan-command";
import {
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
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
  kind: "show_queue" | "cancel_current" | "clear_all" | "invalid";
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
  return {
    kind: "legacy_with_id",
    reason: `[session] ${command} <id> 已废弃；非交互场景保留兼容，建议改用 ${command} 菜单。`,
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
  const rest = input.slice("/ask".length).trim().toLowerCase();
  if (!rest || rest === "queue") {
    return { kind: "show_queue" };
  }
  if (rest === "cancel") {
    return { kind: "cancel_current" };
  }
  if (rest === "clear") {
    return { kind: "clear_all" };
  }
  return {
    kind: "invalid",
    reason: "usage: /ask | /ask queue | /ask cancel | /ask clear",
  };
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
      "  /sessions            Open session actions menu (create/switch/continue)",
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
      if (parsed.kind === "cancel_current") {
        handlers.cancelPendingAsk();
        return "continue";
      }
      if (parsed.kind === "clear_all") {
        handlers.clearPendingAsk();
        return "continue";
      }
      handlers.showPendingAskQueue();
      return "continue";
    },
    helpLines: [
      "  /ask [queue|cancel|clear]  Show pending ask-user queue, cancel current one, or clear all",
    ],
  },
  {
    id: "plan",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/plan"),
    execute: async ({ userInput, handlers }) => {
      const normalizedInput = userInput.trim();
      if (normalizedInput === "/plan") {
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
      if (parsed.kind === "enter_mode") {
        await handlers.enterPlan("");
        return "continue";
      }
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
        return "continue";
      }
      if (parsed.kind === "status") {
        await handlers.showPlanStatus();
        return "continue";
      }
      if (parsed.kind === "apply") {
        await handlers.applyPlan(parsed.extra);
        return "continue";
      }
      if (parsed.kind === "cancel") {
        await handlers.cancelPlan();
        return "continue";
      }
      return "continue";
    },
    helpLines: [
      "  /plan                Enter plan mode",
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
  { command: "/sessions", description: "Open session menu (create/switch/continue)" },
  { command: "/commands", description: "Manage user-defined slash commands" },
  { command: "/skill-creator", description: "Create a skill (append requirement text directly)" },
  { command: "/history [keyword]", description: "Show recent history with optional keyword filter" },
  { command: "/ask [queue|cancel|clear]", description: "Show ask-user queue, cancel current question, or clear all" },
  { command: "/health", description: "Show provider failover and circuit status" },
  { command: "/skills", description: "Show skill directories and quick usage hint" },
  { command: "/mcp", description: "Show MCP usage hints in current CLI session" },
  { command: "/model", description: "Open interactive model picker" },
  { command: "/status", description: "Show current status line config snapshot" },
  { command: "/plan", description: "Enter plan mode" },
  { command: "/interrupt", description: "Interrupt running turn (Esc: running interrupt, plan idle exits mode)" },
  { command: "/handoff", description: "Write HANDOFF.md" },
  { command: "/help", description: "Show interactive help screen" },
  { command: "/exit", description: "Exit interactive mode" },
];

const PRIMARY_HINT_COMMANDS: readonly string[] = [
  "/help",
  "/sessions",
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
    "  - /new /switch /continue are legacy session shortcuts.",
    "  - In interactive mode they redirect to /sessions.",
    "  - /status subcommands are legacy shortcuts in interactive mode.",
    "  - In interactive mode they redirect to /status menu.",
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
        `[plan] ${commandName} is unavailable while PLAN_ONLY is active. Use /plan status, /plan apply, /plan cancel, /interrupt, or /exit.\n\n`,
      );
      return "continue";
    }
    return command.execute(payload);
  }
  return undefined;
}
