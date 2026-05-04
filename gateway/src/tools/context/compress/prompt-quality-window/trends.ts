import type {
  PromptQualityPressureTrendWindow,
  PromptQualityStrategyOutcomes,
  PromptQualityStrategyTrendWindow,
  PromptQualityWindowEntry,
} from "./contract";
import { roundRatio, roundScore } from "./scoring";

export function computeStrategyTrendWindow(args: {
  entries: PromptQualityWindowEntry[];
  windowSize: number;
}): PromptQualityStrategyTrendWindow {
  const resolvedWindowSize = Math.max(1, Math.floor(args.windowSize));
  const selected = args.entries.slice(-resolvedWindowSize);
  const count = selected.length;
  if (count === 0) {
    return {
      windowSize: resolvedWindowSize,
      entries: 0,
      hardBudgetRate: null,
      averageOverflowRatio: null,
      averagePressureScore: null,
    };
  }
  let hardBudgetCount = 0;
  let totalOverflowRatio = 0;
  let totalPressureScore = 0;
  for (const entry of selected) {
    if (entry.signals.preSendStrategy === "hard_budget") {
      hardBudgetCount += 1;
    }
    totalOverflowRatio += entry.signals.preSendOverflowRatio;
    totalPressureScore += entry.signals.preSendPressureScore;
  }
  return {
    windowSize: resolvedWindowSize,
    entries: count,
    hardBudgetRate: roundScore(hardBudgetCount / count),
    averageOverflowRatio: roundRatio(totalOverflowRatio / count),
    averagePressureScore: roundScore(totalPressureScore / count),
  };
}

export function computePressureTrendWindow(args: {
  entries: PromptQualityWindowEntry[];
  windowSize: number;
}): PromptQualityPressureTrendWindow {
  const resolvedWindowSize = Math.max(1, Math.floor(args.windowSize));
  const selected = args.entries.slice(-resolvedWindowSize);
  const count = selected.length;
  if (count === 0) {
    return {
      windowSize: resolvedWindowSize,
      entries: 0,
      snapshotSemanticCompressRate: null,
      autoLimitTriggeredRate: null,
      averageUtilizationRatio: null,
    };
  }
  let semanticTriggeredCount = 0;
  let autoLimitTriggeredCount = 0;
  let totalUtilizationRatio = 0;
  for (const entry of selected) {
    if (entry.signals.snapshotSemanticCompressSections > 0) {
      semanticTriggeredCount += 1;
    }
    if (entry.signals.autoLimitTriggered) {
      autoLimitTriggeredCount += 1;
    }
    totalUtilizationRatio += entry.estimatedTokens / Math.max(1, entry.targetTokenLimit);
  }
  return {
    windowSize: resolvedWindowSize,
    entries: count,
    snapshotSemanticCompressRate: roundScore(semanticTriggeredCount / count),
    autoLimitTriggeredRate: roundScore(autoLimitTriggeredCount / count),
    averageUtilizationRatio: roundRatio(totalUtilizationRatio / count),
  };
}

export function derivePressureTrendDelta(shortValue: number | null, mediumValue: number | null): number | null {
  if (typeof shortValue !== "number" || typeof mediumValue !== "number") {
    return null;
  }
  return roundRatio(shortValue - mediumValue);
}

export function computeStrategyOutcomes(args: {
  entries: PromptQualityWindowEntry[];
  lowQualityThreshold: number;
}): PromptQualityStrategyOutcomes {
  let hardBudgetTransitions = 0;
  let hardBudgetDeltaTotal = 0;
  let hardBudgetRecoveredCount = 0;
  let qualityFirstTransitions = 0;
  let qualityFirstDeltaTotal = 0;
  let qualityFirstImprovedCount = 0;
  for (let index = 0; index < args.entries.length - 1; index += 1) {
    const current = args.entries[index];
    const next = args.entries[index + 1];
    if (!current || !next) {
      continue;
    }
    const followupDelta = next.scores.overall - current.scores.overall;
    if (current.signals.preSendStrategy === "hard_budget") {
      hardBudgetTransitions += 1;
      hardBudgetDeltaTotal += followupDelta;
      if (next.scores.overall >= args.lowQualityThreshold) {
        hardBudgetRecoveredCount += 1;
      }
      continue;
    }
    qualityFirstTransitions += 1;
    qualityFirstDeltaTotal += followupDelta;
    if (followupDelta >= 0) {
      qualityFirstImprovedCount += 1;
    }
  }
  return {
    hardBudgetFollowupOverallDelta: hardBudgetTransitions > 0
      ? roundRatio(hardBudgetDeltaTotal / hardBudgetTransitions)
      : null,
    qualityFirstFollowupOverallDelta: qualityFirstTransitions > 0
      ? roundRatio(qualityFirstDeltaTotal / qualityFirstTransitions)
      : null,
    hardBudgetRecoveryRate: hardBudgetTransitions > 0
      ? roundScore(hardBudgetRecoveredCount / hardBudgetTransitions)
      : null,
    qualityFirstImprovedRate: qualityFirstTransitions > 0
      ? roundScore(qualityFirstImprovedCount / qualityFirstTransitions)
      : null,
    hardBudgetTransitions,
    qualityFirstTransitions,
  };
}
