import assert from "node:assert/strict";
import { startMockModelServer } from "../../../src/extensions/contracts/_shared/mock-model-server.mjs";
import {
  logStep,
  makeTempDir,
  parseJsonOutput,
  repoRoot,
  reserveFreePort,
  runContract,
  runContractAsync,
} from "../harness.mjs";

export function runRuntimeProviderFailureStatusSmoke() {
  const upstreamFailureResult = runContract("start-smoke-contract.mjs", "failover-runs-ts-rust", ["--repo-root", repoRoot], {
    timeoutMs: 240_000,
    env: {
      ...process.env,
      GROBOT_BASE_URL: "http://127.0.0.1:9/v1",
      GROBOT_API_KEY: "mock-runtime-key",
      GROBOT_MODEL: "mock-runtime-model",
      GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "1200",
    },
  });
  const upstreamFailurePayload = parseJsonOutput("start-smoke-contract failover-runs-ts-rust upstream-failure", upstreamFailureResult.stdout);
  assert.equal(upstreamFailurePayload.exit_code !== 0, true);
  assert.equal(String(upstreamFailurePayload.stderr).includes("Turn failed"), true);
  assert.equal(String(upstreamFailurePayload.stderr).includes("Upstream connection failed"), true);
  assert.equal(String(upstreamFailurePayload.stderr).includes("runtime rpc error -32001"), false);
  assert.equal(String(upstreamFailurePayload.stderr).includes("upstream_connect_failed"), false);
  logStep("start-smoke-contract failover-runs-ts-rust-upstream-failure");

  const providerFailureStatusResult = runContract(
    "start-smoke-contract.mjs",
    "provider-failure-route-status-ts-rust",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const providerFailureStatusPayload = parseJsonOutput(
    "start-smoke-contract provider-failure-route-status-ts-rust",
    providerFailureStatusResult.stdout,
  );
  assert.equal(providerFailureStatusPayload.exit_code !== 0, true);
  assert.equal(providerFailureStatusPayload.status_exit_code, 0);
  assert.equal(providerFailureStatusPayload.legacy_text_exit_code, 0);
  assert.equal(providerFailureStatusPayload.default_text_exit_code, 0);
  assert.equal(providerFailureStatusPayload.invalid_subject_status_exit_code, 2);
  assert.equal(providerFailureStatusPayload.invalid_subject_status_error, "invalid_session_subject");
  assert.equal(providerFailureStatusPayload.invalid_subject_status_field, "session-subject");
  assert.equal(providerFailureStatusPayload.empty_subject_status_exit_code, 2);
  assert.equal(providerFailureStatusPayload.empty_subject_status_error, "invalid_session_subject");
  assert.equal(providerFailureStatusPayload.empty_subject_status_field, "session-subject");
  assert.equal(providerFailureStatusPayload.empty_project_status_exit_code, 2);
  assert.equal(providerFailureStatusPayload.empty_project_status_error, "invalid_project");
  assert.equal(providerFailureStatusPayload.empty_project_status_field, "project");
  assert.equal(providerFailureStatusPayload.invalid_scope_status_exit_code, 2);
  assert.equal(providerFailureStatusPayload.invalid_scope_status_error, "invalid_session_scope");
  assert.equal(providerFailureStatusPayload.invalid_scope_status_field, "session-scope");
  assert.equal(providerFailureStatusPayload.invalid_tenant_text_exit_code, 2);
  assert.equal(providerFailureStatusPayload.invalid_tenant_text_has_stable_error, true);
  assert.equal(providerFailureStatusPayload.status_json_parse_ok, true);
  assert.equal(providerFailureStatusPayload.registry_exists, true);
  assert.equal(Number(providerFailureStatusPayload.status_provider_state_count) >= 2, true);
  assert.equal(Number(providerFailureStatusPayload.registry_provider_state_count) >= 2, true);
  assert.equal(providerFailureStatusPayload.start_stderr_has_human_failure, true);
  assert.equal(providerFailureStatusPayload.start_stderr_hides_raw_error_class, true);
  assert.equal(providerFailureStatusPayload.status_has_failing_state, true);
  assert.equal(providerFailureStatusPayload.status_has_success_state, true);
  assert.equal(providerFailureStatusPayload.status_failing_last_error_class, "upstream_connect_failed");
  assert.equal(providerFailureStatusPayload.status_failing_last_error_diagnostic, "upstream_connect_failed");
  assert.equal(providerFailureStatusPayload.status_failing_last_error_source, "model.transport");
  assert.equal(providerFailureStatusPayload.status_failing_last_error_stage, "chat_request");
  assert.equal(providerFailureStatusPayload.status_failing_last_error_retryable, false);
  assert.equal(providerFailureStatusPayload.status_failing_attempts_exhausted, true);
  assert.equal(providerFailureStatusPayload.status_failing_last_error_health_penalty, 800);
  assert.equal(providerFailureStatusPayload.status_failing_last_error_health_reason, "last_error_nonretryable");
  assert.equal(
    providerFailureStatusPayload.status_failing_last_error_health_sticky_bypass,
    "last_error_nonretryable",
  );
  assert.equal(providerFailureStatusPayload.status_failing_redacts_body_preview, true);
  assert.equal(providerFailureStatusPayload.status_failing_redacts_response_headers, true);
  assert.equal(providerFailureStatusPayload.registry_has_failing_last_error_data, true);
  assert.equal(
    providerFailureStatusPayload.registry_failing_last_error_diagnostic,
    "upstream_connect_failed",
  );
  assert.equal(providerFailureStatusPayload.legacy_text_has_route_provider_errors, true);
  assert.equal(providerFailureStatusPayload.default_text_has_last_provider_error, true);
  logStep("start-smoke-contract provider-failure-route-status-ts-rust");
}

export async function runRuntimeProviderManagementStatusSmoke() {
  const providerFailureCleanAlternateModel = await startMockModelServer();
  try {
    const providerFailureCleanAlternateResult = await runContractAsync(
      "start-smoke-contract.mjs",
      "provider-failure-route-status-ts-rust",
      [
        "--repo-root",
        repoRoot,
        "--success-provider-base-url",
        providerFailureCleanAlternateModel.baseUrl,
      ],
      { timeoutMs: 240_000 },
    );
    const providerFailureCleanAlternatePayload = parseJsonOutput(
      "start-smoke-contract provider-failure-route-status-ts-rust clean-alternate",
      providerFailureCleanAlternateResult.stdout,
    );
    assert.equal(providerFailureCleanAlternatePayload.exit_code, 0);
    assert.equal(providerFailureCleanAlternatePayload.status_exit_code, 0);
    assert.equal(providerFailureCleanAlternatePayload.status_json_parse_ok, true);
    assert.equal(providerFailureCleanAlternatePayload.status_has_failing_state, true);
    assert.equal(providerFailureCleanAlternatePayload.status_has_success_state, true);
    assert.equal(providerFailureCleanAlternatePayload.status_selected_provider, "success");
    assert.equal(providerFailureCleanAlternatePayload.status_selected_reason, "session_sticky_provider");
    assert.equal(providerFailureCleanAlternatePayload.status_success_last_error_class, null);
    assert.equal(providerFailureCleanAlternatePayload.status_success_last_error_health_penalty, 0);
    assert.equal(providerFailureCleanAlternatePayload.status_success_last_succeeded_at_type, "string");
    assert.equal(providerFailureCleanAlternatePayload.status_failing_last_error_health_penalty, 800);
    assert.equal(providerFailureCleanAlternatePayload.default_text_has_last_provider_error, true);
    const providerFailureCleanAlternateCalls = providerFailureCleanAlternateModel.getCalls();
    assert.equal(providerFailureCleanAlternateCalls.length >= 1, true);
    const providerFailureCleanAlternateLastCall =
      providerFailureCleanAlternateCalls[providerFailureCleanAlternateCalls.length - 1] ?? {};
    assert.equal(providerFailureCleanAlternateLastCall.model, "success-model");
    logStep("start-smoke-contract provider-failure-route-status-ts-rust-clean-alternate");
  } finally {
    await providerFailureCleanAlternateModel.close();
  }

  const managementProviderFailurePort = await reserveFreePort();
  const managementProviderFailureWorkDir = makeTempDir("serve-provider-failure-status-work");
  const managementProviderFailureResult = runContract(
    "serve-smoke-contract.mjs",
    "provider-failure-route-status-management-api",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      managementProviderFailureWorkDir,
      "--bind",
      `127.0.0.1:${managementProviderFailurePort}`,
    ],
    { timeoutMs: 240_000 },
  );
  const managementProviderFailurePayload = parseJsonOutput(
    "serve-smoke-contract provider-failure-route-status-management-api",
    managementProviderFailureResult.stdout,
  );
  assert.equal(managementProviderFailurePayload.ready, true);
  assert.equal(managementProviderFailurePayload.start_exit_code, 0);
  assert.equal(managementProviderFailurePayload.status_endpoint?.status, 200);
  assert.equal(managementProviderFailurePayload.management_has_route_decision, true);
  assert.equal(managementProviderFailurePayload.management_route_source_type, "string");
  assert.equal(Number(managementProviderFailurePayload.management_status_provider_state_count) >= 2, true);
  assert.equal(managementProviderFailurePayload.management_status_has_failing_state, true);
  assert.equal(managementProviderFailurePayload.management_status_has_success_state, true);
  assert.equal(managementProviderFailurePayload.management_status_selected_provider, "success");
  assert.equal(managementProviderFailurePayload.management_status_selected_reason, "session_sticky_provider");
  assert.equal(managementProviderFailurePayload.management_alias_query_selected_provider, "success");
  assert.equal(managementProviderFailurePayload.management_unknown_subject_selected_provider, "failing");
  assert.equal(
    managementProviderFailurePayload.management_unknown_subject_selected_reason,
    "session_registry_unavailable",
  );
  assert.equal(managementProviderFailurePayload.management_invalid_subject_status, 400);
  assert.equal(managementProviderFailurePayload.management_invalid_subject_error, "invalid_session_subject");
  assert.equal(managementProviderFailurePayload.management_invalid_subject_field, "session-subject");
  assert.equal(managementProviderFailurePayload.management_empty_subject_status, 400);
  assert.equal(managementProviderFailurePayload.management_empty_subject_error, "invalid_session_subject");
  assert.equal(managementProviderFailurePayload.management_empty_subject_field, "session-subject");
  assert.equal(managementProviderFailurePayload.management_invalid_scope_status, 400);
  assert.equal(managementProviderFailurePayload.management_invalid_scope_error, "invalid_session_scope");
  assert.equal(managementProviderFailurePayload.management_post_invalid_status, 200);
  assert.equal(managementProviderFailurePayload.management_post_invalid_selected_provider, "success");
  assert.equal(managementProviderFailurePayload.management_success_last_error_class, null);
  assert.equal(managementProviderFailurePayload.management_success_last_error_health_penalty, 0);
  assert.equal(managementProviderFailurePayload.management_success_last_succeeded_at_type, "string");
  assert.equal(managementProviderFailurePayload.management_failing_last_error_class, "upstream_connect_failed");
  assert.equal(managementProviderFailurePayload.management_failing_last_error_diagnostic, "upstream_connect_failed");
  assert.equal(managementProviderFailurePayload.management_failing_last_error_source, "model.transport");
  assert.equal(managementProviderFailurePayload.management_failing_last_error_stage, "chat_request");
  assert.equal(managementProviderFailurePayload.management_failing_last_error_retryable, false);
  assert.equal(managementProviderFailurePayload.management_failing_last_error_health_penalty, 800);
  assert.equal(managementProviderFailurePayload.management_failing_last_error_health_reason, "last_error_nonretryable");
  assert.equal(
    managementProviderFailurePayload.management_failing_last_error_health_sticky_bypass,
    "last_error_nonretryable",
  );
  assert.equal(managementProviderFailurePayload.management_failing_redacts_body_preview, true);
  assert.equal(managementProviderFailurePayload.management_failing_redacts_response_headers, true);
  logStep("serve-smoke-contract provider-failure-route-status-management-api");
}

export async function runRuntimeProviderStatusSmoke() {
  runRuntimeProviderFailureStatusSmoke();
  await runRuntimeProviderManagementStatusSmoke();
}
