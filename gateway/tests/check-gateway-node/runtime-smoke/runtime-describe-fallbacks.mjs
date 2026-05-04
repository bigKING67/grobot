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
export async function runRuntimeDescribeFallbackSmoke() {
  const memoryLegacyFallbackResult = runContract(
    "start-smoke-contract.mjs",
    "status-ts-rust-memory-legacy-fallback",
    ["--repo-root", repoRoot],
  );
  const memoryLegacyFallbackPayload = parseJsonOutput(
    "start-smoke-contract status-ts-rust-memory-legacy-fallback",
    memoryLegacyFallbackResult.stdout,
  );
  assert.equal(memoryLegacyFallbackPayload.status_json_parse_ok, true);
  assert.equal(
    String(memoryLegacyFallbackPayload.graph_autotune_last_reason),
    "legacy_graph_state_seed",
  );
  assert.equal(
    Number(memoryLegacyFallbackPayload.graph_autotune_hold_turns_remaining),
    7,
  );
  assert.equal(
    String(memoryLegacyFallbackPayload.graph_autotune_persistence_domain),
    "memory",
  );
  assert.equal(String(memoryLegacyFallbackPayload.prompt_guard_floor_stage), "forced");
  assert.equal(Number(memoryLegacyFallbackPayload.prompt_guard_degraded_streak), 11);
  assert.equal(
    String(memoryLegacyFallbackPayload.prompt_guard_last_reason),
    "legacy_prompt_guard_seed",
  );
  assert.equal(
    String(memoryLegacyFallbackPayload.prompt_guard_persistence_domain),
    "memory",
  );
  logStep("start-smoke-contract status-ts-rust-memory-legacy-fallback");

  const runtimeDescribeUnavailableResult = runContract(
    "start-smoke-contract.mjs",
    "status-runtime-describe-unavailable",
    ["--repo-root", repoRoot],
  );
  const runtimeDescribeUnavailablePayload = parseJsonOutput(
    "start-smoke-contract status-runtime-describe-unavailable",
    runtimeDescribeUnavailableResult.stdout,
  );
  assert.equal(runtimeDescribeUnavailablePayload.exit_code, 0);
  assert.equal(runtimeDescribeUnavailablePayload.json_exit_code, 0);
  assert.equal(runtimeDescribeUnavailablePayload.status_json_parse_ok, true);
  assert.equal(runtimeDescribeUnavailablePayload.has_gateway_fallback_projection, true);
  assert.equal(runtimeDescribeUnavailablePayload.has_gateway_fallback_suppressed_none, false);
  assert.equal(runtimeDescribeUnavailablePayload.has_gateway_fallback_drift_args_none, true);
  assert.equal(runtimeDescribeUnavailablePayload.has_unavailable_suppressed_args, false);
  assert.equal(runtimeDescribeUnavailablePayload.has_unavailable_describe_reason, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_status, "fail");
  assert.equal(runtimeDescribeUnavailablePayload.quality_schema_version, 1);
  assert.equal(runtimeDescribeUnavailablePayload.quality_runtime_binary_exists, false);
  assert.equal(runtimeDescribeUnavailablePayload.quality_runtime_health_ok, false);
  assert.equal(runtimeDescribeUnavailablePayload.quality_runtime_describe_source, "start-default");
  assert.equal(runtimeDescribeUnavailablePayload.quality_schema_budget_status, "passed");
  assert.equal(runtimeDescribeUnavailablePayload.quality_action_family, "runtime_environment");
  assert.equal(runtimeDescribeUnavailablePayload.quality_action_reason, "runtime_binary_missing");
  assert.equal(runtimeDescribeUnavailablePayload.quality_action_required, "build_runtime_binary");
  assert.equal(runtimeDescribeUnavailablePayload.quality_actionable_next_step_has_runtime_status, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_failure_has_runtime_binary_missing, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_failure_has_runtime_health_failed, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_warning_has_describe_fallback, true);
  assert.equal(runtimeDescribeUnavailablePayload.text_has_quality_fail, true);
  logStep("start-smoke-contract status-runtime-describe-unavailable");

  const startRuntimeDescribeFallbackDiagnosticResult = runContract(
    "start-smoke-contract.mjs",
    "start-runtime-describe-fallback-diagnostic",
    ["--repo-root", repoRoot],
  );
  const startRuntimeDescribeFallbackDiagnosticPayload = parseJsonOutput(
    "start-smoke-contract start-runtime-describe-fallback-diagnostic",
    startRuntimeDescribeFallbackDiagnosticResult.stdout,
  );
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.exit_code, 0);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.has_runtime_tools_fallback_surface, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_tool_surface_event, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_enabled_tools_source_field, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.has_describe_reason, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.has_status_json_hint, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_fallback_manifest_field, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_schema_profiles_field, true);
  logStep("start-smoke-contract start-runtime-describe-fallback-diagnostic");

  const runtimeDescribeInvalidSchemaStatusResult = runContract(
    "start-smoke-contract.mjs",
    "status-runtime-describe-invalid-schema-profiles",
    ["--repo-root", repoRoot],
  );
  const runtimeDescribeInvalidSchemaStatusPayload = parseJsonOutput(
    "start-smoke-contract status-runtime-describe-invalid-schema-profiles",
    runtimeDescribeInvalidSchemaStatusResult.stdout,
  );
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.exit_code, 0);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.json_exit_code, 0);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.status_json_parse_ok, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.has_gateway_fallback_projection, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.has_start_default_source, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.has_invalid_schema_reason, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_status, "fail");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_schema_version, 1);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_runtime_binary_exists, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_runtime_health_ok, false);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_runtime_describe_source, "start-default");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_schema_budget_status, "passed");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_action_family, "runtime_environment");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_action_reason, "runtime_health_failed");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_action_required, "check_runtime_health");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_actionable_next_step_has_runtime_status, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_failure_has_runtime_health_failed, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_warning_has_describe_fallback, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.text_has_quality_fail, true);
  logStep("start-smoke-contract status-runtime-describe-invalid-schema-profiles");

  const runtimeDescribeInvalidSchemaStartResult = runContract(
    "start-smoke-contract.mjs",
    "start-runtime-describe-invalid-schema-profiles",
    ["--repo-root", repoRoot],
  );
  const runtimeDescribeInvalidSchemaStartPayload = parseJsonOutput(
    "start-smoke-contract start-runtime-describe-invalid-schema-profiles",
    runtimeDescribeInvalidSchemaStartResult.stdout,
  );
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.exit_code, 0);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.has_runtime_tools_fallback_surface, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_tool_surface_event, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_enabled_tools_source_field, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.has_invalid_schema_reason, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.has_status_json_hint, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_fallback_manifest_field, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_schema_profiles_field, true);
  logStep("start-smoke-contract start-runtime-describe-invalid-schema-profiles");

  const legacyFlagRejectResult = runContract("start-smoke-contract.mjs", "status-reject-legacy-flag", [
    "--repo-root",
    repoRoot,
  ]);
  const legacyFlagRejectPayload = parseJsonOutput(
    "start-smoke-contract status-reject-legacy-flag",
    legacyFlagRejectResult.stdout,
  );
  assert.equal(legacyFlagRejectPayload.exit_code, 2);
  logStep("start-smoke-contract status-reject-legacy-flag");

  const pythonGatewayRejectResult = runContract("start-smoke-contract.mjs", "status-reject-python-gateway", [
    "--repo-root",
    repoRoot,
  ]);
  const pythonGatewayRejectPayload = parseJsonOutput(
    "start-smoke-contract status-reject-python-gateway",
    pythonGatewayRejectResult.stdout,
  );
  assert.equal(pythonGatewayRejectPayload.exit_code, 2);
  logStep("start-smoke-contract status-reject-python-gateway");

  const legacyEnvRejectResult = runContract("start-smoke-contract.mjs", "status-reject-legacy-env", ["--repo-root", repoRoot]);
  const legacyEnvRejectPayload = parseJsonOutput("start-smoke-contract status-reject-legacy-env", legacyEnvRejectResult.stdout);
  assert.equal(legacyEnvRejectPayload.exit_code, 2);
  logStep("start-smoke-contract status-reject-legacy-env");

  const homeDir = makeTempDir("serve-home");
  const workDir = makeTempDir("serve-work");
  const port = await reserveFreePort();
  runContract(
    "serve-smoke-contract.mjs",
    "config-read-policy-auto",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      workDir,
      "--home-dir",
      homeDir,
      "--bind",
      `127.0.0.1:${port}`,
    ],
    { timeoutMs: 240_000 },
  );
  logStep("serve-smoke-contract config-read-policy-auto");

  const disabledPort = await reserveFreePort();
  runContract(
    "serve-smoke-contract.mjs",
    "config-read-policy-disabled",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      workDir,
      "--home-dir",
      homeDir,
      "--bind",
      `127.0.0.1:${disabledPort}`,
      "--management-token",
      "ops-token",
    ],
    { timeoutMs: 240_000 },
  );
  logStep("serve-smoke-contract config-read-policy-disabled");
}
