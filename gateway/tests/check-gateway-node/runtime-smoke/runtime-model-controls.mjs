import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

function runRuntimeModelControlContract(command) {
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

export function assertRuntimeModelKimiOptionControlSmoke() {
  const payload = runRuntimeModelControlContract("start-runtime-model-kimi-option-controls-reject-flow");
  assert.equal(payload.invalid_web_search_mode_exit_code, 2);
  assert.equal(payload.invalid_web_search_mode_has_stable_error, true);
  assert.equal(payload.invalid_max_tokens_exit_code, 2);
  assert.equal(payload.invalid_max_tokens_has_stable_error, true);
  assert.equal(payload.invalid_temperature_exit_code, 2);
  assert.equal(payload.invalid_temperature_has_stable_error, true);
  assert.equal(payload.invalid_top_p_exit_code, 2);
  assert.equal(payload.invalid_top_p_has_stable_error, true);
  assert.equal(payload.invalid_integer_trailing_exit_code, 2);
  assert.equal(payload.invalid_integer_trailing_has_stable_error, true);
  assert.equal(payload.invalid_kimi_allowlist_mixed_exit_code, 2);
  assert.equal(payload.invalid_kimi_allowlist_mixed_has_stable_error, true);
  assert.equal(payload.invalid_kimi_allowlist_empty_exit_code, 2);
  assert.equal(payload.invalid_kimi_allowlist_empty_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-runtime-model-kimi-option-controls-reject-flow");
}

export function assertRuntimeModelPromptCacheControlSmoke() {
  const payload = runRuntimeModelControlContract("start-runtime-model-prompt-cache-controls-reject-flow");
  assert.equal(payload.invalid_prompt_cache_strategy_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_strategy_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_user_last_n_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_user_last_n_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_capability_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_capability_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_enabled_type_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_enabled_type_has_stable_error, true);
  assert.equal(payload.invalid_quoted_trailing_exit_code, 2);
  assert.equal(payload.invalid_quoted_trailing_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_user_last_n_fraction_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_user_last_n_fraction_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-runtime-model-prompt-cache-controls-reject-flow");
}

export function assertRuntimeModelProviderControlSmoke() {
  const payload = runRuntimeModelControlContract("start-runtime-model-provider-controls-reject-flow");
  assert.equal(payload.invalid_provider_priority_exit_code, 2);
  assert.equal(payload.invalid_provider_priority_has_stable_error, true);
  assert.equal(payload.invalid_provider_priority_fraction_exit_code, 2);
  assert.equal(payload.invalid_provider_priority_fraction_has_stable_error, true);
  assert.equal(payload.invalid_provider_weight_exit_code, 2);
  assert.equal(payload.invalid_provider_weight_has_stable_error, true);
  assert.equal(payload.invalid_provider_kind_exit_code, 2);
  assert.equal(payload.invalid_provider_kind_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-runtime-model-provider-controls-reject-flow");
}

export function assertRuntimeModelSearchRoutingControlSmoke() {
  const payload = runRuntimeModelControlContract("start-runtime-model-search-routing-controls-flow");
  assert.equal(payload.invalid_search_routing_exit_code, 2);
  assert.equal(payload.invalid_search_routing_has_stable_error, true);
  assert.equal(payload.malformed_search_routing_exit_code, 2);
  assert.equal(payload.malformed_search_routing_has_stable_error, true);
  assert.equal(payload.valid_search_routing_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_search_routing_boundary_reached_runtime, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-runtime-model-search-routing-controls-flow");
}

export function assertRuntimeModelCliEnvControlSmoke() {
  const payload = runRuntimeModelControlContract("start-runtime-model-cli-env-controls-reject-flow");
  assert.equal(payload.empty_provider_cli_exit_code, 2);
  assert.equal(payload.empty_provider_cli_has_stable_error, true);
  assert.equal(payload.empty_model_cli_exit_code, 2);
  assert.equal(payload.empty_model_cli_has_stable_error, true);
  assert.equal(payload.empty_api_key_cli_exit_code, 2);
  assert.equal(payload.empty_api_key_cli_has_stable_error, true);
  assert.equal(payload.missing_base_url_cli_exit_code, 2);
  assert.equal(payload.missing_base_url_cli_has_stable_error, true);
  assert.equal(payload.empty_model_env_exit_code, 2);
  assert.equal(payload.empty_model_env_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-runtime-model-cli-env-controls-reject-flow");
}

export function assertRuntimeModelValidBoundarySmoke() {
  const payload = runRuntimeModelControlContract("start-runtime-model-valid-boundary-flow");
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  logStep("start-smoke-contract start-runtime-model-valid-boundary-flow");
}

export function assertRuntimeModelControlSmoke() {
  const payload = runRuntimeModelControlContract("start-invalid-runtime-model-controls-reject-flow");
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
  assert.equal(payload.invalid_quoted_trailing_exit_code, 2);
  assert.equal(payload.invalid_quoted_trailing_has_stable_error, true);
  assert.equal(payload.invalid_integer_trailing_exit_code, 2);
  assert.equal(payload.invalid_integer_trailing_has_stable_error, true);
  assert.equal(payload.invalid_kimi_allowlist_mixed_exit_code, 2);
  assert.equal(payload.invalid_kimi_allowlist_mixed_has_stable_error, true);
  assert.equal(payload.invalid_kimi_allowlist_empty_exit_code, 2);
  assert.equal(payload.invalid_kimi_allowlist_empty_has_stable_error, true);
  assert.equal(payload.invalid_provider_priority_exit_code, 2);
  assert.equal(payload.invalid_provider_priority_has_stable_error, true);
  assert.equal(payload.invalid_provider_priority_fraction_exit_code, 2);
  assert.equal(payload.invalid_provider_priority_fraction_has_stable_error, true);
  assert.equal(payload.invalid_provider_weight_exit_code, 2);
  assert.equal(payload.invalid_provider_weight_has_stable_error, true);
  assert.equal(payload.invalid_prompt_cache_user_last_n_fraction_exit_code, 2);
  assert.equal(payload.invalid_prompt_cache_user_last_n_fraction_has_stable_error, true);
  assert.equal(payload.invalid_provider_kind_exit_code, 2);
  assert.equal(payload.invalid_provider_kind_has_stable_error, true);
  assert.equal(payload.invalid_search_routing_exit_code, 2);
  assert.equal(payload.invalid_search_routing_has_stable_error, true);
  assert.equal(payload.malformed_search_routing_exit_code, 2);
  assert.equal(payload.malformed_search_routing_has_stable_error, true);
  assert.equal(payload.empty_provider_cli_exit_code, 2);
  assert.equal(payload.empty_provider_cli_has_stable_error, true);
  assert.equal(payload.empty_model_cli_exit_code, 2);
  assert.equal(payload.empty_model_cli_has_stable_error, true);
  assert.equal(payload.empty_api_key_cli_exit_code, 2);
  assert.equal(payload.empty_api_key_cli_has_stable_error, true);
  assert.equal(payload.missing_base_url_cli_exit_code, 2);
  assert.equal(payload.missing_base_url_cli_has_stable_error, true);
  assert.equal(payload.empty_model_env_exit_code, 2);
  assert.equal(payload.empty_model_env_has_stable_error, true);
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  assert.equal(payload.valid_search_routing_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_search_routing_boundary_reached_runtime, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-runtime-model-controls-reject-flow");
}
