import {
  formatRuntimeToolRecoveryEscalationFields,
  type RuntimeToolRecoveryFeedback,
  type RuntimeToolSurfaceMetricsSnapshot,
} from "../../tools/runtime/tool-events";
import type { RuntimeToolRecoveryPolicySnapshot } from "../../tools/runtime/tool-recovery-policy";
import {
  formatRuntimeToolRecoveryReadinessFields,
  type RuntimeToolRecoveryReadinessSummary,
} from "../../tools/runtime/tool-recovery-readiness";
import {
  formatRuntimeToolRecoveryGateFields,
  type RuntimeToolRecoveryReadinessGateDecision,
} from "../../tools/runtime/tool-recovery-readiness-gate";
import type {
  RuntimeToolRecoveryHealthSummary,
  RuntimeToolRecoveryTimelineEntry,
} from "../../tools/runtime/tool-recovery-timeline";
import type {
  RuntimeToolSurfaceAdaptationSnapshot,
} from "../../tools/runtime/tool-surface-adaptation-state";
import type { RuntimeToolContextPreview } from "./runtime-tool-context-preview";
import {
  formatRuntimeToolRecoveryFeedbackFields,
} from "./runtime-tool-recovery-format";
import type { RuntimeToolQualitySummary } from "./runtime-tool-quality";
import {
  formatRuntimeToolArgDriftDetails,
  formatRuntimeToolSuppressedArgs,
} from "./runtime-tool-schema-projection";

export function formatRuntimeToolStatusLines(input: {
  workDir: string;
  contextPreview: RuntimeToolContextPreview;
  quality: RuntimeToolQualitySummary;
  metrics: RuntimeToolSurfaceMetricsSnapshot;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  recoveryTimeline: RuntimeToolRecoveryTimelineEntry[];
  recoveryHealth: RuntimeToolRecoveryHealthSummary;
  recoveryPolicy: RuntimeToolRecoveryPolicySnapshot;
  recoveryReadiness: RuntimeToolRecoveryReadinessSummary;
  recoveryGate: RuntimeToolRecoveryReadinessGateDecision;
  adaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot;
}): string[] {
  const lines: string[] = [
    `runtime_tool_context: enabled (${input.contextPreview.enabledToolsSource})`,
    `runtime_tool_enabled_tools_source: ${input.contextPreview.enabledToolsSource}`,
  ];
  if (input.contextPreview.enabledToolsSourceDetail) {
    lines.push(`runtime_tool_enabled_tools_source_detail: ${input.contextPreview.enabledToolsSourceDetail}`);
  }
  lines.push(
    `runtime_tool_quality: status=${input.quality.status} schema_budget_violations=${String(input.quality.schema_budget_violations)} runtime_describe=${input.quality.runtime_describe_source} schema_drift=${input.quality.schema_projection_drift_active ? "active" : "ok"} recovery_gate=${input.quality.recovery_gate_status} latest_stage=${input.quality.latest_recovery_stage ?? "<none>"} blocker=${input.quality.latest_blocker_kind ?? "<none>"} action_family=${input.quality.action_family} action=${input.quality.action_required ?? "<none>"}`,
    `runtime_tool_manifest_fingerprint: ${input.contextPreview.manifestFingerprint}`,
    `runtime_tool_manifest_tool_count: ${input.contextPreview.manifestToolCount}`,
    `runtime_tool_manifest_default_enabled_count: ${input.contextPreview.manifestDefaultEnabledCount}`,
    `runtime_tool_work_dir: ${input.workDir}`,
    `runtime_tool_surface_profile: ${input.contextPreview.toolSurfaceProfile} (${input.contextPreview.toolSurfaceSource})`,
    `runtime_tool_surface_reason: ${input.contextPreview.toolSurfaceReason}`,
  );
  if (input.contextPreview.toolSurfaceDecision) {
    const decisionScores = Object.entries(input.contextPreview.toolSurfaceDecision.scores)
      .map(([profile, score]) => `${profile}:${String(score)}`)
      .join(",");
    const suppressed = input.contextPreview.toolSurfaceDecision.suppressed
      .map((item) => `${item.profile}:${item.reason}:${String(item.originalScore)}->${String(item.finalScore)}`)
      .join(",");
    lines.push(
      `runtime_tool_surface_decision: profile=${input.contextPreview.toolSurfaceDecision.profile} reason=${input.contextPreview.toolSurfaceDecision.reason} scores=${decisionScores || "<empty>"} suppressed=${suppressed || "<none>"}`,
    );
  }
  lines.push(
    `runtime_tool_policy_version: ${input.contextPreview.toolPolicyVersion}`,
    `runtime_tool_model_visible_tools: ${input.contextPreview.modelVisibleTools.join(",")}`,
    `runtime_tool_schema_fingerprint: ${input.contextPreview.schemaFingerprint}`,
  );
  if (input.contextPreview.schemaProfilesFingerprint) {
    lines.push(`runtime_tool_schema_profiles_fingerprint: ${input.contextPreview.schemaProfilesFingerprint}`);
  }
  lines.push(
    `runtime_tool_schema_estimated_tokens: ${String(input.contextPreview.schemaEstimatedTokens)}`,
    `runtime_tool_advanced_schema: ${input.contextPreview.advancedToolSchema ? "true" : "false"}`,
    `runtime_tool_schema_projection: source=${input.contextPreview.schemaProjectionSummary.source} mode=${input.contextPreview.schemaProjectionSummary.projectionMode} visible_tools=${String(input.contextPreview.schemaProjectionSummary.visibleToolCount)} dispatch_enabled=${String(input.contextPreview.schemaProjectionSummary.dispatchEnabledToolCount)} properties=${String(input.contextPreview.schemaProjectionSummary.schemaPropertyCount)} full_properties=${String(input.contextPreview.schemaProjectionSummary.fullSchemaPropertyCount)} suppressed_properties=${String(input.contextPreview.schemaProjectionSummary.suppressedSchemaPropertyCount)} fingerprint=${input.contextPreview.schemaProjectionSummary.schemaFingerprint}`,
    `runtime_tool_schema_suppressed_args: ${formatRuntimeToolSuppressedArgs(input.contextPreview.schemaProjectionSummary)}`,
    `runtime_tool_schema_projection_drift: checked=${input.contextPreview.schemaProjectionDrift.checked ? "true" : "false"} active=${input.contextPreview.schemaProjectionDrift.active ? "true" : "false"} reason=${input.contextPreview.schemaProjectionDrift.reason}`,
    `runtime_tool_schema_projection_drift_args: ${formatRuntimeToolArgDriftDetails(input.contextPreview.schemaProjectionDrift)}`,
    `runtime_tool_metrics_path: ${input.metrics.path}`,
    `runtime_tool_metrics_calls_total: ${String(input.metrics.callsTotal)} failed=${String(input.metrics.failedTotal)} deferred=${String(input.metrics.deferredTotal)}`,
    `runtime_tool_metrics_recovery_stages: ${Object.keys(input.metrics.recoveryStages).length > 0 ? JSON.stringify(input.metrics.recoveryStages) : "<empty>"}`,
    `runtime_tool_recovery_feedback: ${formatRuntimeToolRecoveryFeedbackFields(input.recoveryFeedback)}`,
  );
  const latestTimelineEntry = input.recoveryTimeline[0] ?? null;
  lines.push(
    `runtime_tool_recovery_timeline: entries=${String(input.recoveryTimeline.length)} latest=${latestTimelineEntry ? `${latestTimelineEntry.toolName ?? "<none>"}/${latestTimelineEntry.errorClass ?? "<none>"}` : "<none>"} stage=${latestTimelineEntry?.stage ?? "<none>"} active=${latestTimelineEntry?.active ? "true" : "false"} consumed=${latestTimelineEntry?.consumed ? "true" : "false"} ${latestTimelineEntry ? formatRuntimeToolRecoveryEscalationFields(latestTimelineEntry) : "same_tool_error_count=<none> escalated=false escalation_reason=<none> escalation_policy_version=<none> base_recovery_stage=<none> base_recommended_next_action=<none>"}`,
    `runtime_tool_recovery_health: score=${String(input.recoveryHealth.score)} level=${input.recoveryHealth.level} reason=${input.recoveryHealth.reason} action=${input.recoveryHealth.recommendedNextAction ?? "<none>"} attention_source=${input.recoveryHealth.attentionSource} attention_key=${input.recoveryHealth.attentionRecoveryKey ?? "<none>"} active=${String(input.recoveryHealth.activeRecoveryCount)} active_nonrecoverable=${String(input.recoveryHealth.activeNonrecoverableCount)} unconsumed=${String(input.recoveryHealth.unconsumedCount)} stuck_nonrecoverable=${input.recoveryHealth.hasStuckNonrecoverable ? "true" : "false"} latest_key=${input.recoveryHealth.latestRecoveryKey ?? "<none>"}`,
    `runtime_tool_recovery_policy: version=${input.recoveryPolicy.version} prompt_max_age_ms=${String(input.recoveryPolicy.promptMaxAgeMs)} timeline_max_entries=${String(input.recoveryPolicy.timelineMaxEntries)} adaptation_history_max_entries=${String(input.recoveryPolicy.adaptationHistoryMaxEntries)} recovery_consumption_history_max_entries=${String(input.recoveryPolicy.recoveryConsumptionHistoryMaxEntries)} guard_repeat_failures=${String(input.recoveryPolicy.guard.repeatedProfileFailureThreshold)} guard_recent_profile_sequence=${String(input.recoveryPolicy.guard.recentProfileSequenceSize)} guard_oscillation_window=${String(input.recoveryPolicy.guard.oscillationProfileWindowSize)} escalation_thresholds=${String(input.recoveryPolicy.escalation.sameToolErrorStrategySwitchThreshold)}/${String(input.recoveryPolicy.escalation.sameToolErrorAskUserThreshold)} environment_ask_user_threshold=${String(input.recoveryPolicy.escalation.environmentAskUserThreshold)} browser_environment_ask_user_threshold=${String(input.recoveryPolicy.escalation.browserEnvironmentAskUserThreshold)} health_thresholds=${String(input.recoveryPolicy.health.watchScoreThreshold)}/${String(input.recoveryPolicy.health.riskScoreThreshold)} health_penalties=${String(input.recoveryPolicy.health.penalties.activeRecovery)}/${String(input.recoveryPolicy.health.penalties.activeNonrecoverable)}/${String(input.recoveryPolicy.health.penalties.stuckNonrecoverable)}/${String(input.recoveryPolicy.health.penalties.historicalUnconsumed)}`,
    `runtime_tool_recovery_readiness: ${formatRuntimeToolRecoveryReadinessFields(input.recoveryReadiness)}`,
    `runtime_tool_recovery_gate: ${formatRuntimeToolRecoveryGateFields(input.recoveryGate)}`,
    `runtime_tool_surface_adaptation: active=${input.contextPreview.toolSurfaceAdaptation.active ? "true" : "false"} reason=${input.contextPreview.toolSurfaceAdaptation.reason} from=${input.contextPreview.toolSurfaceAdaptation.fromProfile} applied=${input.contextPreview.toolSurfaceAdaptation.appliedProfile} recommended=${input.contextPreview.toolSurfaceAdaptation.recommendedProfile ?? "<none>"} auto_adaptation_blocked=${input.contextPreview.toolSurfaceAdaptation.autoAdaptationBlocked ? "true" : "false"} recovery_recoverable=${input.contextPreview.toolSurfaceAdaptation.recoveryRecoverable === null ? "<unknown>" : String(input.contextPreview.toolSurfaceAdaptation.recoveryRecoverable)} stage=${input.contextPreview.toolSurfaceAdaptation.recoveryStage ?? "<none>"} tool=${input.contextPreview.toolSurfaceAdaptation.recoveryToolName ?? "<none>"} error_class=${input.contextPreview.toolSurfaceAdaptation.recoveryErrorClass ?? "<none>"}`,
    `runtime_tool_surface_adaptation_outcome: recent=${input.adaptationSnapshot.latestAdaptation?.outcome ?? "<none>"} profile=${input.adaptationSnapshot.latestAdaptation?.appliedProfile ?? "<none>"} reason=${input.adaptationSnapshot.latestAdaptation?.outcomeReason ?? "<none>"} count=${String(input.adaptationSnapshot.recentAdaptations.length)} recovery_consumptions=${String(input.adaptationSnapshot.recentRecoveryConsumptions.length)} latest_consumption=${input.adaptationSnapshot.latestRecoveryConsumption?.reason ?? "<none>"}`,
    `runtime_tool_surface_adaptation_guard: active=${input.contextPreview.toolSurfaceAdaptationGuard.active ? "true" : "false"} reason=${input.contextPreview.toolSurfaceAdaptationGuard.reason} blocked_profile=${input.contextPreview.toolSurfaceAdaptationGuard.blockedProfile ?? "<none>"} matching_failures=${String(input.contextPreview.toolSurfaceAdaptationGuard.matchingFailureCount)}`,
    `runtime_tool_enabled_tools: ${input.contextPreview.enabledTools.join(",")}`,
    `runtime_tool_bash_allowlist: ${input.contextPreview.bashAllowlist.length > 0 ? input.contextPreview.bashAllowlist.join(",") : "<empty>"}`,
    `runtime_tool_max_tool_rounds: ${input.contextPreview.maxToolRounds}`,
    `runtime_tool_no_tool_fallback_mode: ${input.contextPreview.noToolFallbackMode}`,
    `runtime_tool_max_recovery_rounds: ${input.contextPreview.maxRecoveryRounds}`,
  );
  return lines;
}
