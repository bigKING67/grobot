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
  DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE,
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
  assertContextEngineAutoCompactLimitControl,
  assertContextEngineThresholdOrder,
  assertContextEngineTomlParseErrors,
  assertContextEngineTokenBudgetControl,
  resolveAdaptiveModeAllowlistControl,
  resolveBooleanControl,
  resolveIntegerControl,
  resolveIntegerControlSource,
  resolveProfileControl,
  resolvePromptQualityGuardMaxFloorStageControl,
  resolveRatioControl,
  resolveRatioControlSource,
} from "./input-controls";
import { readTomlOverrides } from "./toml";
import { type ContextEngineConfig } from "../../types";

export function resolveContextEngineConfig(input: {
  projectTomlPath?: string;
  runtimeModelConfig?: RuntimeModelConfig;
}): ContextEngineConfig {
  const fromToml = readTomlOverrides(input.projectTomlPath);
  assertContextEngineTomlParseErrors(fromToml);
  const profile = resolveProfileControl({
    toml: fromToml,
    fallback: "balanced",
  });
  const profileThresholds = PROFILE_THRESHOLDS[profile];

  const enabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_ENABLED",
    envField: "context-engine-enabled",
    toml: fromToml,
    tomlKey: "enabled",
    tomlField: "context-engine-enabled",
    fallback: true,
  });
  const defaultContextWindow = resolveDefaultContextWindow(input.runtimeModelConfig);
  const contextWindowTokens = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_WINDOW",
    envField: "context-engine-window",
    toml: fromToml,
    tomlKey: "contextWindowTokens",
    tomlField: "context-engine-window",
    fallback: defaultContextWindow,
    min: 1_024,
    max: 2_000_000,
  });
  const contextWindowSource = resolveIntegerControlSource({
    envKey: "GROBOT_CONTEXT_ENGINE_WINDOW",
    toml: fromToml,
    tomlKey: "contextWindowTokens",
  });
  const reservedOutputTokens = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_RESERVED_OUTPUT_TOKENS",
    envField: "context-engine-reserved-output-tokens",
    toml: fromToml,
    tomlKey: "reservedOutputTokens",
    tomlField: "context-engine-reserved-output-tokens",
    fallback: DEFAULT_RESERVED_OUTPUT_TOKENS,
    min: 1,
    max: 512_000,
  });
  const reservedOutputSource = resolveIntegerControlSource({
    envKey: "GROBOT_CONTEXT_ENGINE_RESERVED_OUTPUT_TOKENS",
    toml: fromToml,
    tomlKey: "reservedOutputTokens",
  });
  const safetyMarginTokens = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_SAFETY_MARGIN_TOKENS",
    envField: "context-engine-safety-margin-tokens",
    toml: fromToml,
    tomlKey: "safetyMarginTokens",
    tomlField: "context-engine-safety-margin-tokens",
    fallback: DEFAULT_SAFETY_MARGIN_TOKENS,
    min: 1,
    max: 512_000,
  });
  const safetyMarginSource = resolveIntegerControlSource({
    envKey: "GROBOT_CONTEXT_ENGINE_SAFETY_MARGIN_TOKENS",
    toml: fromToml,
    tomlKey: "safetyMarginTokens",
  });
  assertContextEngineTokenBudgetControl({
    contextWindowTokens,
    contextWindowSource,
    reservedOutputTokens,
    reservedOutputSource,
    safetyMarginTokens,
    safetyMarginSource,
  });
  const effectiveWindowTokens =
    contextWindowTokens - reservedOutputTokens - safetyMarginTokens;
  const defaultAutoCompactTokenLimit = Math.max(
    1,
    Math.floor(contextWindowTokens * DEFAULT_AUTO_COMPACT_RATIO),
  );
  const autoCompactTokenLimit = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_AUTO_COMPACT_TOKEN_LIMIT",
    envField: "context-engine-auto-compact-token-limit",
    toml: fromToml,
    tomlKey: "autoCompactTokenLimit",
    tomlField: "context-engine-auto-compact-token-limit",
    fallback: Math.min(effectiveWindowTokens, defaultAutoCompactTokenLimit),
    min: 1,
    max: 2_000_000,
  });
  const autoCompactSource = resolveIntegerControlSource({
    envKey: "GROBOT_CONTEXT_ENGINE_AUTO_COMPACT_TOKEN_LIMIT",
    toml: fromToml,
    tomlKey: "autoCompactTokenLimit",
  });
  assertContextEngineAutoCompactLimitControl({
    autoCompactTokenLimit,
    autoCompactSource,
    effectiveWindowTokens,
  });
  const proactiveRatio = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO",
    envField: "context-engine-proactive-ratio",
    toml: fromToml,
    tomlKey: "proactiveRatio",
    tomlField: "context-engine-proactive-ratio",
    fallback: profileThresholds.proactive,
    min: 0.5,
    max: 0.995,
  });
  const proactiveRatioSource = resolveRatioControlSource({
    envKey: "GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO",
    toml: fromToml,
    tomlKey: "proactiveRatio",
  });
  const forcedRatio = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_FORCED_RATIO",
    envField: "context-engine-forced-ratio",
    toml: fromToml,
    tomlKey: "forcedRatio",
    tomlField: "context-engine-forced-ratio",
    fallback: profileThresholds.forced,
    min: 0.5,
    max: 0.995,
  });
  const forcedRatioSource = resolveRatioControlSource({
    envKey: "GROBOT_CONTEXT_ENGINE_FORCED_RATIO",
    toml: fromToml,
    tomlKey: "forcedRatio",
  });
  const hardRatio = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_HARD_RATIO",
    envField: "context-engine-hard-ratio",
    toml: fromToml,
    tomlKey: "hardRatio",
    tomlField: "context-engine-hard-ratio",
    fallback: profileThresholds.hard,
    min: 0.5,
    max: 0.995,
  });
  const hardRatioSource = resolveRatioControlSource({
    envKey: "GROBOT_CONTEXT_ENGINE_HARD_RATIO",
    toml: fromToml,
    tomlKey: "hardRatio",
  });
  assertContextEngineThresholdOrder({
    proactiveRatio,
    proactiveSource: proactiveRatioSource,
    forcedRatio,
    forcedSource: forcedRatioSource,
    hardRatio,
    hardSource: hardRatioSource,
  });
  const reactiveMaxRetries = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_REACTIVE_MAX_RETRIES",
    envField: "context-engine-reactive-max-retries",
    toml: fromToml,
    tomlKey: "reactiveMaxRetries",
    tomlField: "context-engine-reactive-max-retries",
    fallback: 1,
    min: 1,
    max: 12,
  });
  const ptlMaxRetries = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PTL_MAX_RETRIES",
    envField: "context-engine-ptl-max-retries",
    toml: fromToml,
    tomlKey: "ptlMaxRetries",
    tomlField: "context-engine-ptl-max-retries",
    fallback: 3,
    min: 1,
    max: 12,
  });
  const circuitBreakerFailures = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_CIRCUIT_BREAKER_FAILURES",
    envField: "context-engine-circuit-breaker-failures",
    toml: fromToml,
    tomlKey: "circuitBreakerFailures",
    tomlField: "context-engine-circuit-breaker-failures",
    fallback: 3,
    min: 1,
    max: 50,
  });
  const reactiveOnPromptTooLong = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_REACTIVE_ON_PTL",
    envField: "context-engine-reactive-on-ptl",
    toml: fromToml,
    tomlKey: "reactiveOnPromptTooLong",
    tomlField: "context-engine-reactive-on-ptl",
    fallback: true,
  });
  const promptQualityLowQualityThreshold = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD",
    envField: "context-engine-prompt-quality-low-quality-threshold",
    toml: fromToml,
    tomlKey: "promptQualityLowQualityThreshold",
    tomlField: "context-engine-prompt-quality-low-quality-threshold",
    fallback: DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD,
    min: 0,
    max: 1,
  });
  const promptQualityDegradeOverallThreshold = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD",
    envField: "context-engine-prompt-quality-degrade-overall-threshold",
    toml: fromToml,
    tomlKey: "promptQualityDegradeOverallThreshold",
    tomlField: "context-engine-prompt-quality-degrade-overall-threshold",
    fallback: DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD,
    min: 0,
    max: 1,
  });
  const promptQualityDegradeLowQualityRateThreshold = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_LOW_QUALITY_RATE_THRESHOLD",
    envField: "context-engine-prompt-quality-degrade-low-quality-rate-threshold",
    toml: fromToml,
    tomlKey: "promptQualityDegradeLowQualityRateThreshold",
    tomlField: "context-engine-prompt-quality-degrade-low-quality-rate-threshold",
    fallback: DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD,
    min: 0,
    max: 1,
  });
  const promptQualityDegradeMinEntries = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES",
    envField: "context-engine-prompt-quality-degrade-min-entries",
    toml: fromToml,
    tomlKey: "promptQualityDegradeMinEntries",
    tomlField: "context-engine-prompt-quality-degrade-min-entries",
    fallback: DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES,
    min: 1,
    max: 512,
  });
  const promptQualityGuardEnabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ENABLED",
    envField: "context-engine-prompt-quality-guard-enabled",
    toml: fromToml,
    tomlKey: "promptQualityGuardEnabled",
    tomlField: "context-engine-prompt-quality-guard-enabled",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_ENABLED,
  });
  const promptQualityGuardAdaptiveEnabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED",
    envField: "context-engine-prompt-quality-guard-adaptive-enabled",
    toml: fromToml,
    tomlKey: "promptQualityGuardAdaptiveEnabled",
    tomlField: "context-engine-prompt-quality-guard-adaptive-enabled",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED,
  });
  const promptQualityGuardAdaptiveModeAllowlist =
    resolveAdaptiveModeAllowlistControl({
      toml: fromToml,
      fallback: DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST,
    });
  const promptQualityGuardPromoteStreak = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_PROMOTE_STREAK",
    envField: "context-engine-prompt-quality-guard-promote-streak",
    toml: fromToml,
    tomlKey: "promptQualityGuardPromoteStreak",
    tomlField: "context-engine-prompt-quality-guard-promote-streak",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK,
    min: 1,
    max: 32,
  });
  const promptQualityGuardSeverePromoteStreak = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK",
    envField: "context-engine-prompt-quality-guard-severe-promote-streak",
    toml: fromToml,
    tomlKey: "promptQualityGuardSeverePromoteStreak",
    tomlField: "context-engine-prompt-quality-guard-severe-promote-streak",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK,
    min: 1,
    max: 32,
  });
  const promptQualityGuardReleaseStreak = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_RELEASE_STREAK",
    envField: "context-engine-prompt-quality-guard-release-streak",
    toml: fromToml,
    tomlKey: "promptQualityGuardReleaseStreak",
    tomlField: "context-engine-prompt-quality-guard-release-streak",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK,
    min: 1,
    max: 64,
  });
  const promptQualityGuardHoldTurns = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_HOLD_TURNS",
    envField: "context-engine-prompt-quality-guard-hold-turns",
    toml: fromToml,
    tomlKey: "promptQualityGuardHoldTurns",
    tomlField: "context-engine-prompt-quality-guard-hold-turns",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS,
    min: 0,
    max: 64,
    allowZero: true,
  });
  const promptQualityGuardMaxFloorStage =
    resolvePromptQualityGuardMaxFloorStageControl({
      toml: fromToml,
      fallback: DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE,
    });
  const promptQualityGuardSevereOverallThreshold = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD",
    envField: "context-engine-prompt-quality-guard-severe-overall-threshold",
    toml: fromToml,
    tomlKey: "promptQualityGuardSevereOverallThreshold",
    tomlField: "context-engine-prompt-quality-guard-severe-overall-threshold",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD,
    min: 0,
    max: 1,
  });
  const promptQualityGuardSevereLowQualityRateThreshold = resolveRatioControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_LOW_QUALITY_RATE_THRESHOLD",
    envField: "context-engine-prompt-quality-guard-severe-low-quality-rate-threshold",
    toml: fromToml,
    tomlKey: "promptQualityGuardSevereLowQualityRateThreshold",
    tomlField: "context-engine-prompt-quality-guard-severe-low-quality-rate-threshold",
    fallback: DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD,
    min: 0,
    max: 1,
  });
  const lineageEnabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_LINEAGE_ENABLED",
    envField: "context-engine-lineage-enabled",
    toml: fromToml,
    tomlKey: "lineageEnabled",
    tomlField: "context-engine-lineage-enabled",
    fallback: true,
  });
  const lineageMaxRows = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_LINEAGE_MAX_ROWS",
    envField: "context-engine-lineage-max-rows",
    toml: fromToml,
    tomlKey: "lineageMaxRows",
    tomlField: "context-engine-lineage-max-rows",
    fallback: DEFAULT_LINEAGE_MAX_ROWS,
    min: 1,
    max: 16,
  });
  const lineageMaxCommits = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_LINEAGE_MAX_COMMITS",
    envField: "context-engine-lineage-max-commits",
    toml: fromToml,
    tomlKey: "lineageMaxCommits",
    tomlField: "context-engine-lineage-max-commits",
    fallback: DEFAULT_LINEAGE_MAX_COMMITS,
    min: 1,
    max: 500,
  });
  const lineageCacheTtlMs = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_LINEAGE_CACHE_TTL_MS",
    envField: "context-engine-lineage-cache-ttl-ms",
    toml: fromToml,
    tomlKey: "lineageCacheTtlMs",
    tomlField: "context-engine-lineage-cache-ttl-ms",
    fallback: DEFAULT_LINEAGE_CACHE_TTL_MS,
    min: 1_000,
    max: 600_000,
  });
  const workspaceSignalsEnabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_ENABLED",
    envField: "context-engine-workspace-signals-enabled",
    toml: fromToml,
    tomlKey: "workspaceSignalsEnabled",
    tomlField: "context-engine-workspace-signals-enabled",
    fallback: true,
  });
  const workspaceSignalsMaxRows = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_MAX_ROWS",
    envField: "context-engine-workspace-signals-max-rows",
    toml: fromToml,
    tomlKey: "workspaceSignalsMaxRows",
    tomlField: "context-engine-workspace-signals-max-rows",
    fallback: DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS,
    min: 1,
    max: 20,
  });
  const workspaceSignalsIncludeUntracked = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_INCLUDE_UNTRACKED",
    envField: "context-engine-workspace-signals-include-untracked",
    toml: fromToml,
    tomlKey: "workspaceSignalsIncludeUntracked",
    tomlField: "context-engine-workspace-signals-include-untracked",
    fallback: true,
  });
  const workspaceSignalsCacheTtlMs = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_CACHE_TTL_MS",
    envField: "context-engine-workspace-signals-cache-ttl-ms",
    toml: fromToml,
    tomlKey: "workspaceSignalsCacheTtlMs",
    tomlField: "context-engine-workspace-signals-cache-ttl-ms",
    fallback: DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS,
    min: 200,
    max: 60_000,
  });
  const semanticPrefetchEnabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_ENABLED",
    envField: "context-engine-semantic-prefetch-enabled",
    toml: fromToml,
    tomlKey: "semanticPrefetchEnabled",
    tomlField: "context-engine-semantic-prefetch-enabled",
    fallback: false,
  });
  const semanticPrefetchTimeoutMs = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_TIMEOUT_MS",
    envField: "context-engine-semantic-prefetch-timeout-ms",
    toml: fromToml,
    tomlKey: "semanticPrefetchTimeoutMs",
    tomlField: "context-engine-semantic-prefetch-timeout-ms",
    fallback: DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS,
    min: 300,
    max: 15_000,
  });
  const semanticPrefetchMaxEvidence = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_MAX_EVIDENCE",
    envField: "context-engine-semantic-prefetch-max-evidence",
    toml: fromToml,
    tomlKey: "semanticPrefetchMaxEvidence",
    tomlField: "context-engine-semantic-prefetch-max-evidence",
    fallback: DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE,
    min: 1,
    max: 24,
  });
  const dependencyGraphEnabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_DEPENDENCY_GRAPH_ENABLED",
    envField: "context-engine-dependency-graph-enabled",
    toml: fromToml,
    tomlKey: "dependencyGraphEnabled",
    tomlField: "context-engine-dependency-graph-enabled",
    fallback: true,
  });
  const dependencyGraphMaxRows = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_DEPENDENCY_GRAPH_MAX_ROWS",
    envField: "context-engine-dependency-graph-max-rows",
    toml: fromToml,
    tomlKey: "dependencyGraphMaxRows",
    tomlField: "context-engine-dependency-graph-max-rows",
    fallback: DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS,
    min: 1,
    max: 20,
  });
  const symbolGraphEnabled = resolveBooleanControl({
    envKey: "GROBOT_CONTEXT_ENGINE_SYMBOL_GRAPH_ENABLED",
    envField: "context-engine-symbol-graph-enabled",
    toml: fromToml,
    tomlKey: "symbolGraphEnabled",
    tomlField: "context-engine-symbol-graph-enabled",
    fallback: true,
  });
  const symbolGraphMaxRows = resolveIntegerControl({
    envKey: "GROBOT_CONTEXT_ENGINE_SYMBOL_GRAPH_MAX_ROWS",
    envField: "context-engine-symbol-graph-max-rows",
    toml: fromToml,
    tomlKey: "symbolGraphMaxRows",
    tomlField: "context-engine-symbol-graph-max-rows",
    fallback: DEFAULT_SYMBOL_GRAPH_MAX_ROWS,
    min: 1,
    max: 20,
  });

  return {
    enabled,
    profile,
    contextWindowTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    autoCompactTokenLimit,
    thresholds: {
      proactiveRatio: proactiveRatio,
      forcedRatio,
      hardRatio,
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
