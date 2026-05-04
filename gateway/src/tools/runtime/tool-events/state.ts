import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";
import type {
  RuntimeToolRecoveryHint,
  RuntimeToolSurfaceMetricsSnapshot,
  RuntimeToolSurfaceMetricsState,
} from "./contract";
import { normalizePositiveInteger, normalizeRecoveryHint } from "./normalize";
import { normalizeRecord } from "./payload";

function emptyState(): RuntimeToolSurfaceMetricsState {
  return {
    version: 1,
    updatedAt: "",
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: {},
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: "",
    latestRecoveryRepeatCount: 0,
    durationTotalMsByTool: {},
    durationCountByTool: {},
    recentRecoveries: [],
  };
}

export function metricsPathForWorkDir(workDir: string): string {
  return resolve(workDir, ".grobot/runtime/tool-surface-metrics.json");
}

export function readState(path: string): RuntimeToolSurfaceMetricsState {
  if (!existsSync(path)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const row = normalizeRecord(parsed);
    return {
      version: 1,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
      callsTotal: typeof row.callsTotal === "number" ? row.callsTotal : 0,
      failedTotal: typeof row.failedTotal === "number" ? row.failedTotal : 0,
      deferredTotal: typeof row.deferredTotal === "number" ? row.deferredTotal : 0,
      callsByTool: normalizeNumberMap(row.callsByTool),
      failuresByErrorClass: normalizeNumberMap(row.failuresByErrorClass),
      recoveryStages: normalizeNumberMap(row.recoveryStages),
      recoveryCountsByKey: normalizeNumberMap(row.recoveryCountsByKey),
      latestRecoveryRepeatKey: typeof row.latestRecoveryRepeatKey === "string" ? row.latestRecoveryRepeatKey : "",
      latestRecoveryRepeatCount: normalizePositiveInteger(row.latestRecoveryRepeatCount) ?? 0,
      durationTotalMsByTool: normalizeNumberMap(row.durationTotalMsByTool),
      durationCountByTool: normalizeNumberMap(row.durationCountByTool),
      recentRecoveries: Array.isArray(row.recentRecoveries)
        ? row.recentRecoveries
            .map((item) => normalizeRecoveryHint(normalizeRecord(item)))
            .filter((item): item is RuntimeToolRecoveryHint => Boolean(item))
            .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.timelineMaxEntries)
        : [],
    };
  } catch {
    return emptyState();
  }
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  const row = normalizeRecord(value);
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      output[key] = raw;
    }
  }
  return output;
}

export function toSnapshot(path: string, state: RuntimeToolSurfaceMetricsState): RuntimeToolSurfaceMetricsSnapshot {
  const avgDurationMsByTool: Record<string, number> = {};
  for (const [tool, total] of Object.entries(state.durationTotalMsByTool)) {
    const count = state.durationCountByTool[tool] ?? 0;
    if (count > 0) {
      avgDurationMsByTool[tool] = Math.round(total / count);
    }
  }
  return {
    version: 1,
    updatedAt: state.updatedAt || null,
    callsTotal: state.callsTotal,
    failedTotal: state.failedTotal,
    deferredTotal: state.deferredTotal,
    callsByTool: state.callsByTool,
    failuresByErrorClass: state.failuresByErrorClass,
    recoveryStages: state.recoveryStages,
    recoveryCountsByKey: state.recoveryCountsByKey,
    latestRecoveryRepeatKey: state.latestRecoveryRepeatKey || null,
    latestRecoveryRepeatCount: state.latestRecoveryRepeatCount,
    avgDurationMsByTool,
    recentRecoveries: state.recentRecoveries,
    latestRecovery: state.recentRecoveries[state.recentRecoveries.length - 1] ?? null,
    path,
  };
}
