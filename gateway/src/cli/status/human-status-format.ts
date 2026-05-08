import type { InfoPanelRow } from "../tui/components/info-panel/contract";
import type { ProviderLastErrorHealth } from "../services/provider-failure-health";
import type { StatusProviderProbeResult } from "./provider-probe-status";
import type { RouteDecisionSummary } from "./route-status";
import type { RuntimeHealthStatus } from "./runtime-health-format";

export function displayValue(value: string | null | undefined, fallback = "not configured"): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "<auto>") {
    return "auto";
  }
  if (normalized === "<unset>") {
    return "not configured";
  }
  if (normalized === "<not-found>") {
    return "not found";
  }
  return normalized;
}

export function humanizeMachineToken(value: string | null | undefined, fallback = "unknown"): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  const labels: Record<string, string> = {
    "config_selected_provider": "config selected provider",
    "config-toml": "config file",
    "runtime.tools.describe": "runtime describe",
    "session_registry_unavailable": "session state unavailable",
    "session_provider_health_fallback": "provider health fallback",
    "session_sticky_provider": "session sticky provider",
    "session_sticky_last_error_nonretryable_fallback_health_provider": "sticky provider non-retryable, health fallback",
    "session_sticky_last_error_exhausted_fallback_health_provider": "sticky provider exhausted, health fallback",
    "sticky+score": "sticky routing + score fallback",
    "typescript-gateway": "TypeScript Gateway",
    "window_stable": "window stable",
    "balanced": "balanced",
    "coding": "coding",
    "matched": "matched",
    "stable": "stable",
  };
  const labeled = labels[normalized];
  if (labeled) {
    return labeled;
  }
  return normalized.replace(/\+/g, " + ").replace(/[_-]+/g, " ");
}

export function humanizeConfigSource(value: string | null | undefined): string {
  switch (value) {
    case "project_work_dir":
      return "workspace config";
    case "project_root":
      return "project config";
    case "home":
      return "user config";
    case "custom":
      return "custom config";
    case "none":
    case undefined:
    case null:
      return "not found";
    default:
      return humanizeMachineToken(value);
  }
}

export function humanizeStatusSource(
  value: string | null | undefined,
  configSource: string,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    return humanizeConfigSource(configSource);
  }
  if (normalized.startsWith("config_toml:")) {
    return humanizeConfigSource(configSource);
  }
  if (normalized === "env") {
    return "environment";
  }
  if (normalized === "cli") {
    return "CLI arg";
  }
  return humanizeMachineToken(normalized);
}

export function humanizeExecutionSource(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "default";
  }
  switch (normalized) {
    case "cli":
      return "CLI arg";
    case "env":
      return "environment";
    case "config":
    case "config_toml":
      return "config file";
    case "default":
      return "default";
    default:
      return humanizeMachineToken(normalized);
  }
}

function humanizeRuntimeHealthDetail(detail: string | null | undefined, ok: boolean): string {
  const normalized = detail?.trim();
  if (!normalized || normalized === "runtime.health=ok") {
    return ok ? "available" : "no details";
  }
  return humanizeMachineToken(normalized);
}

export function enabledText(value: boolean): string {
  return value ? "on" : "off";
}

function humanizeProviderRouteHealth(
  health: ProviderLastErrorHealth | undefined,
): string {
  if (!health || health.scorePenalty <= 0) {
    return "";
  }
  if (health.stickyBypassReason === "last_error_nonretryable") {
    return " · prefer alternate";
  }
  if (health.stickyBypassReason === "last_error_exhausted") {
    return " · exhausted · prefer alternate";
  }
  return " · route de-prioritized";
}

export function formatRouteSummary(row: RouteDecisionSummary): InfoPanelRow {
  const latestProviderError = row.observed.providerRuntimeStates.find(
    (state) => state.lastErrorClass || state.lastErrorData,
  );
  const latestErrorData = latestProviderError?.lastErrorData ?? {};
  const latestHttpStatus = typeof latestErrorData.http_status === "number"
    ? ` · HTTP ${String(latestErrorData.http_status)}`
    : "";
  const latestRetryable = typeof latestErrorData.retryable === "boolean"
    ? ` · retryable ${String(latestErrorData.retryable)}`
    : "";
  const latestProviderErrorLine = latestProviderError
    ? `last provider error ${latestProviderError.providerName}:${humanizeMachineToken(latestProviderError.lastErrorClass ?? "unknown")}${latestHttpStatus}${latestRetryable}${humanizeProviderRouteHealth(latestProviderError.lastErrorHealth)}`
    : null;
  return {
    title: `Route ${displayValue(row.primaryProvider, "no available provider")}`,
    detailLines: [
      `strategy ${humanizeMachineToken(row.strategy)} · reason ${humanizeMachineToken(row.reason)}`,
      `candidates ${row.orderedProviders.length > 0 ? row.orderedProviders.join(" -> ") : "none"}`,
      `sticky ${displayValue(row.observed.stickyProvider, "none")} · current ${displayValue(row.observed.selectedProvider, "none")}`,
      ...(latestProviderErrorLine ? [latestProviderErrorLine] : []),
    ],
  };
}

export function formatRuntimeHealthSummary(
  runtimeHealth: RuntimeHealthStatus | undefined,
  runtimeBinaryPath: string | undefined,
): InfoPanelRow | undefined {
  if (!runtimeHealth || !runtimeBinaryPath) {
    return undefined;
  }
  return {
    title: `Runtime ${runtimeHealth.ok ? "healthy" : "needs check"}`,
    detailLines: [
      `path ${runtimeBinaryPath}`,
      `status ${humanizeRuntimeHealthDetail(runtimeHealth.detail, runtimeHealth.ok)}`,
    ],
  };
}

export function formatProbeSummary(
  probe: StatusProviderProbeResult | undefined,
): InfoPanelRow | undefined {
  if (!probe) {
    return undefined;
  }
  const detailLines = [`status ${humanizeMachineToken(probe.detail)}`];
  if (typeof probe.httpStatus === "number" && probe.httpStatus > 0) {
    detailLines.push(`HTTP ${String(probe.httpStatus)}`);
  }
  if (typeof probe.modelCount === "number") {
    detailLines.push(`models ${String(probe.modelCount)}`);
  }
  if (probe.selectedModel) {
    detailLines.push(`selected ${probe.selectedModel} · ${probe.selectedFound ? "found" : "not found"}`);
  }
  if (probe.resolvedModel) {
    detailLines.push(`resolved ${probe.resolvedModel}${probe.autoSelected ? " · auto selected" : ""}`);
  }
  return {
    title: `Probe ${humanizeMachineToken(probe.state)}`,
    detailLines,
  };
}
