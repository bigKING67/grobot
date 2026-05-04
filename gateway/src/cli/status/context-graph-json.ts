import type {
  ContextStorageDomain,
  GraphCacheWindowDegradation,
  GraphQualityAutotuneState,
  GraphQualitySignalsSummary,
  PersistentGraphWindowDegradation,
} from "../../tools/context";
import type { GraphCacheWindowSummary } from "../../tools/context/graph/cache-window";
import type { readPersistentGraphIndexStatus } from "../../tools/context/graph/persistent-index";
import type { GraphCacheCounter } from "./context-engine-status";

type PersistentGraphIndexStatus = ReturnType<typeof readPersistentGraphIndexStatus>;

export function serializeContextGraphCacheStatsStatus(input: {
  symbolQueryGraphCacheStats: GraphCacheCounter;
  symbolDeclarationGraphCacheStats: GraphCacheCounter;
  dependencyQueryGraphCacheStats: GraphCacheCounter;
  dependencyImportGraphCacheStats: GraphCacheCounter;
  graphQualityAutotuneState: GraphQualityAutotuneState;
  graphAutotuneStatePersistenceDomain: ContextStorageDomain;
  contextGraphCacheWindowSummary: GraphCacheWindowSummary;
  graphCacheWindowPersistenceDomain: ContextStorageDomain;
  contextGraphCacheWindowDegradation: GraphCacheWindowDegradation;
}): Record<string, unknown> {
  const summary = input.contextGraphCacheWindowSummary;
  const degradation = input.contextGraphCacheWindowDegradation;
  const autotuneState = input.graphQualityAutotuneState;
  return {
    symbol_query: input.symbolQueryGraphCacheStats,
    symbol_declaration: input.symbolDeclarationGraphCacheStats,
    dependency_query: input.dependencyQueryGraphCacheStats,
    dependency_import: input.dependencyImportGraphCacheStats,
    autotune_state: {
      last_direction: autotuneState.lastDirection,
      hold_turns_remaining: autotuneState.holdTurnsRemaining,
      downshift_warmup_streak: autotuneState.downshiftWarmupStreak,
      last_reason: autotuneState.lastReason || null,
      updated_at: autotuneState.updatedAt,
      adaptive_cache_query_hit_rate_threshold: autotuneState.cacheDegradeQueryHitRateThreshold,
      adaptive_persistent_parsed_per_scanned_max: autotuneState.persistentDegradeParsedPerScannedMax,
      adaptive_persistent_reused_per_scanned_min: autotuneState.persistentDegradeReusedPerScannedMin,
      adaptive_persistent_removed_per_scanned_max: autotuneState.persistentDegradeRemovedPerScannedMax,
      adaptive_learn_alpha: autotuneState.adaptiveLearnAlpha,
      adaptive_updates: autotuneState.adaptiveUpdates,
      adaptive_source: autotuneState.adaptiveSource,
      adaptive_action_scale: autotuneState.adaptiveActionScale,
      adaptive_action_updates: autotuneState.adaptiveActionUpdates,
      adaptive_action_source: autotuneState.adaptiveActionSource,
      persistence_domain: input.graphAutotuneStatePersistenceDomain,
    },
    window: {
      path: summary.path,
      configured_size: summary.configuredSize,
      entries: summary.entries,
      from_ts: summary.fromTs,
      to_ts: summary.toTs,
      persistence_domain: input.graphCacheWindowPersistenceDomain,
      delta_totals: {
        symbol_query: summary.deltaTotals.symbolQuery,
        symbol_declaration: summary.deltaTotals.symbolDeclaration,
        dependency_query: summary.deltaTotals.dependencyQuery,
        dependency_import: summary.deltaTotals.dependencyImport,
      },
      query_totals: summary.queryTotals,
      overall_totals: summary.overallTotals,
      query_hit_rate: summary.queryHitRate,
      overall_hit_rate: summary.overallHitRate,
      quality: {
        entries_with_quality: summary.quality.entriesWithQuality,
        dependency: {
          avg_rows: summary.quality.dependency.avgRows,
          avg_multi_hop_rows: summary.quality.dependency.avgMultiHopRows,
          avg_max_chain_depth: summary.quality.dependency.avgMaxChainDepth,
          multi_hop_rate: summary.quality.dependency.multiHopRate,
          depth_4_plus_rate: summary.quality.dependency.depth4PlusRate,
        },
        symbol: {
          avg_rows: summary.quality.symbol.avgRows,
          bridge_coverage_rate: summary.quality.symbol.bridgeCoverageRate,
          breadth_coverage_rate: summary.quality.symbol.breadthCoverageRate,
          avg_bridge: summary.quality.symbol.avgBridge,
          avg_breadth: summary.quality.symbol.avgBreadth,
          avg_refs: summary.quality.symbol.avgRefs,
          max_refs: summary.quality.symbol.maxRefs,
        },
      },
      degradation: {
        degraded: degradation.degraded,
        reason: degradation.reason,
        threshold_query_hit_rate: degradation.thresholdQueryHitRate,
        min_entries: degradation.minEntries,
        observed_entries: degradation.observedEntries,
        observed_query_hit_rate: degradation.observedQueryHitRate,
        observed_query_hit: degradation.observedQueryHit,
        observed_query_miss: degradation.observedQueryMiss,
      },
    },
  };
}

export function serializeContextPersistentGraphIndexStatus(input: {
  persistentGraphIndexStatus: PersistentGraphIndexStatus;
  persistentGraphIndexPersistenceDomain: ContextStorageDomain;
  persistentGraphIndexWindowPersistenceDomain: ContextStorageDomain;
  persistentGraphWindowDegradation: PersistentGraphWindowDegradation;
}): Record<string, unknown> {
  const status = input.persistentGraphIndexStatus;
  const degradation = input.persistentGraphWindowDegradation;
  return {
    ...status,
    persistence_domain: input.persistentGraphIndexPersistenceDomain,
    window: status.window == null
      ? undefined
      : {
        ...status.window,
        persistence_domain: input.persistentGraphIndexWindowPersistenceDomain,
      },
    degradation: {
      degraded: degradation.degraded,
      reason: degradation.reason,
      threshold_parsed_per_scanned_max: degradation.thresholdParsedPerScannedMax,
      threshold_reused_per_scanned_min: degradation.thresholdReusedPerScannedMin,
      threshold_removed_per_scanned_max: degradation.thresholdRemovedPerScannedMax,
      min_entries: degradation.minEntries,
      min_scanned_files: degradation.minScannedFiles,
      observed_entries: degradation.observedEntries,
      observed_scanned_files: degradation.observedScannedFiles,
      observed_parsed_per_scanned: degradation.observedParsedPerScanned,
      observed_reused_per_scanned: degradation.observedReusedPerScanned,
      observed_removed_per_scanned: degradation.observedRemovedPerScanned,
    },
  };
}

export function serializeContextGraphQualitySignalsStatus(input: {
  contextGraphCacheWindowDegradation: GraphCacheWindowDegradation;
  persistentGraphWindowDegradation: PersistentGraphWindowDegradation;
  graphQualitySignals: GraphQualitySignalsSummary;
}): Record<string, unknown> {
  const cacheWindow = input.contextGraphCacheWindowDegradation;
  const persistentWindow = input.persistentGraphWindowDegradation;
  return {
    cache_window: {
      degraded: cacheWindow.degraded,
      reason: cacheWindow.reason,
      observed_query_hit_rate: cacheWindow.observedQueryHitRate,
      threshold_query_hit_rate: cacheWindow.thresholdQueryHitRate,
      observed_entries: cacheWindow.observedEntries,
      min_entries: cacheWindow.minEntries,
    },
    persistent_window: {
      degraded: persistentWindow.degraded,
      reason: persistentWindow.reason,
      observed_parsed_per_scanned: persistentWindow.observedParsedPerScanned,
      observed_reused_per_scanned: persistentWindow.observedReusedPerScanned,
      observed_removed_per_scanned: persistentWindow.observedRemovedPerScanned,
      threshold_parsed_per_scanned_max: persistentWindow.thresholdParsedPerScannedMax,
      threshold_reused_per_scanned_min: persistentWindow.thresholdReusedPerScannedMin,
      threshold_removed_per_scanned_max: persistentWindow.thresholdRemovedPerScannedMax,
      observed_entries: persistentWindow.observedEntries,
      min_entries: persistentWindow.minEntries,
      observed_scanned_files: persistentWindow.observedScannedFiles,
      min_scanned_files: persistentWindow.minScannedFiles,
    },
    combined: {
      state: input.graphQualitySignals.state,
      reason: input.graphQualitySignals.reason,
      degraded_sources: input.graphQualitySignals.degradedSources,
      recommended_action: input.graphQualitySignals.recommendedAction,
    },
  };
}
