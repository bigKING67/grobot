import {
  buildRuntimeToolRecoveryHealthSummary,
  buildRuntimeToolRecoveryKey,
  buildRuntimeToolRecoveryTimeline,
} from "../../../tools/runtime/tool-recovery-timeline";
import { buildRuntimeToolRecoveryDecision } from "../../../tools/runtime/tool-recovery-decision";
import { buildRuntimeToolRecoveryReadinessSummary } from "../../../tools/runtime/tool-recovery-readiness";
import { expectEqual } from "./assertions";
import {
  activeFeedback,
  emptyAdaptationSnapshot,
  expectedEscalation,
  latestObservedAt,
  metrics,
} from "./fixtures";

export function runActiveRecoveryCase() {
  const activeTimeline = buildRuntimeToolRecoveryTimeline({
    metrics,
    adaptationSnapshot: emptyAdaptationSnapshot,
    recoveryFeedback: activeFeedback,
  });

  expectEqual(activeTimeline.length, 2, "active timeline length");
  expectEqual(activeTimeline[0].toolName, "web_scan", "active timeline latest tool");
  expectEqual(activeTimeline[0].stage, "ask_user", "active timeline latest stage");
  expectEqual(
    activeTimeline[0].rawRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active timeline latest raw action",
  );
  expectEqual(
    activeTimeline[0].effectiveRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active timeline latest effective action",
  );
  expectEqual(
    activeTimeline[0].recommendedNextAction,
    activeTimeline[0].effectiveRecommendedNextAction,
    "active timeline public action uses effective action",
  );
  expectEqual(activeTimeline[0].recommendedActionFamily, "user_intervention", "active timeline latest action family");
  expectEqual(activeTimeline[0].active, true, "active timeline latest active");
  expectEqual(activeTimeline[0].consumed, false, "active timeline latest consumed");
  expectEqual(
    activeTimeline[0].sameToolErrorCount,
    expectedEscalation.sameToolErrorCount,
    "active timeline latest repeat count",
  );
  expectEqual(activeTimeline[0].escalated, expectedEscalation.escalated, "active timeline latest escalated");
  expectEqual(
    activeTimeline[0].escalationReason,
    expectedEscalation.escalationReason,
    "active timeline latest escalation reason",
  );
  expectEqual(
    activeTimeline[0].escalationPolicyVersion,
    expectedEscalation.escalationPolicyVersion,
    "active timeline latest escalation policy version",
  );
  expectEqual(activeTimeline[0].baseStage, expectedEscalation.baseStage, "active timeline latest base stage");
  expectEqual(
    activeTimeline[0].baseRecommendedNextAction,
    expectedEscalation.baseRecommendedNextAction,
    "active timeline latest base action",
  );
  expectEqual(activeTimeline[1].toolName, "read", "active timeline older tool");
  expectEqual(activeTimeline[1].active, false, "active timeline older active");

  const expectedLatestRecoveryKey = buildRuntimeToolRecoveryKey({
    stage: "ask_user",
    toolName: "web_scan",
    errorClass: "config_missing",
    observedAt: latestObservedAt,
  });
  expectEqual(activeTimeline[0].recoveryKey, expectedLatestRecoveryKey, "active timeline latest recovery key");

  const activeHealth = buildRuntimeToolRecoveryHealthSummary({
    timeline: activeTimeline,
    nowMs: Date.parse(latestObservedAt) + 2_000,
  });
  const activeReadiness = buildRuntimeToolRecoveryReadinessSummary({
    health: activeHealth,
  });
  const activeDecision = buildRuntimeToolRecoveryDecision({
    metrics,
    adaptationSnapshot: emptyAdaptationSnapshot,
    nowMs: Date.parse(latestObservedAt) + 2_000,
  });

  expectEqual(activeHealth.timelineEntryCount, 2, "active health timeline count");
  expectEqual(activeHealth.score, 36, "active health score");
  expectEqual(activeHealth.level, "risk", "active health level");
  expectEqual(activeHealth.reason, "active_nonrecoverable_recovery", "active health reason");
  expectEqual(
    activeHealth.recommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active health recommended next action",
  );
  expectEqual(
    activeHealth.rawRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active health raw recommended next action",
  );
  expectEqual(
    activeHealth.effectiveRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active health effective recommended next action",
  );
  expectEqual(activeHealth.recommendedActionFamily, "user_intervention", "active health action family");
  expectEqual(activeHealth.attentionSource, "latest", "active health attention source");
  expectEqual(
    activeHealth.attentionRawRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active health attention raw action",
  );
  expectEqual(
    activeHealth.attentionEffectiveRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active health attention effective action",
  );
  expectEqual(activeHealth.attentionActionFamily, "user_intervention", "active health attention action family");
  expectEqual(activeHealth.attentionRecoveryKey, expectedLatestRecoveryKey, "active health attention key");
  expectEqual(activeHealth.attentionToolName, "web_scan", "active health attention tool");
  expectEqual(activeHealth.attentionErrorClass, "config_missing", "active health attention error");
  expectEqual(
    activeHealth.attentionRequiresUserIntervention,
    true,
    "active health attention requires user intervention",
  );
  expectEqual(activeHealth.attentionAgeMs, 2_000, "active health attention age");
  expectEqual(activeHealth.activeRecoveryCount, 1, "active health active count");
  expectEqual(activeHealth.activeNonrecoverableCount, 1, "active health active nonrecoverable count");
  expectEqual(activeHealth.unconsumedCount, 2, "active health unconsumed count");
  expectEqual(activeHealth.consumedCount, 0, "active health consumed count");
  expectEqual(activeHealth.nonrecoverableCount, 1, "active health nonrecoverable count");
  expectEqual(activeHealth.stuckNonrecoverableCount, 1, "active health stuck nonrecoverable count");
  expectEqual(activeHealth.hasStuckNonrecoverable, true, "active health stuck flag");
  expectEqual(activeHealth.latestRecoveryKey, expectedLatestRecoveryKey, "active health latest key");
  expectEqual(
    activeHealth.latestRawRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active health latest raw action",
  );
  expectEqual(
    activeHealth.latestEffectiveRecommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "active health latest effective action",
  );
  expectEqual(activeHealth.latestAgeMs, 2_000, "active health latest age");
  expectEqual(activeHealth.errorClassCounts.config_missing, 1, "active health config_missing count");
  expectEqual(activeHealth.toolNameCounts.web_scan, 1, "active health web_scan count");
  expectEqual(activeReadiness.status, "blocked", "active readiness status");
  expectEqual(activeReadiness.ready, false, "active readiness ready");
  expectEqual(activeReadiness.automaticRecoveryAllowed, false, "active readiness automatic recovery");
  expectEqual(activeReadiness.operatorActionRequired, true, "active readiness operator action");
  expectEqual(activeReadiness.policyVersion, "v1", "active readiness policy version");
  expectEqual(activeReadiness.recommendedActionFamily, "user_intervention", "active readiness action family");
  expectEqual(activeReadiness.attentionRecoveryKey, expectedLatestRecoveryKey, "active readiness attention key");
  expectEqual(activeReadiness.attentionStage, "ask_user", "active readiness attention stage");
  expectEqual(activeDecision.feedback.active, true, "active decision feedback active");
  expectEqual(activeDecision.feedback.actionFamily, "user_intervention", "active decision feedback action family");
  expectEqual(activeDecision.feedback.consumed, false, "active decision feedback consumed");
  expectEqual(
    activeDecision.feedback.sameToolErrorCount,
    expectedEscalation.sameToolErrorCount,
    "active decision feedback repeat count",
  );
  expectEqual(activeDecision.feedback.escalated, expectedEscalation.escalated, "active decision feedback escalated");
  expectEqual(
    activeDecision.feedback.escalationReason,
    expectedEscalation.escalationReason,
    "active decision feedback escalation reason",
  );
  expectEqual(
    activeDecision.feedback.escalationPolicyVersion,
    expectedEscalation.escalationPolicyVersion,
    "active decision feedback escalation policy version",
  );
  expectEqual(activeDecision.feedback.baseStage, expectedEscalation.baseStage, "active decision feedback base stage");
  expectEqual(
    activeDecision.feedback.baseRecommendedNextAction,
    expectedEscalation.baseRecommendedNextAction,
    "active decision feedback base action",
  );
  expectEqual(activeDecision.timeline[0].recoveryKey, activeTimeline[0].recoveryKey, "active decision timeline parity");
  expectEqual(activeDecision.health.score, activeHealth.score, "active decision health parity");
  expectEqual(activeDecision.readiness.status, "blocked", "active decision readiness status");
  expectEqual(activeDecision.gate.status, "fail", "active decision gate status");
  expectEqual(activeDecision.gate.reason, "blocked_operator_action_required", "active decision gate reason");
  expectEqual(activeDecision.gate.blockerKind, "runtime_environment", "active decision gate blocker kind");
  expectEqual(activeDecision.gate.blockerCode, "CONFIG_MISSING", "active decision gate blocker code");
  expectEqual(
    activeDecision.gate.blockerAction,
    "fix_config_or_switch_provider_and_check_status",
    "active decision gate blocker action",
  );

  return {
    activeTimeline,
    activeHealth,
    activeReadiness,
    activeDecision,
    expectedLatestRecoveryKey,
  };
}
