import { formatRouteSummary } from "../../cli/status/human-status-format";
import {
  formatRouteStatusLines,
  serializeRouteDecisionSummary,
  type RouteDecisionSummary,
} from "../../cli/status/route-status";
import { resolveProviderLastErrorHealth } from "../../cli/services/provider-failure-health";
import { normalizeProviderLastErrorData } from "../../cli/start/session-registry/normalization";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function main(): void {
  const normalizedErrorData = normalizeProviderLastErrorData({
    diagnostic_kind: "upstream_http_error",
    source: "model.transport",
    stage: "chat_http_status",
    provider: "kimi",
    http_status: 503,
    attempt: 3,
    max_attempts: 3,
    retryable: false,
    body_preview: "provider payload that should not be persisted",
    response_headers: "set-cookie=secret",
  });
  const summary: RouteDecisionSummary = {
    strategy: "sticky+score",
    primaryProvider: "kimi",
    configuredPrimaryProvider: "kimi",
    requestedProvider: "kimi",
    orderedProviders: ["kimi"],
    source: "session_registry:/tmp/session.json",
    reason: "session_sticky_provider",
    observed: {
      source: "session_registry:/tmp/session.json",
      activeSessionId: "main",
      updatedAt: "2026-05-08T00:00:00.000Z",
      stickyProvider: "kimi",
      selectedProvider: "kimi",
      reason: "session_sticky_provider",
      providerRuntimeStates: [{
        providerName: "kimi",
        consecutiveFailures: 1,
        circuitOpenUntilMs: 0,
        circuitOpen: false,
        lastErrorClass: "upstream_http_error",
        lastErrorMessage: "runtime rpc error",
        lastErrorData: normalizedErrorData,
        lastErrorHealth: resolveProviderLastErrorHealth({
          provider_name: "kimi",
          consecutive_failures: 1,
          circuit_open_until_ms: 0,
          last_error_class: "upstream_http_error",
          last_error_data: normalizedErrorData,
        }),
        lastFailedAt: "2026-05-08T00:00:00.000Z",
      }],
    },
    failover: {
      circuitFailures: 2,
      circuitCooldownSecs: 30,
      stickyMode: "session_key",
    },
  };
  const serialized = serializeRouteDecisionSummary(summary);
  const serializedObserved = record(serialized.observed);
  const serializedStates = Array.isArray(serializedObserved.provider_runtime_states)
    ? serializedObserved.provider_runtime_states
    : [];
  const firstSerializedState = record(serializedStates[0]);
  const serializedLastErrorData = record(firstSerializedState.last_error_data);
  const serializedLastErrorHealth = record(firstSerializedState.last_error_health);
  const textLines = formatRouteStatusLines(summary);
  const routeSummary = formatRouteSummary(summary);
  const defaultSummaryText = (routeSummary.detailLines ?? []).join("\n");

  const payload = {
    normalized_has_http_status: normalizedErrorData?.http_status === 503,
    normalized_has_retryable: normalizedErrorData?.retryable === false,
    normalized_drops_body_preview: normalizedErrorData?.body_preview === undefined,
    normalized_drops_response_headers: normalizedErrorData?.response_headers === undefined,
    serialized_has_last_error_data: serializedLastErrorData.http_status === 503
      && serializedLastErrorData.retryable === false,
    serialized_has_last_error_health: serializedLastErrorHealth.score_penalty === 800
      && serializedLastErrorHealth.reason === "last_error_nonretryable"
      && serializedLastErrorHealth.sticky_bypass_reason === "last_error_nonretryable",
    legacy_text_has_provider_error_data:
      textLines.some((line) => line.includes("route_provider_errors: kimi:upstream_http_error")
        && line.includes("http_status=503")
        && line.includes("attempts=3/3")
        && line.includes("retryable=false")
        && line.includes("health=last_error_nonretryable")
        && line.includes("penalty=800")),
    default_summary_has_provider_error_data:
      defaultSummaryText.includes("last provider error kimi:upstream http error")
      && defaultSummaryText.includes("HTTP 503")
      && defaultSummaryText.includes("retryable false")
      && defaultSummaryText.includes("prefer alternate"),
  };

  assertEqual(payload.normalized_has_http_status, true, "normalized http status");
  assertEqual(payload.normalized_has_retryable, true, "normalized retryable");
  assertEqual(payload.normalized_drops_body_preview, true, "body preview redaction");
  assertEqual(payload.normalized_drops_response_headers, true, "response header redaction");
  assertEqual(payload.serialized_has_last_error_data, true, "serialized last error data");
  assertEqual(payload.serialized_has_last_error_health, true, "serialized last error health");
  assertEqual(payload.legacy_text_has_provider_error_data, true, "legacy text provider diagnostics");
  assertEqual(payload.default_summary_has_provider_error_data, true, "default text provider diagnostics");

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main();
