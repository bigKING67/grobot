import { parsePlanCommand } from "../../start/plan-command";
import {
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
} from "../../start/session-interactive";
import { type SlashCommandExecutionInput, type SlashCommandSpec } from "./types";

interface ParsedModelCommand {
  kind: "menu" | "current" | "list" | "use" | "reset" | "invalid";
  modelId?: string;
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
  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest).trim().toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();
  if (head === "current") {
    return { kind: "current" };
  }
  if (head === "list") {
    return { kind: "list" };
  }
  if (head === "use") {
    if (!tail) {
      return { kind: "invalid", reason: "usage: /model use <model_id>" };
    }
    return { kind: "use", modelId: tail };
  }
  if (head === "reset") {
    return { kind: "reset" };
  }
  return {
    kind: "invalid",
    reason: "usage: /model | /model current | /model list | /model use <model_id> | /model reset",
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
    matches: (userInput) => userInput === "/exit" || userInput === "exit" || userInput === "quit",
    execute: async () => "break",
    helpLines: [
      "  /exit                Exit interactive mode",
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
    id: "model",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/model"),
    execute: async ({ userInput, controls, handlers }) => {
      const parsed = parseModelCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "invalid model command"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "menu") {
        await handlers.openModelMenu(controls.withInputPaused);
        return "continue";
      }
      if (parsed.kind === "current") {
        await handlers.showModelCurrent();
        return "continue";
      }
      if (parsed.kind === "list") {
        await handlers.listModels();
        return "continue";
      }
      if (parsed.kind === "reset") {
        await handlers.resetModel();
        return "continue";
      }
      await handlers.useModel(parsed.modelId ?? "");
      return "continue";
    },
    helpLines: [
      "  /model               Open interactive model picker (session-scoped)",
      "  /model current       Show current provider/model",
      "  /model list          List selectable models from upstream",
      "  /model use <id>      Switch model for current session",
      "  /model reset         Reset model override for current session",
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
  "model",
  "status",
  "plan",
  "interrupt",
  "handoff",
  "exit",
];

const COMMAND_HINT_TOKENS: readonly string[] = [
  "/sessions",
  "/commands",
  "/commands new <name> <prompt>",
  "/commands list",
  "/commands delete <name>",
  "/new",
  "/switch [id]",
  "/continue [id]",
  "/health",
  "/model",
  "/model current",
  "/model list",
  "/model use <id>",
  "/status",
  "/status layout <adaptive|full|compact>",
  "/status theme <plain|nerd|ccline>",
  "/status segment <id> <on|off>",
  "/plan <goal>",
  "/plan status",
  "/plan apply",
  "/plan cancel",
  "/interrupt",
  "/handoff",
  "/help",
  "/exit",
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
  const wrapped = COMMAND_HINT_TOKENS.map((token) => `\`${token}\``);
  return `Enter message (${wrapped.join(", ")}; CLI Esc also requests turn interrupt; no id => open picker):`;
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
