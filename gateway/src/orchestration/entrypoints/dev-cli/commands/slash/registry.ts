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

export interface SlashCommandSuggestion {
  command: string;
  description: string;
}

function matchesInteractiveCommand(input: string, command: string): boolean {
  return input === command || input.startsWith(`${command} `);
}

function matchesUserCommandsManagementCommand(inputRaw: string): boolean {
  const input = inputRaw.trim();
  if (/^\/commands(?:\s|$)/i.test(input)) {
    return true;
  }
  if (/^\/(?:create|new)\s+commands(?:\s|$)/i.test(input)) {
    return true;
  }
  return /^\/(?:create|new)\s+command(?:\s|$)/i.test(input);
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
  },
  {
    id: "sessions",
    matches: (userInput) => userInput === "/sessions",
    execute: async ({ controls, handlers }) => {
      await handlers.openSessionMenu("sessions", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /sessions            Open session picker (title + summary)",
    ],
  },
  {
    id: "commands",
    matches: (userInput) => matchesUserCommandsManagementCommand(userInput),
    execute: async ({ userInput, handlers }) => {
      await handlers.handleUserCommandsCommand(userInput);
      return "continue";
    },
    helpLines: [
      "  /commands            Manage user-defined slash commands (only ~/.grobot/commands)",
      "  /commands new ...    Create a user command",
      "  /commands delete ... Delete a user command",
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
          "- project: ./.agents/skills, ./.codex/skills",
          "- global: ~/.agents/skills, ~/.codex/skills",
          "- tip: use /commands new <name> <prompt> to create reusable local command templates",
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
    execute: async ({ userInput, handlers }) => {
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
      "  /status              Show current status line config snapshot",
      "  /status layout <m>   Set status line layout mode (adaptive|full|compact)",
      "  /status theme <t>    Set status line theme (plain|nerd|ccline)",
      "  /status segment ...  Toggle segment on/off",
    ],
  },
  {
    id: "plan",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/plan"),
    execute: async ({ userInput, handlers }) => {
      const parsed = parsePlanCommand(userInput);
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
      await handlers.enterPlan(parsed.goal);
      return "continue";
    },
    helpLines: [
      "  /plan <goal>         Enter plan mode and create plan artifact",
      "  /plan status         Show active plan status",
      "  /plan apply [extra]  Review, approve, then execute active plan",
      "  /plan cancel         Cancel plan mode and discard active plan",
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
      "  /interrupt           Interrupt current running turn (CLI also supports Esc)",
    ],
  },
  {
    id: "new",
    matches: (userInput) => userInput === "/new",
    execute: async ({ handlers }) => {
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
      const tokens = userInput.split(/\s+/, 2);
      const target = tokens[1]?.trim() ?? "";
      if (!target) {
        await handlers.openSessionMenu("switch", controls.withInputPaused);
        return "continue";
      }
      await handlers.switchSession(target);
      return "continue";
    },
    helpLines: [
      "  /switch [id]         Switch active session (no id => open picker)",
    ],
  },
  {
    id: "continue",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/continue"),
    execute: async ({ userInput, controls, handlers }) => {
      const tokens = userInput.split(/\s+/, 2);
      const sourceId = tokens[1]?.trim() ?? "";
      if (!sourceId) {
        await handlers.openSessionMenu("continue", controls.withInputPaused);
        return "continue";
      }
      await handlers.continueFromSession(sourceId);
      return "continue";
    },
    helpLines: [
      "  /continue [id]       Inject summary bridge (no id => open picker)",
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
  "new",
  "switch",
  "continue",
  "health",
  "skills",
  "mcp",
  "model",
  "status",
  "plan",
  "interrupt",
  "handoff",
  "exit",
];

const SLASH_COMMAND_SUGGESTIONS: readonly SlashCommandSuggestion[] = [
  { command: "/sessions", description: "Open session picker (title + summary)" },
  { command: "/commands", description: "Manage user-defined slash commands" },
  { command: "/commands new <name> <prompt>", description: "Create a user command template" },
  { command: "/commands list", description: "List user-defined slash commands" },
  { command: "/commands delete <name>", description: "Delete a user command" },
  { command: "/new", description: "Create and switch to a new session" },
  { command: "/switch [id]", description: "Switch active session" },
  { command: "/continue [id]", description: "Inject summary bridge from a session" },
  { command: "/health", description: "Show provider failover and circuit status" },
  { command: "/skills", description: "Show skill directories and quick usage hint" },
  { command: "/mcp", description: "Show MCP usage hints in current CLI session" },
  { command: "/model", description: "Open interactive model picker" },
  { command: "/status", description: "Show current status line config snapshot" },
  { command: "/status layout <adaptive|full|compact>", description: "Set status line layout mode" },
  { command: "/status theme <plain|nerd|ccline>", description: "Set status line theme" },
  { command: "/status segment <id> <on|off>", description: "Toggle status line segment" },
  { command: "/plan <goal>", description: "Enter plan mode and create plan artifact" },
  { command: "/plan status", description: "Show active plan status" },
  { command: "/plan apply [extra]", description: "Review and execute active plan" },
  { command: "/plan cancel", description: "Cancel plan mode and discard plan" },
  { command: "/interrupt", description: "Interrupt current running turn (Esc also works)" },
  { command: "/handoff", description: "Write HANDOFF.md" },
  { command: "/help", description: "Show interactive help screen" },
  { command: "/exit", description: "Exit interactive mode" },
  { command: "/quit", description: "Alias of /exit" },
];

function findSlashCommandById(id: string): SlashCommandSpec | undefined {
  return SLASH_COMMANDS.find((item) => item.id === id);
}

export function listSlashCommandHelpLines(): string[] {
  const rows: string[] = [];
  for (const id of HELP_ORDER) {
    const command = findSlashCommandById(id);
    if (!command?.helpLines) {
      continue;
    }
    rows.push(...command.helpLines);
  }
  return rows;
}

export function buildSlashCommandHint(): string {
  const wrapped = SLASH_COMMAND_SUGGESTIONS.map((item) => `\`${item.command}\``);
  return `Enter message (${wrapped.join(", ")}; CLI Esc also requests turn interrupt; no id => open picker):`;
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
    return command.execute(payload);
  }
  return undefined;
}
