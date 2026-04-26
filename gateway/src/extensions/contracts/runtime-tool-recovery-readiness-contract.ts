import {
  buildRuntimeToolRecoveryReadinessGate,
  formatRuntimeToolRecoveryGateFields,
  type RuntimeToolRecoveryReadinessGateDecision,
} from "../../tools/runtime/tool-recovery-readiness-gate";
import {
  buildRuntimeToolRecoveryReadinessSummary,
  formatRuntimeToolRecoveryReadinessFields,
  type RuntimeToolRecoveryReadinessSummary,
} from "../../tools/runtime/tool-recovery-readiness";
import type { RuntimeToolRecoveryPolicySnapshot } from "../../tools/runtime/tool-recovery-policy";
import type { RuntimeToolRecoveryHealthSummary } from "../../tools/runtime/tool-recovery-timeline";

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

function makeReadiness(
  overrides: Partial<RuntimeToolRecoveryReadinessSummary>,
): RuntimeToolRecoveryReadinessSummary {
  return {
    status: "ready",
    ready: true,
    automaticRecoveryAllowed: true,
    operatorActionRequired: false,
    reason: "stable",
    recommendedNextAction: null,
    policyVersion: "v1",
    healthLevel: "good",
    healthScore: 100,
    riskScoreThreshold: 70,
    watchScoreThreshold: 95,
    attentionRecoveryKey: null,
    attentionSource: "none",
    attentionStage: null,
    attentionToolName: null,
    attentionErrorClass: null,
    attentionRequiresUserIntervention: false,
    ...overrides,
  };
}

function makeHealth(overrides: Partial<RuntimeToolRecoveryHealthSummary>): RuntimeToolRecoveryHealthSummary {
  return {
    score: 100,
    level: "good",
    reason: "stable",
    recommendedNextAction: null,
    attentionSource: "none",
    attentionRecoveryKey: null,
    attentionStage: null,
    attentionToolName: null,
    attentionErrorClass: null,
    attentionRequiresUserIntervention: false,
    attentionAgeMs: null,
    latestRecommendedNextAction: null,
    timelineEntryCount: 0,
    activeRecoveryCount: 0,
    activeNonrecoverableCount: 0,
    unconsumedCount: 0,
    consumedCount: 0,
    nonrecoverableCount: 0,
    stuckNonrecoverableCount: 0,
    hasStuckNonrecoverable: false,
    latestRecoveryKey: null,
    latestStage: null,
    latestToolName: null,
    latestErrorClass: null,
    latestRequiresUserIntervention: false,
    latestAgeMs: null,
    components: {
      activeRecoveryPenalty: 0,
      activeNonrecoverablePenalty: 0,
      stuckNonrecoverablePenalty: 0,
      historicalUnconsumedPenalty: 0,
    },
    errorClassCounts: {},
    toolNameCounts: {},
    ...overrides,
  };
}

const customPolicy: RuntimeToolRecoveryPolicySnapshot = {
  version: "v-test-readiness",
  promptMaxAgeMs: 123,
  timelineMaxEntries: 7,
  adaptationHistoryMaxEntries: 8,
  recoveryConsumptionHistoryMaxEntries: 9,
  guard: {
    repeatedProfileFailureThreshold: 4,
    recentProfileSequenceSize: 5,
    oscillationProfileWindowSize: 6,
  },
  escalation: {
    sameToolErrorStrategySwitchThreshold: 10,
    sameToolErrorAskUserThreshold: 11,
  },
  health: {
    riskScoreThreshold: 42,
    watchScoreThreshold: 77,
    penalties: {
      activeRecovery: 1,
      activeNonrecoverable: 2,
      stuckNonrecoverable: 3,
      historicalUnconsumed: 4,
    },
  },
};

function assertGate(input: {
  name: string;
  gate: RuntimeToolRecoveryReadinessGateDecision;
  status: RuntimeToolRecoveryReadinessGateDecision["status"];
  passed: boolean;
  blocking: boolean;
  severity: RuntimeToolRecoveryReadinessGateDecision["severity"];
  reason: RuntimeToolRecoveryReadinessGateDecision["reason"];
}): void {
  expectEqual(input.gate.status, input.status, `${input.name} gate status`);
  expectEqual(input.gate.passed, input.passed, `${input.name} gate passed`);
  expectEqual(input.gate.blocking, input.blocking, `${input.name} gate blocking`);
  expectEqual(input.gate.severity, input.severity, `${input.name} gate severity`);
  expectEqual(input.gate.reason, input.reason, `${input.name} gate reason`);
}

const readyGate = buildRuntimeToolRecoveryReadinessGate({
  readiness: makeReadiness({}),
});
assertGate({
  name: "ready",
  gate: readyGate,
  status: "pass",
  passed: true,
  blocking: false,
  severity: "none",
  reason: "ready",
});
expectEqual(readyGate.automaticRecoveryAllowed, true, "ready gate automatic recovery");
expectEqual(readyGate.operatorActionRequired, false, "ready gate operator action");
expectEqual(readyGate.readinessStatus, "ready", "ready gate readiness status");

const degradedGate = buildRuntimeToolRecoveryReadinessGate({
  readiness: makeReadiness({
    status: "degraded",
    ready: false,
    reason: "health_watch:historical_unconsumed_recovery",
    recommendedNextAction: "locate_path_with_glob_before_retry",
    healthLevel: "watch",
    healthScore: 96,
    attentionRecoveryKey: "local_fix:read:path_not_found:2026-04-26T00:00:00.000Z",
    attentionSource: "historical_unconsumed",
    attentionStage: "local_fix",
    attentionToolName: "read",
    attentionErrorClass: "path_not_found",
  }),
});
assertGate({
  name: "degraded",
  gate: degradedGate,
  status: "warn",
  passed: true,
  blocking: false,
  severity: "warning",
  reason: "degraded_auto_recovery_allowed",
});
expectEqual(
  degradedGate.recommendedNextAction,
  "locate_path_with_glob_before_retry",
  "degraded gate recommended action",
);
expectEqual(degradedGate.attentionStage, "local_fix", "degraded gate attention stage");
expectEqual(degradedGate.attentionToolName, "read", "degraded gate attention tool");

const blockedOperatorGate = buildRuntimeToolRecoveryReadinessGate({
  readiness: makeReadiness({
    status: "blocked",
    ready: false,
    automaticRecoveryAllowed: false,
    operatorActionRequired: true,
    reason: "health_risk:active_nonrecoverable_recovery",
    recommendedNextAction: "ask_user_for_config_or_switch_provider",
    healthLevel: "risk",
    healthScore: 36,
    attentionRecoveryKey: "ask_user:web_scan:config_missing:2026-04-26T00:05:00.000Z",
    attentionSource: "latest",
    attentionStage: "ask_user",
    attentionToolName: "web_scan",
    attentionErrorClass: "config_missing",
    attentionRequiresUserIntervention: true,
  }),
});
assertGate({
  name: "blocked operator",
  gate: blockedOperatorGate,
  status: "fail",
  passed: false,
  blocking: true,
  severity: "error",
  reason: "blocked_operator_action_required",
});
expectEqual(blockedOperatorGate.attentionRequiresUserIntervention, true, "blocked gate user intervention");
expectEqual(blockedOperatorGate.attentionStage, "ask_user", "blocked gate attention stage");

const degradedAutoDeniedGate = buildRuntimeToolRecoveryReadinessGate({
  readiness: makeReadiness({
    status: "degraded",
    ready: false,
    automaticRecoveryAllowed: false,
    operatorActionRequired: false,
    reason: "health_watch:policy_denied_recovery",
    recommendedNextAction: "inspect_runtime_tool_recovery_policy",
    healthLevel: "watch",
    healthScore: 94,
    attentionSource: "latest",
    attentionStage: "strategy_switch",
  }),
});
assertGate({
  name: "degraded auto denied",
  gate: degradedAutoDeniedGate,
  status: "fail",
  passed: false,
  blocking: true,
  severity: "error",
  reason: "automatic_recovery_denied",
});

const blockedAutoDeniedGate = buildRuntimeToolRecoveryReadinessGate({
  readiness: makeReadiness({
    status: "blocked",
    ready: false,
    automaticRecoveryAllowed: false,
    operatorActionRequired: false,
    reason: "health_risk:stuck_recovery",
    recommendedNextAction: "clear_stuck_recovery_before_retry",
    healthLevel: "risk",
    healthScore: 65,
    attentionSource: "latest",
    attentionStage: "strategy_switch",
  }),
});
assertGate({
  name: "blocked auto denied",
  gate: blockedAutoDeniedGate,
  status: "fail",
  passed: false,
  blocking: true,
  severity: "error",
  reason: "blocked_auto_recovery_denied",
});

const inconsistentGate = buildRuntimeToolRecoveryReadinessGate({
  readiness: makeReadiness({
    status: "ready",
    ready: false,
    automaticRecoveryAllowed: true,
    operatorActionRequired: false,
    reason: "inconsistent_fixture",
  }),
});
assertGate({
  name: "inconsistent",
  gate: inconsistentGate,
  status: "fail",
  passed: false,
  blocking: true,
  severity: "error",
  reason: "readiness_state_inconsistent",
});

const policyForwardedReadiness = buildRuntimeToolRecoveryReadinessSummary({
  policy: customPolicy,
  health: makeHealth({
    level: "watch",
    score: 76,
    reason: "historical_unconsumed_recovery",
    recommendedNextAction: "inspect_recovery_timeline",
    attentionSource: "historical_unconsumed",
    attentionRecoveryKey: "recovery:local_fix:read:path_not_found:2026-04-26T00:00:00.000Z",
    attentionStage: "local_fix",
    attentionToolName: "read",
    attentionErrorClass: "path_not_found",
    unconsumedCount: 1,
  }),
});
expectEqual(policyForwardedReadiness.status, "degraded", "policy forwarded readiness status");
expectEqual(policyForwardedReadiness.ready, false, "policy forwarded readiness ready");
expectEqual(
  policyForwardedReadiness.automaticRecoveryAllowed,
  true,
  "policy forwarded automatic recovery",
);
expectEqual(policyForwardedReadiness.operatorActionRequired, false, "policy forwarded operator action");
expectEqual(policyForwardedReadiness.policyVersion, "v-test-readiness", "policy forwarded version");
expectEqual(policyForwardedReadiness.riskScoreThreshold, 42, "policy forwarded risk threshold");
expectEqual(policyForwardedReadiness.watchScoreThreshold, 77, "policy forwarded watch threshold");
expectEqual(policyForwardedReadiness.healthScore, 76, "policy forwarded health score");
expectEqual(policyForwardedReadiness.attentionStage, "local_fix", "policy forwarded attention stage");

const policyForwardedGate = buildRuntimeToolRecoveryReadinessGate({
  readiness: policyForwardedReadiness,
});
assertGate({
  name: "policy forwarded",
  gate: policyForwardedGate,
  status: "warn",
  passed: true,
  blocking: false,
  severity: "warning",
  reason: "degraded_auto_recovery_allowed",
});
expectEqual(policyForwardedGate.policyVersion, "v-test-readiness", "policy forwarded gate version");
expectEqual(policyForwardedGate.riskScoreThreshold, 42, "policy forwarded gate risk threshold");
expectEqual(policyForwardedGate.watchScoreThreshold, 77, "policy forwarded gate watch threshold");
expectEqual(policyForwardedGate.healthScore, 76, "policy forwarded gate health score");

const policyForwardedReadinessFields = formatRuntimeToolRecoveryReadinessFields(policyForwardedReadiness);
expect(
  policyForwardedReadinessFields.includes("policy_version=v-test-readiness")
    && policyForwardedReadinessFields.includes("health_thresholds=77/42")
    && policyForwardedReadinessFields.includes("attention_stage=local_fix"),
  "readiness formatter includes policy thresholds and attention stage",
);

const policyForwardedGateFields = formatRuntimeToolRecoveryGateFields(policyForwardedGate);
expect(
  policyForwardedGateFields.includes("status=warn")
    && policyForwardedGateFields.includes("reason=degraded_auto_recovery_allowed")
    && policyForwardedGateFields.includes("policy_version=v-test-readiness")
    && policyForwardedGateFields.includes("health_thresholds=77/42"),
  "gate formatter includes reason and policy thresholds",
);

expect(
  [
    readyGate.reason,
    degradedGate.reason,
    blockedOperatorGate.reason,
    degradedAutoDeniedGate.reason,
    blockedAutoDeniedGate.reason,
    inconsistentGate.reason,
    policyForwardedGate.reason,
  ].every((reason) => typeof reason === "string" && reason.length > 0),
  "gate reasons stay machine readable",
);

process.stdout.write(JSON.stringify({
  ok: true,
  ready_status: readyGate.status,
  ready_passed: readyGate.passed,
  degraded_status: degradedGate.status,
  degraded_passed: degradedGate.passed,
  degraded_reason: degradedGate.reason,
  blocked_status: blockedOperatorGate.status,
  blocked_passed: blockedOperatorGate.passed,
  blocked_reason: blockedOperatorGate.reason,
  auto_denied_status: degradedAutoDeniedGate.status,
  auto_denied_reason: degradedAutoDeniedGate.reason,
  blocked_auto_denied_reason: blockedAutoDeniedGate.reason,
  inconsistent_reason: inconsistentGate.reason,
  policy_forwarded_readiness_status: policyForwardedReadiness.status,
  policy_forwarded_readiness_policy_version: policyForwardedReadiness.policyVersion,
  policy_forwarded_readiness_risk_threshold: policyForwardedReadiness.riskScoreThreshold,
  policy_forwarded_readiness_watch_threshold: policyForwardedReadiness.watchScoreThreshold,
  policy_forwarded_readiness_auto_allowed: policyForwardedReadiness.automaticRecoveryAllowed,
  policy_forwarded_gate_status: policyForwardedGate.status,
  policy_forwarded_gate_reason: policyForwardedGate.reason,
  policy_forwarded_gate_policy_version: policyForwardedGate.policyVersion,
  policy_forwarded_gate_risk_threshold: policyForwardedGate.riskScoreThreshold,
  policy_forwarded_gate_watch_threshold: policyForwardedGate.watchScoreThreshold,
  readiness_formatter_has_thresholds: policyForwardedReadinessFields.includes("health_thresholds=77/42"),
  gate_formatter_has_thresholds: policyForwardedGateFields.includes("health_thresholds=77/42"),
}) + "\n");
