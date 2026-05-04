import assert from "node:assert/strict";

export function assertRuntimeToolStatusSurface(statusPayload) {
  assert.equal(statusPayload.exit_code, 0);
  assert.equal(statusPayload.status_json_parse_ok, true);
  assert.equal(statusPayload.status_has_route_decision, true);
  assert.equal(statusPayload.status_has_route_observed, true);
  assert.equal(statusPayload.status_has_route_observed_provider_runtime_states, true);
  assert.equal(statusPayload.status_has_route_ordered_providers, true);
  assert.equal(statusPayload.status_has_route_failover, true);
  assert.equal(statusPayload.status_has_runtime_tools, true);
  assert.equal(statusPayload.status_has_runtime_tools_quality, true);
  assert.equal(statusPayload.status_runtime_tool_quality_status, "ok");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_version, 1);
  assert.equal(statusPayload.status_runtime_tool_quality_passed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_runtime_binary_exists_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_runtime_health_ok_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_runtime_describe_source, "runtime.tools.describe");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_budget_status, "passed");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_budget_violations_type, "number");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_drift_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_recovery_gate_status, "pass");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_latest_stage_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_action_required_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_actionable_next_step_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_quality_action_family, "none");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_action_reason_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_quality_failure_reasons_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_quality_warning_reasons_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_surface_profile, "coding");
  assert.equal(statusPayload.status_runtime_tool_surface_source_type, "string");
  assert.equal(statusPayload.status_runtime_tool_policy_version, "v1");
  assert.equal(statusPayload.status_runtime_tool_model_visible_tools_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_model_visible_tool_count, 7);
  assert.equal(statusPayload.status_runtime_tool_dispatch_enabled_tools_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_dispatch_enabled_tool_count, 7);
  assert.equal(statusPayload.status_runtime_tool_model_visible_has_prompt_enhancer, false);
  assert.equal(statusPayload.status_runtime_tool_model_visible_has_web_scan, false);
  assert.equal(statusPayload.status_runtime_tool_model_visible_has_glob, true);
  assert.equal(statusPayload.status_runtime_tool_schema_fingerprint_type, "string");
  assert.equal(statusPayload.status_runtime_tool_schema_estimated_tokens_type, "number");
  assert.equal(statusPayload.status_runtime_tool_advanced_schema_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_present, true);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_source_type, "string");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_per_tool_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_visible_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_suppressed_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_visible_args_sum, 27);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_suppressed_args_sum, 3);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_present, true);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_checked_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_visible_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_visible_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_suppressed_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_suppressed_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_visible_args_sum, 27);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_visible_args_sum, 27);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_suppressed_args_sum, 3);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_suppressed_args_sum, 3);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_arg_mismatch_details_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_arg_mismatch_details_count, 0);
  assert.equal(statusPayload.status_runtime_tool_surface_decision_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_decision_profile, "coding");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_scores_type, "object");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_score_coding_type, "number");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_suppressed_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_surface_decision_suppressed_count, 0);
  assert.equal(statusPayload.status_runtime_tool_metrics_present, true);
  assert.equal(statusPayload.status_runtime_tool_metrics_calls_total_type, "number");
  assert.equal(statusPayload.status_runtime_tool_metrics_failures_type, "object");
  assert.equal(statusPayload.status_runtime_tool_metrics_recovery_stages_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_severity_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_reason_type, "string");
  assert.equal(
    ["boolean", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_recoverable_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_requires_user_intervention_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_consumed_type, "boolean");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_consumed_reason_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_observed_at_type)),
    true,
  );
  assert.equal(
    ["number", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_same_tool_error_count_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_escalated_type, "boolean");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_escalation_reason_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_escalation_policy_version_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_base_recovery_stage_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_base_recommended_next_action_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_timeline_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_timeline_count >= 0, true);
  assert.equal(
    ["string", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_recovery_key_type)),
    true,
  );
  assert.equal(
    ["boolean", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_active_type)),
    true,
  );
  assert.equal(
    ["boolean", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_consumed_type)),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_stage_type)),
    true,
  );
  assert.equal(
    ["number", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_same_tool_error_count_type),
    ),
    true,
  );
  assert.equal(
    ["boolean", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_escalated_type)),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_escalation_reason_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_escalation_policy_version_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_base_recovery_stage_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_base_recommended_next_action_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_health_timeline_count_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_score_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_level_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_reason_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_recommended_action_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_attention_source_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_attention_key_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_attention_tool_name_type)),
    true,
  );
  assert.equal(
    statusPayload.status_runtime_tool_recovery_health_attention_requires_user_intervention_type,
    "boolean",
  );
  assert.equal(
    ["number", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_attention_age_ms_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_active_count_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_unconsumed_count_type, "number");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_latest_key_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_has_stuck_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_version_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_prompt_max_age_ms_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_timeline_max_entries_type, "number");
  assert.equal(
    statusPayload.status_runtime_tool_recovery_policy_adaptation_history_max_entries_type,
    "number",
  );
  assert.equal(
    statusPayload.status_runtime_tool_recovery_policy_recovery_consumption_history_max_entries_type,
    "number",
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_guard_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_guard_repeat_threshold, 2);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_health_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_strategy_switch_threshold, 2);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_ask_user_threshold, 3);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_environment_ask_user_threshold, 2);
  assert.equal(
    statusPayload.status_runtime_tool_recovery_policy_escalation_browser_environment_ask_user_threshold,
    2,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_health_watch_threshold, 85);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_health_risk_threshold, 60);
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_health_attention_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_health_attention_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_health_attention_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_status_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_ready_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_auto_allowed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_operator_action_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_policy_version_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_readiness_attention_stage_type)),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_readiness_attention_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_readiness_attention_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_readiness_attention_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_status_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_passed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_blocking_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_severity_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_blocker_kind_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_gate_blocker_code_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_gate_blocker_action_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_readiness_status_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_auto_allowed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_operator_action_type, "boolean");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_gate_attention_stage_type)),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_gate_attention_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_gate_attention_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_gate_attention_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_from_profile_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_applied_profile_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_auto_blocked_type, "boolean");
  assert.equal(
    ["boolean", "object"].includes(String(statusPayload.status_runtime_tool_surface_adaptation_recoverable_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_surface_adaptation_observed_at_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_path_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_recent_count_type, "number");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_profile_outcomes_type, "object");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_consumption_count_type, "number");
  assert.equal(
    ["object", "undefined"].includes(String(statusPayload.status_runtime_tool_surface_adaptation_outcome_latest_consumption_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_guard_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_guard_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_guard_reason_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_route_observed_source_type)),
    true,
  );
}
