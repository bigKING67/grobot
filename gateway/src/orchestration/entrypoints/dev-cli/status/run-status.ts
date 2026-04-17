import { readFileSync } from "node:fs";
import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import {
  probeProviderModels,
  readProviderPoolFromToml,
  readProviderSnapshotFromToml,
} from "../provider-probe";
import {
  buildToolsManifestFingerprint,
  resolveRuntimeBinaryPath,
  runRuntimeHealthcheck,
  runRuntimeToolsDescribe,
} from "../runtime-health";
import { maskSecret } from "../services/redaction";
import { buildDefaultRuntimeEnabledTools } from "../../../../tools/runtime/default-enabled-tools";
import {
  readContextGraphCacheStats,
  readGraphCacheWindowSummary,
  resolveContextEngineConfig,
} from "../../../../tools/context";
import { type RuntimeModelConfig } from "../../../../models/types";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectStateRoot,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import {
  findSessionRecord,
  normalizeSessionRegistryPayload,
  sessionRegistryFilePath,
  type SessionProviderRuntimeState,
} from "../start/session-registry";
import {
  parsePlatform,
  parseScope,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "../start/session-options";

function stripInlineComment(rawLine: string): string {
  const hashIndex = rawLine.indexOf("#");
  if (hashIndex < 0) {
    return rawLine;
  }
  return rawLine.slice(0, hashIndex);
}

function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const content = trimmed.slice(1, -1).trim();
  if (content.length === 0) {
    return [];
  }
  const items: string[] = [];
  for (const part of content.split(",")) {
    const value = part.trim();
    if (!value.startsWith("\"") || !value.endsWith("\"")) {
      continue;
    }
    const normalized = value.slice(1, -1).trim();
    if (normalized.length === 0) {
      continue;
    }
    items.push(normalized);
  }
  return items;
}

function readToolsAllowlistFromProjectToml(projectTomlPath?: string): string[] {
  if (!projectTomlPath) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  let inToolsSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inToolsSection = sectionMatch[1] === "tools";
      continue;
    }
    if (!inToolsSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch || kvMatch[1] !== "allow") {
      continue;
    }
    return parseTomlStringArray(kvMatch[2]);
  }
  return [];
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseRequiredPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseOptionalPositiveInt(value);
  if (typeof parsed !== "number") {
    return fallback;
  }
  return parsed;
}

function parseOptionalRatio(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return undefined;
  }
  return parsed;
}

function parseRequiredRatio(value: string | undefined, fallback: number): number {
  const parsed = parseOptionalRatio(value);
  if (typeof parsed !== "number") {
    return fallback;
  }
  return parsed;
}

function readGraphCacheCounter(
  stats: Record<string, { hit?: number; miss?: number; write?: number; evict?: number }>,
  bucket: string,
): {
  hit: number;
  miss: number;
  write: number;
  evict: number;
} {
  const row = stats[bucket];
  return {
    hit: Number.isFinite(row?.hit) ? Number(row?.hit) : 0,
    miss: Number.isFinite(row?.miss) ? Number(row?.miss) : 0,
    write: Number.isFinite(row?.write) ? Number(row?.write) : 0,
    evict: Number.isFinite(row?.evict) ? Number(row?.evict) : 0,
  };
}

interface GraphCacheWindowDegradation {
  degraded: boolean;
  reason: string;
  thresholdQueryHitRate: number;
  minEntries: number;
  observedEntries: number;
  observedQueryHitRate: number | null;
  observedQueryHit: number;
  observedQueryMiss: number;
}

function assessGraphCacheWindowDegradation(input: {
  summary: ReturnType<typeof readGraphCacheWindowSummary>;
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

function resolveContextEngineRuntimeModelConfig(input: {
  providerSnapshot?: {
    provider?: {
      providerKind?: string;
      baseUrl?: string;
      model?: string;
    };
  };
  baseUrlFromCli?: string;
  baseUrlFromEnv?: string;
  modelFromCli?: string;
  modelFromEnv?: string;
}): RuntimeModelConfig | undefined {
  const providerKind = input.providerSnapshot?.provider?.providerKind?.trim();
  const baseUrl = (input.baseUrlFromCli ?? input.baseUrlFromEnv ?? input.providerSnapshot?.provider?.baseUrl)?.trim();
  const model = (input.modelFromCli ?? input.modelFromEnv ?? input.providerSnapshot?.provider?.model)?.trim();
  if (!providerKind && !baseUrl && !model) {
    return undefined;
  }
  const runtimeModelConfig: RuntimeModelConfig = {};
  if (providerKind && providerKind.length > 0) {
    runtimeModelConfig.providerKind = providerKind as RuntimeModelConfig["providerKind"];
  }
  if (baseUrl && baseUrl.length > 0) {
    runtimeModelConfig.baseUrl = baseUrl;
  }
  if (model && model.length > 0) {
    runtimeModelConfig.model = model;
  }
  return runtimeModelConfig;
}

interface ObservedProviderRuntimeState {
  providerName: string;
  consecutiveFailures: number;
  circuitOpenUntilMs: number;
  circuitOpen: boolean;
  lastErrorClass?: string;
  lastErrorMessage?: string;
  lastFailedAt?: string;
  lastSucceededAt?: string;
  ewmaLatencyMs?: number;
  ewmaErrorRate?: number;
}

interface RouteObservedRuntimeSummary {
  source: string | null;
  activeSessionId: string | null;
  updatedAt: string | null;
  stickyProvider: string | null;
  selectedProvider: string | null;
  reason: string;
  providerRuntimeStates: ObservedProviderRuntimeState[];
}

function readRouteObservedRuntimeSummary(input: {
  projectStateRoot: string;
  sessionNamespaceKey: string;
  orderedProviders: string[];
}): RouteObservedRuntimeSummary {
  const registryPath = sessionRegistryFilePath(input.projectStateRoot, input.sessionNamespaceKey);
  let rawRegistry: unknown;
  try {
    rawRegistry = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
  } catch {
    return {
      source: null,
      activeSessionId: null,
      updatedAt: null,
      stickyProvider: null,
      selectedProvider: input.orderedProviders[0] ?? null,
      reason: "session_registry_unavailable",
      providerRuntimeStates: [],
    };
  }
  const registry = normalizeSessionRegistryPayload(rawRegistry, input.sessionNamespaceKey);
  const activeRecord = findSessionRecord(registry, registry.active_id);
  if (!activeRecord) {
    return {
      source: `session_registry:${registryPath}`,
      activeSessionId: null,
      updatedAt: null,
      stickyProvider: null,
      selectedProvider: input.orderedProviders[0] ?? null,
      reason: "session_registry_missing_active_record",
      providerRuntimeStates: [],
    };
  }
  const nowMs = Date.now();
  const providerStates = Array.isArray(activeRecord.provider_runtime_states)
    ? activeRecord.provider_runtime_states
    : [];
  const stateMap = new Map<string, SessionProviderRuntimeState>();
  const normalizedStates: ObservedProviderRuntimeState[] = [];
  for (const state of providerStates) {
    const providerName = state.provider_name?.trim();
    if (!providerName) {
      continue;
    }
    stateMap.set(providerName, state);
    normalizedStates.push({
      providerName,
      consecutiveFailures: state.consecutive_failures,
      circuitOpenUntilMs: state.circuit_open_until_ms,
      circuitOpen: state.circuit_open_until_ms > nowMs,
      lastErrorClass: state.last_error_class,
      lastErrorMessage: state.last_error_message,
      lastFailedAt: state.last_failed_at,
      lastSucceededAt: state.last_succeeded_at,
      ewmaLatencyMs: state.ewma_latency_ms,
      ewmaErrorRate: state.ewma_error_rate,
    });
  }
  const stickyProvider = activeRecord.sticky_provider?.trim() || null;
  let selectedProvider: string | null = null;
  let reason = "session_first_open_provider";
  if (stickyProvider && input.orderedProviders.includes(stickyProvider)) {
    const stickyState = stateMap.get(stickyProvider);
    if (!stickyState || stickyState.circuit_open_until_ms <= nowMs) {
      selectedProvider = stickyProvider;
      reason = "session_sticky_provider";
    } else {
      reason = "session_sticky_circuit_open";
    }
  }
  if (!selectedProvider) {
    const firstOpenProvider = input.orderedProviders.find((providerName) => {
      const state = stateMap.get(providerName);
      return !state || state.circuit_open_until_ms <= nowMs;
    });
    if (firstOpenProvider) {
      selectedProvider = firstOpenProvider;
      if (reason !== "session_first_open_provider") {
        reason = `${reason}_fallback_open_provider`;
      }
    }
  }
  if (!selectedProvider && input.orderedProviders.length > 0) {
    selectedProvider = input.orderedProviders[0];
    reason = `${reason}_fallback_first_provider`;
  }
  if (!selectedProvider) {
    reason = "session_no_provider_candidate";
  }
  return {
    source: `session_registry:${registryPath}`,
    activeSessionId: activeRecord.id,
    updatedAt: activeRecord.updated_at,
    stickyProvider,
    selectedProvider,
    reason,
    providerRuntimeStates: normalizedStates,
  };
}

interface RouteDecisionSummary {
  strategy: "sticky+score";
  primaryProvider: string | null;
  configuredPrimaryProvider: string | null;
  requestedProvider: string | null;
  orderedProviders: string[];
  source: string | null;
  reason: string;
  observed: RouteObservedRuntimeSummary;
  failover: {
    circuitFailures: number;
    circuitCooldownSecs: number;
    stickyMode: "session_key";
  };
}

function resolveRouteDecisionSummary(input: {
  providerOverride?: string;
  providerEnv?: string;
  providerPoolSnapshot?: {
    source: string;
    providerName?: string;
    providers: Array<{ name: string }>;
  };
  observedRuntime: RouteObservedRuntimeSummary;
  hasDirectRuntimeOverride: boolean;
  circuitFailures: number;
  circuitCooldownSecs: number;
}): RouteDecisionSummary {
  const providerOverride = input.providerOverride?.trim();
  const providerEnv = input.providerEnv?.trim();
  const poolProviders = input.providerPoolSnapshot?.providers ?? [];
  if (input.hasDirectRuntimeOverride) {
    const directProvider = providerOverride || providerEnv || "direct-override";
    return {
      strategy: "sticky+score",
      primaryProvider: directProvider,
      configuredPrimaryProvider: directProvider,
      requestedProvider: directProvider,
      orderedProviders: [directProvider],
      source: "direct-runtime-override",
      reason: "direct_runtime_override",
      observed: input.observedRuntime,
      failover: {
        circuitFailures: input.circuitFailures,
        circuitCooldownSecs: input.circuitCooldownSecs,
        stickyMode: "session_key",
      },
    };
  }

  const orderedProviders = poolProviders
    .map((provider) => provider.name.trim())
    .filter((name) => name.length > 0);
  const requestedProvider = providerOverride || providerEnv || input.providerPoolSnapshot?.providerName || null;
  const configuredPrimaryProvider = orderedProviders[0] ?? requestedProvider ?? null;
  const primaryProvider = input.observedRuntime.selectedProvider ?? configuredPrimaryProvider;
  let reason = "pool_first_provider";
  if (providerOverride) {
    reason = "cli_provider_override";
  } else if (providerEnv) {
    reason = "env_provider_override";
  } else if (input.providerPoolSnapshot?.providerName) {
    reason = "config_selected_provider";
  } else if (orderedProviders.length === 0) {
    reason = "no_provider_pool";
  }
  const resolvedReason = input.observedRuntime.source
    ? input.observedRuntime.reason
    : reason;

  return {
    strategy: "sticky+score",
    primaryProvider,
    configuredPrimaryProvider,
    requestedProvider,
    orderedProviders,
    source: input.observedRuntime.source ?? input.providerPoolSnapshot?.source ?? null,
    reason: resolvedReason,
    observed: input.observedRuntime,
    failover: {
      circuitFailures: input.circuitFailures,
      circuitCooldownSecs: input.circuitCooldownSecs,
      stickyMode: "session_key",
    },
  };
}

function resolveRuntimeToolContextPreview(projectTomlPath: string | undefined, runtimeBinaryPath?: string): {
  enabledTools: string[];
  enabledToolsSource: "runtime.tools.describe" | "start-default";
  enabledToolsSourceDetail?: string;
  manifestFingerprint: string;
  manifestToolCount: number;
  manifestDefaultEnabledCount: number;
  bashAllowlist: string[];
  maxToolRounds: number;
  noToolFallbackMode: "off" | "safe" | "strict";
  maxRecoveryRounds: number;
} {
  const maxToolRoundsRaw = process.env.GROBOT_MAX_TOOL_ROUNDS;
  const parsedMaxToolRounds =
    typeof maxToolRoundsRaw === "string" && /^\d+$/.test(maxToolRoundsRaw.trim())
      ? Number.parseInt(maxToolRoundsRaw.trim(), 10)
      : undefined;
  const maxToolRounds =
    typeof parsedMaxToolRounds === "number" && Number.isFinite(parsedMaxToolRounds)
      ? Math.min(Math.max(parsedMaxToolRounds, 1), 32)
      : 8;
  const noToolFallbackModeRaw = process.env.GROBOT_NO_TOOL_FALLBACK_MODE?.trim().toLowerCase();
  const noToolFallbackMode = noToolFallbackModeRaw === "off"
    || noToolFallbackModeRaw === "safe"
    || noToolFallbackModeRaw === "strict"
    ? noToolFallbackModeRaw
    : "safe";
  const maxRecoveryRoundsRaw = process.env.GROBOT_MAX_RECOVERY_ROUNDS;
  const parsedMaxRecoveryRounds =
    typeof maxRecoveryRoundsRaw === "string" && /^\d+$/.test(maxRecoveryRoundsRaw.trim())
      ? Number.parseInt(maxRecoveryRoundsRaw.trim(), 10)
      : undefined;
  const maxRecoveryRounds =
    typeof parsedMaxRecoveryRounds === "number" && Number.isFinite(parsedMaxRecoveryRounds)
      ? Math.min(Math.max(parsedMaxRecoveryRounds, 0), 8)
      : 2;
  const described = runtimeBinaryPath ? runRuntimeToolsDescribe(runtimeBinaryPath) : undefined;
  const hasRuntimeDefaultEnabledTools = Boolean(
    described?.ok && Array.isArray(described.defaultEnabledTools) && described.defaultEnabledTools.length > 0,
  );
  const enabledTools = hasRuntimeDefaultEnabledTools && described
    ? [...described.defaultEnabledTools]
    : buildDefaultRuntimeEnabledTools();
  const manifestToolNames = hasRuntimeDefaultEnabledTools && described
    ? [...described.toolNames]
    : [...enabledTools];
  const manifestFingerprint = hasRuntimeDefaultEnabledTools && described
    ? described.manifestFingerprint
    : `fallback:${buildToolsManifestFingerprint(manifestToolNames, enabledTools)}`;
  const enabledToolsSource = hasRuntimeDefaultEnabledTools
    ? "runtime.tools.describe"
    : "start-default";
  const bashAllowlist = readToolsAllowlistFromProjectToml(projectTomlPath);
  return {
    enabledTools,
    enabledToolsSource,
    enabledToolsSourceDetail:
      enabledToolsSource === "start-default" && described && described.detail
        ? described.detail
        : undefined,
    manifestFingerprint,
    manifestToolCount: manifestToolNames.length,
    manifestDefaultEnabledCount: enabledTools.length,
    bashAllowlist,
    maxToolRounds,
    noToolFallbackMode,
    maxRecoveryRounds,
  };
}

export async function runStatus(options: Record<string, OptionValue>): Promise<number> {
  const outputJson = hasFlag(options, "json");
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const configSource =
    configTomlPath == null
      ? "none"
      : configTomlPath.startsWith(`${workDir}/.grobot/`)
        ? "project_work_dir"
        : configTomlPath.startsWith(`${projectRoot}/.grobot/`)
          ? "project_root"
          : configTomlPath.startsWith(`${homeDir}/`)
            ? "home"
            : "custom";
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const sessionScopeRaw = resolveSessionScopeOption(options);
  const sessionSubject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const providerOverrideFromCli = readOptionString(options, "provider");
  const providerOverrideFromEnv = process.env.GROBOT_PROVIDER;
  const modelFromCli = readOptionString(options, "model");
  const modelFromEnv = process.env.GROBOT_MODEL;
  const baseUrlFromCli = readOptionString(options, "base-url");
  const baseUrlFromEnv = process.env.GROBOT_BASE_URL;
  const apiKeyFromCli = readOptionString(options, "api-key");
  const apiKeyFromEnv = process.env.GROBOT_API_KEY;
  const projectProviderPoolSnapshot = readProviderPoolFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverrideFromCli,
  );
  const projectProviderSnapshot = readProviderSnapshotFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverrideFromCli,
  );
  const providerName = providerOverrideFromCli ??
    providerOverrideFromEnv ??
    projectProviderSnapshot?.providerName ??
    "<auto>";
  const modelName = modelFromCli ??
    modelFromEnv ??
    projectProviderSnapshot?.provider?.model ??
    "<auto>";
  const baseUrl = baseUrlFromCli ??
    baseUrlFromEnv ??
    projectProviderSnapshot?.provider?.baseUrl ??
    "<auto>";
  const apiKey = apiKeyFromCli ??
    apiKeyFromEnv ??
    projectProviderSnapshot?.provider?.apiKey;
  const hasDirectRuntimeOverride = Boolean(baseUrlFromCli)
    || Boolean(baseUrlFromEnv)
    || Boolean(apiKeyFromCli)
    || Boolean(apiKeyFromEnv)
    || Boolean(modelFromCli)
    || Boolean(modelFromEnv);
  const circuitFailures = parseRequiredPositiveInt(
    readOptionString(options, "circuit-failures"),
    2,
  );
  const circuitCooldownSecs = parseRequiredPositiveInt(
    readOptionString(options, "circuit-cooldown-secs"),
    30,
  );
  const cacheStatsWindowMs = parseOptionalPositiveInt(
    readOptionString(options, "cache-stats-window-ms"),
  );
  const resetCacheStatsWindow = hasFlag(options, "cache-stats-reset-window");
  const contextGraphCacheWindowSize = parseRequiredPositiveInt(
    readOptionString(options, "context-graph-cache-window-size")
      ?? process.env.GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE,
    20,
  );
  const contextGraphCacheDegradeHitRateThreshold = parseRequiredRatio(
    readOptionString(options, "context-graph-cache-degrade-hit-rate")
      ?? process.env.GROBOT_CONTEXT_GRAPH_CACHE_DEGRADE_HIT_RATE,
    0.3,
  );
  const contextGraphCacheDegradeMinEntries = parseRequiredPositiveInt(
    readOptionString(options, "context-graph-cache-degrade-min-entries")
      ?? process.env.GROBOT_CONTEXT_GRAPH_CACHE_DEGRADE_MIN_ENTRIES,
    8,
  );
  const sessionPreview = buildSessionKey({
    platform: parsePlatform(resolveSessionPlatformOption(options)),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(sessionScopeRaw),
    subject: sessionSubject,
  });
  const observedRuntime = readRouteObservedRuntimeSummary({
    projectStateRoot,
    sessionNamespaceKey: sessionPreview,
    orderedProviders: projectProviderPoolSnapshot?.providers.map((provider) => provider.name) ?? [],
  });
  const routeDecision = resolveRouteDecisionSummary({
    providerOverride: providerOverrideFromCli,
    providerEnv: providerOverrideFromEnv,
    providerPoolSnapshot: projectProviderPoolSnapshot
      ? {
          source: projectProviderPoolSnapshot.source,
          providerName: projectProviderPoolSnapshot.providerName,
          providers: projectProviderPoolSnapshot.providers.map((provider) => ({
            name: provider.name,
          })),
        }
      : undefined,
    observedRuntime,
    hasDirectRuntimeOverride,
    circuitFailures,
    circuitCooldownSecs,
  });
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });
  const runtimeBinaryPath = executionPlane.runtimeImpl === "rust" ? resolveRuntimeBinaryPath() : undefined;
  const runtimeToolContextPreview = resolveRuntimeToolContextPreview(projectTomlPath, runtimeBinaryPath);
  const parsedScope = parseScope(sessionScopeRaw);
  const maskedApiKey = maskSecret(apiKey);
  const runtimeHealth =
    executionPlane.runtimeImpl === "rust" && runtimeBinaryPath
      ? runRuntimeHealthcheck(runtimeBinaryPath, {
        cacheStatsWindowMs,
        resetCacheStatsWindow,
      })
      : undefined;
  const contextEngineRuntimeModelConfig = resolveContextEngineRuntimeModelConfig({
    providerSnapshot: projectProviderSnapshot,
    baseUrlFromCli,
    baseUrlFromEnv,
    modelFromCli,
    modelFromEnv,
  });
  const contextEngineConfig = resolveContextEngineConfig({
    projectTomlPath,
    runtimeModelConfig: contextEngineRuntimeModelConfig,
  });
  const contextEngineEffectiveWindowTokens = Math.max(
    1_024,
    contextEngineConfig.contextWindowTokens
      - contextEngineConfig.reservedOutputTokens
      - contextEngineConfig.safetyMarginTokens,
  );
  const contextGraphCacheStats = readContextGraphCacheStats();
  const symbolQueryGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "symbol_query");
  const symbolDeclarationGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "symbol_declaration");
  const dependencyQueryGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "dependency_query");
  const dependencyImportGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "dependency_import");
  const contextGraphCacheWindowSummary = readGraphCacheWindowSummary({
    workDir,
    size: contextGraphCacheWindowSize,
  });
  const contextGraphCacheWindowDegradation = assessGraphCacheWindowDegradation({
    summary: contextGraphCacheWindowSummary,
    thresholdQueryHitRate: contextGraphCacheDegradeHitRateThreshold,
    minEntries: contextGraphCacheDegradeMinEntries,
  });

  let probeResult:
    | {
      state: string;
      detail: string;
      httpStatus?: number;
      modelCount?: number;
      selectedModel?: string;
      selectedFound?: boolean;
      resolvedModel?: string;
      autoSelected?: boolean;
    }
    | undefined;
  let exitCode = 0;
  if (hasFlag(options, "probe")) {
    const probeBaseUrl = baseUrlFromCli ??
      baseUrlFromEnv ??
      projectProviderSnapshot?.provider?.baseUrl;
    const probeApiKey = apiKeyFromCli ??
      apiKeyFromEnv ??
      projectProviderSnapshot?.provider?.apiKey;
    const probeModel = modelFromCli ??
      modelFromEnv ??
      projectProviderSnapshot?.provider?.model;
    if (!probeBaseUrl || !probeApiKey) {
      probeResult = {
        state: "skipped",
        detail: "(missing base_url/api_key)",
      };
      exitCode = 2;
    } else {
      const probe = await probeProviderModels(probeBaseUrl, probeApiKey, probeModel);
      probeResult = {
        state: probe.state,
        detail: probe.detail,
        httpStatus: probe.httpStatus,
        modelCount: probe.modelCount,
        selectedModel: probe.selectedModel,
        selectedFound: probe.selectedFound,
        resolvedModel: probe.resolvedModel,
        autoSelected: probe.autoSelected,
      };
      if (probe.state !== "ok") {
        exitCode = 1;
      }
    }
  }

  if (outputJson) {
    const payload: Record<string, unknown> = {
      status: "ok",
      engine: "ts-dev-cli",
      home: homeDir,
      project_root: projectRoot,
      work_dir: workDir,
      config_toml: configTomlPath ?? null,
      config_source: configSource,
      project_toml: projectTomlPath ?? null,
      project: projectName,
      provider: providerName,
      provider_source: projectProviderSnapshot?.source ?? null,
      model: modelName,
      base_url: baseUrl,
      api_key: maskedApiKey,
      session_scope: parsedScope,
      session_subject: sessionSubject,
      session_preview: sessionPreview,
      route_decision: {
        strategy: routeDecision.strategy,
        primary_provider: routeDecision.primaryProvider,
        configured_primary_provider: routeDecision.configuredPrimaryProvider,
        requested_provider: routeDecision.requestedProvider,
        ordered_providers: routeDecision.orderedProviders,
        source: routeDecision.source,
        reason: routeDecision.reason,
        observed: {
          source: routeDecision.observed.source,
          active_session_id: routeDecision.observed.activeSessionId,
          updated_at: routeDecision.observed.updatedAt,
          sticky_provider: routeDecision.observed.stickyProvider,
          selected_provider: routeDecision.observed.selectedProvider,
          reason: routeDecision.observed.reason,
          provider_runtime_states: routeDecision.observed.providerRuntimeStates.map((state) => ({
            provider_name: state.providerName,
            consecutive_failures: state.consecutiveFailures,
            circuit_open_until_ms: state.circuitOpenUntilMs,
            circuit_open: state.circuitOpen,
            last_error_class: state.lastErrorClass ?? null,
            last_error_message: state.lastErrorMessage ?? null,
            last_failed_at: state.lastFailedAt ?? null,
            last_succeeded_at: state.lastSucceededAt ?? null,
            ewma_latency_ms: state.ewmaLatencyMs ?? null,
            ewma_error_rate: state.ewmaErrorRate ?? null,
          })),
        },
        failover: {
          circuit_failures: routeDecision.failover.circuitFailures,
          circuit_cooldown_secs: routeDecision.failover.circuitCooldownSecs,
          sticky_mode: routeDecision.failover.stickyMode,
        },
      },
      execution: {
        gateway_impl: executionPlane.gatewayImpl,
        gateway_impl_source: executionPlane.gatewayImplSource,
        runtime_impl: executionPlane.runtimeImpl,
        runtime_impl_source: executionPlane.runtimeImplSource,
        shadow_mode: executionPlane.shadowMode,
        shadow_mode_source: executionPlane.shadowModeSource,
      },
      runtime_tools: {
        context: "enabled",
        enabled_tools_source: runtimeToolContextPreview.enabledToolsSource,
        enabled_tools_source_detail: runtimeToolContextPreview.enabledToolsSourceDetail ?? null,
        manifest_fingerprint: runtimeToolContextPreview.manifestFingerprint,
        manifest_tool_count: runtimeToolContextPreview.manifestToolCount,
        manifest_default_enabled_count: runtimeToolContextPreview.manifestDefaultEnabledCount,
        work_dir: workDir,
        enabled_tools: runtimeToolContextPreview.enabledTools,
        bash_allowlist: runtimeToolContextPreview.bashAllowlist,
        max_tool_rounds: runtimeToolContextPreview.maxToolRounds,
        no_tool_fallback_mode: runtimeToolContextPreview.noToolFallbackMode,
        max_recovery_rounds: runtimeToolContextPreview.maxRecoveryRounds,
      },
      context_graph_cache_stats: {
        symbol_query: symbolQueryGraphCacheStats,
        symbol_declaration: symbolDeclarationGraphCacheStats,
        dependency_query: dependencyQueryGraphCacheStats,
        dependency_import: dependencyImportGraphCacheStats,
        window: {
          path: contextGraphCacheWindowSummary.path,
          configured_size: contextGraphCacheWindowSummary.configuredSize,
          entries: contextGraphCacheWindowSummary.entries,
          from_ts: contextGraphCacheWindowSummary.fromTs,
          to_ts: contextGraphCacheWindowSummary.toTs,
          delta_totals: {
            symbol_query: contextGraphCacheWindowSummary.deltaTotals.symbolQuery,
            symbol_declaration: contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration,
            dependency_query: contextGraphCacheWindowSummary.deltaTotals.dependencyQuery,
            dependency_import: contextGraphCacheWindowSummary.deltaTotals.dependencyImport,
          },
          query_totals: contextGraphCacheWindowSummary.queryTotals,
          overall_totals: contextGraphCacheWindowSummary.overallTotals,
          query_hit_rate: contextGraphCacheWindowSummary.queryHitRate,
          overall_hit_rate: contextGraphCacheWindowSummary.overallHitRate,
          degradation: {
            degraded: contextGraphCacheWindowDegradation.degraded,
            reason: contextGraphCacheWindowDegradation.reason,
            threshold_query_hit_rate: contextGraphCacheWindowDegradation.thresholdQueryHitRate,
            min_entries: contextGraphCacheWindowDegradation.minEntries,
            observed_entries: contextGraphCacheWindowDegradation.observedEntries,
            observed_query_hit_rate: contextGraphCacheWindowDegradation.observedQueryHitRate,
            observed_query_hit: contextGraphCacheWindowDegradation.observedQueryHit,
            observed_query_miss: contextGraphCacheWindowDegradation.observedQueryMiss,
          },
        },
      },
      context_engine: {
        enabled: contextEngineConfig.enabled,
        profile: contextEngineConfig.profile,
        context_window_tokens: contextEngineConfig.contextWindowTokens,
        reserved_output_tokens: contextEngineConfig.reservedOutputTokens,
        safety_margin_tokens: contextEngineConfig.safetyMarginTokens,
        effective_window_tokens: contextEngineEffectiveWindowTokens,
        thresholds: {
          proactive_ratio: contextEngineConfig.thresholds.proactiveRatio,
          forced_ratio: contextEngineConfig.thresholds.forcedRatio,
          hard_ratio: contextEngineConfig.thresholds.hardRatio,
        },
        recovery: {
          reactive_max_retries: contextEngineConfig.recovery.reactiveMaxRetries,
          ptl_max_retries: contextEngineConfig.recovery.ptlMaxRetries,
          circuit_breaker_failures: contextEngineConfig.recovery.circuitBreakerFailures,
          reactive_on_prompt_too_long: contextEngineConfig.reactiveOnPromptTooLong,
        },
        lineage: contextEngineConfig.lineage,
        workspace_signals: contextEngineConfig.workspaceSignals,
        dependency_graph: contextEngineConfig.dependencyGraph,
        symbol_graph: contextEngineConfig.symbolGraph,
        semantic_prefetch: contextEngineConfig.semanticPrefetch,
      },
      runtime_health:
        runtimeHealth && runtimeBinaryPath
          ? {
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
              ? {
                  process_since_unix_ms: runtimeHealth.cacheStats.processSinceUnixMs,
                  window_since_unix_ms: runtimeHealth.cacheStats.windowSinceUnixMs,
                  window_duration_ms: runtimeHealth.cacheStats.windowDurationMs,
                  window_policy_ms: runtimeHealth.cacheStats.windowPolicyMs,
                  model_catalog: {
                    cache_entries: runtimeHealth.cacheStats.modelCatalog.cacheEntries,
                    hit_total: runtimeHealth.cacheStats.modelCatalog.hitTotal,
                    miss_total: runtimeHealth.cacheStats.modelCatalog.missTotal,
                    stale_total: runtimeHealth.cacheStats.modelCatalog.staleTotal,
                    write_total: runtimeHealth.cacheStats.modelCatalog.writeTotal,
                    window: {
                      hit_total: runtimeHealth.cacheStats.modelCatalog.window.hitTotal,
                      miss_total: runtimeHealth.cacheStats.modelCatalog.window.missTotal,
                      stale_total: runtimeHealth.cacheStats.modelCatalog.window.staleTotal,
                      write_total: runtimeHealth.cacheStats.modelCatalog.window.writeTotal,
                    },
                  },
                  prompt_cache: {
                    enabled_total: runtimeHealth.cacheStats.promptCache.enabledTotal,
                    hint_attempted_total: runtimeHealth.cacheStats.promptCache.hintAttemptedTotal,
                    hint_applied_total: runtimeHealth.cacheStats.promptCache.hintAppliedTotal,
                    usage_observed_total: runtimeHealth.cacheStats.promptCache.usageObservedTotal,
                    cached_tokens_total: runtimeHealth.cacheStats.promptCache.cachedTokensTotal,
                    window: {
                      enabled_total: runtimeHealth.cacheStats.promptCache.window.enabledTotal,
                      hint_attempted_total: runtimeHealth.cacheStats.promptCache.window.hintAttemptedTotal,
                      hint_applied_total: runtimeHealth.cacheStats.promptCache.window.hintAppliedTotal,
                      usage_observed_total: runtimeHealth.cacheStats.promptCache.window.usageObservedTotal,
                      cached_tokens_total: runtimeHealth.cacheStats.promptCache.window.cachedTokensTotal,
                    },
                  },
                }
              : null,
          }
          : null,
      cache_stats_location: runtimeHealth?.cacheStats ? "runtime_health.cache_stats" : null,
      probe:
        probeResult == null
          ? null
          : {
            state: probeResult.state,
            detail: probeResult.detail,
            http_status: probeResult.httpStatus ?? null,
            model_count: probeResult.modelCount ?? null,
            selected_model: probeResult.selectedModel ?? null,
            selected_found: probeResult.selectedFound ?? null,
            resolved_model: probeResult.resolvedModel ?? null,
            auto_selected: probeResult.autoSelected ?? null,
          },
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return exitCode;
  }

  process.stdout.write("status: ok\n");
  process.stdout.write("engine: ts-dev-cli\n");
  process.stdout.write(`home: ${homeDir}\n`);
  process.stdout.write(`project_root: ${projectRoot}\n`);
  process.stdout.write(`work_dir: ${workDir}\n`);
  process.stdout.write(`config_toml: ${configTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`config_source: ${configSource}\n`);
  process.stdout.write(`project_toml: ${projectTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`project: ${projectName}\n`);
  process.stdout.write(`provider: ${providerName}\n`);
  if (projectProviderSnapshot?.source) {
    process.stdout.write(`provider_source: ${projectProviderSnapshot.source}\n`);
  }
  process.stdout.write(`model: ${modelName}\n`);
  process.stdout.write(`base_url: ${baseUrl}\n`);
  process.stdout.write(`api_key: ${maskedApiKey}\n`);
  process.stdout.write(`session_scope: ${parsedScope}\n`);
  process.stdout.write(`session_subject: ${sessionSubject}\n`);
  process.stdout.write(`session_preview: ${sessionPreview}\n`);
  process.stdout.write(
    `route_decision: strategy=${routeDecision.strategy} primary=${routeDecision.primaryProvider ?? "<none>"} configured=${routeDecision.configuredPrimaryProvider ?? "<none>"} requested=${routeDecision.requestedProvider ?? "<none>"} reason=${routeDecision.reason} source=${routeDecision.source ?? "<none>"}\n`,
  );
  process.stdout.write(
    `route_ordered_providers: ${routeDecision.orderedProviders.length > 0 ? routeDecision.orderedProviders.join(" -> ") : "<none>"}\n`,
  );
  process.stdout.write(
    `route_observed: selected=${routeDecision.observed.selectedProvider ?? "<none>"} sticky=${routeDecision.observed.stickyProvider ?? "<none>"} reason=${routeDecision.observed.reason} session_id=${routeDecision.observed.activeSessionId ?? "<none>"}\n`,
  );
  process.stdout.write(
    `route_failover: circuit_failures=${routeDecision.failover.circuitFailures} circuit_cooldown_secs=${routeDecision.failover.circuitCooldownSecs} sticky_mode=${routeDecision.failover.stickyMode}\n`,
  );
  process.stdout.write(
    `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
  );
  process.stdout.write(`runtime_tool_context: enabled (${runtimeToolContextPreview.enabledToolsSource})\n`);
  process.stdout.write(
    `runtime_tool_enabled_tools_source: ${runtimeToolContextPreview.enabledToolsSource}\n`,
  );
  if (runtimeToolContextPreview.enabledToolsSourceDetail) {
    process.stdout.write(
      `runtime_tool_enabled_tools_source_detail: ${runtimeToolContextPreview.enabledToolsSourceDetail}\n`,
    );
  }
  process.stdout.write(
    `runtime_tool_manifest_fingerprint: ${runtimeToolContextPreview.manifestFingerprint}\n`,
  );
  process.stdout.write(
    `runtime_tool_manifest_tool_count: ${runtimeToolContextPreview.manifestToolCount}\n`,
  );
  process.stdout.write(
    `runtime_tool_manifest_default_enabled_count: ${runtimeToolContextPreview.manifestDefaultEnabledCount}\n`,
  );
  process.stdout.write(`runtime_tool_work_dir: ${workDir}\n`);
  process.stdout.write(
    `runtime_tool_enabled_tools: ${runtimeToolContextPreview.enabledTools.join(",")}\n`,
  );
  process.stdout.write(
    `runtime_tool_bash_allowlist: ${runtimeToolContextPreview.bashAllowlist.length > 0 ? runtimeToolContextPreview.bashAllowlist.join(",") : "<empty>"}\n`,
  );
  process.stdout.write(`runtime_tool_max_tool_rounds: ${runtimeToolContextPreview.maxToolRounds}\n`);
  process.stdout.write(`runtime_tool_no_tool_fallback_mode: ${runtimeToolContextPreview.noToolFallbackMode}\n`);
  process.stdout.write(`runtime_tool_max_recovery_rounds: ${runtimeToolContextPreview.maxRecoveryRounds}\n`);
  process.stdout.write(
    `context_graph_cache_stats: symbol_query=${symbolQueryGraphCacheStats.hit}/${symbolQueryGraphCacheStats.miss}/${symbolQueryGraphCacheStats.write}/${symbolQueryGraphCacheStats.evict} symbol_declaration=${symbolDeclarationGraphCacheStats.hit}/${symbolDeclarationGraphCacheStats.miss}/${symbolDeclarationGraphCacheStats.write}/${symbolDeclarationGraphCacheStats.evict} dependency_query=${dependencyQueryGraphCacheStats.hit}/${dependencyQueryGraphCacheStats.miss}/${dependencyQueryGraphCacheStats.write}/${dependencyQueryGraphCacheStats.evict} dependency_import=${dependencyImportGraphCacheStats.hit}/${dependencyImportGraphCacheStats.miss}/${dependencyImportGraphCacheStats.write}/${dependencyImportGraphCacheStats.evict}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window: size=${contextGraphCacheWindowSummary.configuredSize} entries=${contextGraphCacheWindowSummary.entries} range=${contextGraphCacheWindowSummary.fromTs ?? "<none>"}..${contextGraphCacheWindowSummary.toTs ?? "<none>"} delta_symbol_query=${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.hit}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.miss}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.write}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.evict} delta_symbol_declaration=${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.hit}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.miss}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.write}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.evict} delta_dependency_query=${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.hit}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.miss}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.write}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.evict} delta_dependency_import=${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.hit}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.miss}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.write}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.evict} query_hit_rate=${typeof contextGraphCacheWindowSummary.queryHitRate === "number" ? contextGraphCacheWindowSummary.queryHitRate.toFixed(3) : "<none>"} overall_hit_rate=${typeof contextGraphCacheWindowSummary.overallHitRate === "number" ? contextGraphCacheWindowSummary.overallHitRate.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window_guard: degraded=${contextGraphCacheWindowDegradation.degraded ? "yes" : "no"} reason=${contextGraphCacheWindowDegradation.reason} threshold_query_hit_rate=${contextGraphCacheWindowDegradation.thresholdQueryHitRate.toFixed(3)} min_entries=${contextGraphCacheWindowDegradation.minEntries} observed_entries=${contextGraphCacheWindowDegradation.observedEntries} observed_query_hit_rate=${typeof contextGraphCacheWindowDegradation.observedQueryHitRate === "number" ? contextGraphCacheWindowDegradation.observedQueryHitRate.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_engine: enabled=${contextEngineConfig.enabled ? "on" : "off"} profile=${contextEngineConfig.profile} window=${contextEngineConfig.contextWindowTokens} reserve=${contextEngineConfig.reservedOutputTokens} safety=${contextEngineConfig.safetyMarginTokens} effective=${contextEngineEffectiveWindowTokens} thresholds=${contextEngineConfig.thresholds.proactiveRatio.toFixed(2)}/${contextEngineConfig.thresholds.forcedRatio.toFixed(2)}/${contextEngineConfig.thresholds.hardRatio.toFixed(2)} recovery=${contextEngineConfig.recovery.reactiveMaxRetries}/${contextEngineConfig.recovery.ptlMaxRetries}/${contextEngineConfig.recovery.circuitBreakerFailures}\n`,
  );

  if (runtimeHealth && runtimeBinaryPath) {
    process.stdout.write(
      `runtime_health: ${runtimeHealth.ok ? "ok" : "warn"} (${runtimeBinaryPath}) ${runtimeHealth.detail}\n`,
    );
    if (runtimeHealth.overlapGuardMetrics) {
      process.stdout.write(
        `runtime_overlap_guard: blocked_total=${runtimeHealth.overlapGuardMetrics.blockedTotal} blocked_search=${runtimeHealth.overlapGuardMetrics.blockedSearch} blocked_semantic=${runtimeHealth.overlapGuardMetrics.blockedSemantic} recorded_broad_search=${runtimeHealth.overlapGuardMetrics.recordedBroadSearch} recorded_broad_semantic=${runtimeHealth.overlapGuardMetrics.recordedBroadSemantic} tracked_turn_keys=${runtimeHealth.overlapGuardMetrics.trackedTurnKeys}/${runtimeHealth.overlapGuardMetrics.maxTurnKeys}\n`,
      );
    }
    if (runtimeHealth.cacheStats) {
      process.stdout.write("cache_stats_location: runtime_health.cache_stats\n");
      process.stdout.write(
        `runtime_cache_window: since_unix_ms=${runtimeHealth.cacheStats.windowSinceUnixMs} duration_ms=${runtimeHealth.cacheStats.windowDurationMs} policy_ms=${runtimeHealth.cacheStats.windowPolicyMs ?? "<none>"}\n`,
      );
      process.stdout.write(
        `runtime_cache_model_catalog: entries=${runtimeHealth.cacheStats.modelCatalog.cacheEntries} hit_total=${runtimeHealth.cacheStats.modelCatalog.hitTotal} miss_total=${runtimeHealth.cacheStats.modelCatalog.missTotal} stale_total=${runtimeHealth.cacheStats.modelCatalog.staleTotal} write_total=${runtimeHealth.cacheStats.modelCatalog.writeTotal} window_hit_total=${runtimeHealth.cacheStats.modelCatalog.window.hitTotal} window_miss_total=${runtimeHealth.cacheStats.modelCatalog.window.missTotal} window_stale_total=${runtimeHealth.cacheStats.modelCatalog.window.staleTotal} window_write_total=${runtimeHealth.cacheStats.modelCatalog.window.writeTotal}\n`,
      );
      process.stdout.write(
        `runtime_cache_prompt: enabled_total=${runtimeHealth.cacheStats.promptCache.enabledTotal} hint_attempted_total=${runtimeHealth.cacheStats.promptCache.hintAttemptedTotal} hint_applied_total=${runtimeHealth.cacheStats.promptCache.hintAppliedTotal} usage_observed_total=${runtimeHealth.cacheStats.promptCache.usageObservedTotal} cached_tokens_total=${runtimeHealth.cacheStats.promptCache.cachedTokensTotal} window_enabled_total=${runtimeHealth.cacheStats.promptCache.window.enabledTotal} window_hint_attempted_total=${runtimeHealth.cacheStats.promptCache.window.hintAttemptedTotal} window_hint_applied_total=${runtimeHealth.cacheStats.promptCache.window.hintAppliedTotal} window_usage_observed_total=${runtimeHealth.cacheStats.promptCache.window.usageObservedTotal} window_cached_tokens_total=${runtimeHealth.cacheStats.promptCache.window.cachedTokensTotal}\n`,
      );
    }
  }
  if (probeResult) {
    process.stdout.write(`probe: ${probeResult.state} ${probeResult.detail}\n`);
    if (typeof probeResult.httpStatus === "number" && probeResult.httpStatus > 0) {
      process.stdout.write(`probe_http_status: ${probeResult.httpStatus}\n`);
    }
    if (typeof probeResult.modelCount === "number") {
      process.stdout.write(`probe_model_count: ${probeResult.modelCount}\n`);
    }
    if (typeof probeResult.selectedModel === "string" && probeResult.selectedModel.length > 0) {
      process.stdout.write(
        `probe_selected_model: ${probeResult.selectedModel} (${probeResult.selectedFound ? "found" : "missing"})\n`,
      );
    }
    if (typeof probeResult.resolvedModel === "string" && probeResult.resolvedModel.length > 0) {
      process.stdout.write(
        `probe_resolved_model: ${probeResult.resolvedModel}${probeResult.autoSelected ? " (auto)" : ""}\n`,
      );
    }
  }
  return exitCode;
}
