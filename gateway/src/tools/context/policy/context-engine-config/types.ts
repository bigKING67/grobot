import {
  type ContextCompressionProfile,
  type ContextPromptQualityGuardAdaptiveMode,
  type PromptCompactionStage,
} from "../../types";

export interface TomlOverrides {
  errors?: ContextEngineConfigFieldError[];
  enabled?: boolean;
  profile?: ContextCompressionProfile;
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
  autoCompactTokenLimit?: number;
  proactiveRatio?: number;
  forcedRatio?: number;
  hardRatio?: number;
  reactiveMaxRetries?: number;
  ptlMaxRetries?: number;
  circuitBreakerFailures?: number;
  reactiveOnPromptTooLong?: boolean;
  lineageEnabled?: boolean;
  lineageMaxRows?: number;
  lineageMaxCommits?: number;
  lineageCacheTtlMs?: number;
  workspaceSignalsEnabled?: boolean;
  workspaceSignalsMaxRows?: number;
  workspaceSignalsIncludeUntracked?: boolean;
  workspaceSignalsCacheTtlMs?: number;
  semanticPrefetchEnabled?: boolean;
  semanticPrefetchTimeoutMs?: number;
  semanticPrefetchMaxEvidence?: number;
  dependencyGraphEnabled?: boolean;
  dependencyGraphMaxRows?: number;
  symbolGraphEnabled?: boolean;
  symbolGraphMaxRows?: number;
  promptQualityLowQualityThreshold?: number;
  promptQualityDegradeOverallThreshold?: number;
  promptQualityDegradeLowQualityRateThreshold?: number;
  promptQualityDegradeMinEntries?: number;
  promptQualityGuardEnabled?: boolean;
  promptQualityGuardAdaptiveEnabled?: boolean;
  promptQualityGuardAdaptiveModeAllowlist?: ContextPromptQualityGuardAdaptiveMode[];
  promptQualityGuardPromoteStreak?: number;
  promptQualityGuardSeverePromoteStreak?: number;
  promptQualityGuardReleaseStreak?: number;
  promptQualityGuardHoldTurns?: number;
  promptQualityGuardMaxFloorStage?: PromptCompactionStage;
  promptQualityGuardSevereOverallThreshold?: number;
  promptQualityGuardSevereLowQualityRateThreshold?: number;
  sourceKeys?: Set<string>;
}

export interface ContextEngineConfigFieldError {
  field: string;
  detail: string;
}

export class ContextEngineConfigInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "ContextEngineConfigInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isContextEngineConfigInputError(
  error: unknown,
): error is ContextEngineConfigInputError {
  return error instanceof ContextEngineConfigInputError;
}
