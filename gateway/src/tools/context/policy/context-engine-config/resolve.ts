import { type RuntimeModelConfig } from "../../../../models/types";
import {
  DEFAULT_AUTO_COMPACT_RATIO,
  DEFAULT_CONTEXT_WINDOW_OPENAI_COMPATIBLE,
  DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS,
  DEFAULT_LINEAGE_CACHE_TTL_MS,
  DEFAULT_LINEAGE_MAX_COMMITS,
  DEFAULT_LINEAGE_MAX_ROWS,
  DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD,
  DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES,
  DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD,
  DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED,
  DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST,
  DEFAULT_PROMPT_QUALITY_GUARD_ENABLED,
  DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS,
  DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK,
  DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK,
  DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD,
  DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD,
  DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK,
  DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD,
  DEFAULT_RESERVED_OUTPUT_TOKENS,
  DEFAULT_SAFETY_MARGIN_TOKENS,
  DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE,
  DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS,
  DEFAULT_SYMBOL_GRAPH_MAX_ROWS,
  DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS,
  DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS,
  PROFILE_THRESHOLDS,
  resolveDefaultContextWindow,
} from "./defaults";
import {
  clampPositiveInt,
  clampRatio,
  clampUnitRatio,
  normalizeProfile,
  normalizePromptQualityGuardAdaptiveModeAllowlist,
  normalizePromptQualityGuardMaxFloorStage,
  parseEnvBoolean,
  parseEnvNumber,
  parseEnvStringList,
} from "./normalize";
import { readTomlOverrides } from "./toml";
import { type ContextEngineConfig } from "../../types";

export function resolveContextEngineConfig(input: {
  projectTomlPath?: string;
  runtimeModelConfig?: RuntimeModelConfig;
}): ContextEngineConfig {
  const fromToml = readTomlOverrides(input.projectTomlPath);
  const profile = normalizeProfile(
    process.env.GROBOT_CONTEXT_ENGINE_PROFILE ?? fromToml.profile,
  );
  const profileThresholds = PROFILE_THRESHOLDS[profile];

  const enabledByEnv = parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_ENABLED);
  const enabled = enabledByEnv ?? fromToml.enabled ?? true;
  const contextWindowTokens = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_WINDOW)
      ?? fromToml.contextWindowTokens
      ?? resolveDefaultContextWindow(input.runtimeModelConfig),
    resolveDefaultContextWindow(input.runtimeModelConfig),
  );
  const reservedOutputTokens = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_RESERVED_OUTPUT_TOKENS)
      ?? fromToml.reservedOutputTokens
      ?? DEFAULT_RESERVED_OUTPUT_TOKENS,
    DEFAULT_RESERVED_OUTPUT_TOKENS,
  );
  const safetyMarginTokens = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SAFETY_MARGIN_TOKENS)
      ?? fromToml.safetyMarginTokens
      ?? DEFAULT_SAFETY_MARGIN_TOKENS,
    DEFAULT_SAFETY_MARGIN_TOKENS,
  );
  const effectiveWindowTokens = Math.max(
    1_024,
    contextWindowTokens - reservedOutputTokens - safetyMarginTokens,
  );
  const defaultAutoCompactTokenLimit = Math.max(
    1,
    Math.floor(contextWindowTokens * DEFAULT_AUTO_COMPACT_RATIO),
  );
  const autoCompactTokenLimit = Math.max(
    1,
    Math.min(
      effectiveWindowTokens,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_AUTO_COMPACT_TOKEN_LIMIT)
          ?? fromToml.autoCompactTokenLimit
          ?? defaultAutoCompactTokenLimit,
        defaultAutoCompactTokenLimit,
      ),
    ),
  );
  const proactiveRatio = clampRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO)
      ?? fromToml.proactiveRatio
      ?? profileThresholds.proactive,
    profileThresholds.proactive,
  );
  const forcedRatio = clampRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_FORCED_RATIO)
      ?? fromToml.forcedRatio
      ?? profileThresholds.forced,
    profileThresholds.forced,
  );
  const hardRatio = clampRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_HARD_RATIO)
      ?? fromToml.hardRatio
      ?? profileThresholds.hard,
    profileThresholds.hard,
  );
  const reactiveMaxRetries = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_REACTIVE_MAX_RETRIES)
      ?? fromToml.reactiveMaxRetries
      ?? 1,
    1,
  );
  const ptlMaxRetries = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PTL_MAX_RETRIES)
      ?? fromToml.ptlMaxRetries
      ?? 3,
    3,
  );
  const circuitBreakerFailures = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_CIRCUIT_BREAKER_FAILURES)
      ?? fromToml.circuitBreakerFailures
      ?? 3,
    3,
  );
  const reactiveOnPromptTooLong =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_REACTIVE_ON_PTL)
    ?? fromToml.reactiveOnPromptTooLong
    ?? true;
  const promptQualityLowQualityThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD)
      ?? fromToml.promptQualityLowQualityThreshold
      ?? DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD,
  );
  const promptQualityDegradeOverallThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD)
      ?? fromToml.promptQualityDegradeOverallThreshold
      ?? DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD,
  );
  const promptQualityDegradeLowQualityRateThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_LOW_QUALITY_RATE_THRESHOLD)
      ?? fromToml.promptQualityDegradeLowQualityRateThreshold
      ?? DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD,
  );
  const promptQualityDegradeMinEntries = Math.max(
    1,
    Math.min(
      512,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES)
          ?? fromToml.promptQualityDegradeMinEntries
          ?? DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES,
        DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES,
      ),
    ),
  );
  const promptQualityGuardEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ENABLED)
    ?? fromToml.promptQualityGuardEnabled
    ?? DEFAULT_PROMPT_QUALITY_GUARD_ENABLED;
  const promptQualityGuardAdaptiveEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED)
    ?? fromToml.promptQualityGuardAdaptiveEnabled
    ?? DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED;
  const promptQualityGuardAdaptiveModeAllowlist =
    normalizePromptQualityGuardAdaptiveModeAllowlist(
      parseEnvStringList(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST)
      ?? fromToml.promptQualityGuardAdaptiveModeAllowlist
      ?? DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST,
    );
  const promptQualityGuardPromoteStreak = Math.max(
    1,
    Math.min(
      32,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_PROMOTE_STREAK)
          ?? fromToml.promptQualityGuardPromoteStreak
          ?? DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK,
        DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK,
      ),
    ),
  );
  const promptQualityGuardSeverePromoteStreak = Math.max(
    1,
    Math.min(
      32,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK)
          ?? fromToml.promptQualityGuardSeverePromoteStreak
          ?? DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK,
        DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK,
      ),
    ),
  );
  const promptQualityGuardReleaseStreak = Math.max(
    1,
    Math.min(
      64,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_RELEASE_STREAK)
          ?? fromToml.promptQualityGuardReleaseStreak
          ?? DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK,
        DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK,
      ),
    ),
  );
  const promptQualityGuardHoldTurnsRaw =
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_HOLD_TURNS)
    ?? fromToml.promptQualityGuardHoldTurns
    ?? DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS;
  const promptQualityGuardHoldTurns =
    Number.isFinite(promptQualityGuardHoldTurnsRaw)
      ? Math.max(0, Math.min(64, Math.floor(promptQualityGuardHoldTurnsRaw)))
      : DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS;
  const promptQualityGuardMaxFloorStage = normalizePromptQualityGuardMaxFloorStage(
    process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE
      ?? fromToml.promptQualityGuardMaxFloorStage,
  );
  const promptQualityGuardSevereOverallThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD)
      ?? fromToml.promptQualityGuardSevereOverallThreshold
      ?? DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD,
  );
  const promptQualityGuardSevereLowQualityRateThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_LOW_QUALITY_RATE_THRESHOLD)
      ?? fromToml.promptQualityGuardSevereLowQualityRateThreshold
      ?? DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD,
  );
  const lineageEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_ENABLED)
    ?? fromToml.lineageEnabled
    ?? true;
  const lineageMaxRows = Math.min(
    16,
    clampPositiveInt(
      parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_MAX_ROWS)
      ?? fromToml.lineageMaxRows
      ?? DEFAULT_LINEAGE_MAX_ROWS,
      DEFAULT_LINEAGE_MAX_ROWS,
    ),
  );
  const lineageMaxCommits = Math.min(
    500,
    clampPositiveInt(
      parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_MAX_COMMITS)
      ?? fromToml.lineageMaxCommits
      ?? DEFAULT_LINEAGE_MAX_COMMITS,
      DEFAULT_LINEAGE_MAX_COMMITS,
    ),
  );
  const lineageCacheTtlMs = Math.max(
    1_000,
    Math.min(
      600_000,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_CACHE_TTL_MS)
        ?? fromToml.lineageCacheTtlMs
        ?? DEFAULT_LINEAGE_CACHE_TTL_MS,
        DEFAULT_LINEAGE_CACHE_TTL_MS,
      ),
    ),
  );
  const workspaceSignalsEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_ENABLED)
    ?? fromToml.workspaceSignalsEnabled
    ?? true;
  const workspaceSignalsMaxRows = Math.min(
    20,
    clampPositiveInt(
      parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_MAX_ROWS)
      ?? fromToml.workspaceSignalsMaxRows
      ?? DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS,
      DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS,
    ),
  );
  const workspaceSignalsIncludeUntracked =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_INCLUDE_UNTRACKED)
    ?? fromToml.workspaceSignalsIncludeUntracked
    ?? true;
  const workspaceSignalsCacheTtlMs = Math.max(
    200,
    Math.min(
      60_000,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_CACHE_TTL_MS)
        ?? fromToml.workspaceSignalsCacheTtlMs
        ?? DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS,
        DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS,
      ),
    ),
  );
  const semanticPrefetchEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_ENABLED)
    ?? fromToml.semanticPrefetchEnabled
    ?? false;
  const semanticPrefetchTimeoutMs = Math.max(
    300,
    Math.min(
      15_000,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_TIMEOUT_MS)
        ?? fromToml.semanticPrefetchTimeoutMs
        ?? DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS,
        DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS,
      ),
    ),
  );
  const semanticPrefetchMaxEvidence = Math.max(
    1,
    Math.min(
      24,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_MAX_EVIDENCE)
        ?? fromToml.semanticPrefetchMaxEvidence
        ?? DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE,
        DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE,
      ),
    ),
  );
  const dependencyGraphEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_DEPENDENCY_GRAPH_ENABLED)
    ?? fromToml.dependencyGraphEnabled
    ?? true;
  const dependencyGraphMaxRows = Math.max(
    1,
    Math.min(
      20,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_DEPENDENCY_GRAPH_MAX_ROWS)
        ?? fromToml.dependencyGraphMaxRows
        ?? DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS,
        DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS,
      ),
    ),
  );
  const symbolGraphEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_SYMBOL_GRAPH_ENABLED)
    ?? fromToml.symbolGraphEnabled
    ?? true;
  const symbolGraphMaxRows = Math.max(
    1,
    Math.min(
      20,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SYMBOL_GRAPH_MAX_ROWS)
        ?? fromToml.symbolGraphMaxRows
        ?? DEFAULT_SYMBOL_GRAPH_MAX_ROWS,
        DEFAULT_SYMBOL_GRAPH_MAX_ROWS,
      ),
    ),
  );

  return {
    enabled,
    profile,
    contextWindowTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    autoCompactTokenLimit,
    thresholds: {
      proactiveRatio: proactiveRatio,
      forcedRatio: Math.max(forcedRatio, proactiveRatio + 0.01),
      hardRatio: Math.max(hardRatio, forcedRatio + 0.01),
    },
    recovery: {
      reactiveMaxRetries,
      ptlMaxRetries,
      circuitBreakerFailures,
    },
    promptQuality: {
      lowQualityThreshold: promptQualityLowQualityThreshold,
      degradeOverallThreshold: promptQualityDegradeOverallThreshold,
      degradeLowQualityRateThreshold: promptQualityDegradeLowQualityRateThreshold,
      degradeMinEntries: promptQualityDegradeMinEntries,
      guardEnabled: promptQualityGuardEnabled,
      guardAdaptiveEnabled: promptQualityGuardAdaptiveEnabled,
      guardAdaptiveModeAllowlist: promptQualityGuardAdaptiveModeAllowlist,
      guardPromoteStreak: promptQualityGuardPromoteStreak,
      guardSeverePromoteStreak: promptQualityGuardSeverePromoteStreak,
      guardReleaseStreak: promptQualityGuardReleaseStreak,
      guardHoldTurns: promptQualityGuardHoldTurns,
      guardMaxFloorStage: promptQualityGuardMaxFloorStage,
      guardSevereOverallThreshold: promptQualityGuardSevereOverallThreshold,
      guardSevereLowQualityRateThreshold: promptQualityGuardSevereLowQualityRateThreshold,
    },
    lineage: {
      enabled: lineageEnabled,
      maxRows: lineageMaxRows,
      maxCommits: lineageMaxCommits,
      cacheTtlMs: lineageCacheTtlMs,
    },
    workspaceSignals: {
      enabled: workspaceSignalsEnabled,
      maxRows: workspaceSignalsMaxRows,
      includeUntracked: workspaceSignalsIncludeUntracked,
      cacheTtlMs: workspaceSignalsCacheTtlMs,
    },
    semanticPrefetch: {
      enabled: semanticPrefetchEnabled,
      timeoutMs: semanticPrefetchTimeoutMs,
      maxEvidence: semanticPrefetchMaxEvidence,
    },
    dependencyGraph: {
      enabled: dependencyGraphEnabled,
      maxRows: dependencyGraphMaxRows,
    },
    symbolGraph: {
      enabled: symbolGraphEnabled,
      maxRows: symbolGraphMaxRows,
    },
    reactiveOnPromptTooLong,
  };
}

export const contextEngineConfigDefaults = {
  contextWindowOpenAiCompatible: DEFAULT_CONTEXT_WINDOW_OPENAI_COMPATIBLE,
};
