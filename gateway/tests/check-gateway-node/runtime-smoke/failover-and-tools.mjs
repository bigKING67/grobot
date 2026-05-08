import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startMockModelServer } from "../../../src/extensions/contracts/_shared/mock-model-server.mjs";
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
