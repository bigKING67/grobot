import type {
  RuntimeCacheStats,
  RuntimeOverlapGuardMetrics,
} from "../runtime-health";

export interface RuntimeHealthStatus {
  ok: boolean;
  detail: string;
  overlapGuardMetrics?: RuntimeOverlapGuardMetrics;
  cacheStats?: RuntimeCacheStats;
}

export function serializeRuntimeHealthStatus(
  runtimeHealth: RuntimeHealthStatus | undefined,
  runtimeBinaryPath: string | undefined,
): Record<string, unknown> | null {
  if (!runtimeHealth || !runtimeBinaryPath) {
    return null;
  }
  return {
    ok: runtimeHealth.ok,
    detail: runtimeHealth.detail,
    binary_path: runtimeBinaryPath,
    overlap_guard_metrics: runtimeHealth.overlapGuardMetrics
      ? {
          blocked_total: runtimeHealth.overlapGuardMetrics.blockedTotal,
          blocked_search: runtimeHealth.overlapGuardMetrics.blockedSearch,
          blocked_semantic: runtimeHealth.overlapGuardMetrics.blockedSemantic,
          recorded_broad_search: runtimeHealth.overlapGuardMetrics.recordedBroadSearch,
          recorded_broad_semantic: runtimeHealth.overlapGuardMetrics.recordedBroadSemantic,
          tracked_turn_keys: runtimeHealth.overlapGuardMetrics.trackedTurnKeys,
          tracked_turn_order: runtimeHealth.overlapGuardMetrics.trackedTurnOrder,
          max_turn_keys: runtimeHealth.overlapGuardMetrics.maxTurnKeys,
        }
      : null,
    cache_stats: runtimeHealth.cacheStats
      ? serializeRuntimeCacheStats(runtimeHealth.cacheStats)
      : null,
  };
}

export function resolveRuntimeCacheStatsLocation(
  runtimeHealth: RuntimeHealthStatus | undefined,
): string | null {
  return runtimeHealth?.cacheStats ? "runtime_health.cache_stats" : null;
}

export function formatRuntimeHealthStatusLines(
  runtimeHealth: RuntimeHealthStatus | undefined,
  runtimeBinaryPath: string | undefined,
): string[] {
  if (!runtimeHealth || !runtimeBinaryPath) {
    return [];
  }
  const lines = [
    `runtime_health: ${runtimeHealth.ok ? "ok" : "warn"} (${runtimeBinaryPath}) ${runtimeHealth.detail}`,
  ];
  if (runtimeHealth.overlapGuardMetrics) {
    lines.push(
      `runtime_overlap_guard: blocked_total=${runtimeHealth.overlapGuardMetrics.blockedTotal} blocked_search=${runtimeHealth.overlapGuardMetrics.blockedSearch} blocked_semantic=${runtimeHealth.overlapGuardMetrics.blockedSemantic} recorded_broad_search=${runtimeHealth.overlapGuardMetrics.recordedBroadSearch} recorded_broad_semantic=${runtimeHealth.overlapGuardMetrics.recordedBroadSemantic} tracked_turn_keys=${runtimeHealth.overlapGuardMetrics.trackedTurnKeys}/${runtimeHealth.overlapGuardMetrics.maxTurnKeys}`,
    );
  }
  if (runtimeHealth.cacheStats) {
    lines.push("cache_stats_location: runtime_health.cache_stats");
    lines.push(
      `runtime_cache_window: since_unix_ms=${runtimeHealth.cacheStats.windowSinceUnixMs} duration_ms=${runtimeHealth.cacheStats.windowDurationMs} policy_ms=${runtimeHealth.cacheStats.windowPolicyMs ?? "<none>"}`,
    );
    lines.push(
      `runtime_cache_model_catalog: entries=${runtimeHealth.cacheStats.modelCatalog.cacheEntries} hit_total=${runtimeHealth.cacheStats.modelCatalog.hitTotal} miss_total=${runtimeHealth.cacheStats.modelCatalog.missTotal} stale_total=${runtimeHealth.cacheStats.modelCatalog.staleTotal} write_total=${runtimeHealth.cacheStats.modelCatalog.writeTotal} window_hit_total=${runtimeHealth.cacheStats.modelCatalog.window.hitTotal} window_miss_total=${runtimeHealth.cacheStats.modelCatalog.window.missTotal} window_stale_total=${runtimeHealth.cacheStats.modelCatalog.window.staleTotal} window_write_total=${runtimeHealth.cacheStats.modelCatalog.window.writeTotal}`,
    );
    lines.push(
      `runtime_cache_prompt: enabled_total=${runtimeHealth.cacheStats.promptCache.enabledTotal} hint_attempted_total=${runtimeHealth.cacheStats.promptCache.hintAttemptedTotal} hint_applied_total=${runtimeHealth.cacheStats.promptCache.hintAppliedTotal} usage_observed_total=${runtimeHealth.cacheStats.promptCache.usageObservedTotal} cached_tokens_total=${runtimeHealth.cacheStats.promptCache.cachedTokensTotal} window_enabled_total=${runtimeHealth.cacheStats.promptCache.window.enabledTotal} window_hint_attempted_total=${runtimeHealth.cacheStats.promptCache.window.hintAttemptedTotal} window_hint_applied_total=${runtimeHealth.cacheStats.promptCache.window.hintAppliedTotal} window_usage_observed_total=${runtimeHealth.cacheStats.promptCache.window.usageObservedTotal} window_cached_tokens_total=${runtimeHealth.cacheStats.promptCache.window.cachedTokensTotal}`,
    );
  }
  return lines;
}

function serializeRuntimeCacheStats(cacheStats: RuntimeCacheStats): Record<string, unknown> {
  return {
    process_since_unix_ms: cacheStats.processSinceUnixMs,
    window_since_unix_ms: cacheStats.windowSinceUnixMs,
    window_duration_ms: cacheStats.windowDurationMs,
    window_policy_ms: cacheStats.windowPolicyMs,
    model_catalog: {
      cache_entries: cacheStats.modelCatalog.cacheEntries,
      hit_total: cacheStats.modelCatalog.hitTotal,
      miss_total: cacheStats.modelCatalog.missTotal,
      stale_total: cacheStats.modelCatalog.staleTotal,
      write_total: cacheStats.modelCatalog.writeTotal,
      window: {
        hit_total: cacheStats.modelCatalog.window.hitTotal,
        miss_total: cacheStats.modelCatalog.window.missTotal,
        stale_total: cacheStats.modelCatalog.window.staleTotal,
        write_total: cacheStats.modelCatalog.window.writeTotal,
      },
    },
    prompt_cache: {
      enabled_total: cacheStats.promptCache.enabledTotal,
      hint_attempted_total: cacheStats.promptCache.hintAttemptedTotal,
      hint_applied_total: cacheStats.promptCache.hintAppliedTotal,
      usage_observed_total: cacheStats.promptCache.usageObservedTotal,
      cached_tokens_total: cacheStats.promptCache.cachedTokensTotal,
      window: {
        enabled_total: cacheStats.promptCache.window.enabledTotal,
        hint_attempted_total: cacheStats.promptCache.window.hintAttemptedTotal,
        hint_applied_total: cacheStats.promptCache.window.hintAppliedTotal,
        usage_observed_total: cacheStats.promptCache.window.usageObservedTotal,
        cached_tokens_total: cacheStats.promptCache.window.cachedTokensTotal,
      },
    },
  };
}
