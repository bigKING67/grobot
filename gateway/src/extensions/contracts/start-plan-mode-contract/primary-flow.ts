import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRunStartPlanMode } from "../../../cli/start/plan-mode";
import {
  createRuntimeState,
  persistence,
  sanitizePlanSessionSegment,
  stripAnsi,
  validPlan,
} from "./helpers";

export async function runPrimaryPlanModeFlow(workDir: string) {
  const sessionKey = "feishu:grobot:dm:plan-mode-contract";
  const runtimeState = createRuntimeState(sessionKey);
  let stdout = "";
  let stderr = "";
  const executeInputs: string[] = [];
  const executePromptPreludes: string[] = [];

  const planMode = createRunStartPlanMode({
    workDir,
    runtimeState,
    persistence,
    executeTurn: async (userInput, _interactiveMode, options) => {
      executeInputs.push(userInput);
      executePromptPreludes.push(options?.promptPrelude ?? "");
      return 0;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      runtimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      stdout += message;
    },
    writeStderr: (message) => {
      stderr += message;
    },
  });

  const enter = await planMode.handleMessageInput("/plan contract cleanup", {
    messageMode: true,
  });
  const stdoutAfterEnter = stdout;
  const planModeAfterEnter = runtimeState.getPlanMode();
  const planPath = planMode.getActivePlanPath();
  if (!planPath) {
    throw new Error("expected active plan path after /plan <goal>");
  }
  const stdoutBeforeDraftOpen = stdout;
  const draftOpen = await planMode.handleMessageInput("/plan open");
  const draftOpenOutput = stdout.slice(stdoutBeforeDraftOpen.length);
  const stdoutBeforeRefine = stdout;
  const refine = await planMode.runPlanTurn("refine contract cleanup");
  const refineOutput = stdout.slice(stdoutBeforeRefine.length);
  writeFileSync(planPath, `${validPlan}\n`, "utf8");
  const stdoutBeforeReady = stdout;
  const ready = await planMode.runPlanTurn("ready for approval");
  const readyOutput = stdout.slice(stdoutBeforeReady.length);
  const readyApprovalRequests: Array<{ planPath: string; planContent: string }> = [];
  const stdoutBeforeKeepPlanning = stdout;
  const keepPlanning = await planMode.runPlanTurn("ready approval menu declined", {
    requestReadyPlanApproval: async (request) => {
      readyApprovalRequests.push({
        planPath: request.planPath,
        planContent: request.planContent,
      });
      return "keep_planning";
    },
  });
  const keepPlanningOutput = stdout.slice(stdoutBeforeKeepPlanning.length);

  const stdoutBeforeOpen = stdout;
  const open = await planMode.handleMessageInput("/plan open");
  const openOutput = stdout.slice(stdoutBeforeOpen.length);
  const stdoutBeforeVerboseOpen = stdout;
  const originalVerbose = process.env.GROBOT_PLAN_STATUS_VERBOSE;
  process.env.GROBOT_PLAN_STATUS_VERBOSE = "1";
  const verboseOpen = await planMode.handleMessageInput("/plan open");
  const verboseOpenOutput = stdout.slice(stdoutBeforeVerboseOpen.length);
  if (typeof originalVerbose === "string") {
    process.env.GROBOT_PLAN_STATUS_VERBOSE = originalVerbose;
  } else {
    delete process.env.GROBOT_PLAN_STATUS_VERBOSE;
  }
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: false,
  });
  const stdoutBeforeScriptOpen = stdout;
  const scriptOpen = await planMode.handleMessageInput("/plan open");
  const scriptOpenOutput = stdout.slice(stdoutBeforeScriptOpen.length);
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  const executeCountBeforePlanGoalInPlan = executeInputs.length;
  const stdoutBeforePlanGoalInPlan = stdout;
  const planGoalInPlan = await planMode.handleMessageInput("/plan second contract goal");
  const planGoalInPlanOutput = stdout.slice(stdoutBeforePlanGoalInPlan.length);
  const executeCountAfterPlanGoalInPlan = executeInputs.length;
  const stdoutBeforeRemovedBenchmark = stdout;
  const removedBenchmark = await planMode.handleMessageInput("/plan benchmark");
  const removedBenchmarkOutput = stdout.slice(stdoutBeforeRemovedBenchmark.length);
  const activePlanIdBeforeApply = runtimeState.getPlanMeta()?.active_plan_id;
  const executeCountBeforeApply = executeInputs.length;
  const stdoutBeforeApply = stdout;
  const execute = await planMode.handleMessageInput("Implement the plan.");
  const applyOutput = stdout.slice(stdoutBeforeApply.length);
  const applyPrompt = executeInputs[executeInputs.length - 1] ?? "";
  const stdoutBeforeLatestPlanStatus = stdout;
  const latestPlanStatusCode = await planMode.showPlanStatus();
  const latestPlanStatusOutput = stdout.slice(stdoutBeforeLatestPlanStatus.length);

  const eventsPath = resolve(
    workDir,
    ".grobot/plans",
    sanitizePlanSessionSegment(sessionKey),
    "events.jsonl",
  );
  const eventsText = readFileSync(eventsPath, "utf8");

  return {
    enter_plan_message_mode_handled: enter.handled && enter.code === 0,
    enter_plan_sets_plan_only: planModeAfterEnter === "plan_only",
    enter_plan_stdout_is_human:
      stdoutAfterEnter.includes("已进入计划模式")
      && stdoutAfterEnter.includes("Grobot 正在探索")
      && !stdoutAfterEnter.includes("session_key=")
      && !stdoutAfterEnter.includes("plan_id=")
      && !stdoutAfterEnter.includes("file=")
      && !stdoutAfterEnter.includes("[plan] entered PLAN_ONLY"),
    enter_plan_surface_has_relative_planning_path:
      stdoutAfterEnter.includes("计划文件 .grobot/plans/"),
    enter_plan_surface_has_goal:
      stdoutAfterEnter.includes("目标 contract cleanup"),
    enter_plan_surface_has_read_only_boundary:
      stdoutAfterEnter.includes("确认计划前，计划模式只会读取和规划。"),
    enter_plan_surface_hides_absolute_plan_path:
      !stdoutAfterEnter.includes(workDir),
    enter_plan_surface_order_is_stable:
      stdoutAfterEnter.indexOf("已进入计划模式") >= 0
      && stdoutAfterEnter.indexOf("计划文件 ") > stdoutAfterEnter.indexOf("已进入计划模式")
      && stdoutAfterEnter.indexOf("目标 ") > stdoutAfterEnter.indexOf("计划文件 "),
    draft_plan_surface_handled: draftOpen.handled && draftOpen.code === 0,
    draft_plan_surface_uses_status_title:
      draftOpenOutput.includes("计划草稿"),
    draft_plan_surface_uses_relative_plan_file:
      draftOpenOutput.includes(".grobot/plans/"),
    draft_plan_surface_uses_info_panel_rows:
      draftOpenOutput.includes("草稿已创建")
      && draftOpenOutput.includes("• 草稿已创建")
      && draftOpenOutput.includes("  ⎿  .grobot/plans/"),
    draft_plan_surface_has_read_only_boundary:
      draftOpenOutput.includes("确认最终计划前，计划模式只会读取和规划。"),
    draft_plan_surface_has_refine_hint:
      draftOpenOutput.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
    draft_plan_surface_hides_absolute_path:
      !draftOpenOutput.includes(workDir),
    draft_plan_surface_hides_required_placeholders:
      !draftOpenOutput.includes("__REQUIRED__"),
    draft_plan_surface_avoids_legacy_empty_message:
      !draftOpenOutput.includes("Already in plan mode. No plan written yet."),
    refine_plan_turn_handled: refine === 0,
    refine_plan_turn_surface_matches_reference_shape:
      refineOutput.includes("•")
      && refineOutput.includes("  ⎿")
      && refineOutput.includes("计划需要继续完善")
      && refineOutput.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
    ready_plan_turn_handled: ready === 0,
    ready_surface_matches_reference_shape:
      readyOutput.includes("准备开始实现？")
      && !readyOutput.includes("● 准备开始实现？")
      && readyOutput.includes("Grobot 的计划：")
      && readyOutput.includes("执行前请确认计划。")
      && readyOutput.includes("是否开始执行？")
      && readyOutput.includes("❯ 确认，开始实现计划")
      && readyOutput.includes("  继续完善计划")
      && readyOutput.includes("编辑: /plan open"),
    ready_surface_has_plan_separators:
      readyOutput.split("\n").some((line) => /^┄{24,}$/.test(line))
      && readyOutput.split("\n").some((line) => /^─{24,}$/.test(line)),
    ready_approval_callback_receives_current_plan:
      keepPlanning === 0
      && readyApprovalRequests.length === 1
      && readyApprovalRequests[0]?.planPath === planPath
      && readyApprovalRequests[0]?.planContent.includes("# Contract Plan"),
    ready_approval_keep_planning_skips_fallback_surface:
      keepPlanningOutput.includes("已继续留在计划模式")
      && !keepPlanningOutput.includes("准备开始实现？"),
    ready_approval_keep_planning_matches_reference_shape:
      keepPlanningOutput.includes("已继续留在计划模式")
      && keepPlanningOutput.includes("•")
      && keepPlanningOutput.includes("  ⎿")
      && keepPlanningOutput.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
    plan_turn_injects_plan_workflow_prompt:
      executePromptPreludes.some((item) =>
        item.includes("[Plan Mode Workflow]")
        && item.includes("MUST NOT make any edits")
        && item.includes("Plan File Info:")
        && item.includes("<proposed_plan>")),
    plan_turn_prompt_requires_strict_plan_sections:
      executePromptPreludes.some((item) =>
        item.includes("Validation must include real commands")
        && item.includes("Risk & Rollback must name concrete failure modes")),
    active_plan_path_present: typeof planPath === "string" && planPath.length > 0,
    open_plan_surface_handled: open.handled && open.code === 0,
    open_plan_surface_is_current_plan_display:
      openOutput.includes("当前计划")
      && !openOutput.includes("● 当前计划")
      && openOutput.includes("# Contract Plan")
      && (
        openOutput.includes('使用 "/plan open" 编辑此计划')
        || openOutput.includes('使用 "/plan open" 在 vim 中编辑此计划')
      ),
    open_plan_surface_has_editor_hint:
      openOutput.includes('使用 "/plan open" 在 vim 中编辑此计划'),
    open_plan_surface_hides_machine_fields_by_default:
      !openOutput.includes("plan_status_output_mode:")
      && !openOutput.includes("active_plan_phase:")
      && !openOutput.includes("suggested_action_command:")
      && !openOutput.includes("session_id:")
      && !openOutput.includes("plan_id:")
      && !openOutput.includes("seq:")
      && !openOutput.includes("status:"),
    open_plan_surface_uses_relative_plan_file:
      openOutput.includes(".grobot/plans/"),
    open_plan_surface_hides_absolute_plan_file:
      !openOutput.includes(workDir),
    verbose_plan_surface_handled: verboseOpen.handled && verboseOpen.code === 0,
    verbose_plan_surface_preserves_machine_fields:
      verboseOpenOutput.includes("plan_status_output_mode: full")
      && verboseOpenOutput.includes("active_plan_phase: awaiting_decision")
      && verboseOpenOutput.includes("suggested_action_command: Implement the plan."),
    script_plan_surface_defaults_to_human_summary:
      scriptOpen.handled
      && scriptOpen.code === 0
      && scriptOpenOutput.includes("当前计划")
      && scriptOpenOutput.includes("# Contract Plan")
      && (
        scriptOpenOutput.includes('使用 "/plan open" 编辑此计划')
        || scriptOpenOutput.includes('使用 "/plan open" 在 vim 中编辑此计划')
      ),
    script_plan_surface_has_editor_hint:
      scriptOpenOutput.includes('使用 "/plan open" 在 vim 中编辑此计划'),
    script_plan_surface_hides_machine_fields_by_default:
      !scriptOpenOutput.includes("plan_status_output_mode:")
      && !scriptOpenOutput.includes("active_plan_phase:")
      && !scriptOpenOutput.includes("suggested_action_command:")
      && !scriptOpenOutput.includes("session_id:")
      && !scriptOpenOutput.includes("plan_id:")
      && !scriptOpenOutput.includes("seq:")
      && !scriptOpenOutput.includes("status:"),
    script_plan_surface_uses_relative_plan_file:
      scriptOpenOutput.includes(".grobot/plans/"),
    script_plan_surface_hides_absolute_plan_file:
      !scriptOpenOutput.includes(workDir),
    plan_goal_in_plan_mode_shows_current_plan:
      planGoalInPlan.handled
      && planGoalInPlan.code === 0
      && planGoalInPlanOutput.includes("当前计划")
      && planGoalInPlanOutput.includes("# Contract Plan"),
    plan_goal_in_plan_mode_skips_new_query:
      executeCountAfterPlanGoalInPlan === executeCountBeforePlanGoalInPlan,
    removed_plan_benchmark_surface_is_human:
      removedBenchmark.handled
      && removedBenchmark.code === 0
      && stripAnsi(removedBenchmarkOutput).includes("Plan")
      && stripAnsi(removedBenchmarkOutput).includes("•")
      && stripAnsi(removedBenchmarkOutput).includes("不支持该 /plan 子命令")
      && stripAnsi(removedBenchmarkOutput).includes("/plan、/plan <目标> 或 /plan open"),
    removed_plan_benchmark_hides_machine_output:
      !removedBenchmarkOutput.includes("[plan-benchmark]")
      && !removedBenchmarkOutput.includes("[plan-benchmark-check]")
      && !removedBenchmarkOutput.includes("plan_quality_benchmark_")
      && !removedBenchmarkOutput.includes("suggested_action_")
      && !removedBenchmarkOutput.includes("recommended_next_action:"),
    execute_natural_language_handled: execute.handled && execute.code === 0,
    execute_triggered_runtime_turn: executeInputs.length === executeCountBeforeApply + 1,
    execute_payload_is_not_literal_phrase:
      applyPrompt.trim() !== "Implement the plan.",
    execute_payload_has_approved_plan_contract:
      applyPrompt.includes("[Approved Plan Execution]")
      && applyPrompt.includes("Plan approval:")
      && applyPrompt.includes("Execution contract:")
      && applyPrompt.includes("Plan to implement:")
      && applyPrompt.includes("<approved_plan>")
      && applyPrompt.includes("</approved_plan>"),
    execute_payload_has_approval_metadata:
      applyPrompt.includes("- ticket:")
      && applyPrompt.includes("- sha256:"),
    execute_payload_has_scope_guardrails:
      applyPrompt.includes("Do not silently expand scope beyond Scope In")
      && applyPrompt.includes("stop and return to plan mode with the conflict")
      && applyPrompt.includes("validation aligned with the plan's Milestones and Validation sections"),
    execute_payload_contains_approved_plan_snapshot:
      applyPrompt.includes("# Contract Plan")
      && applyPrompt.includes("## Validation")
      && applyPrompt.includes("## Risk & Rollback"),
    execute_payload_omits_plain_trigger_as_extra:
      !applyPrompt.includes("Additional user instruction:\nImplement the plan."),
    apply_surface_shows_approved_plan_start:
      applyOutput.includes("计划已确认")
      && !applyOutput.includes("● 计划已确认")
      && applyOutput.includes("已确认")
      && applyOutput.includes("将要实现的计划")
      && applyOutput.includes("开始按已确认快照实现"),
    apply_surface_has_saved_plan_hint:
      applyOutput.includes("• 已确认 · 计划已保存: .grobot/plans/")
      && applyOutput.includes("/plan open 编辑"),
    apply_surface_renders_plan_card:
      applyOutput.includes("╭─ 将要实现的计划")
      && applyOutput.includes("│ Contract Plan")
      && applyOutput.includes("│ 目标 ")
      && applyOutput.includes("│ 验证 ")
      && applyOutput.includes("╰─ 确认"),
    apply_surface_hides_machine_fields:
      !applyOutput.includes("plan_id=")
      && !applyOutput.includes("session_key=")
      && !applyOutput.includes("approved_snapshot_path"),
    latest_plan_status_surface_is_human:
      latestPlanStatusCode === 0
      && stripAnsi(latestPlanStatusOutput).includes("最近计划状态")
      && stripAnsi(latestPlanStatusOutput).includes("当前没有活跃计划。")
      && stripAnsi(latestPlanStatusOutput).includes("最近计划 contract cleanup · 已执行"),
    latest_plan_status_surface_hides_plan_id:
      typeof activePlanIdBeforeApply === "string"
      && !latestPlanStatusOutput.includes(activePlanIdBeforeApply)
      && !latestPlanStatusOutput.includes("plan_id")
      && !latestPlanStatusOutput.includes("p_contract"),
    apply_surface_hides_plan_metadata_preview:
      !applyOutput.includes("session_id:")
      && !applyOutput.includes("plan_id:")
      && !applyOutput.includes("seq:")
      && !applyOutput.includes("status:"),
    apply_surface_does_not_echo_literal_trigger:
      !applyOutput.includes("Implement the plan."),
    execute_exits_plan_only: runtimeState.getPlanMode() === "normal",
    execute_clears_active_plan_meta: runtimeState.getPlanMeta() === undefined,
    events_has_apply_succeeded: eventsText.includes("\"event\":\"plan_apply_succeeded\""),
    events_has_verification_pending: eventsText.includes("\"event\":\"plan_verification_pending\""),
    stderr_empty_on_success_path: stderr.trim().length === 0,
  };
}
