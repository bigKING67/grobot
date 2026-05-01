import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
  type SessionInteractiveRewindCheckpointSummary,
  type SessionInteractiveSessionSummary,
} from "../../orchestration/entrypoints/dev-cli/start/session-interactive";

interface DispatchCaseResult {
  action: SessionInteractiveAction;
  events: string[];
  stdout: string;
}

const controls: SessionInteractiveControls = {
  withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
};

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const DEFAULT_SESSION_SUMMARIES: readonly SessionInteractiveSessionSummary[] = [
  {
    id: "main",
    title: "Main Session",
    summary: "active",
    updatedAt: "2026-04-20T00:00:00.000Z",
    active: true,
  },
  {
    id: "session-legacy",
    title: "Legacy Session",
    summary: "historical",
    updatedAt: "2026-04-19T23:59:00.000Z",
    active: false,
  },
  {
    id: "session-archive",
    title: "Archive Session",
    summary: "old",
    updatedAt: "2026-04-18T23:59:00.000Z",
    active: false,
  },
];

const DEFAULT_REWIND_CHECKPOINTS: readonly SessionInteractiveRewindCheckpointSummary[] = [
  {
    checkpointId: "latest",
    createdAt: "2026-04-20T08:00:00.000Z",
    userText: "latest checkpoint",
    assistantText: "latest assistant",
    historyBeforeCount: 24,
    historyAfterCount: 26,
    changedFilesCount: 2,
  },
  {
    checkpointId: "legacy-a",
    createdAt: "2026-04-19T08:00:00.000Z",
    userText: "legacy checkpoint alpha",
    assistantText: "legacy assistant alpha",
    historyBeforeCount: 12,
    historyAfterCount: 14,
    changedFilesCount: 1,
  },
  {
    checkpointId: "legacy-b",
    createdAt: "2026-04-18T08:00:00.000Z",
    userText: "legacy checkpoint beta",
    assistantText: "legacy assistant beta",
    historyBeforeCount: 10,
    historyAfterCount: 11,
    changedFilesCount: 3,
  },
];

async function withStdinTty<T>(stdinIsTty: boolean, operation: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  try {
    Object.defineProperty(process.stdin, "isTTY", {
      value: stdinIsTty,
      configurable: true,
    });
    return await operation();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, "isTTY", descriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
}

async function runDispatchCase(
  input: string,
  options?: {
    stdinIsTty?: boolean;
    pendingAskCount?: number;
    planMode?: boolean;
    nowMs?: number;
    activeSessionId?: string;
    disableRewindSession?: boolean;
    sessionSummaries?: readonly SessionInteractiveSessionSummary[];
    rewindCheckpoints?: readonly SessionInteractiveRewindCheckpointSummary[];
  },
): Promise<DispatchCaseResult> {
  const events: string[] = [];
  const stdoutChunks: string[] = [];
  const pendingAskCount = Math.max(0, options?.pendingAskCount ?? 0);
  const activeSessionId = options?.activeSessionId ?? "main";
  const enableRewindSession = options?.disableRewindSession !== true;
  const sessionSummaries = options?.sessionSummaries ?? DEFAULT_SESSION_SUMMARIES;
  const rewindCheckpoints = options?.rewindCheckpoints ?? DEFAULT_REWIND_CHECKPOINTS;
  const invokeWithNow = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (typeof options?.nowMs !== "number") {
      return operation();
    }
    const originalNow = Date.now;
    Date.now = () => options.nowMs as number;
    try {
      return await operation();
    } finally {
      Date.now = originalNow;
    }
  };
  const handlers: SessionInteractiveHandlers = {
    writeStdout: (message) => {
      events.push("writeStdout");
      stdoutChunks.push(message);
    },
    hasPendingAsk: () => pendingAskCount > 0,
    getPendingAskQueueSize: () => pendingAskCount,
    getPendingAskPromptSummary: () =>
      pendingAskCount > 0
        ? "Enter 打开选择 · 1-2 直接回复"
        : undefined,
    showPendingAskQueue: (limit) => {
      events.push(`showPendingAskQueue:${typeof limit === "number" ? String(limit) : "default"}`);
    },
    selectPendingAskAnswer: async () => {
      events.push("selectPendingAskAnswer");
      return "core";
    },
    showHelp: () => {
      events.push("showHelp");
    },
    showHealthStatus: () => {
      events.push("showHealthStatus");
    },
    showContextStatus: () => {
      events.push("showContextStatus");
      events.push("writeStdout");
    },
    showMemoryStatus: () => {
      events.push("showMemoryStatus");
      events.push("writeStdout");
    },
    showSkillsStatus: () => {
      events.push("showSkillsStatus");
      events.push("writeStdout");
    },
    showMcpStatus: () => {
      events.push("showMcpStatus");
      events.push("writeStdout");
    },
    openModelMenu: async () => {
      events.push("openModelMenu");
    },
    showStatusCurrent: () => {
      events.push("showStatusCurrent");
    },
    setStatusTheme: (theme) => {
      events.push(`setStatusTheme:${theme}`);
    },
    setStatusLayoutMode: (layoutMode) => {
      events.push(`setStatusLayoutMode:${layoutMode}`);
    },
    setStatusSegmentEnabled: (segmentId, enabled) => {
      events.push(`setStatusSegmentEnabled:${segmentId}:${enabled ? "on" : "off"}`);
    },
    openStatusMenu: async () => {
      events.push("openStatusMenu");
    },
    openSessionMenu: async (mode) => {
      events.push(`openSessionMenu:${mode}`);
    },
    listSessionSummaries: () => [...sessionSummaries],
    getActiveSessionId: () => activeSessionId,
    listRewindCheckpoints: (sessionId) => {
      events.push(`listRewindCheckpoints:${sessionId}`);
      if (!activeSessionId || sessionId !== activeSessionId) {
        return [];
      }
      return [...rewindCheckpoints];
    },
    ...(enableRewindSession
      ? {
        rewindSession: async (inputValue: {
          sessionId: string;
          checkpointId?: string;
          mode: string;
          reason?: string;
        }) => {
          events.push("rewindSession");
          events.push(
            `rewindSession:${inputValue.sessionId}:${inputValue.checkpointId ?? "<latest>"}:${inputValue.mode}:${inputValue.reason ?? ""}`,
          );
          return true;
        },
      }
      : {}),
    createAndSwitchSession: async () => {
      events.push("createAndSwitchSession");
    },
    switchSession: async (targetSessionId) => {
      events.push("switchSession");
      events.push(`switchSession:${targetSessionId}`);
    },
    continueFromSession: async () => {
      events.push("continueFromSession");
    },
    writeHandoff: () => {
      events.push("writeHandoff");
    },
    isPlanMode: () => options?.planMode === true,
    showPlanStatus: async () => {
      events.push("showPlanStatus");
    },
    enterPlan: async (goal, withInputPaused) => {
      events.push(`enterPlan:${goal}`);
      if (typeof withInputPaused === "function") {
        events.push("enterPlan:hasInputPause");
      }
    },
    applyPlan: async () => {
      events.push("applyPlan");
    },
    cancelPlan: async () => {
      events.push("cancelPlan");
    },
    requestPlanInterrupt: async () => {
      events.push("requestPlanInterrupt");
    },
    requestRuntimeInterrupt: async () => {
      events.push("requestRuntimeInterrupt");
    },
    runPlanTurn: async (_userInput, withInputPaused) => {
      events.push("runPlanTurn");
      if (typeof withInputPaused === "function") {
        events.push("runPlanTurn:hasInputPause");
      }
    },
    handleUserCommandsCommand: async () => {
      events.push("handleUserCommandsCommand");
    },
    openCommandsMenu: async () => {
      events.push("openCommandsMenu");
    },
    openPlanInEditor: async () => {
      events.push("openPlanInEditor");
    },
    showHistory: async (query) => {
      events.push(`showHistory:${query ?? ""}`);
    },
    promptSkillCreatorRequirement: async () => {
      events.push("promptSkillCreatorRequirement");
      return "补齐技能需求";
    },
    runSkillCreator: async (requirement) => {
      events.push(`runSkillCreator:${requirement}`);
    },
    runInitProjectInstructions: async () => {
      events.push("runInitProjectInstructions");
    },
    tryRunUserCommand: async (userInput) => {
      events.push(`tryRunUserCommand:${userInput}`);
      return userInput === "/shipit";
    },
    runTurn: async (userInput) => {
      events.push(`runTurn:${userInput}`);
    },
    onTurnError: () => {
      events.push("onTurnError");
    },
  };
  const action = await invokeWithNow(async () =>
    typeof options?.stdinIsTty === "boolean"
      ? await withStdinTty(options.stdinIsTty, async () =>
        dispatchSessionInteractiveInput(input, controls, handlers))
      : await dispatchSessionInteractiveInput(input, controls, handlers));
  return { action, events, stdout: stdoutChunks.join("") };
}

function includesEvent(events: readonly string[], target: string): boolean {
  return events.includes(target);
}

async function main(): Promise<void> {
  const switchPrefixMiss = await runDispatchCase("/switcher");
  const continuePrefixMiss = await runDispatchCase("/continue-next");
  const resumePrefixMiss = await runDispatchCase("/resumable");
  const rewindPrefixMiss = await runDispatchCase("/rewinder");
  const modelPrefixMiss = await runDispatchCase("/models");
  const planPrefixMiss = await runDispatchCase("/planner");
  const switchMenu = await runDispatchCase("/switch");
  const continueMenu = await runDispatchCase("/continue");
  const resumeMenu = await runDispatchCase("/resume");
  const rewindMenu = await runDispatchCase("/rewind");
  const checkpointMenu = await runDispatchCase("/checkpoint");
  const switchLegacyWithId = await runDispatchCase("/switch session-legacy", { stdinIsTty: false });
  const switchLegacyWithIdTty = await runDispatchCase("/switch session-legacy", { stdinIsTty: true });
  const continueLegacyWithId = await runDispatchCase("/continue session-legacy", { stdinIsTty: false });
  const continueLegacyWithIdTty = await runDispatchCase("/continue session-legacy", { stdinIsTty: true });
  const resumeLegacyWithId = await runDispatchCase("/resume session-legacy", { stdinIsTty: false });
  const resumeLegacyWithIdTty = await runDispatchCase("/resume session-legacy", { stdinIsTty: true });
  const resumeMenuAliasTty = await runDispatchCase("/resume menu", { stdinIsTty: true });
  const resumeFindPrefixTty = await runDispatchCase("/resume session-lega", { stdinIsTty: true });
  const resumeFindKeywordTty = await runDispatchCase("/resume find legacy", { stdinIsTty: true });
  const resumeSearchKeywordTty = await runDispatchCase("/resume search old", { stdinIsTty: true });
  const resumeSearchCompactTitleTty = await runDispatchCase("/resume search legacysession", {
    stdinIsTty: true,
  });
  const resumeSearchCompactIdTty = await runDispatchCase("/resume search sessionlegacy", {
    stdinIsTty: true,
  });
  const resumeSearchCompactIdUnderscoreTty = await runDispatchCase("/resume search session_legacy", {
    stdinIsTty: true,
  });
  const resumeSearchCompactIdSpaceTty = await runDispatchCase("/resume search session legacy", {
    stdinIsTty: true,
  });
  const resumeSearchQuotedTitleTty = await runDispatchCase('/resume search "legacy session"', {
    stdinIsTty: true,
  });
  const resumeFindUpdatedAtTty = await runDispatchCase("/resume find 2026-04-19", { stdinIsTty: true });
  const resumeSearchUpdatedAtDigitsTty = await runDispatchCase("/resume search 20260418", {
    stdinIsTty: true,
  });
  const resumeSearchUpdatedAtDigitsContainsTty = await runDispatchCase("/resume search 0419", {
    stdinIsTty: true,
  });
  const resumeSearchSeparatorOnlyTty = await runDispatchCase("/resume search ---", {
    stdinIsTty: true,
  });
  const resumeFindActiveTty = await runDispatchCase("/resume find main", { stdinIsTty: true });
  const resumeFindMissingTty = await runDispatchCase("/resume find missing", { stdinIsTty: true });
  const resumeFindMultipleTty = await runDispatchCase("/resume session", { stdinIsTty: true });
  const resumeFindMultipleOverflowTty = await runDispatchCase("/resume session", {
    stdinIsTty: true,
    sessionSummaries: [
      {
        id: "main",
        title: "Main Session",
        summary: "active",
        updatedAt: "2026-04-20T00:00:00.000Z",
        active: true,
      },
      {
        id: "session-legacy",
        title: "Legacy Session",
        summary: "historical",
        updatedAt: "2026-04-19T23:59:00.000Z",
        active: false,
      },
      {
        id: "session-archive",
        title: "Archive Session",
        summary: "old",
        updatedAt: "2026-04-18T23:59:00.000Z",
        active: false,
      },
      {
        id: "session-ops",
        title: "Ops Session",
        summary: "ops queue",
        updatedAt: "2026-04-18T20:59:00.000Z",
        active: false,
      },
      {
        id: "session-growth",
        title: "Growth Session",
        summary: "growth notes",
        updatedAt: "2026-04-18T19:59:00.000Z",
        active: false,
      },
      {
        id: "session-data",
        title: "Data Session",
        summary: "data review",
        updatedAt: "2026-04-18T18:59:00.000Z",
        active: false,
      },
      {
        id: "session-ux",
        title: "UX Session",
        summary: "ux polish",
        updatedAt: "2026-04-18T17:59:00.000Z",
        active: false,
      },
    ],
  });
  const resumeFindEmptyTty = await runDispatchCase("/resume find", { stdinIsTty: true });
  const rewindQueryTty = await runDispatchCase("/rewind latest", { stdinIsTty: true });
  const rewindQueryNoActiveSessionTty = await runDispatchCase("/rewind latest", {
    stdinIsTty: true,
    activeSessionId: "",
  });
  const rewindQueryNoQuickPathTty = await runDispatchCase("/rewind latest", {
    stdinIsTty: true,
    disableRewindSession: true,
  });
  const rewindSearchMissingTty = await runDispatchCase("/rewind search missing", { stdinIsTty: true });
  const rewindQueryMultipleTty = await runDispatchCase("/rewind legacy", { stdinIsTty: true });
  const rewindQueryMultipleOverflowTty = await runDispatchCase("/rewind legacy", {
    stdinIsTty: true,
    rewindCheckpoints: [
      {
        checkpointId: "latest",
        createdAt: "2026-04-20T08:00:00.000Z",
        userText: "latest checkpoint",
        assistantText: "latest assistant",
        historyBeforeCount: 24,
        historyAfterCount: 26,
        changedFilesCount: 2,
      },
      {
        checkpointId: "legacy-a",
        createdAt: "2026-04-19T08:00:00.000Z",
        userText: "legacy checkpoint alpha",
        assistantText: "legacy assistant alpha",
        historyBeforeCount: 12,
        historyAfterCount: 14,
        changedFilesCount: 1,
      },
      {
        checkpointId: "legacy-b",
        createdAt: "2026-04-18T08:00:00.000Z",
        userText: "legacy checkpoint beta",
        assistantText: "legacy assistant beta",
        historyBeforeCount: 10,
        historyAfterCount: 11,
        changedFilesCount: 3,
      },
      {
        checkpointId: "legacy-c",
        createdAt: "2026-04-17T08:00:00.000Z",
        userText: "legacy checkpoint gamma",
        assistantText: "legacy assistant gamma",
        historyBeforeCount: 8,
        historyAfterCount: 9,
        changedFilesCount: 2,
      },
      {
        checkpointId: "legacy-d",
        createdAt: "2026-04-16T08:00:00.000Z",
        userText: "legacy checkpoint delta",
        assistantText: "legacy assistant delta",
        historyBeforeCount: 7,
        historyAfterCount: 8,
        changedFilesCount: 2,
      },
      {
        checkpointId: "legacy-e",
        createdAt: "2026-04-15T08:00:00.000Z",
        userText: "legacy checkpoint epsilon",
        assistantText: "legacy assistant epsilon",
        historyBeforeCount: 6,
        historyAfterCount: 7,
        changedFilesCount: 1,
      },
      {
        checkpointId: "legacy-f",
        createdAt: "2026-04-14T08:00:00.000Z",
        userText: "legacy checkpoint zeta",
        assistantText: "legacy assistant zeta",
        historyBeforeCount: 5,
        historyAfterCount: 6,
        changedFilesCount: 1,
      },
    ],
  });
  const rewindFindQueryModeTty = await runDispatchCase("/rewind find latest both", { stdinIsTty: true });
  const rewindSearchUserTextTty = await runDispatchCase("/rewind search alpha conversation", { stdinIsTty: true });
  const rewindSearchAssistantTextTty = await runDispatchCase("/rewind search beta code", { stdinIsTty: true });
  const rewindSearchUserTextCompactTty = await runDispatchCase("/rewind search legacycheckpointalpha", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdCompactTty = await runDispatchCase("/rewind search legacya", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdUnderscoreTty = await runDispatchCase("/rewind search legacy_a", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdSpaceTty = await runDispatchCase("/rewind search legacy a", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdQuotedTty = await runDispatchCase('/rewind search "legacy a"', {
    stdinIsTty: true,
  });
  const rewindSearchCreatedAtTty = await runDispatchCase("/rewind search 2026-04-20", { stdinIsTty: true });
  const rewindSearchCreatedAtDigitsTty = await runDispatchCase("/rewind search 20260420", { stdinIsTty: true });
  const rewindSearchCreatedAtDigitsContainsTty = await runDispatchCase("/rewind search 0420", { stdinIsTty: true });
  const rewindSearchSeparatorOnlyTty = await runDispatchCase("/rewind search ___", { stdinIsTty: true });
  const rewindFindModeKeywordQueryTty = await runDispatchCase("/rewind find code", { stdinIsTty: true });
  const rewindSummarizeTty = await runDispatchCase("/rewind summarize", { stdinIsTty: true });
  const rewindCodeModeTty = await runDispatchCase("/rewind latest code", { stdinIsTty: true });
  const checkpointQueryTty = await runDispatchCase("/checkpoint latest conversation", {
    stdinIsTty: true,
  });
  const checkpointSearchCreatedAtTty = await runDispatchCase("/checkpoint search 2026-04-20", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdCompactTty = await runDispatchCase("/checkpoint search legacya", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdUnderscoreTty = await runDispatchCase("/checkpoint search legacy_a", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdSpaceTty = await runDispatchCase("/checkpoint search legacy a", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdQuotedTty = await runDispatchCase('/checkpoint search "legacy a"', {
    stdinIsTty: true,
  });
  const checkpointSearchCreatedAtDigitsTty = await runDispatchCase("/checkpoint search 20260420", {
    stdinIsTty: true,
  });
  const checkpointSearchCreatedAtDigitsContainsTty = await runDispatchCase("/checkpoint search 0420", {
    stdinIsTty: true,
  });
  const checkpointFindEmptyTty = await runDispatchCase("/checkpoint find", { stdinIsTty: true });
  const rewindFindEmptyTty = await runDispatchCase("/rewind find", { stdinIsTty: true });
  const rewindModeOnlyTty = await runDispatchCase("/rewind conversation", { stdinIsTty: true });
  const rewindWithArgs = await runDispatchCase("/rewind latest");
  const modelMenu = await runDispatchCase("/model");
  const modelLegacyReset = await runDispatchCase("/model reset");
  const planMenu = await runDispatchCase("/plan", { stdinIsTty: true });
  const planOpenAliasTty = await runDispatchCase("/plan open", { stdinIsTty: true });
  const planOpenAliasTtyInPlan = await runDispatchCase("/plan open", {
    stdinIsTty: true,
    planMode: true,
  });
  const planOpenAlias = await runDispatchCase("/plan open", { stdinIsTty: false });
  const planOpenAliasInPlan = await runDispatchCase("/plan open", {
    stdinIsTty: false,
    planMode: true,
  });
  const planGoal = await runDispatchCase("/plan 我要一份抖音直播间规划", { stdinIsTty: true });
  const planGoalInPlan = await runDispatchCase("/plan 我要一份抖音直播间规划", {
    stdinIsTty: true,
    planMode: true,
  });
  const blockedResumeInPlan = await runDispatchCase("/resume", {
    stdinIsTty: true,
    planMode: true,
  });
  const planNaturalExecute = await runDispatchCase("Implement the plan.", { planMode: true });
  const planRefineInPlan = await runDispatchCase("继续补一轮验证细节", { planMode: true });
  const statusCurrent = await runDispatchCase("/status");
  const statusCurrentTty = await runDispatchCase("/status", { stdinIsTty: true });
  const statusTheme = await runDispatchCase("/status theme nerd");
  const statusThemeTty = await runDispatchCase("/status theme nerd", { stdinIsTty: true });
  const statusLayoutAlias = await runDispatchCase("/status compact");
  const statusSegment = await runDispatchCase("/status segment tokens off");
  const exitCommand = await runDispatchCase("/exit");
  const exitSlashAliasCommand = await runDispatchCase("/quit");
  const exitAliasCommand = await runDispatchCase("quit");
  const interruptCommand = await runDispatchCase("/interrupt");
  const newCommand = await runDispatchCase("/new");
  const newCommandTty = await runDispatchCase("/new", { stdinIsTty: true });
  const commandsMenu = await runDispatchCase("/commands");
  const historyCommand = await runDispatchCase("/history");
  const historyFilteredCommand = await runDispatchCase("/history 窗口预算");
  const askCommand = await runDispatchCase("/ask");
  const askInvalidArgsCommand = await runDispatchCase("/ask status");
  const commandsList = await runDispatchCase("/commands list", { stdinIsTty: false });
  const commandsListTty = await runDispatchCase("/commands list", { stdinIsTty: true });
  const skillCreatorWithDemand = await runDispatchCase("/skill-creator 帮我写一个数据分析的skill");
  const skillCreatorNoDemandTty = await runDispatchCase("/skill-creator", { stdinIsTty: true });
  const skillCreatorNoDemandNonTty = await runDispatchCase("/skill-creator", { stdinIsTty: false });
  const initCommand = await runDispatchCase("/init");
  const contextCommand = await runDispatchCase("/context");
  const memoryCommand = await runDispatchCase("/memory");
  const skillsCommand = await runDispatchCase("/skills");
  const mcpCommand = await runDispatchCase("/mcp");
  const userCommandInvocation = await runDispatchCase("/shipit");
  const pendingAskBlockedStatus = await runDispatchCase("/status", { pendingAskCount: 2 });
  const pendingAskAllowHelp = await runDispatchCase("/help", { pendingAskCount: 2 });
  const pendingAskAllowInterrupt = await runDispatchCase("/interrupt", { pendingAskCount: 2 });
  const pendingAskAllowSessions = await runDispatchCase("/sessions", { pendingAskCount: 2 });
  const pendingAskAllowResume = await runDispatchCase("/resume", { pendingAskCount: 2 });
  const pendingAskAllowRewind = await runDispatchCase("/rewind", { pendingAskCount: 2 });
  const pendingAskAllowAsk = await runDispatchCase("/ask", { pendingAskCount: 2 });
  const pendingAskAllowAskInvalidArgs = await runDispatchCase("/ask status", { pendingAskCount: 2 });
  const pendingAskPlainAnswer = await runDispatchCase("继续执行快速方案", { pendingAskCount: 2 });
  const pendingAskEmptyOpensSelector = await runDispatchCase("", { pendingAskCount: 2 });
  const pendingAskQuestionMarkOpensSelector = await runDispatchCase("?", { pendingAskCount: 2 });
  const pendingAskBlockedBurstFirst = await runDispatchCase("/model", {
    pendingAskCount: 3,
    nowMs: 1_000_000,
  });
  const pendingAskBlockedBurstSecond = await runDispatchCase("/status", {
    pendingAskCount: 3,
    nowMs: 1_000_500,
  });
  const pendingAskBlockedBurstThird = await runDispatchCase("/health", {
    pendingAskCount: 3,
    nowMs: 1_003_000,
  });
  const rewindWarningStdout = [
    rewindQueryNoActiveSessionTty.stdout,
    rewindQueryNoQuickPathTty.stdout,
    rewindSearchMissingTty.stdout,
    rewindQueryMultipleTty.stdout,
    rewindQueryMultipleOverflowTty.stdout,
    rewindSearchSeparatorOnlyTty.stdout,
    rewindFindModeKeywordQueryTty.stdout,
    rewindFindEmptyTty.stdout,
    rewindModeOnlyTty.stdout,
    rewindWithArgs.stdout,
  ].join("\n");

  const payload = {
    switch_prefix_miss_hits_run_turn: includesEvent(switchPrefixMiss.events, "runTurn:/switcher"),
    switch_prefix_miss_opened_menu: includesEvent(switchPrefixMiss.events, "openSessionMenu:switch"),
    continue_prefix_miss_hits_run_turn: includesEvent(continuePrefixMiss.events, "runTurn:/continue-next"),
    continue_prefix_miss_opened_menu: includesEvent(continuePrefixMiss.events, "openSessionMenu:continue"),
    resume_prefix_miss_hits_run_turn: includesEvent(resumePrefixMiss.events, "runTurn:/resumable"),
    resume_prefix_miss_opened_menu: includesEvent(resumePrefixMiss.events, "openSessionMenu:resume"),
    rewind_prefix_miss_hits_run_turn: includesEvent(rewindPrefixMiss.events, "runTurn:/rewinder"),
    rewind_prefix_miss_opened_menu: includesEvent(rewindPrefixMiss.events, "openSessionMenu:rewind"),
    model_prefix_miss_hits_run_turn: includesEvent(modelPrefixMiss.events, "runTurn:/models"),
    model_prefix_miss_opened_menu: includesEvent(modelPrefixMiss.events, "openModelMenu"),
    plan_prefix_miss_hits_run_turn: includesEvent(planPrefixMiss.events, "runTurn:/planner"),
    plan_prefix_miss_entered_plan:
      planPrefixMiss.events.some((event) => event.startsWith("enterPlan:")),
    switch_menu_opened: includesEvent(switchMenu.events, "openSessionMenu:switch"),
    continue_menu_opened: includesEvent(continueMenu.events, "openSessionMenu:continue"),
    resume_menu_opened: includesEvent(resumeMenu.events, "openSessionMenu:resume"),
    rewind_menu_opened: includesEvent(rewindMenu.events, "openSessionMenu:rewind"),
    checkpoint_menu_opened: includesEvent(checkpointMenu.events, "openSessionMenu:rewind"),
    switch_legacy_with_id_warned: includesEvent(switchLegacyWithId.events, "writeStdout"),
    switch_legacy_with_id_opened_menu: includesEvent(switchLegacyWithId.events, "openSessionMenu:switch"),
    switch_legacy_with_id_skips_direct_switch: !includesEvent(switchLegacyWithId.events, "switchSession"),
    switch_legacy_with_id_tty_warned: includesEvent(switchLegacyWithIdTty.events, "writeStdout"),
    switch_legacy_with_id_tty_opened_sessions_menu: includesEvent(
      switchLegacyWithIdTty.events,
      "openSessionMenu:sessions",
    ),
    continue_legacy_with_id_warned: includesEvent(continueLegacyWithId.events, "writeStdout"),
    continue_legacy_with_id_opened_menu: includesEvent(continueLegacyWithId.events, "openSessionMenu:continue"),
    continue_legacy_with_id_skips_direct_continue: !includesEvent(continueLegacyWithId.events, "continueFromSession"),
    continue_legacy_with_id_tty_warned: includesEvent(continueLegacyWithIdTty.events, "writeStdout"),
    continue_legacy_with_id_tty_opened_sessions_menu: includesEvent(
      continueLegacyWithIdTty.events,
      "openSessionMenu:sessions",
    ),
    resume_legacy_with_id_warned: includesEvent(resumeLegacyWithId.events, "writeStdout"),
    resume_legacy_with_id_direct_switch: includesEvent(resumeLegacyWithId.events, "switchSession"),
    resume_legacy_with_id_opened_menu: includesEvent(resumeLegacyWithId.events, "openSessionMenu:resume"),
    resume_legacy_with_id_tty_warned: includesEvent(resumeLegacyWithIdTty.events, "writeStdout"),
    resume_legacy_with_id_tty_direct_switch: includesEvent(resumeLegacyWithIdTty.events, "switchSession"),
    resume_legacy_with_id_tty_opened_resume_menu: includesEvent(
      resumeLegacyWithIdTty.events,
      "openSessionMenu:resume",
    ),
    resume_menu_alias_tty_opened_menu: includesEvent(
      resumeMenuAliasTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_prefix_tty_direct_switch: includesEvent(
      resumeFindPrefixTty.events,
      "switchSession:session-legacy",
    ),
    resume_find_keyword_tty_direct_switch: includesEvent(
      resumeFindKeywordTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_keyword_tty_direct_switch: includesEvent(
      resumeSearchKeywordTty.events,
      "switchSession:session-archive",
    ),
    resume_search_compact_title_tty_direct_switch: includesEvent(
      resumeSearchCompactTitleTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_compact_id_tty_direct_switch: includesEvent(
      resumeSearchCompactIdTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_compact_id_underscore_tty_direct_switch: includesEvent(
      resumeSearchCompactIdUnderscoreTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_compact_id_space_tty_direct_switch: includesEvent(
      resumeSearchCompactIdSpaceTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_quoted_title_tty_direct_switch: includesEvent(
      resumeSearchQuotedTitleTty.events,
      "switchSession:session-legacy",
    ),
    resume_find_updated_at_tty_direct_switch: includesEvent(
      resumeFindUpdatedAtTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_updated_at_digits_tty_direct_switch: includesEvent(
      resumeSearchUpdatedAtDigitsTty.events,
      "switchSession:session-archive",
    ),
    resume_search_updated_at_digits_contains_tty_direct_switch: includesEvent(
      resumeSearchUpdatedAtDigitsContainsTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_separator_only_tty_warned: includesEvent(
      resumeSearchSeparatorOnlyTty.events,
      "writeStdout",
    ),
    resume_search_separator_only_tty_direct_switch: includesEvent(
      resumeSearchSeparatorOnlyTty.events,
      "switchSession",
    ),
    resume_search_separator_only_tty_opened_menu: includesEvent(
      resumeSearchSeparatorOnlyTty.events,
      "openSessionMenu:resume",
    ),
    resume_search_separator_only_tty_no_match_message: resumeSearchSeparatorOnlyTty.stdout.includes(
      "没有匹配的会话",
    ),
    resume_search_separator_only_tty_no_match_has_tip: resumeSearchSeparatorOnlyTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    resume_find_active_tty_warned: includesEvent(resumeFindActiveTty.events, "writeStdout"),
    resume_find_active_tty_direct_switch: includesEvent(resumeFindActiveTty.events, "switchSession"),
    resume_find_active_tty_opened_menu: includesEvent(
      resumeFindActiveTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_active_tty_message_has_prefix: resumeFindActiveTty.stdout.includes(
      "会话已是当前会话",
    ),
    resume_find_active_tty_message_has_menu_hint: resumeFindActiveTty.stdout.includes(
      "使用 /resume 打开菜单。",
    ),
    resume_find_missing_tty_warned: includesEvent(resumeFindMissingTty.events, "writeStdout"),
    resume_find_missing_tty_direct_switch: includesEvent(resumeFindMissingTty.events, "switchSession"),
    resume_find_missing_tty_opened_menu: includesEvent(
      resumeFindMissingTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_missing_tty_no_match_has_tip: resumeFindMissingTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    resume_find_multiple_tty_warned: includesEvent(resumeFindMultipleTty.events, "writeStdout"),
    resume_find_multiple_tty_direct_switch: includesEvent(resumeFindMultipleTty.events, "switchSession"),
    resume_find_multiple_tty_includes_quick_pick: resumeFindMultipleTty.stdout.includes(
      "/resume session-legacy",
    ),
    resume_find_multiple_tty_includes_title_preview: resumeFindMultipleTty.stdout.includes(
      "| 标题=",
    ),
    resume_find_multiple_tty_includes_summary_preview: resumeFindMultipleTty.stdout.includes(
      "| 摘要=",
    ),
    resume_find_multiple_overflow_tty_includes_overflow_line: resumeFindMultipleOverflowTty.stdout.includes(
      "... 还有 1 项",
    ),
    resume_find_multiple_overflow_tty_includes_quick_pick_header: resumeFindMultipleOverflowTty.stdout.includes(
      "快速选择:",
    ),
    resume_surface_avoids_legacy_marker:
      !resumeFindActiveTty.stdout.includes("[session]")
      && !resumeFindMultipleTty.stdout.includes("[session]")
      && !resumeFindMultipleOverflowTty.stdout.includes("[session]")
      && !resumeFindMissingTty.stdout.includes("[session]"),
    session_command_redirect_surface_avoids_legacy_marker:
      !newCommandTty.stdout.includes("[session]")
      && !switchLegacyWithIdTty.stdout.includes("[session]")
      && !continueLegacyWithIdTty.stdout.includes("[session]"),
    ask_surface_avoids_legacy_marker:
      !askCommand.stdout.includes("[slash]")
      && !askCommand.stdout.includes("unknown command: /ask")
      && !askInvalidArgsCommand.stdout.includes("[slash]")
      && !askInvalidArgsCommand.stdout.includes("unknown command: /ask"),
    resume_find_multiple_tty_opened_menu: includesEvent(
      resumeFindMultipleTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_empty_tty_warned: includesEvent(resumeFindEmptyTty.events, "writeStdout"),
    resume_find_empty_tty_opened_menu: includesEvent(
      resumeFindEmptyTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_empty_tty_usage_has_updated_at: resumeFindEmptyTty.stdout.includes(
      "用法: /resume find <id|title|summary|updated-at>",
    ),
    rewind_query_tty_dispatched: includesEvent(rewindQueryTty.events, "rewindSession"),
    rewind_query_tty_exact_checkpoint: includesEvent(
      rewindQueryTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_query_tty_opened_menu: includesEvent(rewindQueryTty.events, "openSessionMenu:rewind"),
    rewind_query_no_active_session_tty_warned: includesEvent(
      rewindQueryNoActiveSessionTty.events,
      "writeStdout",
    ),
    rewind_query_no_active_session_tty_dispatched: includesEvent(
      rewindQueryNoActiveSessionTty.events,
      "rewindSession",
    ),
    rewind_query_no_active_session_tty_opened_menu: includesEvent(
      rewindQueryNoActiveSessionTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_query_no_active_session_surface_is_human:
      stripAnsi(rewindQueryNoActiveSessionTty.stdout).includes("当前会话不可用于回退")
      && stripAnsi(rewindQueryNoActiveSessionTty.stdout).includes("使用 /rewind 打开菜单。"),
    rewind_query_no_quick_path_tty_warned: includesEvent(
      rewindQueryNoQuickPathTty.events,
      "writeStdout",
    ),
    rewind_query_no_quick_path_tty_dispatched: includesEvent(
      rewindQueryNoQuickPathTty.events,
      "rewindSession",
    ),
    rewind_query_no_quick_path_tty_opened_menu: includesEvent(
      rewindQueryNoQuickPathTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_query_no_quick_path_surface_is_human:
      stripAnsi(rewindQueryNoQuickPathTty.stdout).includes("回退快速路径不可用")
      && stripAnsi(rewindQueryNoQuickPathTty.stdout).includes("使用 /rewind 打开菜单。"),
    rewind_search_missing_tty_warned: includesEvent(rewindSearchMissingTty.events, "writeStdout"),
    rewind_search_missing_tty_dispatched: includesEvent(
      rewindSearchMissingTty.events,
      "rewindSession",
    ),
    rewind_search_missing_tty_opened_menu: includesEvent(
      rewindSearchMissingTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_search_missing_tty_no_match_has_tip: rewindSearchMissingTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    rewind_search_missing_surface_is_human:
      stripAnsi(rewindSearchMissingTty.stdout).includes("没有匹配的检查点")
      && stripAnsi(rewindSearchMissingTty.stdout).includes("查询: missing"),
    rewind_query_multiple_tty_warned: includesEvent(rewindQueryMultipleTty.events, "writeStdout"),
    rewind_query_multiple_tty_dispatched: includesEvent(
      rewindQueryMultipleTty.events,
      "rewindSession",
    ),
    rewind_query_multiple_tty_includes_quick_pick: rewindQueryMultipleTty.stdout.includes(
      `${"/rewind"} legacy-a`,
    ),
    rewind_query_multiple_tty_includes_assistant_preview: rewindQueryMultipleTty.stdout.includes(
      "| 助手=",
    ),
    rewind_query_multiple_surface_is_human:
      stripAnsi(rewindQueryMultipleTty.stdout).includes("找到多个匹配的检查点")
      && stripAnsi(rewindQueryMultipleTty.stdout).includes("使用 /rewind 明确选择一个。"),
    rewind_query_multiple_overflow_tty_includes_overflow_line: rewindQueryMultipleOverflowTty.stdout.includes(
      "... 还有 1 项",
    ),
    rewind_query_multiple_overflow_tty_includes_quick_pick_header: rewindQueryMultipleOverflowTty.stdout.includes(
      "快速选择:",
    ),
    rewind_warning_surfaces_avoid_legacy_marker: !rewindWarningStdout.includes("[rewind]"),
    rewind_query_multiple_tty_opened_menu: includesEvent(
      rewindQueryMultipleTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_find_query_mode_tty_dispatched: includesEvent(
      rewindFindQueryModeTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_user_text_tty_dispatched: includesEvent(
      rewindSearchUserTextTty.events,
      "rewindSession:main:legacy-a:conversation:slash:rewind:query",
    ),
    rewind_search_assistant_text_tty_dispatched: includesEvent(
      rewindSearchAssistantTextTty.events,
      "rewindSession:main:legacy-b:code:slash:rewind:query",
    ),
    rewind_search_user_text_compact_tty_dispatched: includesEvent(
      rewindSearchUserTextCompactTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_compact_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdCompactTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_underscore_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdUnderscoreTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_space_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdSpaceTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_quoted_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdQuotedTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_created_at_tty_dispatched: includesEvent(
      rewindSearchCreatedAtTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_created_at_digits_tty_dispatched: includesEvent(
      rewindSearchCreatedAtDigitsTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_created_at_digits_contains_tty_dispatched: includesEvent(
      rewindSearchCreatedAtDigitsContainsTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_separator_only_tty_warned: includesEvent(
      rewindSearchSeparatorOnlyTty.events,
      "writeStdout",
    ),
    rewind_search_separator_only_tty_dispatched: includesEvent(
      rewindSearchSeparatorOnlyTty.events,
      "rewindSession",
    ),
    rewind_search_separator_only_tty_opened_menu: includesEvent(
      rewindSearchSeparatorOnlyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_search_separator_only_tty_no_match_message: rewindSearchSeparatorOnlyTty.stdout.includes(
      "没有匹配的检查点",
    ) && stripAnsi(rewindSearchSeparatorOnlyTty.stdout).includes("查询: ___"),
    rewind_search_separator_only_tty_no_match_has_tip: rewindSearchSeparatorOnlyTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    rewind_find_mode_keyword_query_warned: includesEvent(
      rewindFindModeKeywordQueryTty.events,
      "writeStdout",
    ),
    rewind_find_mode_keyword_query_dispatched: includesEvent(
      rewindFindModeKeywordQueryTty.events,
      "rewindSession",
    ),
    rewind_find_mode_keyword_query_no_match_message: rewindFindModeKeywordQueryTty.stdout.includes(
      "没有匹配的检查点",
    ) && stripAnsi(rewindFindModeKeywordQueryTty.stdout).includes("查询: code"),
    rewind_find_mode_keyword_query_no_match_has_tip: rewindFindModeKeywordQueryTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    rewind_find_mode_keyword_query_opened_menu: includesEvent(
      rewindFindModeKeywordQueryTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_summarize_tty_dispatched: includesEvent(
      rewindSummarizeTty.events,
      "rewindSession:main:<latest>:summarize:slash:rewind:summarize",
    ),
    rewind_code_mode_tty_dispatched: includesEvent(
      rewindCodeModeTty.events,
      "rewindSession:main:latest:code:slash:rewind:query",
    ),
    checkpoint_query_tty_dispatched: includesEvent(
      checkpointQueryTty.events,
      "rewindSession:main:latest:conversation:slash:checkpoint:query",
    ),
    checkpoint_search_created_at_tty_dispatched: includesEvent(
      checkpointSearchCreatedAtTty.events,
      "rewindSession:main:latest:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_compact_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdCompactTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_underscore_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdUnderscoreTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_space_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdSpaceTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_quoted_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdQuotedTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_created_at_digits_tty_dispatched: includesEvent(
      checkpointSearchCreatedAtDigitsTty.events,
      "rewindSession:main:latest:both:slash:checkpoint:query",
    ),
    checkpoint_search_created_at_digits_contains_tty_dispatched: includesEvent(
      checkpointSearchCreatedAtDigitsContainsTty.events,
      "rewindSession:main:latest:both:slash:checkpoint:query",
    ),
    checkpoint_find_empty_tty_warned: includesEvent(checkpointFindEmptyTty.events, "writeStdout"),
    checkpoint_find_empty_tty_dispatched: includesEvent(checkpointFindEmptyTty.events, "rewindSession"),
    checkpoint_find_empty_tty_opened_menu: includesEvent(
      checkpointFindEmptyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_find_empty_tty_warned: includesEvent(rewindFindEmptyTty.events, "writeStdout"),
    rewind_find_empty_tty_dispatched: includesEvent(rewindFindEmptyTty.events, "rewindSession"),
    rewind_find_empty_tty_opened_menu: includesEvent(
      rewindFindEmptyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_mode_only_tty_warned: includesEvent(rewindModeOnlyTty.events, "writeStdout"),
    rewind_mode_only_tty_dispatched: includesEvent(rewindModeOnlyTty.events, "rewindSession"),
    rewind_mode_only_tty_opened_menu: includesEvent(
      rewindModeOnlyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_with_args_warned: includesEvent(rewindWithArgs.events, "writeStdout"),
    rewind_with_args_opened_menu: includesEvent(rewindWithArgs.events, "openSessionMenu:rewind"),
    rewind_with_args_hits_run_turn: includesEvent(rewindWithArgs.events, "runTurn:/rewind latest"),
    model_menu_dispatched: includesEvent(modelMenu.events, "openModelMenu"),
    model_legacy_reset_warned: includesEvent(modelLegacyReset.events, "writeStdout"),
    model_legacy_reset_surface_is_human:
      stripAnsi(modelLegacyReset.stdout).includes("● Model")
      && stripAnsi(modelLegacyReset.stdout).includes("旧子命令已移除")
      && !modelLegacyReset.stdout.includes("[model]"),
    model_legacy_reset_hits_run_turn: includesEvent(modelLegacyReset.events, "runTurn:/model reset"),
    plan_root_tty_enters_plan_directly:
      includesEvent(planMenu.events, "enterPlan:"),
    plan_open_alias_tty_enters_plan_when_outside:
      includesEvent(planOpenAliasTty.events, "enterPlan:"),
    plan_open_alias_tty_skips_editor_when_outside:
      !includesEvent(planOpenAliasTty.events, "openPlanInEditor"),
    plan_open_alias_tty_in_plan_opened_editor:
      includesEvent(planOpenAliasTtyInPlan.events, "openPlanInEditor"),
    plan_open_alias_tty_in_plan_skips_plan_entry:
      !planOpenAliasTtyInPlan.events.some((event) => event.startsWith("enterPlan:")),
    plan_open_alias_non_tty_warned:
      includesEvent(planOpenAlias.events, "writeStdout"),
    plan_open_alias_non_tty_enters_plan_when_outside:
      includesEvent(planOpenAlias.events, "enterPlan:"),
    plan_open_alias_non_tty_in_plan_dispatched_status:
      includesEvent(planOpenAliasInPlan.events, "showPlanStatus"),
    plan_goal_tty_enters_plan_directly:
      includesEvent(planGoal.events, "enterPlan:我要一份抖音直播间规划"),
    plan_goal_tty_in_plan_shows_current_plan:
      includesEvent(planGoalInPlan.events, "showPlanStatus"),
    plan_goal_tty_in_plan_skips_new_plan:
      !planGoalInPlan.events.some((event) => event.startsWith("enterPlan:")),
    blocked_plan_mode_command_surface_is_human:
      stripAnsi(blockedResumeInPlan.stdout).includes("plan mode 中暂不可用")
      && stripAnsi(blockedResumeInPlan.stdout).includes("命令: /resume")
      && stripAnsi(blockedResumeInPlan.stdout).includes("可使用: /plan、/plan open、/interrupt 或 /exit"),
    blocked_plan_mode_command_avoids_legacy_marker:
      !blockedResumeInPlan.stdout.includes("[plan]")
      && !blockedResumeInPlan.stdout.includes("plan_id="),
    plan_natural_execute_in_plan_mode_dispatches_apply:
      includesEvent(planNaturalExecute.events, "applyPlan"),
    plan_natural_execute_in_plan_mode_skips_plan_turn:
      !includesEvent(planNaturalExecute.events, "runPlanTurn"),
    plan_refine_in_plan_mode_dispatches_plan_turn:
      includesEvent(planRefineInPlan.events, "runPlanTurn"),
    plan_refine_in_plan_mode_passes_input_pause:
      includesEvent(planRefineInPlan.events, "runPlanTurn:hasInputPause"),
    plan_goal_tty_passes_input_pause:
      includesEvent(planGoal.events, "enterPlan:hasInputPause"),
    status_current_dispatched: includesEvent(statusCurrent.events, "showStatusCurrent"),
    status_current_tty_opened_menu: includesEvent(statusCurrentTty.events, "openStatusMenu"),
    status_current_tty_dispatched_directly: includesEvent(statusCurrentTty.events, "showStatusCurrent"),
    status_theme_dispatched: includesEvent(statusTheme.events, "setStatusTheme:nerd"),
    status_theme_tty_warned: includesEvent(statusThemeTty.events, "writeStdout"),
    status_theme_tty_redirect_surface_is_human:
      stripAnsi(statusThemeTty.stdout).includes("已打开状态栏菜单")
      && stripAnsi(statusThemeTty.stdout).includes("交互模式已收敛为主入口 /status")
      && !statusThemeTty.stdout.includes("[status]"),
    status_theme_tty_opened_menu: includesEvent(statusThemeTty.events, "openStatusMenu"),
    status_theme_tty_dispatched_directly: includesEvent(statusThemeTty.events, "setStatusTheme:nerd"),
    status_layout_alias_dispatched: includesEvent(statusLayoutAlias.events, "setStatusLayoutMode:compact"),
    status_segment_dispatched: includesEvent(statusSegment.events, "setStatusSegmentEnabled:tokens:off"),
    exit_command_breaks_loop: exitCommand.action === "break",
    exit_command_hits_run_turn: includesEvent(exitCommand.events, "runTurn:/exit"),
    exit_alias_slash_quit_breaks_loop: exitSlashAliasCommand.action === "break",
    exit_alias_slash_quit_hits_run_turn:
      includesEvent(exitSlashAliasCommand.events, "runTurn:/quit"),
    exit_alias_quit_breaks_loop: exitAliasCommand.action === "break",
    interrupt_dispatched: includesEvent(interruptCommand.events, "requestRuntimeInterrupt"),
    new_dispatched_direct_create: includesEvent(newCommand.events, "createAndSwitchSession"),
    new_tty_redirect_warned: includesEvent(newCommandTty.events, "writeStdout"),
    new_tty_redirect_opened_sessions_menu: includesEvent(newCommandTty.events, "openSessionMenu:sessions"),
    new_tty_still_direct_create: includesEvent(newCommandTty.events, "createAndSwitchSession"),
    commands_menu_dispatched: includesEvent(commandsMenu.events, "openCommandsMenu"),
    history_dispatched: includesEvent(historyCommand.events, "showHistory:"),
    history_filtered_dispatched: includesEvent(historyFilteredCommand.events, "showHistory:窗口预算"),
    history_hits_run_turn: includesEvent(historyCommand.events, "runTurn:/history"),
    ask_dispatched: includesEvent(askCommand.events, "writeStdout"),
    ask_unknown_warned: askCommand.stdout.includes("● 未知命令"),
    ask_hits_run_turn: includesEvent(askCommand.events, "runTurn:/ask"),
    ask_invalid_args_warned: includesEvent(askInvalidArgsCommand.events, "writeStdout"),
    ask_invalid_args_usage_hint: askInvalidArgsCommand.stdout.includes("● 未知命令"),
    ask_invalid_args_dispatched: includesEvent(
      askInvalidArgsCommand.events,
      "showPendingAskQueue:default",
    ),
    commands_list_dispatched: includesEvent(commandsList.events, "handleUserCommandsCommand"),
    commands_list_tty_warned: includesEvent(commandsListTty.events, "writeStdout"),
    commands_list_tty_dispatched: includesEvent(commandsListTty.events, "handleUserCommandsCommand"),
    commands_list_tty_opened_menu: includesEvent(commandsListTty.events, "openCommandsMenu"),
    skill_creator_with_demand_dispatched: includesEvent(
      skillCreatorWithDemand.events,
      "runSkillCreator:帮我写一个数据分析的skill",
    ),
    skill_creator_with_demand_hits_run_turn: includesEvent(
      skillCreatorWithDemand.events,
      "runTurn:/skill-creator 帮我写一个数据分析的skill",
    ),
    skill_creator_empty_tty_prompted: includesEvent(
      skillCreatorNoDemandTty.events,
      "promptSkillCreatorRequirement",
    ),
    skill_creator_empty_tty_dispatched: includesEvent(
      skillCreatorNoDemandTty.events,
      "runSkillCreator:补齐技能需求",
    ),
    skill_creator_empty_non_tty_usage: includesEvent(
      skillCreatorNoDemandNonTty.events,
      "writeStdout",
    ),
    skill_creator_empty_non_tty_surface_is_human:
      stripAnsi(skillCreatorNoDemandNonTty.stdout).includes("需要提供技能需求")
      && stripAnsi(skillCreatorNoDemandNonTty.stdout).includes("用法: /skill-creator [需求]")
      && !skillCreatorNoDemandNonTty.stdout.includes("[skill-creator]"),
    skill_creator_empty_non_tty_prompted: includesEvent(
      skillCreatorNoDemandNonTty.events,
      "promptSkillCreatorRequirement",
    ),
    skill_creator_empty_non_tty_dispatched: includesEvent(
      skillCreatorNoDemandNonTty.events,
      "runSkillCreator:补齐技能需求",
    ),
    init_dispatched: includesEvent(initCommand.events, "runInitProjectInstructions"),
    init_hits_run_turn: includesEvent(initCommand.events, "runTurn:/init"),
    context_dispatched_to_status: includesEvent(contextCommand.events, "showContextStatus"),
    context_hits_run_turn: includesEvent(contextCommand.events, "runTurn:/context"),
    memory_dispatched_to_status: includesEvent(memoryCommand.events, "showMemoryStatus"),
    memory_hits_run_turn: includesEvent(memoryCommand.events, "runTurn:/memory"),
    skills_dispatched_to_status: includesEvent(skillsCommand.events, "showSkillsStatus"),
    skills_dispatched_to_stdout: includesEvent(skillsCommand.events, "writeStdout"),
    skills_hits_run_turn: includesEvent(skillsCommand.events, "runTurn:/skills"),
    mcp_dispatched_to_status: includesEvent(mcpCommand.events, "showMcpStatus"),
    mcp_dispatched_to_stdout: includesEvent(mcpCommand.events, "writeStdout"),
    mcp_hits_run_turn: includesEvent(mcpCommand.events, "runTurn:/mcp"),
    user_command_checked: includesEvent(userCommandInvocation.events, "tryRunUserCommand:/shipit"),
    user_command_hits_run_turn: includesEvent(userCommandInvocation.events, "runTurn:/shipit"),
    pending_ask_blocked_status_warned: includesEvent(pendingAskBlockedStatus.events, "writeStdout"),
    pending_ask_blocked_status_opened_menu: includesEvent(
      pendingAskBlockedStatus.events,
      "openStatusMenu",
    ),
    pending_ask_blocked_status_hint_has_reply_guidance:
      pendingAskBlockedStatus.stdout.includes("请先回复后再执行其他命令"),
    pending_ask_blocked_status_hint_has_prompt_summary:
      pendingAskBlockedStatus.stdout.includes("Enter 打开选择")
      && !pendingAskBlockedStatus.stdout.includes("question="),
    pending_ask_blocked_status_hint_has_short_menu_hint:
      pendingAskBlockedStatus.stdout.includes("Enter 打开选择"),
    pending_ask_help_allowed: includesEvent(pendingAskAllowHelp.events, "showHelp"),
    pending_ask_help_blocked_warned: includesEvent(pendingAskAllowHelp.events, "writeStdout"),
    pending_ask_interrupt_allowed: includesEvent(
      pendingAskAllowInterrupt.events,
      "requestRuntimeInterrupt",
    ),
    pending_ask_sessions_allowed: includesEvent(
      pendingAskAllowSessions.events,
      "openSessionMenu:sessions",
    ),
    pending_ask_resume_allowed: includesEvent(
      pendingAskAllowResume.events,
      "openSessionMenu:resume",
    ),
    pending_ask_rewind_allowed: includesEvent(
      pendingAskAllowRewind.events,
      "openSessionMenu:rewind",
    ),
    pending_ask_ask_allowed: pendingAskAllowAsk.stdout.includes("● 未知命令"),
    pending_ask_ask_invalid_args_warned: includesEvent(
      pendingAskAllowAskInvalidArgs.events,
      "writeStdout",
    ),
    pending_ask_ask_invalid_args_dispatched:
      pendingAskAllowAskInvalidArgs.stdout.includes("● 未知命令"),
    pending_ask_plain_text_runs_turn: includesEvent(
      pendingAskPlainAnswer.events,
      "runTurn:继续执行快速方案",
    ),
    pending_ask_plain_text_blocked_warned: includesEvent(
      pendingAskPlainAnswer.events,
      "writeStdout",
    ),
    pending_ask_empty_opens_selector: includesEvent(
      pendingAskEmptyOpensSelector.events,
      "selectPendingAskAnswer",
    ),
    pending_ask_empty_selection_runs_turn: includesEvent(
      pendingAskEmptyOpensSelector.events,
      "runTurn:core",
    ),
    pending_ask_question_mark_opens_selector: includesEvent(
      pendingAskQuestionMarkOpensSelector.events,
      "selectPendingAskAnswer",
    ),
    pending_ask_question_mark_selection_runs_turn: includesEvent(
      pendingAskQuestionMarkOpensSelector.events,
      "runTurn:core",
    ),
    pending_ask_burst_first_warned: includesEvent(
      pendingAskBlockedBurstFirst.events,
      "writeStdout",
    ),
    pending_ask_burst_second_suppressed: !includesEvent(
      pendingAskBlockedBurstSecond.events,
      "writeStdout",
    ),
    pending_ask_burst_third_warned: includesEvent(
      pendingAskBlockedBurstThird.events,
      "writeStdout",
    ),
    pending_ask_burst_third_mentions_suppressed_count:
      pendingAskBlockedBurstThird.stdout.includes("已折叠 1 条重复提示"),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
