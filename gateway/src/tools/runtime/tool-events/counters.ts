import type { RuntimeToolEventSummary } from "./contract";

export function emptySummary(): RuntimeToolEventSummary {
  return {
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: {},
    durationTotalMsByTool: {},
    durationCountByTool: {},
  };
}

export function increment(map: Record<string, number>, key: string, count = 1): void {
  if (!key) {
    return;
  }
  map[key] = (map[key] ?? 0) + count;
}

export function addMap(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    if (Number.isFinite(value) && value !== 0) {
      increment(target, key, value);
    }
  }
}
