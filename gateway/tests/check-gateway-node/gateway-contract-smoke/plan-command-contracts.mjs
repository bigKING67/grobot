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
export async function runPlanCommandContracts() {
  const startInputKeybindingContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-input-keybinding-contract.ts",
  ]);
  assertSuccess("start-input-keybinding-contract", startInputKeybindingContractResult);
  const startInputKeybindingContractPayload = parseJsonOutput(
    "start-input-keybinding-contract",
    startInputKeybindingContractResult.stdout,
  );
  assert.equal(startInputKeybindingContractPayload.menu_enter_is_confirm, true);
  assert.equal(startInputKeybindingContractPayload.menu_lf_is_confirm, true);
  assert.equal(startInputKeybindingContractPayload.menu_crlf_is_confirm, true);
  assert.equal(startInputKeybindingContractPayload.menu_space_is_confirm, true);
  assert.equal(startInputKeybindingContractPayload.menu_ctrl_p_is_up, true);
  assert.equal(startInputKeybindingContractPayload.menu_ctrl_n_is_down, true);
  assert.equal(startInputKeybindingContractPayload.menu_ctrl_g_is_edit_plan, true);
  assert.equal(startInputKeybindingContractPayload.menu_escape_is_cancel, true);
  assert.equal(startInputKeybindingContractPayload.menu_arrow_up_is_up, true);
  assert.equal(startInputKeybindingContractPayload.menu_arrow_down_is_down, true);
  assert.equal(startInputKeybindingContractPayload.menu_page_up_is_page_up, true);
  assert.equal(startInputKeybindingContractPayload.menu_page_down_is_page_down, true);
  assert.equal(startInputKeybindingContractPayload.menu_multi_digits_direct_index, true);
  assert.equal(startInputKeybindingContractPayload.menu_digit_coalesced_crlf_direct_index, true);
  assert.equal(startInputKeybindingContractPayload.menu_digit_prefix_has_continuation, true);
  assert.equal(startInputKeybindingContractPayload.menu_digit_suffix_no_continuation, true);
  assert.equal(startInputKeybindingContractPayload.menu_digit_prefix_first_match_index, true);
  assert.equal(startInputKeybindingContractPayload.menu_digits_to_index_10, true);
  assert.equal(startInputKeybindingContractPayload.menu_digits_reject_leading_zero, true);
  assert.equal(startInputKeybindingContractPayload.menu_search_compact_prefers_relevant_item, true);
  assert.equal(startInputKeybindingContractPayload.menu_search_digits_match_timestamp_description, true);
  assert.equal(startInputKeybindingContractPayload.menu_search_empty_returns_all, true);
  assert.equal(startInputKeybindingContractPayload.slash_apply_menu_command, true);
  assert.equal(startInputKeybindingContractPayload.slash_apply_commands_menu_submit, true);
  assert.equal(startInputKeybindingContractPayload.slash_apply_plan_submit, true);
  assert.equal(startInputKeybindingContractPayload.slash_apply_skill_creator_requires_input, true);
  assert.equal(startInputKeybindingContractPayload.slash_key_enter_applies_and_submits, true);
  assert.equal(startInputKeybindingContractPayload.slash_key_tab_applies_without_submit, true);
  assert.equal(startInputKeybindingContractPayload.slash_key_escape_hides_panel, true);
  assert.equal(startInputKeybindingContractPayload.slash_key_no_suggestions_noop, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_partial_selected_highlighted, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_selected_description_is_muted, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_selected_description_not_brand_flooded, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_exact_selected_highlighted, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_keeps_selected_visible, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_highlights_selected, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_uses_restraint_not_bold, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_selected_has_pointer, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_does_not_wrap_to_first, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_has_no_row_up_marker, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_has_no_row_down_marker, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_keeps_compact_height, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_scroll_window_centers_selected_when_possible, true);
  assert.equal(startInputKeybindingContractPayload.suggestion_window_reusable_selected_centered, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_narrow_hides_description, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_narrow_lines_within_width, true);
  assert.equal(startInputKeybindingContractPayload.slash_overlay_sanitize_render_text, true);
  assert.equal(startInputKeybindingContractPayload.prompt_suggestions_sanitize_render_text, true);
  assert.equal(startInputKeybindingContractPayload.slash_input_with_args_highlighted, true);
  assert.equal(startInputKeybindingContractPayload.submit_return_detected, true);
  assert.equal(startInputKeybindingContractPayload.submit_enter_detected, true);
  assert.equal(startInputKeybindingContractPayload.submit_legacy_sequence_detected, true);
  assert.equal(startInputKeybindingContractPayload.submit_csiu_detected, true);
  assert.equal(startInputKeybindingContractPayload.submit_shift_newline, true);
  assert.equal(startInputKeybindingContractPayload.submit_meta_newline, true);
  assert.equal(startInputKeybindingContractPayload.submit_csiu_shift_newline, true);
  assert.equal(startInputKeybindingContractPayload.submit_non_enter_ignored, true);
  assert.equal(startInputKeybindingContractPayload.submit_coalesced_detected, true);
  assert.equal(startInputKeybindingContractPayload.submit_coalesced_crlf_detected, true);
  assert.equal(startInputKeybindingContractPayload.submit_coalesced_lf_detected, true);
  assert.equal(startInputKeybindingContractPayload.ask_user_panel_other_submit_text, true);
  assert.equal(startInputKeybindingContractPayload.ask_user_panel_other_submit_crlf_text, true);
  assert.equal(startInputKeybindingContractPayload.ask_user_panel_other_submit_cjk_text, true);
  assert.equal(startInputKeybindingContractPayload.ask_user_panel_numeric_submit_selects_standard_option, true);
  assert.equal(startInputKeybindingContractPayload.ask_user_panel_other_numeric_submit_focuses_other, true);
  assert.equal(startInputKeybindingContractPayload.ask_user_panel_other_printable_text, true);
  assert.equal(startInputKeybindingContractPayload.ask_user_panel_other_backspace, true);
  assert.equal(startInputKeybindingContractPayload.submit_coalesced_backslash_ignored, true);
  assert.equal(startInputKeybindingContractPayload.submit_coalesced_escape_ignored, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_empty_enter_activates, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_printable_updates, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_backspace_updates_in_input_mode, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_backspace_ignored_before_mode, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_ctrl_u_clears, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_coalesced_submit, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_tab_toggles_input_mode, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_tab_toggles_before_mode, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_sanitizes_unsafe_text, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_sanitizes_coalesced_submit, true);
  assert.equal(
    startInputKeybindingContractPayload.menu_inline_input_text_normalizer_removes_terminal_controls,
    true,
  );
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_esc_exits_input_first, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_esc_without_input_falls_through, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_ctrl_g_keeps_plan_editor, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_shift_tab_approves_feedback, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_tab_routes_before_mode, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_digit_does_not_route_before_mode, true);
  assert.equal(startInputKeybindingContractPayload.menu_inline_input_tab_does_not_route_during_search, true);
  assert.equal(startInputKeybindingContractPayload.menu_numeric_selection_default_enabled, true);
  assert.equal(startInputKeybindingContractPayload.menu_numeric_selection_hidden_indexes_disabled, true);
  assert.equal(startInputKeybindingContractPayload.menu_numeric_selection_disable_selection_disabled, true);
  assert.equal(startInputKeybindingContractPayload.menu_numeric_selection_numeric_mode_disabled, true);
  assert.equal(startInputKeybindingContractPayload.menu_enter_selection_default_enabled, true);
  assert.equal(startInputKeybindingContractPayload.menu_enter_selection_disable_selection_disabled, true);
  assert.equal(startInputKeybindingContractPayload.menu_enter_selection_numeric_mode_allowed, true);
  assert.equal(startInputKeybindingContractPayload.menu_numeric_selection_numeric_mode_rejected, true);
  assert.equal(startInputKeybindingContractPayload.menu_disabled_item_enter_rejected, true);
  assert.equal(startInputKeybindingContractPayload.menu_disabled_item_numeric_rejected, true);
  assert.equal(startInputKeybindingContractPayload.menu_enabled_item_enter_allowed, true);
  assert.equal(startInputKeybindingContractPayload.menu_enabled_item_disable_selection_rejected, true);
  assert.equal(startInputKeybindingContractPayload.menu_enabled_item_numeric_mode_enter_allowed, true);
  assert.equal(startInputKeybindingContractPayload.menu_enabled_item_numeric_mode_numeric_rejected, true);
  assert.equal(startInputKeybindingContractPayload.submit_chunk_only_lf_detected, true);
  assert.equal(startInputKeybindingContractPayload.interactive_plain_enter_defers_to_keypress, true);
  assert.equal(startInputKeybindingContractPayload.interactive_plain_enter_recent_keypress_ignored, true);
  assert.equal(startInputKeybindingContractPayload.interactive_plain_enter_fallback_submits, true);
  assert.equal(startInputKeybindingContractPayload.interactive_text_submit_chunk_ignored, true);
  assert.equal(startInputKeybindingContractPayload.shortcut_overlay_empty_question_toggles, true);
  assert.equal(startInputKeybindingContractPayload.shortcut_overlay_draft_question_inserts, true);
  assert.equal(startInputKeybindingContractPayload.shortcut_overlay_slash_question_inserts, true);
  assert.equal(startInputKeybindingContractPayload.shortcut_overlay_ctrl_question_ignored, true);
  assert.equal(startInputKeybindingContractPayload.footer_draft_hides_shortcut_hint, true);
  assert.equal(startInputKeybindingContractPayload.footer_draft_hides_styled_shortcut_hint, true);
  assert.equal(startInputKeybindingContractPayload.footer_empty_keeps_shortcut_hint, true);
  assert.equal(startInputKeybindingContractPayload.footer_draft_removes_hint_only_line, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_has_open_horizontal_rails, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_has_no_corner_caps, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_has_no_vertical_body_rails, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_prompt_uses_claude_chevron, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_prompt_avoids_thin_chevron, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_has_no_left_gutter, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_border_tracks_body_width, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_cursor_column_matches_open_rails, true);
  assert.equal(startInputKeybindingContractPayload.input_chrome_cursor_uses_left_padding, true);
  assert.equal(startInputKeybindingContractPayload.input_live_prompt_sanitizes_render_text, true);
  assert.equal(startInputKeybindingContractPayload.input_live_prompt_keeps_raw_state_for_submission, true);
  assert.equal(startInputKeybindingContractPayload.submitted_slash_transcript_preserves_command_highlight, true);
  assert.equal(startInputKeybindingContractPayload.submitted_transcript_sanitizes_render_text, true);
  assert.equal(startInputKeybindingContractPayload.menu_viewport_keeps_active_visible, true);
  assert.equal(startInputKeybindingContractPayload.menu_viewport_scrolls_one_row_down, true);
  assert.equal(startInputKeybindingContractPayload.menu_viewport_scrolls_one_row_up, true);
  assert.equal(startInputKeybindingContractPayload.select_navigation_page_down_clamps_to_last, true);
  assert.equal(startInputKeybindingContractPayload.select_navigation_page_up_returns_by_page, true);
  assert.equal(startInputKeybindingContractPayload.select_navigation_wrap_next, true);
  assert.equal(startInputKeybindingContractPayload.select_navigation_set_options_clamps_focus, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_select_menu_owns_focus_without_footer, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_suggestions_suppress_status, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_history_preempts_suggestions, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_pending_ask_preempts_status, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_running_preempts_status, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_status_when_input_idle, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_idle_hint_hidden_for_draft, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_short_fullscreen_drops_status_first, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_hidden_input_renders_no_footer, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_runtime_status_footer_renders, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_runtime_suggestions_suppress_status_footer, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_runtime_shortcut_overlay_suppresses_status_footer, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_runtime_pending_ask_renders_footer, true);
  assert.equal(startInputKeybindingContractPayload.prompt_slot_runtime_draft_without_status_hides_footer, true);
  logStep("start-input-keybinding-contract");

  const startPlanFailurePolicyContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-plan-failure-policy-contract.ts",
  ]);
  assertSuccess("start-plan-failure-policy-contract", startPlanFailurePolicyContractResult);
  const startPlanFailurePolicyContractPayload = parseJsonOutput(
    "start-plan-failure-policy-contract",
    startPlanFailurePolicyContractResult.stdout,
  );
  assert.equal(startPlanFailurePolicyContractPayload.planning_semantic_degrades, true);
  assert.equal(startPlanFailurePolicyContractPayload.planning_semantic_reason_matches, true);
  assert.equal(startPlanFailurePolicyContractPayload.planning_semantic_diagnostic_matches, true);
  assert.equal(startPlanFailurePolicyContractPayload.planning_semantic_has_hint, true);
  assert.equal(startPlanFailurePolicyContractPayload.planning_semantic_stale_fails, true);
  assert.equal(startPlanFailurePolicyContractPayload.planning_semantic_stale_diagnostic_matches, true);
  assert.equal(startPlanFailurePolicyContractPayload.applying_semantic_still_fails, true);
  assert.equal(startPlanFailurePolicyContractPayload.applying_semantic_diagnostic_matches, true);
  assert.equal(
    startPlanFailurePolicyContractPayload.planning_provider_failure_reason_matches,
    true,
  );
  assert.equal(
    startPlanFailurePolicyContractPayload.planning_provider_failure_keeps_error_class,
    true,
  );
  assert.equal(
    startPlanFailurePolicyContractPayload.planning_provider_failure_diagnostic_matches,
    true,
  );
  logStep("start-plan-failure-policy-contract");

  const bridgePlanFailurePolicyContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/bridge-plan-failure-policy-contract.ts",
  ]);
  assertSuccess("bridge-plan-failure-policy-contract", bridgePlanFailurePolicyContractResult);
  const bridgePlanFailurePolicyContractPayload = parseJsonOutput(
    "bridge-plan-failure-policy-contract",
    bridgePlanFailurePolicyContractResult.stdout,
  );
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_is_fail, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_reason_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_class_kept, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_provider_kept, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_diagnostic_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_camel_case_extracted, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_snake_case_extracted, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.semantic_failure_diagnostic_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.timeout_failure_reason_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.timeout_failure_diagnostic_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.generic_failure_reason_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.generic_failure_diagnostic_matches, true);
  logStep("bridge-plan-failure-policy-contract");

  const startPlanModeContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-plan-mode-contract.ts",
  ]);
  assertSuccess("start-plan-mode-contract", startPlanModeContractResult);
  const startPlanModeContractPayload = parseJsonOutput(
    "start-plan-mode-contract",
    startPlanModeContractResult.stdout,
  );
  assert.equal(startPlanModeContractPayload.review_passes_for_valid_plan, true);
  assert.equal(startPlanModeContractPayload.review_rejects_validation_without_command, true);
  assert.equal(startPlanModeContractPayload.review_rejects_validation_without_expected_result, true);
  assert.equal(startPlanModeContractPayload.review_rejects_vague_risk, true);
  assert.equal(startPlanModeContractPayload.review_rejects_vague_rollback, true);
  assert.equal(startPlanModeContractPayload.review_accepts_canonical_proposed_plan_block, true);
  assert.equal(startPlanModeContractPayload.enter_plan_message_mode_handled, true);
  assert.equal(startPlanModeContractPayload.enter_plan_sets_plan_only, true);
  assert.equal(startPlanModeContractPayload.enter_plan_surface_has_relative_planning_path, true);
  assert.equal(startPlanModeContractPayload.enter_plan_surface_has_goal, true);
  assert.equal(startPlanModeContractPayload.enter_plan_surface_has_read_only_boundary, true);
  assert.equal(startPlanModeContractPayload.enter_plan_surface_hides_absolute_plan_path, true);
  assert.equal(startPlanModeContractPayload.enter_plan_surface_order_is_stable, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_handled, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_uses_status_title, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_uses_relative_plan_file, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_uses_info_panel_rows, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_has_read_only_boundary, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_has_refine_hint, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_hides_absolute_path, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_hides_required_placeholders, true);
  assert.equal(startPlanModeContractPayload.draft_plan_surface_avoids_legacy_empty_message, true);
  assert.equal(startPlanModeContractPayload.refine_plan_turn_handled, true);
  assert.equal(startPlanModeContractPayload.refine_plan_turn_surface_matches_reference_shape, true);
  assert.equal(startPlanModeContractPayload.ready_plan_turn_handled, true);
  assert.equal(startPlanModeContractPayload.ready_surface_matches_reference_shape, true);
  assert.equal(startPlanModeContractPayload.ready_surface_has_plan_separators, true);
  assert.equal(startPlanModeContractPayload.ready_approval_callback_receives_current_plan, true);
  assert.equal(startPlanModeContractPayload.ready_approval_keep_planning_skips_fallback_surface, true);
  assert.equal(startPlanModeContractPayload.ready_approval_keep_planning_matches_reference_shape, true);
  assert.equal(startPlanModeContractPayload.ready_approval_cancel_returns_input_without_status_surface, true);
  assert.equal(startPlanModeContractPayload.ready_approval_empty_exit_leaves_plan_mode, true);
  assert.equal(startPlanModeContractPayload.ready_approval_empty_exit_does_not_apply, true);
  assert.equal(startPlanModeContractPayload.ready_approval_empty_exit_is_quiet, true);
  assert.equal(startPlanModeContractPayload.ready_approval_yes_executes_plan, true);
  assert.equal(startPlanModeContractPayload.ready_approval_yes_skips_text_fallback, true);
  assert.equal(startPlanModeContractPayload.ready_approval_yes_matches_exit_plan_reference, true);
  assert.equal(startPlanModeContractPayload.ready_approval_yes_exits_plan_mode, true);
  assert.equal(startPlanModeContractPayload.ready_approval_yes_with_feedback_adds_instruction, true);
  assert.equal(startPlanModeContractPayload.ready_approval_yes_with_feedback_exits_plan_mode, true);
  assert.equal(startPlanModeContractPayload.ready_approval_feedback_runs_followup_plan_turn, true);
  assert.equal(startPlanModeContractPayload.ready_approval_feedback_keeps_plan_mode, true);
  assert.equal(startPlanModeContractPayload.plan_interrupt_command_normal_mode_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_interrupt_idle_plan_mode_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_interrupt_ignored_reason_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_interrupt_reason_fallback_avoids_raw_token, true);
  assert.equal(startPlanModeContractPayload.plan_cancel_empty_surface_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_cancel_active_surface_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_apply_no_active_surface_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_apply_already_applying_surface_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_apply_invalid_status_surface_is_human, true);
  assert.equal(startPlanModeContractPayload.plan_turn_injects_plan_workflow_prompt, true);
  assert.equal(startPlanModeContractPayload.plan_turn_prompt_requires_strict_plan_sections, true);
  assert.equal(startPlanModeContractPayload.active_plan_path_present, true);
  assert.equal(startPlanModeContractPayload.open_plan_surface_handled, true);
  assert.equal(startPlanModeContractPayload.open_plan_surface_is_current_plan_display, true);
  assert.equal(startPlanModeContractPayload.open_plan_surface_has_editor_hint, true);
  assert.equal(startPlanModeContractPayload.open_plan_surface_hides_machine_fields_by_default, true);
  assert.equal(startPlanModeContractPayload.verbose_plan_surface_handled, true);
  assert.equal(startPlanModeContractPayload.verbose_plan_surface_preserves_machine_fields, true);
  assert.equal(startPlanModeContractPayload.open_plan_surface_uses_relative_plan_file, true);
  assert.equal(startPlanModeContractPayload.open_plan_surface_hides_absolute_plan_file, true);
  assert.equal(startPlanModeContractPayload.script_plan_surface_defaults_to_human_summary, true);
  assert.equal(startPlanModeContractPayload.script_plan_surface_has_editor_hint, true);
  assert.equal(startPlanModeContractPayload.script_plan_surface_hides_machine_fields_by_default, true);
  assert.equal(startPlanModeContractPayload.script_plan_surface_uses_relative_plan_file, true);
  assert.equal(startPlanModeContractPayload.script_plan_surface_hides_absolute_plan_file, true);
  assert.equal(startPlanModeContractPayload.plan_goal_in_plan_mode_shows_current_plan, true);
  assert.equal(startPlanModeContractPayload.plan_goal_in_plan_mode_skips_new_query, true);
  assert.equal(startPlanModeContractPayload.removed_plan_benchmark_surface_is_human, true);
  assert.equal(startPlanModeContractPayload.removed_plan_benchmark_hides_machine_output, true);
  assert.equal(startPlanModeContractPayload.execute_natural_language_handled, true);
  assert.equal(startPlanModeContractPayload.execute_triggered_runtime_turn, true);
  assert.equal(startPlanModeContractPayload.execute_payload_is_not_literal_phrase, true);
  assert.equal(startPlanModeContractPayload.execute_payload_has_approved_plan_contract, true);
  assert.equal(startPlanModeContractPayload.execute_payload_has_approval_metadata, true);
  assert.equal(startPlanModeContractPayload.execute_payload_has_scope_guardrails, true);
  assert.equal(startPlanModeContractPayload.execute_payload_contains_approved_plan_snapshot, true);
  assert.equal(startPlanModeContractPayload.execute_payload_omits_plain_trigger_as_extra, true);
  assert.equal(startPlanModeContractPayload.apply_surface_shows_approved_plan_start, true);
  assert.equal(startPlanModeContractPayload.apply_surface_has_saved_plan_hint, true);
  assert.equal(startPlanModeContractPayload.apply_surface_renders_plan_card, true);
  assert.equal(startPlanModeContractPayload.apply_surface_hides_machine_fields, true);
  assert.equal(startPlanModeContractPayload.latest_plan_status_surface_is_human, true);
  assert.equal(startPlanModeContractPayload.latest_plan_status_surface_hides_plan_id, true);
  assert.equal(startPlanModeContractPayload.apply_surface_hides_plan_metadata_preview, true);
  assert.equal(startPlanModeContractPayload.apply_surface_does_not_echo_literal_trigger, true);
  assert.equal(startPlanModeContractPayload.execute_exits_plan_only, true);
  assert.equal(startPlanModeContractPayload.execute_clears_active_plan_meta, true);
  assert.equal(startPlanModeContractPayload.events_has_apply_succeeded, true);
  assert.equal(startPlanModeContractPayload.events_has_verification_pending, true);
  assert.equal(startPlanModeContractPayload.compact_plan_turn_failure_code_preserved, true);
  assert.equal(startPlanModeContractPayload.plan_turn_stdout_override_captures_plan_scaffolding, true);
  assert.equal(startPlanModeContractPayload.plan_turn_working_notice_uses_info_panel, true);
  assert.equal(startPlanModeContractPayload.compact_plan_turn_failure_surface_human, true);
  assert.equal(startPlanModeContractPayload.compact_plan_turn_failure_hides_machine_lines, true);
  assert.equal(startPlanModeContractPayload.verbose_plan_turn_failure_preserves_machine_lines, true);
  assert.equal(startPlanModeContractPayload.compact_plan_apply_failure_code_preserved, true);
  assert.equal(startPlanModeContractPayload.compact_plan_apply_failure_surface_human, true);
  assert.equal(startPlanModeContractPayload.compact_plan_apply_failure_hides_machine_lines, true);
  assert.equal(startPlanModeContractPayload.compact_apply_failed_status_surface_shows_human_state, true);
  assert.equal(startPlanModeContractPayload.compact_apply_failed_status_surface_hides_machine_fields, true);
  assert.equal(startPlanModeContractPayload.stderr_empty_on_success_path, true);
  logStep("start-plan-mode-contract");

  const userCommandsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/user-commands-contract.ts",
  ]);
  assertSuccess("user-commands-contract", userCommandsContractResult);
  const userCommandsContractPayload = parseJsonOutput(
    "user-commands-contract",
    userCommandsContractResult.stdout,
  );
  assert.equal(userCommandsContractPayload.created, true);
  assert.equal(userCommandsContractPayload.first_invocation_handled, true);
  assert.equal(userCommandsContractPayload.first_invocation_prompt, "执行交付：本次发布");
  assert.equal(userCommandsContractPayload.disabled_invocation_handled, true);
  assert.equal(Number(userCommandsContractPayload.prompts_after_disable), 1);
  assert.equal(userCommandsContractPayload.second_invocation_handled, true);
  assert.equal(userCommandsContractPayload.second_invocation_prompt, "第二版：参数B");
  assert.equal(userCommandsContractPayload.builtin_collision_created, false);
  assert.equal(userCommandsContractPayload.skill_creator_collision_created, false);
  assert.equal(userCommandsContractPayload.builtin_delete_blocked, true);
  assert.equal(userCommandsContractPayload.traversal_delete_blocked, true);
  assert.equal(userCommandsContractPayload.traversal_invocation_handled, false);
  assert.equal(userCommandsContractPayload.deleted, true);
  assert.equal(userCommandsContractPayload.failure_marked, false);
  assert.equal(Number(userCommandsContractPayload.stdout_rows_count) >= 1, true);
  assert.equal(userCommandsContractPayload.command_surface_avoids_legacy_marker, true);
  assert.equal(userCommandsContractPayload.command_created_surface_is_human, true);
  assert.equal(userCommandsContractPayload.command_disabled_surface_is_human, true);
  assert.equal(userCommandsContractPayload.command_list_surface_is_human, true);
  assert.equal(userCommandsContractPayload.command_details_surface_is_human, true);
  assert.equal(userCommandsContractPayload.command_surfaces_avoid_raw_labels, true);
  assert.equal(userCommandsContractPayload.menu_hint_is_reference_compact, true);
  assert.equal(userCommandsContractPayload.menu_hint_omits_secondary_key_chords, true);
  assert.equal(userCommandsContractPayload.menu_cancel_is_silent, true);
  logStep("user-commands-contract");

  const agentsInstructionsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/agents-instructions-contract.ts",
  ]);
  assertSuccess("agents-instructions-contract", agentsInstructionsContractResult);
  const agentsInstructionsContractPayload = parseJsonOutput(
    "agents-instructions-contract",
    agentsInstructionsContractResult.stdout,
  );
  assert.equal(Number(agentsInstructionsContractPayload.sources_count), 2);
  assert.equal(Number(agentsInstructionsContractPayload.outside_sources_count), 1);
  assert.equal(agentsInstructionsContractPayload.system_prompt_loaded, true);
  logStep("agents-instructions-contract");

  const startSlashSuggestionsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-slash-suggestions-contract.ts",
  ]);
  assertSuccess("start-slash-suggestions-contract", startSlashSuggestionsContractResult);
  const startSlashSuggestionsContractPayload = parseJsonOutput(
    "start-slash-suggestions-contract",
    startSlashSuggestionsContractResult.stdout,
  );
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_model, true);
  assert.equal(startSlashSuggestionsContractPayload.root_model_visible_in_first_page, true);
  assert.equal(startSlashSuggestionsContractPayload.root_default_limit_keeps_model, true);
  assert.equal(startSlashSuggestionsContractPayload.root_default_limit_size_ok, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_commands, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_resume, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_rewind, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_skill_creator, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_init, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_context, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_builtin_memory, true);
  assert.equal(startSlashSuggestionsContractPayload.root_hides_removed_ask_surface, true);
  assert.equal(startSlashSuggestionsContractPayload.root_hides_plan_subcommands, true);
  assert.equal(startSlashSuggestionsContractPayload.root_has_user_shipit, true);
  assert.equal(startSlashSuggestionsContractPayload.root_disabled_marked, true);
  assert.equal(startSlashSuggestionsContractPayload.pending_root_hides_removed_ask_surface, true);
  assert.equal(startSlashSuggestionsContractPayload.pending_root_keeps_builtin_shape, true);
  assert.equal(startSlashSuggestionsContractPayload.model_filter_only_model_related, true);
  assert.equal(startSlashSuggestionsContractPayload.ask_filter_empty, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_only_plan_related, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_has_plan_root, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_has_plan_goal, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_has_plan_open, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_surface_is_current_only, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_surface_size_ok, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_has_recommendation_text, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_filter_hides_machine_recommendation_label, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_mode_filter_hides_plan_root, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_mode_filter_hides_goal, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_mode_filter_keeps_open, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_mode_filter_surface_is_current_only, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_open_filter_only_open, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_open_filter_has_open_first, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_applied_pending_has_state_tag, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_applied_pending_hides_machine_state_tag, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_ready_execute_hides_machine_recommendation_label, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_critical_guard_reason_is_human, true);
  assert.equal(startSlashSuggestionsContractPayload.plan_critical_guard_hides_machine_reason, true);
  assert.equal(startSlashSuggestionsContractPayload.ship_filter_has_user_command, true);
  assert.equal(startSlashSuggestionsContractPayload.plain_input_returns_empty, true);
  logStep("start-slash-suggestions-contract");

  const bridgeCliContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/bridge-cli-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("bridge-cli-contract", bridgeCliContractResult);
  const bridgeCliContractPayload = parseJsonOutput(
    "bridge-cli-contract",
    bridgeCliContractResult.stdout,
  );
  assert.equal(bridgeCliContractPayload.ok, true);
  assert.equal(bridgeCliContractPayload.open_without_plan_mode, "normal");
  assert.equal(bridgeCliContractPayload.open_without_plan_recommended_next_action, "/plan <goal>");
  assert.equal(bridgeCliContractPayload.entered_plan_mode, "plan_only");
  assert.equal(typeof bridgeCliContractPayload.entered_plan_id, "string");
  assert.equal(String(bridgeCliContractPayload.entered_plan_id).length > 0, true);
  assert.equal(bridgeCliContractPayload.entered_hint_lists_current_surface, true);
  assert.equal(bridgeCliContractPayload.entered_hint_is_human_surface, true);
  assert.equal(bridgeCliContractPayload.entered_hint_hides_machine_fields, true);
  assert.equal(bridgeCliContractPayload.open_with_plan_keeps_active_plan, true);
  assert.equal(bridgeCliContractPayload.open_with_plan_live_phase, "awaiting_decision");
  assert.equal(bridgeCliContractPayload.open_with_plan_live_status, "ready");
  assert.equal(bridgeCliContractPayload.open_with_plan_status_source, "live_snapshot");
  assert.equal(bridgeCliContractPayload.open_with_plan_stored_status, "draft");
  assert.equal(bridgeCliContractPayload.open_with_plan_assistant_message_human, true);
  assert.equal(bridgeCliContractPayload.open_with_plan_assistant_message_hides_machine_fields, true);
  assert.equal(
    bridgeCliContractPayload.open_with_plan_recommended_next_action,
    "Implement the plan.",
  );
  assert.equal(bridgeCliContractPayload.guard_error_code, "PLAN_GUARD_DENIED");
  assert.equal(bridgeCliContractPayload.guard_code, "PLAN_GUARD_DENIED");
  assert.equal(bridgeCliContractPayload.guard_mode_after_note, "plan_only");
  assert.equal(bridgeCliContractPayload.guard_assistant_message_human, true);
  assert.equal(bridgeCliContractPayload.guard_assistant_message_hides_machine_fields, true);
  logStep("bridge-cli-contract");

  const bridgePlanApplyFailureContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/bridge-plan-apply-failure-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("bridge-plan-apply-failure-contract", bridgePlanApplyFailureContractResult);
  const bridgePlanApplyFailureContractPayload = parseJsonOutput(
    "bridge-plan-apply-failure-contract",
    bridgePlanApplyFailureContractResult.stdout,
  );
  assert.equal(bridgePlanApplyFailureContractPayload.ok, true);
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_error_code, "PLAN_APPLY_EXEC_FAILED");
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_policy_action, "fail");
  assert.equal(
    bridgePlanApplyFailureContractPayload.apply_failure_policy_reason === "provider_runtime_failure"
      || bridgePlanApplyFailureContractPayload.apply_failure_policy_reason === "bridge_apply_exec_timeout"
      || bridgePlanApplyFailureContractPayload.apply_failure_policy_reason === "bridge_apply_exec_failed",
    true,
  );
  assert.equal(
    bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
      || bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_PROVIDER_RUNTIME_FAILURE"
      || bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_TIMEOUT"
      || bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_FAILED",
    true,
  );
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_plan_status, "apply_failed");
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_plan_phase, "awaiting_decision");
  assert.equal(bridgePlanApplyFailureContractPayload.status_latest_failure_event, "plan_apply_failed");
  assert.equal(
    bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
      || bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_PROVIDER_RUNTIME_FAILURE"
      || bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_TIMEOUT"
      || bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_FAILED",
    true,
  );
  assert.equal(bridgePlanApplyFailureContractPayload.status_after_failure_assistant_message_human, true);
  assert.equal(
    bridgePlanApplyFailureContractPayload.status_after_failure_assistant_message_hides_machine_fields,
    true,
  );
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_plan_apply_failed, true);
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_policy_action, true);
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_policy_reason, true);
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_diagnostic_code, true);
  logStep("bridge-plan-apply-failure-contract");

  const bridgeErrorCodesSchemaContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/bridge-error-codes-schema-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("bridge-error-codes-schema-contract", bridgeErrorCodesSchemaContractResult);
  const bridgeErrorCodesSchemaContractPayload = parseJsonOutput(
    "bridge-error-codes-schema-contract",
    bridgeErrorCodesSchemaContractResult.stdout,
  );
  assert.equal(bridgeErrorCodesSchemaContractPayload.ok, true);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.registry_count) >= 8, true);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.source_codes_count) >= 8, true);
  assert.equal(Array.isArray(bridgeErrorCodesSchemaContractPayload.source_codes), true);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.missing_in_schema_count), 0);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.extra_in_schema_count), 0);
  assert.equal(Array.isArray(bridgeErrorCodesSchemaContractPayload.observed_codes), true);
  assert.equal(bridgeErrorCodesSchemaContractPayload.fatal_error_code, "BRIDGE_FATAL");
  logStep("bridge-error-codes-schema-contract");

  const planEventsPolicyGuardContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/plan-events-policy-guard-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("plan-events-policy-guard-contract", planEventsPolicyGuardContractResult);
  const planEventsPolicyGuardContractPayload = parseJsonOutput(
    "plan-events-policy-guard-contract",
    planEventsPolicyGuardContractResult.stdout,
  );
  assert.equal(planEventsPolicyGuardContractPayload.ok, true);
  assert.equal(planEventsPolicyGuardContractPayload.baseline_allow_source, "default_all");
  assert.equal(planEventsPolicyGuardContractPayload.baseline_deny_source, "default_none");
  assert.equal(planEventsPolicyGuardContractPayload.scoped_allow_source, "env");
  assert.equal(planEventsPolicyGuardContractPayload.scoped_deny_source, "env");
  assert.equal(planEventsPolicyGuardContractPayload.overlap_rejected, true);
  assert.equal(planEventsPolicyGuardContractPayload.text_mode_has_scope_counts, true);
  logStep("plan-events-policy-guard-contract");

  const planQualityBenchmarkContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/plan-quality-benchmark-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("plan-quality-benchmark-contract", planQualityBenchmarkContractResult);
  const planQualityBenchmarkContractPayload = parseJsonOutput(
    "plan-quality-benchmark-contract",
    planQualityBenchmarkContractResult.stdout,
  );
  assert.equal(planQualityBenchmarkContractPayload.ok, true);
  assert.equal(planQualityBenchmarkContractPayload.winner_label, "strong");
  assert.equal(Number(planQualityBenchmarkContractPayload.compared_count), 2);
  assert.equal(
    planQualityBenchmarkContractPayload.assert_best_fail_code,
    "PLAN_BENCHMARK_ASSERT_BEST_FAILED",
  );
  logStep("plan-quality-benchmark-contract");
}
