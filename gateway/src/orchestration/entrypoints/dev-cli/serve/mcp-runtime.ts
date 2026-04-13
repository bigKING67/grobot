export interface MCPRuntimeState {
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  retryCalls: number;
  recoveredCalls: number;
  policyDeniedCalls: number;
  gateRejectedCalls: number;
  timeoutFailures: number;
  transportFailures: number;
  toolFailures: number;
  unknownFailures: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
  circuitOpenUntil: number;
  latencyMsSamples: number[];
  errorBuckets: Record<string, number>;
}

function resetMcpRuntimeState(state: MCPRuntimeState): void {
  state.totalCalls = 0;
  state.successCalls = 0;
  state.failureCalls = 0;
  state.retryCalls = 0;
  state.recoveredCalls = 0;
  state.policyDeniedCalls = 0;
  state.gateRejectedCalls = 0;
  state.timeoutFailures = 0;
  state.transportFailures = 0;
  state.toolFailures = 0;
  state.unknownFailures = 0;
  state.totalLatencyMs = 0;
  state.maxLatencyMs = 0;
  state.circuitOpenUntil = 0;
  state.latencyMsSamples = [];
  state.errorBuckets = {};
}

export function normalizeMcpServerName(name: string): string {
  return name.trim().toLowerCase();
}

export function resetMcpServerStates(
  states: Map<string, MCPRuntimeState>,
  targetServer: string | undefined,
): number {
  if (typeof targetServer === "string" && targetServer.trim().length > 0) {
    const state = states.get(normalizeMcpServerName(targetServer));
    if (!state) {
      return 0;
    }
    resetMcpRuntimeState(state);
    return 1;
  }
  let resetCount = 0;
  for (const state of states.values()) {
    resetMcpRuntimeState(state);
    resetCount += 1;
  }
  return resetCount;
}

function normalizeLatencyMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Number(value.toFixed(3));
}

function latencyPercentile(values: number[], percentile: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].filter((item) => Number.isFinite(item) && item >= 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1));
  return normalizeLatencyMs(sorted[idx]);
}

export function aggregateMcpRuntimeSummary(
  states: Map<string, MCPRuntimeState>,
  serverNames?: string[],
): Record<string, unknown> {
  const keys = new Set(
    (serverNames ?? [])
      .map((name) => normalizeMcpServerName(name))
      .filter((name) => name.length > 0),
  );
  let serversConsidered = 0;
  let serversWithCircuitOpen = 0;
  let totalCalls = 0;
  let successCalls = 0;
  let failureCalls = 0;
  let retryCalls = 0;
  let recoveredCalls = 0;
  let policyDeniedCalls = 0;
  let gateRejectedCalls = 0;
  let timeoutFailures = 0;
  let transportFailures = 0;
  let toolFailures = 0;
  let unknownFailures = 0;
  let totalLatencyMs = 0;
  let maxLatencyMs = 0;
  const allSamples: number[] = [];
  const errorTotals: Record<string, number> = {};

  for (const [name, state] of states.entries()) {
    if (keys.size > 0 && !keys.has(name)) {
      continue;
    }
    serversConsidered += 1;
    totalCalls += state.totalCalls;
    successCalls += state.successCalls;
    failureCalls += state.failureCalls;
    retryCalls += state.retryCalls;
    recoveredCalls += state.recoveredCalls;
    policyDeniedCalls += state.policyDeniedCalls;
    gateRejectedCalls += state.gateRejectedCalls;
    timeoutFailures += state.timeoutFailures;
    transportFailures += state.transportFailures;
    toolFailures += state.toolFailures;
    unknownFailures += state.unknownFailures;
    totalLatencyMs += state.totalLatencyMs;
    maxLatencyMs = Math.max(maxLatencyMs, state.maxLatencyMs);
    allSamples.push(...state.latencyMsSamples);
    if (state.circuitOpenUntil > Date.now() / 1_000) {
      serversWithCircuitOpen += 1;
    }
    for (const [error, count] of Object.entries(state.errorBuckets)) {
      errorTotals[error] = (errorTotals[error] ?? 0) + count;
    }
  }

  const avgLatencyMs = totalCalls > 0 ? totalLatencyMs / totalCalls : 0;
  const topErrors = Object.entries(errorTotals)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([error, count]) => ({ error, count }));

  return {
    servers_considered: serversConsidered,
    servers_with_circuit_open: serversWithCircuitOpen,
    total_calls: totalCalls,
    success_calls: successCalls,
    failure_calls: failureCalls,
    retry_calls: retryCalls,
    recovered_calls: recoveredCalls,
    policy_denied_calls: policyDeniedCalls,
    gate_rejected_calls: gateRejectedCalls,
    timeout_failures: timeoutFailures,
    transport_failures: transportFailures,
    tool_failures: toolFailures,
    unknown_failures: unknownFailures,
    success_rate: totalCalls > 0 ? Number((successCalls / totalCalls).toFixed(4)) : 0,
    avg_latency_ms: normalizeLatencyMs(avgLatencyMs),
    p50_latency_ms: latencyPercentile(allSamples, 50),
    p95_latency_ms: latencyPercentile(allSamples, 95),
    max_latency_ms: normalizeLatencyMs(maxLatencyMs),
    latency_sample_count: allSamples.length,
    top_errors: topErrors,
  };
}
