import { spawnSync } from "node:child_process";
import type { ToolSurfaceProfile } from "../../../models/types";
import {
  TOOL_SURFACE_POLICY_VERSION,
  type RuntimeToolSurfaceProjectionMode,
} from "../../../tools/runtime/default-enabled-tools";

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

function asStrictNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

const RUNTIME_TOOL_SURFACE_PROFILES: readonly ToolSurfaceProfile[] = [
  "minimal",
  "coding",
  "browser",
  "browser_advanced",
  "context",
  "mcp",
  "full_debug",
];

const RUNTIME_TOOL_SURFACE_PROJECTION_MODES: readonly RuntimeToolSurfaceProjectionMode[] = [
  "slim",
  "advanced",
  "full",
];

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
  window: {
    hitTotal: number;
    missTotal: number;
    staleTotal: number;
    writeTotal: number;
  };
}

export interface RuntimePromptCacheStats {
  enabledTotal: number;
  hintAttemptedTotal: number;
  hintAppliedTotal: number;
  usageObservedTotal: number;
  cachedTokensTotal: number;
  window: {
    enabledTotal: number;
    hintAttemptedTotal: number;
    hintAppliedTotal: number;
    usageObservedTotal: number;
    cachedTokensTotal: number;
  };
}

export interface RuntimeCacheStats {
  processSinceUnixMs: number;
  windowSinceUnixMs: number;
  windowDurationMs: number;
  windowPolicyMs: number | null;
  modelCatalog: RuntimeModelCatalogCacheStats;
  promptCache: RuntimePromptCacheStats;
}

export interface RuntimeToolSurfaceSchemaProfile {
  policyVersion: string;
  profile: ToolSurfaceProfile;
  projectionMode: RuntimeToolSurfaceProjectionMode;
  advancedToolSchema: boolean;
  schemaFingerprint: string;
  toolNames: string[];
  visibleToolCount: number;
  schemaPropertyCount: number;
  fullSchemaPropertyCount: number;
  suppressedSchemaPropertyCount: number;
  perToolPropertyCount: Record<string, number>;
  perToolVisibleArgs: Record<string, string[]>;
  perToolSuppressedArgs: Record<string, string[]>;
}

export interface RuntimeToolRecoveryCatalogRow {
  errorClasses: string[];
  riskClass: string;
  stage: string;
  recommendedNextAction: string;
  recoverable: boolean;
}

export interface RuntimeToolSurfaceSchemaProfilesParseResult {
  profiles: RuntimeToolSurfaceSchemaProfile[];
  rawCount: number;
  invalidReason: string | null;
}

export interface RuntimeToolRecoveryCatalogParseResult {
  rows: RuntimeToolRecoveryCatalogRow[];
  rawCount: number;
  invalidReason: string | null;
}

export interface RuntimeHealthcheckOptions {
  cacheStatsWindowMs?: number;
  resetCacheStatsWindow?: boolean;
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

function dedupeStringArray(items: readonly string[]): string[] {
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

function parseStrictStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      return null;
    }
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

function parseToolSurfaceProfile(value: unknown): ToolSurfaceProfile | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return RUNTIME_TOOL_SURFACE_PROFILES.includes(normalized as ToolSurfaceProfile)
    ? normalized as ToolSurfaceProfile
    : null;
}

function parseProjectionMode(value: unknown): RuntimeToolSurfaceProjectionMode | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return RUNTIME_TOOL_SURFACE_PROJECTION_MODES.includes(normalized as RuntimeToolSurfaceProjectionMode)
    ? normalized as RuntimeToolSurfaceProjectionMode
    : null;
}

function parsePropertyCountMap(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(value)) {
    const toolName = key.trim();
    const count = asStrictNonNegativeInteger(rawCount);
    if (!toolName || count == null) {
      return null;
    }
    result[toolName] = count;
  }
  return result;
}

function parseStringArrayMap(value: unknown): Record<string, string[]> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, string[]> = {};
  for (const [key, rawItems] of Object.entries(value)) {
    const toolName = key.trim();
    const items = parseStrictStringArray(rawItems);
    if (!toolName || items == null) {
      return null;
    }
    result[toolName] = items;
  }
  return result;
}

function recordKeysMatch(record: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((key, index) => key === expected[index]);
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fnv1a32HexFromUtf8(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function buildRuntimeToolSurfaceSchemaProfilesFingerprint(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const payload = stableJsonStringify({
    policy_version: TOOL_SURFACE_POLICY_VERSION,
    profiles: value,
  });
  return `schema_profiles:${fnv1a32HexFromUtf8(payload)}`;
}

export function buildRuntimeToolRecoveryCatalogFingerprint(
  value: unknown,
  policyVersion = TOOL_SURFACE_POLICY_VERSION,
): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const payload = stableJsonStringify({
    policy_version: policyVersion,
    catalog: value,
  });
  return `recovery_catalog:${fnv1a32HexFromUtf8(payload)}`;
}

export function parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics(
  value: unknown,
): RuntimeToolSurfaceSchemaProfilesParseResult {
  if (value == null) {
    return { profiles: [], rawCount: 0, invalidReason: null };
  }
  if (!Array.isArray(value)) {
    return { profiles: [], rawCount: 0, invalidReason: "schema_profiles_not_array" };
  }
  const profiles: RuntimeToolSurfaceSchemaProfile[] = [];
  let invalidRowCount = 0;
  for (const row of value) {
    if (!isRecord(row)) {
      invalidRowCount += 1;
      continue;
    }
    const policyVersion = typeof row.policy_version === "string" ? row.policy_version.trim() : "";
    const profile = parseToolSurfaceProfile(row.profile);
    const projectionMode = parseProjectionMode(row.projection_mode);
    const advancedToolSchema = typeof row.advanced_tool_schema === "boolean"
      ? row.advanced_tool_schema
      : null;
    const schemaFingerprint = typeof row.schema_fingerprint === "string"
      ? row.schema_fingerprint.trim()
      : "";
    const toolNames = dedupeStringArray(normalizeStringArray(row.tool_names));
    const visibleToolCount = asStrictNonNegativeInteger(row.visible_tool_count);
    const schemaPropertyCount = asStrictNonNegativeInteger(row.schema_property_count);
    const fullSchemaPropertyCount = asStrictNonNegativeInteger(row.full_schema_property_count);
    const suppressedSchemaPropertyCount = asStrictNonNegativeInteger(row.suppressed_schema_property_count);
    const perToolPropertyCount = parsePropertyCountMap(row.per_tool_property_count);
    const perToolVisibleArgs = parseStringArrayMap(row.per_tool_visible_args);
    const perToolSuppressedArgs = parseStringArrayMap(row.per_tool_suppressed_args);
    const perToolSum = perToolPropertyCount == null
      ? null
      : toolNames.reduce((total, toolName) => total + (perToolPropertyCount[toolName] ?? Number.NaN), 0);
    const visibleArgSum = perToolVisibleArgs == null
      ? null
      : toolNames.reduce((total, toolName) => total + (perToolVisibleArgs[toolName]?.length ?? Number.NaN), 0);
    const suppressedArgSum = perToolSuppressedArgs == null
      ? null
      : toolNames.reduce((total, toolName) => total + (perToolSuppressedArgs[toolName]?.length ?? Number.NaN), 0);
    const perToolArgsMatchCounts = perToolPropertyCount != null && perToolVisibleArgs != null
      ? toolNames.every((toolName) => perToolPropertyCount[toolName] === perToolVisibleArgs[toolName]?.length)
      : false;
    const perToolMapsHaveExactKeys =
      perToolPropertyCount != null
      && perToolVisibleArgs != null
      && perToolSuppressedArgs != null
      && recordKeysMatch(perToolPropertyCount, toolNames)
      && recordKeysMatch(perToolVisibleArgs, toolNames)
      && recordKeysMatch(perToolSuppressedArgs, toolNames);
    if (
      !policyVersion
      || profile == null
      || projectionMode == null
      || advancedToolSchema == null
      || !schemaFingerprint
      || visibleToolCount == null
      || schemaPropertyCount == null
      || fullSchemaPropertyCount == null
      || suppressedSchemaPropertyCount == null
      || perToolPropertyCount == null
      || perToolVisibleArgs == null
      || perToolSuppressedArgs == null
      || perToolSum == null
      || visibleArgSum == null
      || suppressedArgSum == null
      || !Number.isFinite(perToolSum)
      || !Number.isFinite(visibleArgSum)
      || !Number.isFinite(suppressedArgSum)
      || perToolSum !== schemaPropertyCount
      || visibleArgSum !== schemaPropertyCount
      || suppressedArgSum !== suppressedSchemaPropertyCount
      || !perToolArgsMatchCounts
      || !perToolMapsHaveExactKeys
      || toolNames.length !== visibleToolCount
    ) {
      invalidRowCount += 1;
      continue;
    }
    profiles.push({
      policyVersion,
      profile,
      projectionMode,
      advancedToolSchema,
      schemaFingerprint,
      toolNames,
      visibleToolCount,
      schemaPropertyCount,
      fullSchemaPropertyCount,
      suppressedSchemaPropertyCount,
      perToolPropertyCount,
      perToolVisibleArgs,
      perToolSuppressedArgs,
    });
  }
  return {
    profiles,
    rawCount: value.length,
    invalidReason: invalidRowCount > 0 ? `schema_profiles_invalid_rows:${invalidRowCount}` : null,
  };
}

export function parseRuntimeToolSurfaceSchemaProfiles(value: unknown): RuntimeToolSurfaceSchemaProfile[] {
  return parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics(value).profiles;
}

export function parseRuntimeToolRecoveryCatalogWithDiagnostics(
  value: unknown,
): RuntimeToolRecoveryCatalogParseResult {
  if (value == null) {
    return { rows: [], rawCount: 0, invalidReason: null };
  }
  if (!Array.isArray(value)) {
    return { rows: [], rawCount: 0, invalidReason: "recovery_catalog_not_array" };
  }
  const rows: RuntimeToolRecoveryCatalogRow[] = [];
  let invalidRowCount = 0;
  for (const item of value) {
    if (!isRecord(item)) {
      invalidRowCount += 1;
      continue;
    }
    const errorClasses = parseStrictStringArray(item.error_classes);
    const riskClass = typeof item.risk_class === "string" ? item.risk_class.trim() : "";
    const stage = typeof item.stage === "string" ? item.stage.trim() : "";
    const recommendedNextAction =
      typeof item.recommended_next_action === "string"
        ? item.recommended_next_action.trim()
        : "";
    const recoverable = typeof item.recoverable === "boolean" ? item.recoverable : null;
    if (
      errorClasses == null
      || errorClasses.length === 0
      || !riskClass
      || !stage
      || !recommendedNextAction
      || recoverable == null
    ) {
      invalidRowCount += 1;
      continue;
    }
    rows.push({
      errorClasses,
      riskClass,
      stage,
      recommendedNextAction,
      recoverable,
    });
  }
  return {
    rows,
    rawCount: value.length,
    invalidReason: invalidRowCount > 0 ? `recovery_catalog_invalid_rows:${invalidRowCount}` : null,
  };
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

export function runRuntimeHealthcheck(
  runtimeBinaryPath: string,
  options?: RuntimeHealthcheckOptions,
): {
  ok: boolean;
  detail: string;
  overlapGuardMetrics?: RuntimeOverlapGuardMetrics;
  cacheStats?: RuntimeCacheStats;
} {
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
    const modelCatalogWindowRaw = modelCatalogRaw && isRecord(modelCatalogRaw.window)
      ? modelCatalogRaw.window
      : undefined;
    const promptCacheWindowRaw = promptCacheRaw && isRecord(promptCacheRaw.window)
      ? promptCacheRaw.window
      : undefined;
    const processSinceUnixMs = asNonNegativeInteger(cacheStatsRaw.process_since_unix_ms);
    const windowSinceUnixMs = asNonNegativeInteger(cacheStatsRaw.window_since_unix_ms);
    const windowDurationMs = asNonNegativeInteger(cacheStatsRaw.window_duration_ms);
    const windowPolicyMs = cacheStatsRaw.window_policy_ms == null
      ? null
      : asNonNegativeInteger(cacheStatsRaw.window_policy_ms);
    const modelCatalog = modelCatalogRaw
      ? {
          cacheEntries: asNonNegativeInteger(modelCatalogRaw.cache_entries),
          hitTotal: asNonNegativeInteger(modelCatalogRaw.hit_total),
          missTotal: asNonNegativeInteger(modelCatalogRaw.miss_total),
          staleTotal: asNonNegativeInteger(modelCatalogRaw.stale_total),
          writeTotal: asNonNegativeInteger(modelCatalogRaw.write_total),
          window: {
            hitTotal: asNonNegativeInteger(modelCatalogWindowRaw?.hit_total),
            missTotal: asNonNegativeInteger(modelCatalogWindowRaw?.miss_total),
            staleTotal: asNonNegativeInteger(modelCatalogWindowRaw?.stale_total),
            writeTotal: asNonNegativeInteger(modelCatalogWindowRaw?.write_total),
          },
        }
      : undefined;
    const promptCache = promptCacheRaw
      ? {
          enabledTotal: asNonNegativeInteger(promptCacheRaw.enabled_total),
          hintAttemptedTotal: asNonNegativeInteger(promptCacheRaw.hint_attempted_total),
          hintAppliedTotal: asNonNegativeInteger(promptCacheRaw.hint_applied_total),
          usageObservedTotal: asNonNegativeInteger(promptCacheRaw.usage_observed_total),
          cachedTokensTotal: asNonNegativeInteger(promptCacheRaw.cached_tokens_total),
          window: {
            enabledTotal: asNonNegativeInteger(promptCacheWindowRaw?.enabled_total),
            hintAttemptedTotal: asNonNegativeInteger(promptCacheWindowRaw?.hint_attempted_total),
            hintAppliedTotal: asNonNegativeInteger(promptCacheWindowRaw?.hint_applied_total),
            usageObservedTotal: asNonNegativeInteger(promptCacheWindowRaw?.usage_observed_total),
            cachedTokensTotal: asNonNegativeInteger(promptCacheWindowRaw?.cached_tokens_total),
          },
        }
      : undefined;
    if (
      processSinceUnixMs != null
      && windowSinceUnixMs != null
      && windowDurationMs != null
      && (windowPolicyMs == null || windowPolicyMs >= 0)
      && modelCatalog?.cacheEntries != null
      && modelCatalog.hitTotal != null
      && modelCatalog.missTotal != null
      && modelCatalog.staleTotal != null
      && modelCatalog.writeTotal != null
      && modelCatalog.window.hitTotal != null
      && modelCatalog.window.missTotal != null
      && modelCatalog.window.staleTotal != null
      && modelCatalog.window.writeTotal != null
      && promptCache?.enabledTotal != null
      && promptCache.hintAttemptedTotal != null
      && promptCache.hintAppliedTotal != null
      && promptCache.usageObservedTotal != null
      && promptCache.cachedTokensTotal != null
      && promptCache.window.enabledTotal != null
      && promptCache.window.hintAttemptedTotal != null
      && promptCache.window.hintAppliedTotal != null
      && promptCache.window.usageObservedTotal != null
      && promptCache.window.cachedTokensTotal != null
    ) {
      cacheStats = {
        processSinceUnixMs,
        windowSinceUnixMs,
        windowDurationMs,
        windowPolicyMs,
        modelCatalog: {
          cacheEntries: modelCatalog.cacheEntries,
          hitTotal: modelCatalog.hitTotal,
          missTotal: modelCatalog.missTotal,
          staleTotal: modelCatalog.staleTotal,
          writeTotal: modelCatalog.writeTotal,
          window: {
            hitTotal: modelCatalog.window.hitTotal,
            missTotal: modelCatalog.window.missTotal,
            staleTotal: modelCatalog.window.staleTotal,
            writeTotal: modelCatalog.window.writeTotal,
          },
        },
        promptCache: {
          enabledTotal: promptCache.enabledTotal,
          hintAttemptedTotal: promptCache.hintAttemptedTotal,
          hintAppliedTotal: promptCache.hintAppliedTotal,
          usageObservedTotal: promptCache.usageObservedTotal,
          cachedTokensTotal: promptCache.cachedTokensTotal,
          window: {
            enabledTotal: promptCache.window.enabledTotal,
            hintAttemptedTotal: promptCache.window.hintAttemptedTotal,
            hintAppliedTotal: promptCache.window.hintAppliedTotal,
            usageObservedTotal: promptCache.window.usageObservedTotal,
            cachedTokensTotal: promptCache.window.cachedTokensTotal,
          },
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
  toolRecoveryPolicyVersion: string | null;
  toolRecoveryCatalogFingerprint: string | null;
  toolRecoveryActions: string[];
  toolRecoveryCatalog: RuntimeToolRecoveryCatalogRow[];
  toolSurfaceSchemaProfilesFingerprint: string | null;
  toolSurfaceSchemaProfiles: RuntimeToolSurfaceSchemaProfile[];
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
      toolRecoveryPolicyVersion: null,
      toolRecoveryCatalogFingerprint: null,
      toolRecoveryActions: [],
      toolRecoveryCatalog: [],
      toolSurfaceSchemaProfilesFingerprint: null,
      toolSurfaceSchemaProfiles: [],
    };
  }
  if (run.status !== 0) {
    return {
      ok: false,
      detail: `exit_status_${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
      toolNames: [],
      defaultEnabledTools: [],
      manifestFingerprint: buildToolsManifestFingerprint([], []),
      toolRecoveryPolicyVersion: null,
      toolRecoveryCatalogFingerprint: null,
      toolRecoveryActions: [],
      toolRecoveryCatalog: [],
      toolSurfaceSchemaProfilesFingerprint: null,
      toolSurfaceSchemaProfiles: [],
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
      toolRecoveryPolicyVersion: null,
      toolRecoveryCatalogFingerprint: null,
      toolRecoveryActions: [],
      toolRecoveryCatalog: [],
      toolSurfaceSchemaProfilesFingerprint: null,
      toolSurfaceSchemaProfiles: [],
    };
  }

  const defaultEnabledTools = dedupeStringArray(normalizeStringArray(parsed.result.default_enabled_tools));
  const toolRecoveryPolicyVersion =
    typeof parsed.result.tool_recovery_policy_version === "string"
      && parsed.result.tool_recovery_policy_version.trim().length > 0
      ? parsed.result.tool_recovery_policy_version.trim()
      : null;
  const toolRecoveryCatalogFingerprint =
    typeof parsed.result.tool_recovery_catalog_fingerprint === "string"
      && parsed.result.tool_recovery_catalog_fingerprint.trim().length > 0
      ? parsed.result.tool_recovery_catalog_fingerprint.trim()
      : null;
  const toolRecoveryActions = dedupeStringArray(normalizeStringArray(parsed.result.tool_recovery_actions));
  const recoveryCatalogParse = parseRuntimeToolRecoveryCatalogWithDiagnostics(
    parsed.result.tool_recovery_catalog,
  );
  const recoveryCatalogFingerprintFromPayload = buildRuntimeToolRecoveryCatalogFingerprint(
    parsed.result.tool_recovery_catalog,
    toolRecoveryPolicyVersion ?? TOOL_SURFACE_POLICY_VERSION,
  );
  const toolRecoveryCatalog = recoveryCatalogParse.rows;
  const toolSurfaceSchemaProfilesFingerprint =
    typeof parsed.result.tool_surface_schema_profiles_fingerprint === "string"
      && parsed.result.tool_surface_schema_profiles_fingerprint.trim().length > 0
      ? parsed.result.tool_surface_schema_profiles_fingerprint.trim()
      : null;
  const schemaProfilesParse = parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics(
    parsed.result.tool_surface_schema_profiles,
  );
  const schemaProfilesFingerprintFromPayload = buildRuntimeToolSurfaceSchemaProfilesFingerprint(
    parsed.result.tool_surface_schema_profiles,
  );
  const toolSurfaceSchemaProfiles = schemaProfilesParse.profiles;
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
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (defaultEnabledTools.length === 0) {
    return {
      ok: false,
      detail: "runtime_tools_describe_missing_default_enabled_tools",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
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
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (recoveryCatalogParse.invalidReason != null) {
    return {
      ok: false,
      detail: `runtime_tools_describe_invalid_recovery_catalog:${recoveryCatalogParse.invalidReason}`,
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (!toolRecoveryPolicyVersion && (toolRecoveryCatalog.length > 0 || toolRecoveryActions.length > 0)) {
    return {
      ok: false,
      detail: "runtime_tools_describe_missing_recovery_policy_version",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (toolRecoveryCatalogFingerprint && toolRecoveryCatalog.length === 0) {
    return {
      ok: false,
      detail: "runtime_tools_describe_missing_recovery_catalog",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (!toolRecoveryCatalogFingerprint && toolRecoveryCatalog.length > 0) {
    return {
      ok: false,
      detail: "runtime_tools_describe_missing_recovery_catalog_fingerprint",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (
    toolRecoveryCatalogFingerprint
    && recoveryCatalogFingerprintFromPayload
    && toolRecoveryCatalogFingerprint !== recoveryCatalogFingerprintFromPayload
  ) {
    return {
      ok: false,
      detail:
        `runtime_tools_describe_recovery_catalog_fingerprint_mismatch:reported=${toolRecoveryCatalogFingerprint}`
        + `:computed=${recoveryCatalogFingerprintFromPayload}`,
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (toolRecoveryActions.length === 0) {
    return {
      ok: false,
      detail: "runtime_tools_describe_missing_recovery_actions",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  const catalogActionSet = new Set(toolRecoveryCatalog.map((row) => row.recommendedNextAction));
  const unknownRecoveryActions = toolRecoveryActions.filter((action) => !catalogActionSet.has(action));
  const missingRecoveryActions = [...catalogActionSet].filter((action) => !toolRecoveryActions.includes(action));
  if (missingRecoveryActions.length > 0) {
    return {
      ok: false,
      detail: `runtime_tools_describe_missing_recovery_actions:${missingRecoveryActions.join(",")}`,
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (unknownRecoveryActions.length > 0) {
    return {
      ok: false,
      detail: `runtime_tools_describe_invalid_recovery_actions:${unknownRecoveryActions.join(",")}`,
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (schemaProfilesParse.invalidReason != null) {
    return {
      ok: false,
      detail: `runtime_tools_describe_invalid_schema_profiles:${schemaProfilesParse.invalidReason}`,
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (toolSurfaceSchemaProfilesFingerprint && toolSurfaceSchemaProfiles.length === 0) {
    return {
      ok: false,
      detail: "runtime_tools_describe_missing_schema_profiles",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (!toolSurfaceSchemaProfilesFingerprint && toolSurfaceSchemaProfiles.length > 0) {
    return {
      ok: false,
      detail: "runtime_tools_describe_missing_schema_profiles_fingerprint",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  if (
    toolSurfaceSchemaProfilesFingerprint
    && schemaProfilesFingerprintFromPayload
    && toolSurfaceSchemaProfilesFingerprint !== schemaProfilesFingerprintFromPayload
  ) {
    return {
      ok: false,
      detail:
        `runtime_tools_describe_schema_profiles_fingerprint_mismatch:reported=${toolSurfaceSchemaProfilesFingerprint}`
        + `:computed=${schemaProfilesFingerprintFromPayload}`,
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
      toolRecoveryPolicyVersion,
      toolRecoveryCatalogFingerprint,
      toolRecoveryActions,
      toolRecoveryCatalog,
      toolSurfaceSchemaProfilesFingerprint,
      toolSurfaceSchemaProfiles,
    };
  }
  return {
    ok: true,
    detail: "runtime.tools.describe=ok",
    toolNames: uniqueToolNames,
    defaultEnabledTools,
    manifestFingerprint,
    toolRecoveryPolicyVersion,
    toolRecoveryCatalogFingerprint,
    toolRecoveryActions,
    toolRecoveryCatalog,
    toolSurfaceSchemaProfilesFingerprint,
    toolSurfaceSchemaProfiles,
  };
}
