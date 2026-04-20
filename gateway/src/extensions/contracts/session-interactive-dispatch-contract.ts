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

async function runDispatchCase(input: string): Promise<DispatchCaseResult> {
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
  const action = await dispatchSessionInteractiveInput(input, controls, handlers);
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
  const switchLegacyWithId = await runDispatchCase("/switch session-legacy");
  const continueLegacyWithId = await runDispatchCase("/continue session-legacy");
  const modelMenu = await runDispatchCase("/model");
  const modelLegacyReset = await runDispatchCase("/model reset");
  const planMenu = await runDispatchCase("/plan");
  const planLegacyStatus = await runDispatchCase("/plan status");
  const statusCurrent = await runDispatchCase("/status");
  const statusTheme = await runDispatchCase("/status theme nerd");
  const statusLayoutAlias = await runDispatchCase("/status compact");
  const statusSegment = await runDispatchCase("/status segment tokens off");
  const exitCommand = await runDispatchCase("/exit");
  const exitSlashAliasCommand = await runDispatchCase("/quit");
  const exitAliasCommand = await runDispatchCase("quit");
  const interruptCommand = await runDispatchCase("/interrupt");
  const commandsMenu = await runDispatchCase("/commands");
  const commandsList = await runDispatchCase("/commands list");
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
    continue_legacy_with_id_warned: includesEvent(continueLegacyWithId.events, "writeStdout"),
    continue_legacy_with_id_opened_menu: includesEvent(continueLegacyWithId.events, "openSessionMenu:continue"),
    continue_legacy_with_id_skips_direct_continue: !includesEvent(continueLegacyWithId.events, "continueFromSession"),
    model_menu_dispatched: includesEvent(modelMenu.events, "openModelMenu"),
    model_legacy_reset_warned: includesEvent(modelLegacyReset.events, "writeStdout"),
    model_legacy_reset_hits_run_turn: includesEvent(modelLegacyReset.events, "runTurn:/model reset"),
    plan_menu_dispatched: includesEvent(planMenu.events, "openPlanMenu"),
    plan_menu_enters_plan_directly: includesEvent(planMenu.events, "enterPlan"),
    plan_legacy_status_warned: includesEvent(planLegacyStatus.events, "writeStdout"),
    plan_legacy_status_dispatched: includesEvent(planLegacyStatus.events, "showPlanStatus"),
    status_current_dispatched: includesEvent(statusCurrent.events, "showStatusCurrent"),
    status_theme_dispatched: includesEvent(statusTheme.events, "setStatusTheme:nerd"),
    status_layout_alias_dispatched: includesEvent(statusLayoutAlias.events, "setStatusLayoutMode:compact"),
    status_segment_dispatched: includesEvent(statusSegment.events, "setStatusSegmentEnabled:tokens:off"),
    exit_command_breaks_loop: exitCommand.action === "break",
    exit_command_hits_run_turn: includesEvent(exitCommand.events, "runTurn:/exit"),
    exit_alias_slash_quit_breaks_loop: exitSlashAliasCommand.action === "break",
    exit_alias_slash_quit_hits_run_turn:
      includesEvent(exitSlashAliasCommand.events, "runTurn:/quit"),
    exit_alias_quit_breaks_loop: exitAliasCommand.action === "break",
    interrupt_dispatched: includesEvent(interruptCommand.events, "requestRuntimeInterrupt"),
    commands_menu_dispatched: includesEvent(commandsMenu.events, "openCommandsMenu"),
    commands_list_dispatched: includesEvent(commandsList.events, "handleUserCommandsCommand"),
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
