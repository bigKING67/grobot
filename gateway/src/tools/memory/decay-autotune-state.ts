import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  resolveContextStoragePath,
  resolveContextStorageReadPaths,
} from "../context/storage-boundary";
import type { MemoryOrchestratorPolicySnapshot } from "./orchestrator";

export interface MemoryDecayAutotuneState {
  maxRowsPerSession: number;
  minConfidenceVerified: number;
  minConfidenceUnverified: number;
  unverifiedMaxAgeHours: number;
  adaptiveLearnAlpha: number;
  adaptiveUpdates: number;
  dropRatioEma: number;
  capacityTrimRatioEma: number;
  lowConfidenceRatioEma: number;
  ageDropRatioEma: number;
  qualityLowRateEma: number;
  qualityPressureEma: number;
  hardBudgetFollowupDeltaEma: number;
  qualityFirstFollowupDeltaEma: number;
  lastReason: string;
  updatedAt: string | null;
}

export interface MemoryDecayAutotuneMaintenanceStats {
  sessionsScanned: number;
  totalRowsBefore: number;
  totalRowsAfter: number;
  droppedRows: number;
  droppedByAge: number;
  droppedByConfidence: number;
  droppedByCapacity: number;
}

export interface MemoryDecayAutotuneUpdateResult {
  state: MemoryDecayAutotuneState;
  changed: boolean;
  reason: string;
}

export interface MemoryDecayAutotuneQualitySnapshot {
  lowQualityRate?: number | null;
  averagePreSendPressureScore?: number | null;
  hardBudgetFollowupOverallDelta?: number | null;
  qualityFirstFollowupOverallDelta?: number | null;
  hardBudgetRate?: number | null;
  qualityFirstImprovedRate?: number | null;
}

function clampNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
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

function clampSigned(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return Number(value.toFixed(6));
}

function clampToIntRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return Math.floor(value);
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
  return resolveContextStoragePath(workDir, "memory_decay_autotune_state");
}

function stateEquals(left: MemoryDecayAutotuneState, right: MemoryDecayAutotuneState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mixEma(previous: number, next: number, alpha: number): number {
  return Number((((1 - alpha) * previous) + (alpha * next)).toFixed(6));
}

function clampWithBaseline(min: number, max: number, value: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function defaultMemoryDecayAutotuneState(
  basePolicy: MemoryOrchestratorPolicySnapshot,
): MemoryDecayAutotuneState {
  return {
    maxRowsPerSession: basePolicy.decayMaxRowsPerSession,
    minConfidenceVerified: basePolicy.decayMinConfidenceVerified,
    minConfidenceUnverified: basePolicy.decayMinConfidenceUnverified,
    unverifiedMaxAgeHours: basePolicy.decayUnverifiedMaxAgeHours,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 0,
    dropRatioEma: 0,
    capacityTrimRatioEma: 0,
    lowConfidenceRatioEma: 0,
    ageDropRatioEma: 0,
    qualityLowRateEma: 0,
    qualityPressureEma: 0,
    hardBudgetFollowupDeltaEma: 0,
    qualityFirstFollowupDeltaEma: 0,
    lastReason: "bootstrap",
    updatedAt: null,
  };
}

export function normalizeMemoryDecayAutotuneState(
  raw: unknown,
  basePolicy: MemoryOrchestratorPolicySnapshot,
): MemoryDecayAutotuneState {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return defaultMemoryDecayAutotuneState(basePolicy);
  }
  const row = raw as Record<string, unknown>;
  const defaults = defaultMemoryDecayAutotuneState(basePolicy);
  const maxRowsMin = Math.max(basePolicy.decayMinRowsToKeep + 2, 16);
  const maxRowsMax = Math.max(basePolicy.decayMaxRowsPerSession * 3, maxRowsMin + 24);
  const maxAgeHoursMax = Math.max(basePolicy.decayMaxAgeHoursL2, basePolicy.decayUnverifiedMaxAgeHours);
  return {
    maxRowsPerSession: clampToIntRange(
      Number(row.maxRowsPerSession),
      maxRowsMin,
      maxRowsMax,
    ),
    minConfidenceVerified: clampRatio(
      row.minConfidenceVerified,
      defaults.minConfidenceVerified,
      0.1,
      0.75,
    ),
    minConfidenceUnverified: clampRatio(
      row.minConfidenceUnverified,
      defaults.minConfidenceUnverified,
      0.2,
      0.9,
    ),
    unverifiedMaxAgeHours: clampToIntRange(
      Number(row.unverifiedMaxAgeHours),
      24,
      maxAgeHoursMax,
    ),
    adaptiveLearnAlpha: clampRatio(row.adaptiveLearnAlpha, defaults.adaptiveLearnAlpha, 0.05, 0.5),
    adaptiveUpdates: clampNonNegativeInt(row.adaptiveUpdates),
    dropRatioEma: clampRatio(row.dropRatioEma, defaults.dropRatioEma),
    capacityTrimRatioEma: clampRatio(row.capacityTrimRatioEma, defaults.capacityTrimRatioEma),
    lowConfidenceRatioEma: clampRatio(row.lowConfidenceRatioEma, defaults.lowConfidenceRatioEma),
    ageDropRatioEma: clampRatio(row.ageDropRatioEma, defaults.ageDropRatioEma),
    qualityLowRateEma: clampRatio(row.qualityLowRateEma, defaults.qualityLowRateEma),
    qualityPressureEma: clampRatio(row.qualityPressureEma, defaults.qualityPressureEma),
    hardBudgetFollowupDeltaEma: clampSigned(
      row.hardBudgetFollowupDeltaEma,
      defaults.hardBudgetFollowupDeltaEma,
      -1,
      1,
    ),
    qualityFirstFollowupDeltaEma: clampSigned(
      row.qualityFirstFollowupDeltaEma,
      defaults.qualityFirstFollowupDeltaEma,
      -1,
      1,
    ),
    lastReason:
      typeof row.lastReason === "string" && row.lastReason.trim().length > 0
        ? row.lastReason.trim()
        : defaults.lastReason,
    updatedAt:
      typeof row.updatedAt === "string" && row.updatedAt.trim().length > 0
        ? row.updatedAt
        : null,
  };
}

function readStateFromPath(
  path: string,
  basePolicy: MemoryOrchestratorPolicySnapshot,
): MemoryDecayAutotuneState | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return normalizeMemoryDecayAutotuneState(raw, basePolicy);
  } catch {
    return null;
  }
}

export function readMemoryDecayAutotuneState(input: {
  workDir?: string;
  basePolicy: MemoryOrchestratorPolicySnapshot;
}): MemoryDecayAutotuneState {
  if (!input.workDir || input.workDir.trim().length === 0) {
    return defaultMemoryDecayAutotuneState(input.basePolicy);
  }
  const readPaths = resolveContextStorageReadPaths(input.workDir, "memory_decay_autotune_state");
  for (const path of readPaths) {
    const state = readStateFromPath(path, input.basePolicy);
    if (state) {
      return state;
    }
  }
  return defaultMemoryDecayAutotuneState(input.basePolicy);
}

export function writeMemoryDecayAutotuneState(input: {
  workDir?: string;
  basePolicy: MemoryOrchestratorPolicySnapshot;
  state: MemoryDecayAutotuneState;
}): void {
  if (!input.workDir || input.workDir.trim().length === 0) {
    return;
  }
  const path = resolveStatePath(input.workDir);
  const parentDir = resolveParentDir(path);
  try {
    mkdirSync(parentDir, { recursive: true });
    const normalized = normalizeMemoryDecayAutotuneState(input.state, input.basePolicy);
    writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch {
    // best-effort persistence to avoid breaking turn flow.
  }
}

export function applyMemoryDecayAutotuneToPolicy(input: {
  basePolicy: MemoryOrchestratorPolicySnapshot;
  state: MemoryDecayAutotuneState;
}): MemoryOrchestratorPolicySnapshot {
  return {
    ...input.basePolicy,
    decayMaxRowsPerSession: input.state.maxRowsPerSession,
    decayMinConfidenceVerified: input.state.minConfidenceVerified,
    decayMinConfidenceUnverified: input.state.minConfidenceUnverified,
    decayUnverifiedMaxAgeHours: input.state.unverifiedMaxAgeHours,
  };
}

export function deriveMemoryDecayAutotuneState(input: {
  basePolicy: MemoryOrchestratorPolicySnapshot;
  currentState: MemoryDecayAutotuneState;
  stats: MemoryDecayAutotuneMaintenanceStats;
  quality?: MemoryDecayAutotuneQualitySnapshot;
  nowIso?: string;
}): MemoryDecayAutotuneUpdateResult {
  const current = normalizeMemoryDecayAutotuneState(input.currentState, input.basePolicy);
  const next = {
    ...current,
  };
  const droppedRows = Math.max(0, Math.floor(input.stats.droppedRows));
  const totalRowsBefore = Math.max(0, Math.floor(input.stats.totalRowsBefore));
  const dropRatio = totalRowsBefore > 0 ? droppedRows / totalRowsBefore : 0;
  const capacityTrimRatio = droppedRows > 0
    ? Math.max(0, input.stats.droppedByCapacity) / droppedRows
    : 0;
  const lowConfidenceRatio = droppedRows > 0
    ? Math.max(0, input.stats.droppedByConfidence) / droppedRows
    : 0;
  const ageDropRatio = droppedRows > 0
    ? Math.max(0, input.stats.droppedByAge) / droppedRows
    : 0;
  const alpha = current.adaptiveLearnAlpha;
  next.dropRatioEma = mixEma(current.dropRatioEma, dropRatio, alpha);
  next.capacityTrimRatioEma = mixEma(current.capacityTrimRatioEma, capacityTrimRatio, alpha);
  next.lowConfidenceRatioEma = mixEma(current.lowConfidenceRatioEma, lowConfidenceRatio, alpha);
  next.ageDropRatioEma = mixEma(current.ageDropRatioEma, ageDropRatio, alpha);
  const qualityLowRate = clampRatio(input.quality?.lowQualityRate, 0);
  const qualityPressure = clampRatio(input.quality?.averagePreSendPressureScore, 0);
  const hardBudgetFollowupDelta = clampSigned(
    input.quality?.hardBudgetFollowupOverallDelta,
    0,
    -1,
    1,
  );
  const qualityFirstFollowupDelta = clampSigned(
    input.quality?.qualityFirstFollowupOverallDelta,
    0,
    -1,
    1,
  );
  next.qualityLowRateEma = mixEma(current.qualityLowRateEma, qualityLowRate, alpha);
  next.qualityPressureEma = mixEma(current.qualityPressureEma, qualityPressure, alpha);
  next.hardBudgetFollowupDeltaEma = mixEma(
    current.hardBudgetFollowupDeltaEma,
    hardBudgetFollowupDelta,
    alpha,
  );
  next.qualityFirstFollowupDeltaEma = mixEma(
    current.qualityFirstFollowupDeltaEma,
    qualityFirstFollowupDelta,
    alpha,
  );

  const reasons: string[] = [];
  const maxRowsMin = Math.max(input.basePolicy.decayMinRowsToKeep + 2, 16);
  const maxRowsMax = Math.max(input.basePolicy.decayMaxRowsPerSession * 3, maxRowsMin + 24);
  const baseMaxRows = input.basePolicy.decayMaxRowsPerSession;

  if (
    droppedRows >= 6
    && next.capacityTrimRatioEma >= 0.3
  ) {
    next.maxRowsPerSession = clampToIntRange(
      next.maxRowsPerSession + 12,
      maxRowsMin,
      maxRowsMax,
    );
    reasons.push("capacity_pressure_expand");
  } else if (
    totalRowsBefore >= Math.floor(next.maxRowsPerSession * 0.9)
    && next.dropRatioEma <= 0.02
    && input.stats.sessionsScanned >= 3
  ) {
    next.maxRowsPerSession = clampToIntRange(
      next.maxRowsPerSession - 6,
      maxRowsMin,
      maxRowsMax,
    );
    reasons.push("low_pressure_shrink");
  } else if (next.maxRowsPerSession !== baseMaxRows && droppedRows === 0) {
    if (next.maxRowsPerSession > baseMaxRows) {
      next.maxRowsPerSession = clampToIntRange(
        next.maxRowsPerSession - 2,
        baseMaxRows,
        maxRowsMax,
      );
    } else {
      next.maxRowsPerSession = clampToIntRange(
        next.maxRowsPerSession + 2,
        maxRowsMin,
        baseMaxRows,
      );
    }
    reasons.push("max_rows_return_to_base");
  }

  if (droppedRows >= 5 && next.lowConfidenceRatioEma >= 0.35) {
    next.minConfidenceVerified = Number(
      clampWithBaseline(0.1, 0.75, next.minConfidenceVerified + 0.02).toFixed(4),
    );
    next.minConfidenceUnverified = Number(
      clampWithBaseline(0.2, 0.9, next.minConfidenceUnverified + 0.03).toFixed(4),
    );
    reasons.push("confidence_gate_tighten");
  } else if (droppedRows === 0 && input.stats.sessionsScanned >= 3) {
    if (next.minConfidenceVerified > input.basePolicy.decayMinConfidenceVerified) {
      next.minConfidenceVerified = Number(
        Math.max(
          input.basePolicy.decayMinConfidenceVerified,
          next.minConfidenceVerified - 0.01,
        ).toFixed(4),
      );
    }
    if (next.minConfidenceUnverified > input.basePolicy.decayMinConfidenceUnverified) {
      next.minConfidenceUnverified = Number(
        Math.max(
          input.basePolicy.decayMinConfidenceUnverified,
          next.minConfidenceUnverified - 0.01,
        ).toFixed(4),
      );
    }
    reasons.push("confidence_gate_relax");
  }

  const maxAgeHoursMax = Math.max(input.basePolicy.decayMaxAgeHoursL2, input.basePolicy.decayUnverifiedMaxAgeHours);
  if (droppedRows >= 5 && next.ageDropRatioEma >= 0.5) {
    next.unverifiedMaxAgeHours = clampToIntRange(
      next.unverifiedMaxAgeHours - 6,
      24,
      maxAgeHoursMax,
    );
    reasons.push("age_gate_tighten");
  } else if (droppedRows === 0 && next.unverifiedMaxAgeHours < input.basePolicy.decayUnverifiedMaxAgeHours) {
    next.unverifiedMaxAgeHours = clampToIntRange(
      next.unverifiedMaxAgeHours + 6,
      24,
      input.basePolicy.decayUnverifiedMaxAgeHours,
    );
    reasons.push("age_gate_relax");
  }

  const hardBudgetRate = clampRatio(input.quality?.hardBudgetRate, 0);
  const qualityFirstImprovedRate = clampRatio(input.quality?.qualityFirstImprovedRate, 0);
  const qualityPressureTighten =
    next.qualityLowRateEma >= 0.38
    && (
      next.qualityPressureEma >= 0.62
      || hardBudgetRate >= 0.5
      || next.hardBudgetFollowupDeltaEma <= -0.03
    );
  const qualitySignalRelax =
    next.qualityLowRateEma <= 0.2
    && next.qualityPressureEma <= 0.38
    && qualityFirstImprovedRate >= 0.6
    && next.qualityFirstFollowupDeltaEma >= -0.01;
  if (qualityPressureTighten) {
    next.maxRowsPerSession = clampToIntRange(
      next.maxRowsPerSession - 8,
      maxRowsMin,
      maxRowsMax,
    );
    next.minConfidenceVerified = Number(
      clampWithBaseline(0.1, 0.75, next.minConfidenceVerified + 0.015).toFixed(4),
    );
    next.minConfidenceUnverified = Number(
      clampWithBaseline(0.2, 0.9, next.minConfidenceUnverified + 0.02).toFixed(4),
    );
    reasons.push("quality_pressure_tighten");
  } else if (qualitySignalRelax) {
    next.maxRowsPerSession = clampToIntRange(
      next.maxRowsPerSession + 4,
      maxRowsMin,
      maxRowsMax,
    );
    next.minConfidenceVerified = Number(
      Math.max(
        input.basePolicy.decayMinConfidenceVerified,
        next.minConfidenceVerified - 0.01,
      ).toFixed(4),
    );
    next.minConfidenceUnverified = Number(
      Math.max(
        input.basePolicy.decayMinConfidenceUnverified,
        next.minConfidenceUnverified - 0.01,
      ).toFixed(4),
    );
    reasons.push("quality_signal_relax");
  }

  next.adaptiveUpdates = current.adaptiveUpdates + 1;
  next.lastReason = reasons.length > 0 ? reasons.join(",") : "stable";
  next.updatedAt = input.nowIso ?? new Date().toISOString();

  return {
    state: next,
    changed: !stateEquals(current, next),
    reason: next.lastReason,
  };
}
