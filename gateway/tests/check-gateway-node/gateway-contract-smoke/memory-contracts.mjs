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
export async function runMemoryContracts() {
  const memoryOrchestratorContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/memory-orchestrator-contract.ts",
  ]);
  assertSuccess("memory-orchestrator-contract", memoryOrchestratorContractResult);
  const memoryOrchestratorContractPayload = parseJsonOutput(
    "memory-orchestrator-contract",
    memoryOrchestratorContractResult.stdout,
  );
  assert.equal(memoryOrchestratorContractPayload.policy_has_override_ratio, true);
  assert.equal(Number(memoryOrchestratorContractPayload.policy_max_section_tokens), 800);
  assert.equal(memoryOrchestratorContractPayload.policy_default_min_tokens, true);
  assert.equal(memoryOrchestratorContractPayload.inject_has_prompt_parts, true);
  assert.equal(memoryOrchestratorContractPayload.inject_budget_positive, true);
  assert.equal(memoryOrchestratorContractPayload.inject_budget_respects_ratio, true);
  assert.equal(memoryOrchestratorContractPayload.reconcile_deduplicated, true);
  assert.equal(memoryOrchestratorContractPayload.reconcile_kept, true);
  assert.equal(memoryOrchestratorContractPayload.reconcile_rows_length, true);
  assert.equal(memoryOrchestratorContractPayload.decay_pruned, true);
  assert.equal(memoryOrchestratorContractPayload.decay_kept, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped, true);
  assert.equal(memoryOrchestratorContractPayload.decay_rows_length, true);
  assert.equal(memoryOrchestratorContractPayload.decay_kept_expected_rows, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped_age_count, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped_confidence_count, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped_capacity_count, true);
  assert.equal(memoryOrchestratorContractPayload.decay_reason_present, true);
  assert.equal(memoryOrchestratorContractPayload.decay_reason_has_capacity, true);
  assert.equal(memoryOrchestratorContractPayload.tune_decay_policy_applied_rows, true);
  assert.equal(memoryOrchestratorContractPayload.tune_decay_policy_applied_confidence, true);
  assert.equal(memoryOrchestratorContractPayload.tune_decay_policy_applied_age, true);
  assert.equal(memoryOrchestratorContractPayload.tune_injection_policy_applied, true);
  assert.equal(memoryOrchestratorContractPayload.inject_includes_ga_or_experience, true);
  assert.equal(memoryOrchestratorContractPayload.inject_filters_self_from_team_memory, true);
  assert.equal(memoryOrchestratorContractPayload.inject_emits_event, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_success_calls_ga_once, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_success_calls_experience_once, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_success_emits_publish_event, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_verification_failure_only_hits_experience, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_verification_failure_event, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_failure_calls_ga, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_failure_calls_experience, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_failure_event, true);
  logStep("memory-orchestrator-contract");

  const experiencePoolTaskContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/experience-pool-task-contract.ts",
  ]);
  assertSuccess("experience-pool-task-contract", experiencePoolTaskContractResult);
  const experiencePoolTaskContractPayload = parseJsonOutput(
    "experience-pool-task-contract",
    experiencePoolTaskContractResult.stdout,
  );
  assert.equal(experiencePoolTaskContractPayload.created_record, true);
  assert.equal(experiencePoolTaskContractPayload.failure_matched, true);
  assert.equal(experiencePoolTaskContractPayload.failure_stage_classified_runtime, true);
  assert.equal(experiencePoolTaskContractPayload.guardrails_generated_after_failure, true);
  assert.equal(experiencePoolTaskContractPayload.recovery_success_incremented, true);
  assert.equal(experiencePoolTaskContractPayload.consecutive_failure_reset_after_recovery, true);
  assert.equal(experiencePoolTaskContractPayload.attempt_history_has_both_outcomes, true);
  assert.equal(experiencePoolTaskContractPayload.search_prefers_task_overlap, true);
  assert.equal(experiencePoolTaskContractPayload.search_emits_task_or_scenario_signals, true);
  assert.equal(experiencePoolTaskContractPayload.roundtrip_task_signature_persisted, true);
  assert.equal(experiencePoolTaskContractPayload.roundtrip_attempt_history_persisted, true);
  assert.equal(experiencePoolTaskContractPayload.roundtrip_task_metadata_persisted, true);
  logStep("experience-pool-task-contract");

  const memoryDecayAutotuneContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/memory-decay-autotune-contract.ts",
  ]);
  assertSuccess("memory-decay-autotune-contract", memoryDecayAutotuneContractResult);
  const memoryDecayAutotuneContractPayload = parseJsonOutput(
    "memory-decay-autotune-contract",
    memoryDecayAutotuneContractResult.stdout,
  );
  assert.equal(memoryDecayAutotuneContractPayload.capacity_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.capacity_update_expands_rows, true);
  assert.equal(memoryDecayAutotuneContractPayload.capacity_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_tightens_verified, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_tightens_unverified, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_shrinks_rows, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_tightens_verified, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_tightens_unverified, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_expands_rows, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_relaxes_verified, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_relaxes_unverified, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_rows_floor, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_verified_confidence_clamped, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_unverified_confidence_clamped, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_alpha_clamped, true);
  assert.equal(memoryDecayAutotuneContractPayload.policy_applied_matches_state, true);
  assert.equal(memoryDecayAutotuneContractPayload.state_roundtrip_updates_kept, true);
  assert.equal(memoryDecayAutotuneContractPayload.state_roundtrip_reason_kept, true);
  logStep("memory-decay-autotune-contract");

  const memoryStrategyAutotuneContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/memory-strategy-autotune-contract.ts",
  ]);
  assertSuccess("memory-strategy-autotune-contract", memoryStrategyAutotuneContractResult);
  const memoryStrategyAutotuneContractPayload = parseJsonOutput(
    "memory-strategy-autotune-contract",
    memoryStrategyAutotuneContractResult.stdout,
  );
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_update_changed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_budget_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_section_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_score_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_alpha_rebalanced, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_update_changed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_budget_relaxed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_section_relaxed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_score_relaxed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_alpha_rebalanced, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_changed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_budget_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_section_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_quality_still_healthy, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_hold_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_hold_keeps_ratio, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_hold_decrements_window, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_release_has_relax_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_release_ratio_increases, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_release_direction_relax, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_budget_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_schema_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_profile_defaulted, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_section_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_rows_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_score_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_alpha_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_followup_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_cooldown_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_action_scale_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_pending_defaults, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_outcome_defaults, true);
  assert.equal(memoryStrategyAutotuneContractPayload.delivery_profile_switched, true);
  assert.equal(memoryStrategyAutotuneContractPayload.delivery_profile_triggers_tighten, true);
  assert.equal(memoryStrategyAutotuneContractPayload.docs_profile_switched, true);
  assert.equal(
    memoryStrategyAutotuneContractPayload.docs_profile_more_conservative_than_delivery,
    true,
  );
  assert.equal(memoryStrategyAutotuneContractPayload.pending_warmup_reason_present, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pending_warmup_turn_decremented, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_cooldown_applied, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_pending_cleared, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_restores_budget_range, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_counter_incremented, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_outcome_negative, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_direction_neutral, true);
  assert.equal(memoryStrategyAutotuneContractPayload.policy_applied_matches_state, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_updates_kept, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_reason_kept, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_profile_kept, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_schema_kept, true);
  logStep("memory-strategy-autotune-contract");

  const interactiveBindingsResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-interactive-bindings-contract.ts",
  ]);
  assertSuccess("start-interactive-bindings-contract", interactiveBindingsResult);
  const interactiveBindingsPayload = parseJsonOutput(
    "start-interactive-bindings-contract",
    interactiveBindingsResult.stdout,
  );
  assert.equal(interactiveBindingsPayload.pass_through_project_name, true);
  assert.equal(interactiveBindingsPayload.pass_through_session_runtime, true);
  assert.equal(Number(interactiveBindingsPayload.switch_calls), 2);
  assert.equal(interactiveBindingsPayload.switch_first_call, "session-a:switch");
  assert.equal(interactiveBindingsPayload.switch_second_call, "session-b:switch");
  assert.equal(Number(interactiveBindingsPayload.model_override_count), 1);
  assert.equal(interactiveBindingsPayload.health_has_header, true);
  assert.equal(interactiveBindingsPayload.health_has_sticky_provider, true);
  assert.equal(interactiveBindingsPayload.health_has_provider_row, true);
  assert.equal(interactiveBindingsPayload.context_status_has_header, true);
  assert.equal(interactiveBindingsPayload.context_status_has_system_prompt_name, true);
  assert.equal(interactiveBindingsPayload.context_status_keeps_memory_separate, true);
  assert.equal(interactiveBindingsPayload.memory_status_has_header, true);
  assert.equal(interactiveBindingsPayload.skills_status_counts_project_skill, true);
  assert.equal(interactiveBindingsPayload.skills_status_counts_global_skill, true);
  assert.equal(interactiveBindingsPayload.mcp_status_has_server, true);
  assert.equal(interactiveBindingsPayload.mcp_status_instruction_pack_loaded, true);
  assert.equal(interactiveBindingsPayload.init_prompt_targets_agents, true);
  assert.equal(interactiveBindingsPayload.init_prompt_blocks_trellis, true);
  assert.equal(interactiveBindingsPayload.init_prompt_blocks_system_prompt_file, true);
  assert.equal(interactiveBindingsPayload.init_existing_agents_skips, true);
  assert.equal(interactiveBindingsPayload.init_generation_surface_is_human, true);
  assert.equal(interactiveBindingsPayload.manual_handoff_reason, "manual-command");
  assert.equal(interactiveBindingsPayload.manual_handoff_to_stderr, false);
  assert.equal(interactiveBindingsPayload.auto_exit_to_stderr, false);
  assert.equal(Number(interactiveBindingsPayload.history_count), 2);
  assert.equal(interactiveBindingsPayload.help_text, "contract-help");
  assert.equal(interactiveBindingsPayload.active_session_id, "main");
  assert.equal(interactiveBindingsPayload.active_session_topic, "");
  assert.equal(interactiveBindingsPayload.model_snapshot_model, "alpha-model");
  assert.equal(interactiveBindingsPayload.model_snapshot_provider, "alpha");
  assert.equal(Number(interactiveBindingsPayload.prompt_budget_ctx_ratio), 0.42);
  assert.equal(Number(interactiveBindingsPayload.prompt_budget_estimated_tokens), 512);
  assert.equal(Number(interactiveBindingsPayload.prompt_budget_target_tokens), 2048);
  assert.equal(interactiveBindingsPayload.status_snapshot_has_header, true);
  assert.equal(interactiveBindingsPayload.status_surface_hides_machine_fields, true);
  assert.equal(interactiveBindingsPayload.status_theme_after_update, "nerd_font");
  assert.equal(interactiveBindingsPayload.status_layout_after_update, "compact");
  assert.equal(interactiveBindingsPayload.status_tokens_segment_after_update, false);
  assert.equal(interactiveBindingsPayload.status_menu_cancel_is_silent, true);
  assert.equal(interactiveBindingsPayload.status_menu_hint_is_reference_compact, true);
  assert.equal(interactiveBindingsPayload.history_search_hint_is_reference_fill, true);
  assert.equal(interactiveBindingsPayload.interactive_menu_hints_omit_secondary_key_chords, true);
  assert.equal(interactiveBindingsPayload.ask_status_no_pending_warned, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_clean_question, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_clean_options, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_menu_hint, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_options_preview, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_log_prefix, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_output_mode_full, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_options_more, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_pending_total, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_followup_row, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_reply_direct_log_hint, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_status_only_log_hint, true);
  assert.equal(interactiveBindingsPayload.ask_queue_hint_hides_log_prefix, true);
  assert.equal(interactiveBindingsPayload.ask_queue_hint_mentions_followup_count, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_has_header, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_output_mode, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_detail_hint, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_has_pending_total, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_followup_rows, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_status_only_hint, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_returns_continue, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_auto_opens_initial_runtime_ask, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_uses_input_pause, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_feeds_selected_answer, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_keeps_failure_clear, true);
  logStep("start-interactive-bindings-contract");

  const modelOpsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-model-ops-contract.ts",
  ]);
  assertSuccess("start-model-ops-contract", modelOpsContractResult);
  const modelOpsContractPayload = parseJsonOutput(
    "start-model-ops-contract",
    modelOpsContractResult.stdout,
  );
  assert.equal(modelOpsContractPayload.initial_snapshot_provider, "provider-main");
  assert.equal(modelOpsContractPayload.initial_snapshot_model, "model-default");
  assert.equal(modelOpsContractPayload.initial_snapshot_source, "config:provider:model");
  assert.equal(modelOpsContractPayload.initial_model, "model-default");
  assert.equal(modelOpsContractPayload.initial_source, "config:provider:model");
  assert.equal(modelOpsContractPayload.initial_session_title, "Main Session");
  assert.equal(
    modelOpsContractPayload.initial_session_summary,
    "Trace model override and reset contract",
  );
  assert.equal(modelOpsContractPayload.model_current_surface_is_human, true);
  assert.equal(modelOpsContractPayload.model_switch_surface_is_human, true);
  assert.equal(modelOpsContractPayload.model_reset_surface_is_human, true);
  assert.equal(modelOpsContractPayload.main_model_after_use, "model-variant");
  assert.equal(modelOpsContractPayload.main_source_after_use, "config_toml:provider.model");
  assert.equal(modelOpsContractPayload.main_session_id_after_use, "session-main");
  assert.equal(modelOpsContractPayload.main_session_title_after_use, "Main Session");
  assert.equal(
    modelOpsContractPayload.main_session_summary_after_use,
    "Trace model override and reset contract",
  );
  assert.equal(modelOpsContractPayload.main_model_after_reset, "model-default");
  assert.equal(
    modelOpsContractPayload.main_source_after_reset,
    "config_toml:provider.model",
  );
  assert.equal(modelOpsContractPayload.branch_model_after_switch, "model-default");
  assert.equal(
    modelOpsContractPayload.branch_source_after_switch,
    "config_toml:provider.model",
  );
  assert.equal(
    modelOpsContractPayload.branch_session_id_after_switch,
    "session-branch",
  );
  assert.equal(
    modelOpsContractPayload.branch_session_title_after_switch,
    "Branch Session",
  );
  assert.equal(
    modelOpsContractPayload.branch_session_summary_after_switch,
    "Follow-up fallback regression",
  );
  assert.equal(Number(modelOpsContractPayload.list_calls), 4);
  assert.equal(Number(modelOpsContractPayload.persist_call_count), 2);
  assert.equal(modelOpsContractPayload.persist_first_call, "provider-main:model-variant");
  assert.equal(modelOpsContractPayload.persist_second_call, "provider-main:model-default");
  assert.equal(modelOpsContractPayload.list_surface_is_human, true);
  assert.equal(modelOpsContractPayload.list_output_has_current_marker, true);
  assert.equal(modelOpsContractPayload.list_output_has_variant, true);
  assert.equal(Number(modelOpsContractPayload.model_menu_pause_calls), 1);
  assert.equal(modelOpsContractPayload.model_menu_variant, "model_picker");
  assert.equal(modelOpsContractPayload.model_menu_hint_is_reference_compact, true);
  assert.equal(modelOpsContractPayload.model_menu_initial_index_points_to_current, true);
  assert.equal(modelOpsContractPayload.model_menu_current_item_marked, true);
  assert.equal(modelOpsContractPayload.model_menu_meta_current_model, "model-default");
  assert.equal(modelOpsContractPayload.model_menu_meta_startup_model, "model-default");
  assert.equal(modelOpsContractPayload.model_menu_cancel_is_silent, true);
  assert.equal(
    modelOpsContractPayload.runtime_source_after_switch,
    "config_toml:provider.model",
  );
  logStep("start-model-ops-contract");

  const modelConfigSyncContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/start-model-config-sync-contract.ts",
  ]);
  assertSuccess("start-model-config-sync-contract", modelConfigSyncContractResult);
  const modelConfigSyncContractPayload = parseJsonOutput(
    "start-model-config-sync-contract",
    modelConfigSyncContractResult.stdout,
  );
  assert.equal(modelConfigSyncContractPayload.update_existing_ok, true);
  assert.equal(modelConfigSyncContractPayload.update_existing_previous_model, true);
  assert.equal(modelConfigSyncContractPayload.update_existing_comment_preserved, true);
  assert.equal(modelConfigSyncContractPayload.update_existing_secondary_untouched, true);
  assert.equal(modelConfigSyncContractPayload.insert_missing_ok, true);
  assert.equal(modelConfigSyncContractPayload.insert_missing_previous_model_empty, true);
  assert.equal(modelConfigSyncContractPayload.insert_missing_added_model, true);
  assert.equal(modelConfigSyncContractPayload.fallback_by_workdir_ok, true);
  assert.equal(modelConfigSyncContractPayload.fallback_selected_provider_updated, true);
  assert.equal(modelConfigSyncContractPayload.fallback_non_selected_provider_untouched, true);
  assert.equal(modelConfigSyncContractPayload.missing_config_path_failed, true);
  assert.equal(modelConfigSyncContractPayload.empty_model_failed, true);
  assert.equal(modelConfigSyncContractPayload.missing_file_failed, true);
  logStep("start-model-config-sync-contract");
}
