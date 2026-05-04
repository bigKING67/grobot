import assert from "node:assert/strict";

export function assertContextEngineGuardStatusSurface(statusPayload) {
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_mode_allowlist_type, "array");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_promote_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_severe_promote_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_release_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_hold_turns_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_max_floor_stage_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_severe_overall_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_severe_low_quality_rate_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_has_prompt_quality_guard_state, true);
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_floor_stage_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_degraded_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_severe_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_healthy_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_hold_turns_remaining_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_last_reason_type, "string");
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_guard_state_updated_at_type)),
    true,
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_utilization_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_semantic_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_auto_limit_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_joint_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_utilization_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_semantic_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_auto_limit_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_momentum_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_required_transitions_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_combined_evidence_score_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_high_evidence_turns_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_high_evidence_harden_turns_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_drift_recent_auto_action_levels_type,
    "array",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_persistence_domain_type,
    "string",
  );
  assert.equal(statusPayload.status_context_engine_has_prompt_quality_guard_runtime_assessment, true);
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_enabled_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_phase_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_transition_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_degraded_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_severe_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_reason_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_triggered_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_floor_stage_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_proposed_floor_stage_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_promote_remaining_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_severe_promote_remaining_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_release_remaining_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_hold_turns_remaining_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_observed_overall_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_observed_low_quality_rate_type),
    ),
    true,
  );
}
