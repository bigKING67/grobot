import { clampRatio } from "./clamp";
import type { MemoryStrategyAutotuneQualitySnapshot } from "./contract";

export function deriveOutcomeEvidenceStrength(input: {
  quality?: MemoryStrategyAutotuneQualitySnapshot;
  pressureTrendUpCount: number;
  pressureTrendMomentum: number;
}): number {
  const quality = input.quality;
  if (!quality) {
    return 0;
  }
  let signals = 0;
  let total = 0;
  const ratioCandidates = [
    quality.shortAverageUtilizationRatio,
    quality.mediumAverageUtilizationRatio,
    quality.shortAutoLimitTriggeredRate,
    quality.mediumAutoLimitTriggeredRate,
    quality.shortSnapshotSemanticCompressRate,
    quality.mediumSnapshotSemanticCompressRate,
    quality.deltaAverageUtilizationRatio,
    quality.deltaAutoLimitTriggeredRate,
    quality.deltaSnapshotSemanticCompressRate,
    quality.hardBudgetFollowupOverallDelta,
    quality.qualityFirstFollowupOverallDelta,
  ];
  for (const value of ratioCandidates) {
    total += 1;
    if (typeof value === "number" && Number.isFinite(value)) {
      signals += 1;
    }
  }
  if (input.pressureTrendUpCount > 0) {
    signals += 1;
  }
  total += 1;
  if (input.pressureTrendMomentum >= 0.08) {
    signals += 1;
  }
  total += 1;
  return total > 0 ? clampRatio(signals / total, 0, 0, 1) : 0;
}
