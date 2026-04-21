import { type SessionStoreRuntime } from "../services/session-store";
import { type RunStartInteractiveModeInput } from "./run-start-interactive-mode";
import { type RuntimeAttachment } from "../../../../models/types";
import {
  type RunStartModelOps,
  type RunStartModelSnapshot,
} from "./run-start-model-ops";
import { type RunStartOutput } from "./run-start-output";
import { type RunStartPlanMode } from "./run-start-plan-mode";
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
  buildHelpText(): string;
  statusLineConfig?: StatusLineConfigInput;
  runtimeProviderChain: ReadonlyArray<RuntimeProviderCandidate>;
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeState: RunStartRuntimeState;
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

  const openPlanMenu = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    if (!process.stdin.isTTY) {
      input.output.writeStdout(
        [
          "[plan] action menu",
          "- /plan               Enter plan mode only",
          "- /plan <goal>        Enter plan mode and execute first requirement",
          "- /plan status        Show active plan status",
          "- /plan apply [extra] Review, approve, then execute active plan",
          "- /plan cancel        Cancel plan mode and discard active plan",
          "",
        ].join("\n"),
      );
      return;
    }
    const picked = await withInputPaused(() =>
      runTerminalSelectMenu({
        title: "Plan Actions",
        subtitle: `Session: ${input.runtimeState.getSessionKey()}`,
        hint: "Use ↑/↓ (or j/k, Ctrl+n/p), number to select directly, Enter/Space to confirm, Esc to cancel.",
        items: [
          {
            id: "enter",
            label: "Enter and execute requirement",
            description: "Input a goal, enter plan mode, and execute it immediately.",
          },
          {
            id: "status",
            label: "Show active plan status",
            description: "Display mode, active plan id, status and path.",
          },
          {
            id: "apply",
            label: "Review and apply active plan",
            description: "Run plan apply pipeline with optional extra note.",
          },
          {
            id: "cancel",
            label: "Cancel active plan",
            description: "Discard plan mode and return to normal mode.",
          },
        ],
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
    if (picked.item.id === "cancel") {
      const code = await input.planMode.cancelPlan();
      if (shouldMarkFailure(code)) {
        input.runtimeState.markFailureObserved();
      }
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
      const code = await input.planMode.applyPlan(applyExtra.value.trim());
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
    const code = await input.planMode.enterPlan(goal);
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
    restoredTurns: input.runtimeState.getRestoredTurns(),
    restoreSource: input.runtimeState.getRestoreSource(),
    buildHelpText: input.buildHelpText,
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
    openPlanMenu,
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
        input.output.writeStdout("usage: /skill-creator <需求>\n\n");
        return;
      }
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
