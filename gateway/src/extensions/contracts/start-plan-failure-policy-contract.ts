import { resolvePlanFailureDecision } from "../../cli/start/plan-failure-policy";
import { type SessionProviderRuntimeState } from "../../cli/start/session-registry";

function isoFromOffsetMs(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function buildProviderState(
  errorClass: string,
  failedAtIso: string,
  errorData?: Record<string, unknown>,
): SessionProviderRuntimeState {
  const state: SessionProviderRuntimeState = {
    provider_name: "contract-provider",
    consecutive_failures: 1,
    circuit_open_until_ms: 0,
    last_error_class: errorClass,
    last_error_message: `contract ${errorClass}`,
    last_failed_at: failedAtIso,
  };
  if (errorData) {
    state.last_error_data = errorData;
  }
  return state;
}

function main(): void {
  const planningSemanticDecision = resolvePlanFailureDecision({
    phase: "planning",
    exitCode: 1,
    providerStates: [buildProviderState("semantic_index_config_invalid", isoFromOffsetMs(-1_000))],
  });
  const planningSemanticStaleDecision = resolvePlanFailureDecision({
    phase: "planning",
    exitCode: 1,
    providerStates: [buildProviderState("semantic_index_config_invalid", isoFromOffsetMs(-10 * 60 * 1_000))],
    failureStateStalenessMs: 60 * 1_000,
  });
  const applyingSemanticDecision = resolvePlanFailureDecision({
    phase: "applying",
    exitCode: 1,
    providerStates: [buildProviderState("semantic_index_required", isoFromOffsetMs(-1_000))],
  });
  const planningProviderFailureDecision = resolvePlanFailureDecision({
    phase: "planning",
    exitCode: 1,
    providerStates: [buildProviderState("upstream_http_error", isoFromOffsetMs(-1_000))],
  });
  const planningProviderStructuredFailureDecision = resolvePlanFailureDecision({
    phase: "planning",
    exitCode: 1,
    providerStates: [
      buildProviderState(
        "upstream_http_error",
        isoFromOffsetMs(-1_000),
        {
          diagnostic_kind: "upstream_http_error",
          http_status: 503,
          retryable: false,
          attempt: 3,
          max_attempts: 3,
        },
      ),
    ],
  });
  const planningProviderExhaustedDecision = resolvePlanFailureDecision({
    phase: "planning",
    exitCode: 1,
    providerStates: [
      buildProviderState(
        "upstream_connect_failed",
        isoFromOffsetMs(-1_000),
        {
          diagnostic_kind: "upstream_connect_failed",
          attempt: 3,
          max_attempts: 3,
        },
      ),
    ],
  });

  const payload = {
    planning_semantic_degrades: planningSemanticDecision.action === "degrade",
    planning_semantic_reason_matches:
      planningSemanticDecision.reason === "planning_semantic_context_unavailable",
    planning_semantic_diagnostic_matches:
      planningSemanticDecision.diagnosticCode === "PLAN_SEMANTIC_INDEX_CONFIG_INVALID",
    planning_semantic_has_hint: typeof planningSemanticDecision.hint === "string",
    planning_semantic_stale_fails: planningSemanticStaleDecision.action === "fail",
    planning_semantic_stale_diagnostic_matches:
      planningSemanticStaleDecision.diagnosticCode === "PLAN_TURN_EXIT_CODE_FAILURE",
    applying_semantic_still_fails: applyingSemanticDecision.action === "fail",
    applying_semantic_diagnostic_matches:
      applyingSemanticDecision.diagnosticCode === "PLAN_SEMANTIC_INDEX_REQUIRED",
    planning_provider_failure_reason_matches:
      planningProviderFailureDecision.reason === "provider_runtime_failure",
    planning_provider_failure_keeps_error_class:
      planningProviderFailureDecision.errorClass === "upstream_http_error",
    planning_provider_failure_diagnostic_matches:
      planningProviderFailureDecision.diagnosticCode === "PLAN_PROVIDER_RUNTIME_FAILURE",
    planning_provider_structured_retryable_false:
      planningProviderStructuredFailureDecision.retryable === false,
    planning_provider_structured_http_status:
      planningProviderStructuredFailureDecision.httpStatus === 503,
    planning_provider_structured_attempts_exhausted:
      planningProviderStructuredFailureDecision.attemptsExhausted === true,
    planning_provider_structured_hint_actionable:
      planningProviderStructuredFailureDecision.hint?.includes("switch provider/model") === true,
    planning_provider_exhausted_hint_actionable:
      planningProviderExhaustedDecision.hint?.includes("retry budget is exhausted") === true,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main();
