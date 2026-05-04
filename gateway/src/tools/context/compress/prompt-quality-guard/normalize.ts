import type { PromptQualityGuardPolicy, PromptQualityGuardState } from "./contract";
import {
  DEFAULT_OUTCOME_COMBINED_EVIDENCE_SCORE,
  DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS,
  DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS,
  DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
  DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD,
  DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD,
  DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD,
  DEFAULT_PRESSURE_UTILIZATION_THRESHOLD,
  clamp01,
  clampOutcomeDriftCounter,
  clampPositiveInt,
  clampPressureRateThreshold,
  clampPressureUtilizationThreshold,
  clampRequiredTransitions,
  clampSignedUnit,
  clampUnitRatio,
  defaultPromptQualityGuardState,
  normalizeDriftAutoActionLevels,
  normalizeMaxFloorStage,
  normalizeStage,
  roundThreshold,
} from "./core";

export function normalizePromptQualityGuardPolicy(
  policy: PromptQualityGuardPolicy,
): PromptQualityGuardPolicy {
  return {
    enabled: policy.enabled === true,
    promoteStreak: clampPositiveInt(policy.promoteStreak, 2),
    severePromoteStreak: clampPositiveInt(policy.severePromoteStreak, 2),
    releaseStreak: clampPositiveInt(policy.releaseStreak, 3),
    holdTurns: Math.max(0, Math.min(64, clampPositiveInt(policy.holdTurns, 2))),
    maxFloorStage: normalizeMaxFloorStage(policy.maxFloorStage),
    severeOverallThreshold: clampUnitRatio(policy.severeOverallThreshold, 0.45),
    severeLowQualityRateThreshold: clampUnitRatio(policy.severeLowQualityRateThreshold, 0.7),
  };
}

export function normalizePromptQualityGuardState(raw: unknown): PromptQualityGuardState {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return defaultPromptQualityGuardState();
  }
  const row = raw as Record<string, unknown>;
  return {
    floorStage: normalizeStage(row.floorStage),
    degradedStreak:
      typeof row.degradedStreak === "number" && Number.isFinite(row.degradedStreak)
        ? Math.max(0, Math.floor(row.degradedStreak))
        : 0,
    severeStreak:
      typeof row.severeStreak === "number" && Number.isFinite(row.severeStreak)
        ? Math.max(0, Math.floor(row.severeStreak))
        : 0,
    healthyStreak:
      typeof row.healthyStreak === "number" && Number.isFinite(row.healthyStreak)
        ? Math.max(0, Math.floor(row.healthyStreak))
        : 0,
    holdTurnsRemaining:
      typeof row.holdTurnsRemaining === "number" && Number.isFinite(row.holdTurnsRemaining)
        ? Math.max(0, Math.floor(row.holdTurnsRemaining))
        : 0,
    lastReason: typeof row.lastReason === "string" ? row.lastReason : "init",
    updatedAt:
      typeof row.updatedAt === "string" && row.updatedAt.trim().length > 0
        ? row.updatedAt
        : null,
    pressureUtilizationThreshold: clampPressureUtilizationThreshold(
      typeof row.pressureUtilizationThreshold === "number"
        ? row.pressureUtilizationThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_UTILIZATION_THRESHOLD,
    ),
    pressureSemanticRateThreshold: clampPressureRateThreshold(
      typeof row.pressureSemanticRateThreshold === "number"
        ? row.pressureSemanticRateThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD,
    ),
    pressureAutoLimitRateThreshold: clampPressureRateThreshold(
      typeof row.pressureAutoLimitRateThreshold === "number"
        ? row.pressureAutoLimitRateThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD,
    ),
    pressureJointRateThreshold: clampPressureRateThreshold(
      typeof row.pressureJointRateThreshold === "number"
        ? row.pressureJointRateThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD,
    ),
    pressureTrendUtilizationDelta: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendUtilizationDelta === "number"
          ? row.pressureTrendUtilizationDelta
          : Number.NaN,
        0,
      ),
    ),
    pressureTrendSemanticDelta: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendSemanticDelta === "number"
          ? row.pressureTrendSemanticDelta
          : Number.NaN,
        0,
      ),
    ),
    pressureTrendAutoLimitDelta: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendAutoLimitDelta === "number"
          ? row.pressureTrendAutoLimitDelta
          : Number.NaN,
        0,
      ),
    ),
    pressureTrendMomentum: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendMomentum === "number"
          ? row.pressureTrendMomentum
          : Number.NaN,
        0,
      ),
    ),
    outcomeRequiredTransitions: clampRequiredTransitions(
      typeof row.outcomeRequiredTransitions === "number"
        ? row.outcomeRequiredTransitions
        : Number.NaN,
      DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
    ),
    outcomeCombinedEvidenceScore: roundThreshold(
      clamp01(
        typeof row.outcomeCombinedEvidenceScore === "number"
          ? row.outcomeCombinedEvidenceScore
          : DEFAULT_OUTCOME_COMBINED_EVIDENCE_SCORE,
      ),
    ),
    outcomeHighEvidenceTurns: clampOutcomeDriftCounter(
      typeof row.outcomeHighEvidenceTurns === "number"
        ? row.outcomeHighEvidenceTurns
        : Number.NaN,
      DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS,
    ),
    outcomeHighEvidenceHardenTurns: clampOutcomeDriftCounter(
      typeof row.outcomeHighEvidenceHardenTurns === "number"
        ? row.outcomeHighEvidenceHardenTurns
        : Number.NaN,
      DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS,
    ),
    outcomeDriftRecentAutoActionLevels: normalizeDriftAutoActionLevels(
      row.outcomeDriftRecentAutoActionLevels,
    ),
  };
}
