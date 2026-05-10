import assert from "node:assert/strict";
import { startMockModelServer } from "../../../src/extensions/contracts/_shared/mock-model-server.mjs";
import {
  logRetry,
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
  runContractAsync,
  sleepMs,
} from "../harness.mjs";

export async function runRuntimeFailoverCoreSmoke() {
  const rejectResult = runContract("start-smoke-contract.mjs", "package-launcher-rejects-python", [
    "--repo-root",
    repoRoot,
  ]);
  const rejectPayload = parseJsonOutput("start-smoke-contract package-launcher-rejects-python", rejectResult.stdout);
  assert.deepEqual([rejectPayload.exit_code, rejectPayload.empty_gateway_exit_code, rejectPayload.missing_gateway_exit_code, rejectPayload.empty_runtime_exit_code, rejectPayload.missing_runtime_exit_code], [2, 2, 2, 2, 2]);
  assert.equal(rejectPayload.malformed_impl_errors_are_stable, true);
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
}
