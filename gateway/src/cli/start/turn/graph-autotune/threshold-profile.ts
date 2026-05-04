import {
  type GraphQualityAutotuneState,
  readGraphCacheWindowSummary,
} from "../../../../tools/context";
import { readPersistentGraphIndexStatus } from "../../../../tools/context/graph/persistent-index";
import {
  GRAPH_AUTOTUNE_DEFAULT_CACHE_DEGRADE_QUERY_HIT_RATE,
  GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_PARSED_PER_SCANNED_MAX,
  GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REMOVED_PER_SCANNED_MAX,
  GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REUSED_PER_SCANNED_MIN,
  GRAPH_AUTOTUNE_PERSISTENT_MIN_SCANNED_FILES,
} from "./constants";
import { blendThreshold, clampRatio } from "./math";
import { type GraphAdaptiveThresholdProfile } from "./types";

function resolveAdaptiveLearnAlpha(args: {
  evidenceEntries: number;
  persistentEntries: number;
  pressureUtilization: number | null;
  previousAlpha: number;
}): number {
  const evidenceScore = clampRatio((args.evidenceEntries + args.persistentEntries) / 48, 0, 1);
  const pressurePenalty = typeof args.pressureUtilization === "number"
    ? clampRatio((args.pressureUtilization - 0.72) / 0.3, 0, 1)
    : 0;
  const targetAlpha = 0.12 + evidenceScore * 0.2 - pressurePenalty * 0.07;
  const blended = args.previousAlpha * 0.55 + targetAlpha * 0.45;
  return clampRatio(blended, 0.06, 0.32);
}

export function deriveAdaptiveGraphThresholdProfile(input: {
  state: GraphQualityAutotuneState;
  graphWindowSummary: ReturnType<typeof readGraphCacheWindowSummary>;
  persistentStatus: ReturnType<typeof readPersistentGraphIndexStatus>;
  persistentSignalsActive: boolean;
  minEvidenceEntries: number;
  pressureUtilization: number | null;
}): GraphAdaptiveThresholdProfile {
  const previousCacheThreshold = clampRatio(
    input.state.cacheDegradeQueryHitRateThreshold,
    0.08,
    0.8,
    GRAPH_AUTOTUNE_DEFAULT_CACHE_DEGRADE_QUERY_HIT_RATE,
  );
  const previousParsedMax = clampRatio(
    input.state.persistentDegradeParsedPerScannedMax,
    0.1,
    0.9,
    GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_PARSED_PER_SCANNED_MAX,
  );
  const previousReusedMin = clampRatio(
    input.state.persistentDegradeReusedPerScannedMin,
    0.05,
    0.95,
    GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REUSED_PER_SCANNED_MIN,
  );
  const previousRemovedMax = clampRatio(
    input.state.persistentDegradeRemovedPerScannedMax,
    0.01,
    0.6,
    GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REMOVED_PER_SCANNED_MAX,
  );
  const previousAlpha = clampRatio(input.state.adaptiveLearnAlpha, 0.06, 0.32);
  const persistentWindow = input.persistentStatus.window;
  const persistentEntries = persistentWindow?.entries ?? 0;
  const learnAlpha = resolveAdaptiveLearnAlpha({
    evidenceEntries: input.graphWindowSummary.entries,
    persistentEntries,
    pressureUtilization: input.pressureUtilization,
    previousAlpha,
  });
  let cacheThreshold = previousCacheThreshold;
  let parsedMaxThreshold = previousParsedMax;
  let reusedMinThreshold = previousReusedMin;
  let removedMaxThreshold = previousRemovedMax;
  let updated = false;

  const observedCacheHitRate = input.graphWindowSummary.queryHitRate;
  if (
    typeof observedCacheHitRate === "number"
    && input.graphWindowSummary.entries >= input.minEvidenceEntries
  ) {
    const observedTarget = clampRatio(observedCacheHitRate - 0.06, 0.08, 0.8);
    cacheThreshold = clampRatio(
      blendThreshold(previousCacheThreshold, observedTarget, learnAlpha),
      0.08,
      0.8,
    );
    updated = true;
  }

  const observedParsedRate = persistentWindow?.rates?.parsed_per_scanned;
  const observedReusedRate = persistentWindow?.rates?.reused_per_scanned;
  const observedRemovedRate = persistentWindow?.rates?.removed_per_scanned;
  const hasPersistentEvidence =
    input.persistentSignalsActive
    && persistentEntries >= input.minEvidenceEntries
    && (persistentWindow?.totals?.scanned_files ?? 0) >= GRAPH_AUTOTUNE_PERSISTENT_MIN_SCANNED_FILES;
  if (
    hasPersistentEvidence
    && typeof observedParsedRate === "number"
    && typeof observedReusedRate === "number"
    && typeof observedRemovedRate === "number"
  ) {
    const parsedTarget = clampRatio(observedParsedRate + 0.05, 0.1, 0.9);
    const reusedTarget = clampRatio(observedReusedRate - 0.08, 0.05, 0.95);
    const removedTarget = clampRatio(observedRemovedRate + 0.04, 0.01, 0.6);
    parsedMaxThreshold = clampRatio(
      blendThreshold(previousParsedMax, parsedTarget, learnAlpha),
      0.1,
      0.9,
    );
    reusedMinThreshold = clampRatio(
      blendThreshold(previousReusedMin, reusedTarget, learnAlpha),
      0.05,
      0.95,
    );
    removedMaxThreshold = clampRatio(
      blendThreshold(previousRemovedMax, removedTarget, learnAlpha),
      0.01,
      0.6,
    );
    updated = true;
  }

  const updates = updated ? input.state.adaptiveUpdates + 1 : input.state.adaptiveUpdates;
  return {
    cacheQueryHitRateThreshold: cacheThreshold,
    persistentParsedPerScannedMaxThreshold: parsedMaxThreshold,
    persistentReusedPerScannedMinThreshold: reusedMinThreshold,
    persistentRemovedPerScannedMaxThreshold: removedMaxThreshold,
    learnAlpha,
    updated,
    source: updated ? "adaptive_ewma" : "state_reuse",
    updates,
  };
}
