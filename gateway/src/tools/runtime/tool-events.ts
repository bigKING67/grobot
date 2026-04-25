import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RuntimeEvent } from "../../models/types";

export type RuntimeToolRecoveryStage =
  | "none"
  | "observe_first"
  | "local_fix"
  | "strategy_switch"
  | "ask_user";

export interface RuntimeToolRecoveryHint {
  stage: RuntimeToolRecoveryStage;
  reason: string;
  recommendedNextAction: string;
  toolName?: string;
  errorClass?: string;
}

export interface RuntimeToolEventSummary {
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  callsByTool: Record<string, number>;
  failuresByErrorClass: Record<string, number>;
  recoveryStages: Record<string, number>;
  durationTotalMsByTool: Record<string, number>;
  durationCountByTool: Record<string, number>;
  latestRecovery?: RuntimeToolRecoveryHint;
}

export interface RuntimeToolSurfaceMetricsSnapshot {
  version: 1;
  updatedAt: string | null;
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  callsByTool: Record<string, number>;
  failuresByErrorClass: Record<string, number>;
  recoveryStages: Record<string, number>;
  avgDurationMsByTool: Record<string, number>;
  latestRecovery: RuntimeToolRecoveryHint | null;
  path: string;
}

interface RuntimeToolSurfaceMetricsState {
  version: 1;
  updatedAt: string;
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  callsByTool: Record<string, number>;
  failuresByErrorClass: Record<string, number>;
  recoveryStages: Record<string, number>;
  durationTotalMsByTool: Record<string, number>;
  durationCountByTool: Record<string, number>;
  recentRecoveries: RuntimeToolRecoveryHint[];
}

const RUNTIME_TOOL_RECOVERY_STAGES: readonly RuntimeToolRecoveryStage[] = [
  "none",
  "observe_first",
  "local_fix",
  "strategy_switch",
  "ask_user",
];

function emptySummary(): RuntimeToolEventSummary {
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
    durationTotalMsByTool: {},
    durationCountByTool: {},
    recentRecoveries: [],
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRecoveryStage(value: unknown): RuntimeToolRecoveryStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return RUNTIME_TOOL_RECOVERY_STAGES.includes(value as RuntimeToolRecoveryStage)
    ? value as RuntimeToolRecoveryStage
    : undefined;
}

function increment(map: Record<string, number>, key: string, count = 1): void {
  if (!key) {
    return;
  }
  map[key] = (map[key] ?? 0) + count;
}

function addMap(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    if (Number.isFinite(value) && value !== 0) {
      increment(target, key, value);
    }
  }
}

function normalizeRecoveryHint(payload: Record<string, unknown>): RuntimeToolRecoveryHint | undefined {
  const stage = normalizeRecoveryStage(payload.recovery_stage ?? payload.stage);
  if (!stage || stage === "none") {
    return undefined;
  }
  return {
    stage,
    reason: payloadString(payload, "recovery_reason") || payloadString(payload, "reason") || "unknown",
    recommendedNextAction:
      payloadString(payload, "recommended_next_action")
      || payloadString(payload, "recommendedNextAction")
      || "observe_and_continue",
    toolName: payloadString(payload, "tool_name") || payloadString(payload, "toolName") || undefined,
    errorClass: payloadString(payload, "error_class") || payloadString(payload, "errorClass") || undefined,
  };
}

function metricsPathForWorkDir(workDir: string): string {
  return resolve(workDir, ".grobot/runtime/tool-surface-metrics.json");
}

function readState(path: string): RuntimeToolSurfaceMetricsState {
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
      durationTotalMsByTool: normalizeNumberMap(row.durationTotalMsByTool),
      durationCountByTool: normalizeNumberMap(row.durationCountByTool),
      recentRecoveries: Array.isArray(row.recentRecoveries)
        ? row.recentRecoveries
            .map((item) => normalizeRecoveryHint(normalizeRecord(item)))
            .filter((item): item is RuntimeToolRecoveryHint => Boolean(item))
            .slice(-20)
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

function toSnapshot(path: string, state: RuntimeToolSurfaceMetricsState): RuntimeToolSurfaceMetricsSnapshot {
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
    avgDurationMsByTool,
    latestRecovery: state.recentRecoveries[state.recentRecoveries.length - 1] ?? null,
    path,
  };
}

export function summarizeRuntimeToolEvents(events: readonly RuntimeEvent[]): RuntimeToolEventSummary {
  const summary = emptySummary();
  for (const event of events) {
    const payload = event.payload;
    if (event.eventType === "tool_end") {
      const toolName = payloadString(payload, "tool_name") || "unknown_tool";
      const status = payloadString(payload, "status");
      const durationMs = payloadNumber(payload, "duration_ms");
      summary.callsTotal += 1;
      increment(summary.callsByTool, toolName);
      if (status === "failed") {
        summary.failedTotal += 1;
      }
      if (status === "deferred") {
        summary.deferredTotal += 1;
      }
      const errorClass = payloadString(payload, "error_class");
      if (errorClass) {
        increment(summary.failuresByErrorClass, errorClass);
      }
      if (typeof durationMs === "number") {
        increment(summary.durationTotalMsByTool, toolName, durationMs);
        increment(summary.durationCountByTool, toolName);
      }
    } else if (event.eventType === "tool_recovery") {
      const recovery = normalizeRecoveryHint(payload);
      if (recovery) {
        increment(summary.recoveryStages, recovery.stage);
        summary.latestRecovery = recovery;
      }
    }
  }
  return summary;
}

export function recordRuntimeToolSurfaceMetrics(input: {
  workDir: string;
  events: readonly RuntimeEvent[];
}): RuntimeToolSurfaceMetricsSnapshot {
  const path = metricsPathForWorkDir(input.workDir);
  const summary = summarizeRuntimeToolEvents(input.events);
  const state = readState(path);
  if (summary.callsTotal === 0 && Object.keys(summary.recoveryStages).length === 0) {
    return toSnapshot(path, state);
  }
  state.updatedAt = new Date().toISOString();
  state.callsTotal += summary.callsTotal;
  state.failedTotal += summary.failedTotal;
  state.deferredTotal += summary.deferredTotal;
  addMap(state.callsByTool, summary.callsByTool);
  addMap(state.failuresByErrorClass, summary.failuresByErrorClass);
  addMap(state.recoveryStages, summary.recoveryStages);
  addMap(state.durationTotalMsByTool, summary.durationTotalMsByTool);
  addMap(state.durationCountByTool, summary.durationCountByTool);
  if (summary.latestRecovery) {
    state.recentRecoveries.push(summary.latestRecovery);
    state.recentRecoveries = state.recentRecoveries.slice(-20);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return toSnapshot(path, state);
}

export function readRuntimeToolSurfaceMetrics(workDir: string): RuntimeToolSurfaceMetricsSnapshot {
  const path = metricsPathForWorkDir(workDir);
  return toSnapshot(path, readState(path));
}
