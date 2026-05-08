import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertRuntimeModelControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-runtime-model-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-runtime-model-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_web_search_mode_exit_code, 2);
  assert.equal(payload.invalid_web_search_mode_has_stable_error, true);
  assert.equal(payload.invalid_max_tokens_exit_code, 2);
  assert.equal(payload.invalid_max_tokens_has_stable_error, true);
  assert.equal(payload.invalid_temperature_exit_code, 2);
  assert.equal(payload.invalid_temperature_has_stable_error, true);
  assert.equal(payload.invalid_top_p_exit_code, 2);
  assert.equal(payload.invalid_top_p_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_strategy_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_strategy_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_user_last_n_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_user_last_n_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_capability_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_capability_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_enabled_type_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_enabled_type_has_stable_error, true);
  assert.equal(payload.invalid_search_routing_exit_code, 2);
  assert.equal(payload.invalid_search_routing_has_stable_error, true);
  assert.equal(payload.malformed_search_routing_exit_code, 2);
  assert.equal(payload.malformed_search_routing_has_stable_error, true);
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  assert.equal(payload.valid_search_routing_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_search_routing_boundary_reached_runtime, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-runtime-model-controls-reject-flow");
}
