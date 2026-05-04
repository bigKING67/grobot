import type {
  RuntimeToolRecoveryFeedback,
  RuntimeToolSurfaceMetricsSnapshot,
} from "../../tools/runtime/tool-events";
import type { RuntimeToolRecoveryPolicySnapshot } from "../../tools/runtime/tool-recovery-policy";
import type { RuntimeToolRecoveryReadinessSummary } from "../../tools/runtime/tool-recovery-readiness";
import type { RuntimeToolRecoveryReadinessGateDecision } from "../../tools/runtime/tool-recovery-readiness-gate";
import type {
  RuntimeToolRecoveryHealthSummary,
  RuntimeToolRecoveryTimelineEntry,
} from "../../tools/runtime/tool-recovery-timeline";
import type {
  RuntimeToolSurfaceAdaptationSnapshot,
} from "../../tools/runtime/tool-surface-adaptation-state";
import type { RuntimeToolContextPreview } from "./runtime-tool-context-preview";
import {
  serializeRuntimeToolRecoveryConsumption,
  serializeRuntimeToolRecoveryFeedback,
  serializeRuntimeToolRecoveryHealthSummary,
  serializeRuntimeToolRecoveryPolicySummary,
  serializeRuntimeToolRecoveryReadinessGate,
  serializeRuntimeToolRecoveryReadinessSummary,
  serializeRuntimeToolRecoveryTimelineEntry,
  serializeRuntimeToolSurfaceDecision,
} from "./runtime-tool-recovery-format";
import type { RuntimeToolQualitySummary } from "./runtime-tool-quality";
import {
  serializeRuntimeToolSurfaceProjectionDrift,
  serializeRuntimeToolSurfaceProjectionSummary,
} from "./runtime-tool-schema-projection";

export function serializeRuntimeToolsStatus(input: {
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
}): Record<string, unknown> {
  return {
    context: "enabled",
    quality: input.quality,
    tool_surface_profile: input.contextPreview.toolSurfaceProfile,
    tool_surface_source: input.contextPreview.toolSurfaceSource,
    tool_surface_reason: input.contextPreview.toolSurfaceReason,
    surface_decision: serializeRuntimeToolSurfaceDecision(input.contextPreview.toolSurfaceDecision),
    tool_policy_version: input.contextPreview.toolPolicyVersion,
    model_visible_tools: input.contextPreview.modelVisibleTools,
    dispatch_enabled_tools: input.contextPreview.enabledTools,
    schema_fingerprint: input.contextPreview.schemaFingerprint,
    schema_profiles_fingerprint: input.contextPreview.schemaProfilesFingerprint,
    schema_estimated_tokens: input.contextPreview.schemaEstimatedTokens,
    advanced_tool_schema: input.contextPreview.advancedToolSchema,
    schema_projection: serializeRuntimeToolSurfaceProjectionSummary(input.contextPreview.schemaProjectionSummary),
    schema_projection_drift: serializeRuntimeToolSurfaceProjectionDrift(input.contextPreview.schemaProjectionDrift),
    metrics: input.metrics,
    recovery_feedback: serializeRuntimeToolRecoveryFeedback(input.recoveryFeedback),
    recovery_timeline: input.recoveryTimeline.map(serializeRuntimeToolRecoveryTimelineEntry),
    recovery_health: serializeRuntimeToolRecoveryHealthSummary(input.recoveryHealth),
    recovery_policy: serializeRuntimeToolRecoveryPolicySummary(input.recoveryPolicy),
    recovery_readiness: serializeRuntimeToolRecoveryReadinessSummary(input.recoveryReadiness),
    recovery_gate: serializeRuntimeToolRecoveryReadinessGate(input.recoveryGate),
    surface_adaptation: {
      enabled: input.contextPreview.toolSurfaceAdaptation.enabled,
      active: input.contextPreview.toolSurfaceAdaptation.active,
      reason: input.contextPreview.toolSurfaceAdaptation.reason,
      from_profile: input.contextPreview.toolSurfaceAdaptation.fromProfile,
      applied_profile: input.contextPreview.toolSurfaceAdaptation.appliedProfile,
      recommended_profile: input.contextPreview.toolSurfaceAdaptation.recommendedProfile,
      source: input.contextPreview.toolSurfaceAdaptation.source,
      auto_adaptation_blocked: input.contextPreview.toolSurfaceAdaptation.autoAdaptationBlocked,
      recovery_stage: input.contextPreview.toolSurfaceAdaptation.recoveryStage,
      recovery_tool_name: input.contextPreview.toolSurfaceAdaptation.recoveryToolName,
      recovery_error_class: input.contextPreview.toolSurfaceAdaptation.recoveryErrorClass,
      recovery_recoverable: input.contextPreview.toolSurfaceAdaptation.recoveryRecoverable,
      recovery_observed_at: input.contextPreview.toolSurfaceAdaptation.recoveryObservedAt,
    },
    surface_adaptation_outcome: {
      path: input.adaptationSnapshot.path,
      updated_at: input.adaptationSnapshot.updatedAt,
      recent_outcome: input.adaptationSnapshot.latestAdaptation?.outcome ?? null,
      recent_profile: input.adaptationSnapshot.latestAdaptation?.appliedProfile ?? null,
      recent_outcome_reason: input.adaptationSnapshot.latestAdaptation?.outcomeReason ?? null,
      recent_failure_class: input.adaptationSnapshot.latestAdaptation?.nextFailureClass ?? null,
      recent_adaptation_count: input.adaptationSnapshot.recentAdaptations.length,
      profile_outcomes: input.adaptationSnapshot.profileOutcomes,
      recent_recovery_consumption_count: input.adaptationSnapshot.recentRecoveryConsumptions.length,
      latest_recovery_consumption: serializeRuntimeToolRecoveryConsumption(
        input.adaptationSnapshot.latestRecoveryConsumption,
      ),
      guard: {
        active: input.contextPreview.toolSurfaceAdaptationGuard.active,
        reason: input.contextPreview.toolSurfaceAdaptationGuard.reason,
        blocked_profile: input.contextPreview.toolSurfaceAdaptationGuard.blockedProfile,
        matching_failure_count: input.contextPreview.toolSurfaceAdaptationGuard.matchingFailureCount,
        recent_profile_sequence: input.contextPreview.toolSurfaceAdaptationGuard.recentProfileSequence,
      },
    },
    enabled_tools_source: input.contextPreview.enabledToolsSource,
    enabled_tools_source_detail: input.contextPreview.enabledToolsSourceDetail ?? null,
    manifest_fingerprint: input.contextPreview.manifestFingerprint,
    manifest_tool_count: input.contextPreview.manifestToolCount,
    manifest_default_enabled_count: input.contextPreview.manifestDefaultEnabledCount,
    work_dir: input.workDir,
    enabled_tools: input.contextPreview.enabledTools,
    bash_allowlist: input.contextPreview.bashAllowlist,
    max_tool_rounds: input.contextPreview.maxToolRounds,
    no_tool_fallback_mode: input.contextPreview.noToolFallbackMode,
    max_recovery_rounds: input.contextPreview.maxRecoveryRounds,
  };
}
