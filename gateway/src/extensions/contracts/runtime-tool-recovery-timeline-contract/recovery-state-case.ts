import {
  buildRuntimeToolRecoveryHealthSummary,
  buildRuntimeToolRecoveryTimeline,
} from "../../../tools/runtime/tool-recovery-timeline";
import { buildRuntimeToolRecoveryDecision } from "../../../tools/runtime/tool-recovery-decision";
import { buildRuntimeToolRecoveryReadinessSummary } from "../../../tools/runtime/tool-recovery-readiness";
import type { RuntimeToolRecoveryFeedback } from "../../../tools/runtime/tool-events";
import type { RuntimeToolSurfaceAdaptationSnapshot } from "../../../tools/runtime/tool-surface-adaptation-state";
import { expectEqual } from "./assertions";
import {
  activeFeedback,
  consumedAt,
  emptyAdaptationSnapshot,
  expectedEscalation,
  latestObservedAt,
  metrics,
  olderObservedAt,
} from "./fixtures";
import type { runActiveRecoveryCase } from "./active-case";

export function runRecoveryStateCases(active: ReturnType<typeof runActiveRecoveryCase>) {
  const consumedAdaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot = {
    ...emptyAdaptationSnapshot,
    updatedAt: consumedAt,
    recentRecoveryConsumptions: [
      {
        id: "tsc_timeline_contract_nonrecoverable",
        reason: "nonrecoverable_intervention_prompted",
        recoveryStage: "ask_user",
        recoveryToolName: "web_scan",
        recoveryErrorClass: "config_missing",
        recoveryObservedAt: latestObservedAt,
        consumedAt,
        traceId: "trace_timeline_contract",
      },
    ],
    latestRecoveryConsumption: {
      id: "tsc_timeline_contract_nonrecoverable",
      reason: "nonrecoverable_intervention_prompted",
      recoveryStage: "ask_user",
      recoveryToolName: "web_scan",
      recoveryErrorClass: "config_missing",
      recoveryObservedAt: latestObservedAt,
      consumedAt,
      traceId: "trace_timeline_contract",
    },
  };

  const consumedFeedback: RuntimeToolRecoveryFeedback = {
    ...activeFeedback,
    active: false,
    severity: "none",
    reason: "consumed_nonrecoverable_intervention_prompted",
    promptBlock: "",
    consumed: true,
    consumedReason: "nonrecoverable_intervention_prompted",
    consumedAt,
  };

  const consumedTimeline = buildRuntimeToolRecoveryTimeline({
    metrics,
    adaptationSnapshot: consumedAdaptationSnapshot,
    recoveryFeedback: consumedFeedback,
  });

  expectEqual(consumedTimeline[0].recoveryKey, active.expectedLatestRecoveryKey, "consumed timeline latest recovery key");
  expectEqual(consumedTimeline[0].active, false, "consumed timeline latest active");
  expectEqual(consumedTimeline[0].consumed, true, "consumed timeline latest consumed");
  expectEqual(
    consumedTimeline[0].consumedReason,
    "nonrecoverable_intervention_prompted",
    "consumed timeline latest consumed reason",
  );
  expectEqual(
    consumedTimeline[0].sameToolErrorCount,
    expectedEscalation.sameToolErrorCount,
    "consumed timeline latest repeat count",
  );
  expectEqual(consumedTimeline[0].escalated, expectedEscalation.escalated, "consumed timeline latest escalated");
  expectEqual(
    consumedTimeline[0].escalationReason,
    expectedEscalation.escalationReason,
    "consumed timeline latest escalation reason",
  );
  expectEqual(
    consumedTimeline[0].escalationPolicyVersion,
    expectedEscalation.escalationPolicyVersion,
    "consumed timeline latest escalation policy version",
  );
  expectEqual(consumedTimeline[0].baseStage, expectedEscalation.baseStage, "consumed timeline latest base stage");
  expectEqual(
    consumedTimeline[0].baseRecommendedNextAction,
    expectedEscalation.baseRecommendedNextAction,
    "consumed timeline latest base action",
  );

  const consumedHealth = buildRuntimeToolRecoveryHealthSummary({
    timeline: consumedTimeline,
    nowMs: Date.parse(consumedAt),
  });
  const consumedReadiness = buildRuntimeToolRecoveryReadinessSummary({
    health: consumedHealth,
  });
  const consumedDecision = buildRuntimeToolRecoveryDecision({
    metrics,
    adaptationSnapshot: consumedAdaptationSnapshot,
    nowMs: Date.parse(consumedAt),
  });

  expectEqual(consumedHealth.activeRecoveryCount, 0, "consumed health active count");
  expectEqual(consumedHealth.score, 96, "consumed health score");
  expectEqual(consumedHealth.level, "watch", "consumed health level");
  expectEqual(consumedHealth.reason, "historical_unconsumed_recovery", "consumed health reason");
  expectEqual(
    consumedHealth.recommendedNextAction,
    "locate_path_with_glob_before_retry",
    "consumed health recommended next action",
  );
  expectEqual(consumedHealth.attentionSource, "historical_unconsumed", "consumed health attention source");
  expectEqual(consumedHealth.attentionRecoveryKey, consumedTimeline[1]?.recoveryKey ?? null, "consumed health attention key");
  expectEqual(consumedHealth.attentionToolName, "read", "consumed health attention tool");
  expectEqual(consumedHealth.attentionErrorClass, "path_not_found", "consumed health attention error");
  expectEqual(
    consumedHealth.attentionRequiresUserIntervention,
    false,
    "consumed health attention requires user intervention",
  );
  expectEqual(consumedHealth.attentionAgeMs, 360_000, "consumed health attention age");
  expectEqual(consumedHealth.activeNonrecoverableCount, 0, "consumed health active nonrecoverable count");
  expectEqual(consumedHealth.unconsumedCount, 1, "consumed health unconsumed count");
  expectEqual(consumedHealth.consumedCount, 1, "consumed health consumed count");
  expectEqual(consumedHealth.stuckNonrecoverableCount, 0, "consumed health stuck nonrecoverable count");
  expectEqual(consumedHealth.hasStuckNonrecoverable, false, "consumed health stuck flag");
  expectEqual(consumedHealth.latestRecoveryKey, active.expectedLatestRecoveryKey, "consumed health latest key");
  expectEqual(consumedReadiness.status, "degraded", "consumed readiness status");
  expectEqual(consumedReadiness.ready, false, "consumed readiness ready");
  expectEqual(consumedReadiness.automaticRecoveryAllowed, true, "consumed readiness automatic recovery");
  expectEqual(consumedReadiness.operatorActionRequired, false, "consumed readiness operator action");
  expectEqual(consumedReadiness.attentionRecoveryKey, consumedTimeline[1]?.recoveryKey ?? null, "consumed readiness attention key");
  expectEqual(consumedReadiness.attentionStage, "local_fix", "consumed readiness attention stage");
  expectEqual(consumedDecision.feedback.consumed, true, "consumed decision feedback consumed");
  expectEqual(
    consumedDecision.feedback.reason,
    "consumed_nonrecoverable_intervention_prompted",
    "consumed decision feedback reason",
  );
  expectEqual(
    consumedDecision.feedback.sameToolErrorCount,
    expectedEscalation.sameToolErrorCount,
    "consumed decision feedback repeat count",
  );
  expectEqual(
    consumedDecision.feedback.escalated,
    expectedEscalation.escalated,
    "consumed decision feedback escalated",
  );
  expectEqual(
    consumedDecision.feedback.escalationReason,
    expectedEscalation.escalationReason,
    "consumed decision feedback escalation reason",
  );
  expectEqual(
    consumedDecision.feedback.escalationPolicyVersion,
    expectedEscalation.escalationPolicyVersion,
    "consumed decision feedback escalation policy version",
  );
  expectEqual(
    consumedDecision.feedback.baseStage,
    expectedEscalation.baseStage,
    "consumed decision feedback base stage",
  );
  expectEqual(
    consumedDecision.feedback.baseRecommendedNextAction,
    expectedEscalation.baseRecommendedNextAction,
    "consumed decision feedback base action",
  );
  expectEqual(consumedDecision.timeline[0].consumed, true, "consumed decision timeline latest consumed");
  expectEqual(consumedDecision.health.score, consumedHealth.score, "consumed decision health parity");
  expectEqual(consumedDecision.readiness.status, "degraded", "consumed decision readiness status");
  expectEqual(consumedDecision.gate.status, "warn", "consumed decision gate status");
  expectEqual(consumedDecision.gate.reason, "degraded_auto_recovery_allowed", "consumed decision gate reason");

  const fullyRecoveredAdaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot = {
    ...emptyAdaptationSnapshot,
    updatedAt: consumedAt,
    recentRecoveryConsumptions: [
      {
        id: "tsc_timeline_contract_latest_consumed",
        reason: "nonrecoverable_intervention_prompted",
        recoveryStage: "ask_user",
        recoveryToolName: "web_scan",
        recoveryErrorClass: "config_missing",
        recoveryObservedAt: latestObservedAt,
        consumedAt,
        traceId: "trace_timeline_contract_latest",
      },
      {
        id: "tsc_timeline_contract_older_recovered",
        reason: "recovered_signal_consumed",
        recoveryStage: "local_fix",
        recoveryToolName: "read",
        recoveryErrorClass: "path_not_found",
        recoveryObservedAt: olderObservedAt,
        consumedAt,
        traceId: "trace_timeline_contract_older",
      },
    ],
    latestRecoveryConsumption: {
      id: "tsc_timeline_contract_older_recovered",
      reason: "recovered_signal_consumed",
      recoveryStage: "local_fix",
      recoveryToolName: "read",
      recoveryErrorClass: "path_not_found",
      recoveryObservedAt: olderObservedAt,
      consumedAt,
      traceId: "trace_timeline_contract_older",
    },
  };

  const fullyRecoveredDecision = buildRuntimeToolRecoveryDecision({
    metrics,
    adaptationSnapshot: fullyRecoveredAdaptationSnapshot,
    nowMs: Date.parse(consumedAt),
  });
  expectEqual(fullyRecoveredDecision.feedback.consumed, true, "fully recovered latest feedback consumed");
  expectEqual(fullyRecoveredDecision.timeline[0]?.consumed ?? false, true, "fully recovered latest timeline consumed");
  expectEqual(fullyRecoveredDecision.timeline[1]?.consumed ?? false, true, "fully recovered older timeline consumed");
  expectEqual(fullyRecoveredDecision.health.score, 100, "fully recovered health score");
  expectEqual(fullyRecoveredDecision.health.level, "good", "fully recovered health level");
  expectEqual(fullyRecoveredDecision.health.unconsumedCount, 0, "fully recovered unconsumed count");
  expectEqual(fullyRecoveredDecision.health.attentionSource, "none", "fully recovered attention source");
  expectEqual(fullyRecoveredDecision.readiness.status, "ready", "fully recovered readiness status");
  expectEqual(fullyRecoveredDecision.readiness.automaticRecoveryAllowed, true, "fully recovered automatic recovery");
  expectEqual(fullyRecoveredDecision.gate.status, "pass", "fully recovered gate status");
  expectEqual(fullyRecoveredDecision.gate.reason, "ready", "fully recovered gate reason");

  return {
    consumedTimeline,
    consumedHealth,
    consumedReadiness,
    consumedDecision,
    fullyRecoveredDecision,
  };
}
