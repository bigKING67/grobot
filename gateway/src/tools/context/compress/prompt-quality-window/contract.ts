import { type PromptCompactionStage } from "../../types";

export type PromptPreSendStrategy = "quality_first" | "hard_budget";

export interface PromptQualityScores {
  coverage: number;
  recency: number;
  size: number;
  overall: number;
}

export interface PromptQualitySignals {
  recentRows: number;
  snapshotSections: number;
  recentTrimRows: number;
  snapshotTrimSections: number;
  snapshotSemanticCompressSections: number;
  headTrimRetries: number;
  autoLimitTriggered: boolean;
  downshiftGuardTriggered: boolean;
  preSendStrategy: PromptPreSendStrategy;
  preSendOverflowRatio: number;
  preSendPressureScore: number;
}

export interface PromptQualitySignalAverages {
  recentRows: number;
  snapshotSections: number;
  recentTrimRows: number;
  snapshotTrimSections: number;
  snapshotSemanticCompressSections: number;
  headTrimRetries: number;
  preSendOverflowRatio: number;
  preSendPressureScore: number;
}

export interface PromptQualityCompressionActivity {
  recentTrimRate: number | null;
  snapshotTrimRate: number | null;
  snapshotSemanticCompressRate: number | null;
  headTrimRate: number | null;
  autoLimitTriggeredRate: number | null;
  downshiftGuardTriggeredRate: number | null;
}

export interface PromptQualityStrategyActivity {
  qualityFirstRate: number | null;
  hardBudgetRate: number | null;
}

export interface PromptQualityTokenBudgetSummary {
  averageEstimatedTokens: number | null;
  averageTargetTokenLimit: number | null;
  averageUtilizationRatio: number | null;
}

export interface PromptQualityPressureTrendWindow {
  windowSize: number;
  entries: number;
  snapshotSemanticCompressRate: number | null;
  autoLimitTriggeredRate: number | null;
  averageUtilizationRatio: number | null;
}

export interface PromptQualityStrategyTrendWindow {
  windowSize: number;
  entries: number;
  hardBudgetRate: number | null;
  averageOverflowRatio: number | null;
  averagePressureScore: number | null;
}

export interface PromptQualityStrategyTrends {
  short: PromptQualityStrategyTrendWindow;
  medium: PromptQualityStrategyTrendWindow;
  delta: {
    hardBudgetRate: number | null;
    averageOverflowRatio: number | null;
    averagePressureScore: number | null;
  };
}

export interface PromptQualityStrategyOutcomes {
  hardBudgetFollowupOverallDelta: number | null;
  qualityFirstFollowupOverallDelta: number | null;
  hardBudgetRecoveryRate: number | null;
  qualityFirstImprovedRate: number | null;
  hardBudgetTransitions: number;
  qualityFirstTransitions: number;
}

export interface PromptQualityPressureTrends {
  short: PromptQualityPressureTrendWindow;
  medium: PromptQualityPressureTrendWindow;
  delta: {
    snapshotSemanticCompressRate: number | null;
    autoLimitTriggeredRate: number | null;
    averageUtilizationRatio: number | null;
  };
}

export interface PromptQualityWindowEntry {
  ts: string;
  sessionKey: string;
  stage: PromptCompactionStage;
  selectionReason: string;
  estimatedTokens: number;
  targetTokenLimit: number;
  scores: PromptQualityScores;
  signals: PromptQualitySignals;
}

export interface PromptQualityWindowSummary {
  path: string;
  configuredSize: number;
  entries: number;
  fromTs: string | null;
  toTs: string | null;
  averageScores: PromptQualityScores | null;
  latestScores: PromptQualityScores | null;
  lowQualityCount: number;
  lowQualityRate: number | null;
  lowQualityThreshold: number;
  stageCounts: Record<PromptCompactionStage, number>;
  signalAverages: PromptQualitySignalAverages | null;
  compressionActivity: PromptQualityCompressionActivity;
  strategyActivity: PromptQualityStrategyActivity;
  tokenBudget: PromptQualityTokenBudgetSummary;
  strategyTrends: PromptQualityStrategyTrends;
  strategyOutcomes: PromptQualityStrategyOutcomes;
  pressureTrends: PromptQualityPressureTrends;
}

export interface PromptQualityWindowDegradation {
  degraded: boolean;
  reason: string;
  thresholdOverall: number;
  thresholdLowQualityRate: number;
  minEntries: number;
  observedEntries: number;
  observedOverall: number | null;
  observedLowQualityRate: number | null;
}
