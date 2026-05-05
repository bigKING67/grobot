import {
  EXPECTED_REPEATED_TOOL_RECOVERY_ESCALATION_STATUS,
  assertRuntimeToolRecoveryEscalationStatusSurface,
  assertRuntimeToolRecoveryPolicyStatusSurface,
  runtimeToolRecoveryEscalationTextSurface,
  runtimeToolRecoveryReadinessTextSurface,
} from "./runtime-tool-status.mjs";
import {
  browserEnvironmentRecoveryPlanSummary,
  mcpEnvironmentRecoveryPlanSummary,
  runtimeEnvironmentRecoveryPlanSummary,
  writeBrowserEnvironmentToolRecoveryMetrics,
  writeGateBlockedRecoverableToolRecoveryMetrics,
  writeMcpEnvironmentToolRecoveryMetrics,
  writeNonRecoverableToolRecoveryConsumption,
  writeNonRecoverableToolRecoveryMetrics,
} from "./recovery-fixtures.mjs";
export {
  runStatusNonRecoverableToolRecovery,
} from "./recovery-flows/nonrecoverable-status.mjs";

export function runStartRecoveryGateBlocksSurfaceAdaptation(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    parseJsonObjectSafe,
    isObject,
    writeConfig,
    buildFailoverConfig,
  } = context;
  const workDir = createTempDir("grobot-start-recovery-gate-work");
  const config = writeConfig(buildFailoverConfig(workDir));
  writeGateBlockedRecoverableToolRecoveryMetrics(workDir);
  const result = runCommand(repoRoot, [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "recovery-gate-surface-user",
    "--no-shadow-mode",
    "--provider",
    "failing",
    "--message",
    "ts rust recovery gate surface smoke",
  ], {
    GROBOT_STARTUP_DIAGNOSTICS: "1",
  });
  return {
    ...result,
    has_gate_blocked_surface:
      result.stderr.includes("[tool-surface] event=adaptation_blocked")
      && result.stderr.includes("reason=recovery_gate_blocked_operator_action_required"),
    has_recovery_gate_blocked_event:
      result.stderr.includes("[tool-recovery-gate] event=blocked")
      && result.stderr.includes("reason=blocked_operator_action_required"),
    has_recovery_gate_policy_context:
      new RegExp("\\[tool-recovery-gate\\] [^\\n]*policy_version=v1").test(result.stderr)
      && new RegExp("\\[tool-recovery-gate\\] [^\\n]*health_thresholds=85/60").test(result.stderr),
    has_no_auto_browser_adaptation:
      !result.stderr.includes("[tool-surface] event=adapted")
      && !result.stderr.includes("to=browser"),
    has_auto_adaptation_blocked:
      result.stderr.includes("auto_adaptation_blocked=true"),
    has_recoverable_latest_signal:
      result.stderr.includes("stage=strategy_switch")
      && result.stderr.includes("tool=web_scan")
      && result.stderr.includes("recoverable=true"),
  };
}

export function runStatusBrowserEnvironmentToolRecovery(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    parseJsonObjectSafe,
    isObject,
    writeConfig,
    buildFailoverConfig,
  } = context;
  const workDir = createTempDir("grobot-status-browser-environment-recovery-work");
  writeExecutionProjectToml(workDir);
  writeBrowserEnvironmentToolRecoveryMetrics(workDir);
  const statusArgs = [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ];
  const jsonResult = runCommand(repoRoot, [...statusArgs, "--json"]);
  const textResult = runCommand(repoRoot, statusArgs, { GROBOT_STATUS_LEGACY_TEXT: "1" });
  const parsedStatus = parseJsonObjectSafe(jsonResult.stdout);
  const runtimeTools = isObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const recoveryFeedback = isObject(runtimeTools?.recovery_feedback)
    ? runtimeTools.recovery_feedback
    : null;
  const recoveryTimeline = Array.isArray(runtimeTools?.recovery_timeline)
    ? runtimeTools.recovery_timeline
    : [];
  const latestRecoveryTimeline = isObject(recoveryTimeline[0]) ? recoveryTimeline[0] : null;
  const recoveryHealth = isObject(runtimeTools?.recovery_health)
    ? runtimeTools.recovery_health
    : null;
  const recoveryReadiness = isObject(runtimeTools?.recovery_readiness)
    ? runtimeTools.recovery_readiness
    : null;
  const recoveryGate = isObject(runtimeTools?.recovery_gate)
    ? runtimeTools.recovery_gate
    : null;
  const timelinePlan = browserEnvironmentRecoveryPlanSummary(
    latestRecoveryTimeline?.browser_environment_recovery,
  );
  const healthAttentionPlan = browserEnvironmentRecoveryPlanSummary(
    recoveryHealth?.attention_browser_environment_recovery,
  );
  const healthLatestPlan = browserEnvironmentRecoveryPlanSummary(
    recoveryHealth?.latest_browser_environment_recovery,
  );
  const readinessAttentionPlan = browserEnvironmentRecoveryPlanSummary(
    recoveryReadiness?.attention_browser_environment_recovery,
  );
  const gateAttentionPlan = browserEnvironmentRecoveryPlanSummary(
    recoveryGate?.attention_browser_environment_recovery,
  );
  const feedbackPlan = browserEnvironmentRecoveryPlanSummary(
    recoveryFeedback?.browser_environment_recovery,
  );
  const textBrowserRecoverySnippet =
    "browser_environment_recovery=code=NO_EXTENSION action=setup_and_doctor retry_allowed=false commands=grobot browser setup|grobot browser doctor";
  return {
    exit_code: jsonResult.exit_code,
    text_exit_code: textResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    recovery_feedback_active: recoveryFeedback?.active ?? null,
    recovery_feedback_stage: recoveryFeedback?.stage ?? null,
    recovery_feedback_action: recoveryFeedback?.recommended_next_action ?? null,
    recovery_feedback_recoverable: recoveryFeedback?.recoverable ?? null,
    recovery_feedback_requires_user_intervention:
      recoveryFeedback?.requires_user_intervention ?? null,
    recovery_feedback_same_tool_error_count:
      recoveryFeedback?.same_tool_error_count ?? null,
    recovery_feedback_escalation_reason:
      recoveryFeedback?.escalation_reason ?? null,
    recovery_feedback_browser_error_code: feedbackPlan.error_code,
    recovery_feedback_browser_action: feedbackPlan.action,
    recovery_feedback_browser_retry_allowed: feedbackPlan.retry_allowed,
    recovery_feedback_browser_commands: feedbackPlan.commands,
    recovery_timeline_latest_stage: latestRecoveryTimeline?.stage ?? null,
    recovery_timeline_latest_tool_name: latestRecoveryTimeline?.tool_name ?? null,
    recovery_timeline_latest_error_class: latestRecoveryTimeline?.error_class ?? null,
    recovery_timeline_latest_browser_error_code: timelinePlan.error_code,
    recovery_timeline_latest_browser_action: timelinePlan.action,
    recovery_timeline_latest_browser_retry_allowed: timelinePlan.retry_allowed,
    recovery_timeline_latest_browser_commands: timelinePlan.commands,
    recovery_health_attention_browser_error_code: healthAttentionPlan.error_code,
    recovery_health_attention_browser_action: healthAttentionPlan.action,
    recovery_health_attention_browser_retry_allowed: healthAttentionPlan.retry_allowed,
    recovery_health_attention_browser_commands: healthAttentionPlan.commands,
    recovery_health_latest_browser_error_code: healthLatestPlan.error_code,
    recovery_health_latest_browser_action: healthLatestPlan.action,
    recovery_readiness_status: recoveryReadiness?.status ?? null,
    recovery_readiness_operator_action_required: recoveryReadiness?.operator_action_required ?? null,
    recovery_readiness_attention_browser_error_code: readinessAttentionPlan.error_code,
    recovery_readiness_attention_browser_action: readinessAttentionPlan.action,
    recovery_readiness_attention_browser_retry_allowed: readinessAttentionPlan.retry_allowed,
    recovery_readiness_attention_browser_commands: readinessAttentionPlan.commands,
    recovery_gate_status: recoveryGate?.status ?? null,
    recovery_gate_reason: recoveryGate?.reason ?? null,
    recovery_gate_blocker_kind: recoveryGate?.blocker_kind ?? null,
    recovery_gate_blocker_code: recoveryGate?.blocker_code ?? null,
    recovery_gate_blocker_action: recoveryGate?.blocker_action ?? null,
    recovery_gate_attention_browser_error_code: gateAttentionPlan.error_code,
    recovery_gate_attention_browser_action: gateAttentionPlan.action,
    recovery_gate_attention_browser_retry_allowed: gateAttentionPlan.retry_allowed,
    recovery_gate_attention_browser_commands: gateAttentionPlan.commands,
    text_has_recovery_feedback_browser_environment:
      textResult.stdout.includes("runtime_tool_recovery_feedback:")
      && textResult.stdout.includes(textBrowserRecoverySnippet),
    text_has_recovery_readiness_browser_environment:
      textResult.stdout.includes("runtime_tool_recovery_readiness:")
      && textResult.stdout.includes(textBrowserRecoverySnippet),
    text_has_recovery_gate_browser_environment:
      textResult.stdout.includes("runtime_tool_recovery_gate:")
      && textResult.stdout.includes(textBrowserRecoverySnippet),
  };
}

export function runStatusMcpEnvironmentToolRecovery(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    parseJsonObjectSafe,
    isObject,
    writeConfig,
    buildFailoverConfig,
  } = context;
  const workDir = createTempDir("grobot-status-mcp-environment-recovery-work");
  writeExecutionProjectToml(workDir);
  writeMcpEnvironmentToolRecoveryMetrics(workDir);
  const statusArgs = [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ];
  const jsonResult = runCommand(repoRoot, [...statusArgs, "--json"]);
  const textResult = runCommand(repoRoot, statusArgs, { GROBOT_STATUS_LEGACY_TEXT: "1" });
  const parsedStatus = parseJsonObjectSafe(jsonResult.stdout);
  const runtimeTools = isObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const recoveryFeedback = isObject(runtimeTools?.recovery_feedback)
    ? runtimeTools.recovery_feedback
    : null;
  const recoveryTimeline = Array.isArray(runtimeTools?.recovery_timeline)
    ? runtimeTools.recovery_timeline
    : [];
  const latestRecoveryTimeline = isObject(recoveryTimeline[0]) ? recoveryTimeline[0] : null;
  const recoveryHealth = isObject(runtimeTools?.recovery_health)
    ? runtimeTools.recovery_health
    : null;
  const recoveryReadiness = isObject(runtimeTools?.recovery_readiness)
    ? runtimeTools.recovery_readiness
    : null;
  const recoveryGate = isObject(runtimeTools?.recovery_gate)
    ? runtimeTools.recovery_gate
    : null;
  const feedbackPlan = mcpEnvironmentRecoveryPlanSummary(
    recoveryFeedback?.mcp_environment_recovery,
  );
  const timelinePlan = mcpEnvironmentRecoveryPlanSummary(
    latestRecoveryTimeline?.mcp_environment_recovery,
  );
  const healthAttentionPlan = mcpEnvironmentRecoveryPlanSummary(
    recoveryHealth?.attention_mcp_environment_recovery,
  );
  const readinessAttentionPlan = mcpEnvironmentRecoveryPlanSummary(
    recoveryReadiness?.attention_mcp_environment_recovery,
  );
  const gateAttentionPlan = mcpEnvironmentRecoveryPlanSummary(
    recoveryGate?.attention_mcp_environment_recovery,
  );
  const textMcpRecoverySnippet =
    "mcp_environment_recovery=code=SERVER_UNREADY action=fix_server_readiness_and_check_status retry_allowed=false server=grok-search tool=web_search source=.grobot/mcp.toml ready_reason=command_not_found command=<none> available_servers=<none> registry_paths=~/.grobot/mcp/servers.toml|.grobot/mcp.toml commands=grobot status --json";
  return {
    exit_code: jsonResult.exit_code,
    text_exit_code: textResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    recovery_feedback_active: recoveryFeedback?.active ?? null,
    recovery_feedback_stage: recoveryFeedback?.stage ?? null,
    recovery_feedback_action: recoveryFeedback?.recommended_next_action ?? null,
    recovery_feedback_recoverable: recoveryFeedback?.recoverable ?? null,
    recovery_feedback_requires_user_intervention:
      recoveryFeedback?.requires_user_intervention ?? null,
    recovery_feedback_mcp_error_code: feedbackPlan.error_code,
    recovery_feedback_mcp_action: feedbackPlan.action,
    recovery_feedback_mcp_retry_allowed: feedbackPlan.retry_allowed,
    recovery_feedback_mcp_commands: feedbackPlan.commands,
    recovery_feedback_mcp_server: feedbackPlan.server,
    recovery_feedback_mcp_tool_name: feedbackPlan.tool_name,
    recovery_feedback_mcp_source_path: feedbackPlan.source_path,
    recovery_feedback_mcp_ready_reason: feedbackPlan.ready_reason,
    recovery_feedback_mcp_command: feedbackPlan.command,
    recovery_feedback_mcp_available_servers: feedbackPlan.available_servers,
    recovery_feedback_mcp_registry_paths: feedbackPlan.registry_paths,
    recovery_timeline_latest_stage: latestRecoveryTimeline?.stage ?? null,
    recovery_timeline_latest_tool_name: latestRecoveryTimeline?.tool_name ?? null,
    recovery_timeline_latest_error_class: latestRecoveryTimeline?.error_class ?? null,
    recovery_timeline_latest_mcp_error_code: timelinePlan.error_code,
    recovery_timeline_latest_mcp_action: timelinePlan.action,
    recovery_timeline_latest_mcp_retry_allowed: timelinePlan.retry_allowed,
    recovery_health_attention_mcp_error_code: healthAttentionPlan.error_code,
    recovery_health_attention_mcp_action: healthAttentionPlan.action,
    recovery_readiness_status: recoveryReadiness?.status ?? null,
    recovery_readiness_operator_action_required: recoveryReadiness?.operator_action_required ?? null,
    recovery_readiness_attention_mcp_error_code: readinessAttentionPlan.error_code,
    recovery_readiness_attention_mcp_action: readinessAttentionPlan.action,
    recovery_gate_status: recoveryGate?.status ?? null,
    recovery_gate_reason: recoveryGate?.reason ?? null,
    recovery_gate_blocker_kind: recoveryGate?.blocker_kind ?? null,
    recovery_gate_blocker_code: recoveryGate?.blocker_code ?? null,
    recovery_gate_blocker_action: recoveryGate?.blocker_action ?? null,
    recovery_gate_attention_mcp_error_code: gateAttentionPlan.error_code,
    recovery_gate_attention_mcp_action: gateAttentionPlan.action,
    text_has_recovery_feedback_mcp_environment:
      textResult.stdout.includes("runtime_tool_recovery_feedback:")
      && textResult.stdout.includes(textMcpRecoverySnippet),
    text_has_recovery_readiness_mcp_environment:
      textResult.stdout.includes("runtime_tool_recovery_readiness:")
      && textResult.stdout.includes(textMcpRecoverySnippet),
    text_has_recovery_gate_mcp_environment:
      textResult.stdout.includes("runtime_tool_recovery_gate:")
      && textResult.stdout.includes(textMcpRecoverySnippet),
  };
}

export function runStatusNonRecoverableToolRecoveryConsumed(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    parseJsonObjectSafe,
    isObject,
    writeConfig,
    buildFailoverConfig,
  } = context;
  const workDir = createTempDir("grobot-status-nonrecoverable-consumed-work");
  writeExecutionProjectToml(workDir);
  const observedAt = writeNonRecoverableToolRecoveryMetrics(workDir);
  writeNonRecoverableToolRecoveryConsumption(workDir, observedAt);
  const statusArgs = [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ];
  const jsonResult = runCommand(repoRoot, [...statusArgs, "--json"]);
  const textResult = runCommand(repoRoot, statusArgs, { GROBOT_STATUS_LEGACY_TEXT: "1" });
  const parsedStatus = parseJsonObjectSafe(jsonResult.stdout);
  const runtimeTools = isObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const recoveryFeedback = isObject(runtimeTools?.recovery_feedback)
    ? runtimeTools.recovery_feedback
    : null;
  const recoveryTimeline = Array.isArray(runtimeTools?.recovery_timeline)
    ? runtimeTools.recovery_timeline
    : [];
  const latestRecoveryTimeline = isObject(recoveryTimeline[0]) ? recoveryTimeline[0] : null;
  const previousRecoveryTimeline = isObject(recoveryTimeline[1]) ? recoveryTimeline[1] : null;
  const recoveryHealth = isObject(runtimeTools?.recovery_health)
    ? runtimeTools.recovery_health
    : null;
  const recoveryPolicy = isObject(runtimeTools?.recovery_policy)
    ? runtimeTools.recovery_policy
    : null;
  const recoveryReadiness = isObject(runtimeTools?.recovery_readiness)
    ? runtimeTools.recovery_readiness
    : null;
  const recoveryGate = isObject(runtimeTools?.recovery_gate)
    ? runtimeTools.recovery_gate
    : null;
  const surfaceAdaptation = isObject(runtimeTools?.surface_adaptation)
    ? runtimeTools.surface_adaptation
    : null;
  const recoveryEscalationTextSurface = runtimeToolRecoveryEscalationTextSurface(textResult.stdout);
  const recoveryReadinessTextSurface = runtimeToolRecoveryReadinessTextSurface(textResult.stdout);
  assertRuntimeToolRecoveryPolicyStatusSurface({
    recoveryPolicy,
    textOutput: textResult.stdout,
  });
  assertRuntimeToolRecoveryEscalationStatusSurface({
    recoveryFeedback,
    latestRecoveryTimeline,
    textOutput: textResult.stdout,
    expectedLatest: EXPECTED_REPEATED_TOOL_RECOVERY_ESCALATION_STATUS,
  });
  return {
    exit_code: jsonResult.exit_code,
    text_exit_code: textResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    recovery_feedback_active: recoveryFeedback?.active ?? null,
    recovery_feedback_reason: recoveryFeedback?.reason ?? null,
    recovery_feedback_recoverable: recoveryFeedback?.recoverable ?? null,
    recovery_feedback_requires_user_intervention:
      recoveryFeedback?.requires_user_intervention ?? null,
    recovery_feedback_consumed: recoveryFeedback?.consumed ?? null,
    recovery_feedback_consumed_reason: recoveryFeedback?.consumed_reason ?? null,
    recovery_feedback_same_tool_error_count:
      recoveryFeedback?.same_tool_error_count ?? null,
    recovery_feedback_escalated: recoveryFeedback?.escalated ?? null,
    recovery_feedback_escalation_reason:
      recoveryFeedback?.escalation_reason ?? null,
    recovery_feedback_escalation_policy_version:
      recoveryFeedback?.escalation_policy_version ?? null,
    recovery_feedback_base_recovery_stage:
      recoveryFeedback?.base_recovery_stage ?? null,
    recovery_feedback_base_recommended_next_action:
      recoveryFeedback?.base_recommended_next_action ?? null,
    recovery_timeline_count: recoveryTimeline.length,
    recovery_timeline_latest_recovery_key: latestRecoveryTimeline?.recovery_key ?? null,
    recovery_timeline_latest_active: latestRecoveryTimeline?.active ?? null,
    recovery_timeline_latest_consumed: latestRecoveryTimeline?.consumed ?? null,
    recovery_timeline_latest_consumed_reason: latestRecoveryTimeline?.consumed_reason ?? null,
    recovery_timeline_latest_stage: latestRecoveryTimeline?.stage ?? null,
    recovery_timeline_latest_tool_name: latestRecoveryTimeline?.tool_name ?? null,
    recovery_timeline_latest_same_tool_error_count:
      latestRecoveryTimeline?.same_tool_error_count ?? null,
    recovery_timeline_latest_escalated:
      latestRecoveryTimeline?.escalated ?? null,
    recovery_timeline_latest_escalation_reason:
      latestRecoveryTimeline?.escalation_reason ?? null,
    recovery_timeline_latest_escalation_policy_version:
      latestRecoveryTimeline?.escalation_policy_version ?? null,
    recovery_timeline_latest_base_recovery_stage:
      latestRecoveryTimeline?.base_recovery_stage ?? null,
    recovery_timeline_latest_base_recommended_next_action:
      latestRecoveryTimeline?.base_recommended_next_action ?? null,
    recovery_timeline_previous_recovery_key: previousRecoveryTimeline?.recovery_key ?? null,
    recovery_timeline_previous_tool_name: previousRecoveryTimeline?.tool_name ?? null,
    recovery_health_active_recovery_count: recoveryHealth?.active_recovery_count ?? null,
    recovery_health_active_nonrecoverable_count:
      recoveryHealth?.active_nonrecoverable_count ?? null,
    recovery_health_unconsumed_count: recoveryHealth?.unconsumed_count ?? null,
    recovery_health_has_stuck_nonrecoverable:
      recoveryHealth?.has_stuck_nonrecoverable ?? null,
    recovery_health_latest_recovery_key: recoveryHealth?.latest_recovery_key ?? null,
    recovery_health_score: recoveryHealth?.score ?? null,
    recovery_health_level: recoveryHealth?.level ?? null,
    recovery_health_reason: recoveryHealth?.reason ?? null,
    recovery_health_recommended_next_action:
      recoveryHealth?.recommended_next_action ?? null,
    recovery_health_attention_source: recoveryHealth?.attention_source ?? null,
    recovery_health_attention_recovery_key:
      recoveryHealth?.attention_recovery_key ?? null,
    recovery_health_attention_tool_name:
      recoveryHealth?.attention_tool_name ?? null,
    recovery_health_attention_requires_user_intervention:
      recoveryHealth?.attention_requires_user_intervention ?? null,
    recovery_policy_version: recoveryPolicy?.version ?? null,
    recovery_policy_timeline_max_entries: recoveryPolicy?.timeline_max_entries ?? null,
    recovery_policy_escalation_strategy_switch_threshold:
      recoveryPolicy?.escalation?.same_tool_error_strategy_switch_threshold ?? null,
    recovery_policy_escalation_ask_user_threshold:
      recoveryPolicy?.escalation?.same_tool_error_ask_user_threshold ?? null,
    recovery_policy_escalation_environment_ask_user_threshold:
      recoveryPolicy?.escalation?.environment_ask_user_threshold ?? null,
    recovery_policy_escalation_browser_environment_ask_user_threshold:
      recoveryPolicy?.escalation?.browser_environment_ask_user_threshold ?? null,
    recovery_policy_health_watch_threshold:
      recoveryPolicy?.health?.watch_score_threshold ?? null,
    recovery_policy_health_risk_threshold:
      recoveryPolicy?.health?.risk_score_threshold ?? null,
    recovery_readiness_status: recoveryReadiness?.status ?? null,
    recovery_readiness_ready: recoveryReadiness?.ready ?? null,
    recovery_readiness_auto_allowed: recoveryReadiness?.automatic_recovery_allowed ?? null,
    recovery_readiness_operator_action_required: recoveryReadiness?.operator_action_required ?? null,
    recovery_readiness_policy_version: recoveryReadiness?.policy_version ?? null,
    recovery_readiness_watch_threshold: recoveryReadiness?.watch_score_threshold ?? null,
    recovery_readiness_risk_threshold: recoveryReadiness?.risk_score_threshold ?? null,
    recovery_readiness_attention_stage: recoveryReadiness?.attention_stage ?? null,
    recovery_gate_status: recoveryGate?.status ?? null,
    recovery_gate_passed: recoveryGate?.passed ?? null,
    recovery_gate_blocking: recoveryGate?.blocking ?? null,
    recovery_gate_severity: recoveryGate?.severity ?? null,
    recovery_gate_reason: recoveryGate?.reason ?? null,
    recovery_gate_readiness_status: recoveryGate?.readiness_status ?? null,
    recovery_gate_auto_allowed: recoveryGate?.automatic_recovery_allowed ?? null,
    recovery_gate_operator_action_required: recoveryGate?.operator_action_required ?? null,
    recovery_gate_policy_version: recoveryGate?.policy_version ?? null,
    recovery_gate_watch_threshold: recoveryGate?.watch_score_threshold ?? null,
    recovery_gate_risk_threshold: recoveryGate?.risk_score_threshold ?? null,
    recovery_gate_attention_stage: recoveryGate?.attention_stage ?? null,
    surface_adaptation_active: surfaceAdaptation?.active ?? null,
    surface_adaptation_reason: surfaceAdaptation?.reason ?? null,
    surface_adaptation_auto_adaptation_blocked:
      surfaceAdaptation?.auto_adaptation_blocked ?? null,
    surface_adaptation_recovery_recoverable:
      surfaceAdaptation?.recovery_recoverable ?? null,
    text_has_consumed_nonrecoverable:
      textResult.stdout.includes("consumed=true")
      && textResult.stdout.includes("latest_consumption=nonrecoverable_intervention_prompted"),
    text_has_recovery_timeline:
      textResult.stdout.includes("runtime_tool_recovery_timeline: entries=2")
      && textResult.stdout.includes("latest=web_scan/config_missing")
      && textResult.stdout.includes("consumed=true"),
    text_has_recovery_health:
      textResult.stdout.includes("runtime_tool_recovery_health:")
      && textResult.stdout.includes("active_nonrecoverable=0")
      && textResult.stdout.includes("stuck_nonrecoverable=false"),
    text_has_recovery_policy:
      textResult.stdout.includes("runtime_tool_recovery_policy:")
      && textResult.stdout.includes("timeline_max_entries=20")
      && textResult.stdout.includes("escalation_thresholds=2/3")
      && textResult.stdout.includes("environment_ask_user_threshold=2")
      && textResult.stdout.includes("browser_environment_ask_user_threshold=2")
      && textResult.stdout.includes("health_thresholds=85/60"),
    text_has_recovery_readiness:
      textResult.stdout.includes("runtime_tool_recovery_readiness:")
      && textResult.stdout.includes("status=degraded")
      && textResult.stdout.includes("attention_stage=local_fix"),
    text_has_recovery_gate:
      textResult.stdout.includes("runtime_tool_recovery_gate:")
      && textResult.stdout.includes("status=warn")
      && textResult.stdout.includes("reason=degraded_auto_recovery_allowed"),
    ...recoveryEscalationTextSurface,
    ...recoveryReadinessTextSurface,
  };
}
