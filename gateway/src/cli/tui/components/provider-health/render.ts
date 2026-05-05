import { renderReactProviderHealthScreen } from "../../react/provider-health";
import { compactSpaces } from "../../terminal/display-width";
import { type SessionProviderRuntimeState } from "../../../start/session-registry";
import { formatTuiErrorClassLabel } from "../error-labels";
import type {
  ProviderHealthSnapshotInput,
  ProviderHealthStatus,
  ProviderHealthViewModel,
} from "./contract";

interface ProviderHealthStatusInput {
  state: SessionProviderRuntimeState | undefined;
  failureThreshold: number;
  nowMs: number;
}

function providerHealthStatus(input: ProviderHealthStatusInput): ProviderHealthStatus {
  if (!input.state) {
    return "CLOSED";
  }
  if (input.state.circuit_open_until_ms > input.nowMs) {
    return "OPEN";
  }
  if (input.state.consecutive_failures >= input.failureThreshold) {
    return "HALF_OPEN";
  }
  return "CLOSED";
}

function formatProviderHealthStatusLabel(status: ProviderHealthStatus): string {
  switch (status) {
    case "OPEN":
      return "Open";
    case "HALF_OPEN":
      return "Half-open";
    case "CLOSED":
    default:
      return "Healthy";
  }
}

function severityForStatus(status: ProviderHealthStatus): "ok" | "warning" | "error" {
  if (status === "OPEN") {
    return "error";
  }
  if (status === "HALF_OPEN") {
    return "warning";
  }
  return "ok";
}

function formatOptionalNumber(value: number | undefined, digits: number): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "none";
}

function formatOptionalMetric(value: number | undefined, digits: number, suffix: string): string {
  const formatted = formatOptionalNumber(value, digits);
  return formatted === "none" ? "none" : `${formatted}${suffix}`;
}

function formatOptionalRate(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "none";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatSessionLabel(value: string): string {
  const normalized = compactSpaces(value);
  if (!normalized) {
    return "current session";
  }
  const segments = normalized.split(":").filter((item) => item.length > 0);
  return segments[segments.length - 1] ?? "current session";
}

function formatSeconds(value: number): string {
  return `${String(value)}s`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatOpenUntil(
  state: SessionProviderRuntimeState | undefined,
): string | undefined {
  if (!state || state.circuit_open_until_ms <= 0) {
    return undefined;
  }
  return formatLocalDateTime(state.circuit_open_until_ms);
}

function formatStickyProviderLabel(value: string | undefined): string | undefined {
  const normalized = compactSpaces(value ?? "");
  if (!normalized || normalized === "无" || normalized.toLowerCase() === "none") {
    return undefined;
  }
  return `Sticky provider ${normalized}`;
}

export function buildProviderHealthViewModel(
  input: ProviderHealthSnapshotInput,
): ProviderHealthViewModel {
  const stateByName = new Map<string, SessionProviderRuntimeState>();
  const providerByName = new Map<
    string,
    {
      name: string;
      maxInFlight?: number;
      requestsPerMinute?: number;
      burst?: number;
    }
  >();
  for (const state of input.states) {
    stateByName.set(state.provider_name, state);
  }
  for (const provider of input.providers) {
    providerByName.set(provider.name, provider);
  }
  const names =
    input.providers.length > 0
      ? input.providers.map((item) => item.name)
      : Array.from(stateByName.keys());
  const rows = names.map((name) => {
    const state = stateByName.get(name);
    const provider = providerByName.get(name);
    const status = providerHealthStatus({
      state,
      failureThreshold: input.failureThreshold,
      nowMs: input.nowMs ?? Date.now(),
    });
    const detailLines = [
      compactSpaces(
        [
          `failures ${String(state?.consecutive_failures ?? 0)}`,
          `latency ${formatOptionalMetric(state?.ewma_latency_ms, 1, "ms")}`,
          `error rate ${formatOptionalRate(state?.ewma_error_rate)}`,
        ].join(" · "),
      ),
    ];
    const metricsLine = compactSpaces(
      [
        `in-flight ${String(provider?.maxInFlight ?? "none")}`,
        `rate ${String(provider?.requestsPerMinute ?? "none")}/min`,
        `burst-cap ${String(provider?.burst ?? "none")}`,
      ].join(" · "),
    );
    if (
      provider
      && (
        typeof provider.maxInFlight === "number"
        || typeof provider.requestsPerMinute === "number"
        || typeof provider.burst === "number"
      )
    ) {
      detailLines.push(metricsLine);
    }
    const openUntil = formatOpenUntil(state);
    if (openUntil) {
      detailLines.push(`open until ${openUntil}`);
    }
    if (state?.last_error_class) {
      detailLines.push(`last error ${formatTuiErrorClassLabel(state.last_error_class)}`);
    }
    return {
      name,
      status,
      statusLabel: formatProviderHealthStatusLabel(status),
      severity: severityForStatus(status),
      detailLines,
    };
  });
  return {
    title: "Model providers",
    subtitle: [
      `session ${formatSessionLabel(input.sessionKey)}`,
      formatStickyProviderLabel(input.stickyProvider),
      `threshold ${String(input.failureThreshold)}`,
      `cooldown ${formatSeconds(input.cooldownSecs)}`,
    ].filter(Boolean).join(" · "),
    sessionKey: input.sessionKey,
    stickyProvider: input.stickyProvider ?? "none",
    rows,
    emptyMessage: rows.length === 0 ? "No model providers" : undefined,
  };
}

export function renderProviderHealthScreen(input: ProviderHealthSnapshotInput): string {
  return `${renderReactProviderHealthScreen(buildProviderHealthViewModel(input))}\n`;
}
