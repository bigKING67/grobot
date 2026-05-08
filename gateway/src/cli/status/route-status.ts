import { readFileSync } from "node:fs";
import {
  findSessionRecord,
  normalizeSessionRegistryPayload,
  resolveSessionRegistryReadPath,
  type SessionProviderRuntimeState,
} from "../start/session-registry";

interface ObservedProviderRuntimeState {
  providerName: string;
  consecutiveFailures: number;
  circuitOpenUntilMs: number;
  circuitOpen: boolean;
  lastErrorClass?: string;
  lastErrorMessage?: string;
  lastErrorData?: Record<string, unknown>;
  lastFailedAt?: string;
  lastSucceededAt?: string;
  ewmaLatencyMs?: number;
  ewmaErrorRate?: number;
}

export interface RouteObservedRuntimeSummary {
  source: string | null;
  activeSessionId: string | null;
  updatedAt: string | null;
  stickyProvider: string | null;
  selectedProvider: string | null;
  reason: string;
  providerRuntimeStates: ObservedProviderRuntimeState[];
}

export function readRouteObservedRuntimeSummary(input: {
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
      lastErrorData: state.last_error_data,
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

export interface RouteDecisionSummary {
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

export function resolveRouteDecisionSummary(input: {
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

export function serializeRouteDecisionSummary(summary: RouteDecisionSummary): Record<string, unknown> {
  return {
    strategy: summary.strategy,
    primary_provider: summary.primaryProvider,
    configured_primary_provider: summary.configuredPrimaryProvider,
    requested_provider: summary.requestedProvider,
    ordered_providers: summary.orderedProviders,
    source: summary.source,
    reason: summary.reason,
    observed: {
      source: summary.observed.source,
      active_session_id: summary.observed.activeSessionId,
      updated_at: summary.observed.updatedAt,
      sticky_provider: summary.observed.stickyProvider,
      selected_provider: summary.observed.selectedProvider,
      reason: summary.observed.reason,
      provider_runtime_states: summary.observed.providerRuntimeStates.map((state) => ({
        provider_name: state.providerName,
        consecutive_failures: state.consecutiveFailures,
        circuit_open_until_ms: state.circuitOpenUntilMs,
        circuit_open: state.circuitOpen,
        last_error_class: state.lastErrorClass ?? null,
        last_error_message: state.lastErrorMessage ?? null,
        last_error_data: state.lastErrorData ?? null,
        last_failed_at: state.lastFailedAt ?? null,
        last_succeeded_at: state.lastSucceededAt ?? null,
        ewma_latency_ms: state.ewmaLatencyMs ?? null,
        ewma_error_rate: state.ewmaErrorRate ?? null,
      })),
    },
    failover: {
      circuit_failures: summary.failover.circuitFailures,
      circuit_cooldown_secs: summary.failover.circuitCooldownSecs,
      sticky_mode: summary.failover.stickyMode,
    },
  };
}

export function formatRouteStatusLines(summary: RouteDecisionSummary): string[] {
  const providerErrorLines = summary.observed.providerRuntimeStates
    .filter((state) => state.lastErrorClass || state.lastErrorData)
    .map((state) => {
      const errorData = state.lastErrorData ?? {};
      const httpStatus = typeof errorData.http_status === "number"
        ? ` http_status=${String(errorData.http_status)}`
        : "";
      const retryable = typeof errorData.retryable === "boolean"
        ? ` retryable=${String(errorData.retryable)}`
        : "";
      const attempt = typeof errorData.attempt === "number" || typeof errorData.max_attempts === "number"
        ? ` attempts=${String(errorData.attempt ?? "<none>")}/${String(errorData.max_attempts ?? "<none>")}`
        : "";
      const diagnosticKind = typeof errorData.diagnostic_kind === "string"
        ? ` diagnostic=${errorData.diagnostic_kind}`
        : "";
      return `${state.providerName}:${state.lastErrorClass ?? "<none>"}${diagnosticKind}${httpStatus}${attempt}${retryable}`;
    });
  return [
    `route_decision: strategy=${summary.strategy} primary=${summary.primaryProvider ?? "<none>"} configured=${summary.configuredPrimaryProvider ?? "<none>"} requested=${summary.requestedProvider ?? "<none>"} reason=${summary.reason} source=${summary.source ?? "<none>"}`,
    `route_ordered_providers: ${summary.orderedProviders.length > 0 ? summary.orderedProviders.join(" -> ") : "<none>"}`,
    `route_observed: selected=${summary.observed.selectedProvider ?? "<none>"} sticky=${summary.observed.stickyProvider ?? "<none>"} reason=${summary.observed.reason} session_id=${summary.observed.activeSessionId ?? "<none>"}`,
    `route_provider_errors: ${providerErrorLines.length > 0 ? providerErrorLines.join(" | ") : "<none>"}`,
    `route_failover: circuit_failures=${summary.failover.circuitFailures} circuit_cooldown_secs=${summary.failover.circuitCooldownSecs} sticky_mode=${summary.failover.stickyMode}`,
  ];
}
