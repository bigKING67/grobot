import type { RuntimeToolSurfaceAdaptationResult } from "../default-enabled-tools";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";
import type {
  RuntimeToolSurfaceAdaptationGuard,
  RuntimeToolSurfaceAdaptationGuardedResult,
  RuntimeToolSurfaceAdaptationRecord,
  RuntimeToolSurfaceAdaptationSnapshot,
} from "./contract";
import { adaptationGuardKey, recoveryKey } from "./keys";
import { parseIsoMs } from "./time";

function inactiveGuard(reason = "ok"): RuntimeToolSurfaceAdaptationGuard {
  return {
    active: false,
    reason,
    blockedProfile: null,
    matchingFailureCount: 0,
    recentProfileSequence: [],
  };
}

function isUnsuccessfulAdaptationOutcome(record: RuntimeToolSurfaceAdaptationRecord): boolean {
  return record.outcome === "failed" || record.outcome === "unknown";
}

function recoveredSignalStillApplies(input: {
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
  adaptation: RuntimeToolSurfaceAdaptationResult["adaptation"];
  latestAdaptation: RuntimeToolSurfaceAdaptationRecord;
}): boolean {
  const observedAtMs = parseIsoMs(input.adaptation.recoveryObservedAt);
  if (typeof observedAtMs !== "number") {
    return false;
  }
  const candidateRecoveryKey = recoveryKey(input.adaptation);
  const consumedRecord = [...input.snapshot.recentRecoveryConsumptions]
    .reverse()
    .find((record) => record.reason === "recovered_signal_consumed" && recoveryKey(record) === candidateRecoveryKey);
  const consumedAtMs = parseIsoMs(consumedRecord?.consumedAt);
  if (typeof consumedAtMs === "number") {
    return consumedAtMs >= observedAtMs;
  }
  const completedAtMs = parseIsoMs(input.latestAdaptation.completedAt);
  return typeof completedAtMs === "number" && completedAtMs >= observedAtMs;
}

export function assessRuntimeToolSurfaceAdaptationGuard(input: {
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
  adaptation: RuntimeToolSurfaceAdaptationResult["adaptation"];
}): RuntimeToolSurfaceAdaptationGuard {
  if (!input.adaptation.active) {
    return inactiveGuard("adaptation_inactive");
  }
  const candidateKey = adaptationGuardKey({
    appliedProfile: input.adaptation.appliedProfile,
    recoveryToolName: input.adaptation.recoveryToolName,
    recoveryErrorClass: input.adaptation.recoveryErrorClass,
  });
  const latestAdaptation = input.snapshot.latestAdaptation;
  if (
    latestAdaptation
    && latestAdaptation.outcome === "recovered"
    && adaptationGuardKey(latestAdaptation) === candidateKey
    && recoveredSignalStillApplies({
      snapshot: input.snapshot,
      adaptation: input.adaptation,
      latestAdaptation,
    })
  ) {
    return {
      active: true,
      reason: "recovered_signal_consumed",
      blockedProfile: input.adaptation.appliedProfile,
      matchingFailureCount: 0,
      recentProfileSequence: input.snapshot.recentAdaptations
        .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.guard.recentProfileSequenceSize)
        .map((record) => record.appliedProfile),
    };
  }
  let matchingFailureCount = 0;
  for (const record of [...input.snapshot.recentAdaptations].reverse()) {
    const recordKey = adaptationGuardKey(record);
    if (recordKey !== candidateKey) {
      break;
    }
    if (record.outcome !== "failed") {
      break;
    }
    matchingFailureCount += 1;
  }
  if (matchingFailureCount >= RUNTIME_TOOL_RECOVERY_POLICY.guard.repeatedProfileFailureThreshold) {
    return {
      active: true,
      reason: "repeated_profile_failure",
      blockedProfile: input.adaptation.appliedProfile,
      matchingFailureCount,
      recentProfileSequence: input.snapshot.recentAdaptations
        .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.guard.recentProfileSequenceSize)
        .map((record) => record.appliedProfile),
    };
  }

  const recentRecords = input.snapshot.recentAdaptations.slice(
    -1 * Math.max(0, RUNTIME_TOOL_RECOVERY_POLICY.guard.oscillationProfileWindowSize - 1),
  );
  const recentProfileSequence = [
    ...recentRecords.map((record) => record.appliedProfile),
    input.adaptation.appliedProfile,
  ];
  if (
    recentProfileSequence.length >= RUNTIME_TOOL_RECOVERY_POLICY.guard.oscillationProfileWindowSize
    && recentRecords.every(isUnsuccessfulAdaptationOutcome)
    && recentProfileSequence[0] === recentProfileSequence[2]
    && recentProfileSequence[1] === recentProfileSequence[3]
    && recentProfileSequence[0] !== recentProfileSequence[1]
  ) {
    return {
      active: true,
      reason: "profile_oscillation",
      blockedProfile: input.adaptation.appliedProfile,
      matchingFailureCount,
      recentProfileSequence,
    };
  }

  return {
    ...inactiveGuard("ok"),
    matchingFailureCount,
    recentProfileSequence,
  };
}

export function applyRuntimeToolSurfaceAdaptationGuard(input: {
  baseContext: RuntimeToolSurfaceAdaptationResult["context"];
  result: RuntimeToolSurfaceAdaptationResult;
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
}): RuntimeToolSurfaceAdaptationGuardedResult {
  const guard = assessRuntimeToolSurfaceAdaptationGuard({
    snapshot: input.snapshot,
    adaptation: input.result.adaptation,
  });
  if (!guard.active) {
    return {
      ...input.result,
      guard,
    };
  }
  return {
    context: input.baseContext,
    adaptation: {
      ...input.result.adaptation,
      active: false,
      reason: `guard_${guard.reason}`,
      appliedProfile: input.result.adaptation.fromProfile,
      recommendedProfile: input.result.adaptation.appliedProfile,
      source: null,
    },
    guard,
  };
}
