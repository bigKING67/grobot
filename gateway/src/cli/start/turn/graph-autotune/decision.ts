import {
  type ContextEngineConfig,
  type GraphCacheWindowDegradation,
  type GraphQualityAutotuneState,
  type GraphQualitySignalsSummary,
  type PersistentGraphWindowDegradation,
  readGraphCacheWindowSummary,
  readPromptQualityWindowSummary,
} from "../../../../tools/context";
import {
  GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  GRAPH_AUTOTUNE_DOWNSHIFT_WARMUP_TURNS,
  GRAPH_AUTOTUNE_FLIP_HOLD_TURNS,
} from "./constants";
import { clampGraphRows, scaleGraphDelta } from "./math";
import {
  type GraphAdaptiveActionProfile,
  type GraphAdaptiveThresholdProfile,
  type GraphQualityAutotuneDecision,
} from "./types";
import { nowIso } from "../time";

export function resolveGraphQualityAutotuneDecision(input: {
  baseConfig: ContextEngineConfig;
  allowProactiveCompaction: boolean;
  graphWindowSummary: ReturnType<typeof readGraphCacheWindowSummary>;
  graphWindowDegradation: GraphCacheWindowDegradation;
  persistentWindowDegradation: PersistentGraphWindowDegradation;
  graphQualitySignals: GraphQualitySignalsSummary;
  persistentSignalsActive: boolean;
  adaptiveThresholds: GraphAdaptiveThresholdProfile;
  adaptiveAction: GraphAdaptiveActionProfile;
  promptQualityWindowSummary: ReturnType<typeof readPromptQualityWindowSummary>;
  state: GraphQualityAutotuneState;
}): GraphQualityAutotuneDecision {
  const stateBefore: GraphQualityAutotuneState = {
    ...input.state,
  };
  let stateAfter: GraphQualityAutotuneState = {
    ...input.state,
  };
  const dependencyRowsFrom = clampGraphRows(input.baseConfig.dependencyGraph.maxRows);
  const symbolRowsFrom = clampGraphRows(input.baseConfig.symbolGraph.maxRows);
  const dependencyDepth = input.graphWindowSummary.quality.dependency.avgMaxChainDepth;
  const dependencyMultiHopRate = input.graphWindowSummary.quality.dependency.multiHopRate;
  const symbolBridgeCoverageRate = input.graphWindowSummary.quality.symbol.bridgeCoverageRate;
  const symbolBreadthCoverageRate = input.graphWindowSummary.quality.symbol.breadthCoverageRate;
  const pressureUtilization = input.promptQualityWindowSummary.tokenBudget.averageUtilizationRatio;
  const pressureAutoLimitRate = input.promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate;
  const pressureSemanticRate =
    input.promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate;
  const baseDecision: GraphQualityAutotuneDecision = {
    adjustedConfig: input.baseConfig,
    changed: false,
    action: "none",
    reason: "stable",
    suppressedBy: "none",
    dependencyRowsFrom,
    dependencyRowsTo: dependencyRowsFrom,
    symbolRowsFrom,
    symbolRowsTo: symbolRowsFrom,
    evidenceEntries: input.graphWindowSummary.entries,
    evidenceQualityEntries: input.graphWindowSummary.quality.entriesWithQuality,
    evidencePersistentEntries: input.persistentWindowDegradation.observedEntries,
    graphQualitySignals: input.graphQualitySignals,
    stateBefore,
    stateAfter,
    metrics: {
      dependencyDepth,
      dependencyMultiHopRate,
      symbolBridgeCoverageRate,
      symbolBreadthCoverageRate,
      pressureUtilization,
      pressureAutoLimitRate,
      pressureSemanticRate,
      graphCacheDegraded: input.graphWindowDegradation.degraded,
      graphCacheReason: input.graphWindowDegradation.reason,
      graphCacheQueryHitRate: input.graphWindowDegradation.observedQueryHitRate,
      persistentDegraded: input.persistentWindowDegradation.degraded,
      persistentReason: input.persistentWindowDegradation.reason,
      persistentParsedPerScanned: input.persistentWindowDegradation.observedParsedPerScanned,
      persistentReusedPerScanned: input.persistentWindowDegradation.observedReusedPerScanned,
      persistentRemovedPerScanned: input.persistentWindowDegradation.observedRemovedPerScanned,
      adaptiveCacheThreshold: input.adaptiveThresholds.cacheQueryHitRateThreshold,
      adaptiveParsedMaxThreshold: input.adaptiveThresholds.persistentParsedPerScannedMaxThreshold,
      adaptiveReusedMinThreshold: input.adaptiveThresholds.persistentReusedPerScannedMinThreshold,
      adaptiveRemovedMaxThreshold: input.adaptiveThresholds.persistentRemovedPerScannedMaxThreshold,
      adaptiveAlpha: input.adaptiveThresholds.learnAlpha,
      adaptiveSource: input.adaptiveThresholds.source,
      adaptiveUpdated: input.adaptiveThresholds.updated,
      adaptiveUpdates: input.adaptiveThresholds.updates,
      adaptiveActionScale: input.adaptiveAction.scale,
      adaptiveActionSource: input.adaptiveAction.source,
      adaptiveActionUpdated: input.adaptiveAction.updated,
      adaptiveActionUpdates: input.adaptiveAction.updates,
    },
  };

  const applyStateNoAction = (reason: string): GraphQualityAutotuneDecision => {
    stateAfter = {
      ...stateAfter,
      holdTurnsRemaining: Math.max(0, stateAfter.holdTurnsRemaining - 1),
      downshiftWarmupStreak: 0,
      lastReason: reason,
      updatedAt: nowIso(),
    };
    return {
      ...baseDecision,
      reason,
      stateAfter,
    };
  };

  if (!input.allowProactiveCompaction || !input.baseConfig.enabled) {
    return applyStateNoAction("disabled");
  }
  if (!input.baseConfig.dependencyGraph.enabled && !input.baseConfig.symbolGraph.enabled) {
    return applyStateNoAction("graph_disabled");
  }
  const minEvidenceEntries = Math.max(
    2,
    Math.min(64, input.baseConfig.promptQuality?.degradeMinEntries ?? 8),
  );
  const hasGraphEvidence =
    input.graphWindowSummary.entries >= minEvidenceEntries
    && input.graphWindowSummary.quality.entriesWithQuality >= minEvidenceEntries;
  const hasPersistentEvidence =
    input.persistentSignalsActive
    && input.persistentWindowDegradation.observedEntries >= minEvidenceEntries
    && input.persistentWindowDegradation.observedScannedFiles
      >= input.persistentWindowDegradation.minScannedFiles;
  if (
    !hasGraphEvidence
    && !hasPersistentEvidence
  ) {
    return applyStateNoAction("insufficient_evidence");
  }

  const highPressure =
    (typeof pressureUtilization === "number" && pressureUtilization >= 0.92)
    || (typeof pressureAutoLimitRate === "number" && pressureAutoLimitRate >= 0.45)
    || (typeof pressureSemanticRate === "number" && pressureSemanticRate >= 0.55);
  const lowDependencyDepth = typeof dependencyDepth === "number" && dependencyDepth < 2.4;
  const veryLowDependencyDepth = typeof dependencyDepth === "number" && dependencyDepth < 1.8;
  const lowDependencyMultiHop =
    typeof dependencyMultiHopRate === "number" && dependencyMultiHopRate < 0.22;
  const veryLowDependencyMultiHop =
    typeof dependencyMultiHopRate === "number" && dependencyMultiHopRate < 0.10;
  const poorDependency = lowDependencyDepth || lowDependencyMultiHop;
  const severeDependency = veryLowDependencyDepth || veryLowDependencyMultiHop;
  const strongDependency =
    typeof dependencyDepth === "number"
    && dependencyDepth >= 3.2
    && typeof dependencyMultiHopRate === "number"
    && dependencyMultiHopRate >= 0.45;

  const lowSymbolBridge =
    typeof symbolBridgeCoverageRate === "number" && symbolBridgeCoverageRate < 0.58;
  const veryLowSymbolBridge =
    typeof symbolBridgeCoverageRate === "number" && symbolBridgeCoverageRate < 0.35;
  const lowSymbolBreadth =
    typeof symbolBreadthCoverageRate === "number" && symbolBreadthCoverageRate < 0.55;
  const veryLowSymbolBreadth =
    typeof symbolBreadthCoverageRate === "number" && symbolBreadthCoverageRate < 0.35;
  const poorSymbol = lowSymbolBridge || lowSymbolBreadth;
  const severeSymbol = veryLowSymbolBridge || veryLowSymbolBreadth;
  const strongSymbol =
    typeof symbolBridgeCoverageRate === "number"
    && symbolBridgeCoverageRate >= 0.78
    && typeof symbolBreadthCoverageRate === "number"
    && symbolBreadthCoverageRate >= 0.74;

  let dependencyDelta = 0;
  let symbolDelta = 0;
  const reasonParts: string[] = [];

  if (input.baseConfig.dependencyGraph.enabled && poorDependency) {
    dependencyDelta += severeDependency ? 2 : 1;
    reasonParts.push("dependency_low_quality");
  }
  if (input.baseConfig.symbolGraph.enabled && poorSymbol) {
    symbolDelta += severeSymbol ? 2 : 1;
    reasonParts.push("symbol_low_quality");
  }
  if (highPressure) {
    reasonParts.push("token_pressure");
    if (strongDependency && input.baseConfig.dependencyGraph.enabled) {
      dependencyDelta -= 1;
    }
    if (strongSymbol && input.baseConfig.symbolGraph.enabled) {
      symbolDelta -= 1;
    }
    dependencyDelta = Math.min(dependencyDelta, 1);
    symbolDelta = Math.min(symbolDelta, 1);
  }
  if (input.persistentSignalsActive) {
    if (input.persistentWindowDegradation.degraded) {
      reasonParts.push("persistent_churn");
      dependencyDelta = Math.min(dependencyDelta, 0);
      symbolDelta = Math.min(symbolDelta, 0);
      const parsedRate = input.persistentWindowDegradation.observedParsedPerScanned;
      const reusedRate = input.persistentWindowDegradation.observedReusedPerScanned;
      const removedRate = input.persistentWindowDegradation.observedRemovedPerScanned;
      const severePersistent =
        (typeof parsedRate === "number" && parsedRate >= 0.6)
        || (typeof reusedRate === "number" && reusedRate <= 0.4)
        || (typeof removedRate === "number" && removedRate >= 0.3);
      if (severePersistent) {
        dependencyDelta -= 1;
        symbolDelta -= 1;
      }
    } else {
      const lowPressure =
        (typeof pressureUtilization !== "number" || pressureUtilization <= 0.75)
        && (typeof pressureAutoLimitRate !== "number" || pressureAutoLimitRate <= 0.2)
        && (typeof pressureSemanticRate !== "number" || pressureSemanticRate <= 0.3);
      const persistentStrong =
        typeof input.persistentWindowDegradation.observedReusedPerScanned === "number"
        && input.persistentWindowDegradation.observedReusedPerScanned >= 0.75
        && typeof input.persistentWindowDegradation.observedParsedPerScanned === "number"
        && input.persistentWindowDegradation.observedParsedPerScanned <= 0.25
        && typeof input.persistentWindowDegradation.observedRemovedPerScanned === "number"
        && input.persistentWindowDegradation.observedRemovedPerScanned <= 0.08;
      if (lowPressure && persistentStrong && strongDependency && strongSymbol) {
        reasonParts.push("stable_quality_compact");
        dependencyDelta -= 1;
        symbolDelta -= 1;
      }
    }
  }
  if (input.graphQualitySignals.state === "degraded") {
    reasonParts.push("graph_signals_degraded");
    dependencyDelta = Math.min(dependencyDelta, 0) - (input.baseConfig.dependencyGraph.enabled ? 1 : 0);
    symbolDelta = Math.min(symbolDelta, 0) - (input.baseConfig.symbolGraph.enabled ? 1 : 0);
  } else if (input.graphQualitySignals.state === "watch") {
    reasonParts.push("graph_signals_watch");
    dependencyDelta = Math.min(dependencyDelta, 1);
    symbolDelta = Math.min(symbolDelta, 1);
  }

  if (Math.abs(input.adaptiveAction.scale - GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE) >= 0.08) {
    reasonParts.push(
      input.adaptiveAction.scale > GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE
        ? "adaptive_action_expand"
        : "adaptive_action_compact",
    );
  }

  dependencyDelta = scaleGraphDelta(dependencyDelta, input.adaptiveAction.scale);
  symbolDelta = scaleGraphDelta(symbolDelta, input.adaptiveAction.scale);

  const dependencyRowsTo = input.baseConfig.dependencyGraph.enabled
    ? clampGraphRows(dependencyRowsFrom + dependencyDelta)
    : dependencyRowsFrom;
  const symbolRowsTo = input.baseConfig.symbolGraph.enabled
    ? clampGraphRows(symbolRowsFrom + symbolDelta)
    : symbolRowsFrom;

  const candidateChanged = dependencyRowsTo !== dependencyRowsFrom || symbolRowsTo !== symbolRowsFrom;
  const candidateRaised = dependencyRowsTo > dependencyRowsFrom || symbolRowsTo > symbolRowsFrom;
  const candidateLowered = dependencyRowsTo < dependencyRowsFrom || symbolRowsTo < symbolRowsFrom;
  const candidateAction: GraphQualityAutotuneDecision["action"] = !candidateChanged
    ? "none"
    : candidateRaised && candidateLowered
      ? "mixed"
      : candidateRaised
        ? "upshift"
        : "downshift";
  const candidateDirection = candidateAction;

  let suppressedBy: GraphQualityAutotuneDecision["suppressedBy"] = "none";
  if (candidateChanged) {
    const reversal =
      (candidateDirection === "upshift" && stateAfter.lastDirection === "downshift")
      || (candidateDirection === "downshift" && stateAfter.lastDirection === "upshift");
    if (reversal && stateAfter.holdTurnsRemaining > 0) {
      suppressedBy = "flip_hold";
    } else if (candidateDirection === "downshift") {
      const nextWarmupStreak = stateAfter.downshiftWarmupStreak + 1;
      stateAfter.downshiftWarmupStreak = nextWarmupStreak;
      if (nextWarmupStreak < GRAPH_AUTOTUNE_DOWNSHIFT_WARMUP_TURNS) {
        suppressedBy = "downshift_warmup";
      }
    } else {
      stateAfter.downshiftWarmupStreak = 0;
    }
  } else {
    stateAfter.downshiftWarmupStreak = 0;
  }

  const changed = candidateChanged && suppressedBy === "none";
  const finalDependencyRowsTo = changed ? dependencyRowsTo : dependencyRowsFrom;
  const finalSymbolRowsTo = changed ? symbolRowsTo : symbolRowsFrom;
  const finalAction: GraphQualityAutotuneDecision["action"] = changed ? candidateAction : "none";
  const reason = reasonParts.length > 0 ? reasonParts.join("+") : "stable";
  const finalReason = suppressedBy === "none" ? reason : `${reason}+${suppressedBy}`;

  if (changed) {
    stateAfter = {
      ...stateAfter,
      lastDirection: candidateDirection,
      holdTurnsRemaining: GRAPH_AUTOTUNE_FLIP_HOLD_TURNS,
      downshiftWarmupStreak: 0,
      lastReason: finalReason,
      updatedAt: nowIso(),
    };
  } else {
    stateAfter = {
      ...stateAfter,
      holdTurnsRemaining: Math.max(0, stateAfter.holdTurnsRemaining - 1),
      lastReason: finalReason,
      updatedAt: nowIso(),
    };
  }

  const adjustedConfig: ContextEngineConfig = {
    ...input.baseConfig,
    dependencyGraph: {
      ...input.baseConfig.dependencyGraph,
      maxRows: finalDependencyRowsTo,
    },
    symbolGraph: {
      ...input.baseConfig.symbolGraph,
      maxRows: finalSymbolRowsTo,
    },
  };

  return {
    ...baseDecision,
    adjustedConfig,
    changed,
    action: finalAction,
    reason: finalReason,
    suppressedBy,
    dependencyRowsTo: finalDependencyRowsTo,
    symbolRowsTo: finalSymbolRowsTo,
    stateAfter,
  };
}
