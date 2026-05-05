import { includesEvent, runDispatchCase, stripAnsi } from "./helpers";

export async function runCommandDispatchFlows() {
  const modelPrefixMiss = await runDispatchCase("/models");
  const planPrefixMiss = await runDispatchCase("/planner");
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
  const planRemovedBenchmark = await runDispatchCase("/plan benchmark", { stdinIsTty: true });
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

  return {
    model_prefix_miss_hits_run_turn: includesEvent(modelPrefixMiss.events, "runTurn:/models"),
    model_prefix_miss_opened_menu: includesEvent(modelPrefixMiss.events, "openModelMenu"),
    plan_prefix_miss_hits_run_turn: includesEvent(planPrefixMiss.events, "runTurn:/planner"),
    plan_prefix_miss_entered_plan:
      planPrefixMiss.events.some((event) => event.startsWith("enterPlan:")),
    model_menu_dispatched: includesEvent(modelMenu.events, "openModelMenu"),
    model_legacy_reset_warned: includesEvent(modelLegacyReset.events, "writeStdout"),
    model_legacy_reset_surface_is_human:
      stripAnsi(modelLegacyReset.stdout).includes("模型选择")
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
    plan_removed_subcommand_surface_is_human:
      stripAnsi(planRemovedBenchmark.stdout).includes("计划模式")
      && stripAnsi(planRemovedBenchmark.stdout).includes("不支持该 /plan 子命令")
      && stripAnsi(planRemovedBenchmark.stdout).includes("/plan、/plan <目标> 或 /plan open"),
    plan_removed_subcommand_hides_machine_output:
      !planRemovedBenchmark.stdout.includes("[plan-benchmark]")
      && !planRemovedBenchmark.stdout.includes("plan_quality_benchmark_")
      && !planRemovedBenchmark.stdout.includes("suggested_action_")
      && !planRemovedBenchmark.stdout.includes("recommended_next_action:"),
    blocked_plan_mode_command_surface_is_human:
      stripAnsi(blockedResumeInPlan.stdout).includes("计划模式中暂不可用")
      && stripAnsi(blockedResumeInPlan.stdout).includes("/resume")
      && stripAnsi(blockedResumeInPlan.stdout).includes("计划模式只接受计划相关操作。")
      && stripAnsi(blockedResumeInPlan.stdout).includes("可用入口 /plan、/plan open、/interrupt、/exit"),
    blocked_plan_mode_command_avoids_raw_labels:
      !stripAnsi(blockedResumeInPlan.stdout).includes("命令:")
      && !stripAnsi(blockedResumeInPlan.stdout).includes("可使用:"),
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
    ask_unknown_warned:
      stripAnsi(askCommand.stdout).includes("未知命令")
      && !stripAnsi(askCommand.stdout).includes("● 未知命令"),
    ask_hits_run_turn: includesEvent(askCommand.events, "runTurn:/ask"),
    ask_invalid_args_warned: includesEvent(askInvalidArgsCommand.events, "writeStdout"),
    ask_invalid_args_usage_hint:
      stripAnsi(askInvalidArgsCommand.stdout).includes("未知命令")
      && !stripAnsi(askInvalidArgsCommand.stdout).includes("● 未知命令"),
    ask_invalid_args_dispatched: includesEvent(
      askInvalidArgsCommand.events,
      "showPendingAskQueue:default",
    ),
    ask_surface_avoids_legacy_marker:
      !askCommand.stdout.includes("[slash]")
      && !askCommand.stdout.includes("unknown command: /ask")
      && !askInvalidArgsCommand.stdout.includes("[slash]")
      && !askInvalidArgsCommand.stdout.includes("unknown command: /ask"),
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
      && stripAnsi(skillCreatorNoDemandNonTty.stdout).includes("用法 /skill-creator [需求]")
      && !stripAnsi(skillCreatorNoDemandNonTty.stdout).includes("用法: /skill-creator [需求]")
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
  };
}
