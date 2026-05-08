import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertContextEngineControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-context-engine-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-context-engine-controls-reject-flow",
    result.stdout,
  );
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
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-context-engine-controls-reject-flow");
}
