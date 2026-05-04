import {
  assertRuntimeToolRecoveryPolicyStatusSurface,
  assertRuntimeToolSchemaArgVisibility,
  sumStringArrayRecordLengths,
} from "../runtime-tool-status.mjs";

export function collectRuntimeToolStatusSurface({
  runtimeTools,
  runtimeHealth,
  topLevelCacheStats,
  cacheStatsLocation,
  isObject,
}) {
  const runtimeToolsQuality = isObject(runtimeTools?.quality)
    ? runtimeTools.quality
    : null;
  const runtimeToolModelVisibleTools = Array.isArray(runtimeTools?.model_visible_tools)
    ? runtimeTools.model_visible_tools
    : [];
  const runtimeToolDispatchEnabledTools = Array.isArray(runtimeTools?.dispatch_enabled_tools)
    ? runtimeTools.dispatch_enabled_tools
    : [];
  const runtimeToolSurfaceDecision = isObject(runtimeTools?.surface_decision)
    ? runtimeTools.surface_decision
    : null;
  const runtimeToolSchemaProjection = isObject(runtimeTools?.schema_projection)
    ? runtimeTools.schema_projection
    : null;
  const runtimeToolSchemaProjectionDrift = isObject(runtimeTools?.schema_projection_drift)
    ? runtimeTools.schema_projection_drift
    : null;
  const runtimeToolSchemaProjectionDriftArgMismatchDetails =
    Array.isArray(runtimeToolSchemaProjectionDrift?.arg_mismatch_details)
      ? runtimeToolSchemaProjectionDrift.arg_mismatch_details
      : [];
  if (runtimeToolSchemaProjection?.source !== "runtime.tools.describe") {
    throw new Error(
      `runtime tool schema projection should be sourced from runtime.tools.describe: ${String(runtimeToolSchemaProjection?.source ?? "missing")}`,
    );
  }
  if (runtimeToolSchemaProjectionDrift?.checked !== true) {
    throw new Error(
      `runtime tool schema projection drift guard did not run: ${String(runtimeToolSchemaProjectionDrift?.reason ?? "missing")}`,
    );
  }
  if (runtimeToolSchemaProjectionDrift?.active === true) {
    throw new Error(
      `runtime tool schema projection drift detected: ${String(runtimeToolSchemaProjectionDrift.reason ?? "unknown")}`,
    );
  }
  assertRuntimeToolSchemaArgVisibility(runtimeToolSchemaProjection);
  const runtimeToolSurfaceDecisionScores = isObject(runtimeToolSurfaceDecision?.scores)
    ? runtimeToolSurfaceDecision.scores
    : null;
  const runtimeToolSurfaceDecisionSuppressed = Array.isArray(runtimeToolSurfaceDecision?.suppressed)
    ? runtimeToolSurfaceDecision.suppressed
    : [];
  const runtimeToolMetrics = isObject(runtimeTools?.metrics)
    ? runtimeTools.metrics
    : null;
  const runtimeToolRecoveryFeedback = isObject(runtimeTools?.recovery_feedback)
    ? runtimeTools.recovery_feedback
    : null;
  const runtimeToolRecoveryTimeline = Array.isArray(runtimeTools?.recovery_timeline)
    ? runtimeTools.recovery_timeline
    : [];
  const runtimeToolRecoveryTimelineLatest = isObject(runtimeToolRecoveryTimeline[0])
    ? runtimeToolRecoveryTimeline[0]
    : null;
  const runtimeToolRecoveryHealth = isObject(runtimeTools?.recovery_health)
    ? runtimeTools.recovery_health
    : null;
  const runtimeToolRecoveryPolicy = isObject(runtimeTools?.recovery_policy)
    ? runtimeTools.recovery_policy
    : null;
  assertRuntimeToolRecoveryPolicyStatusSurface({
    recoveryPolicy: runtimeToolRecoveryPolicy,
  });
  const runtimeToolRecoveryReadiness = isObject(runtimeTools?.recovery_readiness)
    ? runtimeTools.recovery_readiness
    : null;
  const runtimeToolRecoveryGate = isObject(runtimeTools?.recovery_gate)
    ? runtimeTools.recovery_gate
    : null;
  const runtimeToolSurfaceAdaptation = isObject(runtimeTools?.surface_adaptation)
    ? runtimeTools.surface_adaptation
    : null;
  const runtimeToolSurfaceAdaptationOutcome = isObject(runtimeTools?.surface_adaptation_outcome)
    ? runtimeTools.surface_adaptation_outcome
    : null;
  const runtimeToolSurfaceAdaptationGuard = isObject(runtimeToolSurfaceAdaptationOutcome?.guard)
    ? runtimeToolSurfaceAdaptationOutcome.guard
    : null;
  const runtimeHealthCacheStats = isObject(runtimeHealth?.cache_stats)
    ? runtimeHealth.cache_stats
    : null;
  const runtimePromptCache = isObject(runtimeHealthCacheStats?.prompt_cache)
    ? runtimeHealthCacheStats.prompt_cache
    : null;
  const runtimePromptCacheWindow = isObject(runtimePromptCache?.window)
    ? runtimePromptCache.window
    : null;

  return {
    status_has_runtime_tools: Boolean(runtimeTools),
    status_has_runtime_tools_quality: Boolean(runtimeToolsQuality),
    status_runtime_tool_quality_status: runtimeToolsQuality?.status ?? null,
    status_runtime_tool_quality_schema_version: runtimeToolsQuality?.quality_schema_version ?? null,
    status_runtime_tool_quality_passed_type: typeof runtimeToolsQuality?.passed,
    status_runtime_tool_quality_runtime_binary_exists_type: typeof runtimeToolsQuality?.runtime_binary_exists,
    status_runtime_tool_quality_runtime_health_ok_type: typeof runtimeToolsQuality?.runtime_health_ok,
    status_runtime_tool_quality_runtime_describe_source: runtimeToolsQuality?.runtime_describe_source ?? null,
    status_runtime_tool_quality_schema_budget_status: runtimeToolsQuality?.schema_budget_status ?? null,
    status_runtime_tool_quality_schema_budget_violations_type:
      typeof runtimeToolsQuality?.schema_budget_violations,
    status_runtime_tool_quality_schema_drift_active_type:
      typeof runtimeToolsQuality?.schema_projection_drift_active,
    status_runtime_tool_quality_recovery_gate_status: runtimeToolsQuality?.recovery_gate_status ?? null,
    status_runtime_tool_quality_latest_stage_type:
      typeof runtimeToolsQuality?.latest_recovery_stage,
    status_runtime_tool_quality_action_required_type:
      typeof runtimeToolsQuality?.action_required,
    status_runtime_tool_quality_actionable_next_step_type:
      typeof runtimeToolsQuality?.actionable_next_step,
    status_runtime_tool_quality_action_family: runtimeToolsQuality?.action_family ?? null,
    status_runtime_tool_quality_action_reason_type:
      typeof runtimeToolsQuality?.action_reason,
    status_runtime_tool_quality_failure_reasons_is_array:
      Array.isArray(runtimeToolsQuality?.failure_reasons),
    status_runtime_tool_quality_warning_reasons_is_array:
      Array.isArray(runtimeToolsQuality?.warning_reasons),
    status_runtime_tool_surface_profile: runtimeTools?.tool_surface_profile ?? null,
    status_runtime_tool_surface_source_type: typeof runtimeTools?.tool_surface_source,
    status_runtime_tool_policy_version: runtimeTools?.tool_policy_version ?? null,
    status_runtime_tool_model_visible_tools_is_array: Array.isArray(runtimeTools?.model_visible_tools),
    status_runtime_tool_model_visible_tool_count: runtimeToolModelVisibleTools.length,
    status_runtime_tool_dispatch_enabled_tools_is_array: Array.isArray(runtimeTools?.dispatch_enabled_tools),
    status_runtime_tool_dispatch_enabled_tool_count: runtimeToolDispatchEnabledTools.length,
    status_runtime_tool_model_visible_has_prompt_enhancer:
      runtimeToolModelVisibleTools.includes("prompt_enhancer"),
    status_runtime_tool_model_visible_has_web_scan:
      runtimeToolModelVisibleTools.includes("web_scan"),
    status_runtime_tool_model_visible_has_glob:
      runtimeToolModelVisibleTools.includes("glob"),
    status_runtime_tool_schema_fingerprint_type: typeof runtimeTools?.schema_fingerprint,
    status_runtime_tool_schema_profiles_fingerprint_type: typeof runtimeTools?.schema_profiles_fingerprint,
    status_runtime_tool_schema_estimated_tokens_type: typeof runtimeTools?.schema_estimated_tokens,
    status_runtime_tool_advanced_schema_type: typeof runtimeTools?.advanced_tool_schema,
    status_runtime_tool_schema_projection_present: Boolean(runtimeToolSchemaProjection),
    status_runtime_tool_schema_projection_source_type: typeof runtimeToolSchemaProjection?.source,
    status_runtime_tool_schema_projection_profile: runtimeToolSchemaProjection?.profile ?? null,
    status_runtime_tool_schema_projection_mode_type: typeof runtimeToolSchemaProjection?.projection_mode,
    status_runtime_tool_schema_projection_visible_count_type: typeof runtimeToolSchemaProjection?.visible_tool_count,
    status_runtime_tool_schema_projection_dispatch_count_type: typeof runtimeToolSchemaProjection?.dispatch_enabled_tool_count,
    status_runtime_tool_schema_projection_property_count_type: typeof runtimeToolSchemaProjection?.schema_property_count,
    status_runtime_tool_schema_projection_full_property_count_type: typeof runtimeToolSchemaProjection?.full_schema_property_count,
    status_runtime_tool_schema_projection_suppressed_property_count_type:
      typeof runtimeToolSchemaProjection?.suppressed_schema_property_count,
    status_runtime_tool_schema_projection_fingerprint_type: typeof runtimeToolSchemaProjection?.schema_fingerprint,
    status_runtime_tool_schema_projection_per_tool_type:
      typeof runtimeToolSchemaProjection?.per_tool_property_count,
    status_runtime_tool_schema_projection_visible_args_type:
      typeof runtimeToolSchemaProjection?.per_tool_visible_args,
    status_runtime_tool_schema_projection_suppressed_args_type:
      typeof runtimeToolSchemaProjection?.per_tool_suppressed_args,
    status_runtime_tool_schema_projection_visible_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjection?.per_tool_visible_args),
    status_runtime_tool_schema_projection_suppressed_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjection?.per_tool_suppressed_args),
    status_runtime_tool_schema_projection_drift_present: Boolean(runtimeToolSchemaProjectionDrift),
    status_runtime_tool_schema_projection_drift_checked_type: typeof runtimeToolSchemaProjectionDrift?.checked,
    status_runtime_tool_schema_projection_drift_active_type: typeof runtimeToolSchemaProjectionDrift?.active,
    status_runtime_tool_schema_projection_drift_reason_type: typeof runtimeToolSchemaProjectionDrift?.reason,
    status_runtime_tool_schema_projection_drift_runtime_visible_args_type:
      typeof runtimeToolSchemaProjectionDrift?.runtime_per_tool_visible_args,
    status_runtime_tool_schema_projection_drift_gateway_visible_args_type:
      typeof runtimeToolSchemaProjectionDrift?.gateway_per_tool_visible_args,
    status_runtime_tool_schema_projection_drift_runtime_suppressed_args_type:
      typeof runtimeToolSchemaProjectionDrift?.runtime_per_tool_suppressed_args,
    status_runtime_tool_schema_projection_drift_gateway_suppressed_args_type:
      typeof runtimeToolSchemaProjectionDrift?.gateway_per_tool_suppressed_args,
    status_runtime_tool_schema_projection_drift_runtime_visible_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.runtime_per_tool_visible_args),
    status_runtime_tool_schema_projection_drift_gateway_visible_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.gateway_per_tool_visible_args),
    status_runtime_tool_schema_projection_drift_runtime_suppressed_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.runtime_per_tool_suppressed_args),
    status_runtime_tool_schema_projection_drift_gateway_suppressed_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.gateway_per_tool_suppressed_args),
    status_runtime_tool_schema_projection_drift_arg_mismatch_details_is_array:
      Array.isArray(runtimeToolSchemaProjectionDrift?.arg_mismatch_details),
    status_runtime_tool_schema_projection_drift_arg_mismatch_details_count:
      runtimeToolSchemaProjectionDriftArgMismatchDetails.length,
    status_runtime_tool_surface_decision_present: Boolean(runtimeToolSurfaceDecision),
    status_runtime_tool_surface_decision_profile: runtimeToolSurfaceDecision?.profile ?? null,
    status_runtime_tool_surface_decision_reason_type: typeof runtimeToolSurfaceDecision?.reason,
    status_runtime_tool_surface_decision_scores_type: typeof runtimeToolSurfaceDecision?.scores,
    status_runtime_tool_surface_decision_score_coding_type: typeof runtimeToolSurfaceDecisionScores?.coding,
    status_runtime_tool_surface_decision_suppressed_is_array: Array.isArray(runtimeToolSurfaceDecision?.suppressed),
    status_runtime_tool_surface_decision_suppressed_count: runtimeToolSurfaceDecisionSuppressed.length,
    status_runtime_tool_metrics_present: Boolean(runtimeToolMetrics),
    status_runtime_tool_metrics_calls_total_type: typeof runtimeToolMetrics?.callsTotal,
    status_runtime_tool_metrics_failures_type: typeof runtimeToolMetrics?.failuresByErrorClass,
    status_runtime_tool_metrics_recovery_stages_type: typeof runtimeToolMetrics?.recoveryStages,
    status_runtime_tool_recovery_feedback_present: Boolean(runtimeToolRecoveryFeedback),
    status_runtime_tool_recovery_feedback_active_type: typeof runtimeToolRecoveryFeedback?.active,
    status_runtime_tool_recovery_feedback_severity_type: typeof runtimeToolRecoveryFeedback?.severity,
    status_runtime_tool_recovery_feedback_reason_type: typeof runtimeToolRecoveryFeedback?.reason,
    status_runtime_tool_recovery_feedback_recoverable_type: typeof runtimeToolRecoveryFeedback?.recoverable,
    status_runtime_tool_recovery_feedback_requires_user_intervention_type:
      typeof runtimeToolRecoveryFeedback?.requires_user_intervention,
    status_runtime_tool_recovery_feedback_consumed_type: typeof runtimeToolRecoveryFeedback?.consumed,
    status_runtime_tool_recovery_feedback_consumed_reason_type: typeof runtimeToolRecoveryFeedback?.consumed_reason,
    status_runtime_tool_recovery_feedback_observed_at_type: typeof runtimeToolRecoveryFeedback?.observed_at,
    status_runtime_tool_recovery_feedback_same_tool_error_count_type:
      typeof runtimeToolRecoveryFeedback?.same_tool_error_count,
    status_runtime_tool_recovery_feedback_escalated_type:
      typeof runtimeToolRecoveryFeedback?.escalated,
    status_runtime_tool_recovery_feedback_escalation_reason_type:
      typeof runtimeToolRecoveryFeedback?.escalation_reason,
    status_runtime_tool_recovery_feedback_escalation_policy_version_type:
      typeof runtimeToolRecoveryFeedback?.escalation_policy_version,
    status_runtime_tool_recovery_feedback_base_recovery_stage_type:
      typeof runtimeToolRecoveryFeedback?.base_recovery_stage,
    status_runtime_tool_recovery_feedback_base_recommended_next_action_type:
      typeof runtimeToolRecoveryFeedback?.base_recommended_next_action,
    status_runtime_tool_recovery_feedback_runtime_environment_recovery_type:
      typeof runtimeToolRecoveryFeedback?.runtime_environment_recovery,
    status_runtime_tool_recovery_feedback_browser_environment_recovery_type:
      typeof runtimeToolRecoveryFeedback?.browser_environment_recovery,
    status_runtime_tool_recovery_feedback_mcp_environment_recovery_type:
      typeof runtimeToolRecoveryFeedback?.mcp_environment_recovery,
    status_runtime_tool_recovery_timeline_is_array: Array.isArray(runtimeTools?.recovery_timeline),
    status_runtime_tool_recovery_timeline_count: runtimeToolRecoveryTimeline.length,
    status_runtime_tool_recovery_timeline_latest_recovery_key_type:
      typeof runtimeToolRecoveryTimelineLatest?.recovery_key,
    status_runtime_tool_recovery_timeline_latest_active_type: typeof runtimeToolRecoveryTimelineLatest?.active,
    status_runtime_tool_recovery_timeline_latest_consumed_type: typeof runtimeToolRecoveryTimelineLatest?.consumed,
    status_runtime_tool_recovery_timeline_latest_stage_type: typeof runtimeToolRecoveryTimelineLatest?.stage,
    status_runtime_tool_recovery_timeline_latest_same_tool_error_count_type:
      typeof runtimeToolRecoveryTimelineLatest?.same_tool_error_count,
    status_runtime_tool_recovery_timeline_latest_escalated_type:
      typeof runtimeToolRecoveryTimelineLatest?.escalated,
    status_runtime_tool_recovery_timeline_latest_escalation_reason_type:
      typeof runtimeToolRecoveryTimelineLatest?.escalation_reason,
    status_runtime_tool_recovery_timeline_latest_escalation_policy_version_type:
      typeof runtimeToolRecoveryTimelineLatest?.escalation_policy_version,
    status_runtime_tool_recovery_timeline_latest_base_recovery_stage_type:
      typeof runtimeToolRecoveryTimelineLatest?.base_recovery_stage,
    status_runtime_tool_recovery_timeline_latest_base_recommended_next_action_type:
      typeof runtimeToolRecoveryTimelineLatest?.base_recommended_next_action,
    status_runtime_tool_recovery_health_present: Boolean(runtimeToolRecoveryHealth),
    status_runtime_tool_recovery_health_timeline_count_type:
      typeof runtimeToolRecoveryHealth?.timeline_entry_count,
    status_runtime_tool_recovery_health_score_type:
      typeof runtimeToolRecoveryHealth?.score,
    status_runtime_tool_recovery_health_level_type:
      typeof runtimeToolRecoveryHealth?.level,
    status_runtime_tool_recovery_health_reason_type:
      typeof runtimeToolRecoveryHealth?.reason,
    status_runtime_tool_recovery_health_recommended_action_type:
      typeof runtimeToolRecoveryHealth?.recommended_next_action,
    status_runtime_tool_recovery_health_attention_source_type:
      typeof runtimeToolRecoveryHealth?.attention_source,
    status_runtime_tool_recovery_health_attention_key_type:
      typeof runtimeToolRecoveryHealth?.attention_recovery_key,
    status_runtime_tool_recovery_health_attention_tool_name_type:
      typeof runtimeToolRecoveryHealth?.attention_tool_name,
    status_runtime_tool_recovery_health_attention_requires_user_intervention_type:
      typeof runtimeToolRecoveryHealth?.attention_requires_user_intervention,
    status_runtime_tool_recovery_health_attention_age_ms_type:
      typeof runtimeToolRecoveryHealth?.attention_age_ms,
    status_runtime_tool_recovery_health_active_count_type:
      typeof runtimeToolRecoveryHealth?.active_recovery_count,
    status_runtime_tool_recovery_health_unconsumed_count_type:
      typeof runtimeToolRecoveryHealth?.unconsumed_count,
    status_runtime_tool_recovery_health_latest_key_type:
      typeof runtimeToolRecoveryHealth?.latest_recovery_key,
    status_runtime_tool_recovery_health_has_stuck_type:
      typeof runtimeToolRecoveryHealth?.has_stuck_nonrecoverable,
    status_runtime_tool_recovery_health_attention_runtime_environment_recovery_type:
      typeof runtimeToolRecoveryHealth?.attention_runtime_environment_recovery,
    status_runtime_tool_recovery_health_attention_browser_environment_recovery_type:
      typeof runtimeToolRecoveryHealth?.attention_browser_environment_recovery,
    status_runtime_tool_recovery_health_attention_mcp_environment_recovery_type:
      typeof runtimeToolRecoveryHealth?.attention_mcp_environment_recovery,
    status_runtime_tool_recovery_policy_present: Boolean(runtimeToolRecoveryPolicy),
    status_runtime_tool_recovery_policy_version_type:
      typeof runtimeToolRecoveryPolicy?.version,
    status_runtime_tool_recovery_policy_prompt_max_age_ms_type:
      typeof runtimeToolRecoveryPolicy?.prompt_max_age_ms,
    status_runtime_tool_recovery_policy_timeline_max_entries_type:
      typeof runtimeToolRecoveryPolicy?.timeline_max_entries,
    status_runtime_tool_recovery_policy_adaptation_history_max_entries_type:
      typeof runtimeToolRecoveryPolicy?.adaptation_history_max_entries,
    status_runtime_tool_recovery_policy_recovery_consumption_history_max_entries_type:
      typeof runtimeToolRecoveryPolicy?.recovery_consumption_history_max_entries,
    status_runtime_tool_recovery_policy_guard_type:
      typeof runtimeToolRecoveryPolicy?.guard,
    status_runtime_tool_recovery_policy_guard_repeat_threshold:
      runtimeToolRecoveryPolicy?.guard?.repeated_profile_failure_threshold ?? null,
    status_runtime_tool_recovery_policy_health_type:
      typeof runtimeToolRecoveryPolicy?.health,
    status_runtime_tool_recovery_policy_escalation_type:
      typeof runtimeToolRecoveryPolicy?.escalation,
    status_runtime_tool_recovery_policy_escalation_strategy_switch_threshold:
      runtimeToolRecoveryPolicy?.escalation?.same_tool_error_strategy_switch_threshold ?? null,
    status_runtime_tool_recovery_policy_escalation_ask_user_threshold:
      runtimeToolRecoveryPolicy?.escalation?.same_tool_error_ask_user_threshold ?? null,
    status_runtime_tool_recovery_policy_escalation_environment_ask_user_threshold:
      runtimeToolRecoveryPolicy?.escalation?.environment_ask_user_threshold ?? null,
    status_runtime_tool_recovery_policy_escalation_browser_environment_ask_user_threshold:
      runtimeToolRecoveryPolicy?.escalation?.browser_environment_ask_user_threshold ?? null,
    status_runtime_tool_recovery_policy_health_watch_threshold:
      runtimeToolRecoveryPolicy?.health?.watch_score_threshold ?? null,
    status_runtime_tool_recovery_policy_health_risk_threshold:
      runtimeToolRecoveryPolicy?.health?.risk_score_threshold ?? null,
    status_runtime_tool_recovery_readiness_present: Boolean(runtimeToolRecoveryReadiness),
    status_runtime_tool_recovery_readiness_status_type:
      typeof runtimeToolRecoveryReadiness?.status,
    status_runtime_tool_recovery_readiness_ready_type:
      typeof runtimeToolRecoveryReadiness?.ready,
    status_runtime_tool_recovery_readiness_auto_allowed_type:
      typeof runtimeToolRecoveryReadiness?.automatic_recovery_allowed,
    status_runtime_tool_recovery_readiness_operator_action_type:
      typeof runtimeToolRecoveryReadiness?.operator_action_required,
    status_runtime_tool_recovery_readiness_reason_type:
      typeof runtimeToolRecoveryReadiness?.reason,
    status_runtime_tool_recovery_readiness_policy_version_type:
      typeof runtimeToolRecoveryReadiness?.policy_version,
    status_runtime_tool_recovery_readiness_attention_stage_type:
      typeof runtimeToolRecoveryReadiness?.attention_stage,
    status_runtime_tool_recovery_readiness_attention_runtime_environment_recovery_type:
      typeof runtimeToolRecoveryReadiness?.attention_runtime_environment_recovery,
    status_runtime_tool_recovery_readiness_attention_browser_environment_recovery_type:
      typeof runtimeToolRecoveryReadiness?.attention_browser_environment_recovery,
    status_runtime_tool_recovery_readiness_attention_mcp_environment_recovery_type:
      typeof runtimeToolRecoveryReadiness?.attention_mcp_environment_recovery,
    status_runtime_tool_recovery_gate_present: Boolean(runtimeToolRecoveryGate),
    status_runtime_tool_recovery_gate_status_type:
      typeof runtimeToolRecoveryGate?.status,
    status_runtime_tool_recovery_gate_passed_type:
      typeof runtimeToolRecoveryGate?.passed,
    status_runtime_tool_recovery_gate_blocking_type:
      typeof runtimeToolRecoveryGate?.blocking,
    status_runtime_tool_recovery_gate_severity_type:
      typeof runtimeToolRecoveryGate?.severity,
    status_runtime_tool_recovery_gate_reason_type:
      typeof runtimeToolRecoveryGate?.reason,
    status_runtime_tool_recovery_gate_blocker_kind_type:
      typeof runtimeToolRecoveryGate?.blocker_kind,
    status_runtime_tool_recovery_gate_blocker_code_type:
      typeof runtimeToolRecoveryGate?.blocker_code,
    status_runtime_tool_recovery_gate_blocker_action_type:
      typeof runtimeToolRecoveryGate?.blocker_action,
    status_runtime_tool_recovery_gate_readiness_status_type:
      typeof runtimeToolRecoveryGate?.readiness_status,
    status_runtime_tool_recovery_gate_auto_allowed_type:
      typeof runtimeToolRecoveryGate?.automatic_recovery_allowed,
    status_runtime_tool_recovery_gate_operator_action_type:
      typeof runtimeToolRecoveryGate?.operator_action_required,
    status_runtime_tool_recovery_gate_attention_stage_type:
      typeof runtimeToolRecoveryGate?.attention_stage,
    status_runtime_tool_recovery_gate_attention_runtime_environment_recovery_type:
      typeof runtimeToolRecoveryGate?.attention_runtime_environment_recovery,
    status_runtime_tool_recovery_gate_attention_browser_environment_recovery_type:
      typeof runtimeToolRecoveryGate?.attention_browser_environment_recovery,
    status_runtime_tool_recovery_gate_attention_mcp_environment_recovery_type:
      typeof runtimeToolRecoveryGate?.attention_mcp_environment_recovery,
    status_runtime_tool_surface_adaptation_present: Boolean(runtimeToolSurfaceAdaptation),
    status_runtime_tool_surface_adaptation_active_type: typeof runtimeToolSurfaceAdaptation?.active,
    status_runtime_tool_surface_adaptation_reason_type: typeof runtimeToolSurfaceAdaptation?.reason,
    status_runtime_tool_surface_adaptation_from_profile_type: typeof runtimeToolSurfaceAdaptation?.from_profile,
    status_runtime_tool_surface_adaptation_applied_profile_type: typeof runtimeToolSurfaceAdaptation?.applied_profile,
    status_runtime_tool_surface_adaptation_auto_blocked_type:
      typeof runtimeToolSurfaceAdaptation?.auto_adaptation_blocked,
    status_runtime_tool_surface_adaptation_recoverable_type: typeof runtimeToolSurfaceAdaptation?.recovery_recoverable,
    status_runtime_tool_surface_adaptation_observed_at_type: typeof runtimeToolSurfaceAdaptation?.recovery_observed_at,
    status_runtime_tool_surface_adaptation_outcome_present: Boolean(runtimeToolSurfaceAdaptationOutcome),
    status_runtime_tool_surface_adaptation_outcome_path_type: typeof runtimeToolSurfaceAdaptationOutcome?.path,
    status_runtime_tool_surface_adaptation_outcome_recent_count_type: typeof runtimeToolSurfaceAdaptationOutcome?.recent_adaptation_count,
    status_runtime_tool_surface_adaptation_outcome_profile_outcomes_type: typeof runtimeToolSurfaceAdaptationOutcome?.profile_outcomes,
    status_runtime_tool_surface_adaptation_outcome_consumption_count_type: typeof runtimeToolSurfaceAdaptationOutcome?.recent_recovery_consumption_count,
    status_runtime_tool_surface_adaptation_outcome_latest_consumption_type: typeof runtimeToolSurfaceAdaptationOutcome?.latest_recovery_consumption,
    status_runtime_tool_surface_adaptation_guard_present: Boolean(runtimeToolSurfaceAdaptationGuard),
    status_runtime_tool_surface_adaptation_guard_active_type: typeof runtimeToolSurfaceAdaptationGuard?.active,
    status_runtime_tool_surface_adaptation_guard_reason_type: typeof runtimeToolSurfaceAdaptationGuard?.reason,
    status_has_runtime_health_cache_stats: Boolean(runtimeHealthCacheStats),
    status_has_top_level_cache_stats: Boolean(topLevelCacheStats),
    status_cache_stats_location: cacheStatsLocation,
    status_prompt_cache_hint_attempted_type: typeof runtimePromptCache?.hint_attempted_total,
    status_prompt_cache_window_hint_attempted_type: typeof runtimePromptCacheWindow?.hint_attempted_total,
  };
}
