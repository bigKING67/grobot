import { type ContextEngineConfig } from "../types";

const MIN_EFFECTIVE_WINDOW_TOKENS = 1_024;
const DEFAULT_AUTO_COMPACT_RATIO = 0.9;

export function estimateTokensFromText(text: string): number {
  const compact = text.trim();
  if (!compact) {
    return 0;
  }
  // A conservative approximation: 1 token ~= 4 chars for mixed code/text prompts.
  return Math.max(1, Math.ceil(compact.length / 4));
}

export function resolveEffectiveContextWindow(config: ContextEngineConfig): number {
  const effective =
    config.contextWindowTokens - config.reservedOutputTokens - config.safetyMarginTokens;
  return Math.max(MIN_EFFECTIVE_WINDOW_TOKENS, effective);
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const value = Math.floor(raw);
  if (value <= 0) {
    return fallback;
  }
  return value;
}

export function resolveAutoCompactTokenLimit(
  config: ContextEngineConfig,
  effectiveWindowTokens: number = resolveEffectiveContextWindow(config),
): number {
  const derivedDefault = Math.max(
    1,
    Math.floor(config.contextWindowTokens * DEFAULT_AUTO_COMPACT_RATIO),
  );
  const configured = normalizePositiveInt(config.autoCompactTokenLimit, derivedDefault);
  return Math.max(1, Math.min(effectiveWindowTokens, configured));
}

export function resolvePromptTargetTokenLimit(config: ContextEngineConfig): {
  effectiveWindowTokens: number;
  autoCompactTokenLimit: number;
  targetTokenLimit: number;
} {
  const effectiveWindowTokens = resolveEffectiveContextWindow(config);
  const autoCompactTokenLimit = resolveAutoCompactTokenLimit(
    config,
    effectiveWindowTokens,
  );
  return {
    effectiveWindowTokens,
    autoCompactTokenLimit,
    targetTokenLimit: Math.max(
      1,
      Math.min(effectiveWindowTokens, autoCompactTokenLimit),
    ),
  };
}

export function computeUtilization(totalEstimatedTokens: number, effectiveWindowTokens: number): number {
  if (!Number.isFinite(totalEstimatedTokens) || totalEstimatedTokens <= 0) {
    return 0;
  }
  if (!Number.isFinite(effectiveWindowTokens) || effectiveWindowTokens <= 0) {
    return 1;
  }
  return totalEstimatedTokens / effectiveWindowTokens;
}
