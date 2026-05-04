import type { MemoryOrchestratorPolicySnapshot } from "../orchestrator";
import {
  clampNonNegativeInt,
  clampRatio,
  clampSigned,
  clampToFloatRange,
  clampToIntRange,
} from "./clamp";
import {
  MEMORY_STRATEGY_AUTOTUNE_STATE_VERSION,
  type MemoryStrategyAutotuneState,
} from "./contract";
import { defaultMemoryStrategyAutotuneState } from "./defaults";
import {
  inferActionDirectionFromReason,
  normalizeProfile,
  resolveStrategyRanges,
} from "./ranges";

export function normalizeMemoryStrategyAutotuneState(
  raw: unknown,
  basePolicy: MemoryOrchestratorPolicySnapshot,
): MemoryStrategyAutotuneState {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return defaultMemoryStrategyAutotuneState(basePolicy);
  }
  const row = raw as Record<string, unknown>;
  const defaults = defaultMemoryStrategyAutotuneState(basePolicy);
  const ranges = resolveStrategyRanges(basePolicy);
  const reason =
    typeof row.lastReason === "string" && row.lastReason.trim().length > 0
      ? row.lastReason.trim()
      : defaults.lastReason;
  const inferredDirection = inferActionDirectionFromReason(reason);
  return {
    schemaVersion: clampToIntRange(
      Number(row.schemaVersion),
      1,
      MEMORY_STRATEGY_AUTOTUNE_STATE_VERSION,
    ),
    profile: normalizeProfile(row.profile),
    injectBudgetRatio: clampRatio(
      row.injectBudgetRatio,
      defaults.injectBudgetRatio,
      ranges.budgetRatioMin,
      ranges.budgetRatioMax,
    ),
    maxSectionTokens: clampToIntRange(
      Number(row.maxSectionTokens),
      ranges.sectionMin,
      ranges.sectionMax,
    ),
    maxGaMemoryRows: clampToIntRange(
      Number(row.maxGaMemoryRows),
      ranges.gaRowsMin,
      ranges.gaRowsMax,
    ),
    maxTeamExperienceRows: clampToIntRange(
      Number(row.maxTeamExperienceRows),
      ranges.teamRowsMin,
      ranges.teamRowsMax,
    ),
    minTeamExperienceScore: clampToIntRange(
      Number(row.minTeamExperienceScore),
      ranges.teamScoreMin,
      ranges.teamScoreMax,
    ),
    adaptiveLearnAlpha: clampRatio(row.adaptiveLearnAlpha, defaults.adaptiveLearnAlpha, 0.05, 0.5),
    adaptiveUpdates: clampNonNegativeInt(row.adaptiveUpdates),
    qualityLowRateEma: clampRatio(row.qualityLowRateEma, defaults.qualityLowRateEma),
    qualityPressureEma: clampRatio(row.qualityPressureEma, defaults.qualityPressureEma),
    averageUtilizationRatioEma: clampRatio(
      row.averageUtilizationRatioEma,
      defaults.averageUtilizationRatioEma,
    ),
    autoLimitTriggeredRateEma: clampRatio(
      row.autoLimitTriggeredRateEma,
      defaults.autoLimitTriggeredRateEma,
    ),
    snapshotSemanticCompressRateEma: clampRatio(
      row.snapshotSemanticCompressRateEma,
      defaults.snapshotSemanticCompressRateEma,
    ),
    hardBudgetRateEma: clampRatio(row.hardBudgetRateEma, defaults.hardBudgetRateEma),
    qualityFirstImprovedRateEma: clampRatio(
      row.qualityFirstImprovedRateEma,
      defaults.qualityFirstImprovedRateEma,
    ),
    hardBudgetFollowupDeltaEma: clampSigned(
      row.hardBudgetFollowupDeltaEma,
      defaults.hardBudgetFollowupDeltaEma,
      -1,
      1,
    ),
    qualityFirstFollowupDeltaEma: clampSigned(
      row.qualityFirstFollowupDeltaEma,
      defaults.qualityFirstFollowupDeltaEma,
      -1,
      1,
    ),
    lastActionDirection:
      row.lastActionDirection === "tighten"
      || row.lastActionDirection === "relax"
      || row.lastActionDirection === "neutral"
        ? row.lastActionDirection
        : inferredDirection,
    cooldownTurnsRemaining: clampToIntRange(
      Number(row.cooldownTurnsRemaining),
      0,
      8,
    ),
    tightenSignalStreak: clampToIntRange(
      Number(row.tightenSignalStreak),
      0,
      32,
    ),
    relaxSignalStreak: clampToIntRange(
      Number(row.relaxSignalStreak),
      0,
      32,
    ),
    adaptiveActionScale: clampToFloatRange(
      Number(row.adaptiveActionScale),
      0.5,
      2.5,
    ),
    pendingEvaluationDirection:
      row.pendingEvaluationDirection === "tighten"
      || row.pendingEvaluationDirection === "relax"
      || row.pendingEvaluationDirection === "neutral"
        ? row.pendingEvaluationDirection
        : "neutral",
    pendingEvaluationWarmupTurns: clampToIntRange(
      Number(row.pendingEvaluationWarmupTurns),
      0,
      8,
    ),
    pendingBaselineInjectBudgetRatio: clampRatio(
      row.pendingBaselineInjectBudgetRatio,
      defaults.pendingBaselineInjectBudgetRatio,
      ranges.budgetRatioMin,
      ranges.budgetRatioMax,
    ),
    pendingBaselineMaxSectionTokens: clampToIntRange(
      Number(row.pendingBaselineMaxSectionTokens),
      ranges.sectionMin,
      ranges.sectionMax,
    ),
    pendingBaselineMaxGaMemoryRows: clampToIntRange(
      Number(row.pendingBaselineMaxGaMemoryRows),
      ranges.gaRowsMin,
      ranges.gaRowsMax,
    ),
    pendingBaselineMaxTeamExperienceRows: clampToIntRange(
      Number(row.pendingBaselineMaxTeamExperienceRows),
      ranges.teamRowsMin,
      ranges.teamRowsMax,
    ),
    pendingBaselineMinTeamExperienceScore: clampToIntRange(
      Number(row.pendingBaselineMinTeamExperienceScore),
      ranges.teamScoreMin,
      ranges.teamScoreMax,
    ),
    pendingBaselineQualityLowRateEma: clampRatio(
      row.pendingBaselineQualityLowRateEma,
      defaults.pendingBaselineQualityLowRateEma,
    ),
    pendingBaselineQualityPressureEma: clampRatio(
      row.pendingBaselineQualityPressureEma,
      defaults.pendingBaselineQualityPressureEma,
    ),
    pendingBaselineAverageUtilizationRatioEma: clampRatio(
      row.pendingBaselineAverageUtilizationRatioEma,
      defaults.pendingBaselineAverageUtilizationRatioEma,
    ),
    pendingBaselineAutoLimitTriggeredRateEma: clampRatio(
      row.pendingBaselineAutoLimitTriggeredRateEma,
      defaults.pendingBaselineAutoLimitTriggeredRateEma,
    ),
    pendingBaselineSnapshotSemanticCompressRateEma: clampRatio(
      row.pendingBaselineSnapshotSemanticCompressRateEma,
      defaults.pendingBaselineSnapshotSemanticCompressRateEma,
    ),
    pendingBaselineHardBudgetFollowupDeltaEma: clampSigned(
      row.pendingBaselineHardBudgetFollowupDeltaEma,
      defaults.pendingBaselineHardBudgetFollowupDeltaEma,
      -1,
      1,
    ),
    pendingBaselineQualityFirstFollowupDeltaEma: clampSigned(
      row.pendingBaselineQualityFirstFollowupDeltaEma,
      defaults.pendingBaselineQualityFirstFollowupDeltaEma,
      -1,
      1,
    ),
    pendingBaselineQualityFirstImprovedRateEma: clampRatio(
      row.pendingBaselineQualityFirstImprovedRateEma,
      defaults.pendingBaselineQualityFirstImprovedRateEma,
    ),
    outcomeConfidenceEma: clampRatio(
      row.outcomeConfidenceEma,
      defaults.outcomeConfidenceEma,
    ),
    lastOutcomeGain: clampSigned(
      row.lastOutcomeGain,
      defaults.lastOutcomeGain,
      -1,
      1,
    ),
    outcomeRollbackCount: clampNonNegativeInt(row.outcomeRollbackCount),
    outcomeNegativeStreak: clampToIntRange(
      Number(row.outcomeNegativeStreak),
      0,
      32,
    ),
    lastReason: reason,
    updatedAt:
      typeof row.updatedAt === "string" && row.updatedAt.trim().length > 0
        ? row.updatedAt
        : null,
  };
}
