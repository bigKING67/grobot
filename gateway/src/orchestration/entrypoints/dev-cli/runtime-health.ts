import { spawnSync } from "node:child_process";

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

export function resolveRuntimeBinaryPath(): string {
  const envPath = process.env.GROBOT_RUNTIME_BIN;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return envPath.trim();
  }
  const repoRoot = process.env.GROBOT_TS_DEV_REPO_ROOT;
  if (typeof repoRoot === "string" && repoRoot.trim().length > 0) {
    return `${removeTrailingSlashes(repoRoot)}/runtime/target/debug/grobot-runtime`;
  }
  return `${process.cwd()}/runtime/target/debug/grobot-runtime`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return null;
  }
  return normalized;
}

export interface RuntimeOverlapGuardMetrics {
  blockedTotal: number;
  blockedSearch: number;
  blockedSemantic: number;
  recordedBroadSearch: number;
  recordedBroadSemantic: number;
  trackedTurnKeys: number;
  trackedTurnOrder: number;
  maxTurnKeys: number;
}

export interface RuntimeModelCatalogCacheStats {
  cacheEntries: number;
  hitTotal: number;
  missTotal: number;
  staleTotal: number;
  writeTotal: number;
}

export interface RuntimePromptCacheStats {
  enabledTotal: number;
  hintAttemptedTotal: number;
  hintAppliedTotal: number;
  usageObservedTotal: number;
  cachedTokensTotal: number;
}

export interface RuntimeCacheStats {
  modelCatalog: RuntimeModelCatalogCacheStats;
  promptCache: RuntimePromptCacheStats;
}

function parseRuntimeJsonRpcResult(stdout: string): {
  ok: boolean;
  detail: string;
  result?: Record<string, unknown>;
} {
  const firstLine = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return { ok: false, detail: "empty_stdout" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(firstLine);
  } catch (error) {
    return { ok: false, detail: `json_parse_failed: ${String(error)}` };
  }
  if (!isRecord(payload)) {
    return { ok: false, detail: "invalid_json_payload" };
  }
  if (isRecord(payload.error)) {
    const errorCode = payload.error.code;
    const errorMessage = payload.error.message;
    return {
      ok: false,
      detail: `jsonrpc_error code=${String(errorCode)} message=${String(errorMessage)}`,
    };
  }
  const result = payload.result;
  if (!isRecord(result)) {
    return { ok: false, detail: "missing_result" };
  }
  return { ok: true, detail: "ok", result };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    rows.push(normalized);
  }
  return rows;
}

function dedupeStringArray(items: string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

export function buildToolsManifestFingerprint(toolNames: string[], defaultEnabledTools: string[]): string {
  const normalizedToolNames = [...dedupeStringArray(toolNames)].sort();
  const normalizedDefaultEnabledTools = [...dedupeStringArray(defaultEnabledTools)].sort();
  const payload = JSON.stringify({
    tool_names: normalizedToolNames,
    default_enabled_tools: normalizedDefaultEnabledTools,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function runRuntimeHealthcheck(runtimeBinaryPath: string): {
  ok: boolean;
  detail: string;
  overlapGuardMetrics?: RuntimeOverlapGuardMetrics;
  cacheStats?: RuntimeCacheStats;
} {
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: "health-1",
    method: "runtime.health",
    params: {},
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
  let overlapGuardMetrics: RuntimeOverlapGuardMetrics | undefined;
  let cacheStats: RuntimeCacheStats | undefined;
  const runtimeTools = parsed.result.runtime_tools;
  if (isRecord(runtimeTools) && isRecord(runtimeTools.overlap_guard)) {
    const overlap = runtimeTools.overlap_guard;
    const blockedTotal = asNonNegativeInteger(overlap.blocked_total);
    const blockedSearch = asNonNegativeInteger(overlap.blocked_search);
    const blockedSemantic = asNonNegativeInteger(overlap.blocked_semantic);
    const recordedBroadSearch = asNonNegativeInteger(overlap.recorded_broad_search);
    const recordedBroadSemantic = asNonNegativeInteger(overlap.recorded_broad_semantic);
    const trackedTurnKeys = asNonNegativeInteger(overlap.tracked_turn_keys);
    const trackedTurnOrder = asNonNegativeInteger(overlap.tracked_turn_order);
    const maxTurnKeys = asNonNegativeInteger(overlap.max_turn_keys);
    if (
      blockedTotal != null
      && blockedSearch != null
      && blockedSemantic != null
      && recordedBroadSearch != null
      && recordedBroadSemantic != null
      && trackedTurnKeys != null
      && trackedTurnOrder != null
      && maxTurnKeys != null
    ) {
      overlapGuardMetrics = {
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
  }
  const cacheStatsRaw = parsed.result.cache_stats;
  if (isRecord(cacheStatsRaw)) {
    const modelCatalogRaw = isRecord(cacheStatsRaw.model_catalog)
      ? cacheStatsRaw.model_catalog
      : undefined;
    const promptCacheRaw = isRecord(cacheStatsRaw.prompt_cache)
      ? cacheStatsRaw.prompt_cache
      : undefined;
    const modelCatalog = modelCatalogRaw
      ? {
          cacheEntries: asNonNegativeInteger(modelCatalogRaw.cache_entries),
          hitTotal: asNonNegativeInteger(modelCatalogRaw.hit_total),
          missTotal: asNonNegativeInteger(modelCatalogRaw.miss_total),
          staleTotal: asNonNegativeInteger(modelCatalogRaw.stale_total),
          writeTotal: asNonNegativeInteger(modelCatalogRaw.write_total),
        }
      : undefined;
    const promptCache = promptCacheRaw
      ? {
          enabledTotal: asNonNegativeInteger(promptCacheRaw.enabled_total),
          hintAttemptedTotal: asNonNegativeInteger(promptCacheRaw.hint_attempted_total),
          hintAppliedTotal: asNonNegativeInteger(promptCacheRaw.hint_applied_total),
          usageObservedTotal: asNonNegativeInteger(promptCacheRaw.usage_observed_total),
          cachedTokensTotal: asNonNegativeInteger(promptCacheRaw.cached_tokens_total),
        }
      : undefined;
    if (
      modelCatalog?.cacheEntries != null
      && modelCatalog.hitTotal != null
      && modelCatalog.missTotal != null
      && modelCatalog.staleTotal != null
      && modelCatalog.writeTotal != null
      && promptCache?.enabledTotal != null
      && promptCache.hintAttemptedTotal != null
      && promptCache.hintAppliedTotal != null
      && promptCache.usageObservedTotal != null
      && promptCache.cachedTokensTotal != null
    ) {
      cacheStats = {
        modelCatalog: {
          cacheEntries: modelCatalog.cacheEntries,
          hitTotal: modelCatalog.hitTotal,
          missTotal: modelCatalog.missTotal,
          staleTotal: modelCatalog.staleTotal,
          writeTotal: modelCatalog.writeTotal,
        },
        promptCache: {
          enabledTotal: promptCache.enabledTotal,
          hintAttemptedTotal: promptCache.hintAttemptedTotal,
          hintAppliedTotal: promptCache.hintAppliedTotal,
          usageObservedTotal: promptCache.usageObservedTotal,
          cachedTokensTotal: promptCache.cachedTokensTotal,
        },
      };
    }
  }
  return {
    ok: true,
    detail: "runtime.health=ok",
    overlapGuardMetrics,
    cacheStats,
  };
}

export function runRuntimeToolsDescribe(runtimeBinaryPath: string): {
  ok: boolean;
  detail: string;
  toolNames: string[];
  defaultEnabledTools: string[];
  manifestFingerprint: string;
} {
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: "tools-describe-1",
    method: "runtime.tools.describe",
    params: {},
  });
  const run = spawnSync(runtimeBinaryPath, [], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 4_000,
    maxBuffer: 1_048_576,
  });
    if (run.error) {
      return {
        ok: false,
        detail: `spawn_failed: ${String(run.error)}`,
        toolNames: [],
        defaultEnabledTools: [],
        manifestFingerprint: buildToolsManifestFingerprint([], []),
      };
    }
    if (run.status !== 0) {
      return {
        ok: false,
        detail: `exit_status_${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
        toolNames: [],
        defaultEnabledTools: [],
        manifestFingerprint: buildToolsManifestFingerprint([], []),
      };
    }
  const parsed = parseRuntimeJsonRpcResult(String(run.stdout || ""));
    if (!parsed.ok || !parsed.result) {
      return {
        ok: false,
        detail: parsed.detail,
        toolNames: [],
        defaultEnabledTools: [],
        manifestFingerprint: buildToolsManifestFingerprint([], []),
      };
    }

    const defaultEnabledTools = dedupeStringArray(normalizeStringArray(parsed.result.default_enabled_tools));
    const rawTools = parsed.result.tools;
    const toolNames: string[] = [];
  if (Array.isArray(rawTools)) {
    for (const row of rawTools) {
      if (!isRecord(row) || !isRecord(row.function)) {
        continue;
      }
      const name = row.function.name;
      if (typeof name !== "string") {
        continue;
      }
      const normalized = name.trim();
      if (!normalized) {
        continue;
      }
        toolNames.push(normalized);
      }
    }
    const uniqueToolNames = dedupeStringArray(toolNames);
    const manifestFingerprint = buildToolsManifestFingerprint(uniqueToolNames, defaultEnabledTools);
    if (uniqueToolNames.length === 0) {
      return {
        ok: false,
        detail: "runtime_tools_describe_missing_tools",
        toolNames: uniqueToolNames,
        defaultEnabledTools,
        manifestFingerprint,
      };
    }
    if (defaultEnabledTools.length === 0) {
      return {
        ok: false,
        detail: "runtime_tools_describe_missing_default_enabled_tools",
        toolNames: uniqueToolNames,
        defaultEnabledTools,
        manifestFingerprint,
      };
    }
    const toolNameSet = new Set(uniqueToolNames);
    const unknownDefaultEnabled = defaultEnabledTools.filter((toolName) => !toolNameSet.has(toolName));
    if (unknownDefaultEnabled.length > 0) {
      return {
        ok: false,
        detail: `runtime_tools_describe_invalid_default_enabled_tools:${unknownDefaultEnabled.join(",")}`,
        toolNames: uniqueToolNames,
        defaultEnabledTools,
        manifestFingerprint,
      };
    }
    return {
      ok: true,
      detail: "runtime.tools.describe=ok",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
    };
  }
