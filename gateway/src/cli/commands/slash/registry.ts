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
          handlers.writeStdout(buildSlashNotice("已打开状态栏菜单", [
            "交互模式已收敛为主入口 /status。",
          ]));
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
        handlers.writeStdout(buildSlashNotice("Plan", [parsed.reason]));
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
        handlers.writeStdout(buildSlashNotice("已打开会话菜单", [
          "交互模式已收敛为主入口 /sessions。",
        ]));
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
        handlers.writeStdout(buildSlashNotice("已打开会话菜单", [
          "交互模式已收敛为主入口 /sessions。",
        ]));
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
    execute: executeResumeSlashCommand,
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
        handlers.writeStdout(buildSlashNotice("已打开会话菜单", [
          "交互模式已收敛为主入口 /sessions。",
        ]));
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
