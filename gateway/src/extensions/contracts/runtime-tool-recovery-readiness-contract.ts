import {
  buildRuntimeToolRecoveryReadinessGate,
  type RuntimeToolRecoveryReadinessGateDecision,
} from "../../tools/runtime/tool-recovery-readiness-gate";
import type { RuntimeToolRecoveryReadinessSummary } from "../../tools/runtime/tool-recovery-readiness";

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

expect(
  [
    readyGate.reason,
    degradedGate.reason,
    blockedOperatorGate.reason,
    degradedAutoDeniedGate.reason,
    blockedAutoDeniedGate.reason,
    inconsistentGate.reason,
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
}) + "\n");
