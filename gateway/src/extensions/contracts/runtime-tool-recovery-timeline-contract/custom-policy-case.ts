import { buildRuntimeToolRecoveryHealthSummary } from "../../../tools/runtime/tool-recovery-timeline";
import { buildRuntimeToolRecoveryDecision } from "../../../tools/runtime/tool-recovery-decision";
import { expectEqual } from "./assertions";
import {
  customPolicy,
  emptyAdaptationSnapshot,
  latestObservedAt,
  metrics,
} from "./fixtures";
import type { runActiveRecoveryCase } from "./active-case";

export function runCustomPolicyCase(active: ReturnType<typeof runActiveRecoveryCase>) {
  const customPolicyActiveHealth = buildRuntimeToolRecoveryHealthSummary({
    timeline: active.activeTimeline,
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

  return {
    customPolicyActiveHealth,
    customPolicyActiveDecision,
  };
}
