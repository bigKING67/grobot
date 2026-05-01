import { type SessionStoreRuntime } from "../services/session-store";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { relative as relativePath, resolve as resolvePath } from "node:path";
import {
  type InteractiveDiagnosticsMode,
  type RunStartInteractiveModeInput,
} from "./run-start-interactive-mode";
import { type ContextEngineConfig } from "../../../../tools/context";
import { type MemoryOrchestrator } from "../../../../tools/memory";
import { type RuntimeAttachment } from "../../../../models/types";
import {
  type RunStartModelOps,
  type RunStartModelSnapshot,
} from "./run-start-model-ops";
import { type RunStartOutput } from "./run-start-output";
import {
  type RunStartPlanMode,
} from "./run-start-plan-mode";
import { formatProviderHealthSnapshot } from "./run-start-provider-health";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type RunStartSessionMenuOps } from "./run-start-session-menu-ops";
import {
  type RuntimeFailoverConfig,
  type RuntimeProviderCandidate,
} from "./run-start-turn";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import { type RunStartWire } from "./run-start-wire";
import {
  normalizeStatusLineConfig,
  type StatusLineConfig,
  type StatusLineConfigInput,
  type StatusLineLayoutMode,
  type StatusLineSegmentId,
  type StatusLineTheme,
} from "../ui/screens/status-line-screen";
import { terminalStyle } from "../ui/theme/terminal-style";
import { createRunStartUserCommandsRuntime } from "./run-start-user-commands";
import {
  runAskUserQuestionnairePanel,
  runTerminalLinePrompt,
  runTerminalSelectMenu,
} from "./run-start-io";
import { compactSingleLine, type ChatHistoryMessage } from "./session-history";
import { type GaMechanismRuntime } from "../services/ga-mechanism-runtime";
import {
  buildAskUserQueueDisplay,
  buildAskUserPendingSummary,
  createAskUserQuestionnaireState,
} from "../../../../tools/ask-user";
import {
  resolveRunStartPlanSuggestionState,
  type RunStartPlanSuggestionState,
} from "./plan-suggestion-state";
import { resolveAgentsInstructionBlock } from "../services/agents-instructions";

interface CreateRunStartInteractiveModeInput {
  homeDir: string;
  projectRoot: string;
  projectName: string;
  workDir: string;
  sessionNamespaceKey: string;
  sessionStoreRuntime: SessionStoreRuntime;
  sessionRegistryFilePathValue: string;
  handoffAutoOnExit: boolean;
  handoffRecentTurns: number;
  handoffPath: string;
  contextWindowTokens?: number;
  contextEngineConfig: ContextEngineConfig;
  memoryOrchestrator: MemoryOrchestrator;
  mcpInstructionPromptPrefix?: string;
  mcpInstructionServerNames: string[];
  mcpInstructionStrictFailure?: string;
  interactiveDiagnosticsEnabled?: boolean;
  interactiveDiagnosticsMode?: InteractiveDiagnosticsMode;
  buildHelpText(): string;
  statusLineConfig?: StatusLineConfigInput;
  runtimeProviderChain: ReadonlyArray<RuntimeProviderCandidate>;
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeState: RunStartRuntimeState;
  gaMechanismRuntime: GaMechanismRuntime;
  output: Pick<RunStartOutput, "writeStdout">;
  runSelectMenu?: typeof runTerminalSelectMenu;
  modelOps: RunStartModelOps;
  sessionMenuOps: RunStartSessionMenuOps;
  wire: RunStartWire;
  planMode: RunStartPlanMode;
  requestRuntimeInterrupt(
    source: "command" | "cli_esc",
  ): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      attachments?: RuntimeAttachment[];
      promptPrelude?: string;
      autoOpenAskUserPanel?: boolean;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
}

interface HistorySearchCandidate {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function resolveSessionTopicBySessionId(input: {
  wire: RunStartWire;
  sessionId: string;
}): string | undefined {
  const session = input.wire.sessionOps
    .listSessions()
    .find((entry) => entry.id === input.sessionId);
  if (!session) {
    return undefined;
  }
  const title = session.title.trim();
  if (title.length > 0) {
    return title;
  }
  const summary = session.summary.trim();
  return summary.length > 0 ? summary : undefined;
}

function normalizeStatusSegmentId(raw: string): StatusLineSegmentId | undefined {
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "model"
    || normalized === "project"
    || normalized === "context"
    || normalized === "tokens"
    || normalized === "session"
  ) {
    return normalized;
  }
  return undefined;
}

function formatPlanPathForPanel(workDir: string, planPath: string | undefined): string | undefined {
  const rawPath = planPath?.trim();
  if (!rawPath) {
    return undefined;
  }
  const resolvedPlanPath = resolvePath(rawPath);
  const relativePlanPath = relativePath(workDir, resolvedPlanPath);
  if (relativePlanPath && !relativePlanPath.startsWith("..") && !relativePlanPath.startsWith("/")) {
    return relativePlanPath;
  }
  return rawPath;
}

function formatStatusLineCurrentSnapshot(config: StatusLineConfig): string {
  const segmentText = config.segmentOrder
    .map((segmentId) => `${segmentId} ${config.segments[segmentId] ? "开启" : "关闭"}`)
    .join(", ");
  return [
    "● 状态栏",
    `  状态: ${config.enabled ? "开启" : "关闭"}`,
    `  布局: ${config.layoutMode}`,
    `  主题: ${config.theme}`,
    `  分隔符: ${JSON.stringify(config.separator)}`,
    `  状态段: ${segmentText}`,
    `  提醒阈值: ${String(Math.round(config.warningThresholdRatio * 100))}%`,
    `  危险阈值: ${String(Math.round(config.criticalThresholdRatio * 100))}%`,
    `  预算快照缓存: ${String(config.budgetSnapshotCacheTtlMs)}ms`,
    `  会话主题缓存: ${String(config.sessionTopicCacheTtlMs)}ms`,
    `  会话主题宽度: ${String(config.sessionTopicMaxWidth)}`,
    "",
  ].join("\n");
}

function buildCompactNotice(
  title: string,
  lines: ReadonlyArray<string> = [],
): string {
  return [
    `● ${title}`,
    ...lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `  ${line}`),
    "",
    "",
  ].join("\n");
}

function resolveStatusTheme(input: string): StatusLineTheme | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "plain") {
    return "plain";
  }
  if (normalized === "ccline" || normalized === "cometix") {
    return "ccline";
  }
  if (normalized === "nerd" || normalized === "nerd_font" || normalized === "nerd-font") {
    return "nerd_font";
  }
  return undefined;
}

function resolveStatusLayoutMode(input: string): StatusLineLayoutMode | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "adaptive" || normalized === "full" || normalized === "compact") {
    return normalized;
  }
  return undefined;
}

function trimTrailingSlashes(path: string): string {
  if (/^[\\/]+$/.test(path)) {
    return path.startsWith("\\") ? "\\" : "/";
  }
  return path.replace(/[\\/]+$/, "");
}

function buildSkillCreatorSurface(input: {
  title: string;
  details?: readonly string[];
}): string {
  const lines = [`${terminalStyle.accent("●")} ${input.title}`];
  for (const detail of input.details ?? []) {
    lines.push(`  ${terminalStyle.muted(detail)}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildSkillCreatorPrompt(input: {
  requirement: string;
  projectRoot: string;
  homeDir: string;
}): string {
  const requirement = input.requirement.trim();
  const projectSkillsDir = `${trimTrailingSlashes(input.projectRoot)}/.grobot/skills`;
  const globalSkillsDir = `${trimTrailingSlashes(input.homeDir)}/skills`;
  return [
    "你现在需要作为内置 `skill-creator` 执行技能创建任务。",
    "请按以下约束执行：",
    "- 优先创建或更新项目技能目录：`./.grobot/skills`。",
    `- 绝对路径参考：${projectSkillsDir}`,
    `- 全局内置技能目录：${globalSkillsDir}/skill-creator`,
    "- 若需求不完整，请先补齐最少必要澄清，再继续产出可执行技能。",
    "- 产出目标是可以直接落地使用的 skill 文件结构与内容。",
    "",
    "用户需求：",
    requirement,
  ].join("\n");
}

function buildAgentsInitPrompt(input: {
  targetPath: string;
  projectRoot: string;
  workDir: string;
}): string {
  return [
    "你正在执行 grobot 内置 `/init`。",
    "目标：为当前项目生成项目级 `AGENTS.md`，这是用户可编辑的项目协作规范。",
    "",
    "硬性约束：",
    `- 必须创建文件：${input.targetPath}`,
    `- 项目根目录：${input.projectRoot}`,
    `- 当前工作目录：${input.workDir}`,
    "- 不要创建或修改 `CLAUDE.md`。",
    "- 不要创建或修改 `SYSTEM.md` 或 `SOUL.md`；`SYSTEM.md` 是产品内置系统提示词，不是项目文件。",
    "- 不要生成 Trellis 文件，也不要把 Trellis 描述为 grobot 用户需要使用的功能。",
    "- `AGENTS.md` 应描述项目结构、构建/测试命令、代码风格、验证要求、安全配置注意事项，以及 agent-specific instructions。",
    "- 内容应简洁、可执行、面向这个仓库；如果某些命令无法确认，写明需要用当前仓库脚本核验，不要编造。",
    "- 必须实际写入文件，不要只在聊天中展示内容。",
    "",
    "建议结构：",
    "# Repository Guidelines",
    "## Project Structure",
    "## Build, Test, and Development Commands",
    "## Coding Style and Naming",
    "## Testing and Verification",
    "## Security and Configuration",
    "## Agent-Specific Instructions",
  ].join("\n");
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatSpawnError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

interface SkillDirectoryStatus {
  path: string;
  exists: boolean;
  skillCount: number;
  invalidDirectoryCount: number;
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readSkillDirectoryStatus(path: string): SkillDirectoryStatus {
  if (!existsSync(path) || !safeIsDirectory(path)) {
    return {
      path,
      exists: false,
      skillCount: 0,
      invalidDirectoryCount: 0,
    };
  }
  let skillCount = 0;
  let invalidDirectoryCount = 0;
  for (const entry of readdirSync(path)) {
    const entryPath = `${trimTrailingSlashes(path)}/${entry}`;
    if (!safeIsDirectory(entryPath)) {
      continue;
    }
    const skillPath = `${entryPath}/SKILL.md`;
    if (existsSync(skillPath)) {
      skillCount += 1;
    } else {
      invalidDirectoryCount += 1;
    }
  }
  return {
    path,
    exists: true,
    skillCount,
    invalidDirectoryCount,
  };
}

function formatSkillDirectoryStatusLines(
  label: string,
  status: SkillDirectoryStatus,
): string[] {
  return [
    `${label}: ${status.exists ? "可用" : "未找到"}`,
    `  目录: ${status.path}`,
    `  Skills: ${String(status.skillCount)}`,
    `  无效目录: ${String(status.invalidDirectoryCount)}`,
  ];
}

function detectPlatformFromEnv(): "darwin" | "win32" | "other" {
  const hints = String(process.env.OSTYPE ?? process.env.OS ?? "").toLowerCase();
  if (hints.includes("darwin") || hints.includes("mac")) {
    return "darwin";
  }
  if (hints.includes("windows") || hints === "win32") {
    return "win32";
  }
  return "other";
}

function launchPlanFileInEditor(planPath: string): {
  ok: boolean;
  detail: string;
} {
  const currentPlatform = detectPlatformFromEnv();
  const editor = String(process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (editor.length > 0) {
    const script = `${editor} ${quoteShellArg(planPath)}`;
    const result = spawnSync("sh", ["-lc", script]);
    if (result.error) {
      return { ok: false, detail: formatSpawnError(result.error) };
    }
    if (typeof result.status === "number" && result.status !== 0) {
      return { ok: false, detail: `editor exited with code ${String(result.status)}` };
    }
    return { ok: true, detail: "opened by $VISUAL/$EDITOR" };
  }
  if (currentPlatform === "darwin") {
    const result = spawnSync("open", ["-t", planPath]);
    if (result.error) {
      return { ok: false, detail: formatSpawnError(result.error) };
    }
    if (typeof result.status === "number" && result.status !== 0) {
      return { ok: false, detail: `open exited with code ${String(result.status)}` };
    }
    return { ok: true, detail: "opened by macOS open -t" };
  }
  if (currentPlatform === "win32") {
    const result = spawnSync("cmd", ["/c", "start", "", planPath]);
    if (result.error) {
      return { ok: false, detail: formatSpawnError(result.error) };
    }
    return { ok: true, detail: "opened by Windows start" };
  }
  const result = spawnSync("xdg-open", [planPath]);
  if (result.error) {
    return { ok: false, detail: formatSpawnError(result.error) };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return { ok: false, detail: `xdg-open exited with code ${String(result.status)}` };
  }
  return { ok: true, detail: "opened by xdg-open" };
}

function buildHistorySearchCandidates(rows: readonly ChatHistoryMessage[]): HistorySearchCandidate[] {
  if (rows.length === 0) {
    return [];
  }
  const recent = [...rows].reverse();
  const prioritized = [
    ...recent.filter((row) => row.role === "user"),
    ...recent.filter((row) => row.role === "assistant"),
  ];
  const dedup = new Set<string>();
  const candidates: HistorySearchCandidate[] = [];
  for (let index = 0; index < prioritized.length; index += 1) {
    const row = prioritized[index];
    const content = row.content.trim();
    if (!content || dedup.has(content)) {
      continue;
    }
    dedup.add(content);
    candidates.push({
      id: `${row.role}-${String(index + 1)}`,
      role: row.role,
      content,
    });
    if (candidates.length >= 120) {
      break;
    }
  }
  return candidates;
}

function filterHistorySearchCandidates(
  candidates: readonly HistorySearchCandidate[],
  queryRaw: string,
): HistorySearchCandidate[] {
  const query = queryRaw.trim().toLowerCase();
  if (query.length < 2) {
    return [...candidates];
  }
  return candidates.filter((candidate) => candidate.content.toLowerCase().includes(query));
}

export function createRunStartInteractiveModeInput(
  input: CreateRunStartInteractiveModeInput,
): RunStartInteractiveModeInput {
  const runSelectMenu = input.runSelectMenu ?? runTerminalSelectMenu;
  const userCommandsRuntime = createRunStartUserCommandsRuntime({
    homeDir: input.homeDir,
    writeStdout: input.output.writeStdout,
    runSelectMenu,
    executeTurn: input.executeTurn,
    markFailureObserved: input.runtimeState.markFailureObserved,
  });
  const getModelSnapshot = (): RunStartModelSnapshot =>
    input.modelOps.getCurrentModelSnapshot();
  let statusLineConfigState = normalizeStatusLineConfig(input.statusLineConfig);
  const updateStatusLineConfig = (partial: StatusLineConfigInput): void => {
    statusLineConfigState = normalizeStatusLineConfig({
      ...statusLineConfigState,
      ...partial,
      segmentOrder: partial.segmentOrder ?? statusLineConfigState.segmentOrder,
      segments: {
        ...statusLineConfigState.segments,
        ...(partial.segments ?? {}),
      },
    });
  };
  const getStatusLineConfig = (): StatusLineConfig => statusLineConfigState;
  const shouldMarkFailure = (code: number): boolean =>
    code !== 0 && code !== TURN_INTERRUPTED_EXIT_CODE;

  const openPlanInEditor = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
    options?: { suppressOpenPlanEditorNotice?: boolean },
  ): Promise<void> => {
    const planPath = input.planMode.getActivePlanPath();
    if (!planPath) {
      input.output.writeStdout(buildCompactNotice("当前没有活跃计划文件", [
        "请先使用 /plan <goal>。",
      ]));
      return;
    }
    const displayPath = formatPlanPathForPanel(input.workDir, planPath) ?? planPath;
    const openOperation = async (): Promise<void> => {
      const launched = launchPlanFileInEditor(planPath);
      if (!launched.ok) {
        input.output.writeStdout(buildCompactNotice("无法打开计划文件", [
          `原因: ${compactSingleLine(launched.detail, 200)}`,
          `计划文件: ${displayPath}`,
        ]));
        return;
      }
      if (options?.suppressOpenPlanEditorNotice) {
        return;
      }
      input.output.writeStdout(buildCompactNotice("已打开计划文件", [
        `计划文件: ${displayPath}`,
      ]));
    };
    if (!process.stdin.isTTY) {
      await openOperation();
      return;
    }
    await withInputPaused(openOperation);
  };

  const openStatusMenu = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    const showCurrent = (): void => {
      input.output.writeStdout(formatStatusLineCurrentSnapshot(getStatusLineConfig()));
    };
    if (!process.stdin.isTTY) {
      input.output.writeStdout(
        [
          "● 状态栏操作",
          "- /status current                       查看当前状态栏配置",
          "- /status theme <plain|nerd|ccline>     设置状态栏主题",
          "- /status layout <adaptive|full|compact> 设置状态栏布局模式",
          "- /status segment <id> <on|off>         开关状态段 (model/project/context/tokens/session)",
          "",
        ].join("\n"),
      );
      return;
    }
    const actionMenu = await withInputPaused(() =>
      runSelectMenu({
        title: "状态栏",
        subtitle: `会话: ${input.runtimeState.getSessionKey()}`,
        hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
        items: [
          {
            id: "current",
            label: "查看当前状态快照",
            description: "输出当前状态栏配置。",
          },
          {
            id: "theme",
            label: "设置状态主题",
            description: "选择主题: plain / ccline / nerd_font。",
          },
          {
            id: "layout",
            label: "设置状态布局",
            description: "选择布局模式: adaptive / full / compact。",
          },
          {
            id: "segment",
            label: "开关状态 segment",
            description: "启用或关闭 segment: model/project/context/tokens/session。",
          },
        ],
      }),
    );
    if (actionMenu.kind === "cancelled") {
      return;
    }
    if (actionMenu.item.id === "current") {
      showCurrent();
      return;
    }
    if (actionMenu.item.id === "theme") {
      const current = getStatusLineConfig().theme;
      const pickedTheme = await withInputPaused(() =>
        runSelectMenu({
          title: "状态主题",
          subtitle: `当前: ${current}`,
          hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
          items: [
            {
              id: "plain",
              label: "plain",
              description: "极简 ANSI 样式。",
              current: current === "plain",
            },
            {
              id: "ccline",
              label: "ccline",
              description: "Cometix 风格状态栏主题。",
              current: current === "ccline",
            },
            {
              id: "nerd_font",
              label: "nerd_font",
              description: "Nerd-font 字形增强主题。",
              current: current === "nerd_font",
            },
          ],
        }),
      );
      if (pickedTheme.kind === "cancelled") {
        return;
      }
      const theme = resolveStatusTheme(pickedTheme.item.id);
      if (!theme) {
        input.output.writeStdout("无效状态主题；用法: /status theme <plain|nerd|ccline>\n\n");
        return;
      }
      updateStatusLineConfig({ theme });
      input.output.writeStdout(buildCompactNotice("已更新状态栏主题", [
        `主题: ${theme}`,
      ]));
      return;
    }
    if (actionMenu.item.id === "layout") {
      const current = getStatusLineConfig().layoutMode;
      const pickedLayout = await withInputPaused(() =>
        runSelectMenu({
          title: "状态布局",
          subtitle: `当前: ${current}`,
          hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
          items: [
            {
              id: "adaptive",
              label: "adaptive",
              description: "根据终端宽度自动选择。",
              current: current === "adaptive",
            },
            {
              id: "full",
              label: "full",
              description: "始终显示完整状态细节。",
              current: current === "full",
            },
            {
              id: "compact",
              label: "compact",
              description: "使用紧凑状态栏布局。",
              current: current === "compact",
            },
          ],
        }),
      );
      if (pickedLayout.kind === "cancelled") {
        return;
      }
      const layoutMode = resolveStatusLayoutMode(pickedLayout.item.id);
      if (!layoutMode) {
        input.output.writeStdout("无效状态布局；用法: /status layout <adaptive|full|compact>\n\n");
        return;
      }
      updateStatusLineConfig({ layoutMode });
      input.output.writeStdout(buildCompactNotice("已更新状态栏布局", [
        `布局: ${layoutMode}`,
      ]));
      return;
    }
    const config = getStatusLineConfig();
    const pickedSegment = await withInputPaused(() =>
      runSelectMenu({
        title: "状态段",
        subtitle: "选择要调整的状态段",
        hint: "↑/↓ 选择 · Enter 继续 · Esc 返回",
        items: config.segmentOrder.map((segmentId) => ({
          id: segmentId,
          label: segmentId,
          description: `当前: ${config.segments[segmentId] ? "开启" : "关闭"}`,
        })),
      }),
    );
    if (pickedSegment.kind === "cancelled") {
      return;
    }
    const segmentId = normalizeStatusSegmentId(pickedSegment.item.id);
    if (!segmentId) {
      input.output.writeStdout(
        "无效状态段；用法: /status segment <model|project|context|tokens|session> <on|off>\n\n",
      );
      return;
    }
    const currentEnabled = getStatusLineConfig().segments[segmentId];
    const pickedState = await withInputPaused(() =>
      runSelectMenu({
        title: `状态段: ${segmentId}`,
        subtitle: `当前: ${currentEnabled ? "开启" : "关闭"}`,
        hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
        items: [
          {
            id: "on",
            label: "开启",
            description: "在状态栏中启用该段。",
            current: currentEnabled,
          },
          {
            id: "off",
            label: "关闭",
            description: "在状态栏中关闭该段。",
            current: !currentEnabled,
          },
        ],
      }),
    );
    if (pickedState.kind === "cancelled") {
      return;
    }
    const enabled = pickedState.item.id === "on";
    updateStatusLineConfig({
      segments: {
        [segmentId]: enabled,
      },
    });
    input.output.writeStdout(
      buildCompactNotice("已更新状态栏状态段", [
        `状态段: ${segmentId}`,
        `状态: ${enabled ? "已开启" : "已关闭"}`,
      ]),
    );
  };

  const showHistory = async (queryRaw?: string): Promise<void> => {
    const query = (queryRaw ?? "").trim().toLowerCase();
    const allRows = input.runtimeState.getHistoryMessages();
    if (allRows.length === 0) {
      input.output.writeStdout(buildCompactNotice("对话历史", [
        "暂无对话历史。",
      ]));
      return;
    }
    const filteredRows = query.length > 0
      ? allRows.filter((row) => row.content.toLowerCase().includes(query))
      : allRows;
    const windowSize = 20;
    const renderRows = filteredRows.slice(-windowSize);
    const lines: string[] = [
      "● 对话历史",
      `  总数: ${String(allRows.length)}`,
      `  匹配: ${String(filteredRows.length)}`,
      `  查询: ${query.length > 0 ? query : "无"}`,
      `  显示最近: ${String(renderRows.length)}`,
    ];
    if (renderRows.length === 0) {
      lines.push("  没有匹配记录。");
      lines.push("");
      input.output.writeStdout(`${lines.join("\n")}\n`);
      return;
    }
    for (const row of renderRows) {
      const role = row.role === "assistant" ? "助手" : "用户";
      lines.push(`- ${role}: ${compactSingleLine(row.content, 220)}`);
    }
    lines.push("");
    input.output.writeStdout(`${lines.join("\n")}\n`);
  };

  const showContextStatus = (): void => {
    const agentsInstructions = resolveAgentsInstructionBlock({
      projectRoot: input.projectRoot,
      workDir: input.workDir,
    });
    const modelSnapshot = getModelSnapshot();
    const cachedModelWindow = input.modelOps.getCachedModelContextWindowTokens(modelSnapshot.model);
    const effectiveWindow = typeof cachedModelWindow === "number"
      ? cachedModelWindow
      : input.contextEngineConfig.contextWindowTokens;
    input.output.writeStdout(
      [
        "● 上下文",
        "  定义: 本轮发送前组装的有界上下文窗口",
        "  系统提示: SYSTEM.md 内置",
        `  上下文引擎: ${input.contextEngineConfig.enabled ? "开启" : "关闭"} · profile ${input.contextEngineConfig.profile}`,
        `  上下文窗口 tokens: ${typeof effectiveWindow === "number" ? String(effectiveWindow) : "未知"}`,
        `  自动压缩阈值: ${typeof input.contextEngineConfig.autoCompactTokenLimit === "number" ? String(input.contextEngineConfig.autoCompactTokenLimit) : "auto"}`,
        `  历史消息: ${String(input.runtimeState.getHistoryMessages().length)}`,
        `  项目指令来源: ${agentsInstructions.sources.length > 0 ? agentsInstructions.sources.join(",") : "无"}`,
        "  关系: memory 是可检索素材，不等同于当前上下文窗口",
        "",
      ].join("\n"),
    );
  };

  const showMemoryStatus = (): void => {
    const policy = input.memoryOrchestrator.policySnapshot();
    const sessionKey = input.runtimeState.getSessionKey();
    const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
    input.output.writeStdout(
      [
        "● 记忆",
        "  定义: 跨回合/会话/项目的持久记忆层",
        `  记忆编排: ${policy.enabled ? "开启" : "关闭"} · version ${policy.version} · 预算比例 ${policy.injectBudgetRatio.toFixed(2)} · 单段上限 ${String(policy.maxSectionTokens)} · GA 行 ${String(policy.maxGaMemoryRows)} · 团队行 ${String(policy.maxTeamExperienceRows)} · 团队最低分 ${policy.minTeamExperienceScore.toFixed(2)}`,
        `  衰减: ${policy.decayEnabled ? "开启" : "关闭"} · 最大行 ${String(policy.decayMaxRowsPerSession)} · 最小保留 ${String(policy.decayMinRowsToKeep)}`,
        `  GA 状态: 记忆行 ${String(gaState?.memory.length ?? 0)} · skill 卡 ${String(gaState?.skillCards.length ?? 0)} · 反思 ${String(gaState?.reflectionQueue.length ?? 0)} · 待处理询问 ${String(gaState?.pendingAskQueue?.length ?? 0)}`,
        "  关系: memory 是持久素材，只有被选中的片段会进入当前上下文窗口",
        "",
      ].join("\n"),
    );
  };

  const showSkillsStatus = (): void => {
    const projectSkillsDir = `${trimTrailingSlashes(input.projectRoot)}/.grobot/skills`;
    const globalSkillsDir = `${trimTrailingSlashes(input.homeDir)}/skills`;
    const projectStatus = readSkillDirectoryStatus(projectSkillsDir);
    const globalStatus = readSkillDirectoryStatus(globalSkillsDir);
    input.output.writeStdout(
      [
        "● Skills",
        ...formatSkillDirectoryStatusLines("项目", projectStatus).map((line) => `  ${line}`),
        ...formatSkillDirectoryStatusLines("全局", globalStatus).map((line) => `  ${line}`),
        "  提示: 使用 /skill-creator <需求> 创建或更新 skill",
        "  提示: 使用 /commands 管理可复用本地命令模板",
        "",
      ].join("\n"),
    );
  };

  const showMcpStatus = (): void => {
    const hasInstructionPack = (input.mcpInstructionPromptPrefix?.trim() ?? "").length > 0;
    const serverNames = input.mcpInstructionServerNames.length > 0
      ? input.mcpInstructionServerNames.join(",")
      : "无";
    input.output.writeStdout(
      [
        "● MCP",
        `  服务: ${serverNames}`,
        `  指令包: ${hasInstructionPack ? "已加载" : "无"}`,
        `  严格失败: ${input.mcpInstructionStrictFailure ?? "无"}`,
        "  显式调用: mcp_call(server, tool)",
        "  路由提示: /health 查看 provider failover；启动诊断会显示 MCP 指令注入",
        "",
      ].join("\n"),
    );
  };

  const openHistorySearch = async (historyInput: {
    currentInput: string;
  }): Promise<string | undefined> => {
    if (!process.stdin.isTTY) {
      return undefined;
    }
    const rows = input.runtimeState.getHistoryMessages();
    const candidates = buildHistorySearchCandidates(rows);
    if (candidates.length === 0) {
      input.output.writeStdout(buildCompactNotice("对话历史", [
        "暂无对话历史。",
      ]));
      return undefined;
    }
    const query = compactSingleLine(historyInput.currentInput, 120).trim();
    const filtered = filterHistorySearchCandidates(candidates, query);
    const effectiveCandidates = filtered.length > 0 ? filtered : candidates;
    const picked = await runSelectMenu({
      title: "历史搜索 (Ctrl+R)",
      subtitle: query.length >= 2
        ? filtered.length > 0
          ? `查询: ${compactSingleLine(query, 60)} · 匹配: ${String(filtered.length)}`
          : `查询: ${compactSingleLine(query, 60)} · 无精确匹配，显示最近历史`
        : "最近的 prompts 和回复",
      hint: "↑/↓ 选择 · Enter 填入 · Esc 返回",
      items: effectiveCandidates
        .slice(0, 30)
        .map((candidate) => ({
          id: candidate.id,
          label: compactSingleLine(candidate.content, 120),
          description: `${candidate.role === "user" ? "用户" : "助手"} · ${compactSingleLine(candidate.content, 240)}`,
        })),
      initialIndex: 0,
    });
    if (picked.kind === "cancelled") {
      return undefined;
    }
    const selected = effectiveCandidates[picked.index];
    if (!selected) {
      return undefined;
    }
    return selected.content;
  };

  const purgeExpiredPendingAsk = (notify: boolean): number => {
    const sessionKey = input.runtimeState.getSessionKey();
    const expired = input.gaMechanismRuntime.purgeExpiredPendingAsk(sessionKey);
    if (notify && expired.length > 0) {
      input.output.writeStdout(
        `已移除 ${String(expired.length)} 个过期待确认问题。\n\n`,
      );
    }
    return expired.length;
  };

  const resolveDefaultAskAnswer = (value: string | undefined): string | undefined => {
    const raw = String(value ?? "").trim();
    if (!raw || /^none$/i.test(raw)) {
      return undefined;
    }
    return raw;
  };

  const getPendingAskPromptSummary = (): string | undefined => {
    purgeExpiredPendingAsk(false);
    const sessionKey = input.runtimeState.getSessionKey();
    const active = input.gaMechanismRuntime.getPendingAsk(sessionKey);
    if (!active) {
      return undefined;
    }
    return buildAskUserPendingSummary(active);
  };

  const selectPendingAskAnswer = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<string | undefined> => {
    purgeExpiredPendingAsk(true);
    const sessionKey = input.runtimeState.getSessionKey();
    const active = input.gaMechanismRuntime.getPendingAsk(sessionKey);
    if (!active) {
      input.output.writeStdout("没有待确认问题。\n\n");
      return undefined;
    }
    const queue = input.gaMechanismRuntime.listPendingAsk(sessionKey);
    const questionnaireState = createAskUserQuestionnaireState();
    if (!process.stdin.isTTY) {
      input.output.writeStdout(buildAskUserQueueDisplay({
        queue: queue.length > 0 ? queue : [active],
        state: questionnaireState,
      }));
      return undefined;
    }
    const effectiveQueue = queue.length > 0 ? queue : [active];
    const result = await withInputPaused(() =>
      runAskUserQuestionnairePanel({
        queue: effectiveQueue,
        planMode: input.planMode.isPlanMode(),
        planFilePath: formatPlanPathForPanel(input.workDir, input.planMode.getActivePlanPath()),
      }),
    );
    if (result.kind !== "submitted") {
      return undefined;
    }
    return result.text.trim().length > 0 ? result.text : undefined;
  };

  const showPendingAskQueue = (limit?: number): void => {
    void limit;
    purgeExpiredPendingAsk(true);
    const sessionKey = input.runtimeState.getSessionKey();
    const queue = input.gaMechanismRuntime.listPendingAsk(sessionKey);
    if (queue.length === 0) {
      input.output.writeStdout("没有待确认问题。\n\n");
      return;
    }
    const active = queue[0];
    if (!active) {
      input.output.writeStdout("没有待确认问题。\n\n");
      return;
    }
    const defaultAnswer = resolveDefaultAskAnswer(active.defaultOnTimeout);
    const lines: string[] = [buildAskUserQueueDisplay({
      queue,
      state: createAskUserQuestionnaireState(),
    }).trimEnd()];
    if (!lines[0]?.includes("待确认：")) {
      lines.push(`  待确认：${String(queue.length)} 项`);
    }
    if (defaultAnswer && !lines[0]?.includes("默认：")) {
      lines.push(`  默认：${compactSingleLine(defaultAnswer, 120)}`);
    }
    lines.push("");
    input.output.writeStdout(`${lines.join("\n")}\n`);
  };

  const sessionTopicCache: {
    sessionId: string;
    topic: string | undefined;
    resolvedAtMs: number;
  } = {
    sessionId: "",
    topic: undefined,
    resolvedAtMs: 0,
  };

  const refreshSessionTopic = (sessionId: string): string | undefined => {
    const topic = resolveSessionTopicBySessionId({
      wire: input.wire,
      sessionId,
    });
    sessionTopicCache.sessionId = sessionId;
    sessionTopicCache.topic = topic;
    sessionTopicCache.resolvedAtMs = Date.now();
    return topic;
  };

  const getActiveSessionTopic = (): string | undefined => {
    const activeSessionId = input.runtimeState.getActiveSessionId();
    const ttlMs = getStatusLineConfig().sessionTopicCacheTtlMs;
    const now = Date.now();
    if (
      sessionTopicCache.sessionId === activeSessionId
      && now - sessionTopicCache.resolvedAtMs <= ttlMs
    ) {
      return sessionTopicCache.topic;
    }
    return refreshSessionTopic(activeSessionId);
  };

  const getPlanSuggestionState = (): RunStartPlanSuggestionState | undefined => {
    const planMeta = input.runtimeState.getPlanMeta();
    return resolveRunStartPlanSuggestionState({
      workDir: input.workDir,
      sessionId: input.runtimeState.getSessionKey(),
      mode: input.planMode.isPlanMode() ? "plan_only" : "normal",
      persistedActivePlanStatus: planMeta?.active_plan_status,
      persistedActivePlanPhase: planMeta?.active_plan_phase,
      persistedActivePlanPath: planMeta?.active_plan_path,
    });
  };

  return {
    homeDir: input.homeDir,
    projectRoot: input.projectRoot,
    projectName: input.projectName,
    workDir: input.workDir,
    sessionKey: input.runtimeState.getSessionKey(),
    sessionNamespaceKey: input.sessionNamespaceKey,
    activeSessionId: input.runtimeState.getActiveSessionId(),
    sessionStoreRuntime: input.sessionStoreRuntime,
    sessionRegistryFilePathValue: input.sessionRegistryFilePathValue,
    handoffAutoOnExit: input.handoffAutoOnExit,
    handoffRecentTurns: input.handoffRecentTurns,
    handoffPath: input.handoffPath,
    contextWindowTokens: input.contextWindowTokens,
    interactiveDiagnosticsEnabled: input.interactiveDiagnosticsEnabled,
    interactiveDiagnosticsMode: input.interactiveDiagnosticsMode,
    restoredTurns: input.runtimeState.getRestoredTurns(),
    restoreSource: input.runtimeState.getRestoreSource(),
    buildHelpText: input.buildHelpText,
    hasPendingAsk: () =>
      input.gaMechanismRuntime.getPendingAskQueueSize(
        input.runtimeState.getSessionKey(),
      ) > 0,
    getPendingAskQueueSize: () =>
      input.gaMechanismRuntime.getPendingAskQueueSize(
        input.runtimeState.getSessionKey(),
      ),
    getPendingAskPromptSummary,
    selectPendingAskAnswer,
    showPendingAskQueue,
    showContextStatus,
    showMemoryStatus,
    showSkillsStatus,
    showMcpStatus,
    showHealthStatus: () => {
      input.output.writeStdout(
        formatProviderHealthSnapshot({
          sessionKey: input.runtimeState.getSessionKey(),
          stickyProvider: input.runtimeState.getStickyProvider(),
          failureThreshold: input.runtimeFailoverConfig.circuitFailures,
          cooldownSecs: input.runtimeFailoverConfig.circuitCooldownSecs,
          providers: input.runtimeProviderChain.map((provider) => ({
            name: provider.name,
            maxInFlight: provider.maxInFlight,
            requestsPerMinute: provider.requestsPerMinute,
            burst: provider.burst,
          })),
          states: input.runtimeState.getProviderRuntimeStates(),
        }),
      );
    },
    getCachedModelContextWindowTokens: input.modelOps.getCachedModelContextWindowTokens,
    refreshModelCatalogCache: input.modelOps.refreshModelCatalogCache,
    openModelMenu: input.modelOps.openModelMenu,
    openSessionMenu: input.sessionMenuOps.openSessionMenu,
    createNewSession: input.wire.sessionOps.createNewSession,
    switchActiveSession: async (targetSessionId, reason) => {
      const switched = await input.wire.sessionOps.switchActiveSession(
        targetSessionId,
        reason,
      );
      if (switched) {
        input.modelOps.applyModelOverrideForActiveSession();
        refreshSessionTopic(targetSessionId);
      }
      return switched;
    },
    continueFromSession: input.wire.sessionOps.continueFromSession,
    writeManualHandoff: () => {
      input.wire.handoff.writeHandoff("manual-command", false);
    },
    isPlanMode: input.planMode.isPlanMode,
    getPlanSuggestionState,
    showPlanStatus: input.planMode.showPlanStatus,
    enterPlan: input.planMode.enterPlan,
    applyPlan: input.planMode.applyPlan,
    cancelPlan: input.planMode.cancelPlan,
    requestPlanInterrupt: async (source) => {
      await input.planMode.requestPlanInterrupt(source);
    },
    requestRuntimeInterrupt: async (source) => {
      input.requestRuntimeInterrupt(source);
    },
    runPlanTurn: input.planMode.runPlanTurn,
    handleUserCommandsCommand: userCommandsRuntime.handleManagementCommand,
    openCommandsMenu: userCommandsRuntime.openManagementMenu,
    openPlanInEditor,
    showHistory,
    openHistorySearch,
    promptSkillCreatorRequirement: async (withInputPaused) => {
      const requirementInput = await withInputPaused(() =>
        runTerminalLinePrompt({
          prompt: "技能需求> ",
        }),
      );
      if (requirementInput.kind === "cancelled") {
        input.output.writeStdout(buildSkillCreatorSurface({
          title: "已取消 skill 创建",
        }));
        return undefined;
      }
      const requirement = requirementInput.value.trim();
      if (!requirement) {
        input.output.writeStdout(buildSkillCreatorSurface({
          title: "需求为空，已取消 skill 创建",
        }));
        return undefined;
      }
      return requirement;
    },
    runSkillCreator: async (
      requirement,
      options,
    ) => {
      const normalizedRequirement = requirement.trim();
      if (!normalizedRequirement) {
        input.output.writeStdout(buildSkillCreatorSurface({
          title: "需要提供技能需求",
          details: ["用法: /skill-creator [需求]"],
        }));
        return;
      }
      input.output.writeStdout(
        buildSkillCreatorSurface({
          title: "正在生成技能",
          details: [compactSingleLine(normalizedRequirement, 120)],
        }),
      );
      const prompt = buildSkillCreatorPrompt({
        requirement: normalizedRequirement,
        projectRoot: input.projectRoot,
        homeDir: input.homeDir,
      });
      const code = await input.executeTurn(prompt, true, {
        writeStderr: options?.writeStderr,
      });
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
    },
    runInitProjectInstructions: async (options) => {
      const targetPath = `${trimTrailingSlashes(input.projectRoot)}/AGENTS.md`;
      if (existsSync(targetPath)) {
        input.output.writeStdout(
          [
            `${terminalStyle.accent("●")} AGENTS.md 已存在`,
            `  ${terminalStyle.muted(`已跳过 /init，避免覆盖: ${targetPath}`)}`,
            "",
            "",
          ].join("\n"),
        );
        return;
      }
      input.output.writeStdout(
        [
          `${terminalStyle.accent("●")} 正在生成项目指令`,
          `  ${terminalStyle.muted(targetPath)}`,
          "",
          "",
        ].join("\n"),
      );
      const prompt = buildAgentsInitPrompt({
        targetPath,
        projectRoot: input.projectRoot,
        workDir: input.workDir,
      });
      const code = await input.executeTurn(prompt, true, {
        writeStderr: options?.writeStderr,
      });
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
    },
    tryRunUserCommand: userCommandsRuntime.tryRunUserCommand,
    executeTurn: input.executeTurn,
    markFailureObserved: input.runtimeState.markFailureObserved,
    getHistoryMessagesCount: () => input.runtimeState.getHistoryMessages().length,
    writeAutoExitHandoffIfNeeded: () => {
      input.wire.handoff.writeAutoExitHandoffIfNeeded(false);
    },
    getActiveSessionId: input.runtimeState.getActiveSessionId,
    listRewindCheckpoints: input.wire.sessionOps.listRewindCheckpoints,
    rewindSession: input.wire.sessionOps.rewindSession,
    getActiveSessionTopic,
    getModelSnapshot,
    getStatusLineConfig,
    listSessionSummaries: input.wire.sessionOps.listSessions,
    showStatusCurrent: () => {
      input.output.writeStdout(formatStatusLineCurrentSnapshot(getStatusLineConfig()));
    },
    setStatusTheme: (rawTheme) => {
      const theme = resolveStatusTheme(rawTheme);
      if (!theme) {
        input.output.writeStdout(
          "无效状态主题；用法: /status theme <plain|nerd|ccline>\n\n",
        );
        return;
      }
      updateStatusLineConfig({ theme });
      input.output.writeStdout(buildCompactNotice("已更新状态栏主题", [
        `主题: ${theme}`,
      ]));
    },
    setStatusLayoutMode: (rawLayoutMode) => {
      const layoutMode = resolveStatusLayoutMode(rawLayoutMode);
      if (!layoutMode) {
        input.output.writeStdout(
          "无效状态布局；用法: /status layout <adaptive|full|compact>\n\n",
        );
        return;
      }
      updateStatusLineConfig({ layoutMode });
      input.output.writeStdout(buildCompactNotice("已更新状态栏布局", [
        `布局: ${layoutMode}`,
      ]));
    },
    setStatusSegmentEnabled: (rawSegmentId, enabled) => {
      const segmentId = normalizeStatusSegmentId(rawSegmentId);
      if (!segmentId) {
        input.output.writeStdout(
          "无效状态段；用法: /status segment <model|project|context|tokens|session> <on|off>\n\n",
        );
        return;
      }
      updateStatusLineConfig({
        segments: {
          [segmentId]: enabled,
        },
      });
      input.output.writeStdout(
        buildCompactNotice("已更新状态栏状态段", [
          `状态段: ${segmentId}`,
          `状态: ${enabled ? "已开启" : "已关闭"}`,
        ]),
      );
    },
    openStatusMenu,
  };
}
