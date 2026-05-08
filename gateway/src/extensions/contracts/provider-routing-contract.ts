import {
  createDefaultProviderState,
  resolveProviderRetryReason,
  resolveProviderOrder,
  shouldRetryProviderRequest,
} from "../../cli/start/turn/provider-routing";
import { type RuntimeProviderCandidate } from "../../cli/start/turn/contract";
import { type SessionProviderRuntimeState } from "../../cli/start/session-registry";
import {
  RuntimeRpcError,
  extractRuntimeErrorClass,
  extractRuntimeErrorData,
} from "../../tools/runtime/runtime-error";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function provider(name: string, priority = 1): RuntimeProviderCandidate {
  return {
    name,
    priority,
    weight: 1,
    source: "contract",
    modelConfig: {
      providerKind: name === "kimi" ? "kimi" : "openai_compatible",
      model: `${name}-model`,
    },
  };
}

function stateWithLastError(
  providerName: string,
  errorClass: string,
  errorData: Record<string, unknown>,
): SessionProviderRuntimeState {
  return {
    ...createDefaultProviderState(providerName),
    last_error_class: errorClass,
    last_error_data: errorData,
    consecutive_failures: 1,
  };
}

function findScoreReason(
  scoreOrder: Array<{ name: string; lastErrorReason?: string; lastErrorPenalty: number }>,
  providerName: string,
): string | undefined {
  return scoreOrder.find((entry) => entry.name === providerName)?.lastErrorReason;
}

function findScorePenalty(
  scoreOrder: Array<{ name: string; lastErrorPenalty: number }>,
  providerName: string,
): number | undefined {
  return scoreOrder.find((entry) => entry.name === providerName)?.lastErrorPenalty;
}

function main(): void {
  const legacy429Retries = shouldRetryProviderRequest(
    "upstream_http_error",
    "runtime rpc error (class=upstream_http_error detail=status=429)",
    0,
  );
  const legacy429StopsAfterLimit = shouldRetryProviderRequest(
    "upstream_http_error",
    "runtime rpc error (class=upstream_http_error detail=status=429)",
    1,
  );
  const structuredRetryable503Retries = shouldRetryProviderRequest({
    errorClass: "upstream_http_error",
    errorMessage: "runtime rpc error (class=upstream_http_error)",
    retryCount: 0,
    errorData: {
      http_status: 503,
      retryable: true,
      attempt: 1,
      max_attempts: 3,
    },
  });
  const structuredRetryable503StopsAfterLimit = shouldRetryProviderRequest({
    errorClass: "upstream_http_error",
    errorMessage: "runtime rpc error (class=upstream_http_error)",
    retryCount: 1,
    errorData: {
      http_status: 503,
      retryable: true,
      attempt: 1,
      max_attempts: 3,
    },
  });
  const structuredRetryableFalse429DoesNotRetry = shouldRetryProviderRequest({
    errorClass: "upstream_http_error",
    errorMessage: "runtime rpc error (class=upstream_http_error detail=status=429)",
    retryCount: 0,
    errorData: {
      http_status: 429,
      retryable: false,
      attempt: 3,
      max_attempts: 3,
    },
  });
  const exhaustedAttemptsDoNotRetryWithoutRetryable = shouldRetryProviderRequest({
    errorClass: "upstream_timeout",
    errorMessage: "runtime rpc error (class=upstream_timeout)",
    retryCount: 0,
    errorData: {
      attempt: 3,
      max_attempts: 3,
    },
  });
  const structuredConnectRetry = shouldRetryProviderRequest({
    errorClass: "upstream_connect_failed",
    errorMessage: "runtime rpc error (class=upstream_connect_failed)",
    retryCount: 0,
    errorData: {
      retryable: true,
      attempt: 1,
      max_attempts: 3,
    },
  });
  const structuredFinalConnectDoesNotRetry = shouldRetryProviderRequest({
    errorClass: "upstream_connect_failed",
    errorMessage: "runtime rpc error (class=upstream_connect_failed)",
    retryCount: 0,
    errorData: {
      retryable: false,
      attempt: 3,
      max_attempts: 3,
    },
  });
  const readFailureKeepsLegacyRetry = shouldRetryProviderRequest({
    errorClass: "upstream_response_read_failed",
    errorMessage: "runtime rpc error (class=upstream_response_read_failed)",
    retryCount: 0,
  });
  const retry503Reason = resolveProviderRetryReason({
    errorClass: "upstream_http_error",
    errorMessage: "runtime rpc error (class=upstream_http_error)",
    errorData: {
      http_status: 503,
    },
  });
  const retryLegacy429Reason = resolveProviderRetryReason({
    errorClass: "upstream_http_error",
    errorMessage: "runtime rpc error (class=upstream_http_error detail=status=429)",
  });
  const runtimeRpcError = new RuntimeRpcError({
    message: "runtime rpc error -32001",
    errorClass: "upstream_http_error",
    errorMessage: "HTTP 503 from provider",
    errorData: {
      http_status: 503,
      retryable: true,
    },
    traceId: "trace_provider_retry_contract",
    runtimeEvents: [],
  });
  const extractedRuntimeErrorClass = extractRuntimeErrorClass(runtimeRpcError);
  const extractedRuntimeErrorData = extractRuntimeErrorData(runtimeRpcError);
  const stickyNonretryableOrder = resolveProviderOrder({
    providers: [provider("kimi"), provider("openai")],
    stickyProvider: "kimi",
    sessionKey: "contract-sticky-nonretryable",
    stateMap: new Map([
      [
        "kimi",
        stateWithLastError("kimi", "upstream_connect_failed", {
          diagnostic_kind: "upstream_connect_failed",
          retryable: false,
          attempt: 3,
          max_attempts: 3,
        }),
      ],
      ["openai", createDefaultProviderState("openai")],
    ]),
  });
  const stickyExhaustedOrder = resolveProviderOrder({
    providers: [provider("kimi"), provider("openai")],
    stickyProvider: "kimi",
    sessionKey: "contract-sticky-exhausted",
    stateMap: new Map([
      [
        "kimi",
        stateWithLastError("kimi", "upstream_connect_failed", {
          diagnostic_kind: "upstream_connect_failed",
          retryable: true,
          attempt: 3,
          max_attempts: 3,
        }),
      ],
      ["openai", createDefaultProviderState("openai")],
    ]),
  });
  const retryableTransientOrder = resolveProviderOrder({
    providers: [provider("kimi", 1), provider("fallback", 2)],
    stickyProvider: undefined,
    sessionKey: "contract-retryable-transient",
    stateMap: new Map([
      [
        "kimi",
        stateWithLastError("kimi", "upstream_http_error", {
          diagnostic_kind: "upstream_http_error",
          http_status: 503,
          retryable: true,
          attempt: 1,
          max_attempts: 3,
        }),
      ],
      ["fallback", createDefaultProviderState("fallback")],
    ]),
  });
  const configInvalidOrder = resolveProviderOrder({
    providers: [provider("broken"), provider("clean")],
    stickyProvider: undefined,
    sessionKey: "contract-config-invalid",
    stateMap: new Map([
      [
        "broken",
        stateWithLastError("broken", "config_invalid", {
          diagnostic_kind: "config_invalid",
          retryable: false,
        }),
      ],
      ["clean", createDefaultProviderState("clean")],
    ]),
  });

  const payload = {
    legacy_429_retries: legacy429Retries,
    legacy_429_stops_after_limit: !legacy429StopsAfterLimit,
    structured_retryable_503_retries: structuredRetryable503Retries,
    structured_retryable_503_stops_after_limit: !structuredRetryable503StopsAfterLimit,
    structured_retryable_false_429_does_not_retry: !structuredRetryableFalse429DoesNotRetry,
    exhausted_attempts_do_not_retry_without_retryable: !exhaustedAttemptsDoNotRetryWithoutRetryable,
    structured_connect_retries: structuredConnectRetry,
    structured_final_connect_does_not_retry: !structuredFinalConnectDoesNotRetry,
    read_failure_keeps_legacy_retry: readFailureKeepsLegacyRetry,
    retry_503_reason_matches: retry503Reason === "upstream_http_503",
    retry_legacy_429_reason_matches: retryLegacy429Reason === "upstream_429",
    runtime_error_class_extracts_structured:
      extractedRuntimeErrorClass === "upstream_http_error",
    runtime_error_data_extracts_structured_http_status:
      extractedRuntimeErrorData?.http_status === 503,
    sticky_nonretryable_bypasses_to_clean:
      stickyNonretryableOrder.orderedProviders[0]?.name === "openai",
    sticky_nonretryable_trace_reason:
      stickyNonretryableOrder.trace.stickyReason === "last_error_nonretryable",
    sticky_nonretryable_trace_penalty_reason:
      findScoreReason(stickyNonretryableOrder.trace.scoreOrder, "kimi") === "last_error_nonretryable",
    sticky_attempt_exhausted_bypasses_to_clean:
      stickyExhaustedOrder.orderedProviders[0]?.name === "openai",
    sticky_attempt_exhausted_trace_reason:
      stickyExhaustedOrder.trace.stickyReason === "last_error_exhausted",
    retryable_transient_keeps_primary_usable:
      retryableTransientOrder.orderedProviders[0]?.name === "kimi",
    retryable_transient_trace_penalty_reason:
      findScoreReason(retryableTransientOrder.trace.scoreOrder, "kimi") === "retryable_http_503",
    retryable_transient_penalty_is_moderate:
      findScorePenalty(retryableTransientOrder.trace.scoreOrder, "kimi") === 150,
    config_invalid_ranks_behind_clean:
      configInvalidOrder.orderedProviders[0]?.name === "clean",
    config_invalid_trace_penalty_reason:
      findScoreReason(configInvalidOrder.trace.scoreOrder, "broken") === "config_blocker:config_invalid",
  };

  assertEqual(payload.legacy_429_retries, true, "legacy 429 retry");
  assertEqual(payload.legacy_429_stops_after_limit, true, "legacy 429 retry limit");
  assertEqual(payload.structured_retryable_503_retries, true, "structured 503 retry");
  assertEqual(payload.structured_retryable_503_stops_after_limit, true, "structured 503 retry limit");
  assertEqual(payload.structured_retryable_false_429_does_not_retry, true, "retryable=false blocks retry");
  assertEqual(payload.exhausted_attempts_do_not_retry_without_retryable, true, "exhausted attempts block retry");
  assertEqual(payload.structured_connect_retries, true, "structured connect retry");
  assertEqual(payload.structured_final_connect_does_not_retry, true, "final connect does not retry");
  assertEqual(payload.read_failure_keeps_legacy_retry, true, "read failure legacy retry");
  assertEqual(payload.retry_503_reason_matches, true, "503 retry reason");
  assertEqual(payload.retry_legacy_429_reason_matches, true, "legacy 429 retry reason");
  assertEqual(payload.runtime_error_class_extracts_structured, true, "runtime error class extraction");
  assertEqual(
    payload.runtime_error_data_extracts_structured_http_status,
    true,
    "runtime error data extraction",
  );
  assertEqual(payload.sticky_nonretryable_bypasses_to_clean, true, "nonretryable sticky bypass");
  assertEqual(payload.sticky_nonretryable_trace_reason, true, "nonretryable sticky trace reason");
  assertEqual(payload.sticky_nonretryable_trace_penalty_reason, true, "nonretryable score reason");
  assertEqual(payload.sticky_attempt_exhausted_bypasses_to_clean, true, "exhausted sticky bypass");
  assertEqual(payload.sticky_attempt_exhausted_trace_reason, true, "exhausted sticky trace reason");
  assertEqual(payload.retryable_transient_keeps_primary_usable, true, "retryable transient remains usable");
  assertEqual(payload.retryable_transient_trace_penalty_reason, true, "retryable transient score reason");
  assertEqual(payload.retryable_transient_penalty_is_moderate, true, "retryable transient moderate penalty");
  assertEqual(payload.config_invalid_ranks_behind_clean, true, "config invalid ranks behind clean");
  assertEqual(payload.config_invalid_trace_penalty_reason, true, "config invalid score reason");

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main();
