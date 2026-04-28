import {
  buildRuntimeToolRecoveryHealthSummary,
  buildRuntimeToolRecoveryKey,
  buildRuntimeToolRecoveryTimeline,
} from "../../tools/runtime/tool-recovery-timeline";
import { buildRuntimeToolRecoveryDecision } from "../../tools/runtime/tool-recovery-decision";
import {
  buildRuntimeToolRecoveryReadinessSummary,
  formatRuntimeToolRecoveryReadinessFields,
} from "../../tools/runtime/tool-recovery-readiness";
import { formatRuntimeToolRecoveryGateFields } from "../../tools/runtime/tool-recovery-readiness-gate";
import type { RuntimeToolRecoveryFeedback, RuntimeToolSurfaceMetricsSnapshot } from "../../tools/runtime/tool-events";
import type { RuntimeToolRecoveryPolicySnapshot } from "../../tools/runtime/tool-recovery-policy";
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
const contractPathPrefix = [
  process.env.TMPDIR ?? "/tmp",
  `grobot-runtime-tool-recovery-timeline-contract-${String(process.pid)}-${String(Date.now())}`,
].join("/");

const expectedEscalation = {
  sameToolErrorCount: 3,
  escalated: true,
  escalationReason: "same_tool_error_exhausted",
  escalationPolicyVersion: "v1",
  baseStage: "strategy_switch" as const,
  baseRecommendedNextAction: "switch_tool_strategy",
};

const customPolicy: RuntimeToolRecoveryPolicySnapshot = {
  version: "v-test-health",
  promptMaxAgeMs: 1_000,
  timelineMaxEntries: 5,
  adaptationHistoryMaxEntries: 5,
  recoveryConsumptionHistoryMaxEntries: 5,
  guard: {
    repeatedProfileFailureThreshold: 2,
    recentProfileSequenceSize: 4,
    oscillationProfileWindowSize: 4,
  },
  escalation: {
    sameToolErrorStrategySwitchThreshold: 2,
    sameToolErrorAskUserThreshold: 3,
    environmentAskUserThreshold: 2,
    browserEnvironmentAskUserThreshold: 2,
  },
  health: {
    riskScoreThreshold: 40,
    watchScoreThreshold: 90,
    penalties: {
      activeRecovery: 5,
      activeNonrecoverable: 7,
      stuckNonrecoverable: 11,
      historicalUnconsumed: 13,
    },
  },
};

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
  recoveryCountsByKey: {
    "tool_error:read:path_not_found": 1,
    "tool_error:web_scan:config_missing": 1,
  },
  latestRecoveryRepeatKey: "tool_error:web_scan:config_missing",
  latestRecoveryRepeatCount: 1,
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
      reason: "same_tool_error_exhausted",
      recommendedNextAction: "ask_user_for_config_or_switch_provider",
      toolName: "web_scan",
      errorClass: "config_missing",
      recoverable: false,
      requiresUserIntervention: true,
      ...expectedEscalation,
      observedAt: latestObservedAt,
    },
  ],
  latestRecovery: {
    stage: "ask_user",
    reason: "same_tool_error_exhausted",
    recommendedNextAction: "ask_user_for_config_or_switch_provider",
    toolName: "web_scan",
    errorClass: "config_missing",
    recoverable: false,
    requiresUserIntervention: true,
    ...expectedEscalation,
    observedAt: latestObservedAt,
  },
  path: `${contractPathPrefix}/metrics`,
};

const emptyAdaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot = {
  version: 1,
  updatedAt: null,
  path: `${contractPathPrefix}/adaptation`,
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
expectEqual(activeHealth.recommendedActionFamily, "user_intervention", "active health action family");
expectEqual(activeHealth.attentionSource, "latest", "active health attention source");
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

const browserMetrics: RuntimeToolSurfaceMetricsSnapshot = {
  ...metrics,
  callsByTool: { web_scan: 1 },
  failuresByErrorClass: { browser_backend_result_error: 1 },
  recoveryStages: { ask_user: 1 },
  recoveryCountsByKey: {
    "tool_error:web_scan:browser_backend_result_error": 2,
  },
  latestRecoveryRepeatKey: "tool_error:web_scan:browser_backend_result_error",
  latestRecoveryRepeatCount: 2,
  recentRecoveries: [
    {
      stage: "ask_user",
      reason: "browser_backend_result_error",
      recommendedNextAction: "request_environment_fix",
      toolName: "web_scan",
      errorClass: "browser_backend_result_error",
      errorData: {
        diagnostic_kind: "browser_backend_result_error",
        error_code: "NO_EXTENSION",
      },
      recoverable: false,
      requiresUserIntervention: true,
      sameToolErrorCount: 2,
      escalated: true,
      escalationReason: "browser_environment_error_repeated",
      escalationPolicyVersion: "v1",
      baseStage: "strategy_switch",
      baseRecommendedNextAction: "inspect_error_and_switch_strategy",
      observedAt: latestObservedAt,
    },
  ],
  latestRecovery: {
    stage: "ask_user",
    reason: "browser_backend_result_error",
    recommendedNextAction: "request_environment_fix",
    toolName: "web_scan",
    errorClass: "browser_backend_result_error",
    errorData: {
      diagnostic_kind: "browser_backend_result_error",
      error_code: "NO_EXTENSION",
    },
    recoverable: false,
    requiresUserIntervention: true,
    sameToolErrorCount: 2,
    escalated: true,
    escalationReason: "browser_environment_error_repeated",
    escalationPolicyVersion: "v1",
    baseStage: "strategy_switch",
    baseRecommendedNextAction: "inspect_error_and_switch_strategy",
    observedAt: latestObservedAt,
  },
};

const browserFeedback: RuntimeToolRecoveryFeedback = {
  active: true,
  severity: "warning",
  reason: "repeated_recovery_escalated",
  stage: "ask_user",
  toolName: "web_scan",
  errorClass: "browser_backend_result_error",
  recommendedNextAction: "request_environment_fix",
  recoverable: false,
  requiresUserIntervention: true,
  sameToolErrorCount: 2,
  escalated: true,
  escalationReason: "browser_environment_error_repeated",
  escalationPolicyVersion: "v1",
  baseStage: "strategy_switch",
  baseRecommendedNextAction: "inspect_error_and_switch_strategy",
  promptBlock: "[Runtime Tool Recovery Hint]",
  observedAt: latestObservedAt,
  consumed: false,
  consumedReason: null,
  consumedAt: null,
};
const browserTimeline = buildRuntimeToolRecoveryTimeline({
  metrics: browserMetrics,
  adaptationSnapshot: emptyAdaptationSnapshot,
  recoveryFeedback: browserFeedback,
});
const browserHealth = buildRuntimeToolRecoveryHealthSummary({
  timeline: browserTimeline,
  nowMs: Date.parse(latestObservedAt) + 2_000,
});
const browserReadiness = buildRuntimeToolRecoveryReadinessSummary({
  health: browserHealth,
});
const browserDecision = buildRuntimeToolRecoveryDecision({
  metrics: browserMetrics,
  adaptationSnapshot: emptyAdaptationSnapshot,
  nowMs: Date.parse(latestObservedAt) + 2_000,
});
expectEqual(
  browserTimeline[0].browserEnvironmentRecovery?.errorCode,
  "NO_EXTENSION",
  "browser timeline exposes environment error code",
);
expectEqual(
  browserTimeline[0].browserEnvironmentRecovery?.action,
  "setup_and_doctor",
  "browser timeline exposes environment action",
);
expectEqual(
  browserTimeline[0].browserEnvironmentRecovery?.retryAllowed,
  false,
  "browser timeline blocks retry",
);
expectEqual(
  browserHealth.attentionBrowserEnvironmentRecovery?.errorCode,
  "NO_EXTENSION",
  "browser health exposes environment error code",
);
expectEqual(
  browserReadiness.attentionBrowserEnvironmentRecovery?.action,
  "setup_and_doctor",
  "browser readiness exposes environment action",
);
expectEqual(
  browserDecision.gate.attentionBrowserEnvironmentRecovery?.commands.join("|"),
  "grobot browser setup|grobot browser doctor",
  "browser gate exposes operator commands",
);
expect(
  formatRuntimeToolRecoveryReadinessFields(browserReadiness)
    .includes("browser_environment_recovery=code=NO_EXTENSION action=setup_and_doctor retry_allowed=false"),
  "browser readiness formatter exposes environment recovery",
);
expect(
  formatRuntimeToolRecoveryGateFields(browserDecision.gate)
    .includes("commands=grobot browser setup|grobot browser doctor"),
  "browser gate formatter exposes operator commands",
);

const customPolicyActiveHealth = buildRuntimeToolRecoveryHealthSummary({
  timeline: activeTimeline,
  nowMs: Date.parse(latestObservedAt) + 2_000,
  policy: customPolicy,
});
expectEqual(customPolicyActiveHealth.score, 64, "custom policy active health score");
expectEqual(customPolicyActiveHealth.level, "risk", "custom policy active health level");
expectEqual(
  customPolicyActiveHealth.components.activeRecoveryPenalty,
  5,
  "custom policy active recovery penalty",
);
expectEqual(
  customPolicyActiveHealth.components.activeNonrecoverablePenalty,
  7,
  "custom policy active nonrecoverable penalty",
);
expectEqual(
  customPolicyActiveHealth.components.stuckNonrecoverablePenalty,
  11,
  "custom policy stuck nonrecoverable penalty",
);
expectEqual(
  customPolicyActiveHealth.components.historicalUnconsumedPenalty,
  13,
  "custom policy historical unconsumed penalty",
);

const customPolicyActiveDecision = buildRuntimeToolRecoveryDecision({
  metrics,
  adaptationSnapshot: emptyAdaptationSnapshot,
  nowMs: Date.parse(latestObservedAt) + 2_000,
  policy: customPolicy,
});
expectEqual(customPolicyActiveDecision.policy.version, "v-test-health", "custom policy decision version");
expectEqual(customPolicyActiveDecision.health.score, 64, "custom policy decision health score");
expectEqual(customPolicyActiveDecision.readiness.policyVersion, "v-test-health", "custom policy decision readiness policy");
expectEqual(customPolicyActiveDecision.readiness.watchScoreThreshold, 90, "custom policy decision readiness watch threshold");
expectEqual(customPolicyActiveDecision.gate.policyVersion, "v-test-health", "custom policy decision gate policy");
expectEqual(customPolicyActiveDecision.gate.watchScoreThreshold, 90, "custom policy decision gate watch threshold");

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
expectEqual(consumedHealth.latestRecoveryKey, expectedLatestRecoveryKey, "consumed health latest key");
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

process.stdout.write(JSON.stringify({
  ok: true,
  active_timeline_count: activeTimeline.length,
  active_latest_recovery_key: activeTimeline[0]?.recoveryKey ?? null,
  active_latest_same_tool_error_count: activeTimeline[0]?.sameToolErrorCount ?? null,
  active_latest_escalated: activeTimeline[0]?.escalated ?? null,
  active_latest_escalation_reason: activeTimeline[0]?.escalationReason ?? null,
  active_health_level: activeHealth.level,
  active_health_score: activeHealth.score,
  active_health_stuck_nonrecoverable: activeHealth.hasStuckNonrecoverable,
  active_health_attention_source: activeHealth.attentionSource,
  active_readiness_status: activeReadiness.status,
  active_readiness_auto_allowed: activeReadiness.automaticRecoveryAllowed,
  active_decision_gate_reason: activeDecision.gate.reason,
  active_decision_gate_blocker_kind: activeDecision.gate.blockerKind,
  active_decision_gate_blocker_code: activeDecision.gate.blockerCode,
  active_decision_gate_blocker_action: activeDecision.gate.blockerAction,
  consumed_latest_recovery_consumed: consumedTimeline[0]?.consumed ?? null,
  consumed_latest_same_tool_error_count: consumedTimeline[0]?.sameToolErrorCount ?? null,
  consumed_latest_escalated: consumedTimeline[0]?.escalated ?? null,
  consumed_latest_escalation_reason: consumedTimeline[0]?.escalationReason ?? null,
  consumed_health_level: consumedHealth.level,
  consumed_health_unconsumed_count: consumedHealth.unconsumedCount,
  consumed_health_attention_source: consumedHealth.attentionSource,
  consumed_readiness_status: consumedReadiness.status,
  consumed_readiness_auto_allowed: consumedReadiness.automaticRecoveryAllowed,
  consumed_decision_gate_reason: consumedDecision.gate.reason,
  custom_policy_active_health_score: customPolicyActiveHealth.score,
  custom_policy_decision_policy_version: customPolicyActiveDecision.policy.version,
  custom_policy_decision_watch_threshold: customPolicyActiveDecision.gate.watchScoreThreshold,
  fully_recovered_health_level: fullyRecoveredDecision.health.level,
  fully_recovered_readiness_status: fullyRecoveredDecision.readiness.status,
  fully_recovered_gate_status: fullyRecoveredDecision.gate.status,
}) + "\n");
