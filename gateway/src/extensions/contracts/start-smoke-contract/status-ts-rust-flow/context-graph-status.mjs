export function collectContextGraphStatusSurface({ parsedStatus, isObject }) {
  const contextGraphCacheStats = isObject(parsedStatus?.context_graph_cache_stats)
    ? parsedStatus.context_graph_cache_stats
    : null;
  const symbolQueryGraphCacheStats = isObject(contextGraphCacheStats?.symbol_query)
    ? contextGraphCacheStats.symbol_query
    : null;
  const symbolDeclarationGraphCacheStats = isObject(contextGraphCacheStats?.symbol_declaration)
    ? contextGraphCacheStats.symbol_declaration
    : null;
  const dependencyQueryGraphCacheStats = isObject(contextGraphCacheStats?.dependency_query)
    ? contextGraphCacheStats.dependency_query
    : null;
  const dependencyImportGraphCacheStats = isObject(contextGraphCacheStats?.dependency_import)
    ? contextGraphCacheStats.dependency_import
    : null;
  const contextGraphCacheWindow = isObject(contextGraphCacheStats?.window)
    ? contextGraphCacheStats.window
    : null;
  const contextGraphCacheAutotuneState = isObject(contextGraphCacheStats?.autotune_state)
    ? contextGraphCacheStats.autotune_state
    : null;
  const contextGraphCacheWindowDeltaTotals = isObject(contextGraphCacheWindow?.delta_totals)
    ? contextGraphCacheWindow.delta_totals
    : null;
  const symbolQueryWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.symbol_query)
    ? contextGraphCacheWindowDeltaTotals.symbol_query
    : null;
  const symbolDeclarationWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.symbol_declaration)
    ? contextGraphCacheWindowDeltaTotals.symbol_declaration
    : null;
  const dependencyQueryWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.dependency_query)
    ? contextGraphCacheWindowDeltaTotals.dependency_query
    : null;
  const dependencyImportWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.dependency_import)
    ? contextGraphCacheWindowDeltaTotals.dependency_import
    : null;
  const contextGraphCacheWindowQueryTotals = isObject(contextGraphCacheWindow?.query_totals)
    ? contextGraphCacheWindow.query_totals
    : null;
  const contextGraphCacheWindowOverallTotals = isObject(contextGraphCacheWindow?.overall_totals)
    ? contextGraphCacheWindow.overall_totals
    : null;
  const contextGraphCacheWindowQuality = isObject(contextGraphCacheWindow?.quality)
    ? contextGraphCacheWindow.quality
    : null;
  const contextGraphCacheWindowQualityDependency = isObject(contextGraphCacheWindowQuality?.dependency)
    ? contextGraphCacheWindowQuality.dependency
    : null;
  const contextGraphCacheWindowQualitySymbol = isObject(contextGraphCacheWindowQuality?.symbol)
    ? contextGraphCacheWindowQuality.symbol
    : null;
  const contextGraphCacheWindowDegradation = isObject(contextGraphCacheWindow?.degradation)
    ? contextGraphCacheWindow.degradation
    : null;
  const contextPersistentGraphIndex = isObject(parsedStatus?.context_persistent_graph_index)
    ? parsedStatus.context_persistent_graph_index
    : null;
  const contextPersistentGraphIndexLastRefresh = isObject(contextPersistentGraphIndex?.last_refresh)
    ? contextPersistentGraphIndex.last_refresh
    : null;
  const contextPersistentGraphIndexWindow = isObject(contextPersistentGraphIndex?.window)
    ? contextPersistentGraphIndex.window
    : null;
  const contextPersistentGraphIndexWindowModeCounts = isObject(contextPersistentGraphIndexWindow?.mode_counts)
    ? contextPersistentGraphIndexWindow.mode_counts
    : null;
  const contextPersistentGraphIndexWindowTotals = isObject(contextPersistentGraphIndexWindow?.totals)
    ? contextPersistentGraphIndexWindow.totals
    : null;
  const contextPersistentGraphIndexWindowRates = isObject(contextPersistentGraphIndexWindow?.rates)
    ? contextPersistentGraphIndexWindow.rates
    : null;
  const contextPersistentGraphIndexWindowLatest = isObject(contextPersistentGraphIndexWindow?.latest)
    ? contextPersistentGraphIndexWindow.latest
    : null;
  const contextPersistentGraphIndexDegradation = isObject(contextPersistentGraphIndex?.degradation)
    ? contextPersistentGraphIndex.degradation
    : null;

  return {
    status_has_context_graph_cache_stats: Boolean(contextGraphCacheStats),
    status_symbol_query_cache_hit_type: typeof symbolQueryGraphCacheStats?.hit,
    status_symbol_declaration_cache_write_type: typeof symbolDeclarationGraphCacheStats?.write,
    status_dependency_query_cache_miss_type: typeof dependencyQueryGraphCacheStats?.miss,
    status_dependency_import_cache_evict_type: typeof dependencyImportGraphCacheStats?.evict,
    status_context_graph_cache_autotune_state_present: Boolean(contextGraphCacheAutotuneState),
    status_context_graph_cache_autotune_state_last_direction_type:
      typeof contextGraphCacheAutotuneState?.last_direction,
    status_context_graph_cache_autotune_state_hold_turns_remaining_type:
      typeof contextGraphCacheAutotuneState?.hold_turns_remaining,
    status_context_graph_cache_autotune_state_downshift_warmup_streak_type:
      typeof contextGraphCacheAutotuneState?.downshift_warmup_streak,
    status_context_graph_cache_autotune_state_last_reason_type:
      contextGraphCacheAutotuneState?.last_reason === null
        ? "null"
        : typeof contextGraphCacheAutotuneState?.last_reason,
    status_context_graph_cache_autotune_state_updated_at_type:
      contextGraphCacheAutotuneState?.updated_at === null
        ? "null"
        : typeof contextGraphCacheAutotuneState?.updated_at,
    status_context_graph_cache_autotune_state_adaptive_cache_threshold_type:
      typeof contextGraphCacheAutotuneState?.adaptive_cache_query_hit_rate_threshold,
    status_context_graph_cache_autotune_state_adaptive_parsed_max_type:
      typeof contextGraphCacheAutotuneState?.adaptive_persistent_parsed_per_scanned_max,
    status_context_graph_cache_autotune_state_adaptive_reused_min_type:
      typeof contextGraphCacheAutotuneState?.adaptive_persistent_reused_per_scanned_min,
    status_context_graph_cache_autotune_state_adaptive_removed_max_type:
      typeof contextGraphCacheAutotuneState?.adaptive_persistent_removed_per_scanned_max,
    status_context_graph_cache_autotune_state_adaptive_alpha_type:
      typeof contextGraphCacheAutotuneState?.adaptive_learn_alpha,
    status_context_graph_cache_autotune_state_adaptive_updates_type:
      typeof contextGraphCacheAutotuneState?.adaptive_updates,
    status_context_graph_cache_autotune_state_adaptive_source_type:
      typeof contextGraphCacheAutotuneState?.adaptive_source,
    status_context_graph_cache_autotune_state_adaptive_action_scale_type:
      typeof contextGraphCacheAutotuneState?.adaptive_action_scale,
    status_context_graph_cache_autotune_state_adaptive_action_updates_type:
      typeof contextGraphCacheAutotuneState?.adaptive_action_updates,
    status_context_graph_cache_autotune_state_adaptive_action_source_type:
      typeof contextGraphCacheAutotuneState?.adaptive_action_source,
    status_context_graph_cache_autotune_state_persistence_domain_type:
      typeof contextGraphCacheAutotuneState?.persistence_domain,
    status_has_context_graph_cache_window: Boolean(contextGraphCacheWindow),
    status_context_graph_cache_window_path_type: typeof contextGraphCacheWindow?.path,
    status_context_graph_cache_window_configured_size_type: typeof contextGraphCacheWindow?.configured_size,
    status_context_graph_cache_window_configured_size_value:
      typeof contextGraphCacheWindow?.configured_size === "number"
        ? contextGraphCacheWindow.configured_size
        : null,
    status_context_graph_cache_window_persistence_domain_type:
      typeof contextGraphCacheWindow?.persistence_domain,
    status_context_graph_cache_window_persistence_domain_value:
      typeof contextGraphCacheWindow?.persistence_domain === "string"
        ? contextGraphCacheWindow.persistence_domain
        : null,
    status_context_graph_cache_window_entries_type: typeof contextGraphCacheWindow?.entries,
    status_context_graph_cache_window_from_ts_type:
      contextGraphCacheWindow?.from_ts === null ? "null" : typeof contextGraphCacheWindow?.from_ts,
    status_context_graph_cache_window_to_ts_type:
      contextGraphCacheWindow?.to_ts === null ? "null" : typeof contextGraphCacheWindow?.to_ts,
    status_context_graph_cache_window_delta_symbol_query_hit_type: typeof symbolQueryWindowDeltaStats?.hit,
    status_context_graph_cache_window_delta_symbol_declaration_write_type:
      typeof symbolDeclarationWindowDeltaStats?.write,
    status_context_graph_cache_window_delta_dependency_query_miss_type: typeof dependencyQueryWindowDeltaStats?.miss,
    status_context_graph_cache_window_delta_dependency_import_evict_type:
      typeof dependencyImportWindowDeltaStats?.evict,
    status_context_graph_cache_window_query_totals_hit_type: typeof contextGraphCacheWindowQueryTotals?.hit,
    status_context_graph_cache_window_overall_totals_hit_type: typeof contextGraphCacheWindowOverallTotals?.hit,
    status_context_graph_cache_window_query_hit_rate_type:
      contextGraphCacheWindow?.query_hit_rate === null ? "null" : typeof contextGraphCacheWindow?.query_hit_rate,
    status_context_graph_cache_window_overall_hit_rate_type:
      contextGraphCacheWindow?.overall_hit_rate === null ? "null" : typeof contextGraphCacheWindow?.overall_hit_rate,
    status_context_graph_cache_window_has_quality: Boolean(contextGraphCacheWindowQuality),
    status_context_graph_cache_window_quality_entries_with_quality_type:
      typeof contextGraphCacheWindowQuality?.entries_with_quality,
    status_context_graph_cache_window_quality_dependency_avg_rows_type:
      contextGraphCacheWindowQualityDependency?.avg_rows === null
        ? "null"
        : typeof contextGraphCacheWindowQualityDependency?.avg_rows,
    status_context_graph_cache_window_quality_dependency_avg_max_chain_depth_type:
      contextGraphCacheWindowQualityDependency?.avg_max_chain_depth === null
        ? "null"
        : typeof contextGraphCacheWindowQualityDependency?.avg_max_chain_depth,
    status_context_graph_cache_window_quality_dependency_multi_hop_rate_type:
      contextGraphCacheWindowQualityDependency?.multi_hop_rate === null
        ? "null"
        : typeof contextGraphCacheWindowQualityDependency?.multi_hop_rate,
    status_context_graph_cache_window_quality_symbol_bridge_coverage_rate_type:
      contextGraphCacheWindowQualitySymbol?.bridge_coverage_rate === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.bridge_coverage_rate,
    status_context_graph_cache_window_quality_symbol_breadth_coverage_rate_type:
      contextGraphCacheWindowQualitySymbol?.breadth_coverage_rate === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.breadth_coverage_rate,
    status_context_graph_cache_window_quality_symbol_avg_refs_type:
      contextGraphCacheWindowQualitySymbol?.avg_refs === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.avg_refs,
    status_context_graph_cache_window_quality_symbol_max_refs_type:
      contextGraphCacheWindowQualitySymbol?.max_refs === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.max_refs,
    status_context_graph_cache_window_has_degradation: Boolean(contextGraphCacheWindowDegradation),
    status_context_graph_cache_window_degradation_degraded_type: typeof contextGraphCacheWindowDegradation?.degraded,
    status_context_graph_cache_window_degradation_reason_type: typeof contextGraphCacheWindowDegradation?.reason,
    status_context_graph_cache_window_degradation_threshold_type:
      typeof contextGraphCacheWindowDegradation?.threshold_query_hit_rate,
    status_context_graph_cache_window_degradation_min_entries_type:
      typeof contextGraphCacheWindowDegradation?.min_entries,
    status_context_graph_cache_window_degradation_observed_entries_type:
      typeof contextGraphCacheWindowDegradation?.observed_entries,
    status_context_graph_cache_window_degradation_observed_query_hit_rate_type:
      contextGraphCacheWindowDegradation?.observed_query_hit_rate === null
        ? "null"
        : typeof contextGraphCacheWindowDegradation?.observed_query_hit_rate,
    status_has_context_persistent_graph_index: Boolean(contextPersistentGraphIndex),
    status_context_persistent_graph_index_enabled_type: typeof contextPersistentGraphIndex?.enabled,
    status_context_persistent_graph_index_root_path_type: typeof contextPersistentGraphIndex?.root_path,
    status_context_persistent_graph_index_index_path_type: typeof contextPersistentGraphIndex?.index_path,
    status_context_persistent_graph_index_persistence_domain_type:
      typeof contextPersistentGraphIndex?.persistence_domain,
    status_context_persistent_graph_index_persistence_domain_value:
      typeof contextPersistentGraphIndex?.persistence_domain === "string"
        ? contextPersistentGraphIndex.persistence_domain
        : null,
    status_context_persistent_graph_index_updated_at_type:
      contextPersistentGraphIndex?.updated_at === null ? "null" : typeof contextPersistentGraphIndex?.updated_at,
    status_context_persistent_graph_index_file_count_type: typeof contextPersistentGraphIndex?.file_count,
    status_context_persistent_graph_index_symbol_count_type: typeof contextPersistentGraphIndex?.symbol_count,
    status_context_persistent_graph_index_edge_count_type: typeof contextPersistentGraphIndex?.edge_count,
    status_context_persistent_graph_index_has_last_refresh: Boolean(contextPersistentGraphIndexLastRefresh),
    status_context_persistent_graph_index_last_refresh_mode_type:
      typeof contextPersistentGraphIndexLastRefresh?.mode,
    status_context_persistent_graph_index_last_refresh_parsed_files_type:
      typeof contextPersistentGraphIndexLastRefresh?.parsed_files,
    status_context_persistent_graph_index_last_refresh_reused_files_type:
      typeof contextPersistentGraphIndexLastRefresh?.reused_files,
    status_context_persistent_graph_index_last_refresh_removed_files_type:
      typeof contextPersistentGraphIndexLastRefresh?.removed_files,
    status_context_persistent_graph_index_has_window: Boolean(contextPersistentGraphIndexWindow),
    status_context_persistent_graph_index_window_path_type:
      typeof contextPersistentGraphIndexWindow?.path,
    status_context_persistent_graph_index_window_configured_size_type:
      typeof contextPersistentGraphIndexWindow?.configured_size,
    status_context_persistent_graph_index_window_configured_size_value:
      typeof contextPersistentGraphIndexWindow?.configured_size === "number"
        ? contextPersistentGraphIndexWindow.configured_size
        : null,
    status_context_persistent_graph_index_window_persistence_domain_type:
      typeof contextPersistentGraphIndexWindow?.persistence_domain,
    status_context_persistent_graph_index_window_persistence_domain_value:
      typeof contextPersistentGraphIndexWindow?.persistence_domain === "string"
        ? contextPersistentGraphIndexWindow.persistence_domain
        : null,
    status_context_persistent_graph_index_window_entries_type:
      typeof contextPersistentGraphIndexWindow?.entries,
    status_context_persistent_graph_index_window_from_ts_type:
      contextPersistentGraphIndexWindow?.from_ts === null
        ? "null"
        : typeof contextPersistentGraphIndexWindow?.from_ts,
    status_context_persistent_graph_index_window_to_ts_type:
      contextPersistentGraphIndexWindow?.to_ts === null
        ? "null"
        : typeof contextPersistentGraphIndexWindow?.to_ts,
    status_context_persistent_graph_index_window_mode_counts_incremental_type:
      typeof contextPersistentGraphIndexWindowModeCounts?.incremental,
    status_context_persistent_graph_index_window_totals_parsed_files_type:
      typeof contextPersistentGraphIndexWindowTotals?.parsed_files,
    status_context_persistent_graph_index_window_totals_reused_files_type:
      typeof contextPersistentGraphIndexWindowTotals?.reused_files,
    status_context_persistent_graph_index_window_rates_parsed_per_scanned_type:
      contextPersistentGraphIndexWindowRates?.parsed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexWindowRates?.parsed_per_scanned,
    status_context_persistent_graph_index_window_rates_reused_per_scanned_type:
      contextPersistentGraphIndexWindowRates?.reused_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexWindowRates?.reused_per_scanned,
    status_context_persistent_graph_index_window_rates_removed_per_scanned_type:
      contextPersistentGraphIndexWindowRates?.removed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexWindowRates?.removed_per_scanned,
    status_context_persistent_graph_index_window_has_latest:
      contextPersistentGraphIndexWindow?.latest === null
        ? true
        : Boolean(contextPersistentGraphIndexWindowLatest),
    status_context_persistent_graph_index_window_latest_mode_type:
      contextPersistentGraphIndexWindowLatest == null
        ? "null"
        : typeof contextPersistentGraphIndexWindowLatest?.mode,
    status_context_persistent_graph_index_window_latest_parsed_files_type:
      contextPersistentGraphIndexWindowLatest == null
        ? "null"
        : typeof contextPersistentGraphIndexWindowLatest?.parsed_files,
    status_context_persistent_graph_index_window_latest_file_count_type:
      contextPersistentGraphIndexWindowLatest == null
        ? "null"
        : typeof contextPersistentGraphIndexWindowLatest?.file_count,
    status_context_persistent_graph_index_has_degradation:
      Boolean(contextPersistentGraphIndexDegradation),
    status_context_persistent_graph_index_degradation_degraded_type:
      typeof contextPersistentGraphIndexDegradation?.degraded,
    status_context_persistent_graph_index_degradation_reason_type:
      typeof contextPersistentGraphIndexDegradation?.reason,
    status_context_persistent_graph_index_degradation_threshold_parsed_type:
      typeof contextPersistentGraphIndexDegradation?.threshold_parsed_per_scanned_max,
    status_context_persistent_graph_index_degradation_threshold_reused_type:
      typeof contextPersistentGraphIndexDegradation?.threshold_reused_per_scanned_min,
    status_context_persistent_graph_index_degradation_threshold_removed_type:
      typeof contextPersistentGraphIndexDegradation?.threshold_removed_per_scanned_max,
    status_context_persistent_graph_index_degradation_observed_parsed_type:
      contextPersistentGraphIndexDegradation?.observed_parsed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexDegradation?.observed_parsed_per_scanned,
    status_context_persistent_graph_index_degradation_observed_reused_type:
      contextPersistentGraphIndexDegradation?.observed_reused_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexDegradation?.observed_reused_per_scanned,
    status_context_persistent_graph_index_degradation_observed_removed_type:
      contextPersistentGraphIndexDegradation?.observed_removed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexDegradation?.observed_removed_per_scanned,
  };
}
