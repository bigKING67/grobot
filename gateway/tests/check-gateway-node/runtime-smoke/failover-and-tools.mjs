import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startMockModelServer } from "../../../src/extensions/contracts/_shared/mock-model-server.mjs";
import { assertRuntimeModelControlSmoke } from "./runtime-model-controls.mjs";
import {
  assertSuccess,
  contractsRoot,
  isRecord,
  logRetry,
  logStep,
  makeTempDir,
  parseJsonOutput,
  repoRoot,
  reserveFreePort,
  runCommand,
  runCommandAsync,
  runContract,
  runContractAsync,
  runTsContract,
  sleepMs,
} from "../harness.mjs";
export async function runRuntimeFailoverAndToolSmoke() {
  const rejectResult = runContract("start-smoke-contract.mjs", "package-launcher-rejects-python", [
    "--repo-root",
    repoRoot,
  ]);
  const rejectPayload = parseJsonOutput("start-smoke-contract package-launcher-rejects-python", rejectResult.stdout);
  assert.equal(rejectPayload.exit_code, 2);
  logStep("start-smoke-contract package-launcher-rejects-python");

  const failoverRejectResult = runContract("start-smoke-contract.mjs", "failover-rejects-python", ["--repo-root", repoRoot]);
  const failoverRejectPayload = parseJsonOutput("start-smoke-contract failover-rejects-python", failoverRejectResult.stdout);
  assert.equal(failoverRejectPayload.exit_code, 2);
  logStep("start-smoke-contract failover-rejects-python");

  let failoverRunsPayload = null;
  let failoverRunsCalls = [];
  let failoverRunsAttempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    failoverRunsAttempts = attempt;
    const mockModel = await startMockModelServer();
    try {
      const failoverRunsResult = await runContractAsync(
        "start-smoke-contract.mjs",
        "failover-runs-ts-rust",
        ["--repo-root", repoRoot],
        {
          timeoutMs: 240_000,
          env: {
            ...process.env,
            GROBOT_BASE_URL: mockModel.baseUrl,
            GROBOT_API_KEY: "mock-runtime-key",
            GROBOT_MODEL: "mock-runtime-model",
            GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
          },
        },
      );
      failoverRunsPayload = parseJsonOutput("start-smoke-contract failover-runs-ts-rust", failoverRunsResult.stdout);
      failoverRunsCalls = mockModel.getCalls();
      const isSuccess =
        failoverRunsPayload.exit_code === 0 &&
        String(failoverRunsPayload.stdout).includes("MOCK_RUNTIME_OK") &&
        failoverRunsCalls.length >= 1;
      if (isSuccess) {
        break;
      }
      if (attempt < 3) {
        const retryReason = `exit=${String(failoverRunsPayload.exit_code)} calls=${String(failoverRunsCalls.length)}`;
        logRetry("start-smoke-contract failover-runs-ts-rust", attempt, 3, retryReason);
        await sleepMs(500);
      }
    } finally {
      await mockModel.close();
    }
  }
  assert.equal(failoverRunsPayload !== null, true);
  assert.equal(failoverRunsPayload.exit_code, 0);
  assert.equal(String(failoverRunsPayload.stdout).includes("MOCK_RUNTIME_OK"), true);
  assert.equal(failoverRunsCalls.length >= 1, true);
  const lastCall = failoverRunsCalls[failoverRunsCalls.length - 1] ?? {};
  assert.equal(lastCall.method, "POST");
  assert.equal(lastCall.path, "/v1/chat/completions");
  assert.equal(lastCall.model, "mock-runtime-model");
  assert.equal(String(lastCall.authorization).startsWith("Bearer "), true);
  assert.equal(String(lastCall.prompt).includes("ts rust hard-cut"), true);
  logStep("start-smoke-contract failover-runs-ts-rust", { attempts: failoverRunsAttempts });

  const recoveryGateModel = await startMockModelServer();
  try {
    const recoveryGateResult = await runContractAsync(
      "start-smoke-contract.mjs",
      "start-recovery-gate-blocks-surface-adaptation",
      ["--repo-root", repoRoot],
      {
        timeoutMs: 240_000,
        env: {
          ...process.env,
          GROBOT_BASE_URL: recoveryGateModel.baseUrl,
          GROBOT_API_KEY: "mock-runtime-key",
          GROBOT_MODEL: "mock-runtime-model",
          GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
          GROBOT_STARTUP_DIAGNOSTICS: "1",
        },
      },
    );
    const recoveryGatePayload = parseJsonOutput(
      "start-smoke-contract start-recovery-gate-blocks-surface-adaptation",
      recoveryGateResult.stdout,
    );
    assert.equal(recoveryGatePayload.exit_code, 0);
    assert.equal(recoveryGatePayload.has_gate_blocked_surface, true);
    assert.equal(recoveryGatePayload.has_recovery_gate_blocked_event, true);
    assert.equal(recoveryGatePayload.has_recovery_gate_policy_context, true);
    assert.equal(recoveryGatePayload.has_no_auto_browser_adaptation, true);
    assert.equal(recoveryGatePayload.has_auto_adaptation_blocked, true);
    assert.equal(recoveryGatePayload.has_recoverable_latest_signal, true);
    const recoveryGateCalls = recoveryGateModel.getCalls();
    assert.equal(recoveryGateCalls.length >= 1, true);
    const recoveryGateLastCall = recoveryGateCalls[recoveryGateCalls.length - 1] ?? {};
    assert.equal(String(recoveryGateLastCall.prompt).includes("[Runtime Tool Recovery Hint]"), true);
    assert.equal(String(recoveryGateLastCall.prompt).includes("stage=strategy_switch"), true);
  } finally {
    await recoveryGateModel.close();
  }
  logStep("start-smoke-contract start-recovery-gate-blocks-surface-adaptation");

  const providerConfigResult = runContract(
    "runtime-smoke-contract.mjs",
    "provider-config-passthrough",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const providerConfigPayload = parseJsonOutput(
    "runtime-smoke-contract provider-config-passthrough",
    providerConfigResult.stdout,
  );
  assert.equal(providerConfigPayload.exit_code, 0);
  assert.equal(String(providerConfigPayload.stdout).includes("CONFIG_PROVIDER_OK"), true);
    assert.equal(Number(providerConfigPayload.runtime_call_count) >= 1, true);
    assert.equal(providerConfigPayload.runtime_last_call?.model, "provider-config-model");
    assert.equal(String(providerConfigPayload.runtime_last_call?.authorization), "Bearer provider-config-key");
    logStep("runtime-smoke-contract provider-config-passthrough");

    const providerPoolResult = runContract(
      "runtime-smoke-contract.mjs",
      "provider-pool-load-balance",
      ["--repo-root", repoRoot],
      { timeoutMs: 240_000 },
    );
    const providerPoolPayload = parseJsonOutput(
      "runtime-smoke-contract provider-pool-load-balance",
      providerPoolResult.stdout,
    );
    assert.equal(providerPoolPayload.exit_code, 0);
    assert.equal(Number(providerPoolPayload.runtime_call_count) >= Number(providerPoolPayload.turn_count), true);
    assert.equal(Number(providerPoolPayload.unique_authorization_count) >= 3, true);
    logStep("runtime-smoke-contract provider-pool-load-balance", {
      unique_keys: providerPoolPayload.unique_authorization_count,
      calls: providerPoolPayload.runtime_call_count,
    });

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

  const startInvalidNamespaceResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-namespace-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const startInvalidNamespacePayload = parseJsonOutput(
    "start-smoke-contract start-invalid-namespace-reject-flow",
    startInvalidNamespaceResult.stdout,
  );
  assert.equal(startInvalidNamespacePayload.invalid_tenant_exit_code, 2);
  assert.equal(startInvalidNamespacePayload.invalid_tenant_has_stable_error, true);
  assert.equal(startInvalidNamespacePayload.invalid_scope_exit_code, 2);
  assert.equal(startInvalidNamespacePayload.invalid_scope_has_stable_error, true);
  assert.equal(startInvalidNamespacePayload.empty_subject_exit_code, 2);
  assert.equal(startInvalidNamespacePayload.empty_subject_has_stable_error, true);
  assert.equal(startInvalidNamespacePayload.hides_top_level_fatal, true);
  assert.equal(startInvalidNamespacePayload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-namespace-reject-flow");

  const startInvalidRuntimeControlsResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-runtime-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const startInvalidRuntimeControlsPayload = parseJsonOutput(
    "start-smoke-contract start-invalid-runtime-controls-reject-flow",
    startInvalidRuntimeControlsResult.stdout,
  );
  assert.equal(startInvalidRuntimeControlsPayload.invalid_timeout_exit_code, 2);
  assert.equal(startInvalidRuntimeControlsPayload.invalid_timeout_has_stable_error, true);
  assert.equal(startInvalidRuntimeControlsPayload.missing_timeout_exit_code, 2);
  assert.equal(startInvalidRuntimeControlsPayload.missing_timeout_has_stable_error, true);
  assert.equal(startInvalidRuntimeControlsPayload.invalid_circuit_failures_exit_code, 2);
  assert.equal(startInvalidRuntimeControlsPayload.invalid_circuit_failures_has_stable_error, true);
  assert.equal(startInvalidRuntimeControlsPayload.invalid_provider_limit_exit_code, 2);
  assert.equal(startInvalidRuntimeControlsPayload.invalid_provider_limit_has_stable_error, true);
  assert.equal(startInvalidRuntimeControlsPayload.invalid_env_provider_burst_exit_code, 2);
  assert.equal(startInvalidRuntimeControlsPayload.invalid_env_provider_burst_has_stable_error, true);
  assert.equal(startInvalidRuntimeControlsPayload.hides_top_level_fatal, true);
  assert.equal(startInvalidRuntimeControlsPayload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-runtime-controls-reject-flow");

  assertRuntimeModelControlSmoke();

  const experienceControlsResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-experience-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const experienceControlsPayload = parseJsonOutput(
    "start-smoke-contract start-invalid-experience-controls-reject-flow",
    experienceControlsResult.stdout,
  );
  assert.equal(experienceControlsPayload.invalid_publish_mode_exit_code, 2);
  assert.equal(experienceControlsPayload.invalid_publish_mode_has_stable_error, true);
  assert.equal(experienceControlsPayload.invalid_recall_limit_exit_code, 2);
  assert.equal(experienceControlsPayload.invalid_recall_limit_has_stable_error, true);
  assert.equal(experienceControlsPayload.over_recall_limit_exit_code, 2);
  assert.equal(experienceControlsPayload.over_recall_limit_has_stable_error, true);
  assert.equal(experienceControlsPayload.zero_recall_limit_exit_code, 2);
  assert.equal(experienceControlsPayload.zero_recall_limit_has_stable_error, true);
  assert.equal(experienceControlsPayload.hides_top_level_fatal, true);
  assert.equal(experienceControlsPayload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-experience-controls-reject-flow");

  const startInvalidStorageControlsResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-storage-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const startInvalidStorageControlsPayload = parseJsonOutput(
    "start-smoke-contract start-invalid-storage-controls-reject-flow",
    startInvalidStorageControlsResult.stdout,
  );
  assert.equal(startInvalidStorageControlsPayload.invalid_backend_exit_code, 2);
  assert.equal(startInvalidStorageControlsPayload.invalid_backend_has_stable_error, true);
  assert.equal(startInvalidStorageControlsPayload.missing_backend_exit_code, 2);
  assert.equal(startInvalidStorageControlsPayload.missing_backend_has_stable_error, true);
  assert.equal(startInvalidStorageControlsPayload.invalid_redis_fallback_exit_code, 2);
  assert.equal(startInvalidStorageControlsPayload.invalid_redis_fallback_has_stable_error, true);
  assert.equal(startInvalidStorageControlsPayload.invalid_redis_url_exit_code, 2);
  assert.equal(startInvalidStorageControlsPayload.invalid_redis_url_has_stable_error, true);
  assert.equal(startInvalidStorageControlsPayload.invalid_env_backend_exit_code, 2);
  assert.equal(startInvalidStorageControlsPayload.invalid_env_backend_has_stable_error, true);
  assert.equal(startInvalidStorageControlsPayload.hides_top_level_fatal, true);
  assert.equal(startInvalidStorageControlsPayload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-storage-controls-reject-flow");

  const sessionControlsResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-session-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const sessionControlsPayload = parseJsonOutput(
    "start-smoke-contract start-invalid-session-controls-reject-flow",
    sessionControlsResult.stdout,
  );
  assert.equal(sessionControlsPayload.invalid_history_exit_code, 2);
  assert.equal(sessionControlsPayload.invalid_history_has_stable_error, true);
  assert.equal(sessionControlsPayload.over_history_exit_code, 2);
  assert.equal(sessionControlsPayload.over_history_has_stable_error, true);
  assert.equal(sessionControlsPayload.missing_handoff_recent_exit_code, 2);
  assert.equal(sessionControlsPayload.missing_handoff_recent_has_stable_error, true);
  assert.equal(sessionControlsPayload.zero_handoff_recent_exit_code, 2);
  assert.equal(sessionControlsPayload.zero_handoff_recent_has_stable_error, true);
  assert.equal(sessionControlsPayload.invalid_rewind_mode_exit_code, 2);
  assert.equal(sessionControlsPayload.invalid_rewind_mode_has_stable_error, true);
  assert.equal(sessionControlsPayload.missing_rewind_mode_exit_code, 2);
  assert.equal(sessionControlsPayload.missing_rewind_mode_has_stable_error, true);
  assert.equal(sessionControlsPayload.invalid_env_handoff_exit_code, 2);
  assert.equal(sessionControlsPayload.invalid_env_handoff_has_stable_error, true);
  assert.equal(sessionControlsPayload.hides_top_level_fatal, true);
  assert.equal(sessionControlsPayload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-session-controls-reject-flow");

  const toolLoopControlsResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-tool-loop-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const toolLoopControlsPayload = parseJsonOutput(
    "start-smoke-contract start-invalid-tool-loop-controls-reject-flow",
    toolLoopControlsResult.stdout,
  );
  assert.equal(toolLoopControlsPayload.invalid_max_tool_rounds_exit_code, 2);
  assert.equal(toolLoopControlsPayload.invalid_max_tool_rounds_has_stable_error, true);
  assert.equal(toolLoopControlsPayload.over_max_tool_rounds_exit_code, 2);
  assert.equal(toolLoopControlsPayload.over_max_tool_rounds_has_stable_error, true);
  assert.equal(toolLoopControlsPayload.invalid_fallback_mode_exit_code, 2);
  assert.equal(toolLoopControlsPayload.invalid_fallback_mode_has_stable_error, true);
  assert.equal(toolLoopControlsPayload.over_recovery_rounds_exit_code, 2);
  assert.equal(toolLoopControlsPayload.over_recovery_rounds_has_stable_error, true);
  assert.equal(toolLoopControlsPayload.negative_recovery_rounds_exit_code, 2);
  assert.equal(toolLoopControlsPayload.negative_recovery_rounds_has_stable_error, true);
  assert.equal(toolLoopControlsPayload.hides_top_level_fatal, true);
  assert.equal(toolLoopControlsPayload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-tool-loop-controls-reject-flow");

  const statusInvalidRuntimeControlsResult = runContract(
    "start-smoke-contract.mjs",
    "status-invalid-runtime-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const statusInvalidRuntimeControlsPayload = parseJsonOutput(
    "start-smoke-contract status-invalid-runtime-controls-reject-flow",
    statusInvalidRuntimeControlsResult.stdout,
  );
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_circuit_json_exit_code, 2);
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_circuit_json_error, "invalid_circuit_failures");
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_circuit_json_field, "circuit-failures");
  assert.equal(
    statusInvalidRuntimeControlsPayload.invalid_circuit_json_detail,
    "circuit-failures must be a positive integer",
  );
  assert.equal(statusInvalidRuntimeControlsPayload.missing_circuit_text_exit_code, 2);
  assert.equal(statusInvalidRuntimeControlsPayload.missing_circuit_text_has_stable_error, true);
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_cache_window_json_exit_code, 2);
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_cache_window_json_error, "invalid_cache_stats_window_ms");
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_cache_window_json_field, "cache-stats-window-ms");
  assert.equal(
    statusInvalidRuntimeControlsPayload.invalid_cache_window_json_detail,
    "cache-stats-window-ms must be a positive integer",
  );
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_max_tool_rounds_json_exit_code, 2);
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_max_tool_rounds_json_error, "invalid_max_tool_rounds");
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_max_tool_rounds_json_field, "max-tool-rounds");
  assert.equal(
    statusInvalidRuntimeControlsPayload.invalid_max_tool_rounds_json_detail,
    "max-tool-rounds must be an integer between 1 and 32",
  );
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_fallback_mode_text_exit_code, 2);
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_fallback_mode_text_has_stable_error, true);
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_recovery_rounds_json_exit_code, 2);
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_recovery_rounds_json_error, "invalid_max_recovery_rounds");
  assert.equal(statusInvalidRuntimeControlsPayload.invalid_recovery_rounds_json_field, "max-recovery-rounds");
  assert.equal(
    statusInvalidRuntimeControlsPayload.invalid_recovery_rounds_json_detail,
    "max-recovery-rounds must be an integer between 0 and 8",
  );
  assert.equal(statusInvalidRuntimeControlsPayload.hides_top_level_fatal, true);
  logStep("start-smoke-contract status-invalid-runtime-controls-reject-flow");

  const statusInvalidContextControlsResult = runContract(
    "start-smoke-contract.mjs",
    "status-invalid-context-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const statusInvalidContextControlsPayload = parseJsonOutput(
    "start-smoke-contract status-invalid-context-controls-reject-flow",
    statusInvalidContextControlsResult.stdout,
  );
  assert.equal(statusInvalidContextControlsPayload.invalid_window_exit_code, 2);
  assert.equal(statusInvalidContextControlsPayload.invalid_window_has_stable_error, true);
  assert.equal(statusInvalidContextControlsPayload.missing_window_exit_code, 2);
  assert.equal(statusInvalidContextControlsPayload.missing_window_has_stable_error, true);
  assert.equal(statusInvalidContextControlsPayload.invalid_hit_rate_json_exit_code, 2);
  assert.equal(
    statusInvalidContextControlsPayload.invalid_hit_rate_json_error,
    "invalid_context_graph_cache_degrade_hit_rate",
  );
  assert.equal(
    statusInvalidContextControlsPayload.invalid_hit_rate_json_field,
    "context-graph-cache-degrade-hit-rate",
  );
  assert.equal(statusInvalidContextControlsPayload.invalid_hit_rate_json_detail_has_range, true);
  assert.equal(statusInvalidContextControlsPayload.invalid_parsed_rate_exit_code, 2);
  assert.equal(statusInvalidContextControlsPayload.invalid_parsed_rate_has_stable_error, true);
  assert.equal(statusInvalidContextControlsPayload.invalid_env_min_entries_exit_code, 2);
  assert.equal(statusInvalidContextControlsPayload.invalid_env_min_entries_has_stable_error, true);
  assert.equal(statusInvalidContextControlsPayload.invalid_env_min_scanned_files_exit_code, 2);
  assert.equal(statusInvalidContextControlsPayload.invalid_env_min_scanned_files_has_stable_error, true);
  assert.equal(statusInvalidContextControlsPayload.valid_boundary_exit_code, 0);
  assert.equal(statusInvalidContextControlsPayload.valid_boundary_json_parse_ok, true);
  assert.equal(statusInvalidContextControlsPayload.valid_boundary_window_size, 200);
  assert.equal(statusInvalidContextControlsPayload.valid_boundary_persistent_min_entries, 1);
  assert.equal(statusInvalidContextControlsPayload.valid_boundary_persistent_min_scanned_files, 1);
  assert.equal(statusInvalidContextControlsPayload.hides_top_level_fatal, true);
  logStep("start-smoke-contract status-invalid-context-controls-reject-flow");

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

  const serveInvalidNamespacePort = await reserveFreePort();
  const serveInvalidNamespaceWorkDir = makeTempDir("serve-invalid-namespace-work");
  const serveInvalidNamespaceResult = runContract(
    "serve-smoke-contract.mjs",
    "serve-invalid-namespace-reject-flow",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      serveInvalidNamespaceWorkDir,
      "--bind",
      `127.0.0.1:${serveInvalidNamespacePort}`,
    ],
    { timeoutMs: 240_000 },
  );
  const serveInvalidNamespacePayload = parseJsonOutput(
    "serve-smoke-contract serve-invalid-namespace-reject-flow",
    serveInvalidNamespaceResult.stdout,
  );
  assert.equal(serveInvalidNamespacePayload.invalid_tenant_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.invalid_tenant_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.invalid_platform_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.invalid_platform_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.invalid_scope_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.invalid_scope_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.invalid_bind_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.invalid_bind_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.missing_bind_value_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.missing_bind_value_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.invalid_circuit_failures_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.invalid_circuit_failures_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.missing_circuit_cooldown_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.missing_circuit_cooldown_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.empty_subject_exit_code, 2);
  assert.equal(serveInvalidNamespacePayload.empty_subject_has_stable_error, true);
  assert.equal(serveInvalidNamespacePayload.hides_top_level_fatal, true);
  assert.equal(serveInvalidNamespacePayload.has_serve_banner, false);
  logStep("serve-smoke-contract serve-invalid-namespace-reject-flow");

  const serveInvalidConfigPort = await reserveFreePort();
  const serveInvalidConfigWorkDir = makeTempDir("serve-invalid-config-work");
  const serveInvalidConfigResult = runContract(
    "management-config-contract.mjs",
    "config-controls-reject-flow",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      serveInvalidConfigWorkDir,
      "--bind",
      `127.0.0.1:${serveInvalidConfigPort}`,
    ],
    { timeoutMs: 240_000 },
  );
  const serveInvalidConfigPayload = parseJsonOutput(
    "management-config-contract config-controls-reject-flow",
    serveInvalidConfigResult.stdout,
  );
  assert.equal(serveInvalidConfigPayload.invalid_config_policy_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_config_policy_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.missing_config_policy_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.missing_config_policy_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.invalid_session_store_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_session_store_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.invalid_redis_fallback_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_redis_fallback_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.invalid_redis_url_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_redis_url_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.invalid_env_session_store_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_env_session_store_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.invalid_env_config_policy_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_env_config_policy_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.invalid_experience_publish_mode_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_experience_publish_mode_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.invalid_experience_recall_limit_exit_code, 2);
  assert.equal(serveInvalidConfigPayload.invalid_experience_recall_limit_has_stable_error, true);
  assert.equal(serveInvalidConfigPayload.hides_top_level_fatal, true);
  assert.equal(serveInvalidConfigPayload.ready_not_reached, true);
  logStep("management-config-contract config-controls-reject-flow");

  const gcInputResult = runContract(
    "gc-contract.mjs",
    "gc-input-validation",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const gcInputPayload = parseJsonOutput(
    "gc-contract gc-input-validation",
    gcInputResult.stdout,
  );
  assert.equal(gcInputPayload.invalid_retention_exit_code, 2);
  assert.equal(gcInputPayload.invalid_retention_has_stable_error, true);
  assert.equal(gcInputPayload.zero_retention_exit_code, 2);
  assert.equal(gcInputPayload.zero_retention_has_json_error, true);
  assert.equal(gcInputPayload.over_sessions_exit_code, 2);
  assert.equal(gcInputPayload.over_sessions_has_stable_error, true);
  assert.equal(gcInputPayload.missing_plans_exit_code, 2);
  assert.equal(gcInputPayload.missing_plans_has_stable_error, true);
  assert.equal(gcInputPayload.invalid_scope_exit_code, 2);
  assert.equal(gcInputPayload.invalid_scope_has_stable_error, true);
  assert.equal(gcInputPayload.invalid_toml_exit_code, 2);
  assert.equal(gcInputPayload.invalid_toml_has_stable_error, true);
  assert.equal(gcInputPayload.valid_default_exit_code, 0);
  assert.equal(gcInputPayload.valid_default_policy_matches_template, true);
  assert.equal(gcInputPayload.hides_top_level_fatal, true);
  assert.equal(gcInputPayload.invalid_inputs_do_not_emit_gc_summary, true);
  logStep("gc-contract gc-input-validation");

  const toolCallFailureResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-fail-fast",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const toolCallFailurePayload = parseJsonOutput(
    "runtime-smoke-contract tool-call-fail-fast",
    toolCallFailureResult.stdout,
  );
  assert.equal(toolCallFailurePayload.exit_code !== 0, true);
  assert.equal(String(toolCallFailurePayload.stderr).includes("Turn failed"), true);
  assert.equal(String(toolCallFailurePayload.stderr).includes("Tool not visible"), true);
  assert.equal(String(toolCallFailurePayload.stderr).includes("tool_not_visible"), false);
  assert.equal(Number(toolCallFailurePayload.runtime_call_count) >= 1, true);
  logStep("runtime-smoke-contract tool-call-fail-fast");

  const toolCallSuccessResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const toolCallSuccessPayload = parseJsonOutput(
    "runtime-smoke-contract tool-call-success",
    toolCallSuccessResult.stdout,
  );
  assert.equal(toolCallSuccessPayload.exit_code, 0);
  assert.equal(String(toolCallSuccessPayload.stdout).includes("TOOL_LOOP_RUNTIME_OK"), true);
  assert.equal(Number(toolCallSuccessPayload.runtime_call_count) >= 2, true);
  logStep("runtime-smoke-contract tool-call-success");

  const mcpCallSuccessResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-call-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpCallSuccessPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-call-success",
    mcpCallSuccessResult.stdout,
  );
  assert.equal(mcpCallSuccessPayload.exit_code, 0);
  assert.equal(String(mcpCallSuccessPayload.assistant_message).includes("MCP_CALL_RUNTIME_OK"), true);
  assert.equal(Number(mcpCallSuccessPayload.runtime_call_count) >= 2, true);
  assert.equal(String(mcpCallSuccessPayload.runtime_last_body).includes("echo:hello-mcp"), true);
  logStep("runtime-smoke-contract mcp-call-success");

  const mcpCallTimeoutResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-call-timeout",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpCallTimeoutPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-call-timeout",
    mcpCallTimeoutResult.stdout,
  );
  assert.equal(mcpCallTimeoutPayload.exit_code, 0);
  assert.equal(mcpCallTimeoutPayload.error_code, -32001);
  assert.equal(mcpCallTimeoutPayload.error_class, "mcp_timeout");
  assert.equal(Number(mcpCallTimeoutPayload.runtime_call_count) >= 1, true);
  logStep("runtime-smoke-contract mcp-call-timeout");

  const mcpSessionIdleReapResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-session-idle-reap",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpSessionIdleReapPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-session-idle-reap",
    mcpSessionIdleReapResult.stdout,
  );
  assert.equal(mcpSessionIdleReapPayload.exit_code, 0);
  assert.equal(Number(mcpSessionIdleReapPayload.rpc_count), 2);
  assert.equal(Number(mcpSessionIdleReapPayload.tool_payload_count), 2);
  assert.equal(mcpSessionIdleReapPayload.first_error_code, null);
  assert.equal(mcpSessionIdleReapPayload.second_error_code, null);
  assert.equal(mcpSessionIdleReapPayload.first_session_reused, false);
  assert.equal(mcpSessionIdleReapPayload.second_session_reused, false);
  assert.equal(
    Number(mcpSessionIdleReapPayload.first_session_pid) > 0 &&
      Number(mcpSessionIdleReapPayload.second_session_pid) > 0,
    true,
  );
  assert.equal(
    Number(mcpSessionIdleReapPayload.first_session_pid) !== Number(mcpSessionIdleReapPayload.second_session_pid),
    true,
  );
  logStep("runtime-smoke-contract mcp-session-idle-reap");

  const mcpServersSuccessResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-servers-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpServersSuccessPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-servers-success",
    mcpServersSuccessResult.stdout,
  );
  assert.equal(mcpServersSuccessPayload.exit_code, 0);
  assert.equal(String(mcpServersSuccessPayload.assistant_message).includes("MCP_SERVERS_RUNTIME_OK"), true);
  assert.equal(Number(mcpServersSuccessPayload.runtime_call_count) >= 2, true);
  assert.equal(String(mcpServersSuccessPayload.runtime_last_body).includes("\\\"ready_count\\\":1"), true);
  logStep("runtime-smoke-contract mcp-servers-success");

  const toolCallDiagnosticResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-diagnostic-events",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const toolCallDiagnosticPayload = parseJsonOutput(
    "runtime-smoke-contract tool-call-diagnostic-events",
    toolCallDiagnosticResult.stdout,
  );
  assert.equal(toolCallDiagnosticPayload.exit_code, 0);
  assert.equal(toolCallDiagnosticPayload.error_code, -32001);
  assert.equal(toolCallDiagnosticPayload.error_class, "tool_call_not_supported");
  assert.equal(Array.isArray(toolCallDiagnosticPayload.event_types), true);
  assert.equal(toolCallDiagnosticPayload.event_types.includes("tool_start"), true);
  assert.equal(toolCallDiagnosticPayload.event_types.includes("tool_end"), true);
  assert.equal(toolCallDiagnosticPayload.event_types.includes("turn_failed"), true);
  logStep("runtime-smoke-contract tool-call-diagnostic-events");
}
