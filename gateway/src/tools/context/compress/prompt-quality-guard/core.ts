import { type PromptCompactionStage } from "../../types";
import {
  type PromptQualityGuardAdaptiveMode,
  type PromptQualityGuardAdaptiveMutableMode,
  type PromptQualityGuardDriftAutoActionLevel,
  type PromptQualityGuardDriftWindowAlertLevel,
  type PromptQualityGuardOutcomeDriftGuard,
  type PromptQualityGuardOutcomeDriftWindowSummary,
  type PromptQualityGuardState,
} from "./contract";

export const DEFAULT_PRESSURE_UTILIZATION_THRESHOLD = 0.86;
export const DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD = 0.25;
export const DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD = 0.30;
export const DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD = 0.20;
export const DEFAULT_OUTCOME_REQUIRED_TRANSITIONS = 3;
export const DEFAULT_OUTCOME_COMBINED_EVIDENCE_SCORE = 0;
export const DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS = 0;
export const DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS = 0;
export const PRESSURE_LEARN_ALPHA_BASE = 0.35;
export const PRESSURE_LEARN_ALPHA_MIN = 0.18;
export const PRESSURE_LEARN_ALPHA_MAX = 0.68;
export const PRESSURE_JITTER_DEADBAND = 0.015;
export const PRESSURE_JITTER_DEADBAND_UTILIZATION = 0.01;
export const PRESSURE_MAX_STEP_UTILIZATION = 0.045;
export const PRESSURE_MAX_STEP_RATE = 0.06;
export const OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_BASE = 0.42;
export const OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MIN = 0.22;
export const OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MAX = 0.78;
export const OUTCOME_REQUIRED_TRANSITIONS_EWMA_MAX_STEP = 2;
export const OUTCOME_REQUIRED_TRANSITIONS_EWMA_DEADBAND = 0.35;
export const OUTCOME_DRIFT_GUARD_MIN_COMBINED_EVIDENCE_SCORE = 0.72;
export const OUTCOME_DRIFT_GUARD_HARDEN_RATE_THRESHOLD = 0.70;
export const OUTCOME_DRIFT_GUARD_MIN_HIGH_EVIDENCE_TURNS = 10;
export const OUTCOME_DRIFT_GUARD_COUNTER_CAP = 1_000_000;
export const OUTCOME_DRIFT_GUARD_MEDIUM_HARDEN_RATE_THRESHOLD = 0.78;
export const OUTCOME_DRIFT_GUARD_HARD_HARDEN_RATE_THRESHOLD = 0.86;
export const OUTCOME_DRIFT_GUARD_MEDIUM_MIN_HIGH_EVIDENCE_TURNS = 16;
export const OUTCOME_DRIFT_GUARD_HARD_MIN_HIGH_EVIDENCE_TURNS = 24;
export const OUTCOME_DRIFT_GUARD_AUTO_ACTION_WINDOW_SIZE = 32;

const DEFAULT_ADAPTIVE_MODE_ALLOWLIST: PromptQualityGuardAdaptiveMutableMode[] = ["harden", "relax"];

export function stageWeight(stage: PromptCompactionStage): number {
  switch (stage) {
    case "normal":
      return 0;
    case "proactive":
      return 1;
    case "forced":
      return 2;
    case "minimal":
      return 3;
    default:
      return 0;
  }
}

export function lowerStage(stage: PromptCompactionStage): PromptCompactionStage {
  switch (stage) {
    case "minimal":
      return "forced";
    case "forced":
      return "proactive";
    case "proactive":
      return "normal";
    default:
      return "normal";
  }
}

export function normalizeStage(raw: unknown): PromptCompactionStage {
  if (raw === "proactive" || raw === "forced" || raw === "minimal") {
    return raw;
  }
  return "normal";
}

export function clampUnitRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

export function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

export function clampNonNegativeInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return fallback;
  }
  return normalized;
}

export function resolveParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

export function normalizeAdaptiveModeAllowlist(
  raw: PromptQualityGuardAdaptiveMutableMode[] | undefined,
): PromptQualityGuardAdaptiveMutableMode[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_ADAPTIVE_MODE_ALLOWLIST];
  }
  const unique = new Set<PromptQualityGuardAdaptiveMutableMode>();
  for (const item of raw) {
    if (item === "harden" || item === "relax") {
      unique.add(item);
    }
  }
  if (unique.size === 0) {
    return [...DEFAULT_ADAPTIVE_MODE_ALLOWLIST];
  }
  return Array.from(unique.values());
}

export function defaultPromptQualityGuardState(): PromptQualityGuardState {
  return {
    floorStage: "normal",
    degradedStreak: 0,
    severeStreak: 0,
    healthyStreak: 0,
    holdTurnsRemaining: 0,
    lastReason: "init",
    updatedAt: null,
    pressureUtilizationThreshold: DEFAULT_PRESSURE_UTILIZATION_THRESHOLD,
    pressureSemanticRateThreshold: DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD,
    pressureAutoLimitRateThreshold: DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD,
    pressureJointRateThreshold: DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD,
    pressureTrendUtilizationDelta: 0,
    pressureTrendSemanticDelta: 0,
    pressureTrendAutoLimitDelta: 0,
    pressureTrendMomentum: 0,
    outcomeRequiredTransitions: DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
    outcomeCombinedEvidenceScore: DEFAULT_OUTCOME_COMBINED_EVIDENCE_SCORE,
    outcomeHighEvidenceTurns: DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS,
    outcomeHighEvidenceHardenTurns: DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS,
    outcomeDriftRecentAutoActionLevels: [],
  };
}

export function normalizeMaxFloorStage(raw: PromptCompactionStage): PromptCompactionStage {
  if (raw === "minimal" || raw === "forced" || raw === "proactive") {
    return raw;
  }
  return "forced";
}

export function clampPressureUtilizationThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(0.98, Math.max(0.70, value));
}

export function clampPressureRateThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(0.95, Math.max(0.05, value));
}

export function clampSignedUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(-1, value));
}

export function roundThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function smoothThreshold(current: number, target: number, alpha: number): number {
  const normalizedAlpha = Math.min(1, Math.max(0, alpha));
  return roundThreshold(current + (target - current) * normalizedAlpha);
}

export function smoothThresholdWithGuard(args: {
  current: number;
  target: number;
  alpha: number;
  deadband: number;
  maxStep: number;
}): number {
  const delta = args.target - args.current;
  const deadband = Math.max(0, args.deadband);
  if (Math.abs(delta) < deadband) {
    return roundThreshold(args.current);
  }
  const dampedAlpha = Math.abs(delta) < deadband * 3
    ? clampLearnAlpha(args.alpha * 0.55)
    : clampLearnAlpha(args.alpha);
  const smoothed = smoothThreshold(args.current, args.target, dampedAlpha);
  const maxStep = Math.abs(args.maxStep);
  const step = smoothed - args.current;
  const clampedStep = Math.max(-maxStep, Math.min(maxStep, step));
  return roundThreshold(args.current + clampedStep);
}

export function clampLearnAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return PRESSURE_LEARN_ALPHA_BASE;
  }
  return roundThreshold(
    Math.min(PRESSURE_LEARN_ALPHA_MAX, Math.max(PRESSURE_LEARN_ALPHA_MIN, value)),
  );
}

export function clampRequiredTransitions(value: number, fallback: number): number {
  return Math.min(8, Math.max(2, clampPositiveInt(value, fallback)));
}

export function clampOutcomeDriftCounter(value: number, fallback: number): number {
  return Math.min(
    OUTCOME_DRIFT_GUARD_COUNTER_CAP,
    Math.max(0, clampNonNegativeInt(value, fallback)),
  );
}

function normalizeDriftAutoActionLevel(raw: unknown): PromptQualityGuardDriftAutoActionLevel {
  if (raw === "soft" || raw === "medium" || raw === "hard") {
    return raw;
  }
  return "none";
}

export function normalizeDriftAutoActionLevels(raw: unknown): PromptQualityGuardDriftAutoActionLevel[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const levels: PromptQualityGuardDriftAutoActionLevel[] = [];
  for (const item of raw) {
    levels.push(normalizeDriftAutoActionLevel(item));
  }
  if (levels.length <= OUTCOME_DRIFT_GUARD_AUTO_ACTION_WINDOW_SIZE) {
    return levels;
  }
  return levels.slice(-OUTCOME_DRIFT_GUARD_AUTO_ACTION_WINDOW_SIZE);
}

function appendDriftAutoActionLevel(
  levels: readonly PromptQualityGuardDriftAutoActionLevel[],
  level: PromptQualityGuardDriftAutoActionLevel,
): PromptQualityGuardDriftAutoActionLevel[] {
  const next = [...levels, level];
  if (next.length <= OUTCOME_DRIFT_GUARD_AUTO_ACTION_WINDOW_SIZE) {
    return next;
  }
  return next.slice(-OUTCOME_DRIFT_GUARD_AUTO_ACTION_WINDOW_SIZE);
}

export function clampEwmaAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_BASE;
  }
  return Math.min(
    OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MAX,
    Math.max(OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MIN, value),
  );
}

export function deriveOutcomeRequiredTransitionsEwma(args: {
  baseline: number;
  target: number;
  alpha: number;
}): number {
  const baseline = clampRequiredTransitions(args.baseline, DEFAULT_OUTCOME_REQUIRED_TRANSITIONS);
  const target = clampRequiredTransitions(args.target, baseline);
  const alpha = clampEwmaAlpha(args.alpha);
  const raw = baseline + (target - baseline) * alpha;
  if (Math.abs(raw - baseline) < OUTCOME_REQUIRED_TRANSITIONS_EWMA_DEADBAND) {
    return baseline;
  }
  const step = Math.max(
    -OUTCOME_REQUIRED_TRANSITIONS_EWMA_MAX_STEP,
    Math.min(OUTCOME_REQUIRED_TRANSITIONS_EWMA_MAX_STEP, raw - baseline),
  );
  return clampRequiredTransitions(Math.round(baseline + step), baseline);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function isHighEvidenceOutcome(args: {
  combinedEvidenceScore: number;
  hardBudgetReliable: boolean;
  qualityFirstReliable: boolean;
}): boolean {
  return (
    args.combinedEvidenceScore >= OUTCOME_DRIFT_GUARD_MIN_COMBINED_EVIDENCE_SCORE
    && (args.hardBudgetReliable || args.qualityFirstReliable)
  );
}

function derivePromptQualityGuardDriftWindowAlertLevel(args: {
  entries: number;
  latest: PromptQualityGuardDriftAutoActionLevel;
  mediumOrHardRate: number;
  hardRate: number;
  activeRate: number;
  transitionCount: number;
}): PromptQualityGuardDriftWindowAlertLevel {
  if (args.entries < 8) {
    return "green";
  }
  const transitionRate = args.entries > 1
    ? args.transitionCount / (args.entries - 1)
    : 0;
  const red =
    args.hardRate >= 0.35
    || args.mediumOrHardRate >= 0.72
    || (args.latest === "hard" && args.entries >= 12)
    || transitionRate >= 0.78;
  if (red) {
    return "red";
  }
  const yellow =
    args.hardRate >= 0.12
    || args.mediumOrHardRate >= 0.45
    || args.activeRate >= 0.66
    || transitionRate >= 0.52;
  if (yellow) {
    return "yellow";
  }
  return "green";
}

export function derivePromptQualityGuardOutcomeDriftWindowSummary(
  levelsInput: readonly PromptQualityGuardDriftAutoActionLevel[],
): PromptQualityGuardOutcomeDriftWindowSummary {
  const levels = normalizeDriftAutoActionLevels(levelsInput);
  const entries = levels.length;
  const levelCounts: Record<PromptQualityGuardDriftAutoActionLevel, number> = {
    none: 0,
    soft: 0,
    medium: 0,
    hard: 0,
  };
  let transitionCount = 0;
  let previous: PromptQualityGuardDriftAutoActionLevel | null = null;
  for (const level of levels) {
    levelCounts[level] += 1;
    if (previous !== null && previous !== level) {
      transitionCount += 1;
    }
    previous = level;
  }
  const latest = entries > 0 ? levels[entries - 1] : "none";
  const dominant = (
    Object.entries(levelCounts) as Array<[PromptQualityGuardDriftAutoActionLevel, number]>
  ).reduce<PromptQualityGuardDriftAutoActionLevel>((best, [candidate, count]) => {
    if (count > levelCounts[best]) {
      return candidate;
    }
    if (count === levelCounts[best] && candidate === latest) {
      return candidate;
    }
    return best;
  }, "none");
  const activeCount = levelCounts.soft + levelCounts.medium + levelCounts.hard;
  const mediumOrHardCount = levelCounts.medium + levelCounts.hard;
  const activeRate = entries > 0 ? roundThreshold(activeCount / entries) : 0;
  const mediumOrHardRate = entries > 0 ? roundThreshold(mediumOrHardCount / entries) : 0;
  const hardRate = entries > 0 ? roundThreshold(levelCounts.hard / entries) : 0;
  const alertLevel = derivePromptQualityGuardDriftWindowAlertLevel({
    entries,
    latest,
    mediumOrHardRate,
    hardRate,
    activeRate,
    transitionCount,
  });
  return {
    windowSize: OUTCOME_DRIFT_GUARD_AUTO_ACTION_WINDOW_SIZE,
    entries,
    latest,
    dominant,
    alertLevel,
    transitionCount,
    activeRate,
    mediumOrHardRate,
    hardRate,
    levelCounts,
  };
}

function deriveDriftAutoActionLevel(args: {
  highEvidenceHardenBias: boolean;
  highEvidenceTurns: number;
  highEvidenceHardenRate: number;
  recentWindow: PromptQualityGuardOutcomeDriftWindowSummary;
}): PromptQualityGuardDriftAutoActionLevel {
  if (!args.highEvidenceHardenBias) {
    return "none";
  }
  const recentMediumOrHardSticky =
    args.recentWindow.entries >= 10
    && args.recentWindow.mediumOrHardRate >= 0.65;
  const recentHardSticky =
    args.recentWindow.entries >= 10
    && args.recentWindow.hardRate >= 0.40;
  if (
    recentHardSticky
    || (
      args.highEvidenceTurns >= OUTCOME_DRIFT_GUARD_HARD_MIN_HIGH_EVIDENCE_TURNS
      && args.highEvidenceHardenRate >= OUTCOME_DRIFT_GUARD_HARD_HARDEN_RATE_THRESHOLD
    )
  ) {
    return "hard";
  }
  if (
    recentMediumOrHardSticky
    || (
      args.highEvidenceTurns >= OUTCOME_DRIFT_GUARD_MEDIUM_MIN_HIGH_EVIDENCE_TURNS
      && args.highEvidenceHardenRate >= OUTCOME_DRIFT_GUARD_MEDIUM_HARDEN_RATE_THRESHOLD
    )
  ) {
    return "medium";
  }
  return "soft";
}

export function derivePromptQualityGuardOutcomeDriftGuard(args: {
  highEvidenceTurn: boolean;
  highEvidenceTurns: number;
  highEvidenceHardenTurns: number;
  recentAutoActionLevels?: readonly PromptQualityGuardDriftAutoActionLevel[];
}): PromptQualityGuardOutcomeDriftGuard {
  const highEvidenceTurns = clampOutcomeDriftCounter(
    args.highEvidenceTurns,
    DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS,
  );
  const highEvidenceHardenTurns = Math.min(
    highEvidenceTurns,
    clampOutcomeDriftCounter(
      args.highEvidenceHardenTurns,
      DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS,
    ),
  );
  const highEvidenceHardenRate = highEvidenceTurns > 0
    ? roundThreshold(highEvidenceHardenTurns / highEvidenceTurns)
    : 0;
  const highEvidenceHardenBias =
    highEvidenceTurns >= OUTCOME_DRIFT_GUARD_MIN_HIGH_EVIDENCE_TURNS
    && highEvidenceHardenRate >= OUTCOME_DRIFT_GUARD_HARDEN_RATE_THRESHOLD;
  const recentAutoActionLevels = normalizeDriftAutoActionLevels(
    args.recentAutoActionLevels ?? [],
  );
  const recentWindow = derivePromptQualityGuardOutcomeDriftWindowSummary(recentAutoActionLevels);
  const autoActionLevel = deriveDriftAutoActionLevel({
    highEvidenceHardenBias,
    highEvidenceTurns,
    highEvidenceHardenRate,
    recentWindow,
  });
  return {
    highEvidenceHardenBias,
    highEvidenceTurn: args.highEvidenceTurn,
    highEvidenceTurns,
    highEvidenceHardenTurns,
    highEvidenceHardenRate,
    thresholdHardenRate: OUTCOME_DRIFT_GUARD_HARDEN_RATE_THRESHOLD,
    minHighEvidenceTurns: OUTCOME_DRIFT_GUARD_MIN_HIGH_EVIDENCE_TURNS,
    autoActionLevel,
    recentAutoActionLevels,
    windowSummary: recentWindow,
    reason: highEvidenceHardenBias ? "high_evidence_harden_bias" : "ok",
    recommendation: highEvidenceHardenBias ? "prefer_relax" : "none",
  };
}

export function advancePromptQualityGuardOutcomeDriftGuard(input: {
  currentState: PromptQualityGuardState;
  mode: PromptQualityGuardAdaptiveMode;
  combinedEvidenceScore: number;
  hardBudgetReliable: boolean;
  qualityFirstReliable: boolean;
}): {
  highEvidenceTurns: number;
  highEvidenceHardenTurns: number;
  recentAutoActionLevels: PromptQualityGuardDriftAutoActionLevel[];
  driftGuard: PromptQualityGuardOutcomeDriftGuard;
} {
  const currentState = input.currentState;
  const highEvidenceTurn = isHighEvidenceOutcome({
    combinedEvidenceScore: input.combinedEvidenceScore,
    hardBudgetReliable: input.hardBudgetReliable,
    qualityFirstReliable: input.qualityFirstReliable,
  });
  let highEvidenceTurns = clampOutcomeDriftCounter(
    currentState.outcomeHighEvidenceTurns,
    DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS,
  );
  let highEvidenceHardenTurns = Math.min(
    highEvidenceTurns,
    clampOutcomeDriftCounter(
      currentState.outcomeHighEvidenceHardenTurns,
      DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS,
    ),
  );
  if (highEvidenceTurn) {
    highEvidenceTurns = clampOutcomeDriftCounter(highEvidenceTurns + 1, highEvidenceTurns);
    if (input.mode === "harden") {
      highEvidenceHardenTurns = clampOutcomeDriftCounter(
        highEvidenceHardenTurns + 1,
        highEvidenceHardenTurns,
      );
    }
    highEvidenceHardenTurns = Math.min(highEvidenceHardenTurns, highEvidenceTurns);
  }
  const currentRecentAutoActionLevels = normalizeDriftAutoActionLevels(
    currentState.outcomeDriftRecentAutoActionLevels,
  );
  const provisionalDriftGuard = derivePromptQualityGuardOutcomeDriftGuard({
    highEvidenceTurn,
    highEvidenceTurns,
    highEvidenceHardenTurns,
    recentAutoActionLevels: currentRecentAutoActionLevels,
  });
  const recentAutoActionLevels = appendDriftAutoActionLevel(
    currentRecentAutoActionLevels,
    provisionalDriftGuard.autoActionLevel,
  );
  const driftGuard = derivePromptQualityGuardOutcomeDriftGuard({
    highEvidenceTurn,
    highEvidenceTurns,
    highEvidenceHardenTurns,
    recentAutoActionLevels,
  });
  return {
    highEvidenceTurns,
    highEvidenceHardenTurns,
    recentAutoActionLevels,
    driftGuard,
  };
}
