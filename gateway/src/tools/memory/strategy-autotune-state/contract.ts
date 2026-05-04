export type MemoryStrategyAutotuneActionDirection = "tighten" | "relax" | "neutral";
export type MemoryStrategyAutotuneProfile = "general" | "debug_heavy" | "delivery" | "docs";

export const MEMORY_STRATEGY_AUTOTUNE_STATE_VERSION = 2;

export interface MemoryStrategyAutotuneState {
  schemaVersion: number;
  profile: MemoryStrategyAutotuneProfile;
  injectBudgetRatio: number;
  maxSectionTokens: number;
  maxGaMemoryRows: number;
  maxTeamExperienceRows: number;
  minTeamExperienceScore: number;
  adaptiveLearnAlpha: number;
  adaptiveUpdates: number;
  qualityLowRateEma: number;
  qualityPressureEma: number;
  averageUtilizationRatioEma: number;
  autoLimitTriggeredRateEma: number;
  snapshotSemanticCompressRateEma: number;
  hardBudgetRateEma: number;
  qualityFirstImprovedRateEma: number;
  hardBudgetFollowupDeltaEma: number;
  qualityFirstFollowupDeltaEma: number;
  lastActionDirection: MemoryStrategyAutotuneActionDirection;
  cooldownTurnsRemaining: number;
  tightenSignalStreak: number;
  relaxSignalStreak: number;
  adaptiveActionScale: number;
  pendingEvaluationDirection: MemoryStrategyAutotuneActionDirection;
  pendingEvaluationWarmupTurns: number;
  pendingBaselineInjectBudgetRatio: number;
  pendingBaselineMaxSectionTokens: number;
  pendingBaselineMaxGaMemoryRows: number;
  pendingBaselineMaxTeamExperienceRows: number;
  pendingBaselineMinTeamExperienceScore: number;
  pendingBaselineQualityLowRateEma: number;
  pendingBaselineQualityPressureEma: number;
  pendingBaselineAverageUtilizationRatioEma: number;
  pendingBaselineAutoLimitTriggeredRateEma: number;
  pendingBaselineSnapshotSemanticCompressRateEma: number;
  pendingBaselineHardBudgetFollowupDeltaEma: number;
  pendingBaselineQualityFirstFollowupDeltaEma: number;
  pendingBaselineQualityFirstImprovedRateEma: number;
  outcomeConfidenceEma: number;
  lastOutcomeGain: number;
  outcomeRollbackCount: number;
  outcomeNegativeStreak: number;
  lastReason: string;
  updatedAt: string | null;
}

export interface MemoryStrategyAutotuneQualitySnapshot {
  lowQualityRate?: number | null;
  averagePreSendPressureScore?: number | null;
  hardBudgetFollowupOverallDelta?: number | null;
  qualityFirstFollowupOverallDelta?: number | null;
  hardBudgetRate?: number | null;
  qualityFirstImprovedRate?: number | null;
  averageUtilizationRatio?: number | null;
  autoLimitTriggeredRate?: number | null;
  snapshotSemanticCompressRate?: number | null;
  shortAverageUtilizationRatio?: number | null;
  mediumAverageUtilizationRatio?: number | null;
  deltaAverageUtilizationRatio?: number | null;
  shortAutoLimitTriggeredRate?: number | null;
  mediumAutoLimitTriggeredRate?: number | null;
  deltaAutoLimitTriggeredRate?: number | null;
  shortSnapshotSemanticCompressRate?: number | null;
  mediumSnapshotSemanticCompressRate?: number | null;
  deltaSnapshotSemanticCompressRate?: number | null;
}

export interface MemoryStrategyAutotuneUpdateResult {
  state: MemoryStrategyAutotuneState;
  changed: boolean;
  reason: string;
}
