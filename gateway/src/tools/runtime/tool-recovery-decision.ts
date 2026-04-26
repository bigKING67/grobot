import {
  buildRuntimeToolRecoveryFeedback,
  type RuntimeToolRecoveryFeedback,
  type RuntimeToolSurfaceMetricsSnapshot,
} from "./tool-events";
import {
  getRuntimeToolRecoveryPolicySnapshot,
  type RuntimeToolRecoveryPolicySnapshot,
} from "./tool-recovery-policy";
import {
  buildRuntimeToolRecoveryReadinessSummary,
  type RuntimeToolRecoveryReadinessSummary,
} from "./tool-recovery-readiness";
import {
  buildRuntimeToolRecoveryReadinessGate,
  type RuntimeToolRecoveryReadinessGateDecision,
} from "./tool-recovery-readiness-gate";
import {
  buildRuntimeToolRecoveryHealthSummary,
  buildRuntimeToolRecoveryTimeline,
  type RuntimeToolRecoveryHealthSummary,
  type RuntimeToolRecoveryTimelineEntry,
} from "./tool-recovery-timeline";
import {
  applyRuntimeToolRecoveryConsumption,
  type RuntimeToolSurfaceAdaptationSnapshot,
} from "./tool-surface-adaptation-state";

export interface RuntimeToolRecoveryDecision {
  rawFeedback: RuntimeToolRecoveryFeedback;
  feedback: RuntimeToolRecoveryFeedback;
  timeline: RuntimeToolRecoveryTimelineEntry[];
  health: RuntimeToolRecoveryHealthSummary;
  policy: RuntimeToolRecoveryPolicySnapshot;
  readiness: RuntimeToolRecoveryReadinessSummary;
  gate: RuntimeToolRecoveryReadinessGateDecision;
}

export function buildRuntimeToolRecoveryDecision(input: {
  metrics: RuntimeToolSurfaceMetricsSnapshot;
  adaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot;
  nowMs?: number;
  policy?: RuntimeToolRecoveryPolicySnapshot;
}): RuntimeToolRecoveryDecision {
  const rawFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: input.metrics,
  });
  const feedback = applyRuntimeToolRecoveryConsumption({
    feedback: rawFeedback,
    snapshot: input.adaptationSnapshot,
  });
  const timeline = buildRuntimeToolRecoveryTimeline({
    metrics: input.metrics,
    adaptationSnapshot: input.adaptationSnapshot,
    recoveryFeedback: feedback,
  });
  const health = buildRuntimeToolRecoveryHealthSummary({
    timeline,
    nowMs: input.nowMs,
  });
  const policy = input.policy ?? getRuntimeToolRecoveryPolicySnapshot();
  const readiness = buildRuntimeToolRecoveryReadinessSummary({
    health,
    policy,
  });
  const gate = buildRuntimeToolRecoveryReadinessGate({
    readiness,
  });
  return {
    rawFeedback,
    feedback,
    timeline,
    health,
    policy,
    readiness,
    gate,
  };
}
