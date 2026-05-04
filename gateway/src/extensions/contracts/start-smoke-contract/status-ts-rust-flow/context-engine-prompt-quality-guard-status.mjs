export function collectContextEnginePromptQualityGuardStatusSurface({
  contextEngine,
  isObject,
}) {
  const contextEnginePromptQuality = isObject(contextEngine?.prompt_quality)
    ? contextEngine.prompt_quality
    : null;
  const contextEnginePromptQualityGuardAdaptiveModeAllowlist = Array.isArray(
    contextEnginePromptQuality?.guard_adaptive_mode_allowlist,
  )
    ? contextEnginePromptQuality.guard_adaptive_mode_allowlist
    : null;
  const contextEnginePromptQualityGuardState = isObject(contextEngine?.prompt_quality_guard_state)
    ? contextEngine.prompt_quality_guard_state
    : null;
  const contextEnginePromptQualityGuardRuntimeAssessment = isObject(
    contextEngine?.prompt_quality_guard_runtime_assessment,
  )
    ? contextEngine.prompt_quality_guard_runtime_assessment
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicy = isObject(
    contextEngine?.prompt_quality_guard_adaptive_policy,
  )
    ? contextEngine.prompt_quality_guard_adaptive_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyAllowlist = Array.isArray(
    contextEnginePromptQualityGuardAdaptivePolicy?.allowlist,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.allowlist
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyBase = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.base_policy,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.base_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyEffective = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.effective_policy,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.effective_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyAdjustment = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.adjustment,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.adjustment
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.pressure_policy,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.pressure_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.outcome_reliability,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.outcome_reliability
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.outcome_drift_guard,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.outcome_drift_guard
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary = isObject(
    contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.window_summary,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard.window_summary
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyWindow = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.window,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.window
    : null;

  return {
    status_context_engine_prompt_quality_low_quality_threshold_type:
      typeof contextEnginePromptQuality?.low_quality_threshold,
    status_context_engine_prompt_quality_degrade_overall_threshold_type:
      typeof contextEnginePromptQuality?.degrade_overall_threshold,
    status_context_engine_prompt_quality_degrade_low_quality_rate_threshold_type:
      typeof contextEnginePromptQuality?.degrade_low_quality_rate_threshold,
    status_context_engine_prompt_quality_degrade_min_entries_type:
      typeof contextEnginePromptQuality?.degrade_min_entries,
    status_context_engine_prompt_quality_guard_enabled_type:
      typeof contextEnginePromptQuality?.guard_enabled,
    status_context_engine_prompt_quality_guard_adaptive_enabled_type:
      typeof contextEnginePromptQuality?.guard_adaptive_enabled,
    status_context_engine_prompt_quality_guard_adaptive_mode_allowlist_type:
      Array.isArray(contextEnginePromptQualityGuardAdaptiveModeAllowlist) ? "array" : "undefined",
    status_context_engine_prompt_quality_guard_promote_streak_type:
      typeof contextEnginePromptQuality?.guard_promote_streak,
    status_context_engine_prompt_quality_guard_severe_promote_streak_type:
      typeof contextEnginePromptQuality?.guard_severe_promote_streak,
    status_context_engine_prompt_quality_guard_release_streak_type:
      typeof contextEnginePromptQuality?.guard_release_streak,
    status_context_engine_prompt_quality_guard_hold_turns_type:
      typeof contextEnginePromptQuality?.guard_hold_turns,
    status_context_engine_prompt_quality_guard_max_floor_stage_type:
      typeof contextEnginePromptQuality?.guard_max_floor_stage,
    status_context_engine_prompt_quality_guard_severe_overall_threshold_type:
      typeof contextEnginePromptQuality?.guard_severe_overall_threshold,
    status_context_engine_prompt_quality_guard_severe_low_quality_rate_threshold_type:
      typeof contextEnginePromptQuality?.guard_severe_low_quality_rate_threshold,
    status_context_engine_has_prompt_quality_guard_state:
      Boolean(contextEnginePromptQualityGuardState),
    status_context_engine_prompt_quality_guard_state_floor_stage_type:
      typeof contextEnginePromptQualityGuardState?.floor_stage,
    status_context_engine_prompt_quality_guard_state_degraded_streak_type:
      typeof contextEnginePromptQualityGuardState?.degraded_streak,
    status_context_engine_prompt_quality_guard_state_severe_streak_type:
      typeof contextEnginePromptQualityGuardState?.severe_streak,
    status_context_engine_prompt_quality_guard_state_healthy_streak_type:
      typeof contextEnginePromptQualityGuardState?.healthy_streak,
    status_context_engine_prompt_quality_guard_state_hold_turns_remaining_type:
      typeof contextEnginePromptQualityGuardState?.hold_turns_remaining,
    status_context_engine_prompt_quality_guard_state_last_reason_type:
      typeof contextEnginePromptQualityGuardState?.last_reason,
    status_context_engine_prompt_quality_guard_state_updated_at_type:
      contextEnginePromptQualityGuardState?.updated_at === null
        ? "null"
        : typeof contextEnginePromptQualityGuardState?.updated_at,
    status_context_engine_prompt_quality_guard_state_pressure_utilization_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_utilization_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_semantic_rate_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_semantic_rate_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_auto_limit_rate_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_auto_limit_rate_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_joint_rate_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_joint_rate_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_trend_utilization_delta_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_utilization_delta,
    status_context_engine_prompt_quality_guard_state_pressure_trend_semantic_delta_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_semantic_delta,
    status_context_engine_prompt_quality_guard_state_pressure_trend_auto_limit_delta_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_auto_limit_delta,
    status_context_engine_prompt_quality_guard_state_pressure_trend_momentum_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_momentum,
    status_context_engine_prompt_quality_guard_state_outcome_required_transitions_type:
      typeof contextEnginePromptQualityGuardState?.outcome_required_transitions,
    status_context_engine_prompt_quality_guard_state_outcome_combined_evidence_score_type:
      typeof contextEnginePromptQualityGuardState?.outcome_combined_evidence_score,
    status_context_engine_prompt_quality_guard_state_outcome_high_evidence_turns_type:
      typeof contextEnginePromptQualityGuardState?.outcome_high_evidence_turns,
    status_context_engine_prompt_quality_guard_state_outcome_high_evidence_harden_turns_type:
      typeof contextEnginePromptQualityGuardState?.outcome_high_evidence_harden_turns,
    status_context_engine_prompt_quality_guard_state_outcome_drift_recent_auto_action_levels_type:
      Array.isArray(contextEnginePromptQualityGuardState?.outcome_drift_recent_auto_action_levels)
        ? "array"
        : typeof contextEnginePromptQualityGuardState?.outcome_drift_recent_auto_action_levels,
    status_context_engine_prompt_quality_guard_state_persistence_domain_type:
      typeof contextEnginePromptQualityGuardState?.persistence_domain,
    status_context_engine_has_prompt_quality_guard_runtime_assessment:
      Boolean(contextEnginePromptQualityGuardRuntimeAssessment),
    status_context_engine_prompt_quality_guard_runtime_assessment_enabled_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.enabled,
    status_context_engine_prompt_quality_guard_runtime_assessment_phase_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.phase,
    status_context_engine_prompt_quality_guard_runtime_assessment_transition_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.transition,
    status_context_engine_prompt_quality_guard_runtime_assessment_degraded_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.degraded,
    status_context_engine_prompt_quality_guard_runtime_assessment_severe_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.severe,
    status_context_engine_prompt_quality_guard_runtime_assessment_reason_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.reason,
    status_context_engine_prompt_quality_guard_runtime_assessment_triggered_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.triggered,
    status_context_engine_prompt_quality_guard_runtime_assessment_floor_stage_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.floor_stage,
    status_context_engine_prompt_quality_guard_runtime_assessment_proposed_floor_stage_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.proposed_floor_stage,
    status_context_engine_prompt_quality_guard_runtime_assessment_promote_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.promote_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_severe_promote_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.severe_promote_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_release_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.release_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_hold_turns_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.hold_turns_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_observed_overall_type:
      contextEnginePromptQualityGuardRuntimeAssessment?.observed_overall === null
        ? "null"
        : typeof contextEnginePromptQualityGuardRuntimeAssessment?.observed_overall,
    status_context_engine_prompt_quality_guard_runtime_assessment_observed_low_quality_rate_type:
      contextEnginePromptQualityGuardRuntimeAssessment?.observed_low_quality_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardRuntimeAssessment?.observed_low_quality_rate,
    status_context_engine_has_prompt_quality_guard_adaptive_policy:
      Boolean(contextEnginePromptQualityGuardAdaptivePolicy),
    status_context_engine_prompt_quality_guard_adaptive_policy_mode_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicy?.mode,
    status_context_engine_prompt_quality_guard_adaptive_policy_reason_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicy?.reason,
    status_context_engine_prompt_quality_guard_adaptive_policy_allowlist_type:
      Array.isArray(contextEnginePromptQualityGuardAdaptivePolicyAllowlist) ? "array" : "undefined",
    status_context_engine_prompt_quality_guard_adaptive_policy_mode_blocked_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicy?.mode_blocked,
    status_context_engine_prompt_quality_guard_adaptive_policy_blocked_mode_type:
      contextEnginePromptQualityGuardAdaptivePolicy?.blocked_mode === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicy?.blocked_mode,
    status_context_engine_prompt_quality_guard_adaptive_policy_base_promote_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyBase?.promote_streak,
    status_context_engine_prompt_quality_guard_adaptive_policy_effective_promote_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyEffective?.promote_streak,
    status_context_engine_prompt_quality_guard_adaptive_policy_effective_release_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyEffective?.release_streak,
    status_context_engine_prompt_quality_guard_adaptive_policy_effective_hold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyEffective?.hold_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_promote_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyAdjustment?.promote_streak_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_release_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyAdjustment?.release_streak_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_hold_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyAdjustment?.hold_turns_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_source_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.source,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_updated_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.updated,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_learn_alpha_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.learn_alpha,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_utilization_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.utilization_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_semantic_rate_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.semantic_rate_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_auto_limit_rate_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.auto_limit_rate_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_joint_rate_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.joint_rate_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_utilization_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_utilization_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_semantic_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_semantic_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_auto_limit_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_auto_limit_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_momentum_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_momentum,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_flip_suppressed_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_flip_suppressed,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_required_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.required_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_next_required_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.next_required_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.hard_budget_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.quality_first_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_evidence_score_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.hard_budget_evidence_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_evidence_score_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.quality_first_evidence_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_combined_evidence_score_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.combined_evidence_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_reliable_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.hard_budget_reliable,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_reliable_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.quality_first_reliable,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_bias_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_harden_bias,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_turn_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_turn,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_turns_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_turns_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_harden_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_harden_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_threshold_harden_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.threshold_harden_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_min_high_evidence_turns_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.min_high_evidence_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_reason_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.reason,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_auto_action_level_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.auto_action_level,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_recent_auto_action_levels_type:
      Array.isArray(contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.recent_auto_action_levels)
        ? "array"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.recent_auto_action_levels,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_entries_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.entries,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_latest_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.latest,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_dominant_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.dominant,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_alert_level_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.alert_level,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_transition_count_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.transition_count,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_active_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.active_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_medium_or_hard_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.medium_or_hard_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_hard_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.hard_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_level_counts_type:
      isObject(contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.level_counts)
        ? "object"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.level_counts,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_recommendation_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.recommendation,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_semantic_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_auto_limit_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.auto_limit_triggered_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_utilization_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_utilization_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_utilization_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_semantic_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_snapshot_semantic_compress_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_semantic_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_snapshot_semantic_compress_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_auto_limit_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_auto_limit_triggered_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_auto_limit_triggered_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_auto_limit_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_auto_limit_triggered_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_auto_limit_triggered_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_avg_utilization_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_utilization_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_utilization_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_avg_utilization_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_utilization_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_utilization_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_pre_send_overflow_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_overflow_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_overflow_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_pre_send_pressure_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_pressure_score === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_pressure_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_hard_budget_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_hard_budget_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_hard_budget_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_hard_budget_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_hard_budget_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_hard_budget_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_avg_pre_send_overflow_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_overflow_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_overflow_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_avg_pre_send_overflow_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_overflow_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_overflow_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_avg_pre_send_pressure_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_pressure_score === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_pressure_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_avg_pre_send_pressure_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_pressure_score === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_pressure_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_followup_delta_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_followup_overall_delta === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_followup_overall_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_followup_delta_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_followup_overall_delta === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_followup_overall_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_recovery_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_recovery_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_recovery_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_improved_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_improved_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_improved_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_transition_count_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_transition_count === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_transition_count,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_transition_count_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_transition_count === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_transition_count,
  };
}
