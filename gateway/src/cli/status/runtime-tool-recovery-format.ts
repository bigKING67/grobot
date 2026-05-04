import type { RuntimeToolSurfaceDecision } from "../../models/types";
import {
  formatRuntimeToolEnvironmentRecoveryFields,
  serializeRuntimeToolEnvironmentRecoveryFields,
} from "../../tools/runtime/environment-recovery-families";
import {
  formatRuntimeToolRecoveryEscalationFields,
  type RuntimeToolRecoveryFeedback,
} from "../../tools/runtime/tool-events";
import type { RuntimeToolRecoveryPolicySnapshot } from "../../tools/runtime/tool-recovery-policy";
import {
  type RuntimeToolRecoveryReadinessSummary,
} from "../../tools/runtime/tool-recovery-readiness";
import type {
  RuntimeToolRecoveryReadinessGateDecision,
} from "../../tools/runtime/tool-recovery-readiness-gate";
import type {
  RuntimeToolRecoveryHealthSummary,
  RuntimeToolRecoveryTimelineEntry,
} from "../../tools/runtime/tool-recovery-timeline";
import type {
  RuntimeToolRecoveryConsumptionRecord,
} from "../../tools/runtime/tool-surface-adaptation-state";

export function serializeRuntimeToolRecoveryConsumption(
  record: RuntimeToolRecoveryConsumptionRecord | null,
): Record<string, unknown> | null {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    reason: record.reason,
    recovery_stage: record.recoveryStage,
    recovery_tool_name: record.recoveryToolName,
    recovery_error_class: record.recoveryErrorClass,
    recovery_observed_at: record.recoveryObservedAt,
    consumed_at: record.consumedAt,
    trace_id: record.traceId,
  };
}

export function serializeRuntimeToolRecoveryFeedback(
  feedback: RuntimeToolRecoveryFeedback,
): Record<string, unknown> {
  return {
    active: feedback.active,
    severity: feedback.severity,
    reason: feedback.reason,
    stage: feedback.stage,
    tool_name: feedback.toolName,
    error_class: feedback.errorClass,
    recommended_next_action: feedback.recommendedNextAction,
    recommended_action_family: feedback.actionFamily ?? null,
    recommended_action_reason: feedback.actionReason ?? null,
    recoverable: feedback.recoverable,
    requires_user_intervention: feedback.requiresUserIntervention,
    same_tool_error_count: feedback.sameToolErrorCount ?? null,
    escalated: feedback.escalated ?? false,
    escalation_reason: feedback.escalationReason ?? null,
    escalation_policy_version: feedback.escalationPolicyVersion ?? null,
    base_recovery_stage: feedback.baseStage ?? null,
    base_recommended_next_action: feedback.baseRecommendedNextAction ?? null,
    prompt_injected: feedback.active,
    consumed: feedback.consumed ?? false,
    consumed_reason: feedback.consumedReason ?? null,
    consumed_at: feedback.consumedAt ?? null,
    observed_at: feedback.observedAt ?? null,
    ...serializeRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: feedback.runtimeEnvironmentRecovery ?? null,
      browserEnvironmentRecovery: feedback.browserEnvironmentRecovery ?? null,
      mcpEnvironmentRecovery: feedback.mcpEnvironmentRecovery ?? null,
    }),
  };
}

export function formatRuntimeToolRecoveryFeedbackFields(feedback: RuntimeToolRecoveryFeedback): string {
  return [
    `active=${feedback.active ? "true" : "false"}`,
    `severity=${feedback.severity}`,
    `reason=${feedback.reason}`,
    `recoverable=${feedback.recoverable === null ? "<unknown>" : String(feedback.recoverable)}`,
    `requires_user_intervention=${feedback.requiresUserIntervention ? "true" : "false"}`,
    `consumed=${feedback.consumed ? "true" : "false"}`,
    `stage=${feedback.stage ?? "<none>"}`,
    `action=${feedback.recommendedNextAction ?? "<none>"}`,
    `action_family=${feedback.actionFamily ?? "<none>"}`,
    ...formatRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: feedback.runtimeEnvironmentRecovery ?? null,
      browserEnvironmentRecovery: feedback.browserEnvironmentRecovery ?? null,
      mcpEnvironmentRecovery: feedback.mcpEnvironmentRecovery ?? null,
    }),
    formatRuntimeToolRecoveryEscalationFields(feedback),
  ].join(" ");
}

export function serializeRuntimeToolRecoveryTimelineEntry(
  entry: RuntimeToolRecoveryTimelineEntry,
): Record<string, unknown> {
  return {
    recovery_key: entry.recoveryKey,
    observed_at: entry.observedAt,
    tool_name: entry.toolName,
    error_class: entry.errorClass,
    stage: entry.stage,
    reason: entry.reason,
    raw_recommended_next_action: entry.rawRecommendedNextAction,
    effective_recommended_next_action: entry.effectiveRecommendedNextAction,
    recommended_next_action: entry.recommendedNextAction,
    recommended_action_family: entry.recommendedActionFamily ?? null,
    recommended_action_reason: entry.recommendedActionReason ?? null,
    recoverable: entry.recoverable,
    requires_user_intervention: entry.requiresUserIntervention,
    same_tool_error_count: entry.sameToolErrorCount,
    escalated: entry.escalated,
    escalation_reason: entry.escalationReason,
    escalation_policy_version: entry.escalationPolicyVersion,
    base_recovery_stage: entry.baseStage,
    base_recommended_next_action: entry.baseRecommendedNextAction,
    ...serializeRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: entry.runtimeEnvironmentRecovery,
      browserEnvironmentRecovery: entry.browserEnvironmentRecovery,
      mcpEnvironmentRecovery: entry.mcpEnvironmentRecovery,
    }),
    active: entry.active,
    consumed: entry.consumed,
    consumed_reason: entry.consumedReason,
    consumed_at: entry.consumedAt,
  };
}

export function serializeRuntimeToolRecoveryHealthSummary(
  summary: RuntimeToolRecoveryHealthSummary,
): Record<string, unknown> {
  return {
    score: summary.score,
    level: summary.level,
    reason: summary.reason,
    raw_recommended_next_action: summary.rawRecommendedNextAction,
    effective_recommended_next_action: summary.effectiveRecommendedNextAction,
    recommended_next_action: summary.recommendedNextAction,
    recommended_action_family: summary.recommendedActionFamily ?? null,
    recommended_action_reason: summary.recommendedActionReason ?? null,
    attention_source: summary.attentionSource,
    attention_recovery_key: summary.attentionRecoveryKey,
    attention_stage: summary.attentionStage,
    attention_tool_name: summary.attentionToolName,
    attention_error_class: summary.attentionErrorClass,
    attention_requires_user_intervention: summary.attentionRequiresUserIntervention,
    attention_raw_recommended_next_action: summary.attentionRawRecommendedNextAction,
    attention_effective_recommended_next_action: summary.attentionEffectiveRecommendedNextAction,
    attention_action_family: summary.attentionActionFamily ?? null,
    attention_action_reason: summary.attentionActionReason ?? null,
    ...serializeRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: summary.attentionRuntimeEnvironmentRecovery,
      browserEnvironmentRecovery: summary.attentionBrowserEnvironmentRecovery,
      mcpEnvironmentRecovery: summary.attentionMcpEnvironmentRecovery,
    }, { fieldPrefix: "attention_" }),
    attention_age_ms: summary.attentionAgeMs,
    latest_raw_recommended_next_action: summary.latestRawRecommendedNextAction,
    latest_effective_recommended_next_action: summary.latestEffectiveRecommendedNextAction,
    latest_recommended_next_action: summary.latestRecommendedNextAction,
    latest_action_family: summary.latestActionFamily ?? null,
    latest_action_reason: summary.latestActionReason ?? null,
    timeline_entry_count: summary.timelineEntryCount,
    active_recovery_count: summary.activeRecoveryCount,
    active_nonrecoverable_count: summary.activeNonrecoverableCount,
    unconsumed_count: summary.unconsumedCount,
    consumed_count: summary.consumedCount,
    nonrecoverable_count: summary.nonrecoverableCount,
    stuck_nonrecoverable_count: summary.stuckNonrecoverableCount,
    has_stuck_nonrecoverable: summary.hasStuckNonrecoverable,
    latest_recovery_key: summary.latestRecoveryKey,
    latest_stage: summary.latestStage,
    latest_tool_name: summary.latestToolName,
    latest_error_class: summary.latestErrorClass,
    latest_requires_user_intervention: summary.latestRequiresUserIntervention,
    ...serializeRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: summary.latestRuntimeEnvironmentRecovery,
      browserEnvironmentRecovery: summary.latestBrowserEnvironmentRecovery,
      mcpEnvironmentRecovery: summary.latestMcpEnvironmentRecovery,
    }, { fieldPrefix: "latest_" }),
    latest_age_ms: summary.latestAgeMs,
    components: summary.components,
    error_class_counts: summary.errorClassCounts,
    tool_name_counts: summary.toolNameCounts,
  };
}

export function serializeRuntimeToolRecoveryPolicySummary(
  summary: RuntimeToolRecoveryPolicySnapshot,
): Record<string, unknown> {
  return {
    version: summary.version,
    prompt_max_age_ms: summary.promptMaxAgeMs,
    timeline_max_entries: summary.timelineMaxEntries,
    adaptation_history_max_entries: summary.adaptationHistoryMaxEntries,
    recovery_consumption_history_max_entries: summary.recoveryConsumptionHistoryMaxEntries,
    guard: {
      repeated_profile_failure_threshold: summary.guard.repeatedProfileFailureThreshold,
      recent_profile_sequence_size: summary.guard.recentProfileSequenceSize,
      oscillation_profile_window_size: summary.guard.oscillationProfileWindowSize,
    },
    escalation: {
      same_tool_error_strategy_switch_threshold: summary.escalation.sameToolErrorStrategySwitchThreshold,
      same_tool_error_ask_user_threshold: summary.escalation.sameToolErrorAskUserThreshold,
      environment_ask_user_threshold: summary.escalation.environmentAskUserThreshold,
      browser_environment_ask_user_threshold: summary.escalation.browserEnvironmentAskUserThreshold,
    },
    health: {
      risk_score_threshold: summary.health.riskScoreThreshold,
      watch_score_threshold: summary.health.watchScoreThreshold,
      penalties: {
        active_recovery: summary.health.penalties.activeRecovery,
        active_nonrecoverable: summary.health.penalties.activeNonrecoverable,
        stuck_nonrecoverable: summary.health.penalties.stuckNonrecoverable,
        historical_unconsumed: summary.health.penalties.historicalUnconsumed,
      },
    },
  };
}

export function serializeRuntimeToolRecoveryReadinessSummary(
  summary: RuntimeToolRecoveryReadinessSummary,
): Record<string, unknown> {
  return {
    status: summary.status,
    ready: summary.ready,
    automatic_recovery_allowed: summary.automaticRecoveryAllowed,
    operator_action_required: summary.operatorActionRequired,
    reason: summary.reason,
    recommended_next_action: summary.recommendedNextAction,
    recommended_action_family: summary.recommendedActionFamily ?? null,
    recommended_action_reason: summary.recommendedActionReason ?? null,
    policy_version: summary.policyVersion,
    health_level: summary.healthLevel,
    health_score: summary.healthScore,
    risk_score_threshold: summary.riskScoreThreshold,
    watch_score_threshold: summary.watchScoreThreshold,
    attention_recovery_key: summary.attentionRecoveryKey,
    attention_source: summary.attentionSource,
    attention_stage: summary.attentionStage,
    attention_tool_name: summary.attentionToolName,
    attention_error_class: summary.attentionErrorClass,
    attention_requires_user_intervention: summary.attentionRequiresUserIntervention,
    attention_action_family: summary.attentionActionFamily ?? null,
    attention_action_reason: summary.attentionActionReason ?? null,
    ...serializeRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: summary.attentionRuntimeEnvironmentRecovery,
      browserEnvironmentRecovery: summary.attentionBrowserEnvironmentRecovery,
      mcpEnvironmentRecovery: summary.attentionMcpEnvironmentRecovery,
    }, { fieldPrefix: "attention_" }),
  };
}

export function serializeRuntimeToolRecoveryReadinessGate(
  gate: RuntimeToolRecoveryReadinessGateDecision,
): Record<string, unknown> {
  return {
    status: gate.status,
    passed: gate.passed,
    blocking: gate.blocking,
    severity: gate.severity,
    reason: gate.reason,
    blocker_kind: gate.blockerKind,
    blocker_code: gate.blockerCode,
    blocker_action: gate.blockerAction,
    recommended_next_action: gate.recommendedNextAction,
    recommended_action_family: gate.recommendedActionFamily ?? null,
    recommended_action_reason: gate.recommendedActionReason ?? null,
    readiness_status: gate.readinessStatus,
    readiness_ready: gate.readinessReady,
    readiness_reason: gate.readinessReason,
    automatic_recovery_allowed: gate.automaticRecoveryAllowed,
    operator_action_required: gate.operatorActionRequired,
    policy_version: gate.policyVersion,
    health_level: gate.healthLevel,
    health_score: gate.healthScore,
    risk_score_threshold: gate.riskScoreThreshold,
    watch_score_threshold: gate.watchScoreThreshold,
    attention_recovery_key: gate.attentionRecoveryKey,
    attention_source: gate.attentionSource,
    attention_stage: gate.attentionStage,
    attention_tool_name: gate.attentionToolName,
    attention_error_class: gate.attentionErrorClass,
    attention_requires_user_intervention: gate.attentionRequiresUserIntervention,
    attention_action_family: gate.attentionActionFamily ?? null,
    attention_action_reason: gate.attentionActionReason ?? null,
    ...serializeRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: gate.attentionRuntimeEnvironmentRecovery,
      browserEnvironmentRecovery: gate.attentionBrowserEnvironmentRecovery,
      mcpEnvironmentRecovery: gate.attentionMcpEnvironmentRecovery,
    }, { fieldPrefix: "attention_" }),
  };
}

export function serializeRuntimeToolSurfaceDecision(
  decision: RuntimeToolSurfaceDecision | null,
): Record<string, unknown> | null {
  if (!decision) {
    return null;
  }
  return {
    profile: decision.profile,
    source: decision.source,
    reason: decision.reason,
    scores: decision.scores,
    suppressed: decision.suppressed.map((item) => ({
      profile: item.profile,
      reason: item.reason,
      original_score: item.originalScore,
      final_score: item.finalScore,
    })),
  };
}
