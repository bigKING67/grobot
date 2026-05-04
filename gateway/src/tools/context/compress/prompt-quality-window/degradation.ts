import type {
  PromptQualityWindowDegradation,
  PromptQualityWindowSummary,
} from "./contract";
import { clamp01 } from "./scoring";

export function assessPromptQualityWindowDegradation(input: {
  summary: PromptQualityWindowSummary;
  thresholdOverall: number;
  thresholdLowQualityRate: number;
  minEntries: number;
}): PromptQualityWindowDegradation {
  const thresholdOverall = clamp01(input.thresholdOverall);
  const thresholdLowQualityRate = clamp01(input.thresholdLowQualityRate);
  const minEntries = Math.max(1, Math.floor(input.minEntries));
  if (input.summary.entries < minEntries) {
    return {
      degraded: false,
      reason: "insufficient_entries",
      thresholdOverall,
      thresholdLowQualityRate,
      minEntries,
      observedEntries: input.summary.entries,
      observedOverall: input.summary.averageScores?.overall ?? null,
      observedLowQualityRate: input.summary.lowQualityRate,
    };
  }
  const observedOverall = input.summary.averageScores?.overall ?? null;
  const observedLowQualityRate = input.summary.lowQualityRate;
  if (typeof observedOverall === "number" && observedOverall < thresholdOverall) {
    return {
      degraded: true,
      reason: "overall_below_threshold",
      thresholdOverall,
      thresholdLowQualityRate,
      minEntries,
      observedEntries: input.summary.entries,
      observedOverall,
      observedLowQualityRate,
    };
  }
  if (
    typeof observedLowQualityRate === "number"
    && observedLowQualityRate > thresholdLowQualityRate
  ) {
    return {
      degraded: true,
      reason: "low_quality_rate_above_threshold",
      thresholdOverall,
      thresholdLowQualityRate,
      minEntries,
      observedEntries: input.summary.entries,
      observedOverall,
      observedLowQualityRate,
    };
  }
  return {
    degraded: false,
    reason: "healthy",
    thresholdOverall,
    thresholdLowQualityRate,
    minEntries,
    observedEntries: input.summary.entries,
    observedOverall,
    observedLowQualityRate,
  };
}
