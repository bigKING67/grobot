import { type SessionStoreRuntime } from "../services/session-store";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type InteractiveDiagnosticsMode,
  type RunStartInteractiveModeInput,
} from "./run-start-interactive-mode";
import { type RuntimeAttachment } from "../../../../models/types";
import {
  type RunStartModelOps,
  type RunStartModelSnapshot,
} from "./run-start-model-ops";
import { type RunStartOutput } from "./run-start-output";
import {
  resolvePlanStatusRecommendationActionId,
  resolvePlanStatusRecommendation,
  resolvePlanStatusRecommendationCommand,
  type RunStartPlanMode,
} from "./run-start-plan-mode";
import {
  loadLatestPlanVerificationDiagnostic,
  loadPlanArtifactIndex,
  resolvePlanQualityBenchmarkPreset,
  type PlanQualityBenchmarkPresetCandidate,
} from "./plan-artifact";
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
  runTerminalLinePrompt,
  runTerminalSelectMenu,
} from "./run-start-io";
import { compactSingleLine, type ChatHistoryMessage } from "./session-history";
import { type GaMechanismRuntime } from "../services/ga-mechanism-runtime";
import { buildAskUserOptionsPreview } from "../../../../tools/ask-user";
import { type RunStartPlanSuggestionState } from "./run-start-slash-suggestions";

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
  interactiveDiagnosticsEnabled?: boolean;
  interactiveDiagnosticsMode?: InteractiveDiagnosticsMode;
  buildHelpText(): string;
  statusLineConfig?: StatusLineConfigInput;
  runtimeProviderChain: ReadonlyArray<RuntimeProviderCandidate>;
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeState: RunStartRuntimeState;
  gaMechanismRuntime: GaMechanismRuntime;
  output: Pick<RunStartOutput, "writeStdout">;
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
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
}

function formatAskAge(createdAt: string): string {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return "<unknown>";
  }
  const elapsedMs = Math.max(0, Date.now() - createdMs);
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h`;
  }
  const days = Math.floor(hours / 24);
  return `${String(days)}d`;
}

function isEnvTruthy(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return true;
}

const PLAN_SUGGESTION_STATE_CACHE_TTL_MS = 1_200;

function resolveLatestPlanEntryStatus(workDir: string, sessionKey: string): {
  status?: RunStartPlanSuggestionState["latestPlanStatus"];
  planId?: string;
} {
  const index = loadPlanArtifactIndex(workDir, sessionKey);
  if (index.entries.length <= 0) {
    return {};
  }
  const sorted = [...index.entries].sort((left, right) => {
    if (left.seq !== right.seq) {
      return right.seq - left.seq;
    }
    return right.updated_at.localeCompare(left.updated_at);
  });
  const latest = sorted[0];
  if (!latest) {
    return {};
  }
  return {
    status: latest.status,
    planId: latest.plan_id,
  };
}

const PLAN_MENU_TAIL_DEFAULT_ORDER = [
  "enter",
  "approve",
  "apply",
  "reject",
  "verify",
  "check",
  "benchmark",
  "cancel",
] as const;

interface PlanMenuActionInfo {
  id: string;
  label: string;
  command: string;
}

const PLAN_MENU_ACTION_INFO_BY_ID: Record<string, PlanMenuActionInfo> = {
  status: {
    id: "status",
    label: "Status summary",
    command: "/plan status",
  },
  open_file: {
    id: "open_file",
    label: "Open plan file",
    command: "/plan open",
  },
  enter: {
    id: "enter",
    label: "Create / refine plan",
    command: "/plan <goal>",
  },
  approve: {
    id: "approve",
    label: "Approve plan",
    command: "/plan approve [note]",
  },
  apply: {
    id: "apply",
    label: "Apply plan",
    command: "/plan apply [extra]",
  },
  reject: {
    id: "reject",
    label: "Reject plan",
    command: "/plan reject [reason]",
  },
  verify: {
    id: "verify",
    label: "Record verification",
    command: "/plan verify <pass|fail> [note]",
  },
  check: {
    id: "check",
    label: "Quick check",
    command: "/plan check",
  },
  benchmark: {
    id: "benchmark",
    label: "Benchmark plan",
    command: "/plan benchmark [label=path ...]",
  },
  cancel: {
    id: "cancel",
    label: "Exit plan mode",
    command: "/plan cancel",
  },
};

function resolvePlanMenuRecommendation(input: {
  planMode: boolean;
  state?: RunStartPlanSuggestionState;
}): {
  command: string;
  reason: string;
} {
  const recommendation = resolvePlanStatusRecommendation({
    mode: input.planMode ? "plan_only" : "normal",
    status: input.state?.activePlanStatus ?? input.state?.latestPlanStatus,
    latestVerificationStatus: input.state?.latestVerificationStatus,
    interactiveMenuFirst: true,
  });
  return {
    command: resolvePlanStatusRecommendationCommand(recommendation.action).trim(),
    reason: recommendation.reason,
  };
}

export function resolvePlanMenuTailItemOrder(input: {
  planMode?: boolean;
  state?: RunStartPlanSuggestionState;
}): string[] {
  const planMode = input.planMode ?? true;
  const recommendation = resolvePlanMenuRecommendation({
    planMode,
    state: input.state,
  });
  const recommendationId = resolvePlanStatusRecommendationActionId(recommendation.command);
  const activeStatus = input.state?.activePlanStatus;
  const latestStatus = input.state?.latestPlanStatus;
  const effectiveStatus = activeStatus ?? latestStatus;
  const verificationPending = input.state?.latestVerificationStatus === undefined
    || input.state?.latestVerificationStatus === "pending";
  let preferredOrder: readonly string[] = PLAN_MENU_TAIL_DEFAULT_ORDER;
  if (!activeStatus && (latestStatus === "applied" || latestStatus === "apply_failed") && verificationPending) {
    preferredOrder = ["verify", "enter", "check", "benchmark", "approve", "reject", "apply", "cancel"];
  } else if (
    effectiveStatus === "draft"
    || effectiveStatus === "blocked"
    || effectiveStatus === "review_failed"
  ) {
    preferredOrder = ["check", "approve", "reject", "enter", "benchmark", "apply", "verify", "cancel"];
  } else if (effectiveStatus === "ready") {
    preferredOrder = ["approve", "check", "reject", "apply", "enter", "benchmark", "verify", "cancel"];
  } else if (effectiveStatus === "approved") {
    preferredOrder = ["apply", "approve", "check", "reject", "benchmark", "enter", "verify", "cancel"];
  } else if (effectiveStatus === "applying") {
    preferredOrder = ["apply", "check", "benchmark", "enter", "approve", "reject", "verify", "cancel"];
  } else if (effectiveStatus === "apply_failed") {
    preferredOrder = verificationPending
      ? ["verify", "enter", "check", "benchmark", "approve", "reject", "apply", "cancel"]
      : ["enter", "check", "benchmark", "approve", "reject", "apply", "verify", "cancel"];
  } else if (effectiveStatus === "applied") {
    preferredOrder = verificationPending
      ? ["verify", "enter", "check", "benchmark", "approve", "reject", "apply", "cancel"]
      : ["enter", "check", "benchmark", "approve", "apply", "reject", "verify", "cancel"];
  } else if (effectiveStatus === "discarded") {
    preferredOrder = PLAN_MENU_TAIL_DEFAULT_ORDER;
  }

  const ordered: string[] = [];
  const appendUnique = (id: string): void => {
    if (ordered.includes(id)) {
      return;
    }
    ordered.push(id);
  };
  for (const id of preferredOrder) {
    appendUnique(id);
  }
  for (const id of PLAN_MENU_TAIL_DEFAULT_ORDER) {
    appendUnique(id);
  }
  if (
    recommendationId !== "unknown"
    && recommendationId !== "status"
    && recommendationId !== "open_file"
  ) {
    const index = ordered.indexOf(recommendationId);
    if (index > 0) {
      ordered.splice(index, 1);
      ordered.unshift(recommendationId);
    }
  }
  return ordered;
}

export function resolvePlanMenuInitialItemId(input: {
  planMode: boolean;
  state?: RunStartPlanSuggestionState;
}): string {
  const recommendation = resolvePlanMenuRecommendation({
    planMode: input.planMode,
    state: input.state,
  });
  const mapped = resolvePlanStatusRecommendationActionId(recommendation.command);
  if (mapped !== "unknown") {
    return mapped;
  }
  return input.planMode ? "status" : "enter";
}

export function resolvePlanMenuPrimaryAction(input: {
  planMode: boolean;
  state?: RunStartPlanSuggestionState;
}): PlanMenuActionInfo {
  const initialId = resolvePlanMenuInitialItemId({
    planMode: input.planMode,
    state: input.state,
  });
  const mapped = PLAN_MENU_ACTION_INFO_BY_ID[initialId];
  if (mapped) {
    return mapped;
  }
  return PLAN_MENU_ACTION_INFO_BY_ID.enter;
}

export function resolvePlanMenuPrimaryReason(input: {
  planMode: boolean;
  state?: RunStartPlanSuggestionState;
}): string {
  const recommendation = resolvePlanMenuRecommendation({
    planMode: input.planMode,
    state: input.state,
  });
  return recommendation.reason;
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

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatSpawnError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

function formatBenchmarkCandidateToken(input: PlanQualityBenchmarkPresetCandidate): string {
  const raw = `${input.label}=${input.path}`;
  if (!/\s/.test(raw)) {
    return raw;
  }
  return `"${raw}"`;
}

function formatBenchmarkCandidateSpec(
  candidates: readonly PlanQualityBenchmarkPresetCandidate[],
): string {
  if (candidates.length === 0) {
    return "";
  }
  return candidates.map((item) => formatBenchmarkCandidateToken(item)).join(" ");
}

function resolveBenchmarkPresetSpec(input: {
  workDir: string;
  presetRaw: string;
}): {
  candidateSpec: string;
  missingLabels: string[];
} {
  const preset = resolvePlanQualityBenchmarkPreset({
    workDir: input.workDir,
    presetRaw: input.presetRaw,
  });
  if (!preset) {
    return {
      candidateSpec: "",
      missingLabels: [],
    };
  }
  return {
    candidateSpec: formatBenchmarkCandidateSpec(preset.candidates),
    missingLabels: preset.missingLabels,
  };
}

function resolveManualBenchmarkTemplateSpec(workDir: string): string {
  const genericPlanPath = "/Users/gaoqian/Documents/sixseven/codeproject/GenericAgent/memory/plan_sop.md";
  if (!existsSync(genericPlanPath)) {
    return "";
  }
  return formatBenchmarkCandidateSpec([
    {
      label: "generic_agent",
      path: genericPlanPath,
    },
  ]);
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
  const userCommandsRuntime = createRunStartUserCommandsRuntime({
    homeDir: input.homeDir,
    writeStdout: input.output.writeStdout,
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
  ): Promise<void> => {
    const planPath = input.planMode.getActivePlanPath();
    if (!planPath) {
      input.output.writeStdout("[plan] no active plan file. use /plan <goal> first.\n\n");
      return;
    }
    const openOperation = async (): Promise<void> => {
      const launched = launchPlanFileInEditor(planPath);
      if (!launched.ok) {
        input.output.writeStdout(
          `[plan] failed to open active plan file: ${compactSingleLine(launched.detail, 200)}\n\n`,
        );
        return;
      }
      input.output.writeStdout(`[plan] opened active plan file: ${planPath}\n\n`);
    };
    if (!process.stdin.isTTY) {
      await openOperation();
      return;
    }
    await withInputPaused(openOperation);
  };

  const openPlanMenu = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
    options?: {
      writeStderr?: (message: string) => void;
    },
  ): Promise<void> => {
    const benchmarkPlan = async (commandRaw: string): Promise<void> => {
      const result = await input.planMode.handleMessageInput(commandRaw);
      if (!result.handled) {
        input.output.writeStdout("[plan] benchmark command was not handled.\n\n");
        return;
      }
      if (shouldMarkFailure(result.code)) {
        input.runtimeState.markFailureObserved();
      }
    };
    const planModeActive = input.planMode.isPlanMode();
    const planMenuState = getPlanSuggestionState();
    const planMenuPrimaryAction = resolvePlanMenuPrimaryAction({
      planMode: planModeActive,
      state: planMenuState,
    });
    const planMenuPrimaryReason = resolvePlanMenuPrimaryReason({
      planMode: planModeActive,
      state: planMenuState,
    });
    if (!process.stdin.isTTY) {
      input.output.writeStdout(
        [
          "[plan] action menu",
          `[plan] suggested now: ${planMenuPrimaryAction.command} · ${planMenuPrimaryReason}`,
          "- /plan               Open plan actions menu (interactive)",
          "- /plan open          Open active plan file in editor (interactive)",
          "- /plan <goal>        Enter plan mode and execute first requirement",
          "- /plan status        Show active plan status summary",
          "- /plan approve [note]",
          "- /plan reject [reason]",
          "- /plan verify <pass|fail> [note]",
          "- /plan apply [extra]",
          "- /plan cancel",
          "- /plan check [core|generic]  Quick benchmark check-only (default: core)",
          "- /plan benchmark [label=path ...] [--assert-best <label>] [--check-only]",
          "- /plan benchmark --preset <generic|core> [--assert-best <label>] [--check-only|--check]",
          "",
        ].join("\n"),
      );
      return;
    }
    const planMenuTailItems = [
      {
        id: "enter",
        label: "Create / refine plan",
        description: "Input goal and execute first requirement.",
      },
      {
        id: "approve",
        label: "Approve plan",
        description: "Review + approve current plan.",
      },
      {
        id: "apply",
        label: "Apply plan",
        description: "Apply approved plan with optional note.",
      },
      {
        id: "reject",
        label: "Reject plan",
        description: "Mark current plan rejected and continue refining.",
      },
      {
        id: "verify",
        label: "Record verification",
        description: "Record pass/fail for latest applied plan.",
      },
      {
        id: "check",
        label: "Quick check",
        description: "Choose core/generic preset and run check-only benchmark.",
      },
      {
        id: "benchmark",
        label: "Benchmark plan",
        description: "Compare active plan with external candidates.",
      },
      {
        id: "cancel",
        label: "Exit plan mode",
        description: "Return to normal mode.",
      },
    ].map((item) => ({
      ...item,
      description: item.id === planMenuPrimaryAction.id
        ? `Recommended now · ${item.description}`
        : item.description,
      current: item.id === planMenuPrimaryAction.id,
    }));
    const planMenuTailItemsById = new Map(
      planMenuTailItems.map((item) => [item.id, item] as const),
    );
    const planMenuTailOrder = resolvePlanMenuTailItemOrder({
      planMode: planModeActive,
      state: planMenuState,
    });
    const orderedPlanMenuTailItems = planMenuTailOrder
      .map((id) => planMenuTailItemsById.get(id))
      .filter((item): item is (typeof planMenuTailItems)[number] => Boolean(item));
    const planMenuItems = [
      {
        id: "status",
        label: "Status summary",
        description: planMenuPrimaryAction.id === "status"
          ? "Recommended now · Show current mode, quality and next action."
          : "Show current mode, quality and next action.",
        current: planMenuPrimaryAction.id === "status",
      },
      {
        id: "open_file",
        label: "Open plan file",
        description: planMenuPrimaryAction.id === "open_file"
          ? "Recommended now · Open active plan markdown in your editor."
          : "Open active plan markdown in your editor.",
        current: planMenuPrimaryAction.id === "open_file",
      },
      ...orderedPlanMenuTailItems,
    ];
    const planMenuInitialIndex = (() => {
      const index = planMenuItems.findIndex((item) => item.id === planMenuPrimaryAction.id);
      return index >= 0 ? index : 0;
    })();
    const picked = await withInputPaused(() =>
      runTerminalSelectMenu({
        title: "Plan Actions",
        subtitle: `Session: ${input.runtimeState.getSessionKey()} · Suggested: ${planMenuPrimaryAction.label} · ${planMenuPrimaryReason}`,
        hint: `Suggested: ${planMenuPrimaryAction.command} · ${planMenuPrimaryReason} Use ↑/↓ (or j/k, Ctrl+n/p), number to select directly, Enter/Space to confirm, Esc to cancel.`,
        items: planMenuItems,
        initialIndex: planMenuInitialIndex,
      }),
    );
    if (picked.kind === "cancelled") {
      input.output.writeStdout("[plan] menu cancelled.\n\n");
      return;
    }
    if (picked.item.id === "status") {
      const code = await input.planMode.showPlanStatus();
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
      return;
    }
    if (picked.item.id === "open_file") {
      await openPlanInEditor(withInputPaused);
      return;
    }
    if (picked.item.id === "cancel") {
      const code = await input.planMode.cancelPlan();
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
      return;
    }
    if (picked.item.id === "approve") {
      const approveNote = await withInputPaused(() =>
        runTerminalLinePrompt({
          prompt: "[plan] approve note (optional)> ",
        }),
      );
      if (approveNote.kind === "cancelled") {
        input.output.writeStdout("[plan] approve cancelled.\n\n");
        return;
      }
      const code = await input.planMode.approvePlan(approveNote.value.trim());
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
      return;
    }
    if (picked.item.id === "reject") {
      const rejectReason = await withInputPaused(() =>
        runTerminalLinePrompt({
          prompt: "[plan] reject reason (optional)> ",
        }),
      );
      if (rejectReason.kind === "cancelled") {
        input.output.writeStdout("[plan] reject cancelled.\n\n");
        return;
      }
      const code = await input.planMode.rejectPlan(rejectReason.value.trim());
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
      return;
    }
    if (picked.item.id === "verify") {
      const verifyResult = await withInputPaused(() =>
        runTerminalLinePrompt({
          prompt: "[plan] verify (pass|fail) [note]> ",
        }),
      );
      if (verifyResult.kind === "cancelled") {
        input.output.writeStdout("[plan] verify cancelled.\n\n");
        return;
      }
      const code = await input.planMode.verifyPlan(verifyResult.value.trim());
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
      return;
    }
    if (picked.item.id === "check") {
      const presetGeneric = resolveBenchmarkPresetSpec({
        workDir: input.workDir,
        presetRaw: "generic",
      });
      const presetCore = resolveBenchmarkPresetSpec({
        workDir: input.workDir,
        presetRaw: "core",
      });
      const quickCheckPreset = await withInputPaused(() =>
        runTerminalSelectMenu({
          title: "Plan Quick Check",
          subtitle: "Choose check-only preset",
          hint: "Enter/Space confirm · Esc cancel",
          items: [
            {
              id: "core",
              label: "Preset core",
              description: presetCore.missingLabels.length > 0
                ? `active + codex + claude + generic (missing: ${presetCore.missingLabels.join(",")})`
                : "active + codex + claude + generic",
              current: true,
            },
            {
              id: "generic",
              label: "Preset generic",
              description: presetGeneric.missingLabels.length > 0
                ? `active + GenericAgent (missing: ${presetGeneric.missingLabels.join(",")})`
                : "active + GenericAgent baseline",
            },
          ],
        }),
      );
      if (quickCheckPreset.kind === "cancelled") {
        input.output.writeStdout("[plan] quick check cancelled.\n\n");
        return;
      }
      await benchmarkPlan(
        quickCheckPreset.item.id === "generic"
          ? "/plan check generic"
          : "/plan check core",
      );
      return;
    }
    if (picked.item.id === "benchmark") {
      const presetGeneric = resolveBenchmarkPresetSpec({
        workDir: input.workDir,
        presetRaw: "generic",
      });
      const presetCore = resolveBenchmarkPresetSpec({
        workDir: input.workDir,
        presetRaw: "core",
      });
      const presetChoice = await withInputPaused(() =>
        runTerminalSelectMenu({
          title: "Plan Benchmark Preset",
          subtitle: "Pick a preset or run manual",
          hint: "Enter confirm · Esc cancel",
          items: [
            {
              id: "manual",
              label: "Manual candidate list",
              description: "Use custom label=path candidates.",
            },
            {
              id: "preset_generic",
              label: "Preset generic",
              description: presetGeneric.missingLabels.length > 0
                ? `active + GenericAgent (missing: ${presetGeneric.missingLabels.join(",")})`
                : "active + GenericAgent baseline",
            },
            {
              id: "preset_core",
              label: "Preset core",
              description: presetCore.missingLabels.length > 0
                ? `active + codex + claude + generic (missing: ${presetCore.missingLabels.join(",")})`
                : "active + codex + claude + generic",
            },
          ],
        }),
      );
      if (presetChoice.kind === "cancelled") {
        input.output.writeStdout("[plan] benchmark cancelled.\n\n");
        return;
      }
      let presetFlag = "";
      if (presetChoice.item.id === "preset_generic") {
        presetFlag = "--preset generic";
        input.output.writeStdout(
          presetGeneric.missingLabels.length > 0
            ? `[plan] benchmark preset: generic (missing: ${presetGeneric.missingLabels.join(",")})\n`
            : "[plan] benchmark preset: generic\n",
        );
      } else if (presetChoice.item.id === "preset_core") {
        presetFlag = "--preset core";
        input.output.writeStdout(
          presetCore.missingLabels.length > 0
            ? `[plan] benchmark preset: core (missing: ${presetCore.missingLabels.join(",")})\n`
            : "[plan] benchmark preset: core\n",
        );
      }
      const manualTemplateSpec = presetFlag
        ? ""
        : resolveManualBenchmarkTemplateSpec(input.workDir);
      const benchmarkCandidates = await withInputPaused(() =>
        runTerminalLinePrompt({
          prompt: presetFlag
            ? "[plan] benchmark extra label=path ... (optional)> "
            : manualTemplateSpec.length > 0
              ? "[plan] benchmark label=path ... (Enter=GenericAgent template)> "
              : "[plan] benchmark label=path ... (optional)> ",
        }),
      );
      if (benchmarkCandidates.kind === "cancelled") {
        input.output.writeStdout("[plan] benchmark cancelled.\n\n");
        return;
      }
      const benchmarkMode = await withInputPaused(() =>
        runTerminalSelectMenu({
          title: "Plan Benchmark Mode",
          subtitle: "Choose compare or check-only",
          hint: "Enter confirm · Esc cancel",
          items: [
            {
              id: "compare",
              label: "Compare scores",
              description: "Run full benchmark and output winner/rows.",
            },
            {
              id: "check_only",
              label: "Check only",
              description: "Validate benchmark guard without winner rows.",
            },
          ],
        }),
      );
      if (benchmarkMode.kind === "cancelled") {
        input.output.writeStdout("[plan] benchmark cancelled.\n\n");
        return;
      }
      const candidateSpecInput = benchmarkCandidates.value.trim();
      const candidateSpec = candidateSpecInput.length > 0
        ? candidateSpecInput
        : manualTemplateSpec;
      const checkOnly = benchmarkMode.item.id === "check_only";
      let assertBest = "";
      if (!checkOnly) {
        const benchmarkAssertBest = await withInputPaused(() =>
          runTerminalLinePrompt({
            prompt: "[plan] benchmark --assert-best <label> (optional)> ",
          }),
        );
        if (benchmarkAssertBest.kind === "cancelled") {
          input.output.writeStdout("[plan] benchmark cancelled.\n\n");
          return;
        }
        assertBest = benchmarkAssertBest.value.trim();
      }
      const command = [
        "/plan benchmark",
        presetFlag,
        candidateSpec,
        assertBest.length > 0 ? `--assert-best ${assertBest}` : "",
        checkOnly ? "--check-only" : "",
      ]
        .filter((item) => item.length > 0)
        .join(" ");
      await benchmarkPlan(command);
      return;
    }
    if (picked.item.id === "apply") {
      const applyExtra = await withInputPaused(() =>
        runTerminalLinePrompt({
          prompt: "[plan] apply extra (optional)> ",
        }),
      );
      if (applyExtra.kind === "cancelled") {
        input.output.writeStdout("[plan] apply cancelled.\n\n");
        return;
      }
      const code = await input.planMode.applyPlan(applyExtra.value.trim(), {
        writeStderr: options?.writeStderr,
      });
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
      return;
    }
    const goalInput = await withInputPaused(() =>
      runTerminalLinePrompt({
        prompt: "[plan] goal> ",
      }),
    );
    if (goalInput.kind === "cancelled") {
      input.output.writeStdout("[plan] create cancelled.\n\n");
      return;
    }
    const goal = goalInput.value.trim();
    if (goal.length === 0) {
      input.output.writeStdout("[plan] goal is empty, cancelled.\n\n");
      return;
    }
    const code = await input.planMode.enterPlan(goal, {
      writeStderr: options?.writeStderr,
    });
    if (shouldMarkFailure(code)) {
      input.runtimeState.markFailureObserved();
    }
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
      runTerminalSelectMenu({
        title: "Status Line",
        subtitle: `Session: ${input.runtimeState.getSessionKey()}`,
        hint: "Use ↑/↓ (or j/k, Ctrl+n/p), number to select directly, Enter/Space to confirm, Esc to cancel.",
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
      input.output.writeStdout("[status] menu cancelled.\n\n");
      return;
    }
    if (actionMenu.item.id === "current") {
      showCurrent();
      return;
    }
    if (actionMenu.item.id === "theme") {
      const current = getStatusLineConfig().theme;
      const pickedTheme = await withInputPaused(() =>
        runTerminalSelectMenu({
          title: "Status Theme",
          subtitle: `Current: ${current}`,
          hint: "Select theme, Enter/Space to apply, Esc to cancel.",
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
        input.output.writeStdout("[status] theme change cancelled.\n\n");
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
        runTerminalSelectMenu({
          title: "Status Layout",
          subtitle: `Current: ${current}`,
          hint: "Select layout, Enter/Space to apply, Esc to cancel.",
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
        input.output.writeStdout("[status] layout change cancelled.\n\n");
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
      runTerminalSelectMenu({
        title: "Status Segment",
        subtitle: "Select segment to change",
        hint: "Select segment, Enter/Space to continue, Esc to cancel.",
        items: config.segmentOrder.map((segmentId) => ({
          id: segmentId,
          label: segmentId,
          description: `Current: ${config.segments[segmentId] ? "on" : "off"}`,
        })),
      }),
    );
    if (pickedSegment.kind === "cancelled") {
      input.output.writeStdout("[status] segment selection cancelled.\n\n");
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
      runTerminalSelectMenu({
        title: `Status Segment: ${segmentId}`,
        subtitle: `Current: ${currentEnabled ? "on" : "off"}`,
        hint: "Select state, Enter/Space to apply, Esc to cancel.",
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
      input.output.writeStdout("[status] segment update cancelled.\n\n");
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
    const picked = await runTerminalSelectMenu({
      title: "History Search (Ctrl+R)",
      subtitle: query.length >= 2
        ? filtered.length > 0
          ? `query: ${compactSingleLine(query, 60)} · matched: ${String(filtered.length)}`
          : `query: ${compactSingleLine(query, 60)} · no exact match, showing recent history`
        : "Recent prompts and replies",
      hint: "Use ↑/↓ (or j/k, Ctrl+n/p), number to select directly, Enter/Space to fill input, Esc to cancel.",
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
        `[ask-user] removed ${String(expired.length)} expired pending question(s).\n\n`,
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
    const question = compactSingleLine(active.question, 96);
    const optionsPreview = buildAskUserOptionsPreview(active.options, 3).preview;
    const defaultAnswer = resolveDefaultAskAnswer(active.defaultOnTimeout);
    const parts = [`question=${question}`, `options=${optionsPreview}`];
    if (defaultAnswer) {
      parts.push(`default=${compactSingleLine(defaultAnswer, 32)}`);
    }
    return compactSingleLine(parts.join(" | "), 180);
  };

  const showPendingAskQueue = (limit?: number): void => {
    purgeExpiredPendingAsk(true);
    const sessionKey = input.runtimeState.getSessionKey();
    const queue = input.gaMechanismRuntime.listPendingAsk(sessionKey);
    if (queue.length === 0) {
      input.output.writeStdout("[ask-user] no pending question.\n\n");
      return;
    }
    const active = queue[0];
    if (!active) {
      input.output.writeStdout("[ask-user] no pending question.\n\n");
      return;
    }
    const total = queue.length;
    const optionsPreview = buildAskUserOptionsPreview(active.options, 5);
    const pendingFollowups = queue.slice(1);
    const queuePreviewLimit = typeof limit === "number"
      ? (limit < 0 ? pendingFollowups.length : Math.max(0, Math.floor(limit)))
      : 3;
    const queuedPreviewRows = queuePreviewLimit > 0
      ? pendingFollowups.slice(0, queuePreviewLimit)
      : [];
    const queuedHiddenCount = Math.max(0, pendingFollowups.length - queuedPreviewRows.length);
    const defaultAnswer = resolveDefaultAskAnswer(active.defaultOnTimeout);
    const renderCompactOutput = Boolean(process.stdin.isTTY) && !isEnvTruthy(process.env.GROBOT_ASK_STATUS_VERBOSE);
    if (renderCompactOutput) {
      const lines: string[] = [
        "[ask-user] active question",
        "ask_status_output_mode: compact",
        `age: ${formatAskAge(active.createdAt)}`,
        `question: ${compactSingleLine(active.question, 220)}`,
        `options_preview: ${optionsPreview.preview}`,
      ];
      if (defaultAnswer) {
        lines.push(`default: ${compactSingleLine(defaultAnswer, 120)}`);
      }
      if (queue.length > 1) {
        lines.push(`pending_followups_total: ${String(queue.length - 1)}`);
      }
      lines.push("hint: reply directly in chat to answer active question");
      lines.push(
        "ask_status_detail_hint: set GROBOT_ASK_STATUS_VERBOSE=1 and rerun status display for full followup details.",
      );
      lines.push("");
      input.output.writeStdout(`${lines.join("\n")}\n`);
      return;
    }
    const lines: string[] = [
      "[ask-user] active question status",
      "ask_status_output_mode: full",
      `pending_total: ${String(total)}`,
      `age: ${formatAskAge(active.createdAt)}`,
      `question: ${compactSingleLine(active.question, 220)}`,
      `options_preview: ${optionsPreview.preview}`,
    ];
    if (optionsPreview.hiddenCount > 0) {
      lines.push(`options_more: +${String(optionsPreview.hiddenCount)}`);
    }
    if (defaultAnswer) {
      lines.push(`default: ${compactSingleLine(defaultAnswer, 120)}`);
    }
    if (pendingFollowups.length > 0) {
      lines.push(`pending_followups_total: ${String(pendingFollowups.length)}`);
      for (let index = 0; index < queuedPreviewRows.length; index += 1) {
        const ask = queuedPreviewRows[index];
        lines.push(
          `pending_followup_${String(index + 1)}: ${ask.askId} age=${formatAskAge(ask.createdAt)} question=${compactSingleLine(ask.question, 140)}`,
        );
      }
      if (queuedHiddenCount > 0) {
        lines.push(`pending_followups_more: +${String(queuedHiddenCount)}`);
      }
    }
    lines.push("hint: reply directly in chat to answer active question");
    lines.push("hint: ask-user actions are automatic; there is no /ask command");
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

  const planSuggestionStateCache: {
    sessionKey: string;
    value: RunStartPlanSuggestionState | undefined;
    resolvedAtMs: number;
  } = {
    sessionKey: "",
    value: undefined,
    resolvedAtMs: 0,
  };

  const getPlanSuggestionState = (): RunStartPlanSuggestionState | undefined => {
    const sessionKey = input.runtimeState.getSessionKey();
    const now = Date.now();
    if (
      planSuggestionStateCache.sessionKey === sessionKey
      && now - planSuggestionStateCache.resolvedAtMs <= PLAN_SUGGESTION_STATE_CACHE_TTL_MS
    ) {
      return planSuggestionStateCache.value;
    }
    const activePlanStatus = input.runtimeState.getPlanMeta()?.active_plan_status;
    const latestEntry = resolveLatestPlanEntryStatus(input.workDir, sessionKey);
    const verification = loadLatestPlanVerificationDiagnostic(
      input.workDir,
      sessionKey,
      latestEntry.planId
        ? {
          planId: latestEntry.planId,
        }
        : undefined,
    );
    const value: RunStartPlanSuggestionState = {
      activePlanStatus,
      latestPlanStatus: latestEntry.status,
      latestVerificationStatus: verification?.status,
    };
    const hasSignal = Boolean(
      value.activePlanStatus
      || value.latestPlanStatus
      || value.latestVerificationStatus,
    );
    planSuggestionStateCache.sessionKey = sessionKey;
    planSuggestionStateCache.value = hasSignal ? value : undefined;
    planSuggestionStateCache.resolvedAtMs = now;
    return planSuggestionStateCache.value;
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
    showPendingAskQueue,
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
    benchmarkPlan: async (commandRaw) => {
      const result = await input.planMode.handleMessageInput(commandRaw);
      if (!result.handled) {
        input.output.writeStdout("[plan] benchmark command was not handled.\n\n");
        return 1;
      }
      return result.code;
    },
    enterPlan: input.planMode.enterPlan,
    approvePlan: input.planMode.approvePlan,
    rejectPlan: input.planMode.rejectPlan,
    verifyPlan: input.planMode.verifyPlan,
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
    openPlanMenu,
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
