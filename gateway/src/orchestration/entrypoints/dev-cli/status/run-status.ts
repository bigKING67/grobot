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
  type RuntimeToolSurfaceSchemaProfile,
} from "../runtime-health";
import { maskSecret } from "../services/redaction";
import {
  adaptRuntimeToolContextForRecovery,
  buildDefaultRuntimeEnabledTools,
  buildRuntimeToolContextForMessage,
  buildRuntimeToolSurfaceProjectionSummary,
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
  type RuntimeToolSurfaceProjectionSummary,
  type RuntimeToolSurfaceAdaptation,
  TOOL_SURFACE_POLICY_VERSION,
} from "../../../../tools/runtime/default-enabled-tools";
import {
  buildRuntimeToolRecoveryFeedback,
  type RuntimeToolRecoveryFeedback,
  readRuntimeToolSurfaceMetrics,
} from "../../../../tools/runtime/tool-events";
import {
  applyRuntimeToolRecoveryConsumption,
  applyRuntimeToolSurfaceAdaptationGuard,
  readRuntimeToolSurfaceAdaptationState,
  type RuntimeToolRecoveryConsumptionRecord,
  type RuntimeToolSurfaceAdaptationGuard,
  type RuntimeToolSurfaceAdaptationSnapshot,
} from "../../../../tools/runtime/tool-surface-adaptation-state";
import type {
  RuntimeToolSurfaceDecision,
  ToolSurfaceProfile,
  ToolSurfaceSource,
} from "../../../../models/types";
import {
  assessGraphCacheWindowDegradation,
  assessPersistentGraphWindowDegradation,
  deriveGraphQualitySignals,
  derivePromptQualityGuardAdaptivePolicy,
  assessPromptQualityGuardRuntime,
  assessPromptQualityWindowDegradation,
  readContextGraphCacheStats,
  readGraphCacheWindowSummary,
  readGraphQualityAutotuneState,
  readPromptQualityGuardState,
  readPromptQualityWindowSummary,
  resolveContextEngineConfig,
  resolveContextStorageDomain,
  resolvePromptTargetTokenLimit,
} from "../../../../tools/context";
import { readPersistentGraphIndexStatus } from "../../../../tools/context/graph/persistent-index";
import {
  applyMemoryDecayAutotuneToPolicy,
  applyMemoryStrategyAutotuneToPolicy,
  defaultMemoryOrchestratorPolicy,
  readMemoryDecayAutotuneState,
  readMemoryStrategyAutotuneState,
} from "../../../../tools/memory";
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
  resolveSessionRegistryReadPath,
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

function sameToolNameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((toolName) => rightSet.has(toolName));
}

function findRuntimeToolSurfaceSchemaProfile(input: {
  profiles: readonly RuntimeToolSurfaceSchemaProfile[];
  profile: ToolSurfaceProfile;
  advancedToolSchema: boolean;
  modelVisibleTools: readonly string[];
}): RuntimeToolSurfaceSchemaProfile | null {
  return input.profiles.find((profile) => (
    profile.profile === input.profile
    && profile.advancedToolSchema === input.advancedToolSchema
    && sameToolNameSet(profile.toolNames, input.modelVisibleTools)
  )) ?? null;
}

function buildRuntimeDescribeSchemaProjectionSummary(input: {
  runtimeProfile: RuntimeToolSurfaceSchemaProfile | null;
  context: {
    dispatchEnabledTools: readonly string[];
    schemaEstimatedTokens: number;
  };
}): RuntimeToolSurfaceProjectionSummary | null {
  if (!input.runtimeProfile) {
    return null;
  }
  return {
    source: "runtime.tools.describe",
    policyVersion: input.runtimeProfile.policyVersion,
    profile: input.runtimeProfile.profile,
    projectionMode: input.runtimeProfile.projectionMode,
    advancedToolSchema: input.runtimeProfile.advancedToolSchema,
    visibleToolCount: input.runtimeProfile.visibleToolCount,
    dispatchEnabledToolCount: input.context.dispatchEnabledTools.length,
    schemaPropertyCount: input.runtimeProfile.schemaPropertyCount,
    fullSchemaPropertyCount: input.runtimeProfile.fullSchemaPropertyCount,
    suppressedSchemaPropertyCount: input.runtimeProfile.suppressedSchemaPropertyCount,
    schemaEstimatedTokens: input.context.schemaEstimatedTokens,
    schemaFingerprint: input.runtimeProfile.schemaFingerprint,
    perToolPropertyCount: { ...input.runtimeProfile.perToolPropertyCount },
    perToolVisibleArgs: Object.fromEntries(
      Object.entries(input.runtimeProfile.perToolVisibleArgs).map(([toolName, args]) => [toolName, [...args]]),
    ),
    perToolSuppressedArgs: Object.fromEntries(
      Object.entries(input.runtimeProfile.perToolSuppressedArgs).map(([toolName, args]) => [toolName, [...args]]),
    ),
  };
}

interface RuntimeToolSurfaceProjectionDrift {
  checked: boolean;
  active: boolean;
  reason: string;
  runtimeSchemaFingerprint: string | null;
  gatewaySchemaFingerprint: string;
  runtimeProjectionMode: string | null;
  gatewayProjectionMode: string;
  runtimeSchemaPropertyCount: number | null;
  gatewaySchemaPropertyCount: number;
  runtimeFullSchemaPropertyCount: number | null;
  gatewayFullSchemaPropertyCount: number;
  runtimeSuppressedSchemaPropertyCount: number | null;
  gatewaySuppressedSchemaPropertyCount: number;
  runtimePerToolPropertyCount: Record<string, number> | null;
  gatewayPerToolPropertyCount: Record<string, number>;
  runtimePerToolVisibleArgs: Record<string, string[]> | null;
  gatewayPerToolVisibleArgs: Record<string, string[]>;
  runtimePerToolSuppressedArgs: Record<string, string[]> | null;
  gatewayPerToolSuppressedArgs: Record<string, string[]>;
  argMismatchDetails: string[];
}

function sameNumberRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function cloneStringArrayRecord(record: Record<string, string[]> | undefined): Record<string, string[]> | null {
  if (!record) {
    return null;
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, [...value]]));
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function sameStringArrayRecord(
  left: Record<string, string[]> | undefined,
  right: Record<string, string[]> | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!sameStringArray(leftKeys, rightKeys)) {
    return false;
  }
  return leftKeys.every((key) => sameStringArray(left[key] ?? [], right[key] ?? []));
}

function describeStringArrayRecordDiff(
  label: string,
  runtimeRecord: Record<string, string[]> | undefined,
  gatewayRecord: Record<string, string[]> | undefined,
): string[] {
  if (!runtimeRecord || !gatewayRecord) {
    return [`${label}:metadata_unavailable`];
  }
  const toolNames = [...new Set([...Object.keys(runtimeRecord), ...Object.keys(gatewayRecord)])].sort();
  const details: string[] = [];
  for (const toolName of toolNames) {
    const runtimeArgs = runtimeRecord[toolName] ?? [];
    const gatewayArgs = gatewayRecord[toolName] ?? [];
    if (sameStringArray(runtimeArgs, gatewayArgs)) {
      continue;
    }
    details.push(
      `${label}:${toolName}:runtime=${runtimeArgs.join("|") || "-"}:gateway=${gatewayArgs.join("|") || "-"}`,
    );
  }
  return details;
}

function buildRuntimeToolSurfaceProjectionDrift(input: {
  runtimeSummary: RuntimeToolSurfaceProjectionSummary | null;
  gatewayFallbackSummary: RuntimeToolSurfaceProjectionSummary;
  runtimeDescribeOk: boolean;
  runtimeDescribeDetail?: string;
}): RuntimeToolSurfaceProjectionDrift {
  const runtimeSummary = input.runtimeSummary;
  const gatewayFallbackSummary = input.gatewayFallbackSummary;
  if (!runtimeSummary) {
    return {
      checked: false,
      active: false,
      reason: input.runtimeDescribeOk
        ? "runtime_schema_profile_unavailable"
        : `runtime_tools_describe_unavailable:${input.runtimeDescribeDetail ?? "not_run"}`,
      runtimeSchemaFingerprint: null,
      gatewaySchemaFingerprint: gatewayFallbackSummary.schemaFingerprint,
      runtimeProjectionMode: null,
      gatewayProjectionMode: gatewayFallbackSummary.projectionMode,
      runtimeSchemaPropertyCount: null,
      gatewaySchemaPropertyCount: gatewayFallbackSummary.schemaPropertyCount,
      runtimeFullSchemaPropertyCount: null,
      gatewayFullSchemaPropertyCount: gatewayFallbackSummary.fullSchemaPropertyCount,
      runtimeSuppressedSchemaPropertyCount: null,
      gatewaySuppressedSchemaPropertyCount: gatewayFallbackSummary.suppressedSchemaPropertyCount,
      runtimePerToolPropertyCount: null,
      gatewayPerToolPropertyCount: { ...gatewayFallbackSummary.perToolPropertyCount },
      runtimePerToolVisibleArgs: null,
      gatewayPerToolVisibleArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolVisibleArgs) ?? {},
      runtimePerToolSuppressedArgs: null,
      gatewayPerToolSuppressedArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolSuppressedArgs) ?? {},
      argMismatchDetails: [],
    };
  }

  const mismatches: string[] = [];
  const argMismatchDetails: string[] = [];
  if (runtimeSummary.projectionMode !== gatewayFallbackSummary.projectionMode) {
    mismatches.push("projection_mode");
  }
  if (runtimeSummary.visibleToolCount !== gatewayFallbackSummary.visibleToolCount) {
    mismatches.push("visible_tool_count");
  }
  if (runtimeSummary.schemaPropertyCount !== gatewayFallbackSummary.schemaPropertyCount) {
    mismatches.push("schema_property_count");
  }
  if (runtimeSummary.fullSchemaPropertyCount !== gatewayFallbackSummary.fullSchemaPropertyCount) {
    mismatches.push("full_schema_property_count");
  }
  if (runtimeSummary.suppressedSchemaPropertyCount !== gatewayFallbackSummary.suppressedSchemaPropertyCount) {
    mismatches.push("suppressed_schema_property_count");
  }
  if (!sameNumberRecord(runtimeSummary.perToolPropertyCount, gatewayFallbackSummary.perToolPropertyCount)) {
    mismatches.push("per_tool_property_count");
  }
  if (!sameStringArrayRecord(runtimeSummary.perToolVisibleArgs, gatewayFallbackSummary.perToolVisibleArgs)) {
    mismatches.push("per_tool_visible_args");
    argMismatchDetails.push(
      ...describeStringArrayRecordDiff(
        "visible",
        runtimeSummary.perToolVisibleArgs,
        gatewayFallbackSummary.perToolVisibleArgs,
      ),
    );
  }
  if (!sameStringArrayRecord(runtimeSummary.perToolSuppressedArgs, gatewayFallbackSummary.perToolSuppressedArgs)) {
    mismatches.push("per_tool_suppressed_args");
    argMismatchDetails.push(
      ...describeStringArrayRecordDiff(
        "suppressed",
        runtimeSummary.perToolSuppressedArgs,
        gatewayFallbackSummary.perToolSuppressedArgs,
      ),
    );
  }

  return {
    checked: true,
    active: mismatches.length > 0,
    reason: mismatches.length > 0 ? `mismatch:${mismatches.join(",")}` : "matched",
    runtimeSchemaFingerprint: runtimeSummary.schemaFingerprint,
    gatewaySchemaFingerprint: gatewayFallbackSummary.schemaFingerprint,
    runtimeProjectionMode: runtimeSummary.projectionMode,
    gatewayProjectionMode: gatewayFallbackSummary.projectionMode,
    runtimeSchemaPropertyCount: runtimeSummary.schemaPropertyCount,
    gatewaySchemaPropertyCount: gatewayFallbackSummary.schemaPropertyCount,
    runtimeFullSchemaPropertyCount: runtimeSummary.fullSchemaPropertyCount,
    gatewayFullSchemaPropertyCount: gatewayFallbackSummary.fullSchemaPropertyCount,
    runtimeSuppressedSchemaPropertyCount: runtimeSummary.suppressedSchemaPropertyCount,
    gatewaySuppressedSchemaPropertyCount: gatewayFallbackSummary.suppressedSchemaPropertyCount,
    runtimePerToolPropertyCount: { ...runtimeSummary.perToolPropertyCount },
    gatewayPerToolPropertyCount: { ...gatewayFallbackSummary.perToolPropertyCount },
    runtimePerToolVisibleArgs: cloneStringArrayRecord(runtimeSummary.perToolVisibleArgs),
    gatewayPerToolVisibleArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolVisibleArgs) ?? {},
    runtimePerToolSuppressedArgs: cloneStringArrayRecord(runtimeSummary.perToolSuppressedArgs),
    gatewayPerToolSuppressedArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolSuppressedArgs) ?? {},
    argMismatchDetails,
  };
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
  const readPath = resolveSessionRegistryReadPath(input.projectStateRoot, input.sessionNamespaceKey);
  const registryPath = readPath.path;
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

function resolveRuntimeToolContextPreview(
  projectTomlPath: string | undefined,
  runtimeBinaryPath: string | undefined,
  recoveryFeedback: RuntimeToolRecoveryFeedback,
  adaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot,
): {
  enabledTools: string[];
  modelVisibleTools: string[];
  toolSurfaceProfile: ToolSurfaceProfile;
  toolSurfaceSource: ToolSurfaceSource;
  toolSurfaceReason: string;
  toolSurfaceDecision: RuntimeToolSurfaceDecision | null;
  toolPolicyVersion: string;
  advancedToolSchema: boolean;
  schemaFingerprint: string;
  schemaEstimatedTokens: number;
  schemaProjectionSummary: RuntimeToolSurfaceProjectionSummary;
  schemaProjectionDrift: RuntimeToolSurfaceProjectionDrift;
  schemaProfilesFingerprint: string | null;
  toolSurfaceAdaptation: RuntimeToolSurfaceAdaptation;
  toolSurfaceAdaptationGuard: RuntimeToolSurfaceAdaptationGuard;
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
  const surfaced = buildRuntimeToolContextForMessage({
    workDir: "",
    enabledTools,
    bashAllowlist,
    maxToolRounds,
    noToolFallbackMode,
    maxRecoveryRounds,
  }, undefined, manifestToolNames);
  const adapted = adaptRuntimeToolContextForRecovery({
    context: surfaced,
    recoveryFeedback,
    availableTools: manifestToolNames,
  });
  const guarded = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext: surfaced,
    result: adapted,
    snapshot: adaptationSnapshot,
  });
  const effectiveContext = guarded.context ?? surfaced;
  const toolSurfaceProfile = effectiveContext?.toolSurfaceProfile ?? "coding";
  const modelVisibleTools = effectiveContext?.modelVisibleTools ?? enabledTools;
  const dispatchEnabledTools = effectiveContext?.enabledTools ?? enabledTools;
  const schemaFingerprint = effectiveContext?.schemaFingerprint
    ?? buildToolSurfaceFingerprint(toolSurfaceProfile, modelVisibleTools);
  const schemaEstimatedTokens = effectiveContext?.schemaEstimatedTokens
    ?? estimateToolSchemaTokens(modelVisibleTools, toolSurfaceProfile);
  const toolSurfaceSource = effectiveContext?.toolSurfaceSource ?? "fallback";
  const toolSurfaceReason = effectiveContext?.toolSurfaceReason ?? "status fallback";
  const toolPolicyVersion = effectiveContext?.toolPolicyVersion ?? TOOL_SURFACE_POLICY_VERSION;
  const advancedToolSchema = effectiveContext?.advancedToolSchema ?? false;
  const runtimeSchemaProfile = described?.ok
    ? findRuntimeToolSurfaceSchemaProfile({
        profiles: described.toolSurfaceSchemaProfiles,
        profile: toolSurfaceProfile,
        advancedToolSchema,
        modelVisibleTools,
      })
    : null;
  const fallbackSchemaProjectionSummary = buildRuntimeToolSurfaceProjectionSummary({
    enabledTools: dispatchEnabledTools,
    modelVisibleTools,
    toolSurfaceProfile,
    toolSurfaceSource,
    toolSurfaceReason,
    toolPolicyVersion,
    advancedToolSchema,
    schemaFingerprint,
    schemaEstimatedTokens,
  });
  const runtimeSchemaProjectionSummary = buildRuntimeDescribeSchemaProjectionSummary({
    runtimeProfile: runtimeSchemaProfile,
    context: {
      dispatchEnabledTools,
      schemaEstimatedTokens,
    },
  });
  const schemaProjectionSummary = runtimeSchemaProjectionSummary ?? fallbackSchemaProjectionSummary;
  const schemaProjectionDrift = buildRuntimeToolSurfaceProjectionDrift({
    runtimeSummary: runtimeSchemaProjectionSummary,
    gatewayFallbackSummary: fallbackSchemaProjectionSummary,
    runtimeDescribeOk: described?.ok ?? false,
    runtimeDescribeDetail: described?.detail,
  });
  return {
    enabledTools: dispatchEnabledTools,
    modelVisibleTools,
    toolSurfaceProfile,
    toolSurfaceSource,
    toolSurfaceReason,
    toolSurfaceDecision: effectiveContext?.toolSurfaceDecision ?? null,
    toolPolicyVersion,
    advancedToolSchema,
    schemaFingerprint,
    schemaEstimatedTokens,
    schemaProjectionSummary,
    schemaProjectionDrift,
    schemaProfilesFingerprint: described?.toolSurfaceSchemaProfilesFingerprint ?? null,
    toolSurfaceAdaptation: guarded.adaptation,
    toolSurfaceAdaptationGuard: guarded.guard,
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

function serializeRuntimeToolRecoveryConsumption(record: RuntimeToolRecoveryConsumptionRecord | null): Record<string, unknown> | null {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    reason: record.reason,
    recovery_stage: record.recoveryStage,
    recovery_tool_name: record.recoveryToolName,
    recovery_error_class: record.recoveryErrorClass,
    recovery_observed_at: record.recoveryObservedAt,
    consumed_at: record.consumedAt,
    trace_id: record.traceId,
  };
}

function serializeRuntimeToolSurfaceDecision(decision: RuntimeToolSurfaceDecision | null): Record<string, unknown> | null {
  if (!decision) {
    return null;
  }
  return {
    profile: decision.profile,
    source: decision.source,
    reason: decision.reason,
    scores: decision.scores,
    suppressed: decision.suppressed.map((item) => ({
      profile: item.profile,
      reason: item.reason,
      original_score: item.originalScore,
      final_score: item.finalScore,
    })),
  };
}

function serializeRuntimeToolSurfaceProjectionSummary(
  summary: RuntimeToolSurfaceProjectionSummary,
): Record<string, unknown> {
  return {
    source: summary.source,
    policy_version: summary.policyVersion,
    profile: summary.profile,
    projection_mode: summary.projectionMode,
    advanced_tool_schema: summary.advancedToolSchema,
    visible_tool_count: summary.visibleToolCount,
    dispatch_enabled_tool_count: summary.dispatchEnabledToolCount,
    schema_property_count: summary.schemaPropertyCount,
    full_schema_property_count: summary.fullSchemaPropertyCount,
    suppressed_schema_property_count: summary.suppressedSchemaPropertyCount,
    schema_estimated_tokens: summary.schemaEstimatedTokens,
    schema_fingerprint: summary.schemaFingerprint,
    per_tool_property_count: summary.perToolPropertyCount,
    per_tool_visible_args: summary.perToolVisibleArgs ?? null,
    per_tool_suppressed_args: summary.perToolSuppressedArgs ?? null,
  };
}

function formatRuntimeToolSuppressedArgs(summary: RuntimeToolSurfaceProjectionSummary): string {
  if (!summary.perToolSuppressedArgs) {
    return `<unavailable source=${summary.source}>`;
  }
  const rows = Object.entries(summary.perToolSuppressedArgs)
    .filter(([, args]) => args.length > 0)
    .map(([toolName, args]) => `${toolName}:${args.join("|")}`);
  if (rows.length === 0) {
    return "<none>";
  }
  return rows.join(";");
}

function formatRuntimeToolArgDriftDetails(drift: RuntimeToolSurfaceProjectionDrift): string {
  if (drift.argMismatchDetails.length === 0) {
    return "<none>";
  }
  return drift.argMismatchDetails.join(";");
}

function serializeRuntimeToolSurfaceProjectionDrift(
  drift: RuntimeToolSurfaceProjectionDrift,
): Record<string, unknown> {
  return {
    checked: drift.checked,
    active: drift.active,
    reason: drift.reason,
    runtime_schema_fingerprint: drift.runtimeSchemaFingerprint,
    gateway_schema_fingerprint: drift.gatewaySchemaFingerprint,
    runtime_projection_mode: drift.runtimeProjectionMode,
    gateway_projection_mode: drift.gatewayProjectionMode,
    runtime_schema_property_count: drift.runtimeSchemaPropertyCount,
    gateway_schema_property_count: drift.gatewaySchemaPropertyCount,
    runtime_full_schema_property_count: drift.runtimeFullSchemaPropertyCount,
    gateway_full_schema_property_count: drift.gatewayFullSchemaPropertyCount,
    runtime_suppressed_schema_property_count: drift.runtimeSuppressedSchemaPropertyCount,
    gateway_suppressed_schema_property_count: drift.gatewaySuppressedSchemaPropertyCount,
    runtime_per_tool_property_count: drift.runtimePerToolPropertyCount,
    gateway_per_tool_property_count: drift.gatewayPerToolPropertyCount,
    runtime_per_tool_visible_args: drift.runtimePerToolVisibleArgs,
    gateway_per_tool_visible_args: drift.gatewayPerToolVisibleArgs,
    runtime_per_tool_suppressed_args: drift.runtimePerToolSuppressedArgs,
    gateway_per_tool_suppressed_args: drift.gatewayPerToolSuppressedArgs,
    arg_mismatch_details: drift.argMismatchDetails,
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
  const contextPersistentGraphDegradeParsedPerScannedMax = parseRequiredRatio(
    readOptionString(options, "context-persistent-graph-degrade-parsed-rate")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_PARSED_RATE,
    0.35,
  );
  const contextPersistentGraphDegradeReusedPerScannedMin = parseRequiredRatio(
    readOptionString(options, "context-persistent-graph-degrade-reused-rate")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_REUSED_RATE,
    0.55,
  );
  const contextPersistentGraphDegradeRemovedPerScannedMax = parseRequiredRatio(
    readOptionString(options, "context-persistent-graph-degrade-removed-rate")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_REMOVED_RATE,
    0.2,
  );
  const contextPersistentGraphDegradeMinEntries = parseRequiredPositiveInt(
    readOptionString(options, "context-persistent-graph-degrade-min-entries")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_MIN_ENTRIES,
    8,
  );
  const contextPersistentGraphDegradeMinScannedFiles = parseRequiredPositiveInt(
    readOptionString(options, "context-persistent-graph-degrade-min-scanned-files")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_MIN_SCANNED_FILES,
    40,
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
  const runtimeToolSurfaceMetrics = readRuntimeToolSurfaceMetrics(workDir);
  const runtimeToolSurfaceAdaptationSnapshot = readRuntimeToolSurfaceAdaptationState(workDir);
  const rawRuntimeToolRecoveryFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: runtimeToolSurfaceMetrics,
  });
  const runtimeToolRecoveryFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: rawRuntimeToolRecoveryFeedback,
    snapshot: runtimeToolSurfaceAdaptationSnapshot,
  });
  const runtimeBinaryPath = executionPlane.runtimeImpl === "rust" ? resolveRuntimeBinaryPath() : undefined;
  const runtimeToolContextPreview = resolveRuntimeToolContextPreview(
    projectTomlPath,
    runtimeBinaryPath,
    runtimeToolRecoveryFeedback,
    runtimeToolSurfaceAdaptationSnapshot,
  );
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
  const contextEngineTokenBudget = resolvePromptTargetTokenLimit(contextEngineConfig);
  const contextEngineEffectiveWindowTokens = contextEngineTokenBudget.effectiveWindowTokens;
  const memoryOrchestratorBasePolicy = defaultMemoryOrchestratorPolicy();
  const memoryDecayAutotuneState = readMemoryDecayAutotuneState({
    workDir,
    basePolicy: memoryOrchestratorBasePolicy,
  });
  const memoryPolicyAfterDecayAutotune = applyMemoryDecayAutotuneToPolicy({
    basePolicy: memoryOrchestratorBasePolicy,
    state: memoryDecayAutotuneState,
  });
  const memoryStrategyAutotuneState = readMemoryStrategyAutotuneState({
    workDir,
    basePolicy: memoryOrchestratorBasePolicy,
  });
  const memoryOrchestratorPolicy = applyMemoryStrategyAutotuneToPolicy({
    basePolicy: memoryPolicyAfterDecayAutotune,
    state: memoryStrategyAutotuneState,
  });
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
  const graphQualityAutotuneState = readGraphQualityAutotuneState({
    workDir,
  });
  const persistentGraphIndexStatus = readPersistentGraphIndexStatus({
    workDir,
    windowSize: contextGraphCacheWindowSize,
  });
  const persistentGraphWindowDegradation = assessPersistentGraphWindowDegradation({
    status: persistentGraphIndexStatus,
    thresholdParsedPerScannedMax: contextPersistentGraphDegradeParsedPerScannedMax,
    thresholdReusedPerScannedMin: contextPersistentGraphDegradeReusedPerScannedMin,
    thresholdRemovedPerScannedMax: contextPersistentGraphDegradeRemovedPerScannedMax,
    minEntries: contextPersistentGraphDegradeMinEntries,
    minScannedFiles: contextPersistentGraphDegradeMinScannedFiles,
  });
  const graphQualitySignals = deriveGraphQualitySignals({
    cacheWindow: contextGraphCacheWindowDegradation,
    persistentWindow: persistentGraphWindowDegradation,
  });
  const promptQualityWindowSummary = readPromptQualityWindowSummary({
    workDir,
    size: contextGraphCacheWindowSize,
    lowQualityThreshold: contextEngineConfig.promptQuality?.lowQualityThreshold,
  });
  const promptQualityWindowDegradation = assessPromptQualityWindowDegradation({
    summary: promptQualityWindowSummary,
    thresholdOverall: contextEngineConfig.promptQuality?.degradeOverallThreshold ?? 0.62,
    thresholdLowQualityRate: contextEngineConfig.promptQuality?.degradeLowQualityRateThreshold ?? 0.4,
    minEntries: contextEngineConfig.promptQuality?.degradeMinEntries ?? 8,
  });
  const promptQualityGuardState = readPromptQualityGuardState({
    workDir,
  });
  const promptQualityGuardRuntimeAssessment = assessPromptQualityGuardRuntime({
    policy: {
      enabled: contextEngineConfig.promptQuality?.guardEnabled ?? true,
      promoteStreak: contextEngineConfig.promptQuality?.guardPromoteStreak ?? 2,
      severePromoteStreak: contextEngineConfig.promptQuality?.guardSeverePromoteStreak ?? 2,
      releaseStreak: contextEngineConfig.promptQuality?.guardReleaseStreak ?? 3,
      holdTurns: contextEngineConfig.promptQuality?.guardHoldTurns ?? 2,
      maxFloorStage: contextEngineConfig.promptQuality?.guardMaxFloorStage ?? "minimal",
      severeOverallThreshold: contextEngineConfig.promptQuality?.guardSevereOverallThreshold ?? 0.45,
      severeLowQualityRateThreshold:
        contextEngineConfig.promptQuality?.guardSevereLowQualityRateThreshold ?? 0.7,
    },
    currentState: promptQualityGuardState,
    observation: {
      degraded: promptQualityWindowDegradation.degraded,
      reason: promptQualityWindowDegradation.reason,
      observedOverall: promptQualityWindowDegradation.observedOverall,
      observedLowQualityRate: promptQualityWindowDegradation.observedLowQualityRate,
    },
  });
  const promptQualityGuardAdaptivePolicy = derivePromptQualityGuardAdaptivePolicy({
    basePolicy: {
      enabled: contextEngineConfig.promptQuality?.guardEnabled ?? true,
      promoteStreak: contextEngineConfig.promptQuality?.guardPromoteStreak ?? 2,
      severePromoteStreak: contextEngineConfig.promptQuality?.guardSeverePromoteStreak ?? 2,
      releaseStreak: contextEngineConfig.promptQuality?.guardReleaseStreak ?? 3,
      holdTurns: contextEngineConfig.promptQuality?.guardHoldTurns ?? 2,
      maxFloorStage: contextEngineConfig.promptQuality?.guardMaxFloorStage ?? "minimal",
      severeOverallThreshold: contextEngineConfig.promptQuality?.guardSevereOverallThreshold ?? 0.45,
      severeLowQualityRateThreshold:
        contextEngineConfig.promptQuality?.guardSevereLowQualityRateThreshold ?? 0.7,
    },
    adaptiveEnabled: contextEngineConfig.promptQuality?.guardAdaptiveEnabled ?? true,
    adaptiveModeAllowlist: contextEngineConfig.promptQuality?.guardAdaptiveModeAllowlist,
    currentState: promptQualityGuardState,
    window: {
      degraded: promptQualityWindowDegradation.degraded,
      reason: promptQualityWindowDegradation.reason,
      lowQualityRate: promptQualityWindowSummary.lowQualityRate,
      averageOverall: promptQualityWindowSummary.averageScores?.overall ?? null,
      observedOverall: promptQualityWindowDegradation.observedOverall,
      observedLowQualityRate: promptQualityWindowDegradation.observedLowQualityRate,
      snapshotSemanticCompressRate:
        promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate,
      autoLimitTriggeredRate:
        promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
      averageUtilizationRatio:
        promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
      shortSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate,
      mediumSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate,
      shortAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
      mediumAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
      shortAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
      mediumAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio,
      hardBudgetStrategyRate:
        promptQualityWindowSummary.strategyActivity.hardBudgetRate,
      qualityFirstStrategyRate:
        promptQualityWindowSummary.strategyActivity.qualityFirstRate,
      averagePreSendOverflowRatio:
        promptQualityWindowSummary.signalAverages?.preSendOverflowRatio ?? null,
      averagePreSendPressureScore:
        promptQualityWindowSummary.signalAverages?.preSendPressureScore ?? null,
      shortHardBudgetStrategyRate:
        promptQualityWindowSummary.strategyTrends.short.hardBudgetRate,
      mediumHardBudgetStrategyRate:
        promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate,
      shortAveragePreSendOverflowRatio:
        promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio,
      mediumAveragePreSendOverflowRatio:
        promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio,
      shortAveragePreSendPressureScore:
        promptQualityWindowSummary.strategyTrends.short.averagePressureScore,
      mediumAveragePreSendPressureScore:
        promptQualityWindowSummary.strategyTrends.medium.averagePressureScore,
      hardBudgetFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta,
      qualityFirstFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta,
      hardBudgetRecoveryRate:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate,
      qualityFirstImprovedRate:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
      hardBudgetTransitionCount:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions,
      qualityFirstTransitionCount:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions,
    },
  });
  const graphCacheWindowPersistenceDomain = resolveContextStorageDomain("graph_cache_window");
  const promptQualityWindowPersistenceDomain = resolveContextStorageDomain("prompt_quality_window");
  const graphAutotuneStatePersistenceDomain = resolveContextStorageDomain(
    "graph_quality_autotune_state",
  );
  const promptQualityGuardStatePersistenceDomain = resolveContextStorageDomain(
    "prompt_quality_guard_state",
  );
  const memoryDecayAutotuneStatePersistenceDomain = resolveContextStorageDomain(
    "memory_decay_autotune_state",
  );
  const memoryStrategyAutotuneStatePersistenceDomain = resolveContextStorageDomain(
    "memory_strategy_autotune_state",
  );
  const persistentGraphIndexPersistenceDomain = resolveContextStorageDomain("graph_persistent_index");
  const persistentGraphIndexWindowPersistenceDomain = resolveContextStorageDomain(
    "graph_persistent_index_window",
  );
  const lineageDiffCachePersistenceDomain = resolveContextStorageDomain("lineage_diff_cache");

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
        tool_surface_profile: runtimeToolContextPreview.toolSurfaceProfile,
        tool_surface_source: runtimeToolContextPreview.toolSurfaceSource,
        tool_surface_reason: runtimeToolContextPreview.toolSurfaceReason,
        surface_decision: serializeRuntimeToolSurfaceDecision(runtimeToolContextPreview.toolSurfaceDecision),
        tool_policy_version: runtimeToolContextPreview.toolPolicyVersion,
        model_visible_tools: runtimeToolContextPreview.modelVisibleTools,
        dispatch_enabled_tools: runtimeToolContextPreview.enabledTools,
        schema_fingerprint: runtimeToolContextPreview.schemaFingerprint,
        schema_profiles_fingerprint: runtimeToolContextPreview.schemaProfilesFingerprint,
        schema_estimated_tokens: runtimeToolContextPreview.schemaEstimatedTokens,
        advanced_tool_schema: runtimeToolContextPreview.advancedToolSchema,
        schema_projection: serializeRuntimeToolSurfaceProjectionSummary(runtimeToolContextPreview.schemaProjectionSummary),
        schema_projection_drift: serializeRuntimeToolSurfaceProjectionDrift(runtimeToolContextPreview.schemaProjectionDrift),
        metrics: runtimeToolSurfaceMetrics,
        recovery_feedback: {
          active: runtimeToolRecoveryFeedback.active,
          severity: runtimeToolRecoveryFeedback.severity,
          reason: runtimeToolRecoveryFeedback.reason,
          stage: runtimeToolRecoveryFeedback.stage,
          tool_name: runtimeToolRecoveryFeedback.toolName,
          error_class: runtimeToolRecoveryFeedback.errorClass,
          recommended_next_action: runtimeToolRecoveryFeedback.recommendedNextAction,
          recoverable: runtimeToolRecoveryFeedback.recoverable,
          prompt_injected: runtimeToolRecoveryFeedback.active,
          consumed: runtimeToolRecoveryFeedback.consumed ?? false,
          consumed_reason: runtimeToolRecoveryFeedback.consumedReason ?? null,
          consumed_at: runtimeToolRecoveryFeedback.consumedAt ?? null,
          observed_at: runtimeToolRecoveryFeedback.observedAt ?? null,
        },
        surface_adaptation: {
          enabled: runtimeToolContextPreview.toolSurfaceAdaptation.enabled,
          active: runtimeToolContextPreview.toolSurfaceAdaptation.active,
          reason: runtimeToolContextPreview.toolSurfaceAdaptation.reason,
          from_profile: runtimeToolContextPreview.toolSurfaceAdaptation.fromProfile,
          applied_profile: runtimeToolContextPreview.toolSurfaceAdaptation.appliedProfile,
          recommended_profile: runtimeToolContextPreview.toolSurfaceAdaptation.recommendedProfile,
          source: runtimeToolContextPreview.toolSurfaceAdaptation.source,
          recovery_stage: runtimeToolContextPreview.toolSurfaceAdaptation.recoveryStage,
          recovery_tool_name: runtimeToolContextPreview.toolSurfaceAdaptation.recoveryToolName,
          recovery_error_class: runtimeToolContextPreview.toolSurfaceAdaptation.recoveryErrorClass,
          recovery_recoverable: runtimeToolContextPreview.toolSurfaceAdaptation.recoveryRecoverable,
          recovery_observed_at: runtimeToolContextPreview.toolSurfaceAdaptation.recoveryObservedAt,
        },
        surface_adaptation_outcome: {
          path: runtimeToolSurfaceAdaptationSnapshot.path,
          updated_at: runtimeToolSurfaceAdaptationSnapshot.updatedAt,
          recent_outcome: runtimeToolSurfaceAdaptationSnapshot.latestAdaptation?.outcome ?? null,
          recent_profile: runtimeToolSurfaceAdaptationSnapshot.latestAdaptation?.appliedProfile ?? null,
          recent_outcome_reason: runtimeToolSurfaceAdaptationSnapshot.latestAdaptation?.outcomeReason ?? null,
          recent_failure_class: runtimeToolSurfaceAdaptationSnapshot.latestAdaptation?.nextFailureClass ?? null,
          recent_adaptation_count: runtimeToolSurfaceAdaptationSnapshot.recentAdaptations.length,
          profile_outcomes: runtimeToolSurfaceAdaptationSnapshot.profileOutcomes,
          recent_recovery_consumption_count: runtimeToolSurfaceAdaptationSnapshot.recentRecoveryConsumptions.length,
          latest_recovery_consumption: serializeRuntimeToolRecoveryConsumption(
            runtimeToolSurfaceAdaptationSnapshot.latestRecoveryConsumption,
          ),
          guard: {
            active: runtimeToolContextPreview.toolSurfaceAdaptationGuard.active,
            reason: runtimeToolContextPreview.toolSurfaceAdaptationGuard.reason,
            blocked_profile: runtimeToolContextPreview.toolSurfaceAdaptationGuard.blockedProfile,
            matching_failure_count: runtimeToolContextPreview.toolSurfaceAdaptationGuard.matchingFailureCount,
            recent_profile_sequence: runtimeToolContextPreview.toolSurfaceAdaptationGuard.recentProfileSequence,
          },
        },
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
        autotune_state: {
          last_direction: graphQualityAutotuneState.lastDirection,
          hold_turns_remaining: graphQualityAutotuneState.holdTurnsRemaining,
          downshift_warmup_streak: graphQualityAutotuneState.downshiftWarmupStreak,
          last_reason: graphQualityAutotuneState.lastReason || null,
          updated_at: graphQualityAutotuneState.updatedAt,
          adaptive_cache_query_hit_rate_threshold:
            graphQualityAutotuneState.cacheDegradeQueryHitRateThreshold,
          adaptive_persistent_parsed_per_scanned_max:
            graphQualityAutotuneState.persistentDegradeParsedPerScannedMax,
          adaptive_persistent_reused_per_scanned_min:
            graphQualityAutotuneState.persistentDegradeReusedPerScannedMin,
          adaptive_persistent_removed_per_scanned_max:
            graphQualityAutotuneState.persistentDegradeRemovedPerScannedMax,
          adaptive_learn_alpha: graphQualityAutotuneState.adaptiveLearnAlpha,
          adaptive_updates: graphQualityAutotuneState.adaptiveUpdates,
          adaptive_source: graphQualityAutotuneState.adaptiveSource,
          adaptive_action_scale: graphQualityAutotuneState.adaptiveActionScale,
          adaptive_action_updates: graphQualityAutotuneState.adaptiveActionUpdates,
          adaptive_action_source: graphQualityAutotuneState.adaptiveActionSource,
          persistence_domain: graphAutotuneStatePersistenceDomain,
        },
        window: {
          path: contextGraphCacheWindowSummary.path,
          configured_size: contextGraphCacheWindowSummary.configuredSize,
          entries: contextGraphCacheWindowSummary.entries,
          from_ts: contextGraphCacheWindowSummary.fromTs,
          to_ts: contextGraphCacheWindowSummary.toTs,
          persistence_domain: graphCacheWindowPersistenceDomain,
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
          quality: {
            entries_with_quality: contextGraphCacheWindowSummary.quality.entriesWithQuality,
            dependency: {
              avg_rows: contextGraphCacheWindowSummary.quality.dependency.avgRows,
              avg_multi_hop_rows: contextGraphCacheWindowSummary.quality.dependency.avgMultiHopRows,
              avg_max_chain_depth: contextGraphCacheWindowSummary.quality.dependency.avgMaxChainDepth,
              multi_hop_rate: contextGraphCacheWindowSummary.quality.dependency.multiHopRate,
              depth_4_plus_rate: contextGraphCacheWindowSummary.quality.dependency.depth4PlusRate,
            },
            symbol: {
              avg_rows: contextGraphCacheWindowSummary.quality.symbol.avgRows,
              bridge_coverage_rate: contextGraphCacheWindowSummary.quality.symbol.bridgeCoverageRate,
              breadth_coverage_rate: contextGraphCacheWindowSummary.quality.symbol.breadthCoverageRate,
              avg_bridge: contextGraphCacheWindowSummary.quality.symbol.avgBridge,
              avg_breadth: contextGraphCacheWindowSummary.quality.symbol.avgBreadth,
              avg_refs: contextGraphCacheWindowSummary.quality.symbol.avgRefs,
              max_refs: contextGraphCacheWindowSummary.quality.symbol.maxRefs,
            },
          },
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
      context_persistent_graph_index: {
        ...persistentGraphIndexStatus,
        persistence_domain: persistentGraphIndexPersistenceDomain,
        window: persistentGraphIndexStatus.window == null
          ? undefined
          : {
            ...persistentGraphIndexStatus.window,
            persistence_domain: persistentGraphIndexWindowPersistenceDomain,
          },
        degradation: {
          degraded: persistentGraphWindowDegradation.degraded,
          reason: persistentGraphWindowDegradation.reason,
          threshold_parsed_per_scanned_max:
            persistentGraphWindowDegradation.thresholdParsedPerScannedMax,
          threshold_reused_per_scanned_min:
            persistentGraphWindowDegradation.thresholdReusedPerScannedMin,
          threshold_removed_per_scanned_max:
            persistentGraphWindowDegradation.thresholdRemovedPerScannedMax,
          min_entries: persistentGraphWindowDegradation.minEntries,
          min_scanned_files: persistentGraphWindowDegradation.minScannedFiles,
          observed_entries: persistentGraphWindowDegradation.observedEntries,
          observed_scanned_files: persistentGraphWindowDegradation.observedScannedFiles,
          observed_parsed_per_scanned:
            persistentGraphWindowDegradation.observedParsedPerScanned,
          observed_reused_per_scanned:
            persistentGraphWindowDegradation.observedReusedPerScanned,
          observed_removed_per_scanned:
            persistentGraphWindowDegradation.observedRemovedPerScanned,
        },
      },
      context_engine: {
        enabled: contextEngineConfig.enabled,
        profile: contextEngineConfig.profile,
        context_window_tokens: contextEngineConfig.contextWindowTokens,
        reserved_output_tokens: contextEngineConfig.reservedOutputTokens,
        safety_margin_tokens: contextEngineConfig.safetyMarginTokens,
        auto_compact_token_limit: contextEngineTokenBudget.autoCompactTokenLimit,
        target_token_limit: contextEngineTokenBudget.targetTokenLimit,
        effective_window_tokens: contextEngineEffectiveWindowTokens,
        thresholds: {
          proactive_ratio: contextEngineConfig.thresholds.proactiveRatio,
          forced_ratio: contextEngineConfig.thresholds.forcedRatio,
          hard_ratio: contextEngineConfig.thresholds.hardRatio,
        },
        prompt_quality: {
          low_quality_threshold: contextEngineConfig.promptQuality?.lowQualityThreshold ?? null,
          degrade_overall_threshold: contextEngineConfig.promptQuality?.degradeOverallThreshold ?? null,
          degrade_low_quality_rate_threshold:
            contextEngineConfig.promptQuality?.degradeLowQualityRateThreshold ?? null,
          degrade_min_entries: contextEngineConfig.promptQuality?.degradeMinEntries ?? null,
          guard_enabled: contextEngineConfig.promptQuality?.guardEnabled ?? null,
          guard_adaptive_enabled: contextEngineConfig.promptQuality?.guardAdaptiveEnabled ?? null,
          guard_adaptive_mode_allowlist:
            contextEngineConfig.promptQuality?.guardAdaptiveModeAllowlist ?? null,
          guard_promote_streak: contextEngineConfig.promptQuality?.guardPromoteStreak ?? null,
          guard_severe_promote_streak:
            contextEngineConfig.promptQuality?.guardSeverePromoteStreak ?? null,
          guard_release_streak: contextEngineConfig.promptQuality?.guardReleaseStreak ?? null,
          guard_hold_turns: contextEngineConfig.promptQuality?.guardHoldTurns ?? null,
          guard_max_floor_stage:
            contextEngineConfig.promptQuality?.guardMaxFloorStage ?? null,
          guard_severe_overall_threshold:
            contextEngineConfig.promptQuality?.guardSevereOverallThreshold ?? null,
          guard_severe_low_quality_rate_threshold:
            contextEngineConfig.promptQuality?.guardSevereLowQualityRateThreshold ?? null,
        },
        prompt_quality_guard_state: {
          floor_stage: promptQualityGuardState.floorStage,
          degraded_streak: promptQualityGuardState.degradedStreak,
          severe_streak: promptQualityGuardState.severeStreak,
          healthy_streak: promptQualityGuardState.healthyStreak,
          hold_turns_remaining: promptQualityGuardState.holdTurnsRemaining,
          last_reason: promptQualityGuardState.lastReason,
          updated_at: promptQualityGuardState.updatedAt,
          pressure_utilization_threshold: promptQualityGuardState.pressureUtilizationThreshold,
          pressure_semantic_rate_threshold: promptQualityGuardState.pressureSemanticRateThreshold,
          pressure_auto_limit_rate_threshold: promptQualityGuardState.pressureAutoLimitRateThreshold,
          pressure_joint_rate_threshold: promptQualityGuardState.pressureJointRateThreshold,
          pressure_trend_utilization_delta: promptQualityGuardState.pressureTrendUtilizationDelta,
          pressure_trend_semantic_delta: promptQualityGuardState.pressureTrendSemanticDelta,
          pressure_trend_auto_limit_delta: promptQualityGuardState.pressureTrendAutoLimitDelta,
          pressure_trend_momentum: promptQualityGuardState.pressureTrendMomentum,
          outcome_required_transitions: promptQualityGuardState.outcomeRequiredTransitions,
          outcome_combined_evidence_score: promptQualityGuardState.outcomeCombinedEvidenceScore,
          outcome_high_evidence_turns: promptQualityGuardState.outcomeHighEvidenceTurns,
          outcome_high_evidence_harden_turns:
            promptQualityGuardState.outcomeHighEvidenceHardenTurns,
          outcome_drift_recent_auto_action_levels:
            promptQualityGuardState.outcomeDriftRecentAutoActionLevels,
          persistence_domain: promptQualityGuardStatePersistenceDomain,
        },
        prompt_quality_guard_runtime_assessment: {
          enabled: promptQualityGuardRuntimeAssessment.enabled,
          phase: promptQualityGuardRuntimeAssessment.phase,
          transition: promptQualityGuardRuntimeAssessment.transition,
          degraded: promptQualityGuardRuntimeAssessment.degraded,
          severe: promptQualityGuardRuntimeAssessment.severe,
          reason: promptQualityGuardRuntimeAssessment.reason,
          triggered: promptQualityGuardRuntimeAssessment.triggered,
          floor_stage: promptQualityGuardRuntimeAssessment.floorStage,
          proposed_floor_stage: promptQualityGuardRuntimeAssessment.proposedFloorStage,
          promote_remaining: promptQualityGuardRuntimeAssessment.promoteRemaining,
          severe_promote_remaining: promptQualityGuardRuntimeAssessment.severePromoteRemaining,
          release_remaining: promptQualityGuardRuntimeAssessment.releaseRemaining,
          hold_turns_remaining: promptQualityGuardRuntimeAssessment.holdTurnsRemaining,
          observed_overall: promptQualityGuardRuntimeAssessment.observedOverall,
          observed_low_quality_rate: promptQualityGuardRuntimeAssessment.observedLowQualityRate,
        },
        prompt_quality_guard_adaptive_policy: {
          enabled: promptQualityGuardAdaptivePolicy.enabled,
          mode: promptQualityGuardAdaptivePolicy.mode,
          reason: promptQualityGuardAdaptivePolicy.reason,
          allowlist: promptQualityGuardAdaptivePolicy.allowlist,
          mode_blocked: promptQualityGuardAdaptivePolicy.modeBlocked,
          blocked_mode: promptQualityGuardAdaptivePolicy.blockedMode,
          base_policy: {
            enabled: promptQualityGuardAdaptivePolicy.basePolicy.enabled,
            promote_streak: promptQualityGuardAdaptivePolicy.basePolicy.promoteStreak,
            severe_promote_streak: promptQualityGuardAdaptivePolicy.basePolicy.severePromoteStreak,
            release_streak: promptQualityGuardAdaptivePolicy.basePolicy.releaseStreak,
            hold_turns: promptQualityGuardAdaptivePolicy.basePolicy.holdTurns,
            max_floor_stage: promptQualityGuardAdaptivePolicy.basePolicy.maxFloorStage,
            severe_overall_threshold: promptQualityGuardAdaptivePolicy.basePolicy.severeOverallThreshold,
            severe_low_quality_rate_threshold:
              promptQualityGuardAdaptivePolicy.basePolicy.severeLowQualityRateThreshold,
          },
          effective_policy: {
            enabled: promptQualityGuardAdaptivePolicy.effectivePolicy.enabled,
            promote_streak: promptQualityGuardAdaptivePolicy.effectivePolicy.promoteStreak,
            severe_promote_streak: promptQualityGuardAdaptivePolicy.effectivePolicy.severePromoteStreak,
            release_streak: promptQualityGuardAdaptivePolicy.effectivePolicy.releaseStreak,
            hold_turns: promptQualityGuardAdaptivePolicy.effectivePolicy.holdTurns,
            max_floor_stage: promptQualityGuardAdaptivePolicy.effectivePolicy.maxFloorStage,
            severe_overall_threshold:
              promptQualityGuardAdaptivePolicy.effectivePolicy.severeOverallThreshold,
            severe_low_quality_rate_threshold:
              promptQualityGuardAdaptivePolicy.effectivePolicy.severeLowQualityRateThreshold,
          },
          adjustment: {
            promote_streak_delta: promptQualityGuardAdaptivePolicy.adjustment.promoteStreakDelta,
            severe_promote_streak_delta:
              promptQualityGuardAdaptivePolicy.adjustment.severePromoteStreakDelta,
            release_streak_delta: promptQualityGuardAdaptivePolicy.adjustment.releaseStreakDelta,
            hold_turns_delta: promptQualityGuardAdaptivePolicy.adjustment.holdTurnsDelta,
          },
          pressure_policy: {
            source: promptQualityGuardAdaptivePolicy.pressurePolicy.source,
            updated: promptQualityGuardAdaptivePolicy.pressurePolicy.updated,
            learn_alpha: promptQualityGuardAdaptivePolicy.pressurePolicy.learnAlpha,
            utilization_threshold:
              promptQualityGuardAdaptivePolicy.pressurePolicy.utilizationThreshold,
            semantic_rate_threshold:
              promptQualityGuardAdaptivePolicy.pressurePolicy.semanticRateThreshold,
            auto_limit_rate_threshold:
              promptQualityGuardAdaptivePolicy.pressurePolicy.autoLimitRateThreshold,
            joint_rate_threshold:
              promptQualityGuardAdaptivePolicy.pressurePolicy.jointRateThreshold,
            trend_utilization_delta:
              promptQualityGuardAdaptivePolicy.pressurePolicy.trendUtilizationDelta,
            trend_semantic_delta:
              promptQualityGuardAdaptivePolicy.pressurePolicy.trendSemanticDelta,
            trend_auto_limit_delta:
              promptQualityGuardAdaptivePolicy.pressurePolicy.trendAutoLimitDelta,
            trend_momentum:
              promptQualityGuardAdaptivePolicy.pressurePolicy.trendMomentum,
            trend_flip_suppressed:
              promptQualityGuardAdaptivePolicy.pressurePolicy.trendFlipSuppressed,
          },
          outcome_reliability: {
            required_transitions:
              promptQualityGuardAdaptivePolicy.outcomeReliability.requiredTransitions,
            next_required_transitions:
              promptQualityGuardAdaptivePolicy.outcomeReliability.nextRequiredTransitions,
            hard_budget_transitions:
              promptQualityGuardAdaptivePolicy.outcomeReliability.hardBudgetTransitions,
            quality_first_transitions:
              promptQualityGuardAdaptivePolicy.outcomeReliability.qualityFirstTransitions,
            hard_budget_evidence_score:
              promptQualityGuardAdaptivePolicy.outcomeReliability.hardBudgetEvidenceScore,
            quality_first_evidence_score:
              promptQualityGuardAdaptivePolicy.outcomeReliability.qualityFirstEvidenceScore,
            combined_evidence_score:
              promptQualityGuardAdaptivePolicy.outcomeReliability.combinedEvidenceScore,
            hard_budget_reliable:
              promptQualityGuardAdaptivePolicy.outcomeReliability.hardBudgetReliable,
            quality_first_reliable:
              promptQualityGuardAdaptivePolicy.outcomeReliability.qualityFirstReliable,
          },
          outcome_drift_guard: {
            high_evidence_harden_bias:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenBias,
            high_evidence_turn:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceTurn,
            high_evidence_turns:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceTurns,
            high_evidence_harden_turns:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenTurns,
            high_evidence_harden_rate:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenRate,
            threshold_harden_rate:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.thresholdHardenRate,
            min_high_evidence_turns:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.minHighEvidenceTurns,
            reason: promptQualityGuardAdaptivePolicy.outcomeDriftGuard.reason,
            auto_action_level:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.autoActionLevel,
            recent_auto_action_levels:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.recentAutoActionLevels,
            window_summary: {
              window_size:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.windowSize,
              entries:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.entries,
              latest:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.latest,
              dominant:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.dominant,
              alert_level:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.alertLevel,
              transition_count:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.transitionCount,
              active_rate:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.activeRate,
              medium_or_hard_rate:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.mediumOrHardRate,
              hard_rate:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.hardRate,
              level_counts:
                promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.levelCounts,
            },
            recommendation:
              promptQualityGuardAdaptivePolicy.outcomeDriftGuard.recommendation,
          },
          window: {
            snapshot_semantic_compress_rate:
              promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate,
            auto_limit_triggered_rate:
              promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
            average_utilization_ratio:
              promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
            short_snapshot_semantic_compress_rate:
              promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate,
            medium_snapshot_semantic_compress_rate:
              promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate,
            short_auto_limit_triggered_rate:
              promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
            medium_auto_limit_triggered_rate:
              promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
            short_average_utilization_ratio:
              promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
            medium_average_utilization_ratio:
              promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio,
            hard_budget_strategy_rate:
              promptQualityWindowSummary.strategyActivity.hardBudgetRate,
            quality_first_strategy_rate:
              promptQualityWindowSummary.strategyActivity.qualityFirstRate,
            average_pre_send_overflow_ratio:
              promptQualityWindowSummary.signalAverages?.preSendOverflowRatio ?? null,
            average_pre_send_pressure_score:
              promptQualityWindowSummary.signalAverages?.preSendPressureScore ?? null,
            short_hard_budget_strategy_rate:
              promptQualityWindowSummary.strategyTrends.short.hardBudgetRate,
            medium_hard_budget_strategy_rate:
              promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate,
            short_average_pre_send_overflow_ratio:
              promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio,
            medium_average_pre_send_overflow_ratio:
              promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio,
            short_average_pre_send_pressure_score:
              promptQualityWindowSummary.strategyTrends.short.averagePressureScore,
            medium_average_pre_send_pressure_score:
              promptQualityWindowSummary.strategyTrends.medium.averagePressureScore,
            hard_budget_followup_overall_delta:
              promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta,
            quality_first_followup_overall_delta:
              promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta,
            hard_budget_recovery_rate:
              promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate,
            quality_first_improved_rate:
              promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
            hard_budget_transition_count:
              promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions,
            quality_first_transition_count:
              promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions,
          },
        },
        recovery: {
          reactive_max_retries: contextEngineConfig.recovery.reactiveMaxRetries,
          ptl_max_retries: contextEngineConfig.recovery.ptlMaxRetries,
          circuit_breaker_failures: contextEngineConfig.recovery.circuitBreakerFailures,
          reactive_on_prompt_too_long: contextEngineConfig.reactiveOnPromptTooLong,
        },
        lineage: {
          ...contextEngineConfig.lineage,
          persistence_domain: lineageDiffCachePersistenceDomain,
        },
        workspace_signals: contextEngineConfig.workspaceSignals,
        dependency_graph: contextEngineConfig.dependencyGraph,
        symbol_graph: contextEngineConfig.symbolGraph,
        semantic_prefetch: contextEngineConfig.semanticPrefetch,
        memory_orchestrator: {
          enabled: memoryOrchestratorPolicy.enabled,
          version: memoryOrchestratorPolicy.version,
          inject_budget_ratio: memoryOrchestratorPolicy.injectBudgetRatio,
          inject_budget_min_tokens: memoryOrchestratorPolicy.injectBudgetMinTokens,
          inject_budget_max_tokens: memoryOrchestratorPolicy.injectBudgetMaxTokens,
          max_section_tokens: memoryOrchestratorPolicy.maxSectionTokens,
          max_ga_memory_rows: memoryOrchestratorPolicy.maxGaMemoryRows,
          max_team_experience_rows: memoryOrchestratorPolicy.maxTeamExperienceRows,
          min_team_experience_score: memoryOrchestratorPolicy.minTeamExperienceScore,
          decay_enabled: memoryOrchestratorPolicy.decayEnabled,
          decay_max_rows_per_session: memoryOrchestratorPolicy.decayMaxRowsPerSession,
          decay_min_rows_to_keep: memoryOrchestratorPolicy.decayMinRowsToKeep,
          decay_max_age_hours_l1: memoryOrchestratorPolicy.decayMaxAgeHoursL1,
          decay_max_age_hours_l2: memoryOrchestratorPolicy.decayMaxAgeHoursL2,
          decay_max_age_hours_l3: memoryOrchestratorPolicy.decayMaxAgeHoursL3,
          decay_max_age_hours_l4: memoryOrchestratorPolicy.decayMaxAgeHoursL4,
          decay_unverified_max_age_hours: memoryOrchestratorPolicy.decayUnverifiedMaxAgeHours,
          decay_min_confidence_verified: memoryOrchestratorPolicy.decayMinConfidenceVerified,
          decay_min_confidence_unverified: memoryOrchestratorPolicy.decayMinConfidenceUnverified,
          autotune: {
            adaptive_updates: memoryDecayAutotuneState.adaptiveUpdates,
            adaptive_learn_alpha: memoryDecayAutotuneState.adaptiveLearnAlpha,
            drop_ratio_ema: memoryDecayAutotuneState.dropRatioEma,
            capacity_trim_ratio_ema: memoryDecayAutotuneState.capacityTrimRatioEma,
            low_confidence_ratio_ema: memoryDecayAutotuneState.lowConfidenceRatioEma,
            age_drop_ratio_ema: memoryDecayAutotuneState.ageDropRatioEma,
            quality_low_rate_ema: memoryDecayAutotuneState.qualityLowRateEma,
            quality_pressure_ema: memoryDecayAutotuneState.qualityPressureEma,
            hard_budget_followup_delta_ema: memoryDecayAutotuneState.hardBudgetFollowupDeltaEma,
            quality_first_followup_delta_ema:
              memoryDecayAutotuneState.qualityFirstFollowupDeltaEma,
            last_reason: memoryDecayAutotuneState.lastReason,
            updated_at: memoryDecayAutotuneState.updatedAt,
            persistence_domain: memoryDecayAutotuneStatePersistenceDomain,
          },
          strategy_autotune: {
            schema_version: memoryStrategyAutotuneState.schemaVersion,
            profile: memoryStrategyAutotuneState.profile,
            inject_budget_ratio: memoryStrategyAutotuneState.injectBudgetRatio,
            max_section_tokens: memoryStrategyAutotuneState.maxSectionTokens,
            max_ga_memory_rows: memoryStrategyAutotuneState.maxGaMemoryRows,
            max_team_experience_rows: memoryStrategyAutotuneState.maxTeamExperienceRows,
            min_team_experience_score: memoryStrategyAutotuneState.minTeamExperienceScore,
            adaptive_updates: memoryStrategyAutotuneState.adaptiveUpdates,
            adaptive_learn_alpha: memoryStrategyAutotuneState.adaptiveLearnAlpha,
            quality_low_rate_ema: memoryStrategyAutotuneState.qualityLowRateEma,
            quality_pressure_ema: memoryStrategyAutotuneState.qualityPressureEma,
            average_utilization_ratio_ema: memoryStrategyAutotuneState.averageUtilizationRatioEma,
            auto_limit_triggered_rate_ema: memoryStrategyAutotuneState.autoLimitTriggeredRateEma,
            snapshot_semantic_compress_rate_ema:
              memoryStrategyAutotuneState.snapshotSemanticCompressRateEma,
            hard_budget_rate_ema: memoryStrategyAutotuneState.hardBudgetRateEma,
            quality_first_improved_rate_ema: memoryStrategyAutotuneState.qualityFirstImprovedRateEma,
            hard_budget_followup_delta_ema: memoryStrategyAutotuneState.hardBudgetFollowupDeltaEma,
            quality_first_followup_delta_ema: memoryStrategyAutotuneState.qualityFirstFollowupDeltaEma,
            last_action_direction: memoryStrategyAutotuneState.lastActionDirection,
            cooldown_turns_remaining: memoryStrategyAutotuneState.cooldownTurnsRemaining,
            tighten_signal_streak: memoryStrategyAutotuneState.tightenSignalStreak,
            relax_signal_streak: memoryStrategyAutotuneState.relaxSignalStreak,
            adaptive_action_scale: memoryStrategyAutotuneState.adaptiveActionScale,
            pending_evaluation_direction: memoryStrategyAutotuneState.pendingEvaluationDirection,
            pending_evaluation_warmup_turns: memoryStrategyAutotuneState.pendingEvaluationWarmupTurns,
            pending_baseline_budget_ratio: memoryStrategyAutotuneState.pendingBaselineInjectBudgetRatio,
            pending_baseline_section_tokens: memoryStrategyAutotuneState.pendingBaselineMaxSectionTokens,
            pending_baseline_ga_rows: memoryStrategyAutotuneState.pendingBaselineMaxGaMemoryRows,
            pending_baseline_team_rows: memoryStrategyAutotuneState.pendingBaselineMaxTeamExperienceRows,
            pending_baseline_team_score: memoryStrategyAutotuneState.pendingBaselineMinTeamExperienceScore,
            outcome_confidence_ema: memoryStrategyAutotuneState.outcomeConfidenceEma,
            last_outcome_gain: memoryStrategyAutotuneState.lastOutcomeGain,
            outcome_rollback_count: memoryStrategyAutotuneState.outcomeRollbackCount,
            outcome_negative_streak: memoryStrategyAutotuneState.outcomeNegativeStreak,
            last_reason: memoryStrategyAutotuneState.lastReason,
            updated_at: memoryStrategyAutotuneState.updatedAt,
            persistence_domain: memoryStrategyAutotuneStatePersistenceDomain,
          },
        },
        graph_quality_signals: {
          cache_window: {
            degraded: contextGraphCacheWindowDegradation.degraded,
            reason: contextGraphCacheWindowDegradation.reason,
            observed_query_hit_rate: contextGraphCacheWindowDegradation.observedQueryHitRate,
            threshold_query_hit_rate: contextGraphCacheWindowDegradation.thresholdQueryHitRate,
            observed_entries: contextGraphCacheWindowDegradation.observedEntries,
            min_entries: contextGraphCacheWindowDegradation.minEntries,
          },
          persistent_window: {
            degraded: persistentGraphWindowDegradation.degraded,
            reason: persistentGraphWindowDegradation.reason,
            observed_parsed_per_scanned: persistentGraphWindowDegradation.observedParsedPerScanned,
            observed_reused_per_scanned: persistentGraphWindowDegradation.observedReusedPerScanned,
            observed_removed_per_scanned: persistentGraphWindowDegradation.observedRemovedPerScanned,
            threshold_parsed_per_scanned_max:
              persistentGraphWindowDegradation.thresholdParsedPerScannedMax,
            threshold_reused_per_scanned_min:
              persistentGraphWindowDegradation.thresholdReusedPerScannedMin,
            threshold_removed_per_scanned_max:
              persistentGraphWindowDegradation.thresholdRemovedPerScannedMax,
            observed_entries: persistentGraphWindowDegradation.observedEntries,
            min_entries: persistentGraphWindowDegradation.minEntries,
            observed_scanned_files: persistentGraphWindowDegradation.observedScannedFiles,
            min_scanned_files: persistentGraphWindowDegradation.minScannedFiles,
          },
          combined: {
            state: graphQualitySignals.state,
            reason: graphQualitySignals.reason,
            degraded_sources: graphQualitySignals.degradedSources,
            recommended_action: graphQualitySignals.recommendedAction,
          },
        },
        prompt_quality_window: {
          path: promptQualityWindowSummary.path,
          configured_size: promptQualityWindowSummary.configuredSize,
          entries: promptQualityWindowSummary.entries,
          from_ts: promptQualityWindowSummary.fromTs,
          to_ts: promptQualityWindowSummary.toTs,
          persistence_domain: promptQualityWindowPersistenceDomain,
          average_scores: promptQualityWindowSummary.averageScores == null
            ? null
            : {
              coverage: promptQualityWindowSummary.averageScores.coverage,
              recency: promptQualityWindowSummary.averageScores.recency,
              size: promptQualityWindowSummary.averageScores.size,
              overall: promptQualityWindowSummary.averageScores.overall,
            },
          latest_scores: promptQualityWindowSummary.latestScores == null
            ? null
            : {
              coverage: promptQualityWindowSummary.latestScores.coverage,
              recency: promptQualityWindowSummary.latestScores.recency,
              size: promptQualityWindowSummary.latestScores.size,
              overall: promptQualityWindowSummary.latestScores.overall,
            },
          low_quality: {
            count: promptQualityWindowSummary.lowQualityCount,
            rate: promptQualityWindowSummary.lowQualityRate,
            threshold_overall: promptQualityWindowSummary.lowQualityThreshold,
          },
          stage_counts: promptQualityWindowSummary.stageCounts,
          signal_averages: promptQualityWindowSummary.signalAverages == null
            ? null
            : {
              recent_rows: promptQualityWindowSummary.signalAverages.recentRows,
              snapshot_sections: promptQualityWindowSummary.signalAverages.snapshotSections,
              recent_trim_rows: promptQualityWindowSummary.signalAverages.recentTrimRows,
              snapshot_trim_sections: promptQualityWindowSummary.signalAverages.snapshotTrimSections,
              snapshot_semantic_compress_sections:
                promptQualityWindowSummary.signalAverages.snapshotSemanticCompressSections,
              head_trim_retries: promptQualityWindowSummary.signalAverages.headTrimRetries,
              pre_send_overflow_ratio:
                promptQualityWindowSummary.signalAverages.preSendOverflowRatio,
              pre_send_pressure_score:
                promptQualityWindowSummary.signalAverages.preSendPressureScore,
            },
          compression_activity: {
            recent_trim_rate: promptQualityWindowSummary.compressionActivity.recentTrimRate,
            snapshot_trim_rate: promptQualityWindowSummary.compressionActivity.snapshotTrimRate,
            snapshot_semantic_compress_rate:
              promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate,
            head_trim_rate: promptQualityWindowSummary.compressionActivity.headTrimRate,
            auto_limit_triggered_rate:
              promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
            downshift_guard_triggered_rate:
              promptQualityWindowSummary.compressionActivity.downshiftGuardTriggeredRate,
          },
          strategy_activity: {
            quality_first_rate: promptQualityWindowSummary.strategyActivity.qualityFirstRate,
            hard_budget_rate: promptQualityWindowSummary.strategyActivity.hardBudgetRate,
          },
          token_budget: {
            average_estimated_tokens: promptQualityWindowSummary.tokenBudget.averageEstimatedTokens,
            average_target_token_limit: promptQualityWindowSummary.tokenBudget.averageTargetTokenLimit,
            average_utilization_ratio: promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
          },
          strategy_trends: {
            short: {
              window_size: promptQualityWindowSummary.strategyTrends.short.windowSize,
              entries: promptQualityWindowSummary.strategyTrends.short.entries,
              hard_budget_rate:
                promptQualityWindowSummary.strategyTrends.short.hardBudgetRate,
              average_overflow_ratio:
                promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio,
              average_pressure_score:
                promptQualityWindowSummary.strategyTrends.short.averagePressureScore,
            },
            medium: {
              window_size: promptQualityWindowSummary.strategyTrends.medium.windowSize,
              entries: promptQualityWindowSummary.strategyTrends.medium.entries,
              hard_budget_rate:
                promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate,
              average_overflow_ratio:
                promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio,
              average_pressure_score:
                promptQualityWindowSummary.strategyTrends.medium.averagePressureScore,
            },
            delta: {
              hard_budget_rate:
                promptQualityWindowSummary.strategyTrends.delta.hardBudgetRate,
              average_overflow_ratio:
                promptQualityWindowSummary.strategyTrends.delta.averageOverflowRatio,
              average_pressure_score:
                promptQualityWindowSummary.strategyTrends.delta.averagePressureScore,
            },
          },
          strategy_outcomes: {
            hard_budget_followup_overall_delta:
              promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta,
            quality_first_followup_overall_delta:
              promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta,
            hard_budget_recovery_rate:
              promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate,
            quality_first_improved_rate:
              promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
            hard_budget_transition_count:
              promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions,
            quality_first_transition_count:
              promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions,
          },
          pressure_trends: {
            short: {
              window_size: promptQualityWindowSummary.pressureTrends.short.windowSize,
              entries: promptQualityWindowSummary.pressureTrends.short.entries,
              snapshot_semantic_compress_rate:
                promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate,
              auto_limit_triggered_rate:
                promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
              average_utilization_ratio:
                promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
            },
            medium: {
              window_size: promptQualityWindowSummary.pressureTrends.medium.windowSize,
              entries: promptQualityWindowSummary.pressureTrends.medium.entries,
              snapshot_semantic_compress_rate:
                promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate,
              auto_limit_triggered_rate:
                promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
              average_utilization_ratio:
                promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio,
            },
            delta: {
              snapshot_semantic_compress_rate:
                promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate,
              auto_limit_triggered_rate:
                promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate,
              average_utilization_ratio:
                promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio,
            },
          },
          degradation: {
            degraded: promptQualityWindowDegradation.degraded,
            reason: promptQualityWindowDegradation.reason,
            threshold_overall: promptQualityWindowDegradation.thresholdOverall,
            threshold_low_quality_rate: promptQualityWindowDegradation.thresholdLowQualityRate,
            min_entries: promptQualityWindowDegradation.minEntries,
            observed_entries: promptQualityWindowDegradation.observedEntries,
            observed_overall: promptQualityWindowDegradation.observedOverall,
            observed_low_quality_rate: promptQualityWindowDegradation.observedLowQualityRate,
          },
        },
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
    `runtime_tool_surface_profile: ${runtimeToolContextPreview.toolSurfaceProfile} (${runtimeToolContextPreview.toolSurfaceSource})\n`,
  );
  process.stdout.write(`runtime_tool_surface_reason: ${runtimeToolContextPreview.toolSurfaceReason}\n`);
  if (runtimeToolContextPreview.toolSurfaceDecision) {
    const decisionScores = Object.entries(runtimeToolContextPreview.toolSurfaceDecision.scores)
      .map(([profile, score]) => `${profile}:${String(score)}`)
      .join(",");
    const suppressed = runtimeToolContextPreview.toolSurfaceDecision.suppressed
      .map((item) => `${item.profile}:${item.reason}:${String(item.originalScore)}->${String(item.finalScore)}`)
      .join(",");
    process.stdout.write(
      `runtime_tool_surface_decision: profile=${runtimeToolContextPreview.toolSurfaceDecision.profile} reason=${runtimeToolContextPreview.toolSurfaceDecision.reason} scores=${decisionScores || "<empty>"} suppressed=${suppressed || "<none>"}\n`,
    );
  }
  process.stdout.write(`runtime_tool_policy_version: ${runtimeToolContextPreview.toolPolicyVersion}\n`);
  process.stdout.write(
    `runtime_tool_model_visible_tools: ${runtimeToolContextPreview.modelVisibleTools.join(",")}\n`,
  );
  process.stdout.write(`runtime_tool_schema_fingerprint: ${runtimeToolContextPreview.schemaFingerprint}\n`);
  if (runtimeToolContextPreview.schemaProfilesFingerprint) {
    process.stdout.write(
      `runtime_tool_schema_profiles_fingerprint: ${runtimeToolContextPreview.schemaProfilesFingerprint}\n`,
    );
  }
  process.stdout.write(
    `runtime_tool_schema_estimated_tokens: ${String(runtimeToolContextPreview.schemaEstimatedTokens)}\n`,
  );
  process.stdout.write(
    `runtime_tool_advanced_schema: ${runtimeToolContextPreview.advancedToolSchema ? "true" : "false"}\n`,
  );
  process.stdout.write(
    `runtime_tool_schema_projection: source=${runtimeToolContextPreview.schemaProjectionSummary.source} mode=${runtimeToolContextPreview.schemaProjectionSummary.projectionMode} visible_tools=${String(runtimeToolContextPreview.schemaProjectionSummary.visibleToolCount)} dispatch_enabled=${String(runtimeToolContextPreview.schemaProjectionSummary.dispatchEnabledToolCount)} properties=${String(runtimeToolContextPreview.schemaProjectionSummary.schemaPropertyCount)} full_properties=${String(runtimeToolContextPreview.schemaProjectionSummary.fullSchemaPropertyCount)} suppressed_properties=${String(runtimeToolContextPreview.schemaProjectionSummary.suppressedSchemaPropertyCount)} fingerprint=${runtimeToolContextPreview.schemaProjectionSummary.schemaFingerprint}\n`,
  );
  process.stdout.write(
    `runtime_tool_schema_suppressed_args: ${formatRuntimeToolSuppressedArgs(runtimeToolContextPreview.schemaProjectionSummary)}\n`,
  );
  process.stdout.write(
    `runtime_tool_schema_projection_drift: checked=${runtimeToolContextPreview.schemaProjectionDrift.checked ? "true" : "false"} active=${runtimeToolContextPreview.schemaProjectionDrift.active ? "true" : "false"} reason=${runtimeToolContextPreview.schemaProjectionDrift.reason}\n`,
  );
  process.stdout.write(
    `runtime_tool_schema_projection_drift_args: ${formatRuntimeToolArgDriftDetails(runtimeToolContextPreview.schemaProjectionDrift)}\n`,
  );
  process.stdout.write(`runtime_tool_metrics_path: ${runtimeToolSurfaceMetrics.path}\n`);
  process.stdout.write(
    `runtime_tool_metrics_calls_total: ${String(runtimeToolSurfaceMetrics.callsTotal)} failed=${String(runtimeToolSurfaceMetrics.failedTotal)} deferred=${String(runtimeToolSurfaceMetrics.deferredTotal)}\n`,
  );
  process.stdout.write(
    `runtime_tool_metrics_recovery_stages: ${Object.keys(runtimeToolSurfaceMetrics.recoveryStages).length > 0 ? JSON.stringify(runtimeToolSurfaceMetrics.recoveryStages) : "<empty>"}\n`,
  );
  process.stdout.write(
    `runtime_tool_recovery_feedback: active=${runtimeToolRecoveryFeedback.active ? "true" : "false"} severity=${runtimeToolRecoveryFeedback.severity} reason=${runtimeToolRecoveryFeedback.reason} recoverable=${runtimeToolRecoveryFeedback.recoverable === null ? "<unknown>" : String(runtimeToolRecoveryFeedback.recoverable)} consumed=${runtimeToolRecoveryFeedback.consumed ? "true" : "false"} stage=${runtimeToolRecoveryFeedback.stage ?? "<none>"} action=${runtimeToolRecoveryFeedback.recommendedNextAction ?? "<none>"}\n`,
  );
  process.stdout.write(
    `runtime_tool_surface_adaptation: active=${runtimeToolContextPreview.toolSurfaceAdaptation.active ? "true" : "false"} reason=${runtimeToolContextPreview.toolSurfaceAdaptation.reason} from=${runtimeToolContextPreview.toolSurfaceAdaptation.fromProfile} applied=${runtimeToolContextPreview.toolSurfaceAdaptation.appliedProfile} recommended=${runtimeToolContextPreview.toolSurfaceAdaptation.recommendedProfile ?? "<none>"}\n`,
  );
  process.stdout.write(
    `runtime_tool_surface_adaptation_outcome: recent=${runtimeToolSurfaceAdaptationSnapshot.latestAdaptation?.outcome ?? "<none>"} profile=${runtimeToolSurfaceAdaptationSnapshot.latestAdaptation?.appliedProfile ?? "<none>"} reason=${runtimeToolSurfaceAdaptationSnapshot.latestAdaptation?.outcomeReason ?? "<none>"} count=${String(runtimeToolSurfaceAdaptationSnapshot.recentAdaptations.length)} recovery_consumptions=${String(runtimeToolSurfaceAdaptationSnapshot.recentRecoveryConsumptions.length)} latest_consumption=${runtimeToolSurfaceAdaptationSnapshot.latestRecoveryConsumption?.reason ?? "<none>"}\n`,
  );
  process.stdout.write(
    `runtime_tool_surface_adaptation_guard: active=${runtimeToolContextPreview.toolSurfaceAdaptationGuard.active ? "true" : "false"} reason=${runtimeToolContextPreview.toolSurfaceAdaptationGuard.reason} blocked_profile=${runtimeToolContextPreview.toolSurfaceAdaptationGuard.blockedProfile ?? "<none>"} matching_failures=${String(runtimeToolContextPreview.toolSurfaceAdaptationGuard.matchingFailureCount)}\n`,
  );
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
    `context_graph_cache_autotune_state: direction=${graphQualityAutotuneState.lastDirection} hold_turns_remaining=${String(graphQualityAutotuneState.holdTurnsRemaining)} downshift_warmup_streak=${String(graphQualityAutotuneState.downshiftWarmupStreak)} last_reason=${graphQualityAutotuneState.lastReason || "<none>"} updated_at=${graphQualityAutotuneState.updatedAt ?? "<none>"} adaptive_thresholds=${graphQualityAutotuneState.cacheDegradeQueryHitRateThreshold.toFixed(3)}/${graphQualityAutotuneState.persistentDegradeParsedPerScannedMax.toFixed(3)}/${graphQualityAutotuneState.persistentDegradeReusedPerScannedMin.toFixed(3)}/${graphQualityAutotuneState.persistentDegradeRemovedPerScannedMax.toFixed(3)} adaptive_alpha=${graphQualityAutotuneState.adaptiveLearnAlpha.toFixed(3)} adaptive_updates=${String(graphQualityAutotuneState.adaptiveUpdates)} adaptive_source=${graphQualityAutotuneState.adaptiveSource || "<none>"} adaptive_action_scale=${graphQualityAutotuneState.adaptiveActionScale.toFixed(3)} adaptive_action_updates=${String(graphQualityAutotuneState.adaptiveActionUpdates)} adaptive_action_source=${graphQualityAutotuneState.adaptiveActionSource || "<none>"} persistence_domain=${graphAutotuneStatePersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window: size=${contextGraphCacheWindowSummary.configuredSize} entries=${contextGraphCacheWindowSummary.entries} range=${contextGraphCacheWindowSummary.fromTs ?? "<none>"}..${contextGraphCacheWindowSummary.toTs ?? "<none>"} delta_symbol_query=${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.hit}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.miss}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.write}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.evict} delta_symbol_declaration=${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.hit}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.miss}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.write}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.evict} delta_dependency_query=${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.hit}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.miss}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.write}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.evict} delta_dependency_import=${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.hit}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.miss}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.write}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.evict} query_hit_rate=${typeof contextGraphCacheWindowSummary.queryHitRate === "number" ? contextGraphCacheWindowSummary.queryHitRate.toFixed(3) : "<none>"} overall_hit_rate=${typeof contextGraphCacheWindowSummary.overallHitRate === "number" ? contextGraphCacheWindowSummary.overallHitRate.toFixed(3) : "<none>"} persistence_domain=${graphCacheWindowPersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window_quality: entries_with_quality=${String(contextGraphCacheWindowSummary.quality.entriesWithQuality)} dependency_avg_rows=${typeof contextGraphCacheWindowSummary.quality.dependency.avgRows === "number" ? contextGraphCacheWindowSummary.quality.dependency.avgRows.toFixed(3) : "<none>"} dependency_avg_multi_hop_rows=${typeof contextGraphCacheWindowSummary.quality.dependency.avgMultiHopRows === "number" ? contextGraphCacheWindowSummary.quality.dependency.avgMultiHopRows.toFixed(3) : "<none>"} dependency_avg_max_chain_depth=${typeof contextGraphCacheWindowSummary.quality.dependency.avgMaxChainDepth === "number" ? contextGraphCacheWindowSummary.quality.dependency.avgMaxChainDepth.toFixed(3) : "<none>"} dependency_multi_hop_rate=${typeof contextGraphCacheWindowSummary.quality.dependency.multiHopRate === "number" ? contextGraphCacheWindowSummary.quality.dependency.multiHopRate.toFixed(3) : "<none>"} dependency_depth_4_plus_rate=${typeof contextGraphCacheWindowSummary.quality.dependency.depth4PlusRate === "number" ? contextGraphCacheWindowSummary.quality.dependency.depth4PlusRate.toFixed(3) : "<none>"} symbol_avg_rows=${typeof contextGraphCacheWindowSummary.quality.symbol.avgRows === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgRows.toFixed(3) : "<none>"} symbol_bridge_coverage_rate=${typeof contextGraphCacheWindowSummary.quality.symbol.bridgeCoverageRate === "number" ? contextGraphCacheWindowSummary.quality.symbol.bridgeCoverageRate.toFixed(3) : "<none>"} symbol_breadth_coverage_rate=${typeof contextGraphCacheWindowSummary.quality.symbol.breadthCoverageRate === "number" ? contextGraphCacheWindowSummary.quality.symbol.breadthCoverageRate.toFixed(3) : "<none>"} symbol_avg_bridge=${typeof contextGraphCacheWindowSummary.quality.symbol.avgBridge === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgBridge.toFixed(3) : "<none>"} symbol_avg_breadth=${typeof contextGraphCacheWindowSummary.quality.symbol.avgBreadth === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgBreadth.toFixed(3) : "<none>"} symbol_avg_refs=${typeof contextGraphCacheWindowSummary.quality.symbol.avgRefs === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgRefs.toFixed(3) : "<none>"} symbol_max_refs=${typeof contextGraphCacheWindowSummary.quality.symbol.maxRefs === "number" ? contextGraphCacheWindowSummary.quality.symbol.maxRefs.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window_guard: degraded=${contextGraphCacheWindowDegradation.degraded ? "yes" : "no"} reason=${contextGraphCacheWindowDegradation.reason} threshold_query_hit_rate=${contextGraphCacheWindowDegradation.thresholdQueryHitRate.toFixed(3)} min_entries=${contextGraphCacheWindowDegradation.minEntries} observed_entries=${contextGraphCacheWindowDegradation.observedEntries} observed_query_hit_rate=${typeof contextGraphCacheWindowDegradation.observedQueryHitRate === "number" ? contextGraphCacheWindowDegradation.observedQueryHitRate.toFixed(3) : "<none>"}\n`,
  );
  if (persistentGraphIndexStatus.enabled) {
    const refresh = persistentGraphIndexStatus.last_refresh;
    const window = persistentGraphIndexStatus.window;
    process.stdout.write(
      `context_persistent_graph_index: files=${String(persistentGraphIndexStatus.file_count ?? 0)} symbols=${String(persistentGraphIndexStatus.symbol_count ?? 0)} edges=${String(persistentGraphIndexStatus.edge_count ?? 0)} updated_at=${persistentGraphIndexStatus.updated_at ?? "<none>"} refresh=${refresh?.mode ?? "<none>"}/${String(refresh?.parsed_files ?? 0)}/${String(refresh?.reused_files ?? 0)}/${String(refresh?.removed_files ?? 0)} window_entries=${String(window?.entries ?? 0)} window_parsed_rate=${typeof window?.rates?.parsed_per_scanned === "number" ? window.rates.parsed_per_scanned.toFixed(3) : "<none>"} persistence_domain=${persistentGraphIndexPersistenceDomain} window_persistence_domain=${persistentGraphIndexWindowPersistenceDomain}\n`,
    );
    process.stdout.write(
      `context_persistent_graph_index_guard: degraded=${persistentGraphWindowDegradation.degraded ? "yes" : "no"} reason=${persistentGraphWindowDegradation.reason} threshold_parsed_max=${persistentGraphWindowDegradation.thresholdParsedPerScannedMax.toFixed(3)} threshold_reused_min=${persistentGraphWindowDegradation.thresholdReusedPerScannedMin.toFixed(3)} threshold_removed_max=${persistentGraphWindowDegradation.thresholdRemovedPerScannedMax.toFixed(3)} min_entries=${persistentGraphWindowDegradation.minEntries} min_scanned_files=${persistentGraphWindowDegradation.minScannedFiles} observed_entries=${persistentGraphWindowDegradation.observedEntries} observed_scanned_files=${persistentGraphWindowDegradation.observedScannedFiles} observed_parsed_rate=${typeof persistentGraphWindowDegradation.observedParsedPerScanned === "number" ? persistentGraphWindowDegradation.observedParsedPerScanned.toFixed(3) : "<none>"} observed_reused_rate=${typeof persistentGraphWindowDegradation.observedReusedPerScanned === "number" ? persistentGraphWindowDegradation.observedReusedPerScanned.toFixed(3) : "<none>"} observed_removed_rate=${typeof persistentGraphWindowDegradation.observedRemovedPerScanned === "number" ? persistentGraphWindowDegradation.observedRemovedPerScanned.toFixed(3) : "<none>"}\n`,
    );
  } else {
    process.stdout.write("context_persistent_graph_index: disabled\n");
  }
  process.stdout.write(
    `context_engine_graph_quality_signals: state=${graphQualitySignals.state} reason=${graphQualitySignals.reason} degraded_sources=${graphQualitySignals.degradedSources.length > 0 ? graphQualitySignals.degradedSources.join(",") : "<none>"} action=${graphQualitySignals.recommendedAction}\n`,
  );
  process.stdout.write(
    `context_engine: enabled=${contextEngineConfig.enabled ? "on" : "off"} profile=${contextEngineConfig.profile} window=${contextEngineConfig.contextWindowTokens} reserve=${contextEngineConfig.reservedOutputTokens} safety=${contextEngineConfig.safetyMarginTokens} auto_limit=${contextEngineTokenBudget.autoCompactTokenLimit} target=${contextEngineTokenBudget.targetTokenLimit} effective=${contextEngineEffectiveWindowTokens} thresholds=${contextEngineConfig.thresholds.proactiveRatio.toFixed(2)}/${contextEngineConfig.thresholds.forcedRatio.toFixed(2)}/${contextEngineConfig.thresholds.hardRatio.toFixed(2)} recovery=${contextEngineConfig.recovery.reactiveMaxRetries}/${contextEngineConfig.recovery.ptlMaxRetries}/${contextEngineConfig.recovery.circuitBreakerFailures}\n`,
  );
  process.stdout.write(
    `memory_orchestrator: enabled=${memoryOrchestratorPolicy.enabled ? "on" : "off"} version=${memoryOrchestratorPolicy.version} budget_ratio=${memoryOrchestratorPolicy.injectBudgetRatio.toFixed(2)} budget_min=${String(memoryOrchestratorPolicy.injectBudgetMinTokens)} budget_max=${String(memoryOrchestratorPolicy.injectBudgetMaxTokens)} section_max=${String(memoryOrchestratorPolicy.maxSectionTokens)} ga_rows=${String(memoryOrchestratorPolicy.maxGaMemoryRows)} team_rows=${String(memoryOrchestratorPolicy.maxTeamExperienceRows)} team_score_min=${String(memoryOrchestratorPolicy.minTeamExperienceScore)} decay_enabled=${memoryOrchestratorPolicy.decayEnabled ? "on" : "off"} decay_max_rows=${String(memoryOrchestratorPolicy.decayMaxRowsPerSession)} decay_min_keep=${String(memoryOrchestratorPolicy.decayMinRowsToKeep)} decay_age_hours=${String(memoryOrchestratorPolicy.decayMaxAgeHoursL1)}/${String(memoryOrchestratorPolicy.decayMaxAgeHoursL2)}/${String(memoryOrchestratorPolicy.decayMaxAgeHoursL3)}/${String(memoryOrchestratorPolicy.decayMaxAgeHoursL4)} decay_unverified_age_hours=${String(memoryOrchestratorPolicy.decayUnverifiedMaxAgeHours)} decay_confidence=${memoryOrchestratorPolicy.decayMinConfidenceVerified.toFixed(2)}/${memoryOrchestratorPolicy.decayMinConfidenceUnverified.toFixed(2)} autotune_updates=${String(memoryDecayAutotuneState.adaptiveUpdates)} autotune_alpha=${memoryDecayAutotuneState.adaptiveLearnAlpha.toFixed(2)} autotune_ema=${memoryDecayAutotuneState.dropRatioEma.toFixed(3)}/${memoryDecayAutotuneState.capacityTrimRatioEma.toFixed(3)}/${memoryDecayAutotuneState.lowConfidenceRatioEma.toFixed(3)}/${memoryDecayAutotuneState.ageDropRatioEma.toFixed(3)} autotune_quality_ema=${memoryDecayAutotuneState.qualityLowRateEma.toFixed(3)}/${memoryDecayAutotuneState.qualityPressureEma.toFixed(3)}/${memoryDecayAutotuneState.hardBudgetFollowupDeltaEma.toFixed(3)}/${memoryDecayAutotuneState.qualityFirstFollowupDeltaEma.toFixed(3)} autotune_last_reason=${memoryDecayAutotuneState.lastReason} autotune_updated_at=${memoryDecayAutotuneState.updatedAt ?? "<none>"} autotune_persistence_domain=${memoryDecayAutotuneStatePersistenceDomain} strategy_updates=${String(memoryStrategyAutotuneState.adaptiveUpdates)} strategy_schema=${String(memoryStrategyAutotuneState.schemaVersion)} strategy_profile=${memoryStrategyAutotuneState.profile} strategy_alpha=${memoryStrategyAutotuneState.adaptiveLearnAlpha.toFixed(2)} strategy_ema=${memoryStrategyAutotuneState.qualityLowRateEma.toFixed(3)}/${memoryStrategyAutotuneState.qualityPressureEma.toFixed(3)}/${memoryStrategyAutotuneState.hardBudgetRateEma.toFixed(3)}/${memoryStrategyAutotuneState.qualityFirstImprovedRateEma.toFixed(3)} strategy_pressure_ema=${memoryStrategyAutotuneState.averageUtilizationRatioEma.toFixed(3)}/${memoryStrategyAutotuneState.autoLimitTriggeredRateEma.toFixed(3)}/${memoryStrategyAutotuneState.snapshotSemanticCompressRateEma.toFixed(3)} strategy_followup_ema=${memoryStrategyAutotuneState.hardBudgetFollowupDeltaEma.toFixed(3)}/${memoryStrategyAutotuneState.qualityFirstFollowupDeltaEma.toFixed(3)} strategy_action=${memoryStrategyAutotuneState.lastActionDirection} strategy_cooldown=${String(memoryStrategyAutotuneState.cooldownTurnsRemaining)} strategy_streak=${String(memoryStrategyAutotuneState.tightenSignalStreak)}/${String(memoryStrategyAutotuneState.relaxSignalStreak)} strategy_scale=${memoryStrategyAutotuneState.adaptiveActionScale.toFixed(3)} strategy_pending=${memoryStrategyAutotuneState.pendingEvaluationDirection}/${String(memoryStrategyAutotuneState.pendingEvaluationWarmupTurns)} strategy_outcome=${memoryStrategyAutotuneState.lastOutcomeGain.toFixed(3)}/${memoryStrategyAutotuneState.outcomeConfidenceEma.toFixed(3)}/${String(memoryStrategyAutotuneState.outcomeRollbackCount)}/${String(memoryStrategyAutotuneState.outcomeNegativeStreak)} strategy_last_reason=${memoryStrategyAutotuneState.lastReason} strategy_updated_at=${memoryStrategyAutotuneState.updatedAt ?? "<none>"} strategy_persistence_domain=${memoryStrategyAutotuneStatePersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_config: low_quality_threshold=${(contextEngineConfig.promptQuality?.lowQualityThreshold ?? 0.6).toFixed(3)} degrade_overall=${(contextEngineConfig.promptQuality?.degradeOverallThreshold ?? 0.62).toFixed(3)} degrade_low_quality_rate=${(contextEngineConfig.promptQuality?.degradeLowQualityRateThreshold ?? 0.4).toFixed(3)} degrade_min_entries=${String(contextEngineConfig.promptQuality?.degradeMinEntries ?? 8)} guard_enabled=${contextEngineConfig.promptQuality?.guardEnabled === false ? "false" : "true"} guard_adaptive_enabled=${contextEngineConfig.promptQuality?.guardAdaptiveEnabled === false ? "false" : "true"} guard_adaptive_allowlist=${(contextEngineConfig.promptQuality?.guardAdaptiveModeAllowlist ?? ["harden", "relax"]).join(",")} guard_promote_streak=${String(contextEngineConfig.promptQuality?.guardPromoteStreak ?? 2)} guard_severe_promote_streak=${String(contextEngineConfig.promptQuality?.guardSeverePromoteStreak ?? 2)} guard_release_streak=${String(contextEngineConfig.promptQuality?.guardReleaseStreak ?? 3)} guard_hold_turns=${String(contextEngineConfig.promptQuality?.guardHoldTurns ?? 2)} guard_max_floor=${contextEngineConfig.promptQuality?.guardMaxFloorStage ?? "minimal"} guard_severe_overall=${(contextEngineConfig.promptQuality?.guardSevereOverallThreshold ?? 0.45).toFixed(3)} guard_severe_low_quality_rate=${(contextEngineConfig.promptQuality?.guardSevereLowQualityRateThreshold ?? 0.7).toFixed(3)}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_guard_state: floor=${promptQualityGuardState.floorStage} degraded_streak=${String(promptQualityGuardState.degradedStreak)} severe_streak=${String(promptQualityGuardState.severeStreak)} healthy_streak=${String(promptQualityGuardState.healthyStreak)} hold_turns_remaining=${String(promptQualityGuardState.holdTurnsRemaining)} pressure_thresholds=${promptQualityGuardState.pressureUtilizationThreshold.toFixed(3)}/${promptQualityGuardState.pressureSemanticRateThreshold.toFixed(3)}/${promptQualityGuardState.pressureAutoLimitRateThreshold.toFixed(3)}/${promptQualityGuardState.pressureJointRateThreshold.toFixed(3)} pressure_trend_state=${promptQualityGuardState.pressureTrendMomentum.toFixed(3)}/${promptQualityGuardState.pressureTrendUtilizationDelta.toFixed(3)}/${promptQualityGuardState.pressureTrendSemanticDelta.toFixed(3)}/${promptQualityGuardState.pressureTrendAutoLimitDelta.toFixed(3)} outcome_state=${String(promptQualityGuardState.outcomeRequiredTransitions)}/${promptQualityGuardState.outcomeCombinedEvidenceScore.toFixed(3)}/${String(promptQualityGuardState.outcomeHighEvidenceTurns)}/${String(promptQualityGuardState.outcomeHighEvidenceHardenTurns)}/${String(promptQualityGuardState.outcomeDriftRecentAutoActionLevels.length)}/${promptQualityGuardState.outcomeDriftRecentAutoActionLevels[promptQualityGuardState.outcomeDriftRecentAutoActionLevels.length - 1] ?? "none"} last_reason=${promptQualityGuardState.lastReason || "<none>"} updated_at=${promptQualityGuardState.updatedAt ?? "<none>"} persistence_domain=${promptQualityGuardStatePersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_guard_runtime: phase=${promptQualityGuardRuntimeAssessment.phase} transition=${promptQualityGuardRuntimeAssessment.transition} degraded=${promptQualityGuardRuntimeAssessment.degraded ? "true" : "false"} severe=${promptQualityGuardRuntimeAssessment.severe ? "true" : "false"} reason=${promptQualityGuardRuntimeAssessment.reason} triggered=${promptQualityGuardRuntimeAssessment.triggered ? "true" : "false"} floor=${promptQualityGuardRuntimeAssessment.floorStage} proposed_floor=${promptQualityGuardRuntimeAssessment.proposedFloorStage} promote_remaining=${String(promptQualityGuardRuntimeAssessment.promoteRemaining)} severe_promote_remaining=${String(promptQualityGuardRuntimeAssessment.severePromoteRemaining)} release_remaining=${String(promptQualityGuardRuntimeAssessment.releaseRemaining)} hold_turns_remaining=${String(promptQualityGuardRuntimeAssessment.holdTurnsRemaining)} observed_overall=${typeof promptQualityGuardRuntimeAssessment.observedOverall === "number" ? promptQualityGuardRuntimeAssessment.observedOverall.toFixed(3) : "<none>"} observed_low_quality_rate=${typeof promptQualityGuardRuntimeAssessment.observedLowQualityRate === "number" ? promptQualityGuardRuntimeAssessment.observedLowQualityRate.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_guard_adaptive: mode=${promptQualityGuardAdaptivePolicy.mode} reason=${promptQualityGuardAdaptivePolicy.reason} allowlist=${promptQualityGuardAdaptivePolicy.allowlist.join(",")} mode_blocked=${promptQualityGuardAdaptivePolicy.modeBlocked ? "true" : "false"} blocked_mode=${promptQualityGuardAdaptivePolicy.blockedMode ?? "<none>"} base_promote=${String(promptQualityGuardAdaptivePolicy.basePolicy.promoteStreak)} base_release=${String(promptQualityGuardAdaptivePolicy.basePolicy.releaseStreak)} effective_promote=${String(promptQualityGuardAdaptivePolicy.effectivePolicy.promoteStreak)} effective_release=${String(promptQualityGuardAdaptivePolicy.effectivePolicy.releaseStreak)} effective_hold=${String(promptQualityGuardAdaptivePolicy.effectivePolicy.holdTurns)} delta=${String(promptQualityGuardAdaptivePolicy.adjustment.promoteStreakDelta)}/${String(promptQualityGuardAdaptivePolicy.adjustment.releaseStreakDelta)}/${String(promptQualityGuardAdaptivePolicy.adjustment.holdTurnsDelta)} pressure_policy=${promptQualityGuardAdaptivePolicy.pressurePolicy.source}/${promptQualityGuardAdaptivePolicy.pressurePolicy.updated ? "updated" : "stable"}/${promptQualityGuardAdaptivePolicy.pressurePolicy.learnAlpha.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.utilizationThreshold.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.semanticRateThreshold.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.autoLimitRateThreshold.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.jointRateThreshold.toFixed(3)} trend=${promptQualityGuardAdaptivePolicy.pressurePolicy.trendMomentum.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.trendUtilizationDelta.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.trendSemanticDelta.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.trendAutoLimitDelta.toFixed(3)} flip_suppressed=${promptQualityGuardAdaptivePolicy.pressurePolicy.trendFlipSuppressed ? "true" : "false"} outcome_reliability=${String(promptQualityGuardAdaptivePolicy.outcomeReliability.requiredTransitions)}->${String(promptQualityGuardAdaptivePolicy.outcomeReliability.nextRequiredTransitions)}/${String(promptQualityGuardAdaptivePolicy.outcomeReliability.hardBudgetTransitions)}/${String(promptQualityGuardAdaptivePolicy.outcomeReliability.qualityFirstTransitions)}/${promptQualityGuardAdaptivePolicy.outcomeReliability.combinedEvidenceScore.toFixed(3)} hard_budget_reliable=${promptQualityGuardAdaptivePolicy.outcomeReliability.hardBudgetReliable ? "true" : "false"} quality_first_reliable=${promptQualityGuardAdaptivePolicy.outcomeReliability.qualityFirstReliable ? "true" : "false"} drift_guard=${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceTurns)}/${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenTurns)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenRate.toFixed(3)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenBias ? "bias" : "ok"}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.autoActionLevel}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.recommendation}/${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.entries)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.latest}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.dominant}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.alertLevel}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.activeRate.toFixed(3)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.mediumOrHardRate.toFixed(3)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.hardRate.toFixed(3)}/${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.transitionCount)} semantic_rate=${typeof promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate.toFixed(3) : "<none>"} auto_limit_rate=${typeof promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate.toFixed(3) : "<none>"} hard_budget_rate=${typeof promptQualityWindowSummary.strategyActivity.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyActivity.hardBudgetRate.toFixed(3) : "<none>"} quality_first_rate=${typeof promptQualityWindowSummary.strategyActivity.qualityFirstRate === "number" ? promptQualityWindowSummary.strategyActivity.qualityFirstRate.toFixed(3) : "<none>"} avg_pre_send_overflow=${typeof promptQualityWindowSummary.signalAverages?.preSendOverflowRatio === "number" ? promptQualityWindowSummary.signalAverages.preSendOverflowRatio.toFixed(3) : "<none>"} avg_pre_send_pressure=${typeof promptQualityWindowSummary.signalAverages?.preSendPressureScore === "number" ? promptQualityWindowSummary.signalAverages.preSendPressureScore.toFixed(3) : "<none>"} avg_utilization=${typeof promptQualityWindowSummary.tokenBudget.averageUtilizationRatio === "number" ? promptQualityWindowSummary.tokenBudget.averageUtilizationRatio.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_window: size=${promptQualityWindowSummary.configuredSize} entries=${promptQualityWindowSummary.entries} range=${promptQualityWindowSummary.fromTs ?? "<none>"}..${promptQualityWindowSummary.toTs ?? "<none>"} avg_overall=${typeof promptQualityWindowSummary.averageScores?.overall === "number" ? promptQualityWindowSummary.averageScores.overall.toFixed(3) : "<none>"} latest_overall=${typeof promptQualityWindowSummary.latestScores?.overall === "number" ? promptQualityWindowSummary.latestScores.overall.toFixed(3) : "<none>"} low_quality_rate=${typeof promptQualityWindowSummary.lowQualityRate === "number" ? promptQualityWindowSummary.lowQualityRate.toFixed(3) : "<none>"} degraded=${promptQualityWindowDegradation.degraded ? "yes" : "no"} reason=${promptQualityWindowDegradation.reason} persistence_domain=${promptQualityWindowPersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_window_signals: avg_recent_rows=${typeof promptQualityWindowSummary.signalAverages?.recentRows === "number" ? promptQualityWindowSummary.signalAverages.recentRows.toFixed(3) : "<none>"} avg_snapshot_sections=${typeof promptQualityWindowSummary.signalAverages?.snapshotSections === "number" ? promptQualityWindowSummary.signalAverages.snapshotSections.toFixed(3) : "<none>"} avg_recent_trim_rows=${typeof promptQualityWindowSummary.signalAverages?.recentTrimRows === "number" ? promptQualityWindowSummary.signalAverages.recentTrimRows.toFixed(3) : "<none>"} avg_snapshot_trim_sections=${typeof promptQualityWindowSummary.signalAverages?.snapshotTrimSections === "number" ? promptQualityWindowSummary.signalAverages.snapshotTrimSections.toFixed(3) : "<none>"} avg_snapshot_semantic_compress_sections=${typeof promptQualityWindowSummary.signalAverages?.snapshotSemanticCompressSections === "number" ? promptQualityWindowSummary.signalAverages.snapshotSemanticCompressSections.toFixed(3) : "<none>"} avg_head_trim_retries=${typeof promptQualityWindowSummary.signalAverages?.headTrimRetries === "number" ? promptQualityWindowSummary.signalAverages.headTrimRetries.toFixed(3) : "<none>"} avg_pre_send_overflow=${typeof promptQualityWindowSummary.signalAverages?.preSendOverflowRatio === "number" ? promptQualityWindowSummary.signalAverages.preSendOverflowRatio.toFixed(3) : "<none>"} avg_pre_send_pressure=${typeof promptQualityWindowSummary.signalAverages?.preSendPressureScore === "number" ? promptQualityWindowSummary.signalAverages.preSendPressureScore.toFixed(3) : "<none>"} semantic_rate=${typeof promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate.toFixed(3) : "<none>"} auto_limit_rate=${typeof promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate.toFixed(3) : "<none>"} hard_budget_rate=${typeof promptQualityWindowSummary.strategyActivity.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyActivity.hardBudgetRate.toFixed(3) : "<none>"} quality_first_rate=${typeof promptQualityWindowSummary.strategyActivity.qualityFirstRate === "number" ? promptQualityWindowSummary.strategyActivity.qualityFirstRate.toFixed(3) : "<none>"} avg_utilization=${typeof promptQualityWindowSummary.tokenBudget.averageUtilizationRatio === "number" ? promptQualityWindowSummary.tokenBudget.averageUtilizationRatio.toFixed(3) : "<none>"} trend_short=${typeof promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio === "number" ? promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate.toFixed(3) : "<none>"} trend_medium=${typeof promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio === "number" ? promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate.toFixed(3) : "<none>"} trend_delta=${typeof promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio === "number" ? promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate.toFixed(3) : "<none>"} strategy_trend_short=${typeof promptQualityWindowSummary.strategyTrends.short.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyTrends.short.hardBudgetRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio === "number" ? promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.short.averagePressureScore === "number" ? promptQualityWindowSummary.strategyTrends.short.averagePressureScore.toFixed(3) : "<none>"} strategy_trend_medium=${typeof promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio === "number" ? promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.medium.averagePressureScore === "number" ? promptQualityWindowSummary.strategyTrends.medium.averagePressureScore.toFixed(3) : "<none>"} strategy_trend_delta=${typeof promptQualityWindowSummary.strategyTrends.delta.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyTrends.delta.hardBudgetRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.delta.averageOverflowRatio === "number" ? promptQualityWindowSummary.strategyTrends.delta.averageOverflowRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.delta.averagePressureScore === "number" ? promptQualityWindowSummary.strategyTrends.delta.averagePressureScore.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_strategy_outcomes: hard_budget_followup_delta=${typeof promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta === "number" ? promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta.toFixed(3) : "<none>"} quality_first_followup_delta=${typeof promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta === "number" ? promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta.toFixed(3) : "<none>"} hard_budget_recovery_rate=${typeof promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate === "number" ? promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate.toFixed(3) : "<none>"} quality_first_improved_rate=${typeof promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate === "number" ? promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate.toFixed(3) : "<none>"} hard_budget_transitions=${String(promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions)} quality_first_transitions=${String(promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions)}\n`,
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
