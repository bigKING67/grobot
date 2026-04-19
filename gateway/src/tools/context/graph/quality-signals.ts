import { type GraphCacheWindowSummary } from "./cache-window";
import { type readPersistentGraphIndexStatus } from "./persistent-index";

type PersistentGraphIndexStatus = ReturnType<typeof readPersistentGraphIndexStatus>;

export interface GraphCacheWindowDegradation {
  degraded: boolean;
  reason: string;
  thresholdQueryHitRate: number;
  minEntries: number;
  observedEntries: number;
  observedQueryHitRate: number | null;
  observedQueryHit: number;
  observedQueryMiss: number;
}

export interface PersistentGraphWindowDegradation {
  degraded: boolean;
  reason: string;
  thresholdParsedPerScannedMax: number;
  thresholdReusedPerScannedMin: number;
  thresholdRemovedPerScannedMax: number;
  minEntries: number;
  minScannedFiles: number;
  observedEntries: number;
  observedScannedFiles: number;
  observedParsedPerScanned: number | null;
  observedReusedPerScanned: number | null;
  observedRemovedPerScanned: number | null;
}

export interface GraphQualitySignalsSummary {
  state: "healthy" | "watch" | "degraded";
  reason: string;
  degradedSources: string[];
  recommendedAction: string;
}

export function assessGraphCacheWindowDegradation(input: {
  summary: GraphCacheWindowSummary;
  thresholdQueryHitRate: number;
  minEntries: number;
}): GraphCacheWindowDegradation {
  const observedEntries = input.summary.entries;
  const observedQueryHitRate = input.summary.queryHitRate;
  const observedQueryHit = input.summary.queryTotals.hit;
  const observedQueryMiss = input.summary.queryTotals.miss;
  if (observedEntries < input.minEntries) {
    return {
      degraded: false,
      reason: "insufficient_entries",
      thresholdQueryHitRate: input.thresholdQueryHitRate,
      minEntries: input.minEntries,
      observedEntries,
      observedQueryHitRate,
      observedQueryHit,
      observedQueryMiss,
    };
  }
  if (typeof observedQueryHitRate !== "number") {
    return {
      degraded: false,
      reason: "no_query_traffic",
      thresholdQueryHitRate: input.thresholdQueryHitRate,
      minEntries: input.minEntries,
      observedEntries,
      observedQueryHitRate,
      observedQueryHit,
      observedQueryMiss,
    };
  }
  const degraded = observedQueryHitRate < input.thresholdQueryHitRate;
  return {
    degraded,
    reason: degraded ? "query_hit_rate_below_threshold" : "ok",
    thresholdQueryHitRate: input.thresholdQueryHitRate,
    minEntries: input.minEntries,
    observedEntries,
    observedQueryHitRate,
    observedQueryHit,
    observedQueryMiss,
  };
}

export function assessPersistentGraphWindowDegradation(input: {
  status: PersistentGraphIndexStatus;
  thresholdParsedPerScannedMax: number;
  thresholdReusedPerScannedMin: number;
  thresholdRemovedPerScannedMax: number;
  minEntries: number;
  minScannedFiles: number;
}): PersistentGraphWindowDegradation {
  const window = input.status.window;
  if (!window) {
    return {
      degraded: false,
      reason: input.status.enabled ? "window_unavailable" : "persistent_index_disabled",
      thresholdParsedPerScannedMax: input.thresholdParsedPerScannedMax,
      thresholdReusedPerScannedMin: input.thresholdReusedPerScannedMin,
      thresholdRemovedPerScannedMax: input.thresholdRemovedPerScannedMax,
      minEntries: input.minEntries,
      minScannedFiles: input.minScannedFiles,
      observedEntries: 0,
      observedScannedFiles: 0,
      observedParsedPerScanned: null,
      observedReusedPerScanned: null,
      observedRemovedPerScanned: null,
    };
  }
  const observedEntries = window.entries;
  const observedScannedFiles = window.totals.scanned_files;
  const observedParsedPerScanned = window.rates.parsed_per_scanned;
  const observedReusedPerScanned = window.rates.reused_per_scanned;
  const observedRemovedPerScanned = window.rates.removed_per_scanned;
  if (observedEntries < input.minEntries) {
    return {
      degraded: false,
      reason: "insufficient_entries",
      thresholdParsedPerScannedMax: input.thresholdParsedPerScannedMax,
      thresholdReusedPerScannedMin: input.thresholdReusedPerScannedMin,
      thresholdRemovedPerScannedMax: input.thresholdRemovedPerScannedMax,
      minEntries: input.minEntries,
      minScannedFiles: input.minScannedFiles,
      observedEntries,
      observedScannedFiles,
      observedParsedPerScanned,
      observedReusedPerScanned,
      observedRemovedPerScanned,
    };
  }
  if (observedScannedFiles < input.minScannedFiles) {
    return {
      degraded: false,
      reason: "insufficient_scanned_files",
      thresholdParsedPerScannedMax: input.thresholdParsedPerScannedMax,
      thresholdReusedPerScannedMin: input.thresholdReusedPerScannedMin,
      thresholdRemovedPerScannedMax: input.thresholdRemovedPerScannedMax,
      minEntries: input.minEntries,
      minScannedFiles: input.minScannedFiles,
      observedEntries,
      observedScannedFiles,
      observedParsedPerScanned,
      observedReusedPerScanned,
      observedRemovedPerScanned,
    };
  }
  if (
    typeof observedParsedPerScanned !== "number"
    || typeof observedReusedPerScanned !== "number"
    || typeof observedRemovedPerScanned !== "number"
  ) {
    return {
      degraded: false,
      reason: "no_scanned_files",
      thresholdParsedPerScannedMax: input.thresholdParsedPerScannedMax,
      thresholdReusedPerScannedMin: input.thresholdReusedPerScannedMin,
      thresholdRemovedPerScannedMax: input.thresholdRemovedPerScannedMax,
      minEntries: input.minEntries,
      minScannedFiles: input.minScannedFiles,
      observedEntries,
      observedScannedFiles,
      observedParsedPerScanned,
      observedReusedPerScanned,
      observedRemovedPerScanned,
    };
  }
  const reasons: string[] = [];
  if (observedParsedPerScanned > input.thresholdParsedPerScannedMax) {
    reasons.push("parsed_rate_above_threshold");
  }
  if (observedReusedPerScanned < input.thresholdReusedPerScannedMin) {
    reasons.push("reused_rate_below_threshold");
  }
  if (observedRemovedPerScanned > input.thresholdRemovedPerScannedMax) {
    reasons.push("removed_rate_above_threshold");
  }
  return {
    degraded: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join("+") : "ok",
    thresholdParsedPerScannedMax: input.thresholdParsedPerScannedMax,
    thresholdReusedPerScannedMin: input.thresholdReusedPerScannedMin,
    thresholdRemovedPerScannedMax: input.thresholdRemovedPerScannedMax,
    minEntries: input.minEntries,
    minScannedFiles: input.minScannedFiles,
    observedEntries,
    observedScannedFiles,
    observedParsedPerScanned,
    observedReusedPerScanned,
    observedRemovedPerScanned,
  };
}

export function deriveGraphQualitySignals(input: {
  cacheWindow: GraphCacheWindowDegradation;
  persistentWindow: PersistentGraphWindowDegradation;
}): GraphQualitySignalsSummary {
  const degradedSources: string[] = [];
  if (input.cacheWindow.degraded) {
    degradedSources.push("graph_cache_window");
  }
  if (input.persistentWindow.degraded) {
    degradedSources.push("persistent_graph_window");
  }
  if (degradedSources.length >= 2) {
    return {
      state: "degraded",
      reason: "cache_and_persistent_degraded",
      degradedSources,
      recommendedAction: "force_persistent_refresh_and_downshift_graph_fanout",
    };
  }
  if (degradedSources.length === 1) {
    return {
      state: "watch",
      reason: degradedSources[0] === "graph_cache_window"
        ? "cache_degraded_only"
        : "persistent_degraded_only",
      degradedSources,
      recommendedAction: degradedSources[0] === "graph_cache_window"
        ? "increase_query_cache_quality_focus"
        : "investigate_index_churn_or_refresh_interval",
    };
  }
  return {
    state: "healthy",
    reason: "all_graph_signals_ok",
    degradedSources,
    recommendedAction: "none",
  };
}
