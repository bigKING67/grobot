import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GRAPH_QUALITY_AUTOTUNE_STATE_RELATIVE_PATH = ".grobot/context/graph-quality-autotune-state.json";

export type GraphQualityAutotuneDirection = "none" | "upshift" | "downshift" | "mixed";

export interface GraphQualityAutotuneState {
  lastDirection: GraphQualityAutotuneDirection;
  holdTurnsRemaining: number;
  downshiftWarmupStreak: number;
  lastReason: string;
  updatedAt: string | null;
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

function resolveParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

function resolveStatePath(workDir: string): string {
  return resolve(workDir, GRAPH_QUALITY_AUTOTUNE_STATE_RELATIVE_PATH);
}

export function defaultGraphQualityAutotuneState(): GraphQualityAutotuneState {
  return {
    lastDirection: "none",
    holdTurnsRemaining: 0,
    downshiftWarmupStreak: 0,
    lastReason: "",
    updatedAt: null,
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
  };
}

export function readGraphQualityAutotuneState(input: {
  workDir?: string;
}): GraphQualityAutotuneState {
  if (!input.workDir || input.workDir.trim().length === 0) {
    return defaultGraphQualityAutotuneState();
  }
  const path = resolveStatePath(input.workDir);
  if (!existsSync(path)) {
    return defaultGraphQualityAutotuneState();
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return normalizeGraphQualityAutotuneState(raw);
  } catch {
    return defaultGraphQualityAutotuneState();
  }
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

