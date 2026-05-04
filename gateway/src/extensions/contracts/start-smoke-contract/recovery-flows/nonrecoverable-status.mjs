import {
  EXPECTED_REPEATED_TOOL_RECOVERY_ESCALATION_STATUS,
  assertRuntimeToolRecoveryEscalationStatusSurface,
  assertRuntimeToolRecoveryPolicyStatusSurface,
  runtimeToolRecoveryEscalationTextSurface,
  runtimeToolRecoveryReadinessTextSurface,
} from "../runtime-tool-status.mjs";
import {
  runtimeEnvironmentRecoveryPlanSummary,
  writeNonRecoverableToolRecoveryMetrics,
} from "../recovery-fixtures.mjs";

export function runStatusNonRecoverableToolRecovery(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    parseJsonObjectSafe,
    isObject,
  } = context;
  const workDir = createTempDir("grobot-status-nonrecoverable-work");
  writeExecutionProjectToml(workDir);
  writeNonRecoverableToolRecoveryMetrics(workDir);
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
  const textResult = runCommand(repoRoot, statusArgs);
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
  const feedbackRuntimePlan = runtimeEnvironmentRecoveryPlanSummary(
    recoveryFeedback?.runtime_environment_recovery,
  );
  const timelineRuntimePlan = runtimeEnvironmentRecoveryPlanSummary(
    latestRecoveryTimeline?.runtime_environment_recovery,
  );
  const healthAttentionRuntimePlan = runtimeEnvironmentRecoveryPlanSummary(
    recoveryHealth?.attention_runtime_environment_recovery,
  );
  const readinessAttentionRuntimePlan = runtimeEnvironmentRecoveryPlanSummary(
    recoveryReadiness?.attention_runtime_environment_recovery,
  );
  const gateAttentionRuntimePlan = runtimeEnvironmentRecoveryPlanSummary(
    recoveryGate?.attention_runtime_environment_recovery,
  );
  const textRuntimeRecoverySnippet =
    "runtime_environment_recovery=code=CONFIG_MISSING action=fix_config_or_switch_provider_and_check_status retry_allowed=false";
  return {
    exit_code: jsonResult.exit_code,
    text_exit_code: textResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    recovery_feedback_active: recoveryFeedback?.active ?? null,
    recovery_feedback_stage: recoveryFeedback?.stage ?? null,
    recovery_feedback_recoverable: recoveryFeedback?.recoverable ?? null,
    recovery_feedback_requires_user_intervention:
      recoveryFeedback?.requires_user_intervention ?? null,
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
    recovery_feedback_runtime_error_code: feedbackRuntimePlan.error_code,
    recovery_feedback_runtime_action: feedbackRuntimePlan.action,
    recovery_feedback_runtime_retry_allowed: feedbackRuntimePlan.retry_allowed,
    recovery_feedback_runtime_commands: feedbackRuntimePlan.commands,
    recovery_timeline_count: recoveryTimeline.length,
    recovery_timeline_latest_recovery_key: latestRecoveryTimeline?.recovery_key ?? null,
    recovery_timeline_latest_active: latestRecoveryTimeline?.active ?? null,
    recovery_timeline_latest_consumed: latestRecoveryTimeline?.consumed ?? null,
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
    recovery_timeline_latest_runtime_error_code: timelineRuntimePlan.error_code,
    recovery_timeline_latest_runtime_action: timelineRuntimePlan.action,
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
    recovery_health_attention_runtime_error_code: healthAttentionRuntimePlan.error_code,
    recovery_health_attention_runtime_action: healthAttentionRuntimePlan.action,
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
    recovery_readiness_attention_runtime_error_code: readinessAttentionRuntimePlan.error_code,
    recovery_readiness_attention_runtime_action: readinessAttentionRuntimePlan.action,
    recovery_gate_status: recoveryGate?.status ?? null,
    recovery_gate_passed: recoveryGate?.passed ?? null,
    recovery_gate_blocking: recoveryGate?.blocking ?? null,
    recovery_gate_severity: recoveryGate?.severity ?? null,
    recovery_gate_reason: recoveryGate?.reason ?? null,
    recovery_gate_blocker_kind: recoveryGate?.blocker_kind ?? null,
    recovery_gate_blocker_code: recoveryGate?.blocker_code ?? null,
    recovery_gate_blocker_action: recoveryGate?.blocker_action ?? null,
    recovery_gate_readiness_status: recoveryGate?.readiness_status ?? null,
    recovery_gate_auto_allowed: recoveryGate?.automatic_recovery_allowed ?? null,
    recovery_gate_operator_action_required: recoveryGate?.operator_action_required ?? null,
    recovery_gate_policy_version: recoveryGate?.policy_version ?? null,
    recovery_gate_watch_threshold: recoveryGate?.watch_score_threshold ?? null,
    recovery_gate_risk_threshold: recoveryGate?.risk_score_threshold ?? null,
    recovery_gate_attention_stage: recoveryGate?.attention_stage ?? null,
    recovery_gate_attention_runtime_error_code: gateAttentionRuntimePlan.error_code,
    recovery_gate_attention_runtime_action: gateAttentionRuntimePlan.action,
    surface_adaptation_active: surfaceAdaptation?.active ?? null,
    surface_adaptation_reason: surfaceAdaptation?.reason ?? null,
    surface_adaptation_from_profile: surfaceAdaptation?.from_profile ?? null,
    surface_adaptation_applied_profile: surfaceAdaptation?.applied_profile ?? null,
    surface_adaptation_auto_adaptation_blocked:
      surfaceAdaptation?.auto_adaptation_blocked ?? null,
    surface_adaptation_recovery_recoverable:
      surfaceAdaptation?.recovery_recoverable ?? null,
    text_has_requires_user_intervention:
      textResult.stdout.includes("requires_user_intervention=true"),
    text_has_auto_adaptation_blocked:
      textResult.stdout.includes("auto_adaptation_blocked=true"),
    text_has_nonrecoverable_reason:
      textResult.stdout.includes("recovery_gate_runtime_environment_config_missing"),
    text_has_recovery_timeline:
      textResult.stdout.includes("runtime_tool_recovery_timeline: entries=2")
      && textResult.stdout.includes("latest=web_scan/config_missing"),
    text_has_recovery_feedback_runtime_environment:
      textResult.stdout.includes(textRuntimeRecoverySnippet)
      && textResult.stdout.includes("commands=grobot status --json|grobot status --probe --json"),
    text_has_recovery_readiness_runtime_environment:
      textResult.stdout.includes("runtime_tool_recovery_readiness:")
      && textResult.stdout.includes(textRuntimeRecoverySnippet),
    text_has_recovery_gate_runtime_environment:
      textResult.stdout.includes("runtime_tool_recovery_gate:")
      && textResult.stdout.includes(textRuntimeRecoverySnippet),
    text_has_recovery_health:
      textResult.stdout.includes("runtime_tool_recovery_health:")
      && textResult.stdout.includes("active_nonrecoverable=1")
      && textResult.stdout.includes("stuck_nonrecoverable=true"),
    text_has_recovery_policy:
      textResult.stdout.includes("runtime_tool_recovery_policy:")
      && textResult.stdout.includes("timeline_max_entries=20")
      && textResult.stdout.includes("escalation_thresholds=2/3")
      && textResult.stdout.includes("environment_ask_user_threshold=2")
      && textResult.stdout.includes("browser_environment_ask_user_threshold=2")
      && textResult.stdout.includes("health_thresholds=85/60"),
    text_has_recovery_readiness:
      textResult.stdout.includes("runtime_tool_recovery_readiness:")
      && textResult.stdout.includes("status=blocked")
      && textResult.stdout.includes("attention_stage=ask_user"),
    text_has_recovery_gate:
      textResult.stdout.includes("runtime_tool_recovery_gate:")
      && textResult.stdout.includes("status=fail")
      && textResult.stdout.includes("reason=blocked_operator_action_required")
      && textResult.stdout.includes("blocker=runtime_environment")
      && textResult.stdout.includes("blocker_code=CONFIG_MISSING"),
    ...recoveryEscalationTextSurface,
    ...recoveryReadinessTextSurface,
  };
}
