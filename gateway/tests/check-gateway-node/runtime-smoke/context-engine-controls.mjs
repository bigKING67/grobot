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
  assert.equal(payload.invalid_env_window_syntax_exit_code, 2);
  assert.equal(payload.invalid_env_window_syntax_has_stable_error, true);
  assert.equal(payload.invalid_env_window_range_exit_code, 2);
  assert.equal(payload.invalid_env_window_range_has_stable_error, true);
  assert.equal(payload.invalid_env_ratio_exit_code, 2);
  assert.equal(payload.invalid_env_ratio_has_stable_error, true);
  assert.equal(payload.invalid_env_boolean_exit_code, 2);
  assert.equal(payload.invalid_env_boolean_has_stable_error, true);
  assert.equal(payload.invalid_adaptive_allowlist_exit_code, 2);
  assert.equal(payload.invalid_adaptive_allowlist_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-context-engine-env-controls-reject-flow");
}

export function assertContextEngineTomlControlSmoke() {
  const payload = runContextEngineControlContract("start-invalid-context-engine-toml-controls-reject-flow");
  assert.equal(payload.invalid_toml_number_exit_code, 2);
  assert.equal(payload.invalid_toml_number_has_stable_error, true);
  assert.equal(payload.invalid_toml_range_exit_code, 2);
  assert.equal(payload.invalid_toml_range_has_stable_error, true);
  assert.equal(payload.invalid_toml_enum_exit_code, 2);
  assert.equal(payload.invalid_toml_enum_has_stable_error, true);
  assert.equal(payload.invalid_threshold_order_exit_code, 2);
  assert.equal(payload.invalid_threshold_order_has_stable_error, true);
  assert.equal(payload.invalid_effective_window_exit_code, 2);
  assert.equal(payload.invalid_effective_window_has_stable_error, true);
  assert.equal(payload.invalid_auto_compact_limit_exit_code, 2);
  assert.equal(payload.invalid_auto_compact_limit_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-context-engine-toml-controls-reject-flow");
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
