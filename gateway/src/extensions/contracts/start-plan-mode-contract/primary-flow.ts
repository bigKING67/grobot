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
  const cleanStdoutAfterEnter = stripAnsi(stdoutAfterEnter);
  const cleanDraftOpenOutput = stripAnsi(draftOpenOutput);
  const cleanRefineOutput = stripAnsi(refineOutput);
  const cleanReadyOutput = stripAnsi(readyOutput);
  const cleanKeepPlanningOutput = stripAnsi(keepPlanningOutput);
  const cleanOpenOutput = stripAnsi(openOutput);
  const cleanScriptOpenOutput = stripAnsi(scriptOpenOutput);
  const cleanPlanGoalInPlanOutput = stripAnsi(planGoalInPlanOutput);
  const cleanRemovedBenchmarkOutput = stripAnsi(removedBenchmarkOutput);
  const cleanApplyOutput = stripAnsi(applyOutput);
  const cleanLatestPlanStatusOutput = stripAnsi(latestPlanStatusOutput);

  return {
    enter_plan_message_mode_handled: enter.handled && enter.code === 0,
    enter_plan_sets_plan_only: planModeAfterEnter === "plan_only",
    enter_plan_stdout_is_human:
      cleanStdoutAfterEnter.includes("Entered plan mode")
      && cleanStdoutAfterEnter.includes("Grobot is exploring and designing the implementation plan.")
      && !cleanStdoutAfterEnter.includes("session_key=")
      && !cleanStdoutAfterEnter.includes("plan_id=")
      && !cleanStdoutAfterEnter.includes("file=")
      && !cleanStdoutAfterEnter.includes("[plan] entered PLAN_ONLY"),
    enter_plan_surface_has_relative_planning_path:
      cleanStdoutAfterEnter.includes("plan file .grobot/plans/"),
    enter_plan_surface_has_goal:
      cleanStdoutAfterEnter.includes("goal contract cleanup"),
    enter_plan_surface_has_read_only_boundary:
      cleanStdoutAfterEnter.includes("Before confirmation, plan mode only reads and plans."),
    enter_plan_surface_hides_absolute_plan_path:
      !stdoutAfterEnter.includes(workDir),
    enter_plan_surface_order_is_stable:
      cleanStdoutAfterEnter.indexOf("Entered plan mode") >= 0
      && cleanStdoutAfterEnter.indexOf("plan file ") > cleanStdoutAfterEnter.indexOf("Entered plan mode")
      && cleanStdoutAfterEnter.indexOf("goal ") > cleanStdoutAfterEnter.indexOf("plan file "),
    draft_plan_surface_handled: draftOpen.handled && draftOpen.code === 0,
    draft_plan_surface_uses_status_title:
      cleanDraftOpenOutput.includes("Plan draft"),
    draft_plan_surface_uses_relative_plan_file:
      draftOpenOutput.includes(".grobot/plans/"),
    draft_plan_surface_uses_info_panel_rows:
      cleanDraftOpenOutput.includes("Draft created")
      && cleanDraftOpenOutput.includes("• Draft created")
      && cleanDraftOpenOutput.includes("  ⎿  .grobot/plans/"),
    draft_plan_surface_has_read_only_boundary:
      cleanDraftOpenOutput.includes("Before final confirmation, plan mode only reads and plans."),
    draft_plan_surface_has_refine_hint:
      cleanDraftOpenOutput.includes('Type more details to refine it, or use "/plan open" to edit the draft.'),
    draft_plan_surface_hides_absolute_path:
      !draftOpenOutput.includes(workDir),
    draft_plan_surface_hides_required_placeholders:
      !draftOpenOutput.includes("__REQUIRED__"),
    draft_plan_surface_avoids_legacy_empty_message:
      !draftOpenOutput.includes("Already in plan mode. No plan written yet."),
    refine_plan_turn_handled: refine === 0,
    refine_plan_turn_surface_matches_reference_shape:
      cleanRefineOutput.includes("•")
      && cleanRefineOutput.includes("  ⎿")
      && cleanRefineOutput.includes("Plan needs refinement")
      && cleanRefineOutput.includes('Type more details to refine it, or use "/plan open" to edit the draft.'),
    ready_plan_turn_handled: ready === 0,
    ready_surface_matches_reference_shape:
      cleanReadyOutput.includes("Ready to implement?")
      && !cleanReadyOutput.includes("● Ready to implement?")
      && cleanReadyOutput.includes("Grobot plan:")
      && cleanReadyOutput.includes("Confirm the plan before execution.")
      && cleanReadyOutput.includes("Start implementation?")
      && cleanReadyOutput.includes("❯ Confirm, implement plan")
      && cleanReadyOutput.includes("  Refine plan")
      && cleanReadyOutput.includes("Edit: /plan open"),
    ready_surface_has_plan_separators:
      readyOutput.split("\n").some((line) => /^┄{24,}$/.test(line))
      && readyOutput.split("\n").some((line) => /^─{24,}$/.test(line)),
    ready_approval_callback_receives_current_plan:
      keepPlanning === 0
      && readyApprovalRequests.length === 1
      && readyApprovalRequests[0]?.planPath === planPath
      && readyApprovalRequests[0]?.planContent.includes("# Contract Plan"),
    ready_approval_keep_planning_skips_fallback_surface:
      cleanKeepPlanningOutput.includes("Still in plan mode")
      && !cleanKeepPlanningOutput.includes("Ready to implement?"),
    ready_approval_keep_planning_matches_reference_shape:
      cleanKeepPlanningOutput.includes("Still in plan mode")
      && cleanKeepPlanningOutput.includes("•")
      && cleanKeepPlanningOutput.includes("  ⎿")
      && cleanKeepPlanningOutput.includes('Type more details to refine it, or use "/plan open" to edit the draft.'),
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
      cleanOpenOutput.includes("Current plan")
      && !cleanOpenOutput.includes("● Current plan")
      && cleanOpenOutput.includes("# Contract Plan")
      && (
        cleanOpenOutput.includes('Use "/plan open" to edit this plan')
        || cleanOpenOutput.includes('Use "/plan open" to edit this plan in vim')
      ),
    open_plan_surface_has_editor_hint:
      cleanOpenOutput.includes('Use "/plan open" to edit this plan in vim'),
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
      && cleanScriptOpenOutput.includes("Current plan")
      && cleanScriptOpenOutput.includes("# Contract Plan")
      && (
        cleanScriptOpenOutput.includes('Use "/plan open" to edit this plan')
        || cleanScriptOpenOutput.includes('Use "/plan open" to edit this plan in vim')
      ),
    script_plan_surface_has_editor_hint:
      cleanScriptOpenOutput.includes('Use "/plan open" to edit this plan in vim'),
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
      && cleanPlanGoalInPlanOutput.includes("Current plan")
      && cleanPlanGoalInPlanOutput.includes("# Contract Plan"),
    plan_goal_in_plan_mode_skips_new_query:
      executeCountAfterPlanGoalInPlan === executeCountBeforePlanGoalInPlan,
    removed_plan_benchmark_surface_is_human:
      removedBenchmark.handled
      && removedBenchmark.code === 0
      && cleanRemovedBenchmarkOutput.includes("Plan")
      && cleanRemovedBenchmarkOutput.includes("•")
      && cleanRemovedBenchmarkOutput.includes("Unsupported /plan subcommand")
      && cleanRemovedBenchmarkOutput.includes("/plan, /plan <goal>, or /plan open"),
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
      cleanApplyOutput.includes("Plan confirmed")
      && !cleanApplyOutput.includes("● Plan confirmed")
      && cleanApplyOutput.includes("confirmed")
      && cleanApplyOutput.includes("Plan to implement")
      && cleanApplyOutput.includes("Starting implementation from the approved snapshot"),
    apply_surface_has_saved_plan_hint:
      cleanApplyOutput.includes("• confirmed · Plan saved: .grobot/plans/")
      && cleanApplyOutput.includes("/plan open to edit"),
    apply_surface_renders_plan_card:
      cleanApplyOutput.includes("╭─ Plan to implement")
      && cleanApplyOutput.includes("│ Contract Plan")
      && cleanApplyOutput.includes("│ Goal ")
      && cleanApplyOutput.includes("│ Validation ")
      && cleanApplyOutput.includes("╰─ approved"),
    apply_surface_hides_machine_fields:
      !applyOutput.includes("plan_id=")
      && !applyOutput.includes("session_key=")
      && !applyOutput.includes("approved_snapshot_path"),
    latest_plan_status_surface_is_human:
      latestPlanStatusCode === 0
      && cleanLatestPlanStatusOutput.includes("Recent plan status")
      && cleanLatestPlanStatusOutput.includes("No active plan.")
      && cleanLatestPlanStatusOutput.includes("latest plan contract cleanup · applied"),
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
