export function normalizePositiveInt(
  value: number | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function applyContextWindowOverride(input: {
  config: {
    contextWindowTokens: number;
    reservedOutputTokens: number;
    safetyMarginTokens: number;
    autoCompactTokenLimit?: number;
  };
  nextWindowTokens: number;
  keepAutoCompactAbsolute: boolean;
  autoCompactRatio: number;
}): boolean {
  const normalizedNextWindow = Math.max(
    1_024,
    Math.floor(input.nextWindowTokens),
  );
  const previousWindow =
    normalizePositiveInt(input.config.contextWindowTokens) ?? 1_024;
  const previousAutoCompact =
    normalizePositiveInt(input.config.autoCompactTokenLimit) ?? 1;
  if (previousWindow === normalizedNextWindow) {
    return false;
  }
  input.config.contextWindowTokens = normalizedNextWindow;
  if (!input.keepAutoCompactAbsolute) {
    const effectiveWindow = Math.max(
      1_024,
      normalizedNextWindow -
        input.config.reservedOutputTokens -
        input.config.safetyMarginTokens,
    );
    const scaledAutoCompact = Math.max(
      1,
      Math.floor(normalizedNextWindow * input.autoCompactRatio),
    );
    input.config.autoCompactTokenLimit = Math.max(
      1,
      Math.min(effectiveWindow, scaledAutoCompact),
    );
  }
  const nextAutoCompact =
    normalizePositiveInt(input.config.autoCompactTokenLimit) ?? 1;
  return (
    previousAutoCompact !== nextAutoCompact ||
    previousWindow !== normalizedNextWindow
  );
}
