import { type SessionProviderRuntimeState } from "../../start/session-registry";

interface ProviderHealthStatusInput {
  state: SessionProviderRuntimeState | undefined;
  failureThreshold: number;
}

export interface ProviderHealthSnapshotInput {
  sessionKey: string;
  stickyProvider?: string;
  failureThreshold: number;
  cooldownSecs: number;
  providers: ReadonlyArray<{
    name: string;
    maxInFlight?: number;
    requestsPerMinute?: number;
    burst?: number;
  }>;
  states: readonly SessionProviderRuntimeState[];
}

function providerHealthStatus(
  input: ProviderHealthStatusInput,
): "CLOSED" | "OPEN" | "HALF_OPEN" {
  if (!input.state) {
    return "CLOSED";
  }
  const nowMs = Date.now();
  if (input.state.circuit_open_until_ms > nowMs) {
    return "OPEN";
  }
  if (input.state.consecutive_failures >= input.failureThreshold) {
    return "HALF_OPEN";
  }
  return "CLOSED";
}

function formatProviderHealthStatusLabel(status: "CLOSED" | "OPEN" | "HALF_OPEN"): string {
  switch (status) {
    case "OPEN":
      return "熔断中(OPEN)";
    case "HALF_OPEN":
      return "半开(HALF_OPEN)";
    case "CLOSED":
    default:
      return "正常(CLOSED)";
  }
}

export function renderProviderHealthScreen(input: ProviderHealthSnapshotInput): string {
  const lines: string[] = [];
  lines.push("[provider-health]");
  lines.push(`会话: ${input.sessionKey}`);
  lines.push(`固定供应商: ${input.stickyProvider ?? "无"}`);
  lines.push(
    `熔断: 失败阈值=${String(input.failureThreshold)} 冷却秒=${String(input.cooldownSecs)}`,
  );
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
  if (names.length === 0) {
    lines.push("- 无供应商");
    return `${lines.join("\n")}\n\n`;
  }
  for (const name of names) {
    const state = stateByName.get(name);
    const provider = providerByName.get(name);
    const status = providerHealthStatus({
      state,
      failureThreshold: input.failureThreshold,
    });
    const openUntil =
      state && state.circuit_open_until_ms > 0
        ? new Date(state.circuit_open_until_ms).toISOString()
        : "无";
    const errorClass = state?.last_error_class ?? "-";
    const ewmaLatencyMs =
      typeof state?.ewma_latency_ms === "number"
        ? state.ewma_latency_ms.toFixed(1)
        : "无";
    const ewmaErrorRate =
      typeof state?.ewma_error_rate === "number"
        ? state.ewma_error_rate.toFixed(3)
        : "无";
    const maxInFlight = provider?.maxInFlight ?? "无";
    const requestsPerMinute = provider?.requestsPerMinute ?? "无";
    const burst = provider?.burst ?? "无";
    lines.push(
      `- ${name} 状态=${formatProviderHealthStatusLabel(status)} 失败=${String(state?.consecutive_failures ?? 0)} 打开到=${openUntil} 最后错误=${errorClass} 延迟EWMA_ms=${ewmaLatencyMs} 错误率EWMA=${ewmaErrorRate} 最大并发=${String(maxInFlight)} rpm=${String(requestsPerMinute)} burst=${String(burst)}`,
    );
  }
  return `${lines.join("\n")}\n\n`;
}
