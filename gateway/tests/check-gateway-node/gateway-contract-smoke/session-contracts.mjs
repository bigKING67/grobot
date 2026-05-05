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
export async function runSessionContracts() {
  const sessionInteractiveDispatchResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-interactive-dispatch-contract.ts",
  ]);
  assertSuccess("session-interactive-dispatch-contract", sessionInteractiveDispatchResult);
  const sessionInteractiveDispatchPayload = parseJsonOutput(
    "session-interactive-dispatch-contract",
    sessionInteractiveDispatchResult.stdout,
  );
  assert.equal(sessionInteractiveDispatchPayload.switch_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.continue_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.model_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.model_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.plan_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_prefix_miss_entered_plan, false);
  assert.equal(sessionInteractiveDispatchPayload.switch_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_legacy_with_id_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_legacy_with_id_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_legacy_with_id_skips_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_legacy_with_id_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_legacy_with_id_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_legacy_with_id_skips_direct_continue, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_tty_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_tty_opened_resume_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_menu_alias_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_prefix_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_keyword_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_keyword_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_title_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_id_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_id_underscore_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_id_space_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_quoted_title_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_updated_at_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_updated_at_digits_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_updated_at_digits_contains_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_no_match_message, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_message_has_prefix, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_message_has_menu_hint, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_surface_avoids_legacy_marker, true);
  assert.equal(sessionInteractiveDispatchPayload.session_command_redirect_surface_avoids_legacy_marker, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_surface_avoids_legacy_marker, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_includes_quick_pick, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_includes_title_preview, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_includes_summary_preview, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_uses_compact_timestamp, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_uses_reference_detail_rows, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_overflow_tty_includes_overflow_line, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_overflow_tty_includes_quick_pick_header, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_empty_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_empty_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_empty_tty_usage_has_updated_at, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_tty_exact_checkpoint, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_tty_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_includes_quick_pick, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_includes_assistant_preview, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_uses_reference_detail_rows, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_uses_compact_timestamp, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_overflow_tty_includes_overflow_line, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_overflow_tty_includes_quick_pick_header, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_warning_surfaces_avoid_legacy_marker, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_query_mode_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_user_text_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_assistant_text_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_user_text_compact_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_compact_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_underscore_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_space_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_quoted_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_created_at_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_created_at_digits_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_created_at_digits_contains_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_no_match_message, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_no_match_message, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_summarize_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_code_mode_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_query_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_created_at_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_compact_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_underscore_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_space_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_quoted_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_created_at_digits_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_created_at_digits_contains_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_find_empty_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_find_empty_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_find_empty_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_empty_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_empty_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_empty_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_mode_only_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_mode_only_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_mode_only_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_with_args_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_with_args_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_with_args_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.model_menu_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.model_legacy_reset_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.model_legacy_reset_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.plan_root_tty_enters_plan_directly, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_enters_plan_when_outside, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_skips_editor_when_outside, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_in_plan_opened_editor, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_in_plan_skips_plan_entry, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_non_tty_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_non_tty_enters_plan_when_outside, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_non_tty_in_plan_dispatched_status, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_enters_plan_directly, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_in_plan_shows_current_plan, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_in_plan_skips_new_plan, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_removed_subcommand_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_removed_subcommand_hides_machine_output, true);
  assert.equal(sessionInteractiveDispatchPayload.blocked_plan_mode_command_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.blocked_plan_mode_command_avoids_raw_labels, true);
  assert.equal(sessionInteractiveDispatchPayload.blocked_plan_mode_command_avoids_legacy_marker, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_natural_execute_in_plan_mode_dispatches_apply, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_natural_execute_in_plan_mode_skips_plan_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_refine_in_plan_mode_dispatches_plan_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_refine_in_plan_mode_passes_input_pause, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_passes_input_pause, true);
  assert.equal(sessionInteractiveDispatchPayload.exit_command_breaks_loop, true);
  assert.equal(sessionInteractiveDispatchPayload.exit_command_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.exit_alias_slash_quit_breaks_loop, true);
  assert.equal(sessionInteractiveDispatchPayload.exit_alias_slash_quit_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.exit_alias_quit_breaks_loop, true);
  assert.equal(sessionInteractiveDispatchPayload.commands_menu_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.commands_list_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_unknown_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.ask_invalid_args_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_invalid_args_usage_hint, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_invalid_args_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_with_demand_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_with_demand_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_tty_prompted, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_usage, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_prompted, false);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.init_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.init_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.context_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.context_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.memory_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.memory_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.skills_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.skills_dispatched_to_stdout, true);
  assert.equal(sessionInteractiveDispatchPayload.skills_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.mcp_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.mcp_dispatched_to_stdout, true);
  assert.equal(sessionInteractiveDispatchPayload.mcp_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.user_command_checked, true);
  assert.equal(sessionInteractiveDispatchPayload.user_command_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_hint_has_reply_guidance, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_hint_has_prompt_summary, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_hint_has_short_menu_hint, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_help_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_help_blocked_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_interrupt_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_sessions_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_resume_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_rewind_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_ask_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_ask_invalid_args_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_ask_invalid_args_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_plain_text_runs_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_plain_text_blocked_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_empty_opens_selector, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_empty_selection_runs_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_question_mark_opens_selector, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_question_mark_selection_runs_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_first_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_second_suppressed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_third_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_third_mentions_suppressed_count, true);
  logStep("session-interactive-dispatch-contract");

  const sessionResumeStartupContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-resume-startup-contract.ts",
  ]);
  assertSuccess("session-resume-startup-contract", sessionResumeStartupContractResult);
  const sessionResumeStartupContractPayload = parseJsonOutput(
    "session-resume-startup-contract",
    sessionResumeStartupContractResult.stdout,
  );
  assert.equal(sessionResumeStartupContractPayload.no_intent_skips_resume_target, true);
  assert.equal(sessionResumeStartupContractPayload.no_intent_skips_notice, true);
  assert.equal(sessionResumeStartupContractPayload.resume_default_targets_latest_non_active, true);
  assert.equal(sessionResumeStartupContractPayload.resume_last_targets_latest_non_active, true);
  assert.equal(sessionResumeStartupContractPayload.resume_exact_id_targeted, true);
  assert.equal(sessionResumeStartupContractPayload.resume_single_query_match_targeted, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_auto_selects_top, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_requires_disambiguation, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_candidates_exposed, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_notice_contains_tip, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_notice_no_autoselect_literal, true);
  assert.equal(
    sessionResumeStartupContractPayload.resume_no_match_fallback_targets_latest_non_active,
    true,
  );
  assert.equal(sessionResumeStartupContractPayload.resume_no_match_fallback_has_notice, true);
  assert.equal(sessionResumeStartupContractPayload.resume_no_match_without_fallback_has_notice, true);
  assert.equal(sessionResumeStartupContractPayload.resume_all_can_match_active_title, true);
  assert.equal(sessionResumeStartupContractPayload.resume_all_flag_only_is_resume_intent, true);
  assert.equal(sessionResumeStartupContractPayload.resume_requested_accepts_false_literal_as_query, true);
  assert.equal(sessionResumeStartupContractPayload.resume_selector_keeps_false_literal, true);
  logStep("session-resume-startup-contract");

  const sessionResumeStartupDisambiguationContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-resume-startup-disambiguation-contract.ts",
  ]);
  assertSuccess(
    "session-resume-startup-disambiguation-contract",
    sessionResumeStartupDisambiguationContractResult,
  );
  const sessionResumeStartupDisambiguationContractPayload = parseJsonOutput(
    "session-resume-startup-disambiguation-contract",
    sessionResumeStartupDisambiguationContractResult.stdout,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_picks_explicit_session,
    true,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_pick_has_no_messages,
    true,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_cancel_clears_target,
    true,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_cancel_is_silent,
    true,
  );
  assert.equal(sessionResumeStartupDisambiguationContractPayload.non_tty_does_not_call_picker, true);
  assert.equal(sessionResumeStartupDisambiguationContractPayload.non_tty_keeps_auto_selected_target, true);
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.non_tty_reports_auto_selected_notice,
    true,
  );
  assert.equal(sessionResumeStartupDisambiguationContractPayload.no_disambiguation_keeps_target, true);
  assert.equal(sessionResumeStartupDisambiguationContractPayload.no_disambiguation_has_no_messages, true);
  logStep("session-resume-startup-disambiguation-contract");

  const sessionRewindStartupContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-rewind-startup-contract.ts",
  ]);
  assertSuccess("session-rewind-startup-contract", sessionRewindStartupContractResult);
  const sessionRewindStartupContractPayload = parseJsonOutput(
    "session-rewind-startup-contract",
    sessionRewindStartupContractResult.stdout,
  );
  assert.equal(sessionRewindStartupContractPayload.no_intent_skips_rewind_target, true);
  assert.equal(sessionRewindStartupContractPayload.no_intent_skips_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_default_targets_latest, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_exact_id_targeted, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_single_query_match_targeted, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_auto_selects_top, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_requires_disambiguation, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_candidates_exposed, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_notice_contains_tip, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_notice_is_human_surface, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_notice_no_autoselect_literal, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_no_match_fallback_targets_latest, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_no_match_fallback_has_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_no_match_without_fallback_has_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_strict_exact_targeted, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_strict_no_match_skips_target, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_strict_no_match_has_skip_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_startup_notices_avoid_legacy_marker, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_requested_accepts_false_literal_as_query, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_selector_keeps_false_literal, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_default_is_both, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_rewind_files_defaults_code, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_explicit_conversation, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_summary_alias_maps_summarize, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_invalid_falls_back_both, true);
  logStep("session-rewind-startup-contract");

  const sessionRewindStartupDisambiguationContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-rewind-startup-disambiguation-contract.ts",
  ]);
  assertSuccess(
    "session-rewind-startup-disambiguation-contract",
    sessionRewindStartupDisambiguationContractResult,
  );
  const sessionRewindStartupDisambiguationContractPayload = parseJsonOutput(
    "session-rewind-startup-disambiguation-contract",
    sessionRewindStartupDisambiguationContractResult.stdout,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_picks_explicit_checkpoint,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_pick_has_no_messages,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_cancel_clears_target,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_cancel_is_silent,
    true,
  );
  assert.equal(sessionRewindStartupDisambiguationContractPayload.non_tty_does_not_call_picker, true);
  assert.equal(sessionRewindStartupDisambiguationContractPayload.non_tty_keeps_auto_selected_target, true);
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.non_tty_reports_auto_selected_notice,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.non_tty_notice_avoids_legacy_marker,
    true,
  );
  assert.equal(sessionRewindStartupDisambiguationContractPayload.no_disambiguation_keeps_target, true);
  assert.equal(sessionRewindStartupDisambiguationContractPayload.no_disambiguation_has_no_messages, true);
  logStep("session-rewind-startup-disambiguation-contract");
}
