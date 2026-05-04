import {
  GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  GRAPH_AUTOTUNE_MAX_ROWS,
} from "./constants";

export function clampGraphRows(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(GRAPH_AUTOTUNE_MAX_ROWS, Math.floor(value)));
}

export function clampRatio(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function clampNumber(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function blendThreshold(previous: number, observed: number, alpha: number): number {
  return previous * (1 - alpha) + observed * alpha;
}

export function normalizeOptionalRatio(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clampRatio(value, 0, 1, fallback);
}

export function normalizeOptionalCenteredRatio(
  value: number | null | undefined,
  center: number,
  halfSpan: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || halfSpan <= 0) {
    return fallback;
  }
  const min = center - halfSpan;
  const max = center + halfSpan;
  return clampRatio((value - min) / (max - min), 0, 1, fallback);
}

export function scaleGraphDelta(delta: number, scale: number): number {
  if (!Number.isFinite(delta) || delta === 0) {
    return 0;
  }
  const normalizedScale = clampRatio(scale, 0.5, 2.5, GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE);
  const sign = delta > 0 ? 1 : -1;
  const baseMagnitude = Math.abs(delta);
  const scaledRaw = baseMagnitude * normalizedScale;
  let scaledMagnitude = Math.round(scaledRaw);
  if (baseMagnitude === 1 && normalizedScale < 0.78) {
    scaledMagnitude = 0;
  }
  scaledMagnitude = Math.max(0, Math.min(3, scaledMagnitude));
  return sign * scaledMagnitude;
}
