import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startMockModelServer } from "../../../src/extensions/contracts/_shared/mock-model-server.mjs";
import {
  assertSuccess,
  contractsRoot,
  isRecord,
  logRetry,
  logStep,
  makeTempDir,
  parseJsonOutput,
  repoRoot,
  reserveFreePort,
  runCommand,
  runCommandAsync,
  runContract,
  runContractAsync,
  runTsContract,
  sleepMs,
} from "../harness.mjs";
export async function runRuntimeInteractivePlanFlowSmoke() {
  const planModeFlowResult = runContract("start-smoke-contract.mjs", "start-plan-mode-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const planModeFlowPayload = parseJsonOutput(
    "start-smoke-contract start-plan-mode-flow",
    planModeFlowResult.stdout,
  );
  assert.equal(planModeFlowPayload.exit_code, 0);
  assert.equal(Number(planModeFlowPayload.plan_entry_count) >= 1, true);
  assert.equal(planModeFlowPayload.plan_active_exists, true);
  assert.equal(String(planModeFlowPayload.plan_active_id || "").length > 0, true);
  assert.equal(planModeFlowPayload.review_failed_marker_seen, true);
  assert.equal(planModeFlowPayload.review_failed_recommends_refine, true);
  assert.equal(planModeFlowPayload.review_failed_avoids_execute_recommendation, true);
  assert.equal(planModeFlowPayload.review_failed_validation_command_gap_seen, true);
  assert.equal(planModeFlowPayload.review_blocked_marker_seen, false);
  assert.equal(planModeFlowPayload.plan_cancelled_marker_seen, false);
  assert.equal(planModeFlowPayload.plan_final_status_line_seen, true);
  assert.equal(planModeFlowPayload.plan_open_script_notice_hidden, true);
  assert.equal(planModeFlowPayload.plan_status_preview_hides_machine_metadata, true);
  assert.equal(planModeFlowPayload.plan_draft_status_seen, true);
  assert.equal(planModeFlowPayload.plan_draft_status_has_path, true);
  assert.equal(planModeFlowPayload.plan_draft_status_has_read_only_boundary, true);
  assert.equal(planModeFlowPayload.plan_draft_status_has_refine_hint, true);
  assert.equal(planModeFlowPayload.plan_draft_status_avoids_legacy_empty_message, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_seen, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_has_path, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_has_goal, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_read_only_seen, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_working_notice_seen, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_hides_absolute_path, true);
  assert.equal(planModeFlowPayload.plan_status_preview_hides_required_placeholder, true);
  assert.equal(planModeFlowPayload.plan_current_display_seen, true);
  assert.equal(planModeFlowPayload.plan_current_display_has_plan_open_hint, true);
  assert.equal(planModeFlowPayload.plan_status_uses_relative_plan_file, true);
  assert.equal(planModeFlowPayload.plan_status_hides_absolute_plan_file, true);
  assert.equal(planModeFlowPayload.plan_status_omits_legacy_next_line, true);
  assert.equal(planModeFlowPayload.plan_status_omits_legacy_focus_line, true);
  assert.equal(planModeFlowPayload.plan_status_omits_quality_noise, true);
  assert.equal(planModeFlowPayload.plan_status_hides_redundant_stored_state, true);
  assert.equal(planModeFlowPayload.plan_status_next_line_avoids_reason_dump, true);
  assert.equal(planModeFlowPayload.plan_last_status, "review_failed");
  assert.equal(Number(planModeFlowPayload.plan_last_review_fail_count) >= 1, true);
  assert.equal(Number(planModeFlowPayload.plan_last_blocked_count), 0);
  assert.equal(planModeFlowPayload.events_has_plan_review_failed, true);
  assert.equal(planModeFlowPayload.events_has_plan_mode_cancelled, false);
  assert.equal(Number(planModeFlowPayload.events_count) >= 1, true);
  assert.equal(typeof planModeFlowPayload.events_path, "string");
  assert.equal(String(planModeFlowPayload.events_path).trim().length > 0, true);
  logStep("start-smoke-contract start-plan-mode-flow", {
    events: planModeFlowPayload.events_count,
  });

  const bareInteractiveFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-bare-interactive-session-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const bareInteractiveFlowPayload = parseJsonOutput(
    "start-smoke-contract start-bare-interactive-session-flow",
    bareInteractiveFlowResult.stdout,
  );
  assert.equal(bareInteractiveFlowPayload.exit_code, 0);
  assert.equal(bareInteractiveFlowPayload.has_start_banner, true);
  assert.equal(bareInteractiveFlowPayload.has_status_snapshot, true);
  assert.equal(
    bareInteractiveFlowPayload.startup_suppresses_legacy_store_migration_warning,
    true,
  );
  assert.equal(bareInteractiveFlowPayload.has_no_command_hint, true);
  assert.equal(bareInteractiveFlowPayload.has_no_unsupported_command_error, true);
  logStep("start-smoke-contract start-bare-interactive-session-flow");

  const interactiveDiagnosticsCompactFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-diagnostics-compact-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const interactiveDiagnosticsCompactFlowPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-diagnostics-compact-flow",
    interactiveDiagnosticsCompactFlowResult.stdout,
  );
  assert.equal(interactiveDiagnosticsCompactFlowPayload.exit_code, 0);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.diagnostic_mode, "compact");
  assert.equal(interactiveDiagnosticsCompactFlowPayload.has_process_lines, false);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.has_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.has_machine_process_lines, false);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.has_machine_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.stderr_has_event_lines, false);
  assert.equal(typeof interactiveDiagnosticsCompactFlowPayload.stderr_has_runtime_error, "boolean");
  logStep("start-smoke-contract start-interactive-diagnostics-compact-flow");

  const interactiveDiagnosticsVerboseFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-diagnostics-verbose-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const interactiveDiagnosticsVerboseFlowPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-diagnostics-verbose-flow",
    interactiveDiagnosticsVerboseFlowResult.stdout,
  );
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.exit_code, 0);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.diagnostic_mode, "verbose");
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_process_lines, true);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_machine_process_lines, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_machine_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_short_process_summary_code, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.stderr_has_event_lines, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.stderr_has_trace_lines, false);
  logStep("start-smoke-contract start-interactive-diagnostics-verbose-flow");

  const interactiveDiagnosticsTraceFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-diagnostics-trace-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const interactiveDiagnosticsTraceFlowPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-diagnostics-trace-flow",
    interactiveDiagnosticsTraceFlowResult.stdout,
  );
  assert.equal(interactiveDiagnosticsTraceFlowPayload.exit_code, 0);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.diagnostic_mode, "trace");
  assert.equal(interactiveDiagnosticsTraceFlowPayload.has_process_lines, false);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.has_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.has_machine_process_lines, false);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.has_machine_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.stderr_has_event_lines, true);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.stderr_has_trace_lines, true);
  logStep("start-smoke-contract start-interactive-diagnostics-trace-flow");

  const diagnosticsCommandFlows = [
    {
      contract: "start-interactive-diagnostics-plan-compact-flow",
      mode: "compact",
      markerKey: "has_plan_marker",
    },
    {
      contract: "start-interactive-diagnostics-plan-verbose-flow",
      mode: "verbose",
      markerKey: "has_plan_marker",
    },
    {
      contract: "start-interactive-diagnostics-skill-creator-compact-flow",
      mode: "compact",
      markerKey: "has_skill_creator_marker",
    },
    {
      contract: "start-interactive-diagnostics-skill-creator-verbose-flow",
      mode: "verbose",
      markerKey: "has_skill_creator_marker",
    },
    {
      contract: "start-interactive-diagnostics-user-command-compact-flow",
      mode: "compact",
      markerKey: "has_commands_marker",
    },
    {
      contract: "start-interactive-diagnostics-user-command-verbose-flow",
      mode: "verbose",
      markerKey: "has_commands_marker",
    },
  ];
  for (const flow of diagnosticsCommandFlows) {
    const diagnosticsFlowResult = runContract(
      "start-smoke-contract.mjs",
      flow.contract,
      [
        "--repo-root",
        repoRoot,
      ],
    );
    const diagnosticsFlowPayload = parseJsonOutput(
      `start-smoke-contract ${flow.contract}`,
      diagnosticsFlowResult.stdout,
    );
    assert.equal(diagnosticsFlowPayload.exit_code, 0);
    assert.equal(
      diagnosticsFlowPayload.has_process_lines,
      flow.mode === "verbose",
    );
    assert.equal(diagnosticsFlowPayload.has_machine_process_lines, false);
    assert.equal(diagnosticsFlowPayload.has_machine_process_summary_lines, false);
    if (flow.mode === "compact") {
      assert.equal(diagnosticsFlowPayload.has_process_summary_lines, false);
    }
    if (diagnosticsFlowPayload.has_process_summary_lines) {
      assert.equal(diagnosticsFlowPayload.has_short_process_summary_code, true);
    }
    assert.equal(Boolean(diagnosticsFlowPayload[flow.markerKey]), true);
    if (flow.contract.includes("diagnostics-skill-creator")) {
      assert.equal(diagnosticsFlowPayload.skill_creator_surface_avoids_legacy_marker, true);
      assert.equal(diagnosticsFlowPayload.has_human_skill_creator_surface, true);
    }
    if (flow.contract.includes("diagnostics-user-command")) {
      assert.equal(diagnosticsFlowPayload.command_surface_avoids_legacy_marker, true);
      assert.equal(diagnosticsFlowPayload.has_human_created_command_surface, true);
    }
    if (flow.command_flow === "plan" || flow.contract.includes("diagnostics-plan")) {
      assert.equal(diagnosticsFlowPayload.has_entered_plan_mode_surface, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_path_line, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_goal_line, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_read_only_line, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_working_notice, true);
      assert.equal(diagnosticsFlowPayload.has_plan_draft_surface, true);
      assert.equal(diagnosticsFlowPayload.has_plan_draft_refine_hint, true);
      assert.equal(diagnosticsFlowPayload.plan_draft_avoids_legacy_empty_message, true);
    }
    if (flow.mode === "compact") {
      assert.equal(diagnosticsFlowPayload.stderr_has_event_lines, false);
    } else {
      assert.equal(diagnosticsFlowPayload.stderr_has_event_lines, false);
    }
    logStep(`start-smoke-contract ${flow.contract}`);
  }

  const startImOnlyRejectFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-im-only-reject-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const startImOnlyRejectFlowPayload = parseJsonOutput(
    "start-smoke-contract start-im-only-reject-flow",
    startImOnlyRejectFlowResult.stdout,
  );
  assert.equal(Number(startImOnlyRejectFlowPayload.exit_code), 2);
  assert.equal(startImOnlyRejectFlowPayload.has_im_only_error, true);
  assert.equal(startImOnlyRejectFlowPayload.has_im_only_hint_context, true);
  assert.equal(startImOnlyRejectFlowPayload.has_im_only_hint_bare, true);
  assert.equal(startImOnlyRejectFlowPayload.has_start_banner, false);
  logStep("start-smoke-contract start-im-only-reject-flow");

  const sessionCommandFallbackResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-session-commands-fallback-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const sessionCommandFallbackPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-session-commands-fallback-flow",
    sessionCommandFallbackResult.stdout,
  );
  assert.equal(sessionCommandFallbackPayload.exit_code, 0);
  assert.equal(Number(sessionCommandFallbackPayload.session_count) >= 2, true);
  assert.equal(sessionCommandFallbackPayload.has_switch_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_continue_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_resume_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_rewind_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_sessions_overview, true);
  assert.equal(sessionCommandFallbackPayload.session_surface_avoids_legacy_plain_namespace, true);
  assert.equal(sessionCommandFallbackPayload.session_switch_surface_is_human, true);
  assert.equal(sessionCommandFallbackPayload.has_session_title_main, true);
  assert.equal(sessionCommandFallbackPayload.has_session_title_untitled, true);
  assert.equal(sessionCommandFallbackPayload.has_status_snapshot, true);
  assert.equal(sessionCommandFallbackPayload.has_status_theme_set, true);
  assert.equal(sessionCommandFallbackPayload.has_status_layout_set, true);
  assert.equal(sessionCommandFallbackPayload.has_status_tokens_off, true);
  assert.equal(sessionCommandFallbackPayload.has_status_theme_current, true);
  assert.equal(sessionCommandFallbackPayload.has_status_layout_current, true);
  assert.equal(sessionCommandFallbackPayload.has_status_tokens_current_off, true);
  logStep("start-smoke-contract start-interactive-session-commands-fallback-flow");

  const sessionMenuViewModelResult = runContract(
    "start-smoke-contract.mjs",
    "start-session-menu-view-model-contract",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const sessionMenuViewModelPayload = parseJsonOutput(
    "start-smoke-contract start-session-menu-view-model-contract",
    sessionMenuViewModelResult.stdout,
  );
  assert.equal(sessionMenuViewModelPayload.exit_code, 0);
  assert.equal(sessionMenuViewModelPayload.sessions_title, "会话管理");
  assert.equal(sessionMenuViewModelPayload.switch_title, "切换会话");
  assert.equal(sessionMenuViewModelPayload.continue_title, "从会话继续");
  assert.equal(sessionMenuViewModelPayload.resume_title, "恢复会话");
  assert.equal(sessionMenuViewModelPayload.rewind_title, "回退会话");
  assert.equal(sessionMenuViewModelPayload.sessions_has_create_item, true);
  assert.equal(sessionMenuViewModelPayload.continue_has_create_item, false);
  assert.equal(sessionMenuViewModelPayload.resume_has_create_item, false);
  assert.equal(sessionMenuViewModelPayload.rewind_has_create_item, false);
  assert.equal(sessionMenuViewModelPayload.sessions_summary_visible, true);
  assert.equal(sessionMenuViewModelPayload.switch_includes_session_key, true);
  assert.equal(sessionMenuViewModelPayload.resume_includes_session_key, true);
  assert.equal(sessionMenuViewModelPayload.rewind_includes_session_key, true);
  assert.equal(sessionMenuViewModelPayload.sessions_omits_session_key, true);
  assert.equal(sessionMenuViewModelPayload.continue_current_skip_hint, true);
  assert.equal(sessionMenuViewModelPayload.resume_current_hint, true);
  assert.equal(sessionMenuViewModelPayload.sessions_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.switch_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.continue_hint_is_reference_continue, true);
  assert.equal(sessionMenuViewModelPayload.resume_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.rewind_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.session_hints_omit_secondary_key_chords, true);
  assert.equal(sessionMenuViewModelPayload.session_menu_ops_cancel_is_silent_source, true);
  assert.equal(sessionMenuViewModelPayload.session_menu_ops_rewind_surface_avoids_legacy_marker, true);
  assert.equal(sessionMenuViewModelPayload.session_menu_ops_rewind_file_filter_prompt_is_human, true);
  assert.equal(sessionMenuViewModelPayload.session_ops_rewind_surface_avoids_legacy_marker, true);
  assert.equal(sessionMenuViewModelPayload.rewind_store_summary_avoids_legacy_marker, true);
  assert.equal(Number(sessionMenuViewModelPayload.sessions_initial_index), 1);
  assert.equal(Number(sessionMenuViewModelPayload.continue_initial_index), 0);
  assert.equal(Number(sessionMenuViewModelPayload.resume_initial_index), 0);
  assert.equal(Number(sessionMenuViewModelPayload.rewind_initial_index), 0);
  assert.equal(Number(sessionMenuViewModelPayload.sessions_item_count), 3);
  assert.equal(Number(sessionMenuViewModelPayload.continue_item_count), 2);
  assert.equal(Number(sessionMenuViewModelPayload.resume_item_count), 2);
  assert.equal(Number(sessionMenuViewModelPayload.rewind_item_count), 2);
  logStep("start-smoke-contract start-session-menu-view-model-contract");

  const planConcurrencyFlowResult = runContract("start-smoke-contract.mjs", "start-plan-concurrency-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const planConcurrencyPayload = parseJsonOutput(
    "start-smoke-contract start-plan-concurrency-flow",
    planConcurrencyFlowResult.stdout,
  );
  assert.equal(planConcurrencyPayload.exit_code, 0);
  assert.equal(Number(planConcurrencyPayload.append_attempts) >= 4, true);
  assert.equal(Number(planConcurrencyPayload.append_hits), Number(planConcurrencyPayload.append_attempts));
  assert.equal(Number(planConcurrencyPayload.lock_timeout_count), 0);
  assert.equal(Number(planConcurrencyPayload.events_count) >= 1, true);
  assert.equal(typeof planConcurrencyPayload.events_path, "string");
  assert.equal(String(planConcurrencyPayload.events_path).trim().length > 0, true);
  logStep("start-smoke-contract start-plan-concurrency-flow", {
    attempts: planConcurrencyPayload.append_attempts,
    hits: planConcurrencyPayload.append_hits,
  });
  return {
    planModeEventsPath: String(planModeFlowPayload.events_path),
    planConcurrencyEventsPath: String(planConcurrencyPayload.events_path),
  };
}
