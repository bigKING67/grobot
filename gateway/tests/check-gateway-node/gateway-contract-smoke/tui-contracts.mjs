import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  assertSuccess,
  contractsRoot,
  isRecord,
  logStep,
  makeTempDir,
  parseJsonOutput,
  runCommand,
  runCommandAsync,
  runContract,
  runTsContract,
  writeFixtureFile,
} from "../harness.mjs";

function assertPayloadFlags(payload, flagNames) {
  for (const flagName of flagNames) assert.equal(payload[flagName], true);
}

export async function runTuiContracts() {
  const browserStructuredContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/browser-structured-mcp-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("browser-structured-mcp-contract", browserStructuredContractResult);
  const browserStructuredContractPayload = parseJsonOutput(
    "browser-structured-mcp-contract",
    browserStructuredContractResult.stdout,
  );
  assert.equal(browserStructuredContractPayload.ok, true);
  assert.equal(typeof browserStructuredContractPayload.tool_call_error_code, "string");
  assert.equal(typeof browserStructuredContractPayload.tool_call_retryable, "boolean");
  assert.equal(Array.isArray(browserStructuredContractPayload.tool_call_transport_attempts), true);
  logStep("browser-structured-mcp-contract");
  const browserDoctorSchemaResult = runCommand("node", [
    "gateway/src/extensions/contracts/browser-doctor-json-schema-contract.mjs",
  ], {
    timeoutMs: 30_000,
  });
  assertSuccess("browser-doctor-json-schema-contract", browserDoctorSchemaResult);
  const browserDoctorSchemaPayload = parseJsonOutput(
    "browser-doctor-json-schema-contract",
    browserDoctorSchemaResult.stdout,
  );
  assert.equal(browserDoctorSchemaPayload.ok, true);
  assert.equal(browserDoctorSchemaPayload.validated_examples, 2);
  assert.equal(Array.isArray(browserDoctorSchemaPayload.doctor_path_enum), true);
  assert.equal(browserDoctorSchemaPayload.doctor_path_enum.includes("cdp"), true);
  logStep("browser-doctor-json-schema-contract");
  const providerHealthFormatResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/provider-health-format-contract.ts",
  ]);
  assertSuccess("provider-health-format-contract", providerHealthFormatResult);
  const providerHealthFormatPayload = parseJsonOutput(
    "provider-health-format-contract",
    providerHealthFormatResult.stdout,
  );
  assert.equal(providerHealthFormatPayload.has_header, true);
  assert.equal(providerHealthFormatPayload.has_session, true);
  assert.equal(providerHealthFormatPayload.hides_raw_session_namespace, true);
  assert.equal(providerHealthFormatPayload.has_sticky, true);
  assert.equal(providerHealthFormatPayload.hides_raw_sticky_label, true);
  assert.equal(providerHealthFormatPayload.has_alpha_closed, true);
  assert.equal(providerHealthFormatPayload.has_beta_open, true);
  assert.equal(providerHealthFormatPayload.hides_raw_status_codes, true);
  assert.equal(providerHealthFormatPayload.has_latency_field, true);
  assert.equal(providerHealthFormatPayload.has_error_rate_field, true);
  assert.equal(providerHealthFormatPayload.has_rpm_field, true);
  assert.equal(providerHealthFormatPayload.has_human_cooldown, true);
  assert.equal(providerHealthFormatPayload.has_human_error_class, true);
  assert.equal(providerHealthFormatPayload.hides_raw_error_class, true);
  assert.equal(providerHealthFormatPayload.hides_raw_rpm_burst_labels, true);
  assert.equal(providerHealthFormatPayload.uses_reference_detail_rows, true);
  assert.equal(providerHealthFormatPayload.avoids_machine_prefix, true);
  logStep("provider-health-format-contract");

  const cliUsageContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-usage-contract.ts",
  ]);
  assertSuccess("cli-usage-contract", cliUsageContractResult);
  const cliUsageContractPayload = parseJsonOutput(
    "cli-usage-contract",
    cliUsageContractResult.stdout,
  );
  assert.equal(cliUsageContractPayload.has_reference_title, true);
  assert.equal(cliUsageContractPayload.has_local_tui_entry, true);
  assert.equal(cliUsageContractPayload.uses_reference_command_rows, true);
  assert.equal(cliUsageContractPayload.has_status_summary_copy, true);
  assert.equal(cliUsageContractPayload.has_session_recovery_rows, true);
  assert.equal(cliUsageContractPayload.has_interactive_help_hint, true);
  assert.equal(cliUsageContractPayload.avoids_legacy_dev_cli_copy, true);
  assert.equal(cliUsageContractPayload.avoids_long_option_walls, true);
  assert.equal(cliUsageContractPayload.avoids_machine_help_terms, true);
  assert.equal(cliUsageContractPayload.lines_within_reference_width, true);
  assert.equal(cliUsageContractPayload.ends_without_extra_blank, true);
  logStep("cli-usage-contract");

  const cliHelpScreenContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-help-screen-contract.ts",
  ]);
  assertSuccess("cli-help-screen-contract", cliHelpScreenContractResult);
  const cliHelpScreenPayload = parseJsonOutput(
    "cli-help-screen-contract",
    cliHelpScreenContractResult.stdout,
  );
  assert.equal(cliHelpScreenPayload.has_reference_header, true);
  assert.equal(cliHelpScreenPayload.has_reference_intro, true);
  assert.equal(cliHelpScreenPayload.has_shortcuts_section, true);
  assert.equal(cliHelpScreenPayload.has_ctrl_r, true);
  assert.equal(cliHelpScreenPayload.has_esc, true);
  assert.equal(cliHelpScreenPayload.has_commands_section, true);
  assert.equal(cliHelpScreenPayload.has_sessions_command, true);
  assert.equal(cliHelpScreenPayload.has_resume_command, true);
  assert.equal(cliHelpScreenPayload.has_rewind_command, true);
  assert.equal(cliHelpScreenPayload.has_model_command, true);
  assert.equal(cliHelpScreenPayload.has_plan_command, true);
  assert.equal(cliHelpScreenPayload.has_status_command, true);
  assert.equal(cliHelpScreenPayload.has_help_command, true);
  assert.equal(cliHelpScreenPayload.has_exit_command, true);
  assert.equal(cliHelpScreenPayload.avoids_pipe_alias_rows, true);
  assert.equal(cliHelpScreenPayload.has_utilities_section, true);
  assert.equal(cliHelpScreenPayload.has_health_command, true);
  assert.equal(cliHelpScreenPayload.has_context_command, true);
  assert.equal(cliHelpScreenPayload.has_memory_command, true);
  assert.equal(cliHelpScreenPayload.has_skills_command, true);
  assert.equal(cliHelpScreenPayload.has_mcp_command, true);
  assert.equal(cliHelpScreenPayload.health_copy_is_human, true);
  assert.equal(cliHelpScreenPayload.help_copy_hides_english_operator_terms, true);
  assert.equal(cliHelpScreenPayload.has_notes_section, true);
  assert.equal(cliHelpScreenPayload.has_compatibility_note, true);
  assert.equal(cliHelpScreenPayload.has_checkpoint_alias_note, true);
  assert.equal(cliHelpScreenPayload.uses_compact_notes, true);
  assert.equal(cliHelpScreenPayload.avoids_document_style_notes, true);
  assert.equal(cliHelpScreenPayload.uses_compact_overview_descriptions, true);
  assert.equal(cliHelpScreenPayload.avoids_long_registry_descriptions, true);
  assert.equal(cliHelpScreenPayload.uses_reference_bullets, true);
  assert.equal(cliHelpScreenPayload.uses_reference_overview_instead_of_full_command_dump, true);
  assert.equal(cliHelpScreenPayload.avoids_legacy_headers, true);
  assert.equal(cliHelpScreenPayload.avoids_machine_prefix, true);
  assert.equal(cliHelpScreenPayload.interactive_has_ansi, true);
  assert.equal(cliHelpScreenPayload.regular_lines_within_width, true);
  assert.equal(cliHelpScreenPayload.regular_uses_terminal_width_budget, true);
  assert.equal(cliHelpScreenPayload.regular_avoids_help_over_truncation, true);
  assert.equal(cliHelpScreenPayload.narrow_lines_within_width, true);
  assert.equal(cliHelpScreenPayload.ends_with_spacing, true);
  assert.equal(cliHelpScreenPayload.render_keeps_terminal_width_explicit, true);
  logStep("cli-help-screen-contract");

  const cliInfoPanelContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-info-panel-contract.ts",
  ]);
  assertSuccess("cli-info-panel-contract", cliInfoPanelContractResult);
  const cliInfoPanelPayload = parseJsonOutput(
    "cli-info-panel-contract",
    cliInfoPanelContractResult.stdout,
  );
  assert.equal(cliInfoPanelPayload.interactive_has_ansi, true);
  assert.equal(cliInfoPanelPayload.interactive_title_supports_plan_tone, true);
  assert.equal(cliInfoPanelPayload.interactive_uses_reference_context_copy, true);
  assert.equal(cliInfoPanelPayload.has_title, true);
  assert.equal(cliInfoPanelPayload.has_subtitle, true);
  assert.equal(cliInfoPanelPayload.uses_reference_row_bullets, true);
  assert.equal(cliInfoPanelPayload.uses_reference_detail_rows, true);
  assert.equal(cliInfoPanelPayload.avoids_legacy_title_bullet, true);
  assert.equal(cliInfoPanelPayload.avoids_machine_prefix, true);
  assert.equal(cliInfoPanelPayload.narrow_lines_within_width, true);
  assert.equal(cliInfoPanelPayload.ends_with_newline, true);
  assert.equal(cliInfoPanelPayload.render_keeps_terminal_width_explicit, true);
  logStep("cli-info-panel-contract");

  const cliUiRendererContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-ui-renderer-contract.ts",
  ]);
  assertSuccess("cli-ui-renderer-contract", cliUiRendererContractResult);
  const cliUiRendererContractPayload = parseJsonOutput(
    "cli-ui-renderer-contract",
    cliUiRendererContractResult.stdout,
  );
  assert.equal(cliUiRendererContractPayload.interactive_mode, "interactive_tty");
  assert.equal(cliUiRendererContractPayload.plain_mode, "plain_tty");
  assert.equal(cliUiRendererContractPayload.non_tty_mode, "non_tty");
  assert.equal(cliUiRendererContractPayload.menu_plain_has_ansi, false);
  assert.equal(cliUiRendererContractPayload.menu_non_tty_has_ansi, false);
  assertPayloadFlags(cliUiRendererContractPayload, [
    "startup_has_title", "startup_has_brand_label",
    "startup_has_logo_headline", "startup_has_logo_runtime_line",
    "startup_has_session_line", "startup_has_no_command_hint",
    "startup_has_tips_title", "startup_has_recent_activity_title",
    "startup_has_recent_activity_empty_or_items", "startup_has_developed_by_67",
    "startup_has_no_dev_label", "startup_interactive_title_has_brand_color",
    "startup_interactive_title_has_muted_version_color", "startup_feed_title_uses_brand_color",
    "startup_feed_title_avoids_accent_color", "startup_feed_footer_uses_muted_color",
    "startup_feed_footer_avoids_info_color", "startup_has_no_join_artifact",
    "startup_has_no_tee_glyph", "startup_has_no_outer_round_frame",
    "startup_lines_within_terminal", "startup_feed_divider_count_expected",
    "startup_brand_symbol_lines_within_terminal", "startup_brand_symbol_has_claude_like_height",
    "startup_registered_symbol_single_width", "menu_interactive_has_ansi",
    "menu_plain_has_pointer", "menu_plain_has_no_thin_pointer",
    "menu_interactive_has_current_check", "menu_plain_has_secondary_description",
    "menu_hint_is_compact", "menu_hint_has_escape_back",
    "menu_hint_has_enter_action", "menu_hint_has_navigation_hint",
    "menu_hint_omits_secondary_key_chords", "menu_viewport_has_full_ordinal",
    "menu_viewport_hides_reset_ordinal", "menu_viewport_has_scroll_markers",
    "menu_viewport_has_no_more_text", "menu_direct_render_has_row_scroll_marker",
    "menu_filter_has_compact_status_row", "menu_filter_status_not_in_subtitle",
    "menu_filter_footer_is_compact", "menu_filter_has_no_match_row",
    "menu_filter_no_match_row_is_muted", "menu_filter_status_is_muted",
    "menu_filter_highlights_label_match", "menu_filter_highlight_keeps_plain_text_copy",
    "menu_filter_highlight_keeps_current_suffix",
    "model_picker_has_claude_pointer", "model_picker_has_no_thin_pointer",
    "model_picker_has_pane_divider", "model_picker_interactive_uses_warm_brand_color",
    "model_picker_has_decimal_index", "model_picker_has_no_bracket_index",
    "model_picker_current_uses_check", "model_picker_current_not_parenthesized",
    "model_picker_has_default_suffix", "model_picker_has_footer_hint",
    "model_picker_has_config_scope_subtitle", "model_picker_has_effort_line",
    "model_picker_avoids_stale_session_only_copy", "model_picker_has_config_scope_context",
    "model_picker_active_description_is_muted", "model_picker_has_no_provider_card",
    "model_picker_has_no_startup_badge", "model_picker_has_no_current_badge",
    "model_picker_has_no_reset_badge", "model_picker_has_no_frame",
    "model_picker_interactive_has_no_current_badge", "model_picker_filter_preserves_pane_divider",
    "model_picker_filter_has_compact_status_row", "model_picker_filter_hides_original_hidden_count",
    "model_picker_filter_highlights_label_match", "model_picker_filter_highlight_keeps_default_suffix",
    "ask_user_menu_uses_panel_divider", "ask_user_menu_uses_warm_brand_color",
    "ask_user_menu_has_progress_title", "ask_user_menu_has_input_return_hint",
    "ask_user_menu_preserves_option_descriptions", "ask_user_menu_uses_claude_pointer",
    "plan_approval_menu_has_ready_title", "plan_approval_menu_embeds_plan_markdown",
    "plan_approval_menu_has_reference_prompt", "plan_approval_menu_uses_sticky_footer_order",
    "plan_approval_menu_has_yes_no_options", "plan_approval_menu_has_ctrl_g_edit_hint",
    "plan_approval_menu_shows_saved_after_external_edit", "plan_approval_menu_shows_keep_planning_feedback_hint",
    "plan_approval_menu_preserves_feedback_after_reopen", "plan_approval_menu_uses_plan_mode_color",
    "plan_approval_menu_has_no_default_thin_pointer", "plan_approval_empty_uses_exit_title",
    "plan_approval_empty_uses_reference_copy", "plan_approval_empty_has_yes_no_only",
    "plan_approval_empty_omits_plan_markdown", "model_picker_direct_render_uses_model_visible_count",
    "model_picker_direct_render_shows_hidden_count", "model_picker_direct_render_uses_reference_hidden_count",
    "model_picker_direct_render_shows_non_default_effort", "model_picker_direct_render_has_config_scope_context",
    "model_picker_direct_render_has_row_scroll_marker", "model_picker_long_rows_within_width",
    "model_picker_long_descriptions_do_not_wrap", "model_picker_long_current_suffix_preserved",
    "model_picker_long_default_suffix_preserved", "model_picker_long_effort_unsupported_line",
    "model_picker_narrow_rows_within_width", "model_picker_narrow_hides_description",
    "menu_long_rows_within_width", "menu_long_current_suffix_preserved",
    "menu_default_sanitizes_render_text",
  ]);
  logStep("cli-ui-renderer-contract");

  const cliTurnScreenContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-turn-screen-contract.ts",
  ]);
  assertSuccess("cli-turn-screen-contract", cliTurnScreenContractResult);
  const cliTurnScreenContractPayload = parseJsonOutput(
    "cli-turn-screen-contract",
    cliTurnScreenContractResult.stdout,
  );
  assert.equal(cliTurnScreenContractPayload.management_interactive_matches, true);
  assert.equal(cliTurnScreenContractPayload.management_non_interactive_matches, true);
  assert.equal(cliTurnScreenContractPayload.turn_interrupted_interactive_matches, true);
  assert.equal(cliTurnScreenContractPayload.turn_interrupted_non_interactive_matches, true);
  assert.equal(cliTurnScreenContractPayload.turn_interrupted_avoids_machine_prefix, true);
  assert.equal(cliTurnScreenContractPayload.open_circuit_interactive_is_human_surface, true);
  assert.equal(cliTurnScreenContractPayload.open_circuit_non_interactive_is_human_surface, true);
  assert.equal(cliTurnScreenContractPayload.open_circuit_avoids_machine_prefix, true);
  assert.equal(cliTurnScreenContractPayload.failure_summary_is_human_surface, true);
  assert.equal(cliTurnScreenContractPayload.failure_summary_has_last_error_detail, true);
  assert.equal(cliTurnScreenContractPayload.failure_summary_avoids_machine_prefix, true);
  assert.equal(cliTurnScreenContractPayload.failure_summary_ends_with_newline, true);
  logStep("cli-turn-screen-contract");

  const startTuiSurfaceContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-tui-surface-contract.ts",
  ]);
  assertSuccess("start-tui-surface-contract", startTuiSurfaceContractResult);
  const startTuiSurfaceContractPayload = parseJsonOutput(
    "start-tui-surface-contract",
    startTuiSurfaceContractResult.stdout,
  );
  assert.equal(startTuiSurfaceContractPayload.mcp_strict_failure_is_human_surface, true);
  assert.equal(startTuiSurfaceContractPayload.mcp_strict_failure_has_fix_hint, true);
  assert.equal(
    startTuiSurfaceContractPayload.startup_project_path_uses_user_home_relative_display,
    true,
  );
  assert.equal(
    startTuiSurfaceContractPayload.startup_project_path_does_not_depend_on_grobot_home,
    true,
  );
  assert.equal(startTuiSurfaceContractPayload.scheduler_tick_error_is_human_surface, true);
  assert.equal(startTuiSurfaceContractPayload.scheduler_task_failed_is_human_surface, true);
  assert.equal(startTuiSurfaceContractPayload.memory_maintenance_failed_is_human_surface, true);
  assert.equal(startTuiSurfaceContractPayload.runtime_interrupt_ignored_is_human_surface, true);
  assert.equal(startTuiSurfaceContractPayload.rewind_capture_failed_is_human_surface, true);
  assert.equal(startTuiSurfaceContractPayload.surfaces_avoid_legacy_machine_markers, true);
  assert.equal(startTuiSurfaceContractPayload.surfaces_end_with_newline, true);
  assert.equal(startTuiSurfaceContractPayload.message_mode_compact_disables_turn_diagnostics, true);
  assert.equal(startTuiSurfaceContractPayload.message_mode_verbose_keeps_turn_diagnostics, true);
  logStep("start-tui-surface-contract");

  const cliActivityFeedContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-activity-feed-contract.ts",
  ]);
  assertSuccess("cli-activity-feed-contract", cliActivityFeedContractResult);
  const cliActivityFeedPayload = parseJsonOutput(
    "cli-activity-feed-contract",
    cliActivityFeedContractResult.stdout,
  );
  assertPayloadFlags(cliActivityFeedPayload, [
    "renders_real_tool_rows", "uses_reference_tool_status_dot",
    "renders_unresolved_tool_start_as_dim_status", "unresolved_tool_start_uses_input_summary_without_raw_args",
    "activity_titles_strip_control_sequences_before_render",
    "resolved_tool_start_deduped_by_tool_end", "compact_hides_key_value_details",
    "renders_edit_with_diff_stats", "renders_failed_bash",
    "bash_exit_code_failure_normalized_from_ok_status", "renders_recovery_row",
    "grouped_resolved_reads_compact_to_reference_summary",
    "mixed_running_and_resolved_tool_calls_remain_separate",
    "failed_tool_calls_are_not_swallowed_by_grouping",
    "recovery_with_same_tool_call_id_stays_next_to_failed_tool",
    "recovery_rows_humanize_all_known_stages", "recovery_rows_avoid_raw_stage_and_action_codes",
    "nested_payload_supported", "plan_file_write_uses_reference_label",
    "plan_file_edit_hides_path_and_diff_stats", "plan_file_full_detail_shows_preview_hint",
    "none_mode_suppresses_feed", "env_default_suppresses_feed",
    "env_compact_enables_feed", "env_full_enables_verbose_feed",
    "transcript_default_disables_turn_feed", "transcript_env_enables_separate_turn_feed_chunk",
    "transcript_ask_user_suppresses_turn_feed", "transcript_non_interactive_suppresses_turn_feed",
    "transcript_env_resolver", "empty_without_tool_events",
    "rows_within_width", "no_invalid_tokens",
  ]);
  logStep("cli-activity-feed-contract");

  const cliActivityStateContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-activity-state-contract.ts",
  ]);
  assertSuccess("cli-activity-state-contract", cliActivityStateContractResult);
  const cliActivityStatePayload = parseJsonOutput(
    "cli-activity-state-contract",
    cliActivityStateContractResult.stdout,
  );
  assertPayloadFlags(cliActivityStatePayload, [
    "start_snapshot_visible", "route_diagnostic_visible",
    "route_snapshot_has_stage_detail", "route_snapshot_avoids_raw_key_value",
    "context_snapshot_has_budget_detail", "context_snapshot_avoids_raw_key_value",
    "ask_user_waiting_has_reply_detail", "plan_diagnostic_visible",
    "plan_approval_waiting_has_detail", "semantic_prefetch_status_is_human",
    "pre_send_detail_is_human", "governance_topic_is_human",
    "experience_event_detail_is_human", "memory_event_detail_is_human",
    "interrupt_event_detail_is_human", "runtime_model_request_is_request_activity",
    "runtime_tool_start_uses_input_summary_without_raw_keys",
    "runtime_tool_end_normalizes_bash_exit_code_failure",
    "residual_activity_details_avoid_raw_codes", "plan_mode_start_uses_plan_context",
    "ok_finish_clears_prompt_activity", "error_finish_remains_visible",
    "no_done_footer_noise", "verbose_progress_line_uses_reference_prefix",
    "verbose_progress_line_avoids_machine_prefix",
  ]);
  logStep("cli-activity-state-contract");

  const cliStatusLineContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-status-line-contract.ts",
  ]);
  assertSuccess("cli-status-line-contract", cliStatusLineContractResult);
  const cliStatusLineContractPayload = parseJsonOutput(
    "cli-status-line-contract",
    cliStatusLineContractResult.stdout,
  );
  assert.equal(cliStatusLineContractPayload.wide_has_model, true);
  assert.equal(cliStatusLineContractPayload.wide_has_project, true);
  assert.equal(cliStatusLineContractPayload.wide_has_ctx_percent, true);
  assert.equal(cliStatusLineContractPayload.wide_has_token_counter, true);
  assert.equal(cliStatusLineContractPayload.wide_has_short_session_id, true);
  assert.equal(cliStatusLineContractPayload.wide_has_no_s_colon_prefix, true);
  assert.equal(cliStatusLineContractPayload.wide_has_session_topic, true);
  assert.equal(cliStatusLineContractPayload.narrow_line_within_width, true);
  assert.equal(cliStatusLineContractPayload.narrow_has_short_session_id, true);
  assert.equal(cliStatusLineContractPayload.cjk_line_within_width, true);
  assert.equal(cliStatusLineContractPayload.cjk_narrow_keeps_context_signal, true);
  assert.equal(cliStatusLineContractPayload.tiny_line_within_width, true);
  assert.equal(cliStatusLineContractPayload.tiny_keeps_context_signal, true);
  assert.equal(cliStatusLineContractPayload.tiny_keeps_token_counter, true);
  assert.equal(cliStatusLineContractPayload.tiny_keeps_short_session_id, true);
  assert.equal(cliStatusLineContractPayload.tiny_not_session_only, true);
  assert.equal(cliStatusLineContractPayload.warning_has_separate_line, true);
  assert.equal(cliStatusLineContractPayload.warning_line_contains_human_label, true);
  assert.equal(cliStatusLineContractPayload.warning_status_line_unchanged, true);
  assert.equal(cliStatusLineContractPayload.tokens_segment_toggle_effective, true);
  assert.equal(cliStatusLineContractPayload.plan_mode_badge_visible, true);
  assert.equal(cliStatusLineContractPayload.plan_mode_badge_leads_status, true);
  assert.equal(cliStatusLineContractPayload.ccline_uses_low_noise_text_labels, true);
  assert.equal(cliStatusLineContractPayload.ccline_avoids_emoji_status_labels, true);
  logStep("cli-status-line-contract");

  const terminalTextSanitizerContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/terminal-text-sanitizer-contract.ts",
  ]);
  assertSuccess("terminal-text-sanitizer-contract", terminalTextSanitizerContractResult);
  const terminalTextSanitizerContractPayload = parseJsonOutput(
    "terminal-text-sanitizer-contract",
    terminalTextSanitizerContractResult.stdout,
  );
  assert.equal(terminalTextSanitizerContractPayload.ansi_sequences_removed, true);
  assert.equal(terminalTextSanitizerContractPayload.bidi_controls_removed, true);
  assert.equal(terminalTextSanitizerContractPayload.control_chars_removed, true);
  assert.equal(terminalTextSanitizerContractPayload.title_compacted_and_sanitized, true);
  assert.equal(terminalTextSanitizerContractPayload.title_truncation_uses_ellipsis, true);
  assert.equal(terminalTextSanitizerContractPayload.title_zero_budget_empty, true);
  logStep("terminal-text-sanitizer-contract");

  const cliStatusIndicatorContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-status-indicator-contract.ts",
  ]);
  assertSuccess("cli-status-indicator-contract", cliStatusIndicatorContractResult);
  const cliStatusIndicatorPayload = parseJsonOutput(
    "cli-status-indicator-contract",
    cliStatusIndicatorContractResult.stdout,
  );
  assertPayloadFlags(cliStatusIndicatorPayload, [
    "line_contains_elapsed",
    "line_uses_reference_spinner",
    "line_has_brand_shimmer",
    "line_has_muted_base",
    "deterministic_for_same_tick", "narrow_keeps_interrupt_hint",
    "narrow_width_within_columns", "wide_width_within_columns",
    "reduced_motion_no_brand_sweep",
    "no_invalid_tokens",
    "elapsed_formats_minutes", "elapsed_formats_hours",
    "mode_glyph_requesting_is_up", "mode_glyph_responding_is_down",
    "thinking_status_formats_active",
    "thinking_status_formats_completed_duration",
    "token_count_formats_after_gate",
    "token_count_hidden_before_gate",
    "rich_wide_shows_thinking_tokens_elapsed_interrupt",
    "rich_wide_width_within_columns",
    "token_gate_hides_tokens_before_30s",
    "token_gate_shows_down_tokens_after_30s",
    "requesting_mode_shows_up_token_glyph",
    "thinking_status_line_shows_effort",
    "thought_status_line_shows_duration",
    "thinking_only_compacts_effort_to_bare_thinking",
    "thinking_only_uses_parenthesized_byline",
    "thinking_only_width_within_columns",
    "rich_narrow_preserves_interrupt_over_optional_parts",
    "rich_narrow_width_within_columns",
    "rich_tiny_keeps_interrupt_before_elapsed",
    "tool_use_flashes_whole_message_not_per_grapheme",
    "stalled_line_turns_spinner_and_message_error_red",
    "stalled_line_keeps_reference_spinner_animation",
    "stall_detects_no_token_progress",
    "stall_active_tools_resets_timer",
    "stall_token_progress_resets_intensity",
    "stall_smoothing_is_gradual",
  ]);
  logStep("cli-status-indicator-contract");

  const cliStatusLineStabilityContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-status-line-stability-contract.ts",
  ]);
  assertSuccess("cli-status-line-stability-contract", cliStatusLineStabilityContractResult);
  const cliStatusLineStabilityPayload = parseJsonOutput(
    "cli-status-line-stability-contract",
    cliStatusLineStabilityContractResult.stdout,
  );
  assert.equal(cliStatusLineStabilityPayload.deterministic_stable, true);
  assert.equal(cliStatusLineStabilityPayload.warning_stable, true);
  assert.equal(cliStatusLineStabilityPayload.widths_within_columns, true);
  assert.equal(cliStatusLineStabilityPayload.no_invalid_tokens, true);
  assert.equal(cliStatusLineStabilityPayload.warning_has_separate_line, true);
  assert.equal(Number(cliStatusLineStabilityPayload.high_frequency_render_count), 2500);
  assert.equal(Number.isFinite(Number(cliStatusLineStabilityPayload.high_frequency_average_ms)), true);
  assert.equal(cliStatusLineStabilityPayload.performance_within_soft_budget, true);
  logStep("cli-status-line-stability-contract");

  const cliInteractiveFrameContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-interactive-frame-contract.ts",
  ]);
  assertSuccess("cli-interactive-frame-contract", cliInteractiveFrameContractResult);
  const cliInteractiveFramePayload = parseJsonOutput(
    "cli-interactive-frame-contract",
    cliInteractiveFrameContractResult.stdout,
  );
  assert.equal(cliInteractiveFramePayload.prefix_empty, true);
  assert.equal(cliInteractiveFramePayload.inline_prompt_matches, true);
  assert.equal(cliInteractiveFramePayload.suffix_has_status_line, true);
  assert.equal(cliInteractiveFramePayload.suffix_has_activity_line, true);
  assert.equal(cliInteractiveFramePayload.suffix_has_no_prompt_frame, true);
  logStep("cli-interactive-frame-contract");

  const cliBottomPaneContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-bottom-pane-contract.ts",
  ]);
  assertSuccess("cli-bottom-pane-contract", cliBottomPaneContractResult);
  const cliBottomPanePayload = parseJsonOutput(
    "cli-bottom-pane-contract",
    cliBottomPaneContractResult.stdout,
  );
  assert.equal(cliBottomPanePayload.idle_has_no_divider, true);
  assert.equal(cliBottomPanePayload.idle_keeps_passive_status, true);
  assert.equal(cliBottomPanePayload.idle_hides_shortcut_hint, true);
  assert.equal(cliBottomPanePayload.idle_omits_permanent_shift_enter_hint, true);
  assert.equal(cliBottomPanePayload.idle_footer_has_visual_weight, true);
  assert.equal(cliBottomPanePayload.idle_footer_uses_muted_not_high_saturation, true);
  assert.equal(cliBottomPanePayload.idle_footer_style_keeps_plain_text, true);
  assert.equal(cliBottomPanePayload.idle_narrow_status_dimmed, true);
  assert.equal(cliBottomPanePayload.idle_narrow_hides_shortcut_hint, true);
  assert.equal(cliBottomPanePayload.idle_narrow_keeps_status, true);
  assert.equal(cliBottomPanePayload.idle_narrow_lines_within_width, true);
  assert.equal(cliBottomPanePayload.plan_mode_idle_badge_leads_status, true);
  assert.equal(cliBottomPanePayload.pending_has_no_divider, true);
  assert.equal(cliBottomPanePayload.pending_keeps_status_above_ask, true);
  assert.equal(cliBottomPanePayload.pending_status_secondary, true);
  assert.equal(cliBottomPanePayload.pending_narrow_keeps_ask_first, true);
  assert.equal(cliBottomPanePayload.pending_default_prompt_is_short, true);
  assert.equal(cliBottomPanePayload.pending_plan_mode_keeps_badge, true);
  assert.equal(cliBottomPanePayload.pending_plan_mode_keeps_status_above_ask, true);
  assert.equal(cliBottomPanePayload.pending_plan_mode_narrow_keeps_badge, true);
  assert.equal(cliBottomPanePayload.pending_plan_mode_narrow_keeps_status_above_ask, true);
  assert.equal(cliBottomPanePayload.pending_wide_keeps_secondary_status, true);
  assert.equal(cliBottomPanePayload.pending_narrow_hides_secondary_status, true);
  assert.equal(cliBottomPanePayload.pending_omits_shift_enter_hint, true);
  assert.equal(cliBottomPanePayload.pending_warning_kept, true);
  assert.equal(cliBottomPanePayload.pending_lines_within_width, true);
  assert.equal(cliBottomPanePayload.pending_narrow_lines_within_width, true);
  assert.equal(cliBottomPanePayload.pending_plan_mode_lines_within_width, true);
  assert.equal(cliBottomPanePayload.pending_plan_mode_narrow_lines_within_width, true);
  assert.equal(cliBottomPanePayload.running_has_activity, true);
  assert.equal(cliBottomPanePayload.running_fallback_is_localized, true);
  assert.equal(cliBottomPanePayload.running_plan_mode_fallback_is_planning, true);
  assert.equal(cliBottomPanePayload.running_activity_has_visual_weight, true);
  assert.equal(cliBottomPanePayload.running_narrow_keeps_activity_first, true);
  assert.equal(cliBottomPanePayload.running_narrow_hides_secondary_status, true);
  assert.equal(cliBottomPanePayload.running_plan_mode_narrow_keeps_badge, true);
  assert.equal(cliBottomPanePayload.running_plan_mode_narrow_keeps_activity_first, true);
  assert.equal(cliBottomPanePayload.running_omits_shift_enter_hint, true);
  assert.equal(cliBottomPanePayload.running_status_secondary, true);
  assert.equal(cliBottomPanePayload.running_lines_within_width, true);
  assert.equal(cliBottomPanePayload.running_narrow_lines_within_width, true);
  assert.equal(cliBottomPanePayload.running_plan_mode_narrow_lines_within_width, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_has_commands, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_has_shift_enter, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_has_history, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_has_hide_hint, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_aligns_key_column, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_has_visual_weight, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_style_uses_accent_and_dim, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_style_keeps_plain_text, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_medium_uses_two_columns, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_wide_uses_three_columns, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_prioritizes_navigation, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_narrow_uses_single_column, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_lines_within_width, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_wide_lines_within_width, true);
  assert.equal(cliBottomPanePayload.shortcut_overlay_narrow_lines_within_width, true);
  logStep("cli-bottom-pane-contract");

  const cliTerminalMarkdownContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-terminal-markdown-contract.ts",
  ]);
  assertSuccess("cli-terminal-markdown-contract", cliTerminalMarkdownContractResult);
  const cliTerminalMarkdownPayload = parseJsonOutput(
    "cli-terminal-markdown-contract",
    cliTerminalMarkdownContractResult.stdout,
  );
  assert.equal(cliTerminalMarkdownPayload.strong_renders_bold, true);
  assert.equal(cliTerminalMarkdownPayload.inline_code_renders_dim, true);
  assert.equal(cliTerminalMarkdownPayload.fenced_code_preserves_markdown_markers, true);
  assert.equal(cliTerminalMarkdownPayload.heading_preserves_hash_marker, true);
  assert.equal(cliTerminalMarkdownPayload.plain_text_preserved, true);
  assert.equal(cliTerminalMarkdownPayload.disabled_preserves_raw_markdown, true);
  assert.equal(cliTerminalMarkdownPayload.off_mode_preserves_raw_markdown, true);
  assert.equal(cliTerminalMarkdownPayload.rich_mode_currently_uses_basic_renderer, true);
  assert.equal(cliTerminalMarkdownPayload.env_off_resolves_off, true);
  assert.equal(cliTerminalMarkdownPayload.env_basic_default, true);
  assert.equal(cliTerminalMarkdownPayload.env_rich_resolves_rich, true);
  logStep("cli-terminal-markdown-contract");

  const cliAskUserPanelContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/cli-ask-user-panel-contract.ts",
  ]);
  assertSuccess("cli-ask-user-panel-contract", cliAskUserPanelContractResult);
  const cliAskUserPanelPayload = parseJsonOutput(
    "cli-ask-user-panel-contract",
    cliAskUserPanelContractResult.stdout,
  );
  assert.equal(cliAskUserPanelPayload.panel_has_brand_divider, true);
  assert.equal(cliAskUserPanelPayload.panel_omits_raw_ask_user_label, true);
  assert.equal(cliAskUserPanelPayload.panel_has_codex_like_progress, true);
  assert.equal(cliAskUserPanelPayload.panel_plan_mode_shows_planning_path, true);
  assert.equal(cliAskUserPanelPayload.panel_has_claude_like_question_tabs, true);
  assert.equal(cliAskUserPanelPayload.panel_question_separate_from_options, true);
  assert.equal(cliAskUserPanelPayload.panel_preserves_option_descriptions, true);
  assert.equal(cliAskUserPanelPayload.panel_has_other_type_something_row, true);
  assert.equal(cliAskUserPanelPayload.panel_has_direct_keyboard_hints, true);
  assert.equal(cliAskUserPanelPayload.panel_has_notes_affordance, true);
  assert.equal(cliAskUserPanelPayload.panel_has_chat_about_this_row, true);
  assert.equal(cliAskUserPanelPayload.panel_has_plan_skip_affordance, true);
  assert.equal(cliAskUserPanelPayload.panel_review_has_submit_edit_cancel, true);
  assert.equal(cliAskUserPanelPayload.panel_review_has_answer_summary, true);
  assert.equal(cliAskUserPanelPayload.panel_text_input_renders_value, true);
  assert.equal(cliAskUserPanelPayload.panel_secret_text_input_masks_value, true);
  assert.equal(cliAskUserPanelPayload.panel_narrow_keeps_lines_within_width, true);
  assert.equal(cliAskUserPanelPayload.panel_wide_keeps_lines_within_width, true);
  assert.equal(cliAskUserPanelPayload.panel_interactive_uses_warm_brand_color, true);
  assert.equal(cliAskUserPanelPayload.panel_no_box_frame, true);
  assert.equal(cliAskUserPanelPayload.panel_narrow_keeps_progress, true);
  logStep("cli-ask-user-panel-contract");

  const askUserToolContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/ask-user-tool-contract.ts",
  ]);
  assertSuccess("ask-user-tool-contract", askUserToolContractResult);
  const askUserToolContractPayload = parseJsonOutput(
    "ask-user-tool-contract",
    askUserToolContractResult.stdout,
  );
  assert.equal(askUserToolContractPayload.protocol_prefix_removed, true);
  assert.equal(askUserToolContractPayload.resolution_prompt_injected, true);
  assert.equal(askUserToolContractPayload.resolution_prompt_builder_works, true);
  assert.equal(askUserToolContractPayload.resolved_answer, "fast");
  assert.equal(askUserToolContractPayload.resolved_event_has_ask_id, true);
  assert.equal(askUserToolContractPayload.issued_registered, true);
  assert.equal(Number(askUserToolContractPayload.queue_size_after_enqueue), 2);
  assert.equal(askUserToolContractPayload.queue_dedupe_keeps_size, true);
  assert.equal(askUserToolContractPayload.queue_resolve_first_matches_q2, true);
  assert.equal(askUserToolContractPayload.queue_next_after_resolve_is_q3, true);
  assert.equal(Number(askUserToolContractPayload.queue_size_after_resolve), 1);
  assert.equal(askUserToolContractPayload.queue_midway_prompt_deferred, true);
  assert.equal(askUserToolContractPayload.queue_final_prompt_released, true);
  assert.equal(askUserToolContractPayload.queue_empty_after_batch_resolved, true);
  assert.equal(askUserToolContractPayload.answer_numeric_index_maps_option, true);
  assert.equal(askUserToolContractPayload.answer_full_width_index_maps_option, true);
  assert.equal(askUserToolContractPayload.answer_case_insensitive_option_maps_canonical, true);
  assert.equal(askUserToolContractPayload.answer_other_literal_is_custom, true);
  assert.equal(askUserToolContractPayload.answer_other_id_literal_is_custom, true);
  assert.equal(askUserToolContractPayload.answer_out_of_range_index_is_custom, true);
  assert.equal(askUserToolContractPayload.answer_blank_falls_back_default, true);
  assert.equal(askUserToolContractPayload.queue_ttl_prune_removed_expired, true);
  assert.equal(askUserToolContractPayload.queue_ttl_prune_keeps_fresh, true);
  assert.equal(askUserToolContractPayload.issued_display_has_reply_hint, true);
  assert.equal(askUserToolContractPayload.issued_display_has_reply_guide, true);
  assert.equal(askUserToolContractPayload.issued_display_uses_prompt_chevron, true);
  assert.equal(askUserToolContractPayload.issued_display_has_other_type_something, true);
  assert.equal(askUserToolContractPayload.issued_display_shows_question_progress, true);
  assert.equal(askUserToolContractPayload.issued_display_shows_option_description, true);
  assert.equal(askUserToolContractPayload.issued_display_hides_resume_token, true);
  assert.equal(askUserToolContractPayload.issued_display_compact_options, true);
  assert.equal(askUserToolContractPayload.issued_display_hides_log_prefix, true);
  assert.equal(askUserToolContractPayload.issued_display_hides_options_preview, true);
  assert.equal(askUserToolContractPayload.issued_display_overflow_lists_sixth_option, true);
  assert.equal(askUserToolContractPayload.issued_display_sanitizes_untrusted_text, true);
  assert.equal(askUserToolContractPayload.options_preview_sanitizes_untrusted_text, true);
  assert.equal(askUserToolContractPayload.issued_event_has_ask_id, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_title_has_progress, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_hint_returns_to_input, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_omits_noisy_default_descriptions, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_preserves_option_descriptions, true);
  assert.equal(askUserToolContractPayload.ask_user_queue_display_shows_progress, true);
  assert.equal(askUserToolContractPayload.ask_user_queue_display_hides_raw_diagnostics, true);
  assert.equal(askUserToolContractPayload.ask_user_queue_display_sanitizes_untrusted_text, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_descriptor_sanitizes_untrusted_text, true);
  assert.equal(askUserToolContractPayload.ask_user_review_surface_sanitizes_untrusted_text, true);
  assert.equal(askUserToolContractPayload.questionnaire_navigation_prev_stays_in_bounds, true);
  assert.equal(askUserToolContractPayload.questionnaire_navigation_option_wraps, true);
  assert.equal(askUserToolContractPayload.questionnaire_answer_focused_advances, true);
  assert.equal(askUserToolContractPayload.questionnaire_view_has_question_tabs, true);
  assert.equal(askUserToolContractPayload.questionnaire_view_has_other_input_option, true);
  assert.equal(askUserToolContractPayload.questionnaire_review_available, true);
  assert.equal(askUserToolContractPayload.questionnaire_selection_maps_canonical_value, true);
  assert.equal(askUserToolContractPayload.questionnaire_batch_answer_text_is_numbered, true);
  assert.equal(askUserToolContractPayload.questionnaire_review_menu_has_submit_and_edit, true);
  assert.equal(askUserToolContractPayload.batch_numbered_answers_release_prompt, true);
  assert.equal(askUserToolContractPayload.batch_numbered_answers_resolve_all, true);
  assert.equal(askUserToolContractPayload.batch_legacy_numbered_answers_still_resolve_all, true);
  assert.equal(askUserToolContractPayload.batch_partial_numbered_answer_does_not_release_prompt, true);
  assert.equal(askUserToolContractPayload.batch_invalid_numbered_answer_does_not_release_prompt, true);
  assert.equal(askUserToolContractPayload.batch_json_encoded_custom_answer_stays_single_answer, true);
  logStep("ask-user-tool-contract");

  const gaSkillPromptContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/ga-skill-prompt-contract.ts",
  ]);
  assertSuccess("ga-skill-prompt-contract", gaSkillPromptContractResult);
  const gaSkillPromptContractPayload = parseJsonOutput(
    "ga-skill-prompt-contract",
    gaSkillPromptContractResult.stdout,
  );
  assert.equal(gaSkillPromptContractPayload.direct_has_header, true);
  assert.equal(Number(gaSkillPromptContractPayload.direct_matched) >= 1, true);
  assert.equal(Number(gaSkillPromptContractPayload.direct_total), 2);
  assert.equal(gaSkillPromptContractPayload.apply_keeps_existing_prefix, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_ga_prompt, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_experience_prompt, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_ga_event, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_experience_event, true);
  assert.equal(gaSkillPromptContractPayload.no_match_skips_ga_prompt, true);
  assert.equal(gaSkillPromptContractPayload.no_match_no_events, true);
  logStep("ga-skill-prompt-contract");
}
