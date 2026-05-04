import assert from "node:assert/strict";
import { assertContextEngineAdaptivePolicyStatusSurface } from "./context-engine-adaptive-policy-assertions.mjs";
import { assertContextEngineGuardStatusSurface } from "./context-engine-guard-assertions.mjs";

export function assertContextEngineStatusSurface(statusPayload) {
  assert.equal(statusPayload.status_has_context_engine, true);
  assert.equal(statusPayload.status_context_engine_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_profile_type, "string");
  assert.equal(statusPayload.status_context_engine_auto_limit_type, "number");
  assert.equal(statusPayload.status_context_engine_target_limit_type, "number");
  assert.equal(statusPayload.status_context_engine_effective_window_type, "number");
  assert.equal(statusPayload.status_context_engine_threshold_hard_type, "number");
  assert.equal(statusPayload.status_context_engine_recovery_ptl_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_low_quality_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_degrade_overall_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_degrade_low_quality_rate_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_degrade_min_entries_type, "number");
  assertContextEngineGuardStatusSurface(statusPayload);
  assertContextEngineAdaptivePolicyStatusSurface(statusPayload);
  assert.equal(statusPayload.status_context_engine_lineage_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_lineage_persistence_domain_type, "string");
  assert.equal(statusPayload.status_context_engine_lineage_persistence_domain_value, "memory");
  assert.equal(statusPayload.status_context_engine_workspace_signals_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_has_prompt_quality_window, true);
  assert.equal(statusPayload.status_context_engine_has_graph_quality_signals, true);
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_state_type, "string");
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_reason_type, "string");
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_recommended_action_type, "string");
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_degraded_sources_type, "array");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_path_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_configured_size_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_entries_type, "number");
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_persistence_domain_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_persistence_domain_value,
    "context",
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_from_ts_type)),
    true,
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_to_ts_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_average_overall_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_latest_overall_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_low_quality_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_low_quality_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_normal_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_proactive_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_forced_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_minimal_type, "number");
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_signal_avg_recent_trim_rows_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_signal_avg_snapshot_semantic_compress_sections_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_signal_avg_pre_send_overflow_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_signal_avg_pre_send_pressure_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_compression_snapshot_semantic_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_compression_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_token_budget_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_quality_first_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_strategy_outcomes, true);
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_followup_delta_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_followup_delta_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_recovery_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_improved_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_transition_count_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_transition_count_type,
      ),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_strategy_trends, true);
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_window_size_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_avg_overflow_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_avg_pressure_type),
    ),
    true,
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_strategy_trends_medium_window_size_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_medium_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_delta_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_delta_avg_overflow_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_delta_avg_pressure_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_pressure_trends, true);
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_window_size_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_entries_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_window_size_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_entries_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_delta_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_delta_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_delta_avg_utilization_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_degradation, true);
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_degraded_type, "boolean");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_reason_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_threshold_overall_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_threshold_low_quality_rate_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_min_entries_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_observed_entries_type, "number");
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_degradation_observed_overall_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_degradation_observed_low_quality_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_route_reason_type, "string");
}
