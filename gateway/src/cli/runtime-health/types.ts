import type { ToolSurfaceProfile } from "../../models/types";
import { type RuntimeToolSurfaceProjectionMode } from "../../tools/runtime/default-enabled-tools";
import { type RuntimeToolMessageBudgetProfile } from "../../tools/runtime/tool-output-budget";

export interface RuntimeOverlapGuardMetrics {
  blockedTotal: number;
  blockedSearch: number;
  blockedSemantic: number;
  recordedBroadSearch: number;
  recordedBroadSemantic: number;
  trackedTurnKeys: number;
  trackedTurnOrder: number;
  maxTurnKeys: number;
}

export interface RuntimeModelCatalogCacheStats {
  cacheEntries: number;
  hitTotal: number;
  missTotal: number;
  staleTotal: number;
  writeTotal: number;
  window: {
    hitTotal: number;
    missTotal: number;
    staleTotal: number;
    writeTotal: number;
  };
}

export interface RuntimePromptCacheStats {
  enabledTotal: number;
  hintAttemptedTotal: number;
  hintAppliedTotal: number;
  usageObservedTotal: number;
  cachedTokensTotal: number;
  window: {
    enabledTotal: number;
    hintAttemptedTotal: number;
    hintAppliedTotal: number;
    usageObservedTotal: number;
    cachedTokensTotal: number;
  };
}

export interface RuntimeCacheStats {
  processSinceUnixMs: number;
  windowSinceUnixMs: number;
  windowDurationMs: number;
  windowPolicyMs: number | null;
  modelCatalog: RuntimeModelCatalogCacheStats;
  promptCache: RuntimePromptCacheStats;
}

export interface RuntimeToolSurfaceSchemaProfile {
  policyVersion: string;
  profile: ToolSurfaceProfile;
  projectionMode: RuntimeToolSurfaceProjectionMode;
  advancedToolSchema: boolean;
  schemaFingerprint: string;
  toolNames: string[];
  visibleToolCount: number;
  schemaPropertyCount: number;
  fullSchemaPropertyCount: number;
  suppressedSchemaPropertyCount: number;
  perToolPropertyCount: Record<string, number>;
  perToolVisibleArgs: Record<string, string[]>;
  perToolSuppressedArgs: Record<string, string[]>;
}

export interface RuntimeToolRecoveryCatalogRow {
  errorClasses: string[];
  riskClass: string;
  stage: string;
  recommendedNextAction: string;
  recoverable: boolean;
}

export interface RuntimeToolSurfaceSchemaProfilesParseResult {
  profiles: RuntimeToolSurfaceSchemaProfile[];
  rawCount: number;
  invalidReason: string | null;
}

export interface RuntimeToolRecoveryCatalogParseResult {
  rows: RuntimeToolRecoveryCatalogRow[];
  rawCount: number;
  invalidReason: string | null;
}

export interface RuntimeHealthcheckOptions {
  cacheStatsWindowMs?: number;
  resetCacheStatsWindow?: boolean;
}

export interface RuntimeHealthcheckResult {
  ok: boolean;
  detail: string;
  overlapGuardMetrics?: RuntimeOverlapGuardMetrics;
  cacheStats?: RuntimeCacheStats;
}

export interface RuntimeToolsDescribeResult {
  ok: boolean;
  detail: string;
  toolNames: string[];
  defaultEnabledTools: string[];
  manifestFingerprint: string;
  toolRecoveryPolicyVersion: string | null;
  toolRecoveryCatalogFingerprint: string | null;
  toolRecoveryActions: string[];
  toolRecoveryCatalog: RuntimeToolRecoveryCatalogRow[];
  toolSurfaceSchemaProfilesFingerprint: string | null;
  toolSurfaceSchemaProfiles: RuntimeToolSurfaceSchemaProfile[];
  toolMessageBudgetPolicyVersion?: string | null;
  toolMessageBudgetProfiles?: RuntimeToolMessageBudgetProfile[];
}
