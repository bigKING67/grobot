import {
  type GraphCacheWindowDegradation,
  type GraphQualityAutotuneState,
  type GraphQualitySignalsSummary,
  type PersistentGraphWindowDegradation,
  readGraphCacheWindowSummary,
  readPromptQualityWindowSummary,
} from "../../../../tools/context";
import { GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE } from "./constants";
import {
  blendThreshold,
  clampNumber,
  clampRatio,
  normalizeOptionalCenteredRatio,
  normalizeOptionalRatio,
} from "./math";
import { type GraphAdaptiveActionProfile } from "./types";

export function deriveAdaptiveGraphActionProfile(input: {
  state: GraphQualityAutotuneState;
  graphWindowSummary: ReturnType<typeof readGraphCacheWindowSummary>;
  graphWindowDegradation: GraphCacheWindowDegradation;
  persistentWindowDegradation: PersistentGraphWindowDegradation;
  graphQualitySignals: GraphQualitySignalsSummary;
  promptQualityWindowSummary: ReturnType<typeof readPromptQualityWindowSummary>;
  minEvidenceEntries: number;
}): GraphAdaptiveActionProfile {
  const previousScale = clampRatio(
    input.state.adaptiveActionScale,
    0.5,
    2.5,
    GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  );
  const evidenceEntries = input.graphWindowSummary.entries;
  const evidenceQualityEntries = input.graphWindowSummary.quality.entriesWithQuality;
  if (evidenceEntries < input.minEvidenceEntries || evidenceQualityEntries < input.minEvidenceEntries) {
    return {
      scale: previousScale,
      source: "state_reuse",
      updated: false,
      updates: input.state.adaptiveActionUpdates,
    };
  }

  const dependencyDepth = input.graphWindowSummary.quality.dependency.avgMaxChainDepth;
  const dependencyMultiHop = input.graphWindowSummary.quality.dependency.multiHopRate;
  const symbolBridge = input.graphWindowSummary.quality.symbol.bridgeCoverageRate;
  const symbolBreadth = input.graphWindowSummary.quality.symbol.breadthCoverageRate;
  const pressureUtilization = input.promptQualityWindowSummary.tokenBudget.averageUtilizationRatio;
  const pressureAutoLimitRate = input.promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate;
  const pressureSemanticRate =
    input.promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate;
  const preSendOverflowRatio = input.promptQualityWindowSummary.signalAverages?.preSendOverflowRatio ?? null;
  const strategyOutcomes = input.promptQualityWindowSummary.strategyOutcomes;
  const hardBudgetRecoveryRate = strategyOutcomes.hardBudgetRecoveryRate;
  const qualityFirstImprovedRate = strategyOutcomes.qualityFirstImprovedRate;
  const hardBudgetFollowupDelta = strategyOutcomes.hardBudgetFollowupOverallDelta;
  const qualityFirstFollowupDelta = strategyOutcomes.qualityFirstFollowupOverallDelta;
  const strategyTransitionCount =
    (strategyOutcomes.hardBudgetTransitions ?? 0) + (strategyOutcomes.qualityFirstTransitions ?? 0);

  const dependencyScore = clampRatio(
    normalizeOptionalRatio(
      typeof dependencyDepth === "number"
        ? dependencyDepth / 4
        : null,
      0.5,
    ) * 0.45
    + normalizeOptionalRatio(dependencyMultiHop, 0.5) * 0.55,
    0,
    1,
    0.5,
  );
  const symbolScore = clampRatio(
    normalizeOptionalRatio(symbolBridge, 0.5) * 0.5
    + normalizeOptionalRatio(symbolBreadth, 0.5) * 0.5,
    0,
    1,
    0.5,
  );
  const qualityScore = clampRatio(dependencyScore * 0.55 + symbolScore * 0.45, 0, 1, 0.5);

  const utilizationPressure = normalizeOptionalRatio(
    typeof pressureUtilization === "number"
      ? (pressureUtilization - 0.62) / 0.34
      : null,
    0.5,
  );
  const pressureScore = clampRatio(
    utilizationPressure * 0.55
    + normalizeOptionalRatio(pressureAutoLimitRate, 0.35) * 0.25
    + normalizeOptionalRatio(pressureSemanticRate, 0.3) * 0.15
    + normalizeOptionalRatio(preSendOverflowRatio, 0.3) * 0.05,
    0,
    1,
    0.5,
  );
  const rewardBaseScore = clampRatio(
    normalizeOptionalRatio(input.promptQualityWindowSummary.averageScores?.overall ?? null, 0.5) * 0.4
    + (1 - normalizeOptionalRatio(input.promptQualityWindowSummary.lowQualityRate, 0.5)) * 0.24
    + normalizeOptionalRatio(hardBudgetRecoveryRate, 0.5) * 0.18
    + normalizeOptionalRatio(qualityFirstImprovedRate, 0.5) * 0.18,
    0,
    1,
    0.5,
  );
  const rewardTrendScore = clampRatio(
    normalizeOptionalCenteredRatio(hardBudgetFollowupDelta, 0, 0.2, 0.5) * 0.5
    + normalizeOptionalCenteredRatio(qualityFirstFollowupDelta, 0, 0.2, 0.5) * 0.5,
    0,
    1,
    0.5,
  );
  const rewardScore = clampRatio(rewardBaseScore * 0.72 + rewardTrendScore * 0.28, 0, 1, 0.5);
  const rewardReliability = clampRatio(0.25 + (strategyTransitionCount / 12) * 0.75, 0.25, 1, 0.25);

  let targetScale = GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE;
  if (input.graphQualitySignals.state === "degraded") {
    targetScale += 0.28;
  } else if (input.graphQualitySignals.state === "watch") {
    targetScale += 0.12;
  }
  if (input.graphWindowDegradation.degraded) {
    targetScale += 0.16;
  }
  if (input.persistentWindowDegradation.degraded) {
    targetScale -= 0.22;
  }
  if (qualityScore <= 0.42 && pressureScore <= 0.72) {
    targetScale += 0.12;
  }
  if (qualityScore >= 0.78 && pressureScore <= 0.55) {
    targetScale -= 0.08;
  }
  if (pressureScore >= 0.78) {
    targetScale -= (pressureScore - 0.78) * 0.9;
  }
  if (rewardReliability >= 0.45) {
    if (rewardScore <= 0.42) {
      targetScale += (0.42 - rewardScore) * 0.35;
    } else if (rewardScore >= 0.72) {
      targetScale -= (rewardScore - 0.72) * 0.28;
    }
  }
  if (rewardReliability >= 0.55) {
    if (rewardTrendScore <= 0.38) {
      targetScale += 0.08;
    } else if (rewardTrendScore >= 0.66 && pressureScore >= 0.7) {
      targetScale -= 0.06;
    }
  }
  targetScale = clampRatio(targetScale, 0.5, 2.5, GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE);

  const evidenceScore = clampRatio(
    (evidenceEntries + evidenceQualityEntries) / Math.max(24, input.minEvidenceEntries * 6),
    0,
    1,
  );
  const divergence = clampRatio(Math.abs(targetScale - previousScale), 0, 1.5) / 1.5;
  const learnAlpha = clampRatio(
    0.09 + evidenceScore * 0.17 + divergence * 0.11 - pressureScore * 0.07 + rewardReliability * 0.05,
    0.06,
    0.3,
    0.14,
  );
  const rawNextScale = clampRatio(
    blendThreshold(previousScale, targetScale, learnAlpha),
    0.5,
    2.5,
    GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  );
  const maxDelta = clampNumber(
    0.09 + evidenceScore * 0.14 + rewardReliability * 0.07 - pressureScore * 0.05,
    0.08,
    0.28,
    0.14,
  );
  const boundedDelta = clampNumber(rawNextScale - previousScale, -maxDelta, maxDelta, 0);
  const nextScale = clampRatio(
    previousScale + boundedDelta,
    0.5,
    2.5,
    GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  );
  const updated = Math.abs(nextScale - previousScale) >= 0.01;
  const boundedByGuard = Math.abs(rawNextScale - nextScale) >= 0.01;
  return {
    scale: nextScale,
    source: updated
      ? (boundedByGuard ? "adaptive_action_ewma_guarded" : "adaptive_action_ewma")
      : "state_reuse",
    updated,
    updates: updated ? input.state.adaptiveActionUpdates + 1 : input.state.adaptiveActionUpdates,
  };
}
