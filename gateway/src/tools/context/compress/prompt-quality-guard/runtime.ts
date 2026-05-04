import { type PromptCompactionStage } from "../../types";
import type {
  PromptQualityGuardObservation,
  PromptQualityGuardPolicy,
  PromptQualityGuardRuntimeAssessment,
  PromptQualityGuardRuntimePhase,
  PromptQualityGuardRuntimeTransition,
  PromptQualityGuardState,
} from "./contract";
import {
  lowerStage,
  stageWeight,
} from "./core";
import { normalizePromptQualityGuardPolicy, normalizePromptQualityGuardState } from "./normalize";

export function isSevereObservation(args: {
  policy: PromptQualityGuardPolicy;
  observation: PromptQualityGuardObservation;
}): boolean {
  return (
    (typeof args.observation.observedOverall === "number"
      && args.observation.observedOverall <= args.policy.severeOverallThreshold)
    || (
      typeof args.observation.observedLowQualityRate === "number"
      && args.observation.observedLowQualityRate >= args.policy.severeLowQualityRateThreshold
    )
  );
}

export function resolvePromoteTargetFloor(args: {
  policy: PromptQualityGuardPolicy;
  severe: boolean;
  severeStreak: number;
}): PromptCompactionStage {
  let targetFloor: PromptCompactionStage = args.severe ? "forced" : "proactive";
  if (
    args.severe
    && args.severeStreak >= args.policy.severePromoteStreak
    && stageWeight(args.policy.maxFloorStage) >= stageWeight("minimal")
  ) {
    targetFloor = "minimal";
  }
  if (stageWeight(targetFloor) > stageWeight(args.policy.maxFloorStage)) {
    targetFloor = args.policy.maxFloorStage;
  }
  return targetFloor;
}

export function assessPromptQualityGuardRuntime(input: {
  policy: PromptQualityGuardPolicy;
  currentState: PromptQualityGuardState;
  observation: PromptQualityGuardObservation;
}): PromptQualityGuardRuntimeAssessment {
  const policy = normalizePromptQualityGuardPolicy(input.policy);
  const state = normalizePromptQualityGuardState(input.currentState);
  const observation = {
    degraded: input.observation.degraded === true,
    reason: input.observation.reason?.trim() || "unknown",
    observedOverall:
      typeof input.observation.observedOverall === "number"
      ? input.observation.observedOverall
      : null,
    observedLowQualityRate:
      typeof input.observation.observedLowQualityRate === "number"
      ? input.observation.observedLowQualityRate
      : null,
  };
  if (!policy.enabled) {
    return {
      enabled: false,
      phase: "disabled",
      transition: "none",
      degraded: observation.degraded,
      severe: false,
      reason: "guard_disabled",
      triggered: false,
      floorStage: state.floorStage,
      proposedFloorStage: "normal",
      promoteRemaining: 0,
      severePromoteRemaining: 0,
      releaseRemaining: 0,
      holdTurnsRemaining: 0,
      observedOverall: observation.observedOverall,
      observedLowQualityRate: observation.observedLowQualityRate,
    };
  }
  const severe = observation.degraded
    ? isSevereObservation({
      policy,
      observation,
    })
    : false;
  const promoteRemaining = Math.max(0, policy.promoteStreak - state.degradedStreak);
  const severePromoteRemaining = Math.max(0, policy.severePromoteStreak - state.severeStreak);
  const releaseRemaining = Math.max(0, policy.releaseStreak - state.healthyStreak);

  let proposedFloorStage = state.floorStage;
  if (observation.degraded && state.degradedStreak >= policy.promoteStreak) {
    const targetFloor = resolvePromoteTargetFloor({
      policy,
      severe,
      severeStreak: state.severeStreak,
    });
    if (stageWeight(targetFloor) > stageWeight(state.floorStage)) {
      proposedFloorStage = targetFloor;
    }
  }
  if (
    !observation.degraded
    && state.holdTurnsRemaining === 0
    && state.healthyStreak >= policy.releaseStreak
    && stageWeight(state.floorStage) > stageWeight("normal")
  ) {
    proposedFloorStage = lowerStage(state.floorStage);
  }

  const triggered = stageWeight(state.floorStage) > stageWeight("normal");
  let phase: PromptQualityGuardRuntimePhase = "idle";
  let transition: PromptQualityGuardRuntimeTransition = "none";
  if (observation.degraded) {
    if (stageWeight(proposedFloorStage) > stageWeight(state.floorStage)) {
      phase = "escalating";
      transition = "promote";
    } else if (triggered) {
      phase = "holding";
      transition = "hold";
    } else {
      phase = "escalating";
      transition = "hold";
    }
  } else if (triggered) {
    if (state.holdTurnsRemaining > 0) {
      phase = "holding";
      transition = "hold";
    } else {
      phase = "recovering";
      transition = stageWeight(proposedFloorStage) < stageWeight(state.floorStage) ? "release" : "hold";
    }
  }

  return {
    enabled: true,
    phase,
    transition,
    degraded: observation.degraded,
    severe,
    reason: observation.reason,
    triggered,
    floorStage: state.floorStage,
    proposedFloorStage,
    promoteRemaining,
    severePromoteRemaining,
    releaseRemaining,
    holdTurnsRemaining: state.holdTurnsRemaining,
    observedOverall: observation.observedOverall,
    observedLowQualityRate: observation.observedLowQualityRate,
  };
}
