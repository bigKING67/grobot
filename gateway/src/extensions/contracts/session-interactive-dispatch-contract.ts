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
  options?: { stdinIsTty?: boolean },
): Promise<DispatchCaseResult> {
  const events: string[] = [];
  const handlers: SessionInteractiveHandlers = {
    writeStdout: () => {
      events.push("writeStdout");
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
    createAndSwitchSession: async () => {
      events.push("createAndSwitchSession");
    },
    switchSession: async () => {
      events.push("switchSession");
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
    enterPlan: async () => {
      events.push("enterPlan");
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
  const modelPrefixMiss = await runDispatchCase("/models");
  const planPrefixMiss = await runDispatchCase("/planner");
  const switchMenu = await runDispatchCase("/switch");
  const continueMenu = await runDispatchCase("/continue");
  const switchLegacyWithId = await runDispatchCase("/switch session-legacy", { stdinIsTty: false });
  const switchLegacyWithIdTty = await runDispatchCase("/switch session-legacy", { stdinIsTty: true });
  const continueLegacyWithId = await runDispatchCase("/continue session-legacy", { stdinIsTty: false });
  const continueLegacyWithIdTty = await runDispatchCase("/continue session-legacy", { stdinIsTty: true });
  const modelMenu = await runDispatchCase("/model");
  const modelLegacyReset = await runDispatchCase("/model reset");
  const planMenu = await runDispatchCase("/plan");
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
  const commandsList = await runDispatchCase("/commands list", { stdinIsTty: false });
  const commandsListTty = await runDispatchCase("/commands list", { stdinIsTty: true });
  const skillCreatorWithDemand = await runDispatchCase("/skill-creator 帮我写一个数据分析的skill");
  const skillCreatorNoDemandTty = await runDispatchCase("/skill-creator", { stdinIsTty: true });
  const skillCreatorNoDemandNonTty = await runDispatchCase("/skill-creator", { stdinIsTty: false });
  const skillsCommand = await runDispatchCase("/skills");
  const mcpCommand = await runDispatchCase("/mcp");
  const userCommandInvocation = await runDispatchCase("/shipit");

  const payload = {
    switch_prefix_miss_hits_run_turn: includesEvent(switchPrefixMiss.events, "runTurn:/switcher"),
    switch_prefix_miss_opened_menu: includesEvent(switchPrefixMiss.events, "openSessionMenu:switch"),
    continue_prefix_miss_hits_run_turn: includesEvent(continuePrefixMiss.events, "runTurn:/continue-next"),
    continue_prefix_miss_opened_menu: includesEvent(continuePrefixMiss.events, "openSessionMenu:continue"),
    model_prefix_miss_hits_run_turn: includesEvent(modelPrefixMiss.events, "runTurn:/models"),
    model_prefix_miss_opened_menu: includesEvent(modelPrefixMiss.events, "openModelMenu"),
    plan_prefix_miss_hits_run_turn: includesEvent(planPrefixMiss.events, "runTurn:/planner"),
    plan_prefix_miss_entered_plan: includesEvent(planPrefixMiss.events, "enterPlan"),
    switch_menu_opened: includesEvent(switchMenu.events, "openSessionMenu:switch"),
    continue_menu_opened: includesEvent(continueMenu.events, "openSessionMenu:continue"),
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
    model_menu_dispatched: includesEvent(modelMenu.events, "openModelMenu"),
    model_legacy_reset_warned: includesEvent(modelLegacyReset.events, "writeStdout"),
    model_legacy_reset_hits_run_turn: includesEvent(modelLegacyReset.events, "runTurn:/model reset"),
    plan_menu_dispatched: includesEvent(planMenu.events, "openPlanMenu"),
    plan_menu_enters_plan_directly: includesEvent(planMenu.events, "enterPlan"),
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
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
