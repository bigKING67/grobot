import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
} from "../../orchestration/entrypoints/dev-cli/start/session-interactive";

interface DispatchCaseResult {
  action: SessionInteractiveAction;
  events: string[];
  stdout: string;
}

const controls: SessionInteractiveControls = {
  withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
};

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
    }
  }
}

async function runDispatchCase(
  input: string,
  options?: { stdinIsTty?: boolean; pendingAskCount?: number; nowMs?: number },
): Promise<DispatchCaseResult> {
  const events: string[] = [];
  const stdoutChunks: string[] = [];
  const pendingAskCount = Math.max(0, options?.pendingAskCount ?? 0);
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
    showPendingAskQueue: (limit) => {
      events.push(`showPendingAskQueue:${typeof limit === "number" ? String(limit) : "default"}`);
    },
    openPendingAskMenu: async () => {
      events.push("openPendingAskMenu");
    },
    cancelPendingAsk: () => {
      events.push("cancelPendingAsk");
    },
    parkPendingAsk: () => {
      events.push("parkPendingAsk");
    },
    clearPendingAsk: () => {
      events.push("clearPendingAsk");
    },
    answerPendingAsk: async (answer) => {
      events.push(`answerPendingAsk:${answer}`);
    },
    showHelp: () => {
      events.push("showHelp");
    },
    showHealthStatus: () => {
      events.push("showHealthStatus");
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
    listSessionSummaries: () => [
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
    ],
    getActiveSessionId: () => "main",
    listRewindCheckpoints: (sessionId) => {
      events.push(`listRewindCheckpoints:${sessionId}`);
      if (sessionId !== "main") {
        return [];
      }
      return [
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
    },
    rewindSession: async (inputValue) => {
      events.push("rewindSession");
      events.push(
        `rewindSession:${inputValue.sessionId}:${inputValue.checkpointId ?? "<latest>"}:${inputValue.mode}:${inputValue.reason ?? ""}`,
      );
      return true;
    },
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
    isPlanMode: () => false,
    showPlanStatus: async () => {
      events.push("showPlanStatus");
    },
    enterPlan: async (goal) => {
      events.push(`enterPlan:${goal}`);
    },
    approvePlan: async (note) => {
      events.push(`approvePlan:${note}`);
    },
    rejectPlan: async (reason) => {
      events.push(`rejectPlan:${reason}`);
    },
    verifyPlan: async (result) => {
      events.push(`verifyPlan:${result}`);
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
    runPlanTurn: async () => {
      events.push("runPlanTurn");
    },
    handleUserCommandsCommand: async () => {
      events.push("handleUserCommandsCommand");
    },
    openCommandsMenu: async () => {
      events.push("openCommandsMenu");
    },
    openPlanMenu: async () => {
      events.push("openPlanMenu");
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
  const resumeFindMissingTty = await runDispatchCase("/resume find missing", { stdinIsTty: true });
  const resumeFindMultipleTty = await runDispatchCase("/resume session", { stdinIsTty: true });
  const resumeFindEmptyTty = await runDispatchCase("/resume find", { stdinIsTty: true });
  const rewindQueryTty = await runDispatchCase("/rewind latest", { stdinIsTty: true });
  const rewindSearchMissingTty = await runDispatchCase("/rewind search missing", { stdinIsTty: true });
  const rewindQueryMultipleTty = await runDispatchCase("/rewind legacy", { stdinIsTty: true });
  const rewindFindQueryModeTty = await runDispatchCase("/rewind find latest both", { stdinIsTty: true });
  const rewindSearchUserTextTty = await runDispatchCase("/rewind search alpha conversation", { stdinIsTty: true });
  const rewindSearchAssistantTextTty = await runDispatchCase("/rewind search beta code", { stdinIsTty: true });
  const rewindSearchUserTextCompactTty = await runDispatchCase("/rewind search legacycheckpointalpha", {
    stdinIsTty: true,
  });
  const rewindSearchCreatedAtTty = await runDispatchCase("/rewind search 2026-04-20", { stdinIsTty: true });
  const rewindSearchCreatedAtDigitsTty = await runDispatchCase("/rewind search 20260420", { stdinIsTty: true });
  const rewindFindModeKeywordQueryTty = await runDispatchCase("/rewind find code", { stdinIsTty: true });
  const rewindSummarizeTty = await runDispatchCase("/rewind summarize", { stdinIsTty: true });
  const rewindCodeModeTty = await runDispatchCase("/rewind latest code", { stdinIsTty: true });
  const checkpointQueryTty = await runDispatchCase("/checkpoint latest conversation", {
    stdinIsTty: true,
  });
  const checkpointSearchCreatedAtTty = await runDispatchCase("/checkpoint search 2026-04-20", {
    stdinIsTty: true,
  });
  const checkpointFindEmptyTty = await runDispatchCase("/checkpoint find", { stdinIsTty: true });
  const rewindFindEmptyTty = await runDispatchCase("/rewind find", { stdinIsTty: true });
  const rewindModeOnlyTty = await runDispatchCase("/rewind conversation", { stdinIsTty: true });
  const rewindWithArgs = await runDispatchCase("/rewind latest");
  const modelMenu = await runDispatchCase("/model");
  const modelLegacyReset = await runDispatchCase("/model reset");
  const planMenu = await runDispatchCase("/plan", { stdinIsTty: true });
  const planMenuAlias = await runDispatchCase("/plan menu", { stdinIsTty: true });
  const planOpenAliasTty = await runDispatchCase("/plan open", { stdinIsTty: true });
  const planOpenAlias = await runDispatchCase("/plan open", { stdinIsTty: false });
  const planEnterOnly = await runDispatchCase("/plan enter", { stdinIsTty: true });
  const planEnterWithGoal = await runDispatchCase("/plan enter 我要一份增长执行计划", { stdinIsTty: true });
  const planGoal = await runDispatchCase("/plan 我要一份抖音直播间规划", { stdinIsTty: true });
  const planApprove = await runDispatchCase("/plan approve final pass", { stdinIsTty: true });
  const planReject = await runDispatchCase("/plan reject scope is too broad", { stdinIsTty: true });
  const planVerify = await runDispatchCase("/plan verify fail e2e mismatch", { stdinIsTty: true });
  const planVerifyCn = await runDispatchCase("/plan 验证 通过 结果稳定", { stdinIsTty: true });
  const planLegacyStatus = await runDispatchCase("/plan status", { stdinIsTty: false });
  const planLegacyStatusTty = await runDispatchCase("/plan status", { stdinIsTty: true });
  const planStatusWithTailTty = await runDispatchCase("/plan status extra", { stdinIsTty: true });
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
  const askSubQueueCommand = await runDispatchCase("/ask queue all");
  const askSubMenuCommand = await runDispatchCase("/ask menu");
  const askSubAnswerCommand = await runDispatchCase("/ask answer fast");
  const askAliasCnCommand = await runDispatchCase("/ask 队列");
  const askShortcutNumberCommand = await runDispatchCase("/ask 2");
  const commandsList = await runDispatchCase("/commands list", { stdinIsTty: false });
  const commandsListTty = await runDispatchCase("/commands list", { stdinIsTty: true });
  const skillCreatorWithDemand = await runDispatchCase("/skill-creator 帮我写一个数据分析的skill");
  const skillCreatorNoDemandTty = await runDispatchCase("/skill-creator", { stdinIsTty: true });
  const skillCreatorNoDemandNonTty = await runDispatchCase("/skill-creator", { stdinIsTty: false });
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
  const pendingAskAllowAskSubcommand = await runDispatchCase("/ask queue all", { pendingAskCount: 2 });
  const pendingAskPlainAnswer = await runDispatchCase("继续执行快速方案", { pendingAskCount: 2 });
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
    resume_find_missing_tty_warned: includesEvent(resumeFindMissingTty.events, "writeStdout"),
    resume_find_missing_tty_direct_switch: includesEvent(resumeFindMissingTty.events, "switchSession"),
    resume_find_multiple_tty_warned: includesEvent(resumeFindMultipleTty.events, "writeStdout"),
    resume_find_multiple_tty_direct_switch: includesEvent(resumeFindMultipleTty.events, "switchSession"),
    resume_find_multiple_tty_includes_quick_pick: resumeFindMultipleTty.stdout.includes(
      "/resume session-legacy",
    ),
    resume_find_empty_tty_warned: includesEvent(resumeFindEmptyTty.events, "writeStdout"),
    resume_find_empty_tty_opened_menu: includesEvent(
      resumeFindEmptyTty.events,
      "openSessionMenu:resume",
    ),
    rewind_query_tty_dispatched: includesEvent(rewindQueryTty.events, "rewindSession"),
    rewind_query_tty_exact_checkpoint: includesEvent(
      rewindQueryTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_query_tty_opened_menu: includesEvent(rewindQueryTty.events, "openSessionMenu:rewind"),
    rewind_search_missing_tty_warned: includesEvent(rewindSearchMissingTty.events, "writeStdout"),
    rewind_search_missing_tty_dispatched: includesEvent(
      rewindSearchMissingTty.events,
      "rewindSession",
    ),
    rewind_query_multiple_tty_warned: includesEvent(rewindQueryMultipleTty.events, "writeStdout"),
    rewind_query_multiple_tty_dispatched: includesEvent(
      rewindQueryMultipleTty.events,
      "rewindSession",
    ),
    rewind_query_multiple_tty_includes_quick_pick: rewindQueryMultipleTty.stdout.includes(
      `${"/rewind"} legacy-a`,
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
    rewind_search_created_at_tty_dispatched: includesEvent(
      rewindSearchCreatedAtTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_created_at_digits_tty_dispatched: includesEvent(
      rewindSearchCreatedAtDigitsTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
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
      'No checkpoints matching "code"',
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
    checkpoint_find_empty_tty_warned: includesEvent(checkpointFindEmptyTty.events, "writeStdout"),
    checkpoint_find_empty_tty_dispatched: includesEvent(checkpointFindEmptyTty.events, "rewindSession"),
    rewind_find_empty_tty_warned: includesEvent(rewindFindEmptyTty.events, "writeStdout"),
    rewind_find_empty_tty_dispatched: includesEvent(rewindFindEmptyTty.events, "rewindSession"),
    rewind_mode_only_tty_warned: includesEvent(rewindModeOnlyTty.events, "writeStdout"),
    rewind_mode_only_tty_dispatched: includesEvent(rewindModeOnlyTty.events, "rewindSession"),
    rewind_with_args_warned: includesEvent(rewindWithArgs.events, "writeStdout"),
    rewind_with_args_opened_menu: includesEvent(rewindWithArgs.events, "openSessionMenu:rewind"),
    rewind_with_args_hits_run_turn: includesEvent(rewindWithArgs.events, "runTurn:/rewind latest"),
    model_menu_dispatched: includesEvent(modelMenu.events, "openModelMenu"),
    model_legacy_reset_warned: includesEvent(modelLegacyReset.events, "writeStdout"),
    model_legacy_reset_hits_run_turn: includesEvent(modelLegacyReset.events, "runTurn:/model reset"),
    plan_menu_dispatched: includesEvent(planMenu.events, "openPlanMenu"),
    plan_menu_enters_plan_directly:
      planMenu.events.some((event) => event.startsWith("enterPlan:")),
    plan_menu_alias_enters_mode_directly:
      includesEvent(planMenuAlias.events, "enterPlan:"),
    plan_menu_alias_opened_menu:
      includesEvent(planMenuAlias.events, "openPlanMenu"),
    plan_open_alias_tty_opened_menu:
      includesEvent(planOpenAliasTty.events, "openPlanMenu"),
    plan_open_alias_tty_enters_plan_directly:
      planOpenAliasTty.events.some((event) => event.startsWith("enterPlan:")),
    plan_open_alias_non_tty_warned:
      includesEvent(planOpenAlias.events, "writeStdout"),
    plan_open_alias_non_tty_dispatched_status:
      includesEvent(planOpenAlias.events, "showPlanStatus"),
    plan_enter_only_tty_warned:
      includesEvent(planEnterOnly.events, "writeStdout"),
    plan_enter_only_tty_enters_mode_directly:
      includesEvent(planEnterOnly.events, "enterPlan:"),
    plan_enter_only_tty_treated_as_goal:
      includesEvent(planEnterOnly.events, "enterPlan:enter"),
    plan_enter_only_tty_opened_menu:
      includesEvent(planEnterOnly.events, "openPlanMenu"),
    plan_enter_with_goal_tty_enters_goal:
      includesEvent(planEnterWithGoal.events, "enterPlan:我要一份增长执行计划"),
    plan_goal_tty_enters_plan_directly:
      includesEvent(planGoal.events, "enterPlan:我要一份抖音直播间规划"),
    plan_goal_tty_opened_menu: includesEvent(planGoal.events, "openPlanMenu"),
    plan_approve_tty_warned: includesEvent(planApprove.events, "writeStdout"),
    plan_approve_tty_opened_menu: includesEvent(planApprove.events, "openPlanMenu"),
    plan_approve_tty_dispatched: includesEvent(planApprove.events, "approvePlan:final pass"),
    plan_reject_tty_warned: includesEvent(planReject.events, "writeStdout"),
    plan_reject_tty_opened_menu: includesEvent(planReject.events, "openPlanMenu"),
    plan_reject_tty_dispatched: includesEvent(planReject.events, "rejectPlan:scope is too broad"),
    plan_verify_tty_warned: includesEvent(planVerify.events, "writeStdout"),
    plan_verify_tty_opened_menu: includesEvent(planVerify.events, "openPlanMenu"),
    plan_verify_tty_dispatched: includesEvent(planVerify.events, "verifyPlan:fail e2e mismatch"),
    plan_verify_cn_alias_tty_warned: includesEvent(planVerifyCn.events, "writeStdout"),
    plan_verify_cn_alias_tty_opened_menu: includesEvent(planVerifyCn.events, "openPlanMenu"),
    plan_verify_cn_alias_tty_dispatched: includesEvent(planVerifyCn.events, "verifyPlan:通过 结果稳定"),
    plan_legacy_status_warned: includesEvent(planLegacyStatus.events, "writeStdout"),
    plan_legacy_status_dispatched: includesEvent(planLegacyStatus.events, "showPlanStatus"),
    plan_legacy_status_tty_warned: includesEvent(planLegacyStatusTty.events, "writeStdout"),
    plan_legacy_status_tty_dispatched: includesEvent(planLegacyStatusTty.events, "showPlanStatus"),
    plan_legacy_status_tty_opened_menu: includesEvent(planLegacyStatusTty.events, "openPlanMenu"),
    plan_status_with_tail_tty_warned: includesEvent(planStatusWithTailTty.events, "writeStdout"),
    plan_status_with_tail_tty_dispatched: includesEvent(planStatusWithTailTty.events, "showPlanStatus"),
    plan_status_with_tail_tty_opened_menu: includesEvent(planStatusWithTailTty.events, "openPlanMenu"),
    status_current_dispatched: includesEvent(statusCurrent.events, "showStatusCurrent"),
    status_current_tty_opened_menu: includesEvent(statusCurrentTty.events, "openStatusMenu"),
    status_current_tty_dispatched_directly: includesEvent(statusCurrentTty.events, "showStatusCurrent"),
    status_theme_dispatched: includesEvent(statusTheme.events, "setStatusTheme:nerd"),
    status_theme_tty_warned: includesEvent(statusThemeTty.events, "writeStdout"),
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
    ask_dispatched: includesEvent(askCommand.events, "showPendingAskQueue:default"),
    ask_hits_run_turn: includesEvent(askCommand.events, "runTurn:/ask"),
    ask_subcommand_queue_warned: includesEvent(askSubQueueCommand.events, "writeStdout"),
    ask_subcommand_queue_dispatched: includesEvent(askSubQueueCommand.events, "showPendingAskQueue:default"),
    ask_subcommand_menu_warned: includesEvent(askSubMenuCommand.events, "writeStdout"),
    ask_subcommand_menu_dispatched: includesEvent(askSubMenuCommand.events, "openPendingAskMenu"),
    ask_subcommand_answer_warned: includesEvent(askSubAnswerCommand.events, "writeStdout"),
    ask_subcommand_answer_dispatched: includesEvent(askSubAnswerCommand.events, "answerPendingAsk:fast"),
    ask_alias_cn_warned: includesEvent(askAliasCnCommand.events, "writeStdout"),
    ask_shortcut_number_warned: includesEvent(askShortcutNumberCommand.events, "writeStdout"),
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
    skill_creator_empty_non_tty_prompted: includesEvent(
      skillCreatorNoDemandNonTty.events,
      "promptSkillCreatorRequirement",
    ),
    skill_creator_empty_non_tty_dispatched: includesEvent(
      skillCreatorNoDemandNonTty.events,
      "runSkillCreator:补齐技能需求",
    ),
    skills_dispatched_to_stdout: includesEvent(skillsCommand.events, "writeStdout"),
    skills_hits_run_turn: includesEvent(skillsCommand.events, "runTurn:/skills"),
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
      pendingAskBlockedStatus.stdout.includes("请先直接回复"),
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
    pending_ask_ask_allowed: includesEvent(
      pendingAskAllowAsk.events,
      "showPendingAskQueue:default",
    ),
    pending_ask_ask_subcommand_warned: includesEvent(
      pendingAskAllowAskSubcommand.events,
      "writeStdout",
    ),
    pending_ask_plain_text_runs_turn: includesEvent(
      pendingAskPlainAnswer.events,
      "runTurn:继续执行快速方案",
    ),
    pending_ask_plain_text_blocked_warned: includesEvent(
      pendingAskPlainAnswer.events,
      "writeStdout",
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
