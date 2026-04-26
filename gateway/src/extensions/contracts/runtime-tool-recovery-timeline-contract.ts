import {
  buildRuntimeToolRecoveryHealthSummary,
  buildRuntimeToolRecoveryKey,
  buildRuntimeToolRecoveryTimeline,
} from "../../tools/runtime/tool-recovery-timeline";
import type { RuntimeToolRecoveryFeedback, RuntimeToolSurfaceMetricsSnapshot } from "../../tools/runtime/tool-events";
import type { RuntimeToolSurfaceAdaptationSnapshot } from "../../tools/runtime/tool-surface-adaptation-state";

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

const olderObservedAt = "2026-04-26T00:00:00.000Z";
const latestObservedAt = "2026-04-26T00:05:00.000Z";
const consumedAt = "2026-04-26T00:06:00.000Z";

const metrics: RuntimeToolSurfaceMetricsSnapshot = {
  version: 1,
  updatedAt: latestObservedAt,
  callsTotal: 3,
  failedTotal: 2,
  deferredTotal: 0,
  callsByTool: {
    read: 1,
    web_scan: 2,
  },
  failuresByErrorClass: {
    path_not_found: 1,
    config_missing: 1,
  },
  recoveryStages: {
    local_fix: 1,
    ask_user: 1,
  },
  avgDurationMsByTool: {
    read: 8,
    web_scan: 12,
  },
  recentRecoveries: [
    {
      stage: "local_fix",
      reason: "path_not_found",
      recommendedNextAction: "locate_path_with_glob_before_retry",
      toolName: "read",
      errorClass: "path_not_found",
      recoverable: true,
      observedAt: olderObservedAt,
    },
    {
      stage: "ask_user",
      reason: "config_missing",
      recommendedNextAction: "ask_user_for_config_or_switch_provider",
      toolName: "web_scan",
      errorClass: "config_missing",
      recoverable: false,
      observedAt: latestObservedAt,
    },
  ],
  latestRecovery: {
    stage: "ask_user",
    reason: "config_missing",
    recommendedNextAction: "ask_user_for_config_or_switch_provider",
    toolName: "web_scan",
    errorClass: "config_missing",
    recoverable: false,
    observedAt: latestObservedAt,
  },
  path: "/tmp/grobot-runtime-tool-recovery-timeline-contract",
};

const emptyAdaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot = {
  version: 1,
  updatedAt: null,
  path: "/tmp/grobot-runtime-tool-recovery-timeline-contract-adaptation",
  recentAdaptations: [],
  latestAdaptation: null,
  profileOutcomes: {},
  recentRecoveryConsumptions: [],
  latestRecoveryConsumption: null,
};

const activeFeedback: RuntimeToolRecoveryFeedback = {
  active: true,
  severity: "warning",
  reason: "recent_recovery",
  stage: "ask_user",
  toolName: "web_scan",
  errorClass: "config_missing",
  recommendedNextAction: "ask_user_for_config_or_switch_provider",
  recoverable: false,
  requiresUserIntervention: true,
  promptBlock: "[Runtime Tool Recovery Hint]",
  observedAt: latestObservedAt,
  consumed: false,
  consumedReason: null,
  consumedAt: null,
};

const activeTimeline = buildRuntimeToolRecoveryTimeline({
  metrics,
  adaptationSnapshot: emptyAdaptationSnapshot,
  recoveryFeedback: activeFeedback,
});

expectEqual(activeTimeline.length, 2, "active timeline length");
expectEqual(activeTimeline[0].toolName, "web_scan", "active timeline latest tool");
expectEqual(activeTimeline[0].stage, "ask_user", "active timeline latest stage");
expectEqual(activeTimeline[0].active, true, "active timeline latest active");
expectEqual(activeTimeline[0].consumed, false, "active timeline latest consumed");
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

expectEqual(activeHealth.timelineEntryCount, 2, "active health timeline count");
expectEqual(activeHealth.score, 36, "active health score");
expectEqual(activeHealth.level, "risk", "active health level");
expectEqual(activeHealth.reason, "active_nonrecoverable_recovery", "active health reason");
expectEqual(
  activeHealth.recommendedNextAction,
  "ask_user_for_config_or_switch_provider",
  "active health recommended next action",
);
expectEqual(activeHealth.attentionSource, "latest", "active health attention source");
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
expectEqual(activeHealth.latestAgeMs, 2_000, "active health latest age");
expectEqual(activeHealth.errorClassCounts.config_missing, 1, "active health config_missing count");
expectEqual(activeHealth.toolNameCounts.web_scan, 1, "active health web_scan count");

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

expectEqual(consumedTimeline[0].recoveryKey, expectedLatestRecoveryKey, "consumed timeline latest recovery key");
expectEqual(consumedTimeline[0].active, false, "consumed timeline latest active");
expectEqual(consumedTimeline[0].consumed, true, "consumed timeline latest consumed");
expectEqual(
  consumedTimeline[0].consumedReason,
  "nonrecoverable_intervention_prompted",
  "consumed timeline latest consumed reason",
);

const consumedHealth = buildRuntimeToolRecoveryHealthSummary({
  timeline: consumedTimeline,
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
expectEqual(consumedHealth.latestRecoveryKey, expectedLatestRecoveryKey, "consumed health latest key");

process.stdout.write(JSON.stringify({
  ok: true,
  active_timeline_count: activeTimeline.length,
  active_latest_recovery_key: activeTimeline[0]?.recoveryKey ?? null,
  active_health_level: activeHealth.level,
  active_health_score: activeHealth.score,
  active_health_stuck_nonrecoverable: activeHealth.hasStuckNonrecoverable,
  active_health_attention_source: activeHealth.attentionSource,
  consumed_latest_recovery_consumed: consumedTimeline[0]?.consumed ?? null,
  consumed_health_level: consumedHealth.level,
  consumed_health_unconsumed_count: consumedHealth.unconsumedCount,
  consumed_health_attention_source: consumedHealth.attentionSource,
}) + "\n");
