import {
  DEFAULT_LOW_QUALITY_THRESHOLD,
  MEDIUM_PRESSURE_WINDOW,
  MEDIUM_STRATEGY_WINDOW,
  SHORT_PRESSURE_WINDOW,
  SHORT_STRATEGY_WINDOW,
} from "./constants";
import type { PromptQualityWindowSummary } from "./contract";
import { buildStageCounts } from "./normalize";
import { clamp01, normalizeWindowSize, roundRatio, roundScore } from "./scoring";
import { readWindowEntries, resolveWindowPath } from "./storage";
import {
  computePressureTrendWindow,
  computeStrategyOutcomes,
  computeStrategyTrendWindow,
  derivePressureTrendDelta,
} from "./trends";

export function readPromptQualityWindowSummary(input: {
  workDir: string;
  size?: number;
  lowQualityThreshold?: number;
}): PromptQualityWindowSummary {
  const configuredSize = normalizeWindowSize(input.size, 20);
  const path = resolveWindowPath(input.workDir);
  const lowQualityThreshold = clamp01(
    typeof input.lowQualityThreshold === "number"
      ? input.lowQualityThreshold
      : DEFAULT_LOW_QUALITY_THRESHOLD,
  );
  const entries = readWindowEntries(path).slice(-configuredSize);
  const stageCounts = buildStageCounts();
  let totalCoverage = 0;
  let totalRecency = 0;
  let totalSize = 0;
  let totalOverall = 0;
  let lowQualityCount = 0;
  let totalRecentRows = 0;
  let totalSnapshotSections = 0;
  let totalRecentTrimRows = 0;
  let totalSnapshotTrimSections = 0;
  let totalSnapshotSemanticCompressSections = 0;
  let totalHeadTrimRetries = 0;
  let totalPreSendOverflowRatio = 0;
  let totalPreSendPressureScore = 0;
  let recentTrimTriggeredCount = 0;
  let snapshotTrimTriggeredCount = 0;
  let snapshotSemanticCompressTriggeredCount = 0;
  let headTrimTriggeredCount = 0;
  let autoLimitTriggeredCount = 0;
  let downshiftGuardTriggeredCount = 0;
  let qualityFirstStrategyCount = 0;
  let hardBudgetStrategyCount = 0;
  let totalEstimatedTokens = 0;
  let totalTargetTokenLimit = 0;
  let totalUtilizationRatio = 0;
  for (const entry of entries) {
    stageCounts[entry.stage] += 1;
    totalCoverage += entry.scores.coverage;
    totalRecency += entry.scores.recency;
    totalSize += entry.scores.size;
    totalOverall += entry.scores.overall;
    totalRecentRows += entry.signals.recentRows;
    totalSnapshotSections += entry.signals.snapshotSections;
    totalRecentTrimRows += entry.signals.recentTrimRows;
    totalSnapshotTrimSections += entry.signals.snapshotTrimSections;
    totalSnapshotSemanticCompressSections += entry.signals.snapshotSemanticCompressSections;
    totalHeadTrimRetries += entry.signals.headTrimRetries;
    totalPreSendOverflowRatio += entry.signals.preSendOverflowRatio;
    totalPreSendPressureScore += entry.signals.preSendPressureScore;
    totalEstimatedTokens += entry.estimatedTokens;
    totalTargetTokenLimit += entry.targetTokenLimit;
    totalUtilizationRatio += entry.estimatedTokens / Math.max(1, entry.targetTokenLimit);
    if (entry.signals.preSendStrategy === "hard_budget") {
      hardBudgetStrategyCount += 1;
    } else {
      qualityFirstStrategyCount += 1;
    }
    if (entry.signals.recentTrimRows > 0) {
      recentTrimTriggeredCount += 1;
    }
    if (entry.signals.snapshotTrimSections > 0) {
      snapshotTrimTriggeredCount += 1;
    }
    if (entry.signals.snapshotSemanticCompressSections > 0) {
      snapshotSemanticCompressTriggeredCount += 1;
    }
    if (entry.signals.headTrimRetries > 0) {
      headTrimTriggeredCount += 1;
    }
    if (entry.signals.autoLimitTriggered) {
      autoLimitTriggeredCount += 1;
    }
    if (entry.signals.downshiftGuardTriggered) {
      downshiftGuardTriggeredCount += 1;
    }
    if (entry.scores.overall < lowQualityThreshold) {
      lowQualityCount += 1;
    }
  }
  const count = entries.length;
  const averageScores = count > 0
    ? {
      coverage: roundScore(totalCoverage / count),
      recency: roundScore(totalRecency / count),
      size: roundScore(totalSize / count),
      overall: roundScore(totalOverall / count),
    }
    : null;
  const signalAverages = count > 0
    ? {
      recentRows: roundRatio(totalRecentRows / count),
      snapshotSections: roundRatio(totalSnapshotSections / count),
      recentTrimRows: roundRatio(totalRecentTrimRows / count),
      snapshotTrimSections: roundRatio(totalSnapshotTrimSections / count),
      snapshotSemanticCompressSections: roundRatio(totalSnapshotSemanticCompressSections / count),
      headTrimRetries: roundRatio(totalHeadTrimRetries / count),
      preSendOverflowRatio: roundRatio(totalPreSendOverflowRatio / count),
      preSendPressureScore: roundScore(totalPreSendPressureScore / count),
    }
    : null;
  const latest = entries[count - 1] ?? null;
  const shortStrategyTrend = computeStrategyTrendWindow({
    entries,
    windowSize: SHORT_STRATEGY_WINDOW,
  });
  const mediumStrategyTrend = computeStrategyTrendWindow({
    entries,
    windowSize: MEDIUM_STRATEGY_WINDOW,
  });
  const shortPressureTrend = computePressureTrendWindow({
    entries,
    windowSize: SHORT_PRESSURE_WINDOW,
  });
  const mediumPressureTrend = computePressureTrendWindow({
    entries,
    windowSize: MEDIUM_PRESSURE_WINDOW,
  });
  const strategyOutcomes = computeStrategyOutcomes({
    entries,
    lowQualityThreshold,
  });
  return {
    path,
    configuredSize,
    entries: count,
    fromTs: entries[0]?.ts ?? null,
    toTs: latest?.ts ?? null,
    averageScores,
    latestScores: latest?.scores ?? null,
    lowQualityCount,
    lowQualityRate: count > 0 ? roundScore(lowQualityCount / count) : null,
    lowQualityThreshold,
    stageCounts,
    signalAverages,
    compressionActivity: {
      recentTrimRate: count > 0 ? roundScore(recentTrimTriggeredCount / count) : null,
      snapshotTrimRate: count > 0 ? roundScore(snapshotTrimTriggeredCount / count) : null,
      snapshotSemanticCompressRate:
        count > 0 ? roundScore(snapshotSemanticCompressTriggeredCount / count) : null,
      headTrimRate: count > 0 ? roundScore(headTrimTriggeredCount / count) : null,
      autoLimitTriggeredRate: count > 0 ? roundScore(autoLimitTriggeredCount / count) : null,
      downshiftGuardTriggeredRate: count > 0 ? roundScore(downshiftGuardTriggeredCount / count) : null,
    },
    strategyActivity: {
      qualityFirstRate: count > 0 ? roundScore(qualityFirstStrategyCount / count) : null,
      hardBudgetRate: count > 0 ? roundScore(hardBudgetStrategyCount / count) : null,
    },
    tokenBudget: {
      averageEstimatedTokens: count > 0 ? Math.round(totalEstimatedTokens / count) : null,
      averageTargetTokenLimit: count > 0 ? Math.round(totalTargetTokenLimit / count) : null,
      averageUtilizationRatio: count > 0 ? roundRatio(totalUtilizationRatio / count) : null,
    },
    strategyTrends: {
      short: shortStrategyTrend,
      medium: mediumStrategyTrend,
      delta: {
        hardBudgetRate: derivePressureTrendDelta(
          shortStrategyTrend.hardBudgetRate,
          mediumStrategyTrend.hardBudgetRate,
        ),
        averageOverflowRatio: derivePressureTrendDelta(
          shortStrategyTrend.averageOverflowRatio,
          mediumStrategyTrend.averageOverflowRatio,
        ),
        averagePressureScore: derivePressureTrendDelta(
          shortStrategyTrend.averagePressureScore,
          mediumStrategyTrend.averagePressureScore,
        ),
      },
    },
    strategyOutcomes,
    pressureTrends: {
      short: shortPressureTrend,
      medium: mediumPressureTrend,
      delta: {
        snapshotSemanticCompressRate: derivePressureTrendDelta(
          shortPressureTrend.snapshotSemanticCompressRate,
          mediumPressureTrend.snapshotSemanticCompressRate,
        ),
        autoLimitTriggeredRate: derivePressureTrendDelta(
          shortPressureTrend.autoLimitTriggeredRate,
          mediumPressureTrend.autoLimitTriggeredRate,
        ),
        averageUtilizationRatio: derivePressureTrendDelta(
          shortPressureTrend.averageUtilizationRatio,
          mediumPressureTrend.averageUtilizationRatio,
        ),
      },
    },
  };
}
