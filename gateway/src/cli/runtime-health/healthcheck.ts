import { spawnSync } from "node:child_process";
import {
  asNonNegativeInteger,
  isRecord,
  parseRuntimeJsonRpcResult,
} from "./json-utils";
import {
  type RuntimeCacheStats,
  type RuntimeHealthcheckOptions,
  type RuntimeHealthcheckResult,
  type RuntimeModelCatalogCacheStats,
  type RuntimeOverlapGuardMetrics,
  type RuntimePromptCacheStats,
} from "./types";

function parseRuntimeOverlapGuardMetrics(
  runtimeTools: unknown,
): RuntimeOverlapGuardMetrics | undefined {
  if (!isRecord(runtimeTools) || !isRecord(runtimeTools.overlap_guard)) {
    return undefined;
  }
  const overlap = runtimeTools.overlap_guard;
  const blockedTotal = asNonNegativeInteger(overlap.blocked_total);
  const blockedSearch = asNonNegativeInteger(overlap.blocked_search);
  const blockedSemantic = asNonNegativeInteger(overlap.blocked_semantic);
  const recordedBroadSearch = asNonNegativeInteger(
    overlap.recorded_broad_search,
  );
  const recordedBroadSemantic = asNonNegativeInteger(
    overlap.recorded_broad_semantic,
  );
  const trackedTurnKeys = asNonNegativeInteger(overlap.tracked_turn_keys);
  const trackedTurnOrder = asNonNegativeInteger(overlap.tracked_turn_order);
  const maxTurnKeys = asNonNegativeInteger(overlap.max_turn_keys);
  if (
    blockedTotal == null ||
    blockedSearch == null ||
    blockedSemantic == null ||
    recordedBroadSearch == null ||
    recordedBroadSemantic == null ||
    trackedTurnKeys == null ||
    trackedTurnOrder == null ||
    maxTurnKeys == null
  ) {
    return undefined;
  }
  return {
    blockedTotal,
    blockedSearch,
    blockedSemantic,
    recordedBroadSearch,
    recordedBroadSemantic,
    trackedTurnKeys,
    trackedTurnOrder,
    maxTurnKeys,
  };
}

function parseModelCatalogCacheStats(
  raw: Record<string, unknown> | undefined,
): RuntimeModelCatalogCacheStats | undefined {
  const windowRaw = raw && isRecord(raw.window) ? raw.window : undefined;
  const parsed = raw
    ? {
        cacheEntries: asNonNegativeInteger(raw.cache_entries),
        hitTotal: asNonNegativeInteger(raw.hit_total),
        missTotal: asNonNegativeInteger(raw.miss_total),
        staleTotal: asNonNegativeInteger(raw.stale_total),
        writeTotal: asNonNegativeInteger(raw.write_total),
        window: {
          hitTotal: asNonNegativeInteger(windowRaw?.hit_total),
          missTotal: asNonNegativeInteger(windowRaw?.miss_total),
          staleTotal: asNonNegativeInteger(windowRaw?.stale_total),
          writeTotal: asNonNegativeInteger(windowRaw?.write_total),
        },
      }
    : undefined;
  if (
    parsed?.cacheEntries == null ||
    parsed.hitTotal == null ||
    parsed.missTotal == null ||
    parsed.staleTotal == null ||
    parsed.writeTotal == null ||
    parsed.window.hitTotal == null ||
    parsed.window.missTotal == null ||
    parsed.window.staleTotal == null ||
    parsed.window.writeTotal == null
  ) {
    return undefined;
  }
  return {
    cacheEntries: parsed.cacheEntries,
    hitTotal: parsed.hitTotal,
    missTotal: parsed.missTotal,
    staleTotal: parsed.staleTotal,
    writeTotal: parsed.writeTotal,
    window: {
      hitTotal: parsed.window.hitTotal,
      missTotal: parsed.window.missTotal,
      staleTotal: parsed.window.staleTotal,
      writeTotal: parsed.window.writeTotal,
    },
  };
}

function parsePromptCacheStats(
  raw: Record<string, unknown> | undefined,
): RuntimePromptCacheStats | undefined {
  const windowRaw = raw && isRecord(raw.window) ? raw.window : undefined;
  const parsed = raw
    ? {
        enabledTotal: asNonNegativeInteger(raw.enabled_total),
        hintAttemptedTotal: asNonNegativeInteger(raw.hint_attempted_total),
        hintAppliedTotal: asNonNegativeInteger(raw.hint_applied_total),
        usageObservedTotal: asNonNegativeInteger(raw.usage_observed_total),
        cachedTokensTotal: asNonNegativeInteger(raw.cached_tokens_total),
        window: {
          enabledTotal: asNonNegativeInteger(windowRaw?.enabled_total),
          hintAttemptedTotal: asNonNegativeInteger(
            windowRaw?.hint_attempted_total,
          ),
          hintAppliedTotal: asNonNegativeInteger(windowRaw?.hint_applied_total),
          usageObservedTotal: asNonNegativeInteger(
            windowRaw?.usage_observed_total,
          ),
          cachedTokensTotal: asNonNegativeInteger(
            windowRaw?.cached_tokens_total,
          ),
        },
      }
    : undefined;
  if (
    parsed?.enabledTotal == null ||
    parsed.hintAttemptedTotal == null ||
    parsed.hintAppliedTotal == null ||
    parsed.usageObservedTotal == null ||
    parsed.cachedTokensTotal == null ||
    parsed.window.enabledTotal == null ||
    parsed.window.hintAttemptedTotal == null ||
    parsed.window.hintAppliedTotal == null ||
    parsed.window.usageObservedTotal == null ||
    parsed.window.cachedTokensTotal == null
  ) {
    return undefined;
  }
  return {
    enabledTotal: parsed.enabledTotal,
    hintAttemptedTotal: parsed.hintAttemptedTotal,
    hintAppliedTotal: parsed.hintAppliedTotal,
    usageObservedTotal: parsed.usageObservedTotal,
    cachedTokensTotal: parsed.cachedTokensTotal,
    window: {
      enabledTotal: parsed.window.enabledTotal,
      hintAttemptedTotal: parsed.window.hintAttemptedTotal,
      hintAppliedTotal: parsed.window.hintAppliedTotal,
      usageObservedTotal: parsed.window.usageObservedTotal,
      cachedTokensTotal: parsed.window.cachedTokensTotal,
    },
  };
}

function parseRuntimeCacheStats(cacheStatsRaw: unknown): RuntimeCacheStats | undefined {
  if (!isRecord(cacheStatsRaw)) {
    return undefined;
  }
  const modelCatalogRaw = isRecord(cacheStatsRaw.model_catalog)
    ? cacheStatsRaw.model_catalog
    : undefined;
  const promptCacheRaw = isRecord(cacheStatsRaw.prompt_cache)
    ? cacheStatsRaw.prompt_cache
    : undefined;
  const processSinceUnixMs = asNonNegativeInteger(
    cacheStatsRaw.process_since_unix_ms,
  );
  const windowSinceUnixMs = asNonNegativeInteger(
    cacheStatsRaw.window_since_unix_ms,
  );
  const windowDurationMs = asNonNegativeInteger(
    cacheStatsRaw.window_duration_ms,
  );
  const windowPolicyMs =
    cacheStatsRaw.window_policy_ms == null
      ? null
      : asNonNegativeInteger(cacheStatsRaw.window_policy_ms);
  const modelCatalog = parseModelCatalogCacheStats(modelCatalogRaw);
  const promptCache = parsePromptCacheStats(promptCacheRaw);
  if (
    processSinceUnixMs == null ||
    windowSinceUnixMs == null ||
    windowDurationMs == null ||
    (windowPolicyMs == null && cacheStatsRaw.window_policy_ms != null) ||
    !modelCatalog ||
    !promptCache
  ) {
    return undefined;
  }
  return {
    processSinceUnixMs,
    windowSinceUnixMs,
    windowDurationMs,
    windowPolicyMs,
    modelCatalog,
    promptCache,
  };
}

export function runRuntimeHealthcheck(
  runtimeBinaryPath: string,
  options?: RuntimeHealthcheckOptions,
): RuntimeHealthcheckResult {
  const requestParams: Record<string, unknown> = {};
  if (typeof options?.cacheStatsWindowMs === "number") {
    requestParams.cache_stats_window_ms = options.cacheStatsWindowMs;
  }
  if (options?.resetCacheStatsWindow) {
    requestParams.cache_stats_reset_window = true;
  }
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: "health-1",
    method: "runtime.health",
    params: requestParams,
  });
  const run = spawnSync(runtimeBinaryPath, [], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 4_000,
    maxBuffer: 1_048_576,
  });
  if (run.error) {
    return { ok: false, detail: `spawn_failed: ${String(run.error)}` };
  }
  if (run.status !== 0) {
    return {
      ok: false,
      detail: `exit_status_${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
    };
  }
  const parsed = parseRuntimeJsonRpcResult(String(run.stdout || ""));
  if (!parsed.ok || !parsed.result) {
    return { ok: false, detail: parsed.detail };
  }
  const status = parsed.result.status;
  if (status !== "ok") {
    return { ok: false, detail: `runtime_status=${String(status)}` };
  }
  return {
    ok: true,
    detail: "runtime.health=ok",
    overlapGuardMetrics: parseRuntimeOverlapGuardMetrics(
      parsed.result.runtime_tools,
    ),
    cacheStats: parseRuntimeCacheStats(parsed.result.cache_stats),
  };
}
