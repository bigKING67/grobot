import { parsePlanCommand } from "../../start/plan-command";
import {
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
} from "../../start/session-interactive";
import {
  type SlashCommandExecutionInput,
  type SlashCommandSpec,
  type SlashCommandSuggestion,
} from "./types";
import {
  buildSlashNotice,
  formatUsageLine,
  isInteractiveTerminal,
  matchesInteractiveCommand,
  matchesUserCommandsManagementCommand,
} from "./shared";
import {
  parseHistoryCommand,
  parseModelCommand,
  parseSessionMenuCommand,
  parseSkillCreatorCommand,
  parseStatusCommand,
} from "./parsers";
import { executeResumeSlashCommand } from "./resume-command";
import { executeRewindSlashCommand } from "./rewind-command";

export type { SlashCommandSuggestion } from "./types";

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
      "  /exit, /quit         Exit interactive mode",
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
      "  /sessions            Open session menu (new/switch/resume/rewind/continue)",
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
          "Command manager opened",
          ["Interactive mode keeps /commands as the main entry."],
        ));
        await handlers.openCommandsMenu(controls.withInputPaused);
        return "continue";
      }
      handlers.writeStdout(buildSlashNotice(
        "Running compatibility subcommand",
        ["Non-interactive mode still supports this form; interactive mode should use the /commands menu."],
      ));
      await handlers.handleUserCommandsCommand(userInput);
      return "continue";
    },
    helpLines: [
      "  /commands            Manage user commands (~/.grobot/commands only)",
    ],
  },
  {
    id: "skill-creator",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/skill-creator"),
    execute: async ({ userInput, controls, handlers }) => {
      const parsed = parseSkillCreatorCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(buildSlashNotice(
          "Skill creation unavailable",
          [parsed.reason ?? "Invalid skill creation command"],
        ));
        return "continue";
      }
      if (parsed.kind === "run") {
        await handlers.runSkillCreator(parsed.requirement ?? "");
        return "continue";
      }
      if (!isInteractiveTerminal()) {
        handlers.writeStdout(buildSlashNotice(
          "Skill requirement required",
          [formatUsageLine("/skill-creator [requirement]")],
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
      "  /skill-creator       Create a skill from requirements (prompts if empty)",
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
      "  /health              Show model provider health",
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
      "  /init                Create AGENTS.md project instructions",
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
      "  /context             Show current turn context assembly status",
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
      "  /memory              Show persistent memory status",
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
      "  /mcp                 Show MCP instructions and service status",
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
        handlers.writeStdout(`${parsed.reason ?? "Invalid model command"}\n\n`);
        return "continue";
      }
      return "continue";
    },
    helpLines: [
      "  /model               Open model picker (syncs model config)",
    ],
  },
  {
    id: "status",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/status"),
    execute: async ({ userInput, controls, handlers }) => {
      if (isInteractiveTerminal()) {
        if (userInput.trim() !== "/status") {
          handlers.writeStdout(buildSlashNotice("Status bar menu opened", [
            "Interactive mode uses /status as the main entry.",
          ]));
        }
        await handlers.openStatusMenu(controls.withInputPaused);
        return "continue";
      }
      const parsed = parseStatusCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "Invalid status bar command"}\n\n`);
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
      "  /status              View/change status bar",
    ],
  },
  {
    id: "history",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/history"),
    execute: async ({ userInput, handlers }) => {
      const parsed = parseHistoryCommand(userInput);
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "Invalid history command"}\n\n`);
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
        handlers.writeStdout(buildSlashNotice("Plan mode", [parsed.reason]));
        return "continue";
      }
      return "continue";
    },
    helpLines: [
      "  /plan                Enter plan mode; show plan status if already planning",
      "  /plan open           Open current plan file in editor (interactive mode)",
      "  /plan <goal>         Enter plan mode with a goal and run first planning turn",
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
      "  /interrupt           Interrupt current turn (Esc: running=interrupt, idle plan=exit)",
    ],
  },
  {
    id: "new",
    matches: (userInput) => userInput === "/new",
    execute: async ({ controls, handlers }) => {
      if (isInteractiveTerminal()) {
        handlers.writeStdout(buildSlashNotice("Session menu opened", [
          "Interactive mode uses /sessions as the main entry.",
        ]));
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
        handlers.writeStdout(buildSlashNotice("Session menu opened", [
          "Interactive mode uses /sessions as the main entry.",
        ]));
        await handlers.openSessionMenu("sessions", controls.withInputPaused);
        return "continue";
      }
      const parsed = parseSessionMenuCommand(userInput, "/switch");
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "Invalid switch command"}\n\n`);
        return "continue";
      }
      if (parsed.kind === "legacy_with_id") {
        handlers.writeStdout(`${parsed.reason}\n\n`);
      }
      await handlers.openSessionMenu("switch", controls.withInputPaused);
      return "continue";
    },
    helpLines: [
      "  /switch              Open session switcher",
    ],
  },
  {
    id: "resume",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/resume"),
    execute: executeResumeSlashCommand,
    helpLines: [
      "  /resume [query]      Open full resume picker (quick query: /resume <query> or /resume find <id|title|summary|updated-at>)",
    ],
  },
  {
    id: "rewind",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/rewind"),
    execute: async (input) => executeRewindSlashCommand(input, "/rewind"),
    helpLines: [
      "  /rewind [query]      Query checkpoints to rewind current session, or open rewind menu",
    ],
  },
  {
    id: "checkpoint",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/checkpoint"),
    execute: async (input) => executeRewindSlashCommand(input, "/checkpoint"),
    helpLines: [
      "  /checkpoint [query]  Alias for /rewind (supports query and menu)",
    ],
  },
  {
    id: "continue",
    matches: (userInput) => matchesInteractiveCommand(userInput, "/continue"),
    execute: async ({ userInput, controls, handlers }) => {
      if (isInteractiveTerminal()) {
        handlers.writeStdout(buildSlashNotice("Session menu opened", [
          "Interactive mode uses /sessions as the main entry.",
        ]));
        await handlers.openSessionMenu("sessions", controls.withInputPaused);
        return "continue";
      }
      const parsed = parseSessionMenuCommand(userInput, "/continue");
      if (parsed.kind === "invalid") {
        handlers.writeStdout(`${parsed.reason ?? "Invalid continue command"}\n\n`);
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
  { command: "/sessions", description: "Open session menu (new/switch/resume/rewind/continue)" },
  { command: "/resume", description: "Resume and fully restore a historical session" },
  { command: "/rewind", description: "Open checkpoint rewind menu for the current or selected session" },
  { command: "/checkpoint", description: "Alias for /rewind (checkpoint rewind menu)" },
  { command: "/commands", description: "Manage user custom slash commands" },
  { command: "/skill-creator", description: "Create a skill (can append requirement text)" },
  { command: "/history [keyword]", description: "Show recent history with optional keyword filter" },
  { command: "/init", description: "Create AGENTS.md project instructions" },
  { command: "/context", description: "Show current turn context assembly status" },
  { command: "/memory", description: "Show persistent memory status" },
  { command: "/health", description: "Show model provider health" },
  { command: "/skills", description: "Show configured skill directories and counts" },
  { command: "/mcp", description: "Show MCP instructions and service status" },
  { command: "/model", description: "Open model picker" },
  { command: "/status", description: "Show current status bar config snapshot" },
  { command: "/plan", description: "Enter plan mode; show plan status if already planning" },
  { command: "/interrupt", description: "Interrupt running turn (Esc: interrupt running, exit idle plan)" },
  { command: "/handoff", description: "Write HANDOFF.md" },
  { command: "/help", description: "Show interactive help" },
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
    "  - /switch and /continue remain compatibility shortcuts; prefer /sessions + /resume + /rewind.",
    "  - /checkpoint is an alias for /rewind.",
    "  - Interactive mode prefers /sessions and /status menus.",
    "  - /plan supports only: /plan, /plan <goal>, /plan open.",
    "  - Non-interactive scripts keep compatibility shortcuts as needed.",
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
        "Unavailable in plan mode",
        [
          commandName,
          "Plan mode only accepts plan-related operations.",
          "Available entries: /plan, /plan open, /interrupt, /exit",
        ],
      ));
      return "continue";
    }
    return command.execute(payload);
  }
  return undefined;
}
