import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
} from "../../orchestration/entrypoints/dev-cli/start/session-interactive";

interface DispatchCaseResult {
  action: SessionInteractiveAction;
  events: string[];
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
  options?: { stdinIsTty?: boolean; pendingAskCount?: number },
): Promise<DispatchCaseResult> {
  const events: string[] = [];
  const pendingAskCount = Math.max(0, options?.pendingAskCount ?? 0);
  const handlers: SessionInteractiveHandlers = {
    writeStdout: () => {
      events.push("writeStdout");
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
  const action = typeof options?.stdinIsTty === "boolean"
    ? await withStdinTty(options.stdinIsTty, async () =>
      dispatchSessionInteractiveInput(input, controls, handlers))
    : await dispatchSessionInteractiveInput(input, controls, handlers);
  return { action, events };
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
  const rewindWithArgs = await runDispatchCase("/rewind latest");
  const modelMenu = await runDispatchCase("/model");
  const modelLegacyReset = await runDispatchCase("/model reset");
  const planMenu = await runDispatchCase("/plan", { stdinIsTty: true });
  const planEnterOnly = await runDispatchCase("/plan enter", { stdinIsTty: true });
  const planGoal = await runDispatchCase("/plan 我要一份抖音直播间规划", { stdinIsTty: true });
  const planLegacyStatus = await runDispatchCase("/plan status", { stdinIsTty: false });
  const planLegacyStatusTty = await runDispatchCase("/plan status", { stdinIsTty: true });
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
  const askQueueCommand = await runDispatchCase("/ask");
  const askQueueAllCommand = await runDispatchCase("/ask queue all");
  const askQueueTop3Command = await runDispatchCase("/ask queue 3");
  const askMenuCommand = await runDispatchCase("/ask menu");
  const askCancelCommand = await runDispatchCase("/ask cancel");
  const askParkCommand = await runDispatchCase("/ask park");
  const askNextCommand = await runDispatchCase("/ask next");
  const askClearCommand = await runDispatchCase("/ask clear");
  const askAnswerCommand = await runDispatchCase("/ask answer fast");
  const askAnswerKeepCaseCommand = await runDispatchCase("/ask answer KeepCase Value");
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
  const pendingAskAllowAskQueue = await runDispatchCase("/ask", { pendingAskCount: 2 });
  const pendingAskAllowAskQueueAll = await runDispatchCase("/ask queue all", { pendingAskCount: 2 });
  const pendingAskAllowAskMenu = await runDispatchCase("/ask menu", { pendingAskCount: 2 });
  const pendingAskAllowAskCancel = await runDispatchCase("/ask cancel", { pendingAskCount: 2 });
  const pendingAskAllowAskPark = await runDispatchCase("/ask park", { pendingAskCount: 2 });
  const pendingAskAllowAskClear = await runDispatchCase("/ask clear", { pendingAskCount: 2 });
  const pendingAskAllowAskAnswer = await runDispatchCase("/ask answer 2", { pendingAskCount: 2 });
  const pendingAskPlainAnswer = await runDispatchCase("继续执行快速方案", { pendingAskCount: 2 });

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
    resume_find_empty_tty_warned: includesEvent(resumeFindEmptyTty.events, "writeStdout"),
    resume_find_empty_tty_opened_menu: includesEvent(
      resumeFindEmptyTty.events,
      "openSessionMenu:resume",
    ),
    rewind_with_args_warned: includesEvent(rewindWithArgs.events, "writeStdout"),
    rewind_with_args_opened_menu: includesEvent(rewindWithArgs.events, "openSessionMenu:rewind"),
    rewind_with_args_hits_run_turn: includesEvent(rewindWithArgs.events, "runTurn:/rewind latest"),
    model_menu_dispatched: includesEvent(modelMenu.events, "openModelMenu"),
    model_legacy_reset_warned: includesEvent(modelLegacyReset.events, "writeStdout"),
    model_legacy_reset_hits_run_turn: includesEvent(modelLegacyReset.events, "runTurn:/model reset"),
    plan_menu_dispatched: includesEvent(planMenu.events, "openPlanMenu"),
    plan_menu_enters_plan_directly:
      planMenu.events.some((event) => event.startsWith("enterPlan:")),
    plan_enter_only_tty_enters_mode_directly:
      includesEvent(planEnterOnly.events, "enterPlan:enter"),
    plan_enter_only_tty_opened_menu:
      includesEvent(planEnterOnly.events, "openPlanMenu"),
    plan_goal_tty_enters_plan_directly:
      includesEvent(planGoal.events, "enterPlan:我要一份抖音直播间规划"),
    plan_goal_tty_opened_menu: includesEvent(planGoal.events, "openPlanMenu"),
    plan_legacy_status_warned: includesEvent(planLegacyStatus.events, "writeStdout"),
    plan_legacy_status_dispatched: includesEvent(planLegacyStatus.events, "showPlanStatus"),
    plan_legacy_status_tty_warned: includesEvent(planLegacyStatusTty.events, "writeStdout"),
    plan_legacy_status_tty_dispatched: includesEvent(planLegacyStatusTty.events, "showPlanStatus"),
    plan_legacy_status_tty_opened_menu: includesEvent(planLegacyStatusTty.events, "openPlanMenu"),
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
    ask_queue_dispatched: includesEvent(askQueueCommand.events, "showPendingAskQueue:default"),
    ask_queue_all_dispatched: includesEvent(askQueueAllCommand.events, "showPendingAskQueue:-1"),
    ask_queue_top3_dispatched: includesEvent(askQueueTop3Command.events, "showPendingAskQueue:3"),
    ask_menu_dispatched: includesEvent(askMenuCommand.events, "openPendingAskMenu"),
    ask_queue_hits_run_turn: includesEvent(askQueueCommand.events, "runTurn:/ask"),
    ask_cancel_dispatched: includesEvent(askCancelCommand.events, "cancelPendingAsk"),
    ask_cancel_hits_run_turn: includesEvent(askCancelCommand.events, "runTurn:/ask cancel"),
    ask_park_dispatched: includesEvent(askParkCommand.events, "parkPendingAsk"),
    ask_park_hits_run_turn: includesEvent(askParkCommand.events, "runTurn:/ask park"),
    ask_next_dispatched: includesEvent(askNextCommand.events, "parkPendingAsk"),
    ask_next_hits_run_turn: includesEvent(askNextCommand.events, "runTurn:/ask next"),
    ask_clear_dispatched: includesEvent(askClearCommand.events, "clearPendingAsk"),
    ask_clear_hits_run_turn: includesEvent(askClearCommand.events, "runTurn:/ask clear"),
    ask_answer_dispatched: includesEvent(askAnswerCommand.events, "answerPendingAsk:fast"),
    ask_answer_hits_run_turn: includesEvent(askAnswerCommand.events, "runTurn:/ask answer fast"),
    ask_answer_preserves_case: includesEvent(
      askAnswerKeepCaseCommand.events,
      "answerPendingAsk:KeepCase Value",
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
    pending_ask_queue_allowed: includesEvent(
      pendingAskAllowAskQueue.events,
      "showPendingAskQueue:default",
    ),
    pending_ask_queue_all_allowed: includesEvent(
      pendingAskAllowAskQueueAll.events,
      "showPendingAskQueue:-1",
    ),
    pending_ask_menu_allowed: includesEvent(
      pendingAskAllowAskMenu.events,
      "openPendingAskMenu",
    ),
    pending_ask_cancel_allowed: includesEvent(
      pendingAskAllowAskCancel.events,
      "cancelPendingAsk",
    ),
    pending_ask_park_allowed: includesEvent(
      pendingAskAllowAskPark.events,
      "parkPendingAsk",
    ),
    pending_ask_clear_allowed: includesEvent(
      pendingAskAllowAskClear.events,
      "clearPendingAsk",
    ),
    pending_ask_answer_allowed: includesEvent(
      pendingAskAllowAskAnswer.events,
      "answerPendingAsk:2",
    ),
    pending_ask_plain_text_runs_turn: includesEvent(
      pendingAskPlainAnswer.events,
      "runTurn:继续执行快速方案",
    ),
    pending_ask_plain_text_blocked_warned: includesEvent(
      pendingAskPlainAnswer.events,
      "writeStdout",
    ),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
