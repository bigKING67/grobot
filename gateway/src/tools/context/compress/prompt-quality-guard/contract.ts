import { type PromptCompactionStage } from "../../types";

export interface PromptQualityGuardPolicy {
  enabled: boolean;
  promoteStreak: number;
  severePromoteStreak: number;
  releaseStreak: number;
  holdTurns: number;
  maxFloorStage: PromptCompactionStage;
  severeOverallThreshold: number;
  severeLowQualityRateThreshold: number;
}

export interface PromptQualityGuardState {
  floorStage: PromptCompactionStage;
  degradedStreak: number;
  severeStreak: number;
  healthyStreak: number;
  holdTurnsRemaining: number;
  lastReason: string;
  updatedAt: string | null;
  pressureUtilizationThreshold: number;
  pressureSemanticRateThreshold: number;
  pressureAutoLimitRateThreshold: number;
  pressureJointRateThreshold: number;
  pressureTrendUtilizationDelta: number;
  pressureTrendSemanticDelta: number;
  pressureTrendAutoLimitDelta: number;
  pressureTrendMomentum: number;
  outcomeRequiredTransitions: number;
  outcomeCombinedEvidenceScore: number;
  outcomeHighEvidenceTurns: number;
  outcomeHighEvidenceHardenTurns: number;
  outcomeDriftRecentAutoActionLevels: PromptQualityGuardDriftAutoActionLevel[];
}

export interface PromptQualityGuardObservation {
  degraded: boolean;
  reason: string;
  observedOverall: number | null;
  observedLowQualityRate: number | null;
}

export interface PromptQualityGuardDecision {
  floorStage: PromptCompactionStage;
  triggered: boolean;
  promoted: boolean;
  released: boolean;
  severe: boolean;
  severeEscalated: boolean;
  state: PromptQualityGuardState;
}

export type PromptQualityGuardRuntimePhase =
  | "disabled"
  | "idle"
  | "escalating"
  | "holding"
  | "recovering";

export type PromptQualityGuardRuntimeTransition = "none" | "promote" | "hold" | "release";

export interface PromptQualityGuardRuntimeAssessment {
  enabled: boolean;
  phase: PromptQualityGuardRuntimePhase;
  transition: PromptQualityGuardRuntimeTransition;
  degraded: boolean;
  severe: boolean;
  reason: string;
  triggered: boolean;
  floorStage: PromptCompactionStage;
  proposedFloorStage: PromptCompactionStage;
  promoteRemaining: number;
  severePromoteRemaining: number;
  releaseRemaining: number;
  holdTurnsRemaining: number;
  observedOverall: number | null;
  observedLowQualityRate: number | null;
}

export type PromptQualityGuardAdaptiveMode = "disabled" | "stable" | "harden" | "relax";
export type PromptQualityGuardAdaptiveMutableMode = Exclude<
  PromptQualityGuardAdaptiveMode,
  "disabled" | "stable"
>;

export interface PromptQualityGuardAdaptiveInput {
  basePolicy: PromptQualityGuardPolicy;
  adaptiveEnabled: boolean;
  adaptiveModeAllowlist?: PromptQualityGuardAdaptiveMutableMode[];
  currentState: PromptQualityGuardState;
  window: {
    degraded: boolean;
    reason: string;
    lowQualityRate: number | null;
    averageOverall: number | null;
    observedOverall: number | null;
    observedLowQualityRate: number | null;
    snapshotSemanticCompressRate: number | null;
    autoLimitTriggeredRate: number | null;
    averageUtilizationRatio: number | null;
    shortSnapshotSemanticCompressRate?: number | null;
    mediumSnapshotSemanticCompressRate?: number | null;
    shortAutoLimitTriggeredRate?: number | null;
    mediumAutoLimitTriggeredRate?: number | null;
    shortAverageUtilizationRatio?: number | null;
    mediumAverageUtilizationRatio?: number | null;
    hardBudgetStrategyRate?: number | null;
    qualityFirstStrategyRate?: number | null;
    averagePreSendOverflowRatio?: number | null;
    averagePreSendPressureScore?: number | null;
    shortHardBudgetStrategyRate?: number | null;
    mediumHardBudgetStrategyRate?: number | null;
    shortAveragePreSendOverflowRatio?: number | null;
    mediumAveragePreSendOverflowRatio?: number | null;
    shortAveragePreSendPressureScore?: number | null;
    mediumAveragePreSendPressureScore?: number | null;
    hardBudgetFollowupOverallDelta?: number | null;
    qualityFirstFollowupOverallDelta?: number | null;
    hardBudgetRecoveryRate?: number | null;
    qualityFirstImprovedRate?: number | null;
    hardBudgetTransitionCount?: number | null;
    qualityFirstTransitionCount?: number | null;
  };
}

export interface PromptQualityGuardAdaptiveDecision {
  enabled: boolean;
  mode: PromptQualityGuardAdaptiveMode;
  reason: string;
  allowlist: PromptQualityGuardAdaptiveMutableMode[];
  modeBlocked: boolean;
  blockedMode: PromptQualityGuardAdaptiveMutableMode | null;
  basePolicy: PromptQualityGuardPolicy;
  effectivePolicy: PromptQualityGuardPolicy;
  adjustment: {
    promoteStreakDelta: number;
    severePromoteStreakDelta: number;
    releaseStreakDelta: number;
    holdTurnsDelta: number;
  };
  pressurePolicy: {
    source: "state" | "learned";
    updated: boolean;
    learnAlpha: number;
    utilizationThreshold: number;
    semanticRateThreshold: number;
    autoLimitRateThreshold: number;
    jointRateThreshold: number;
    trendUtilizationDelta: number;
    trendSemanticDelta: number;
    trendAutoLimitDelta: number;
    trendMomentum: number;
    trendFlipSuppressed: boolean;
  };
  outcomeReliability: {
    requiredTransitions: number;
    nextRequiredTransitions: number;
    hardBudgetTransitions: number;
    qualityFirstTransitions: number;
    hardBudgetEvidenceScore: number;
    qualityFirstEvidenceScore: number;
    combinedEvidenceScore: number;
    hardBudgetReliable: boolean;
    qualityFirstReliable: boolean;
  };
  outcomeDriftGuard: PromptQualityGuardOutcomeDriftGuard;
}

export interface PromptQualityGuardOutcomeDriftGuard {
  highEvidenceHardenBias: boolean;
  highEvidenceTurn: boolean;
  highEvidenceTurns: number;
  highEvidenceHardenTurns: number;
  highEvidenceHardenRate: number;
  thresholdHardenRate: number;
  minHighEvidenceTurns: number;
  autoActionLevel: PromptQualityGuardDriftAutoActionLevel;
  recentAutoActionLevels: PromptQualityGuardDriftAutoActionLevel[];
  windowSummary: PromptQualityGuardOutcomeDriftWindowSummary;
  reason: "ok" | "high_evidence_harden_bias";
  recommendation: "none" | "prefer_relax";
}

export type PromptQualityGuardDriftAutoActionLevel = "none" | "soft" | "medium" | "hard";
export type PromptQualityGuardDriftWindowAlertLevel = "green" | "yellow" | "red";

export interface PromptQualityGuardOutcomeDriftWindowSummary {
  windowSize: number;
  entries: number;
  latest: PromptQualityGuardDriftAutoActionLevel;
  dominant: PromptQualityGuardDriftAutoActionLevel;
  alertLevel: PromptQualityGuardDriftWindowAlertLevel;
  transitionCount: number;
  activeRate: number;
  mediumOrHardRate: number;
  hardRate: number;
  levelCounts: Record<PromptQualityGuardDriftAutoActionLevel, number>;
}
