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

  const interruptTtlPort = await reserveFreePort();
  const interruptTtlWorkDir = makeTempDir("management-interrupt-work");
  const interruptTtlResult = runContract(
    "management-interrupt-contract.mjs",
    "interrupt-ttl-validation",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      interruptTtlWorkDir,
      "--bind",
      `127.0.0.1:${interruptTtlPort}`,
      "--management-token",
      "ops-token",
    ],
    { timeoutMs: 240_000 },
  );
  const interruptTtlPayload = parseJsonOutput(
    "management-interrupt-contract interrupt-ttl-validation",
    interruptTtlResult.stdout,
  );
  assert.equal(interruptTtlPayload.ready, true);
  assert.equal(interruptTtlPayload.valid_ttl_status, 200);
  assert.equal(interruptTtlPayload.valid_ttl_secs, 42);
  assert.equal(interruptTtlPayload.default_ttl_status, 200);
  assert.equal(interruptTtlPayload.default_ttl_secs, 300);
  assert.equal(interruptTtlPayload.invalid_zero_status, 400);
  assert.equal(interruptTtlPayload.invalid_zero_error, "invalid_ttl_secs");
  assert.equal(interruptTtlPayload.invalid_string_status, 400);
  assert.equal(interruptTtlPayload.invalid_string_error, "invalid_ttl_secs");
  assert.equal(interruptTtlPayload.invalid_shape_status, 400);
  assert.equal(interruptTtlPayload.invalid_shape_error, "bad_request");
  assert.equal(interruptTtlPayload.invalid_json_status, 400);
  assert.equal(interruptTtlPayload.invalid_json_error, "bad_request");
  assert.equal(interruptTtlPayload.invalid_json_detail_has_context, true);
  logStep("management-interrupt-contract interrupt-ttl-validation");

  const memoryInputPort = await reserveFreePort();
  const memoryInputWorkDir = makeTempDir("management-memory-work");
  const memoryInputResult = runContract(
    "management-memory-contract.mjs",
    "memory-input-validation",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      memoryInputWorkDir,
      "--bind",
      `127.0.0.1:${memoryInputPort}`,
      "--management-token",
      "ops-token",
    ],
    { timeoutMs: 240_000 },
  );
  const memoryInputPayload = parseJsonOutput(
    "management-memory-contract memory-input-validation",
    memoryInputResult.stdout,
  );
  assert.equal(memoryInputPayload.ready, true);
  assert.equal(memoryInputPayload.invalid_list_limit_status, 400);
  assert.equal(memoryInputPayload.invalid_list_limit_error, "invalid_limit");
  assert.equal(memoryInputPayload.invalid_list_limit_field, "limit");
  assert.equal(memoryInputPayload.invalid_list_limit_zero_status, 400);
  assert.equal(memoryInputPayload.invalid_list_limit_zero_error, "invalid_limit");
  assert.equal(memoryInputPayload.invalid_list_include_archived_status, 400);
  assert.equal(memoryInputPayload.invalid_list_include_archived_error, "invalid_include_archived");
  assert.equal(memoryInputPayload.invalid_list_include_archived_field, "include_archived");
  assert.equal(memoryInputPayload.invalid_list_cursor_empty_status, 400);
  assert.equal(memoryInputPayload.invalid_list_cursor_empty_error, "invalid_cursor");
  assert.equal(memoryInputPayload.invalid_list_cursor_empty_field, "cursor");
  assert.equal(memoryInputPayload.invalid_list_cursor_alpha_status, 400);
  assert.equal(memoryInputPayload.invalid_list_cursor_alpha_error, "invalid_cursor");
  assert.equal(memoryInputPayload.invalid_list_cursor_alpha_field, "cursor");
  assert.equal(memoryInputPayload.invalid_list_cursor_oversized_status, 400);
  assert.equal(memoryInputPayload.invalid_list_cursor_oversized_error, "cursor_too_large");
  assert.equal(memoryInputPayload.invalid_list_cursor_oversized_field, "cursor");
  assert.equal(memoryInputPayload.invalid_list_scope_status, 400);
  assert.equal(memoryInputPayload.invalid_list_scope_error, "invalid_scope");
  assert.equal(memoryInputPayload.invalid_list_scope_field, "scope");
  assert.equal(memoryInputPayload.invalid_list_query_empty_status, 400);
  assert.equal(memoryInputPayload.invalid_list_query_empty_error, "invalid_query");
  assert.equal(memoryInputPayload.invalid_list_query_empty_field, "query");
  assert.equal(memoryInputPayload.invalid_list_kind_empty_status, 400);
  assert.equal(memoryInputPayload.invalid_list_kind_empty_error, "invalid_kind");
  assert.equal(memoryInputPayload.invalid_list_kind_empty_field, "kind");
  assert.equal(memoryInputPayload.invalid_list_kind_unknown_status, 400);
  assert.equal(memoryInputPayload.invalid_list_kind_unknown_error, "invalid_kind");
  assert.equal(memoryInputPayload.invalid_list_kind_unknown_field, "kind");
  assert.equal(memoryInputPayload.invalid_list_classification_empty_status, 400);
  assert.equal(memoryInputPayload.invalid_list_classification_empty_error, "invalid_classification");
  assert.equal(memoryInputPayload.invalid_list_classification_empty_field, "classification");
  assert.equal(memoryInputPayload.invalid_list_classification_unknown_status, 400);
  assert.equal(memoryInputPayload.invalid_list_classification_unknown_error, "invalid_classification");
  assert.equal(memoryInputPayload.invalid_list_classification_unknown_field, "classification");
  assert.equal(memoryInputPayload.invalid_export_include_secret_status, 400);
  assert.equal(memoryInputPayload.invalid_export_include_secret_error, "invalid_include_secret");
  assert.equal(memoryInputPayload.invalid_export_include_secret_field, "include_secret");
  assert.equal(memoryInputPayload.invalid_export_cursor_empty_status, 400);
  assert.equal(memoryInputPayload.invalid_export_cursor_empty_error, "invalid_cursor");
  assert.equal(memoryInputPayload.invalid_export_cursor_empty_field, "cursor");
  assert.equal(memoryInputPayload.invalid_export_scope_status, 400);
  assert.equal(memoryInputPayload.invalid_export_scope_error, "invalid_scope");
  assert.equal(memoryInputPayload.invalid_export_scope_field, "scope");
  assert.equal(memoryInputPayload.invalid_export_query_empty_status, 400);
  assert.equal(memoryInputPayload.invalid_export_query_empty_error, "invalid_query");
  assert.equal(memoryInputPayload.invalid_export_query_empty_field, "query");
  assert.equal(memoryInputPayload.invalid_import_dry_run_status, 400);
  assert.equal(memoryInputPayload.invalid_import_dry_run_error, "invalid_dry_run");
  assert.equal(memoryInputPayload.invalid_import_dry_run_field, "dry_run");
  assert.equal(memoryInputPayload.invalid_import_scope_status, 400);
  assert.equal(memoryInputPayload.invalid_import_scope_error, "invalid_scope");
  assert.equal(memoryInputPayload.invalid_import_scope_field, "scope");
  assert.equal(memoryInputPayload.invalid_import_source_status, 400);
  assert.equal(memoryInputPayload.invalid_import_source_error, "invalid_source");
  assert.equal(memoryInputPayload.invalid_import_source_field, "source");
  assert.equal(memoryInputPayload.invalid_import_importance_status, 400);
  assert.equal(memoryInputPayload.invalid_import_importance_error, "memory_import_failed");
  assert.equal(memoryInputPayload.invalid_import_importance_detail_error, "invalid_record_schema");
  assert.equal(memoryInputPayload.invalid_import_importance_field, "importance");
  assert.equal(memoryInputPayload.invalid_import_tags_entry_status, 400);
  assert.equal(memoryInputPayload.invalid_import_tags_entry_error, "memory_import_failed");
  assert.equal(memoryInputPayload.invalid_import_tags_entry_detail_error, "invalid_record_schema");
  assert.equal(memoryInputPayload.invalid_import_tags_entry_field, "tags[1]");
  assert.equal(memoryInputPayload.invalid_import_evidence_ref_status, 400);
  assert.equal(memoryInputPayload.invalid_import_evidence_ref_error, "memory_import_failed");
  assert.equal(memoryInputPayload.invalid_import_evidence_ref_detail_error, "invalid_record_schema");
  assert.equal(memoryInputPayload.invalid_import_evidence_ref_field, "evidence_ref.trace_id");
  assert.equal(memoryInputPayload.valid_import_defaults_status, 200);
  assert.equal(memoryInputPayload.valid_import_defaults_imported_count, 1);
  assert.equal(memoryInputPayload.oversized_import_records_status, 400);
  assert.equal(memoryInputPayload.oversized_import_records_error, "memory_import_failed");
  assert.equal(memoryInputPayload.oversized_import_records_detail_error, "invalid_record_batch_size");
  assert.equal(Number(memoryInputPayload.oversized_import_records_batch_limit), 200);
  assert.equal(memoryInputPayload.invalid_forget_dry_run_status, 400);
  assert.equal(memoryInputPayload.invalid_forget_dry_run_error, "invalid_dry_run");
  assert.equal(memoryInputPayload.invalid_forget_dry_run_field, "dry_run");
  assert.equal(memoryInputPayload.invalid_forget_scope_status, 400);
  assert.equal(memoryInputPayload.invalid_forget_scope_error, "invalid_scope");
  assert.equal(memoryInputPayload.invalid_forget_scope_field, "scope");
  assert.equal(memoryInputPayload.invalid_forget_id_status, 400);
  assert.equal(memoryInputPayload.invalid_forget_id_error, "invalid_id");
  assert.equal(memoryInputPayload.invalid_forget_id_field, "id");
  assert.equal(memoryInputPayload.invalid_forget_ids_type_status, 400);
  assert.equal(memoryInputPayload.invalid_forget_ids_type_error, "invalid_ids");
  assert.equal(memoryInputPayload.invalid_forget_ids_type_field, "ids");
  assert.equal(memoryInputPayload.invalid_forget_ids_entry_status, 400);
  assert.equal(memoryInputPayload.invalid_forget_ids_entry_error, "invalid_ids");
  assert.equal(memoryInputPayload.invalid_forget_ids_entry_field, "ids");
  assert.equal(memoryInputPayload.invalid_forget_reason_status, 400);
  assert.equal(memoryInputPayload.invalid_forget_reason_error, "invalid_reason");
  assert.equal(memoryInputPayload.invalid_forget_reason_field, "reason");
  assert.equal(memoryInputPayload.oversized_forget_ids_status, 400);
  assert.equal(memoryInputPayload.oversized_forget_ids_error, "memory_forget_failed");
  assert.equal(memoryInputPayload.oversized_forget_ids_detail_error, "invalid_record_ids_batch_size");
  assert.equal(Number(memoryInputPayload.oversized_forget_ids_batch_limit), 200);
  assert.equal(memoryInputPayload.invalid_lifecycle_dry_run_status, 400);
  assert.equal(memoryInputPayload.invalid_lifecycle_dry_run_error, "invalid_dry_run");
  assert.equal(memoryInputPayload.invalid_lifecycle_dry_run_field, "dry_run");
  assert.equal(memoryInputPayload.invalid_lifecycle_scope_status, 400);
  assert.equal(memoryInputPayload.invalid_lifecycle_scope_error, "invalid_scope");
  assert.equal(memoryInputPayload.invalid_lifecycle_scope_field, "scope");
  assert.equal(memoryInputPayload.invalid_batch_limit_status, 400);
  assert.equal(memoryInputPayload.invalid_batch_limit_error, "invalid_limit");
  assert.equal(memoryInputPayload.invalid_batch_limit_field, "limit");
  assert.equal(memoryInputPayload.invalid_batch_scope_status, 400);
  assert.equal(memoryInputPayload.invalid_batch_scope_error, "invalid_scope");
  assert.equal(memoryInputPayload.invalid_batch_scope_field, "scope");
  assert.equal(memoryInputPayload.oversized_batch_limit_status, 400);
  assert.equal(memoryInputPayload.oversized_batch_limit_error, "invalid_limit");
  assert.equal(memoryInputPayload.oversized_batch_limit_field, "limit");
  assert.equal(memoryInputPayload.invalid_batch_sessions_type_status, 400);
  assert.equal(memoryInputPayload.invalid_batch_sessions_type_error, "invalid_sessions");
  assert.equal(memoryInputPayload.invalid_batch_sessions_type_field, "sessions");
  assert.equal(memoryInputPayload.invalid_batch_sessions_entry_status, 400);
  assert.equal(memoryInputPayload.invalid_batch_sessions_entry_error, "invalid_sessions");
  assert.equal(memoryInputPayload.invalid_batch_sessions_entry_field, "sessions");
  assert.equal(memoryInputPayload.invalid_batch_session_prefix_status, 400);
  assert.equal(memoryInputPayload.invalid_batch_session_prefix_error, "invalid_session_prefix");
  assert.equal(memoryInputPayload.invalid_batch_session_prefix_field, "session_prefix");
  assert.equal(memoryInputPayload.invalid_batch_session_prefixes_entry_status, 400);
  assert.equal(memoryInputPayload.invalid_batch_session_prefixes_entry_error, "invalid_session_prefixes");
  assert.equal(memoryInputPayload.invalid_batch_session_prefixes_entry_field, "session_prefixes");
  assert.equal(memoryInputPayload.valid_list_status, 200);
  assert.equal(memoryInputPayload.valid_list_limit, 1);
  assert.equal(memoryInputPayload.valid_list_include_archived, true);
  logStep("management-memory-contract memory-input-validation");

  const experienceInputPort = await reserveFreePort();
  const experienceInputWorkDir = makeTempDir("management-experience-work");
  const experienceInputResult = runContract(
    "management-experience-contract.mjs",
    "experience-input-validation",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      experienceInputWorkDir,
      "--bind",
      `127.0.0.1:${experienceInputPort}`,
      "--management-token",
      "ops-token",
    ],
    { timeoutMs: 240_000 },
  );
  const experienceInputPayload = parseJsonOutput(
    "management-experience-contract experience-input-validation",
    experienceInputResult.stdout,
  );
  assert.equal(experienceInputPayload.ready, true);
  assert.equal(experienceInputPayload.invalid_limit_alpha_status, 400);
  assert.equal(experienceInputPayload.invalid_limit_alpha_error, "invalid_limit");
  assert.equal(experienceInputPayload.invalid_limit_alpha_field, "limit");
  assert.equal(experienceInputPayload.invalid_limit_zero_status, 400);
  assert.equal(experienceInputPayload.invalid_limit_zero_error, "invalid_limit");
  assert.equal(experienceInputPayload.invalid_limit_zero_field, "limit");
  assert.equal(experienceInputPayload.invalid_limit_oversized_status, 400);
  assert.equal(experienceInputPayload.invalid_limit_oversized_error, "invalid_limit");
  assert.equal(experienceInputPayload.invalid_limit_oversized_field, "limit");
  assert.equal(experienceInputPayload.invalid_states_partial_status, 400);
  assert.equal(experienceInputPayload.invalid_states_partial_error, "invalid_states");
  assert.equal(experienceInputPayload.invalid_states_partial_field, "states");
  assert.equal(experienceInputPayload.invalid_states_empty_status, 400);
  assert.equal(experienceInputPayload.invalid_states_empty_error, "invalid_states");
  assert.equal(experienceInputPayload.invalid_states_empty_field, "states");
  assert.equal(experienceInputPayload.invalid_tenant_empty_status, 400);
  assert.equal(experienceInputPayload.invalid_tenant_empty_error, "invalid_tenant");
  assert.equal(experienceInputPayload.invalid_tenant_empty_field, "tenant");
  assert.equal(experienceInputPayload.invalid_team_empty_status, 400);
  assert.equal(experienceInputPayload.invalid_team_empty_error, "invalid_team");
  assert.equal(experienceInputPayload.invalid_team_empty_field, "team");
  assert.equal(experienceInputPayload.invalid_user_empty_status, 400);
  assert.equal(experienceInputPayload.invalid_user_empty_error, "invalid_user");
  assert.equal(experienceInputPayload.invalid_user_empty_field, "user");
  assert.equal(experienceInputPayload.invalid_query_empty_status, 400);
  assert.equal(experienceInputPayload.invalid_query_empty_error, "invalid_q");
  assert.equal(experienceInputPayload.invalid_query_empty_field, "q");
  assert.equal(experienceInputPayload.invalid_state_empty_status, 400);
  assert.equal(experienceInputPayload.invalid_state_empty_error, "invalid_state");
  assert.equal(experienceInputPayload.invalid_state_empty_field, "state");
  assert.equal(experienceInputPayload.invalid_state_unknown_status, 400);
  assert.equal(experienceInputPayload.invalid_state_unknown_error, "invalid_state");
  assert.equal(experienceInputPayload.invalid_state_unknown_field, "state");
  assert.equal(experienceInputPayload.invalid_state_number_status, 400);
  assert.equal(experienceInputPayload.invalid_state_number_error, "invalid_state");
  assert.equal(experienceInputPayload.invalid_state_number_field, "state");
  assert.equal(experienceInputPayload.invalid_reason_empty_status, 400);
  assert.equal(experienceInputPayload.invalid_reason_empty_error, "invalid_reason");
  assert.equal(experienceInputPayload.invalid_reason_empty_field, "reason");
  assert.equal(experienceInputPayload.invalid_reason_number_status, 400);
  assert.equal(experienceInputPayload.invalid_reason_number_error, "invalid_reason");
  assert.equal(experienceInputPayload.invalid_reason_number_field, "reason");
  assert.equal(experienceInputPayload.valid_state_missing_record_status, 404);
  assert.equal(experienceInputPayload.valid_state_missing_record_error, "experience_not_found");
  assert.equal(experienceInputPayload.valid_list_status, 200);
  assert.equal(experienceInputPayload.valid_list_mode, "list");
  assert.equal(experienceInputPayload.valid_list_total_type, "number");
  logStep("management-experience-contract experience-input-validation");
}
