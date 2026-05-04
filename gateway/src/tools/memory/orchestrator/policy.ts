import type {
  MemoryOrchestratorDecayPolicyOverride,
  MemoryOrchestratorInjectionPolicyOverride,
  MemoryOrchestratorPolicySnapshot,
} from "./contract";
import { clamp } from "./utils";

export function defaultMemoryOrchestratorPolicy(): MemoryOrchestratorPolicySnapshot {
  return {
    version: "v1",
    enabled: true,
    injectBudgetRatio: 0.22,
    injectBudgetMinTokens: 280,
    injectBudgetMaxTokens: 2600,
    maxSectionTokens: 1200,
    maxGaMemoryRows: 4,
    maxTeamExperienceRows: 3,
    minTeamExperienceScore: 36,
    decayEnabled: true,
    decayMaxRowsPerSession: 240,
    decayMinRowsToKeep: 4,
    decayMaxAgeHoursL1: 7 * 24,
    decayMaxAgeHoursL2: 30 * 24,
    decayMaxAgeHoursL3: 90 * 24,
    decayMaxAgeHoursL4: 180 * 24,
    decayUnverifiedMaxAgeHours: 72,
    decayMinConfidenceVerified: 0.2,
    decayMinConfidenceUnverified: 0.45,
  };
}

export function tuneInjectionPolicySnapshot(
  policy: MemoryOrchestratorPolicySnapshot,
  override: MemoryOrchestratorInjectionPolicyOverride,
): MemoryOrchestratorPolicySnapshot {
  if (typeof override.injectBudgetRatio === "number") {
    policy.injectBudgetRatio = clamp(
      Number(override.injectBudgetRatio.toFixed(4)),
      0.05,
      0.55,
    );
  }
  if (typeof override.injectBudgetMinTokens === "number") {
    policy.injectBudgetMinTokens = clamp(
      Math.floor(override.injectBudgetMinTokens),
      64,
      8_192,
    );
  }
  if (typeof override.injectBudgetMaxTokens === "number") {
    policy.injectBudgetMaxTokens = clamp(
      Math.floor(override.injectBudgetMaxTokens),
      64,
      16_384,
    );
  }
  if (policy.injectBudgetMaxTokens < policy.injectBudgetMinTokens) {
    policy.injectBudgetMaxTokens = policy.injectBudgetMinTokens;
  }
  if (typeof override.maxSectionTokens === "number") {
    policy.maxSectionTokens = clamp(
      Math.floor(override.maxSectionTokens),
      96,
      8_192,
    );
  }
  if (typeof override.maxGaMemoryRows === "number") {
    policy.maxGaMemoryRows = clamp(
      Math.floor(override.maxGaMemoryRows),
      1,
      32,
    );
  }
  if (typeof override.maxTeamExperienceRows === "number") {
    policy.maxTeamExperienceRows = clamp(
      Math.floor(override.maxTeamExperienceRows),
      1,
      32,
    );
  }
  if (typeof override.minTeamExperienceScore === "number") {
    policy.minTeamExperienceScore = clamp(
      Math.floor(override.minTeamExperienceScore),
      0,
      160,
    );
  }
  return {
    ...policy,
  };
}

export function tuneDecayPolicySnapshot(
  policy: MemoryOrchestratorPolicySnapshot,
  override: MemoryOrchestratorDecayPolicyOverride,
): MemoryOrchestratorPolicySnapshot {
  const minRowsToKeep = typeof override.decayMinRowsToKeep === "number"
    ? clamp(Math.floor(override.decayMinRowsToKeep), 1, 64)
    : policy.decayMinRowsToKeep;
  policy.decayMinRowsToKeep = minRowsToKeep;
  if (typeof override.decayMaxRowsPerSession === "number") {
    policy.decayMaxRowsPerSession = clamp(
      Math.floor(override.decayMaxRowsPerSession),
      minRowsToKeep,
      2_048,
    );
  }
  if (typeof override.decayUnverifiedMaxAgeHours === "number") {
    policy.decayUnverifiedMaxAgeHours = clamp(
      Math.floor(override.decayUnverifiedMaxAgeHours),
      1,
      8_760,
    );
  }
  if (typeof override.decayMinConfidenceVerified === "number") {
    policy.decayMinConfidenceVerified = clamp(
      Number(override.decayMinConfidenceVerified.toFixed(4)),
      0,
      1,
    );
  }
  if (typeof override.decayMinConfidenceUnverified === "number") {
    policy.decayMinConfidenceUnverified = clamp(
      Number(override.decayMinConfidenceUnverified.toFixed(4)),
      0,
      1,
    );
  }
  return {
    ...policy,
  };
}
