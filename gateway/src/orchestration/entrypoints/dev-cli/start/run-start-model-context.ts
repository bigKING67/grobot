interface InferModelApiContextWindowTokensInput {
  modelName: string;
  fallback?: number;
}

const KIMI_K2_5_MODEL_HINTS = [
  "kimi-k2.5",
  "kimi 2.5",
  "k2.5",
];

function hasModelHint(modelName: string, hints: readonly string[]): boolean {
  const normalized = modelName.trim().toLowerCase();
  return hints.some((hint) => normalized.includes(hint));
}

export function resolveModelDisplayName(modelName: string): string {
  const normalized = modelName.trim();
  if (!normalized) {
    return "Model";
  }
  if (hasModelHint(normalized, KIMI_K2_5_MODEL_HINTS)) {
    return "Kimi 2.5";
  }
  return normalized;
}

export function inferModelApiContextWindowTokens(
  input: InferModelApiContextWindowTokensInput,
): number | undefined {
  if (
    typeof input.fallback === "number"
    && Number.isFinite(input.fallback)
    && input.fallback > 0
  ) {
    return Math.floor(input.fallback);
  }
  return undefined;
}
