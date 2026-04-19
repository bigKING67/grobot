import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  resolveContextStoragePath,
  resolveContextStorageReadPaths,
} from "../storage-boundary";

export type GraphQualityAutotuneDirection = "none" | "upshift" | "downshift" | "mixed";

export interface GraphQualityAutotuneState {
  lastDirection: GraphQualityAutotuneDirection;
  holdTurnsRemaining: number;
  downshiftWarmupStreak: number;
  lastReason: string;
  updatedAt: string | null;
  cacheDegradeQueryHitRateThreshold: number;
  persistentDegradeParsedPerScannedMax: number;
  persistentDegradeReusedPerScannedMin: number;
  persistentDegradeRemovedPerScannedMax: number;
  adaptiveLearnAlpha: number;
  adaptiveUpdates: number;
  adaptiveSource: string;
  adaptiveActionScale: number;
  adaptiveActionUpdates: number;
  adaptiveActionSource: string;
}

function clampNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeDirection(raw: unknown): GraphQualityAutotuneDirection {
  if (raw === "upshift" || raw === "downshift" || raw === "mixed") {
    return raw;
  }
  return "none";
}

function clampRatio(value: unknown, fallback: number, min = 0, max = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
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

function resolveParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

function resolveStatePath(workDir: string): string {
  return resolveContextStoragePath(workDir, "graph_quality_autotune_state");
}

function readStateFromPath(path: string): GraphQualityAutotuneState | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return normalizeGraphQualityAutotuneState(raw);
  } catch {
    return null;
  }
}

export function defaultGraphQualityAutotuneState(): GraphQualityAutotuneState {
  return {
    lastDirection: "none",
    holdTurnsRemaining: 0,
    downshiftWarmupStreak: 0,
    lastReason: "",
    updatedAt: null,
    cacheDegradeQueryHitRateThreshold: 0.3,
    persistentDegradeParsedPerScannedMax: 0.35,
    persistentDegradeReusedPerScannedMin: 0.55,
    persistentDegradeRemovedPerScannedMax: 0.2,
    adaptiveLearnAlpha: 0.18,
    adaptiveUpdates: 0,
    adaptiveSource: "bootstrap",
    adaptiveActionScale: 1.0,
    adaptiveActionUpdates: 0,
    adaptiveActionSource: "bootstrap",
  };
}

export function normalizeGraphQualityAutotuneState(raw: unknown): GraphQualityAutotuneState {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return defaultGraphQualityAutotuneState();
  }
  const row = raw as Record<string, unknown>;
  return {
    lastDirection: normalizeDirection(row.lastDirection),
    holdTurnsRemaining: clampNonNegativeInt(row.holdTurnsRemaining),
    downshiftWarmupStreak: clampNonNegativeInt(row.downshiftWarmupStreak),
    lastReason: typeof row.lastReason === "string" ? row.lastReason : "",
    updatedAt: typeof row.updatedAt === "string" && row.updatedAt.trim().length > 0
      ? row.updatedAt
      : null,
    cacheDegradeQueryHitRateThreshold: clampRatio(
      row.cacheDegradeQueryHitRateThreshold,
      0.3,
      0.08,
      0.8,
    ),
    persistentDegradeParsedPerScannedMax: clampRatio(
      row.persistentDegradeParsedPerScannedMax,
      0.35,
      0.1,
      0.9,
    ),
    persistentDegradeReusedPerScannedMin: clampRatio(
      row.persistentDegradeReusedPerScannedMin,
      0.55,
      0.05,
      0.95,
    ),
    persistentDegradeRemovedPerScannedMax: clampRatio(
      row.persistentDegradeRemovedPerScannedMax,
      0.2,
      0.01,
      0.6,
    ),
    adaptiveLearnAlpha: clampRatio(row.adaptiveLearnAlpha, 0.18, 0.05, 0.5),
    adaptiveUpdates: clampNonNegativeInt(row.adaptiveUpdates),
    adaptiveSource: typeof row.adaptiveSource === "string" && row.adaptiveSource.trim().length > 0
      ? row.adaptiveSource.trim()
      : "bootstrap",
    adaptiveActionScale: clampRatio(row.adaptiveActionScale, 1.0, 0.5, 2.5),
    adaptiveActionUpdates: clampNonNegativeInt(row.adaptiveActionUpdates),
    adaptiveActionSource:
      typeof row.adaptiveActionSource === "string" && row.adaptiveActionSource.trim().length > 0
        ? row.adaptiveActionSource.trim()
        : "bootstrap",
  };
}

export function readGraphQualityAutotuneState(input: {
  workDir?: string;
}): GraphQualityAutotuneState {
  if (!input.workDir || input.workDir.trim().length === 0) {
    return defaultGraphQualityAutotuneState();
  }
  const readPaths = resolveContextStorageReadPaths(input.workDir, "graph_quality_autotune_state");
  for (const path of readPaths) {
    const state = readStateFromPath(path);
    if (state) {
      return state;
    }
  }
  return defaultGraphQualityAutotuneState();
}

export function writeGraphQualityAutotuneState(input: {
  workDir?: string;
  state: GraphQualityAutotuneState;
}): void {
  if (!input.workDir || input.workDir.trim().length === 0) {
    return;
  }
  const path = resolveStatePath(input.workDir);
  const parentDir = resolveParentDir(path);
  try {
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(normalizeGraphQualityAutotuneState(input.state), null, 2)}\n`, "utf8");
  } catch {
    // best-effort persistence; skip hard failure to avoid turn interruption
  }
}
