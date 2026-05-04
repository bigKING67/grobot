import assert from "node:assert/strict";

export function assertContextGraphStatusSurface(statusPayload) {
  assert.equal(statusPayload.status_has_runtime_health_cache_stats, true);
  assert.equal(statusPayload.status_has_top_level_cache_stats, false);
  assert.equal(statusPayload.status_cache_stats_location, "runtime_health.cache_stats");
  assert.equal(statusPayload.status_prompt_cache_hint_attempted_type, "number");
  assert.equal(statusPayload.status_prompt_cache_window_hint_attempted_type, "number");
  assert.equal(statusPayload.status_has_context_graph_cache_stats, true);
  assert.equal(statusPayload.status_symbol_query_cache_hit_type, "number");
  assert.equal(statusPayload.status_symbol_declaration_cache_write_type, "number");
  assert.equal(statusPayload.status_dependency_query_cache_miss_type, "number");
  assert.equal(statusPayload.status_dependency_import_cache_evict_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_present, true);
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_last_direction_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_hold_turns_remaining_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_downshift_warmup_streak_type, "number");
  assert.equal(
    ["string", "null"].includes(
      String(statusPayload.status_context_graph_cache_autotune_state_last_reason_type),
    ),
    true,
  );
  assert.equal(
    ["string", "null"].includes(
      String(statusPayload.status_context_graph_cache_autotune_state_updated_at_type),
    ),
    true,
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_cache_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_parsed_max_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_reused_min_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_removed_max_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_alpha_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_updates_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_source_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_action_scale_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_action_updates_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_action_source_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_persistence_domain_type,
    "string",
  );
  assert.equal(statusPayload.status_has_context_graph_cache_window, true);
  assert.equal(statusPayload.status_context_graph_cache_window_path_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_window_configured_size_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_entries_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_persistence_domain_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_window_persistence_domain_value, "context");
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_graph_cache_window_from_ts_type)),
    true,
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_graph_cache_window_to_ts_type)),
    true,
  );
  assert.equal(statusPayload.status_context_graph_cache_window_delta_symbol_query_hit_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_delta_symbol_declaration_write_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_delta_dependency_query_miss_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_delta_dependency_import_evict_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_query_totals_hit_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_overall_totals_hit_type, "number");
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_graph_cache_window_query_hit_rate_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_graph_cache_window_overall_hit_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_context_graph_cache_window_has_quality, true);
  assert.equal(
    statusPayload.status_context_graph_cache_window_quality_entries_with_quality_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_dependency_avg_rows_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_dependency_avg_max_chain_depth_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_dependency_multi_hop_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_bridge_coverage_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_breadth_coverage_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_avg_refs_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_max_refs_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_graph_cache_window_has_degradation, true);
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_degraded_type, "boolean");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_reason_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_threshold_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_min_entries_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_observed_entries_type, "number");
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_graph_cache_window_degradation_observed_query_hit_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_has_context_persistent_graph_index, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_persistent_graph_index_root_path_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_index_path_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_persistence_domain_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_persistence_domain_value, "memory");
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_persistent_graph_index_updated_at_type)),
    true,
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_file_count_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_symbol_count_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_edge_count_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_has_last_refresh, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_mode_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_parsed_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_reused_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_removed_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_has_window, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_window_path_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_window_configured_size_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_window_entries_type, "number");
  assert.equal(
    statusPayload.status_context_persistent_graph_index_window_persistence_domain_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_persistent_graph_index_window_persistence_domain_value,
    "memory",
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_persistent_graph_index_window_from_ts_type)),
    true,
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_persistent_graph_index_window_to_ts_type)),
    true,
  );
  assert.equal(
    statusPayload.status_context_persistent_graph_index_window_mode_counts_incremental_type,
    "number",
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_window_totals_parsed_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_window_totals_reused_files_type, "number");
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_rates_parsed_per_scanned_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_rates_reused_per_scanned_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_rates_removed_per_scanned_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_window_has_latest, true);
  assert.equal(
    ["string", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_latest_mode_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_latest_parsed_files_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_latest_file_count_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_has_degradation, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_degraded_type, "boolean");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_reason_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_threshold_parsed_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_threshold_reused_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_threshold_removed_type, "number");
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_degradation_observed_parsed_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_degradation_observed_reused_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_degradation_observed_removed_type),
    ),
    true,
  );
}
