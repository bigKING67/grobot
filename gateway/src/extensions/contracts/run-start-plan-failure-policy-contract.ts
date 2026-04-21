import { resolvePlanFailureDecision } from "../../orchestration/entrypoints/dev-cli/start/plan-failure-policy";
import { type SessionProviderRuntimeState } from "../../orchestration/entrypoints/dev-cli/start/session-registry";

function isoFromOffsetMs(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function buildProviderState(errorClass: string, failedAtIso: string): SessionProviderRuntimeState {
  return {
    provider_name: "contract-provider",
    consecutive_failures: 1,
    circuit_open_until_ms: 0,
    last_error_class: errorClass,
    last_error_message: `contract ${errorClass}`,
    last_failed_at: failedAtIso,
  };
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

  const payload = {
    planning_semantic_degrades: planningSemanticDecision.action === "degrade",
    planning_semantic_reason_matches:
      planningSemanticDecision.reason === "planning_semantic_context_unavailable",
    planning_semantic_has_hint: typeof planningSemanticDecision.hint === "string",
    planning_semantic_stale_fails: planningSemanticStaleDecision.action === "fail",
    applying_semantic_still_fails: applyingSemanticDecision.action === "fail",
    planning_provider_failure_reason_matches:
      planningProviderFailureDecision.reason === "provider_runtime_failure",
    planning_provider_failure_keeps_error_class:
      planningProviderFailureDecision.errorClass === "upstream_http_error",
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main();
