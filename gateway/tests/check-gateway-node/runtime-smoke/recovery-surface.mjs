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
export async function runRuntimeRecoverySurfaceSmoke() {
  const statusNonRecoverableResult = runContract("start-smoke-contract.mjs", "status-nonrecoverable-tool-recovery", [
    "--repo-root",
    repoRoot,
  ], {
    timeoutMs: 240_000,
  });
  const statusNonRecoverablePayload = parseJsonOutput(
    "start-smoke-contract status-nonrecoverable-tool-recovery",
    statusNonRecoverableResult.stdout,
  );
  assert.equal(statusNonRecoverablePayload.exit_code, 0);
  assert.equal(statusNonRecoverablePayload.text_exit_code, 0);
  assert.equal(statusNonRecoverablePayload.status_json_parse_ok, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_active, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_recoverable, false);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_same_tool_error_count, 3);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_escalated, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_escalation_reason, "same_tool_error_exhausted");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_base_recovery_stage, "strategy_switch");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_base_recommended_next_action, "switch_tool_strategy");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_count, 2);
  assert.equal(typeof statusNonRecoverablePayload.recovery_timeline_latest_recovery_key, "string");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_active, true);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_consumed, false);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_tool_name, "web_scan");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_same_tool_error_count, 3);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_escalated, true);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_escalation_reason, "same_tool_error_exhausted");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_base_recovery_stage, "strategy_switch");
  assert.equal(
    statusNonRecoverablePayload.recovery_timeline_latest_base_recommended_next_action,
    "switch_tool_strategy",
  );
  assert.equal(statusNonRecoverablePayload.recovery_feedback_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_feedback_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_feedback_runtime_retry_allowed, false);
  assert.equal(
    statusNonRecoverablePayload.recovery_feedback_runtime_commands,
    "grobot status --json|grobot status --probe --json",
  );
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_timeline_latest_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_timeline_previous_tool_name, "read");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_latest_recovery_key,
    statusNonRecoverablePayload.recovery_timeline_latest_recovery_key,
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_score, 36);
  assert.equal(statusNonRecoverablePayload.recovery_health_level, "risk");
  assert.equal(statusNonRecoverablePayload.recovery_health_reason, "active_nonrecoverable_recovery");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_recommended_next_action,
    "ask_user_for_config_or_switch_provider",
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_source, "latest");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_attention_recovery_key,
    statusNonRecoverablePayload.recovery_timeline_latest_recovery_key,
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_tool_name, "web_scan");
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_requires_user_intervention, true);
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_attention_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_policy_timeline_max_entries, 20);
  assert.equal(statusNonRecoverablePayload.recovery_policy_escalation_strategy_switch_threshold, 2);
  assert.equal(statusNonRecoverablePayload.recovery_policy_escalation_ask_user_threshold, 3);
  assert.equal(statusNonRecoverablePayload.recovery_policy_escalation_environment_ask_user_threshold, 2);
  assert.equal(statusNonRecoverablePayload.recovery_policy_health_watch_threshold, 85);
  assert.equal(statusNonRecoverablePayload.recovery_policy_health_risk_threshold, 60);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_status, "blocked");
  assert.equal(statusNonRecoverablePayload.recovery_readiness_ready, false);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_auto_allowed, false);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_operator_action_required, true);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_readiness_watch_threshold, 85);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_risk_threshold, 60);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_attention_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_readiness_attention_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_readiness_attention_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_gate_status, "fail");
  assert.equal(statusNonRecoverablePayload.recovery_gate_passed, false);
  assert.equal(statusNonRecoverablePayload.recovery_gate_blocking, true);
  assert.equal(statusNonRecoverablePayload.recovery_gate_severity, "error");
  assert.equal(statusNonRecoverablePayload.recovery_gate_reason, "blocked_operator_action_required");
  assert.equal(statusNonRecoverablePayload.recovery_gate_blocker_kind, "runtime_environment");
  assert.equal(statusNonRecoverablePayload.recovery_gate_blocker_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_gate_blocker_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_gate_readiness_status, "blocked");
  assert.equal(statusNonRecoverablePayload.recovery_gate_auto_allowed, false);
  assert.equal(statusNonRecoverablePayload.recovery_gate_operator_action_required, true);
  assert.equal(statusNonRecoverablePayload.recovery_gate_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_gate_watch_threshold, 85);
  assert.equal(statusNonRecoverablePayload.recovery_gate_risk_threshold, 60);
  assert.equal(statusNonRecoverablePayload.recovery_gate_attention_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_gate_attention_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_gate_attention_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_active_recovery_count, 1);
  assert.equal(statusNonRecoverablePayload.recovery_health_active_nonrecoverable_count, 1);
  assert.equal(statusNonRecoverablePayload.recovery_health_unconsumed_count, 2);
  assert.equal(statusNonRecoverablePayload.recovery_health_has_stuck_nonrecoverable, true);
  assert.equal(statusNonRecoverablePayload.surface_adaptation_active, false);
  assert.equal(
    statusNonRecoverablePayload.surface_adaptation_reason,
    "recovery_gate_runtime_environment_config_missing",
  );
  assert.equal(statusNonRecoverablePayload.surface_adaptation_from_profile, "coding");
  assert.equal(statusNonRecoverablePayload.surface_adaptation_applied_profile, "coding");
  assert.equal(statusNonRecoverablePayload.surface_adaptation_auto_adaptation_blocked, true);
  assert.equal(statusNonRecoverablePayload.surface_adaptation_recovery_recoverable, false);
  assert.equal(statusNonRecoverablePayload.text_has_requires_user_intervention, true);
  assert.equal(statusNonRecoverablePayload.text_has_auto_adaptation_blocked, true);
  assert.equal(statusNonRecoverablePayload.text_has_nonrecoverable_reason, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_timeline, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_feedback_runtime_environment, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_readiness_runtime_environment, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_gate_runtime_environment, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_health, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_policy, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_readiness, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_gate, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_feedback_escalation_tuple, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_timeline_escalation_tuple, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_readiness_thresholds, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_gate_thresholds, true);
  logStep("start-smoke-contract status-nonrecoverable-tool-recovery");

  const statusInvalidConfigRecoveryResult = runContract(
    "start-smoke-contract.mjs",
    "status-invalid-config-runtime-recovery",
    [
      "--repo-root",
      repoRoot,
    ],
    {
      timeoutMs: 240_000,
    },
  );
  const statusInvalidConfigRecoveryPayload = parseJsonOutput(
    "start-smoke-contract status-invalid-config-runtime-recovery",
    statusInvalidConfigRecoveryResult.stdout,
  );
  assert.equal(statusInvalidConfigRecoveryPayload.exit_code, 0);
  assert.equal(statusInvalidConfigRecoveryPayload.text_exit_code, 0);
  assert.equal(statusInvalidConfigRecoveryPayload.status_json_parse_ok, true);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_active, true);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_stage, "ask_user");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_tool_name, "model_provider");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_error_class, "config_invalid");
  assert.equal(
    statusInvalidConfigRecoveryPayload.recovery_feedback_action,
    "ask_user_for_config_or_switch_provider",
  );
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_recoverable, false);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_runtime_error_code, "CONFIG_INVALID");
  assert.equal(
    statusInvalidConfigRecoveryPayload.recovery_feedback_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_feedback_runtime_retry_allowed, false);
  assert.equal(
    statusInvalidConfigRecoveryPayload.recovery_feedback_runtime_commands,
    "grobot status --json|grobot status --probe --json",
  );
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_timeline_count, 1);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_timeline_latest_tool_name, "model_provider");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_timeline_latest_error_class, "config_invalid");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_timeline_latest_runtime_error_code, "CONFIG_INVALID");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_health_attention_runtime_error_code, "CONFIG_INVALID");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_readiness_status, "blocked");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_readiness_ready, false);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_readiness_auto_allowed, false);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_readiness_operator_action_required, true);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_readiness_attention_runtime_error_code, "CONFIG_INVALID");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_gate_status, "fail");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_gate_passed, false);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_gate_blocking, true);
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_gate_reason, "blocked_operator_action_required");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_gate_blocker_kind, "runtime_environment");
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_gate_blocker_code, "CONFIG_INVALID");
  assert.equal(
    statusInvalidConfigRecoveryPayload.recovery_gate_blocker_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusInvalidConfigRecoveryPayload.recovery_gate_attention_runtime_error_code, "CONFIG_INVALID");
  assert.equal(statusInvalidConfigRecoveryPayload.surface_adaptation_active, false);
  assert.equal(
    statusInvalidConfigRecoveryPayload.surface_adaptation_reason,
    "recovery_gate_runtime_environment_config_invalid",
  );
  assert.equal(statusInvalidConfigRecoveryPayload.surface_adaptation_auto_adaptation_blocked, true);
  assert.equal(statusInvalidConfigRecoveryPayload.text_has_recovery_feedback_runtime_environment, true);
  assert.equal(statusInvalidConfigRecoveryPayload.text_has_recovery_readiness_runtime_environment, true);
  assert.equal(statusInvalidConfigRecoveryPayload.text_has_recovery_gate_runtime_environment, true);
  assert.equal(statusInvalidConfigRecoveryPayload.text_has_invalid_config_blocker, true);
  logStep("start-smoke-contract status-invalid-config-runtime-recovery");

  const statusBrowserEnvironmentRecoveryResult = runContract(
    "start-smoke-contract.mjs",
    "status-browser-environment-tool-recovery",
    [
      "--repo-root",
      repoRoot,
    ],
    {
      timeoutMs: 240_000,
    },
  );
  const statusBrowserEnvironmentRecoveryPayload = parseJsonOutput(
    "start-smoke-contract status-browser-environment-tool-recovery",
    statusBrowserEnvironmentRecoveryResult.stdout,
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.exit_code, 0);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_exit_code, 0);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.status_json_parse_ok, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_active, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_stage, "ask_user");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_action, "request_environment_fix");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_recoverable, false);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_same_tool_error_count, 2);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_feedback_escalation_reason,
    "browser_environment_error_repeated",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_tool_name, "web_scan");
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_error_class,
    "browser_backend_result_error",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_latest_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_latest_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_status, "blocked");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_operator_action_required, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_status, "fail");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_reason, "blocked_operator_action_required");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_blocker_kind, "browser_environment");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_blocker_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_blocker_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_has_recovery_feedback_browser_environment, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_has_recovery_readiness_browser_environment, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_has_recovery_gate_browser_environment, true);
  logStep("start-smoke-contract status-browser-environment-tool-recovery");

  const statusMcpEnvironmentRecoveryResult = runContract(
    "start-smoke-contract.mjs",
    "status-mcp-environment-tool-recovery",
    [
      "--repo-root",
      repoRoot,
    ],
    {
      timeoutMs: 240_000,
    },
  );
  const statusMcpEnvironmentRecoveryPayload = parseJsonOutput(
    "start-smoke-contract status-mcp-environment-tool-recovery",
    statusMcpEnvironmentRecoveryResult.stdout,
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.exit_code, 0);
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_exit_code, 0);
  assert.equal(statusMcpEnvironmentRecoveryPayload.status_json_parse_ok, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_active, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_stage, "ask_user");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_action, "request_environment_fix");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_recoverable, false);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_retry_allowed, false);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_commands, "grobot status --json");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_server, "grok-search");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_tool_name, "web_search");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_source_path, ".grobot/mcp.toml");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_ready_reason, "command_not_found");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_command, null);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_available_servers, null);
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_registry_paths,
    "~/.grobot/mcp/servers.toml|.grobot/mcp.toml",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_tool_name, "mcp_call");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_error_class, "mcp_server_unready");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_mcp_retry_allowed, false);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_health_attention_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_health_attention_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_readiness_status, "blocked");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_readiness_operator_action_required, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_readiness_attention_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_readiness_attention_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_status, "fail");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_reason, "blocked_operator_action_required");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_blocker_kind, "mcp_environment");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_blocker_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_gate_blocker_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_attention_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_gate_attention_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_has_recovery_feedback_mcp_environment, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_has_recovery_readiness_mcp_environment, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_has_recovery_gate_mcp_environment, true);
  logStep("start-smoke-contract status-mcp-environment-tool-recovery");

  const statusNonRecoverableConsumedResult = runContract(
    "start-smoke-contract.mjs",
    "status-nonrecoverable-tool-recovery-consumed",
    [
      "--repo-root",
      repoRoot,
    ],
    {
      timeoutMs: 240_000,
    },
  );
  const statusNonRecoverableConsumedPayload = parseJsonOutput(
    "start-smoke-contract status-nonrecoverable-tool-recovery-consumed",
    statusNonRecoverableConsumedResult.stdout,
  );
  assert.equal(statusNonRecoverableConsumedPayload.exit_code, 0);
  assert.equal(statusNonRecoverableConsumedPayload.text_exit_code, 0);
  assert.equal(statusNonRecoverableConsumedPayload.status_json_parse_ok, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_active, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_reason, "consumed_nonrecoverable_intervention_prompted");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_recoverable, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_consumed, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_feedback_consumed_reason,
    "nonrecoverable_intervention_prompted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_same_tool_error_count, 3);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_escalated, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_feedback_escalation_reason,
    "same_tool_error_exhausted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_base_recovery_stage, "strategy_switch");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_feedback_base_recommended_next_action,
    "switch_tool_strategy",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_count, 2);
  assert.equal(typeof statusNonRecoverableConsumedPayload.recovery_timeline_latest_recovery_key, "string");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_active, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_consumed, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_consumed_reason,
    "nonrecoverable_intervention_prompted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_tool_name, "web_scan");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_same_tool_error_count, 3);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_escalated, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_escalation_reason,
    "same_tool_error_exhausted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_base_recovery_stage, "strategy_switch");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_base_recommended_next_action,
    "switch_tool_strategy",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_previous_tool_name, "read");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_latest_recovery_key,
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_recovery_key,
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_score, 96);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_level, "watch");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_reason,
    "historical_unconsumed_recovery",
  );
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_recommended_next_action,
    "locate_path_with_glob_before_retry",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_attention_source, "historical_unconsumed");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_attention_recovery_key,
    statusNonRecoverableConsumedPayload.recovery_timeline_previous_recovery_key,
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_attention_tool_name, "read");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_attention_requires_user_intervention, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_timeline_max_entries, 20);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_escalation_strategy_switch_threshold, 2);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_escalation_ask_user_threshold, 3);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_escalation_environment_ask_user_threshold, 2);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_health_watch_threshold, 85);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_health_risk_threshold, 60);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_status, "degraded");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_ready, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_auto_allowed, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_operator_action_required, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_watch_threshold, 85);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_risk_threshold, 60);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_attention_stage, "local_fix");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_status, "warn");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_passed, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_blocking, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_severity, "warning");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_reason, "degraded_auto_recovery_allowed");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_readiness_status, "degraded");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_auto_allowed, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_operator_action_required, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_watch_threshold, 85);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_risk_threshold, 60);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_attention_stage, "local_fix");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_active_recovery_count, 0);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_active_nonrecoverable_count, 0);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_unconsumed_count, 1);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_has_stuck_nonrecoverable, false);
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_active, false);
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_reason, "consumed_nonrecoverable_intervention_prompted");
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_auto_adaptation_blocked, false);
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_recovery_recoverable, false);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_consumed_nonrecoverable, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_timeline, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_health, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_policy, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_readiness, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_gate, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_feedback_escalation_tuple, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_timeline_escalation_tuple, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_readiness_thresholds, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_gate_thresholds, true);
  logStep("start-smoke-contract status-nonrecoverable-tool-recovery-consumed");
}
