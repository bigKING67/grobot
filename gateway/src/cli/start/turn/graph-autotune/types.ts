import {
  type ContextEngineConfig,
  type GraphQualitySignalsSummary,
  type GraphQualityAutotuneState,
} from "../../../../tools/context";

export interface GraphQualityAutotuneDecision {
  adjustedConfig: ContextEngineConfig;
  changed: boolean;
  action: "none" | "upshift" | "downshift" | "mixed";
  reason: string;
  suppressedBy: "none" | "flip_hold" | "downshift_warmup";
  dependencyRowsFrom: number;
  dependencyRowsTo: number;
  symbolRowsFrom: number;
  symbolRowsTo: number;
  evidenceEntries: number;
  evidenceQualityEntries: number;
  evidencePersistentEntries: number;
  graphQualitySignals: GraphQualitySignalsSummary;
  stateBefore: GraphQualityAutotuneState;
  stateAfter: GraphQualityAutotuneState;
  metrics: {
    dependencyDepth: number | null;
    dependencyMultiHopRate: number | null;
    symbolBridgeCoverageRate: number | null;
    symbolBreadthCoverageRate: number | null;
    pressureUtilization: number | null;
    pressureAutoLimitRate: number | null;
    pressureSemanticRate: number | null;
    graphCacheDegraded: boolean;
    graphCacheReason: string;
    graphCacheQueryHitRate: number | null;
    persistentDegraded: boolean;
    persistentReason: string;
    persistentParsedPerScanned: number | null;
    persistentReusedPerScanned: number | null;
    persistentRemovedPerScanned: number | null;
    adaptiveCacheThreshold: number;
    adaptiveParsedMaxThreshold: number;
    adaptiveReusedMinThreshold: number;
    adaptiveRemovedMaxThreshold: number;
    adaptiveAlpha: number;
    adaptiveSource: string;
    adaptiveUpdated: boolean;
    adaptiveUpdates: number;
    adaptiveActionScale: number;
    adaptiveActionSource: string;
    adaptiveActionUpdated: boolean;
    adaptiveActionUpdates: number;
  };
}

export interface GraphAdaptiveThresholdProfile {
  cacheQueryHitRateThreshold: number;
  persistentParsedPerScannedMaxThreshold: number;
  persistentReusedPerScannedMinThreshold: number;
  persistentRemovedPerScannedMaxThreshold: number;
  learnAlpha: number;
  updated: boolean;
  source: string;
  updates: number;
}

export interface GraphAdaptiveActionProfile {
  scale: number;
  source: string;
  updated: boolean;
  updates: number;
}
