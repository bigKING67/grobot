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
      return "熔断中";
    case "HALF_OPEN":
      return "半开";
    case "CLOSED":
    default:
      return "正常";
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
    : "无";
}

function formatOptionalMetric(value: number | undefined, digits: number, suffix: string): string {
  const formatted = formatOptionalNumber(value, digits);
  return formatted === "无" ? "无" : `${formatted}${suffix}`;
}

function formatOptionalRate(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "无";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatSessionLabel(value: string): string {
  const normalized = compactSpaces(value);
  if (!normalized) {
    return "当前会话";
  }
  const segments = normalized.split(":").filter((item) => item.length > 0);
  return segments[segments.length - 1] ?? "当前会话";
}

function formatSeconds(value: number): string {
  return `${String(value)} 秒`;
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
  if (!normalized || normalized === "无") {
    return undefined;
  }
  return `会话固定通道 ${normalized}`;
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
          `失败 ${String(state?.consecutive_failures ?? 0)}`,
          `延迟 ${formatOptionalMetric(state?.ewma_latency_ms, 1, "ms")}`,
          `错误率 ${formatOptionalRate(state?.ewma_error_rate)}`,
        ].join(" · "),
      ),
    ];
    const metricsLine = compactSpaces(
      [
        `并发 ${String(provider?.maxInFlight ?? "无")}`,
        `每分钟 ${String(provider?.requestsPerMinute ?? "无")}`,
        `突发 ${String(provider?.burst ?? "无")}`,
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
      detailLines.push(`打开至 ${openUntil}`);
    }
    if (state?.last_error_class) {
      detailLines.push(`最近错误 ${formatTuiErrorClassLabel(state.last_error_class)}`);
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
    title: "模型通道",
    subtitle: [
      `会话 ${formatSessionLabel(input.sessionKey)}`,
      formatStickyProviderLabel(input.stickyProvider),
      `阈值 ${String(input.failureThreshold)}`,
      `冷却 ${formatSeconds(input.cooldownSecs)}`,
    ].filter(Boolean).join(" · "),
    sessionKey: input.sessionKey,
    stickyProvider: input.stickyProvider ?? "无",
    rows,
    emptyMessage: rows.length === 0 ? "暂无模型通道" : undefined,
  };
}

export function renderProviderHealthScreen(input: ProviderHealthSnapshotInput): string {
  return `${renderReactProviderHealthScreen(buildProviderHealthViewModel(input))}\n`;
}
