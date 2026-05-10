import assert from "node:assert/strict";
import { assertRuntimeModelControlSmoke } from "./runtime-model-controls.mjs";
import {
  assertRuntimeToolControlSmoke,
  assertStatusRuntimeToolControlSmoke,
} from "./runtime-tool-controls.mjs";
import {
  logStep,
  makeTempDir,
  parseJsonOutput,
  repoRoot,
  reserveFreePort,
  runContract,
} from "../harness.mjs";

export function runRuntimeNamespaceStartControlSmoke() {
  const startInvalidNamespaceResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-namespace-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-namespace-reject-flow",
    startInvalidNamespaceResult.stdout,
  );
  assert.equal(payload.invalid_tenant_exit_code, 2);
  assert.equal(payload.invalid_tenant_has_stable_error, true);
  assert.equal(payload.invalid_scope_exit_code, 2);
  assert.equal(payload.invalid_scope_has_stable_error, true);
  assert.equal(payload.empty_subject_exit_code, 2);
  assert.equal(payload.empty_subject_has_stable_error, true);
  assert.equal(payload.empty_project_exit_code, 2);
  assert.equal(payload.empty_project_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-namespace-reject-flow");
}

export function runRuntimeStartControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-runtime-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-runtime-controls-reject-flow",
    result.stdout,
  );
  assert.deepEqual([payload.invalid_timeout_exit_code, payload.missing_timeout_exit_code, payload.invalid_circuit_failures_exit_code, payload.invalid_provider_limit_exit_code, payload.invalid_env_provider_burst_exit_code, payload.invalid_env_memory_maintenance_enabled_exit_code, payload.invalid_env_memory_maintenance_interval_exit_code, payload.invalid_env_context_graph_window_exit_code, payload.invalid_env_ask_user_pending_ttl_exit_code], [2, 2, 2, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual([payload.invalid_timeout_has_stable_error, payload.missing_timeout_has_stable_error, payload.invalid_circuit_failures_has_stable_error, payload.invalid_provider_limit_has_stable_error, payload.invalid_env_provider_burst_has_stable_error, payload.invalid_env_memory_maintenance_enabled_has_stable_error, payload.invalid_env_memory_maintenance_interval_has_stable_error, payload.invalid_env_context_graph_window_has_stable_error, payload.invalid_env_ask_user_pending_ttl_has_stable_error], [true, true, true, true, true, true, true, true, true]);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-runtime-controls-reject-flow");
}

export function runRuntimeModelControlSurfaceSmoke() {
  assertRuntimeModelControlSmoke();
}

export function runRuntimeExperienceControlSurfaceSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-experience-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-experience-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_publish_mode_exit_code, 2);
  assert.equal(payload.invalid_publish_mode_has_stable_error, true);
  assert.equal(payload.invalid_recall_limit_exit_code, 2);
  assert.equal(payload.invalid_recall_limit_has_stable_error, true);
  assert.equal(payload.over_recall_limit_exit_code, 2);
  assert.equal(payload.over_recall_limit_has_stable_error, true);
  assert.equal(payload.zero_recall_limit_exit_code, 2);
  assert.equal(payload.zero_recall_limit_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-experience-controls-reject-flow");
}

export function runRuntimeStorageSessionControlSurfaceSmoke() {
  const storageResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-storage-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const storage = parseJsonOutput(
    "start-smoke-contract start-invalid-storage-controls-reject-flow",
    storageResult.stdout,
  );
  assert.equal(storage.invalid_backend_exit_code, 2);
  assert.equal(storage.invalid_backend_has_stable_error, true);
  assert.equal(storage.missing_backend_exit_code, 2);
  assert.equal(storage.missing_backend_has_stable_error, true);
  assert.equal(storage.invalid_redis_fallback_exit_code, 2);
  assert.equal(storage.invalid_redis_fallback_has_stable_error, true);
  assert.equal(storage.invalid_redis_url_exit_code, 2);
  assert.equal(storage.invalid_redis_url_has_stable_error, true);
  assert.equal(storage.invalid_env_backend_exit_code, 2);
  assert.equal(storage.invalid_env_backend_has_stable_error, true);
  assert.equal(storage.invalid_project_hot_cache_trailing_exit_code, 2);
  assert.equal(storage.invalid_project_hot_cache_trailing_has_stable_error, true);
  assert.equal(storage.invalid_project_require_redis_trailing_exit_code, 2);
  assert.equal(storage.invalid_project_require_redis_trailing_has_stable_error, true);
  assert.equal(storage.hides_top_level_fatal, true);
  assert.equal(storage.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-storage-controls-reject-flow");

  const sessionResult = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-session-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const session = parseJsonOutput(
    "start-smoke-contract start-invalid-session-controls-reject-flow",
    sessionResult.stdout,
  );
  assert.equal(session.invalid_history_exit_code, 2);
  assert.equal(session.invalid_history_has_stable_error, true);
  assert.equal(session.over_history_exit_code, 2);
  assert.equal(session.over_history_has_stable_error, true);
  assert.equal(session.missing_handoff_recent_exit_code, 2);
  assert.equal(session.missing_handoff_recent_has_stable_error, true);
  assert.equal(session.zero_handoff_recent_exit_code, 2);
  assert.equal(session.zero_handoff_recent_has_stable_error, true);
  assert.equal(session.invalid_rewind_mode_exit_code, 2);
  assert.equal(session.invalid_rewind_mode_has_stable_error, true);
  assert.equal(session.missing_rewind_mode_exit_code, 2);
  assert.equal(session.missing_rewind_mode_has_stable_error, true);
  assert.equal(session.invalid_env_handoff_exit_code, 2);
  assert.equal(session.invalid_env_handoff_has_stable_error, true);
  assert.equal(session.hides_top_level_fatal, true);
  assert.equal(session.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-session-controls-reject-flow");
}

export function runRuntimeToolStartControlSurfaceSmoke() {
  assertRuntimeToolControlSmoke();
}

export function runRuntimeStatusControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "status-invalid-runtime-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract status-invalid-runtime-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_circuit_json_exit_code, 2);
  assert.equal(payload.invalid_circuit_json_error, "invalid_circuit_failures");
  assert.equal(payload.invalid_circuit_json_field, "circuit-failures");
  assert.equal(payload.invalid_circuit_json_detail, "circuit-failures must be a positive integer");
  assert.equal(payload.missing_circuit_text_exit_code, 2);
  assert.equal(payload.missing_circuit_text_has_stable_error, true);
  assert.equal(payload.invalid_cache_window_json_exit_code, 2);
  assert.equal(payload.invalid_cache_window_json_error, "invalid_cache_stats_window_ms");
  assert.equal(payload.invalid_cache_window_json_field, "cache-stats-window-ms");
  assert.equal(payload.invalid_cache_window_json_detail, "cache-stats-window-ms must be a positive integer");
  assert.equal(payload.invalid_max_tool_rounds_json_exit_code, 2);
  assert.equal(payload.invalid_max_tool_rounds_json_error, "invalid_max_tool_rounds");
  assert.equal(payload.invalid_max_tool_rounds_json_field, "max-tool-rounds");
  assert.equal(payload.invalid_max_tool_rounds_json_detail, "max-tool-rounds must be an integer between 1 and 32");
  assert.equal(payload.invalid_fallback_mode_text_exit_code, 2);
  assert.equal(payload.invalid_fallback_mode_text_has_stable_error, true);
  assert.equal(payload.invalid_recovery_rounds_json_exit_code, 2);
  assert.equal(payload.invalid_recovery_rounds_json_error, "invalid_max_recovery_rounds");
  assert.equal(payload.invalid_recovery_rounds_json_field, "max-recovery-rounds");
  assert.equal(payload.invalid_recovery_rounds_json_detail, "max-recovery-rounds must be an integer between 0 and 8");
  assert.deepEqual([payload.empty_provider_env_json_exit_code, payload.empty_provider_env_json_error, payload.empty_provider_env_json_field, payload.empty_provider_env_json_detail], [2, "invalid_provider", "provider", "provider must be a non-empty string"]);
  assert.equal(payload.hides_top_level_fatal, true);
  logStep("start-smoke-contract status-invalid-runtime-controls-reject-flow");
}

export function runRuntimeToolStatusControlSurfaceSmoke() {
  assertStatusRuntimeToolControlSmoke();
}

export function runRuntimeContextStatusControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "status-invalid-context-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract status-invalid-context-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_window_exit_code, 2);
  assert.equal(payload.invalid_window_has_stable_error, true);
  assert.equal(payload.missing_window_exit_code, 2);
  assert.equal(payload.missing_window_has_stable_error, true);
  assert.equal(payload.invalid_hit_rate_json_exit_code, 2);
  assert.equal(payload.invalid_hit_rate_json_error, "invalid_context_graph_cache_degrade_hit_rate");
  assert.equal(payload.invalid_hit_rate_json_field, "context-graph-cache-degrade-hit-rate");
  assert.equal(payload.invalid_hit_rate_json_detail_has_range, true);
  assert.equal(payload.invalid_parsed_rate_exit_code, 2);
  assert.equal(payload.invalid_parsed_rate_has_stable_error, true);
  assert.equal(payload.invalid_env_min_entries_exit_code, 2);
  assert.equal(payload.invalid_env_min_entries_has_stable_error, true);
  assert.equal(payload.invalid_env_min_scanned_files_exit_code, 2);
  assert.equal(payload.invalid_env_min_scanned_files_has_stable_error, true);
  assert.equal(payload.valid_boundary_exit_code, 0);
  assert.equal(payload.valid_boundary_json_parse_ok, true);
  assert.equal(payload.valid_boundary_window_size, 200);
  assert.equal(payload.valid_boundary_persistent_min_entries, 1);
  assert.equal(payload.valid_boundary_persistent_min_scanned_files, 1);
  assert.equal(payload.hides_top_level_fatal, true);
  logStep("start-smoke-contract status-invalid-context-controls-reject-flow");
}

export async function runRuntimeNamespaceServeControlSmoke() {
  const serveInvalidNamespacePort = await reserveFreePort();
  const serveInvalidNamespaceWorkDir = makeTempDir("serve-invalid-namespace-work");
  const result = runContract(
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
  const payload = parseJsonOutput("serve-smoke-contract serve-invalid-namespace-reject-flow", result.stdout);
  assert.equal(payload.invalid_tenant_exit_code, 2);
  assert.equal(payload.invalid_tenant_has_stable_error, true);
  assert.equal(payload.invalid_platform_exit_code, 2);
  assert.equal(payload.invalid_platform_has_stable_error, true);
  assert.equal(payload.invalid_scope_exit_code, 2);
  assert.equal(payload.invalid_scope_has_stable_error, true);
  assert.equal(payload.invalid_bind_exit_code, 2);
  assert.equal(payload.invalid_bind_has_stable_error, true);
  assert.equal(payload.missing_bind_value_exit_code, 2);
  assert.equal(payload.missing_bind_value_has_stable_error, true);
  assert.equal(payload.invalid_circuit_failures_exit_code, 2);
  assert.equal(payload.invalid_circuit_failures_has_stable_error, true);
  assert.equal(payload.missing_circuit_cooldown_exit_code, 2);
  assert.equal(payload.missing_circuit_cooldown_has_stable_error, true);
  assert.equal(payload.empty_subject_exit_code, 2);
  assert.equal(payload.empty_subject_has_stable_error, true);
  assert.equal(payload.empty_project_exit_code, 2);
  assert.equal(payload.empty_project_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_serve_banner, false);
  logStep("serve-smoke-contract serve-invalid-namespace-reject-flow");
}

export async function runRuntimeManagementConfigControlSmoke() {
  const serveInvalidConfigPort = await reserveFreePort();
  const serveInvalidConfigWorkDir = makeTempDir("serve-invalid-config-work");
  const result = runContract(
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
  const payload = parseJsonOutput("management-config-contract config-controls-reject-flow", result.stdout);
  assert.equal(payload.invalid_config_policy_exit_code, 2);
  assert.equal(payload.invalid_config_policy_has_stable_error, true);
  assert.equal(payload.missing_config_policy_exit_code, 2);
  assert.equal(payload.missing_config_policy_has_stable_error, true);
  assert.equal(payload.invalid_session_store_exit_code, 2);
  assert.equal(payload.invalid_session_store_has_stable_error, true);
  assert.equal(payload.invalid_redis_fallback_exit_code, 2);
  assert.equal(payload.invalid_redis_fallback_has_stable_error, true);
  assert.equal(payload.invalid_redis_url_exit_code, 2);
  assert.equal(payload.invalid_redis_url_has_stable_error, true);
  assert.equal(payload.invalid_env_session_store_exit_code, 2);
  assert.equal(payload.invalid_env_session_store_has_stable_error, true);
  assert.equal(payload.invalid_env_config_policy_exit_code, 2);
  assert.equal(payload.invalid_env_config_policy_has_stable_error, true);
  assert.equal(payload.empty_env_management_token_exit_code, 2);
  assert.equal(payload.empty_env_management_token_has_stable_error, true);
  assert.equal(payload.empty_env_model_with_cli_base_url_exit_code, 2);
  assert.equal(payload.empty_env_model_with_cli_base_url_has_stable_error, true);
  assert.equal(payload.empty_config_management_token_exit_code, 2);
  assert.equal(payload.empty_config_management_token_has_stable_error, true);
  assert.equal(payload.trailing_config_management_token_exit_code, 2);
  assert.equal(payload.trailing_config_management_token_has_stable_error, true);
  assert.equal(payload.invalid_config_policy_trailing_exit_code, 2);
  assert.equal(payload.invalid_config_policy_trailing_has_stable_error, true);
  assert.equal(payload.invalid_experience_publish_mode_exit_code, 2);
  assert.equal(payload.invalid_experience_publish_mode_has_stable_error, true);
  assert.equal(payload.invalid_experience_recall_limit_exit_code, 2);
  assert.equal(payload.invalid_experience_recall_limit_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.ready_not_reached, true);
  logStep("management-config-contract config-controls-reject-flow");
}

export function runRuntimeGcControlSmoke() {
  const result = runContract(
    "gc-contract.mjs",
    "gc-input-validation",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput("gc-contract gc-input-validation", result.stdout);
  assert.equal(payload.invalid_retention_exit_code, 2);
  assert.equal(payload.invalid_retention_has_stable_error, true);
  assert.equal(payload.zero_retention_exit_code, 2);
  assert.equal(payload.zero_retention_has_json_error, true);
  assert.equal(payload.over_sessions_exit_code, 2);
  assert.equal(payload.over_sessions_has_stable_error, true);
  assert.equal(payload.missing_plans_exit_code, 2);
  assert.equal(payload.missing_plans_has_stable_error, true);
  assert.equal(payload.invalid_scope_exit_code, 2);
  assert.equal(payload.invalid_scope_has_stable_error, true);
  assert.equal(payload.invalid_toml_exit_code, 2);
  assert.equal(payload.invalid_toml_has_stable_error, true);
  assert.equal(payload.valid_default_exit_code, 0);
  assert.equal(payload.valid_default_policy_matches_template, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.invalid_inputs_do_not_emit_gc_summary, true);
  logStep("gc-contract gc-input-validation");
}

export async function runRuntimeNamespaceControlSurfaceSmoke() {
  runRuntimeNamespaceStartControlSmoke();
  await runRuntimeNamespaceServeControlSmoke();
}

export function runRuntimeModelAndRuntimeControlSurfaceSmoke() {
  runRuntimeStartControlSmoke();
  runRuntimeModelControlSurfaceSmoke();
  runRuntimeStatusControlSmoke();
}

export function runRuntimeExperienceStateControlSurfaceSmoke() {
  runRuntimeExperienceControlSurfaceSmoke();
  runRuntimeStorageSessionControlSurfaceSmoke();
}

export function runRuntimeToolContextControlSurfaceSmoke() {
  runRuntimeToolStartControlSurfaceSmoke();
  runRuntimeToolStatusControlSurfaceSmoke();
  runRuntimeContextStatusControlSmoke();
}

export async function runRuntimeManagementGcControlSurfaceSmoke() {
  await runRuntimeManagementConfigControlSmoke();
  runRuntimeGcControlSmoke();
}

export async function runRuntimeControlSurfaceSmoke() {
  await runRuntimeNamespaceControlSurfaceSmoke();
  runRuntimeModelAndRuntimeControlSurfaceSmoke();
  runRuntimeExperienceStateControlSurfaceSmoke();
  runRuntimeToolContextControlSurfaceSmoke();
  await runRuntimeManagementGcControlSurfaceSmoke();
}
