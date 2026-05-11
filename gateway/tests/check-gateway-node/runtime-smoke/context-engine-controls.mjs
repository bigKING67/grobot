import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

function runContextEngineControlContract(command) {
  const result = runContract(
    "start-smoke-contract.mjs",
    command,
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  return parseJsonOutput(`start-smoke-contract ${command}`, result.stdout);
}

function assertNoFatalNoBanner(payload) {
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
}

function assertContextEngineValidatorContract() {
  const result = runContract("context-engine-config-validator-contract.mjs", "", [], { timeoutMs: 120_000 });
  assert.equal(result.code, 0, `context engine validator contract failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = parseJsonOutput("context-engine-config-validator-contract", result.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.rejected_count, 11);
  assert.equal(Number(payload.unique_error_count) >= 10, true);
  assert.equal(payload.valid_boundary, true);
}

export function assertContextEngineControlSmoke() {
  const payload = runContextEngineControlContract("start-invalid-context-engine-controls-reject-flow");
  assert.equal(payload.invalid_env_window_syntax_exit_code, 2);
  assert.equal(payload.invalid_env_window_syntax_has_stable_error, true);
  assert.equal(payload.invalid_env_window_range_exit_code, 2);
  assert.equal(payload.invalid_env_window_range_has_stable_error, true);
  assert.equal(payload.invalid_env_ratio_exit_code, 2);
  assert.equal(payload.invalid_env_ratio_has_stable_error, true);
  assert.equal(payload.invalid_env_boolean_exit_code, 2);
  assert.equal(payload.invalid_env_boolean_has_stable_error, true);
  assert.equal(payload.invalid_toml_number_exit_code, 2);
  assert.equal(payload.invalid_toml_number_has_stable_error, true);
  assert.equal(payload.invalid_toml_range_exit_code, 2);
  assert.equal(payload.invalid_toml_range_has_stable_error, true);
  assert.equal(payload.invalid_toml_enum_exit_code, 2);
  assert.equal(payload.invalid_toml_enum_has_stable_error, true);
  assert.equal(payload.invalid_adaptive_allowlist_exit_code, 2);
  assert.equal(payload.invalid_adaptive_allowlist_has_stable_error, true);
  assert.equal(payload.invalid_threshold_order_exit_code, 2);
  assert.equal(payload.invalid_threshold_order_has_stable_error, true);
  assert.equal(payload.invalid_effective_window_exit_code, 2);
  assert.equal(payload.invalid_effective_window_has_stable_error, true);
  assert.equal(payload.invalid_auto_compact_limit_exit_code, 2);
  assert.equal(payload.invalid_auto_compact_limit_has_stable_error, true);
  assert.equal(payload.status_json_invalid_ratio_exit_code, 2);
  assert.equal(payload.status_json_invalid_ratio_has_stable_error, true);
  assert.equal(payload.status_text_invalid_boolean_exit_code, 2);
  assert.equal(payload.status_text_invalid_boolean_has_stable_error, true);
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-context-engine-controls-reject-flow");
}

export function assertContextEngineEnvControlSmoke() {
  const payload = runContextEngineControlContract("start-invalid-context-engine-env-controls-reject-flow");
  assertContextEngineEnvCorePayload(payload);
  assertContextEngineEnvAdaptivePayload(payload);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-context-engine-env-controls-reject-flow");
}

function assertContextEngineEnvCorePayload(payload) {
  assert.equal(payload.invalid_env_window_syntax_exit_code, 2);
  assert.equal(payload.invalid_env_window_syntax_has_stable_error, true);
  assert.equal(payload.invalid_env_window_range_exit_code, 2);
  assert.equal(payload.invalid_env_window_range_has_stable_error, true);
  assert.equal(payload.invalid_env_ratio_exit_code, 2);
  assert.equal(payload.invalid_env_ratio_has_stable_error, true);
  assert.equal(payload.invalid_env_boolean_exit_code, 2);
  assert.equal(payload.invalid_env_boolean_has_stable_error, true);
}

function assertContextEngineEnvAdaptivePayload(payload) {
  assert.equal(payload.invalid_adaptive_allowlist_exit_code, 2);
  assert.equal(payload.invalid_adaptive_allowlist_has_stable_error, true);
}

export function assertContextEngineEnvCoreControlSmoke() {
  assertContextEngineValidatorContract();
  logStep("context-engine-config-validator-contract env-core-controls");
}

export function assertContextEngineEnvAdaptiveControlSmoke() {
  assertContextEngineValidatorContract();
  logStep("context-engine-config-validator-contract env-adaptive-controls");
}

export function assertContextEngineTomlControlSmoke() {
  const payload = runContextEngineControlContract("start-invalid-context-engine-toml-controls-reject-flow");
  assertContextEngineTomlBasicPayload(payload);
  assertContextEngineTomlThresholdPayload(payload);
  assertContextEngineTomlWindowPayload(payload);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-context-engine-toml-controls-reject-flow");
}

function assertContextEngineTomlBasicPayload(payload) {
  assert.equal(payload.invalid_toml_number_exit_code, 2);
  assert.equal(payload.invalid_toml_number_has_stable_error, true);
  assert.equal(payload.invalid_toml_range_exit_code, 2);
  assert.equal(payload.invalid_toml_range_has_stable_error, true);
  assert.equal(payload.invalid_toml_enum_exit_code, 2);
  assert.equal(payload.invalid_toml_enum_has_stable_error, true);
}

function assertContextEngineTomlThresholdPayload(payload) {
  assert.equal(payload.invalid_threshold_order_exit_code, 2);
  assert.equal(payload.invalid_threshold_order_has_stable_error, true);
}

function assertContextEngineTomlWindowPayload(payload) {
  assert.equal(payload.invalid_effective_window_exit_code, 2);
  assert.equal(payload.invalid_effective_window_has_stable_error, true);
  assert.equal(payload.invalid_auto_compact_limit_exit_code, 2);
  assert.equal(payload.invalid_auto_compact_limit_has_stable_error, true);
}

export function assertContextEngineTomlBasicControlSmoke() {
  assertContextEngineValidatorContract();
  logStep("context-engine-config-validator-contract toml-basic-controls");
}

export function assertContextEngineTomlThresholdControlSmoke() {
  assertContextEngineValidatorContract();
  logStep("context-engine-config-validator-contract toml-threshold-controls");
}

export function assertContextEngineTomlWindowControlSmoke() {
  assertContextEngineValidatorContract();
  logStep("context-engine-config-validator-contract toml-window-controls");
}

export function assertContextEngineValidatorSmoke() {
  assertContextEngineValidatorContract();
  logStep("context-engine-config-validator-contract batch-controls");
}

export function assertContextEngineStatusControlSmoke() {
  const payload = runContextEngineControlContract("status-invalid-context-engine-controls-reject-flow");
  assert.equal(payload.status_json_invalid_ratio_exit_code, 2);
  assert.equal(payload.status_json_invalid_ratio_has_stable_error, true);
  assert.equal(payload.status_text_invalid_boolean_exit_code, 2);
  assert.equal(payload.status_text_invalid_boolean_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract status-invalid-context-engine-controls-reject-flow");
}

export function assertContextEngineValidBoundarySmoke() {
  const payload = runContextEngineControlContract("start-context-engine-valid-boundary-flow");
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  logStep("start-smoke-contract start-context-engine-valid-boundary-flow");
}
