import {
  collectRuntimeToolStatusSurface,
} from "./status-ts-rust-flow/runtime-tools-status.mjs";
import {
  collectContextGraphStatusSurface,
} from "./status-ts-rust-flow/context-graph-status.mjs";
import {
  collectContextEngineGraphQualityStatusSurface,
} from "./status-ts-rust-flow/context-engine-graph-quality-status.mjs";
import {
  collectContextEnginePromptQualityGuardStatusSurface,
} from "./status-ts-rust-flow/context-engine-prompt-quality-guard-status.mjs";

const STATUS_TEXT_FORBIDDEN_RAW_FRAGMENTS = [
  "status: ok",
  "Base URL",
  "API Key",
  "Profile",
  "config_toml:",
  "provider_source:",
  "route_decision:",
  "runtime_tool_quality:",
  "context_engine:",
  "runtime rpc error -32001",
  "upstream_connect_failed",
  "tool_not_visible",
  "GROBOT_STATUS_LEGACY_TEXT",
];

export function runStatusTsRust(context, windowSize) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    parseJsonObjectSafe,
    isObject,
  } = context;
  const workDir = createTempDir("grobot-status-work");
  writeExecutionProjectToml(workDir);
  const commandArgs = [
    "./grobot",
    "status",
    "--json",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ];
  if (typeof windowSize === "number" && Number.isFinite(windowSize) && windowSize > 0) {
    commandArgs.push("--context-graph-cache-window-size", String(Math.floor(windowSize)));
  }
  const result = runCommand(repoRoot, commandArgs);
  const textResult = runCommand(repoRoot, commandArgs.filter((item) => item !== "--json"));
  const parsedStatus = parseJsonObjectSafe(result.stdout);
  const routeDecision = isObject(parsedStatus?.route_decision)
    ? parsedStatus.route_decision
    : null;
  const routeObserved = isObject(routeDecision?.observed)
    ? routeDecision.observed
    : null;
  const routeObservedProviderRuntimeStates = Array.isArray(routeObserved?.provider_runtime_states)
    ? routeObserved.provider_runtime_states
    : null;
  const routeFailover = isObject(routeDecision?.failover)
    ? routeDecision.failover
    : null;
  const topLevelCacheStats = isObject(parsedStatus?.cache_stats)
    ? parsedStatus.cache_stats
    : null;
  const runtimeHealth = isObject(parsedStatus?.runtime_health)
    ? parsedStatus.runtime_health
    : null;
  const runtimeTools = isObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const turnGate = isObject(parsedStatus?.turn_gate)
    ? parsedStatus.turn_gate
    : null;
  const cacheStatsLocation = typeof parsedStatus?.cache_stats_location === "string"
    ? parsedStatus.cache_stats_location
    : null;
  const runtimeToolStatus = collectRuntimeToolStatusSurface({
    runtimeTools,
    runtimeHealth,
    topLevelCacheStats,
    cacheStatsLocation,
    isObject,
  });
  const contextGraphStatus = collectContextGraphStatusSurface({
    parsedStatus,
    isObject,
  });
  const contextEngine = isObject(parsedStatus?.context_engine)
    ? parsedStatus.context_engine
    : null;
  const contextEngineThresholds = isObject(contextEngine?.thresholds)
    ? contextEngine.thresholds
    : null;
  const contextEngineRecovery = isObject(contextEngine?.recovery)
    ? contextEngine.recovery
    : null;
  const contextEnginePromptQualityGuardStatus = collectContextEnginePromptQualityGuardStatusSurface({
    contextEngine,
    isObject,
  });
  const contextEngineGraphQualityStatus = collectContextEngineGraphQualityStatusSurface({
    contextEngine,
    isObject,
  });
  const promptQualityWindow = isObject(contextEngine?.prompt_quality_window)
    ? contextEngine.prompt_quality_window
    : null;
  const promptQualityWindowAverageScores = isObject(promptQualityWindow?.average_scores)
    ? promptQualityWindow.average_scores
    : null;
  const promptQualityWindowLatestScores = isObject(promptQualityWindow?.latest_scores)
    ? promptQualityWindow.latest_scores
    : null;
  const promptQualityWindowLowQuality = isObject(promptQualityWindow?.low_quality)
    ? promptQualityWindow.low_quality
    : null;
  const promptQualityWindowStageCounts = isObject(promptQualityWindow?.stage_counts)
    ? promptQualityWindow.stage_counts
    : null;
  const promptQualityWindowSignalAverages = isObject(promptQualityWindow?.signal_averages)
    ? promptQualityWindow.signal_averages
    : null;
  const promptQualityWindowCompressionActivity = isObject(promptQualityWindow?.compression_activity)
    ? promptQualityWindow.compression_activity
    : null;
  const promptQualityWindowTokenBudget = isObject(promptQualityWindow?.token_budget)
    ? promptQualityWindow.token_budget
    : null;
  const promptQualityWindowStrategyActivity = isObject(promptQualityWindow?.strategy_activity)
    ? promptQualityWindow.strategy_activity
    : null;
  const promptQualityWindowStrategyTrends = isObject(promptQualityWindow?.strategy_trends)
    ? promptQualityWindow.strategy_trends
    : null;
  const promptQualityWindowStrategyTrendsShort = isObject(promptQualityWindowStrategyTrends?.short)
    ? promptQualityWindowStrategyTrends.short
    : null;
  const promptQualityWindowStrategyTrendsMedium = isObject(promptQualityWindowStrategyTrends?.medium)
    ? promptQualityWindowStrategyTrends.medium
    : null;
  const promptQualityWindowStrategyTrendsDelta = isObject(promptQualityWindowStrategyTrends?.delta)
    ? promptQualityWindowStrategyTrends.delta
    : null;
  const promptQualityWindowStrategyOutcomes = isObject(promptQualityWindow?.strategy_outcomes)
    ? promptQualityWindow.strategy_outcomes
    : null;
  const promptQualityWindowPressureTrends = isObject(promptQualityWindow?.pressure_trends)
    ? promptQualityWindow.pressure_trends
    : null;
  const promptQualityWindowPressureTrendsShort = isObject(promptQualityWindowPressureTrends?.short)
    ? promptQualityWindowPressureTrends.short
    : null;
  const promptQualityWindowPressureTrendsMedium = isObject(promptQualityWindowPressureTrends?.medium)
    ? promptQualityWindowPressureTrends.medium
    : null;
  const promptQualityWindowPressureTrendsDelta = isObject(promptQualityWindowPressureTrends?.delta)
    ? promptQualityWindowPressureTrends.delta
    : null;
  const promptQualityWindowDegradation = isObject(promptQualityWindow?.degradation)
    ? promptQualityWindow.degradation
    : null;
  return {
    ...result,
    status_text_exit_code: textResult.exit_code,
    status_text_uses_info_panel:
      textResult.stdout.includes("Grobot status")
      && textResult.stdout.includes("• Route ")
      && textResult.stdout.includes("  ⎿"),
    status_text_hides_raw_machine_lines:
      STATUS_TEXT_FORBIDDEN_RAW_FRAGMENTS.every((fragment) => !textResult.stdout.includes(fragment)),
    status_text_has_json_hint:
      textResult.stdout.includes("grobot status --json"),
    status_json_parse_ok: Boolean(parsedStatus),
    status_has_route_decision: Boolean(routeDecision),
    status_has_route_observed: Boolean(routeObserved),
    status_has_route_observed_provider_runtime_states: Array.isArray(routeObservedProviderRuntimeStates),
    status_has_route_ordered_providers: Array.isArray(routeDecision?.ordered_providers),
    status_has_route_failover: Boolean(routeFailover),
    status_route_observed_source_type: typeof routeObserved?.source,
    status_has_turn_gate: Boolean(turnGate),
    status_turn_gate_active_sessions_type: typeof turnGate?.active_sessions,
    status_turn_gate_tracked_sessions_type: typeof turnGate?.tracked_sessions,
    status_turn_gate_rejected_reentrant_total_type:
      typeof turnGate?.rejected_reentrant_total,
    status_turn_gate_stale_cleanup_total_type:
      typeof turnGate?.stale_cleanup_total,
    status_turn_gate_sessions_is_array: Array.isArray(turnGate?.sessions),
    ...runtimeToolStatus,
    ...contextGraphStatus,
    status_has_context_engine: Boolean(contextEngine),
    status_context_engine_enabled_type: typeof contextEngine?.enabled,
    status_context_engine_profile_type: typeof contextEngine?.profile,
    status_context_engine_auto_limit_type: typeof contextEngine?.auto_compact_token_limit,
    status_context_engine_target_limit_type: typeof contextEngine?.target_token_limit,
    status_context_engine_effective_window_type: typeof contextEngine?.effective_window_tokens,
    status_context_engine_threshold_hard_type: typeof contextEngineThresholds?.hard_ratio,
    status_context_engine_recovery_ptl_type: typeof contextEngineRecovery?.ptl_max_retries,
    ...contextEnginePromptQualityGuardStatus,
    ...contextEngineGraphQualityStatus,
    status_context_engine_has_prompt_quality_window: Boolean(promptQualityWindow),
    status_context_engine_prompt_quality_window_path_type: typeof promptQualityWindow?.path,
    status_context_engine_prompt_quality_window_configured_size_type: typeof promptQualityWindow?.configured_size,
    status_context_engine_prompt_quality_window_entries_type: typeof promptQualityWindow?.entries,
    status_context_engine_prompt_quality_window_persistence_domain_type:
      typeof promptQualityWindow?.persistence_domain,
    status_context_engine_prompt_quality_window_persistence_domain_value:
      typeof promptQualityWindow?.persistence_domain === "string"
        ? promptQualityWindow.persistence_domain
        : null,
    status_context_engine_prompt_quality_window_from_ts_type: promptQualityWindow?.from_ts === null
      ? "null"
      : typeof promptQualityWindow?.from_ts,
    status_context_engine_prompt_quality_window_to_ts_type: promptQualityWindow?.to_ts === null
      ? "null"
      : typeof promptQualityWindow?.to_ts,
    status_context_engine_prompt_quality_window_average_overall_type: promptQualityWindow?.average_scores === null
      ? "null"
      : typeof promptQualityWindowAverageScores?.overall,
    status_context_engine_prompt_quality_window_latest_overall_type: promptQualityWindow?.latest_scores === null
      ? "null"
      : typeof promptQualityWindowLatestScores?.overall,
    status_context_engine_prompt_quality_window_low_quality_rate_type:
      promptQualityWindowLowQuality?.rate === null
        ? "null"
        : typeof promptQualityWindowLowQuality?.rate,
    status_context_engine_prompt_quality_window_low_quality_threshold_type:
      typeof promptQualityWindowLowQuality?.threshold_overall,
    status_context_engine_prompt_quality_window_stage_normal_type:
      typeof promptQualityWindowStageCounts?.normal,
    status_context_engine_prompt_quality_window_stage_proactive_type:
      typeof promptQualityWindowStageCounts?.proactive,
    status_context_engine_prompt_quality_window_stage_forced_type:
      typeof promptQualityWindowStageCounts?.forced,
    status_context_engine_prompt_quality_window_stage_minimal_type:
      typeof promptQualityWindowStageCounts?.minimal,
    status_context_engine_prompt_quality_window_signal_avg_recent_trim_rows_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.recent_trim_rows,
    status_context_engine_prompt_quality_window_signal_avg_snapshot_semantic_compress_sections_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.snapshot_semantic_compress_sections,
    status_context_engine_prompt_quality_window_signal_avg_pre_send_overflow_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.pre_send_overflow_ratio,
    status_context_engine_prompt_quality_window_signal_avg_pre_send_pressure_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.pre_send_pressure_score,
    status_context_engine_prompt_quality_window_compression_snapshot_semantic_rate_type:
      promptQualityWindowCompressionActivity?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowCompressionActivity?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_compression_auto_limit_rate_type:
      promptQualityWindowCompressionActivity?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowCompressionActivity?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_token_budget_avg_utilization_type:
      promptQualityWindowTokenBudget?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowTokenBudget?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_strategy_quality_first_rate_type:
      promptQualityWindowStrategyActivity?.quality_first_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyActivity?.quality_first_rate,
    status_context_engine_prompt_quality_window_strategy_hard_budget_rate_type:
      promptQualityWindowStrategyActivity?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyActivity?.hard_budget_rate,
    status_context_engine_prompt_quality_window_has_strategy_outcomes:
      Boolean(promptQualityWindowStrategyOutcomes),
    status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_followup_delta_type:
      promptQualityWindowStrategyOutcomes?.hard_budget_followup_overall_delta === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.hard_budget_followup_overall_delta,
    status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_followup_delta_type:
      promptQualityWindowStrategyOutcomes?.quality_first_followup_overall_delta === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.quality_first_followup_overall_delta,
    status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_recovery_rate_type:
      promptQualityWindowStrategyOutcomes?.hard_budget_recovery_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.hard_budget_recovery_rate,
    status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_improved_rate_type:
      promptQualityWindowStrategyOutcomes?.quality_first_improved_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.quality_first_improved_rate,
    status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_transition_count_type:
      promptQualityWindowStrategyOutcomes?.hard_budget_transition_count === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.hard_budget_transition_count,
    status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_transition_count_type:
      promptQualityWindowStrategyOutcomes?.quality_first_transition_count === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.quality_first_transition_count,
    status_context_engine_prompt_quality_window_has_strategy_trends:
      Boolean(promptQualityWindowStrategyTrends),
    status_context_engine_prompt_quality_window_strategy_trends_short_window_size_type:
      typeof promptQualityWindowStrategyTrendsShort?.window_size,
    status_context_engine_prompt_quality_window_strategy_trends_short_hard_budget_rate_type:
      promptQualityWindowStrategyTrendsShort?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsShort?.hard_budget_rate,
    status_context_engine_prompt_quality_window_strategy_trends_short_avg_overflow_type:
      promptQualityWindowStrategyTrendsShort?.average_overflow_ratio === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsShort?.average_overflow_ratio,
    status_context_engine_prompt_quality_window_strategy_trends_short_avg_pressure_type:
      promptQualityWindowStrategyTrendsShort?.average_pressure_score === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsShort?.average_pressure_score,
    status_context_engine_prompt_quality_window_strategy_trends_medium_window_size_type:
      typeof promptQualityWindowStrategyTrendsMedium?.window_size,
    status_context_engine_prompt_quality_window_strategy_trends_medium_hard_budget_rate_type:
      promptQualityWindowStrategyTrendsMedium?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsMedium?.hard_budget_rate,
    status_context_engine_prompt_quality_window_strategy_trends_delta_hard_budget_rate_type:
      promptQualityWindowStrategyTrendsDelta?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsDelta?.hard_budget_rate,
    status_context_engine_prompt_quality_window_strategy_trends_delta_avg_overflow_type:
      promptQualityWindowStrategyTrendsDelta?.average_overflow_ratio === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsDelta?.average_overflow_ratio,
    status_context_engine_prompt_quality_window_strategy_trends_delta_avg_pressure_type:
      promptQualityWindowStrategyTrendsDelta?.average_pressure_score === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsDelta?.average_pressure_score,
    status_context_engine_prompt_quality_window_has_pressure_trends:
      Boolean(promptQualityWindowPressureTrends),
    status_context_engine_prompt_quality_window_pressure_trends_short_window_size_type:
      typeof promptQualityWindowPressureTrendsShort?.window_size,
    status_context_engine_prompt_quality_window_pressure_trends_short_entries_type:
      typeof promptQualityWindowPressureTrendsShort?.entries,
    status_context_engine_prompt_quality_window_pressure_trends_short_semantic_rate_type:
      promptQualityWindowPressureTrendsShort?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsShort?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_pressure_trends_short_auto_limit_rate_type:
      promptQualityWindowPressureTrendsShort?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsShort?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_pressure_trends_short_avg_utilization_type:
      promptQualityWindowPressureTrendsShort?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsShort?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_pressure_trends_medium_window_size_type:
      typeof promptQualityWindowPressureTrendsMedium?.window_size,
    status_context_engine_prompt_quality_window_pressure_trends_medium_entries_type:
      typeof promptQualityWindowPressureTrendsMedium?.entries,
    status_context_engine_prompt_quality_window_pressure_trends_medium_semantic_rate_type:
      promptQualityWindowPressureTrendsMedium?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsMedium?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_pressure_trends_medium_auto_limit_rate_type:
      promptQualityWindowPressureTrendsMedium?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsMedium?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_pressure_trends_medium_avg_utilization_type:
      promptQualityWindowPressureTrendsMedium?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsMedium?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_pressure_trends_delta_semantic_rate_type:
      promptQualityWindowPressureTrendsDelta?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsDelta?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_pressure_trends_delta_auto_limit_rate_type:
      promptQualityWindowPressureTrendsDelta?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsDelta?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_pressure_trends_delta_avg_utilization_type:
      promptQualityWindowPressureTrendsDelta?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsDelta?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_has_degradation:
      Boolean(promptQualityWindowDegradation),
    status_context_engine_prompt_quality_window_degradation_degraded_type:
      typeof promptQualityWindowDegradation?.degraded,
    status_context_engine_prompt_quality_window_degradation_reason_type:
      typeof promptQualityWindowDegradation?.reason,
    status_context_engine_prompt_quality_window_degradation_threshold_overall_type:
      typeof promptQualityWindowDegradation?.threshold_overall,
    status_context_engine_prompt_quality_window_degradation_threshold_low_quality_rate_type:
      typeof promptQualityWindowDegradation?.threshold_low_quality_rate,
    status_context_engine_prompt_quality_window_degradation_min_entries_type:
      typeof promptQualityWindowDegradation?.min_entries,
    status_context_engine_prompt_quality_window_degradation_observed_entries_type:
      typeof promptQualityWindowDegradation?.observed_entries,
    status_context_engine_prompt_quality_window_degradation_observed_overall_type:
      promptQualityWindowDegradation?.observed_overall === null
        ? "null"
        : typeof promptQualityWindowDegradation?.observed_overall,
    status_context_engine_prompt_quality_window_degradation_observed_low_quality_rate_type:
      promptQualityWindowDegradation?.observed_low_quality_rate === null
        ? "null"
        : typeof promptQualityWindowDegradation?.observed_low_quality_rate,
    status_route_reason_type: typeof routeDecision?.reason,
  };
}
