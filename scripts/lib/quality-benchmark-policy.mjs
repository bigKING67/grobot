export function parseBenchmarkMsThreshold(flag, value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== String(value).trim()) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function parseBenchmarkCacheHitRatioThreshold(flag, value) {
  const raw = String(value ?? "").trim();
  const hasPercentSuffix = raw.endsWith("%");
  const numberText = hasPercentSuffix ? raw.slice(0, -1) : raw;
  const parsed = Number(numberText);
  if (!Number.isFinite(parsed) || numberText.trim() === "") {
    throw new Error(`${flag} must be a cache-hit percentage between 0 and 100`);
  }
  const percent = hasPercentSuffix || parsed > 1 ? parsed : parsed * 100;
  if (percent < 0 || percent > 100) {
    throw new Error(`${flag} must be a cache-hit percentage between 0 and 100`);
  }
  return Number(percent.toFixed(2));
}

export function compactBenchmarkThresholds(thresholds = {}) {
  return Object.fromEntries(
    Object.entries(thresholds)
      .filter(([, value]) => value !== null && value !== undefined),
  );
}

export function evaluateBenchmarkThresholds(payload, thresholds = {}) {
  const failures = [];
  const checks = [
    ["maxMs", "maxMs", "<="],
    ["medianMs", "medianMs", "<="],
    ["p90Ms", "p90Ms", "<="],
  ];
  for (const [metric, thresholdKey, operator] of checks) {
    const threshold = thresholds[thresholdKey];
    if (threshold === null || threshold === undefined) {
      continue;
    }
    const actual = Number(payload?.[metric] ?? 0);
    if (actual > threshold) {
      failures.push({
        actual,
        message: `${metric} ${actual}ms exceeds threshold ${threshold}ms`,
        metric,
        operator,
        threshold,
      });
    }
  }

  if (thresholds.minCacheHitRatio !== null && thresholds.minCacheHitRatio !== undefined) {
    const actual = Number(payload?.cacheHitPercent ?? 0);
    if (actual < thresholds.minCacheHitRatio) {
      failures.push({
        actual,
        message: `cacheHitPercent ${actual}% is below threshold ${thresholds.minCacheHitRatio}%`,
        metric: "cacheHitPercent",
        operator: ">=",
        threshold: thresholds.minCacheHitRatio,
      });
    }
  }
  return failures;
}
