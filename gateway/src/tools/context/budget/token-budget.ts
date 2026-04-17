import { type ContextEngineConfig } from "../types";

const MIN_EFFECTIVE_WINDOW_TOKENS = 1_024;

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

export function computeUtilization(totalEstimatedTokens: number, effectiveWindowTokens: number): number {
  if (!Number.isFinite(totalEstimatedTokens) || totalEstimatedTokens <= 0) {
    return 0;
  }
  if (!Number.isFinite(effectiveWindowTokens) || effectiveWindowTokens <= 0) {
    return 1;
  }
  return totalEstimatedTokens / effectiveWindowTokens;
}
