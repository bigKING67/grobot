import { type PromptCompactionStage } from "../../types";
import type {
  PromptQualityGuardDecision,
  PromptQualityGuardObservation,
  PromptQualityGuardPolicy,
  PromptQualityGuardState,
} from "./contract";
import {
  defaultPromptQualityGuardState,
  lowerStage,
  stageWeight,
} from "./core";
import { normalizePromptQualityGuardPolicy, normalizePromptQualityGuardState } from "./normalize";
import { isSevereObservation, resolvePromoteTargetFloor } from "./runtime";

export function evaluatePromptQualityGuard(input: {
  policy: PromptQualityGuardPolicy;
  currentState: PromptQualityGuardState;
  observation: PromptQualityGuardObservation;
}): PromptQualityGuardDecision {
  const policy = normalizePromptQualityGuardPolicy(input.policy);
  const currentState = normalizePromptQualityGuardState(input.currentState);
  const reason = input.observation.reason?.trim() || "unknown";
  const next: PromptQualityGuardState = {
    ...currentState,
    lastReason: reason,
    updatedAt: new Date().toISOString(),
  };

  let promoted = false;
  let released = false;
  let severe = false;
  let severeEscalated = false;

  if (!policy.enabled) {
    const resetState: PromptQualityGuardState = {
      ...defaultPromptQualityGuardState(),
      lastReason: "guard_disabled",
      updatedAt: next.updatedAt,
    };
    return {
      floorStage: "normal",
      triggered: false,
      promoted: false,
      released: false,
      severe: false,
      severeEscalated: false,
      state: resetState,
    };
  }

  if (input.observation.degraded) {
    next.degradedStreak += 1;
    next.healthyStreak = 0;
    severe = isSevereObservation({
      policy,
      observation: input.observation,
    });
    next.severeStreak = severe ? next.severeStreak + 1 : 0;
    if (next.degradedStreak >= policy.promoteStreak) {
      const before = next.floorStage;
      const targetFloor = resolvePromoteTargetFloor({
        policy,
        severe,
        severeStreak: next.severeStreak,
      });
      if (stageWeight(targetFloor) > stageWeight(next.floorStage)) {
        next.floorStage = targetFloor;
      }
      next.holdTurnsRemaining = Math.max(next.holdTurnsRemaining, policy.holdTurns);
      promoted = stageWeight(next.floorStage) > stageWeight(before);
      severeEscalated = severe
        && next.floorStage === "minimal"
        && next.severeStreak >= policy.severePromoteStreak;
    }
  } else {
    next.healthyStreak += 1;
    next.degradedStreak = 0;
    next.severeStreak = 0;
    if (next.holdTurnsRemaining > 0) {
      next.holdTurnsRemaining -= 1;
    }
    if (
      next.holdTurnsRemaining === 0
      && next.healthyStreak >= policy.releaseStreak
      && stageWeight(next.floorStage) > stageWeight("normal")
    ) {
      const before = next.floorStage;
      next.floorStage = lowerStage(next.floorStage);
      next.healthyStreak = 0;
      released = stageWeight(next.floorStage) < stageWeight(before);
    }
  }

  return {
    floorStage: next.floorStage,
    triggered: stageWeight(next.floorStage) > stageWeight("normal"),
    promoted,
    released,
    severe,
    severeEscalated,
    state: next,
  };
}

export function applyPromptQualityGuardFloor(input: {
  selectedStage: PromptCompactionStage;
  floorStage: PromptCompactionStage;
}): PromptCompactionStage {
  return stageWeight(input.floorStage) > stageWeight(input.selectedStage)
    ? input.floorStage
    : input.selectedStage;
}
