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

export function renderProviderHealthScreen(input: ProviderHealthSnapshotInput): string {
  const lines: string[] = [];
  lines.push("[provider-health]");
  lines.push(`session: ${input.sessionKey}`);
  lines.push(`sticky_provider: ${input.stickyProvider ?? "<none>"}`);
  lines.push(
    `circuit: failures=${String(input.failureThreshold)} cooldown_secs=${String(input.cooldownSecs)}`,
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
    lines.push("- <none>");
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
        : "n/a";
    const errorClass = state?.last_error_class ?? "-";
    const ewmaLatencyMs =
      typeof state?.ewma_latency_ms === "number"
        ? state.ewma_latency_ms.toFixed(1)
        : "n/a";
    const ewmaErrorRate =
      typeof state?.ewma_error_rate === "number"
        ? state.ewma_error_rate.toFixed(3)
        : "n/a";
    const maxInFlight = provider?.maxInFlight ?? "n/a";
    const requestsPerMinute = provider?.requestsPerMinute ?? "n/a";
    const burst = provider?.burst ?? "n/a";
    lines.push(
      `- ${name} status=${status} failures=${String(state?.consecutive_failures ?? 0)} open_until=${openUntil} last_error=${errorClass} ewma_latency_ms=${ewmaLatencyMs} ewma_error_rate=${ewmaErrorRate} max_inflight=${String(maxInFlight)} rpm=${String(requestsPerMinute)} burst=${String(burst)}`,
    );
  }
  return `${lines.join("\n")}\n\n`;
}
