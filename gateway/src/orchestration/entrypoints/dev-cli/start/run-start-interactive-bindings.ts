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
    .map((segmentId) => `${segmentId}=${config.segments[segmentId] ? "on" : "off"}`)
    .join(", ");
  return [
    "[status]",
    `enabled: ${config.enabled ? "on" : "off"}`,
    `layout_mode: ${config.layoutMode}`,
    `theme: ${config.theme}`,
    `separator: ${JSON.stringify(config.separator)}`,
    `segments: ${segmentText}`,
    `warning_threshold: ${String(Math.round(config.warningThresholdRatio * 100))}%`,
    `critical_threshold: ${String(Math.round(config.criticalThresholdRatio * 100))}%`,
    `budget_snapshot_cache_ttl_ms: ${String(config.budgetSnapshotCacheTtlMs)}`,
    `session_topic_cache_ttl_ms: ${String(config.sessionTopicCacheTtlMs)}`,
    `session_topic_max_width: ${String(config.sessionTopicMaxWidth)}`,
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

function formatSkillDirectoryStatus(label: string, status: SkillDirectoryStatus): string {
  return `${label}: path=${status.path} exists=${status.exists ? "yes" : "no"} skills=${String(status.skillCount)} invalid_dirs=${String(status.invalidDirectoryCount)}`;
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
      input.output.writeStdout("当前没有活跃计划文件。请先使用 /plan <goal>。\n\n");
      return;
    }
    const displayPath = formatPlanPathForPanel(input.workDir, planPath) ?? planPath;
    const openOperation = async (): Promise<void> => {
      const launched = launchPlanFileInEditor(planPath);
      if (!launched.ok) {
        input.output.writeStdout(
          `Failed to open plan in editor: ${compactSingleLine(launched.detail, 200)}\n\n`,
        );
        return;
      }
      if (options?.suppressOpenPlanEditorNotice) {
        return;
      }
      input.output.writeStdout(`Opened plan in editor: ${displayPath}\n\n`);
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
          "[status] action menu",
          "- /status current                       Show current status line config",
          "- /status theme <plain|nerd|ccline>     Set status line theme",
          "- /status layout <adaptive|full|compact> Set status line layout mode",
          "- /status segment <id> <on|off>         Toggle segment (model/project/context/tokens/session)",
          "",
        ].join("\n"),
      );
      return;
    }
    const actionMenu = await withInputPaused(() =>
      runSelectMenu({
        title: "Status Line",
        subtitle: `Session: ${input.runtimeState.getSessionKey()}`,
        hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
        items: [
          {
            id: "current",
            label: "Show current status snapshot",
            description: "Print current status line configuration.",
          },
          {
            id: "theme",
            label: "Set status theme",
            description: "Choose theme: plain / ccline / nerd_font.",
          },
          {
            id: "layout",
            label: "Set status layout",
            description: "Choose layout mode: adaptive / full / compact.",
          },
          {
            id: "segment",
            label: "Toggle status segment",
            description: "Enable or disable segment: model/project/context/tokens/session.",
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
          title: "Status Theme",
          subtitle: `Current: ${current}`,
          hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
          items: [
            {
              id: "plain",
              label: "plain",
              description: "Minimal ANSI style.",
              current: current === "plain",
            },
            {
              id: "ccline",
              label: "ccline",
              description: "Cometix-style status line theme.",
              current: current === "ccline",
            },
            {
              id: "nerd_font",
              label: "nerd_font",
              description: "Nerd-font glyph enhanced theme.",
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
        input.output.writeStdout("invalid status theme; usage: /status theme <plain|nerd|ccline>\n\n");
        return;
      }
      updateStatusLineConfig({ theme });
      input.output.writeStdout(`[status] theme set to ${theme}\n\n`);
      return;
    }
    if (actionMenu.item.id === "layout") {
      const current = getStatusLineConfig().layoutMode;
      const pickedLayout = await withInputPaused(() =>
        runSelectMenu({
          title: "Status Layout",
          subtitle: `Current: ${current}`,
          hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
          items: [
            {
              id: "adaptive",
              label: "adaptive",
              description: "Auto-choose based on terminal width.",
              current: current === "adaptive",
            },
            {
              id: "full",
              label: "full",
              description: "Always render full status detail.",
              current: current === "full",
            },
            {
              id: "compact",
              label: "compact",
              description: "Use compact status line layout.",
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
        input.output.writeStdout("invalid status layout; usage: /status layout <adaptive|full|compact>\n\n");
        return;
      }
      updateStatusLineConfig({ layoutMode });
      input.output.writeStdout(`[status] layout_mode set to ${layoutMode}\n\n`);
      return;
    }
    const config = getStatusLineConfig();
    const pickedSegment = await withInputPaused(() =>
      runSelectMenu({
        title: "Status Segment",
        subtitle: "Select segment to change",
        hint: "↑/↓ 选择 · Enter 继续 · Esc 返回",
        items: config.segmentOrder.map((segmentId) => ({
          id: segmentId,
          label: segmentId,
          description: `Current: ${config.segments[segmentId] ? "on" : "off"}`,
        })),
      }),
    );
    if (pickedSegment.kind === "cancelled") {
      return;
    }
    const segmentId = normalizeStatusSegmentId(pickedSegment.item.id);
    if (!segmentId) {
      input.output.writeStdout(
        "invalid status segment; usage: /status segment <model|project|context|tokens|session> <on|off>\n\n",
      );
      return;
    }
    const currentEnabled = getStatusLineConfig().segments[segmentId];
    const pickedState = await withInputPaused(() =>
      runSelectMenu({
        title: `Status Segment: ${segmentId}`,
        subtitle: `Current: ${currentEnabled ? "on" : "off"}`,
        hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
        items: [
          {
            id: "on",
            label: "on",
            description: "Enable segment in status line.",
            current: currentEnabled,
          },
          {
            id: "off",
            label: "off",
            description: "Disable segment in status line.",
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
      `[status] segment ${segmentId} ${enabled ? "on" : "off"}\n\n`,
    );
  };

  const showHistory = async (queryRaw?: string): Promise<void> => {
    const query = (queryRaw ?? "").trim().toLowerCase();
    const allRows = input.runtimeState.getHistoryMessages();
    if (allRows.length === 0) {
      input.output.writeStdout("[history] no conversation history yet.\n\n");
      return;
    }
    const filteredRows = query.length > 0
      ? allRows.filter((row) => row.content.toLowerCase().includes(query))
      : allRows;
    const windowSize = 20;
    const renderRows = filteredRows.slice(-windowSize);
    const lines: string[] = [
      "[history]",
      `total: ${String(allRows.length)}`,
      `matched: ${String(filteredRows.length)}`,
      `query: ${query.length > 0 ? query : "<none>"}`,
      `showing_last: ${String(renderRows.length)}`,
    ];
    if (renderRows.length === 0) {
      lines.push("- no matched rows");
      lines.push("");
      input.output.writeStdout(`${lines.join("\n")}\n`);
      return;
    }
    for (const row of renderRows) {
      const role = row.role === "assistant" ? "assistant" : "user";
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
        "[context]",
        "definition: current bounded prompt window assembled for this turn",
        "system_prompt: SYSTEM.md built-in",
        `context_engine: ${input.contextEngineConfig.enabled ? "on" : "off"} profile=${input.contextEngineConfig.profile}`,
        `context_window_tokens: ${typeof effectiveWindow === "number" ? String(effectiveWindow) : "unknown"}`,
        `auto_compact_limit: ${typeof input.contextEngineConfig.autoCompactTokenLimit === "number" ? String(input.contextEngineConfig.autoCompactTokenLimit) : "auto"}`,
        `history_messages: ${String(input.runtimeState.getHistoryMessages().length)}`,
        `project_instruction_sources: ${agentsInstructions.sources.length > 0 ? agentsInstructions.sources.join(",") : "<none>"}`,
        "memory_relation: memory may be retrieved and injected into context; it is not the same layer",
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
        "[memory]",
        "definition: durable cross-turn/session/project recall layer",
        `memory_orchestrator: ${policy.enabled ? "on" : "off"} version=${policy.version} budget_ratio=${policy.injectBudgetRatio.toFixed(2)} section_max=${String(policy.maxSectionTokens)} ga_rows=${String(policy.maxGaMemoryRows)} team_rows=${String(policy.maxTeamExperienceRows)} team_score_min=${policy.minTeamExperienceScore.toFixed(2)}`,
        `decay: ${policy.decayEnabled ? "on" : "off"} max_rows=${String(policy.decayMaxRowsPerSession)} min_keep=${String(policy.decayMinRowsToKeep)}`,
        `ga_state: memory_rows=${String(gaState?.memory.length ?? 0)} skill_cards=${String(gaState?.skillCards.length ?? 0)} reflections=${String(gaState?.reflectionQueue.length ?? 0)} pending_ask=${String(gaState?.pendingAskQueue?.length ?? 0)}`,
        "context_relation: memory is durable source material; only selected memory snippets enter the current context window",
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
        "[skills]",
        formatSkillDirectoryStatus("project", projectStatus),
        formatSkillDirectoryStatus("global", globalStatus),
        "tip: run /skill-creator <requirement> to create or update skills",
        "tip: use /commands to manage reusable local command templates",
        "",
      ].join("\n"),
    );
  };

  const showMcpStatus = (): void => {
    const hasInstructionPack = (input.mcpInstructionPromptPrefix?.trim() ?? "").length > 0;
    const serverNames = input.mcpInstructionServerNames.length > 0
      ? input.mcpInstructionServerNames.join(",")
      : "<none>";
    input.output.writeStdout(
      [
        "[mcp]",
        `servers: ${serverNames}`,
        `instruction_pack: ${hasInstructionPack ? "loaded" : "none"}`,
        `strict_failure: ${input.mcpInstructionStrictFailure ?? "<none>"}`,
        "explicit_call_hint: mcp_call(server=..., tool=...)",
        "route_hint: /health shows provider failover; startup diagnostics show MCP instruction injection",
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
      input.output.writeStdout("[history] no conversation history yet.\n\n");
      return undefined;
    }
    const query = compactSingleLine(historyInput.currentInput, 120).trim();
    const filtered = filterHistorySearchCandidates(candidates, query);
    const effectiveCandidates = filtered.length > 0 ? filtered : candidates;
    const picked = await runSelectMenu({
      title: "History Search (Ctrl+R)",
      subtitle: query.length >= 2
        ? filtered.length > 0
          ? `query: ${compactSingleLine(query, 60)} · matched: ${String(filtered.length)}`
          : `query: ${compactSingleLine(query, 60)} · no exact match, showing recent history`
        : "Recent prompts and replies",
      hint: "↑/↓ 选择 · Enter 填入 · Esc 返回",
      items: effectiveCandidates
        .slice(0, 30)
        .map((candidate) => ({
          id: candidate.id,
          label: compactSingleLine(candidate.content, 120),
          description: `${candidate.role === "user" ? "user" : "assistant"} · ${compactSingleLine(candidate.content, 240)}`,
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
          prompt: "[skill-creator] 请输入需求> ",
        }),
      );
      if (requirementInput.kind === "cancelled") {
        input.output.writeStdout("[skill-creator] 已取消。\n\n");
        return undefined;
      }
      const requirement = requirementInput.value.trim();
      if (!requirement) {
        input.output.writeStdout("[skill-creator] 需求为空，已取消。\n\n");
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
        input.output.writeStdout("usage: /skill-creator [需求]\n\n");
        return;
      }
      input.output.writeStdout(
        `[skill-creator] 正在根据需求生成技能：${compactSingleLine(normalizedRequirement, 120)}\n\n`,
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
          `[init] AGENTS.md already exists at ${targetPath}. Skipping /init to avoid overwriting it.\n\n`,
        );
        return;
      }
      input.output.writeStdout(`[init] generating project instructions: ${targetPath}\n\n`);
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
          "invalid status theme; usage: /status theme <plain|nerd|ccline>\n\n",
        );
        return;
      }
      updateStatusLineConfig({ theme });
      input.output.writeStdout(`[status] theme set to ${theme}\n\n`);
    },
    setStatusLayoutMode: (rawLayoutMode) => {
      const layoutMode = resolveStatusLayoutMode(rawLayoutMode);
      if (!layoutMode) {
        input.output.writeStdout(
          "invalid status layout; usage: /status layout <adaptive|full|compact>\n\n",
        );
        return;
      }
      updateStatusLineConfig({ layoutMode });
      input.output.writeStdout(`[status] layout_mode set to ${layoutMode}\n\n`);
    },
    setStatusSegmentEnabled: (rawSegmentId, enabled) => {
      const segmentId = normalizeStatusSegmentId(rawSegmentId);
      if (!segmentId) {
        input.output.writeStdout(
          "invalid status segment; usage: /status segment <model|project|context|tokens|session> <on|off>\n\n",
        );
        return;
      }
      updateStatusLineConfig({
        segments: {
          [segmentId]: enabled,
        },
      });
      input.output.writeStdout(
        `[status] segment ${segmentId} ${enabled ? "on" : "off"}\n\n`,
      );
    },
    openStatusMenu,
  };
}
