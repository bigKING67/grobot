import { resolveBridgeApplyFailurePolicy } from "../bridge-plan-failure-policy";

function main(): void {
  const providerFailure = resolveBridgeApplyFailurePolicy(
    "runtime failed: provider=mock Error: runtime rpc error -32001: runtime turn execution failed (class=upstream_connect_failed trace=trace_req_x detail=model request failed)",
  );
  const providerFailureCamelCase = resolveBridgeApplyFailurePolicy(
    "runtime failed: providerName=mock-fallback errorClass=upstream_http_error",
  );
  const providerFailureSnakeCase = resolveBridgeApplyFailurePolicy(
    "runtime failed: provider_name=mock-sn error_class=semantic_index_required",
  );
  const timeoutFailure = resolveBridgeApplyFailurePolicy(
    "bridge apply failed: request timed out after 120000ms",
  );
  const genericFailure = resolveBridgeApplyFailurePolicy(
    "bridge apply failed: unknown internal error",
  );

  const payload = {
    provider_failure_is_fail: providerFailure.policyAction === "fail",
    provider_failure_reason_matches:
      providerFailure.policyReason === "provider_runtime_failure",
    provider_failure_class_kept:
      providerFailure.errorClass === "upstream_connect_failed",
    provider_failure_provider_kept:
      providerFailure.providerName === "mock",
    provider_failure_diagnostic_matches:
      providerFailure.diagnosticCode === "BRIDGE_PROVIDER_RUNTIME_FAILURE",
    provider_failure_camel_case_extracted:
      providerFailureCamelCase.errorClass === "upstream_http_error"
      && providerFailureCamelCase.providerName === "mock-fallback",
    provider_failure_snake_case_extracted:
      providerFailureSnakeCase.errorClass === "semantic_index_required"
      && providerFailureSnakeCase.providerName === "mock-sn",
    semantic_failure_diagnostic_matches:
      providerFailureSnakeCase.diagnosticCode === "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE",
    timeout_failure_reason_matches:
      timeoutFailure.policyReason === "bridge_apply_exec_timeout",
    timeout_failure_diagnostic_matches:
      timeoutFailure.diagnosticCode === "BRIDGE_APPLY_EXEC_TIMEOUT",
    generic_failure_reason_matches:
      genericFailure.policyReason === "bridge_apply_exec_failed",
    generic_failure_diagnostic_matches:
      genericFailure.diagnosticCode === "BRIDGE_APPLY_EXEC_FAILED",
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main();
