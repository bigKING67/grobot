import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type PromptCompactionStage } from "../types";

const QUALITY_GUARD_STATE_RELATIVE_PATH = ".grobot/context/prompt-quality-guard-state.json";
const DEFAULT_PRESSURE_UTILIZATION_THRESHOLD = 0.86;
const DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD = 0.25;
const DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD = 0.30;
const DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD = 0.20;
const DEFAULT_OUTCOME_REQUIRED_TRANSITIONS = 3;
const DEFAULT_OUTCOME_COMBINED_EVIDENCE_SCORE = 0;
const DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS = 0;
const DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS = 0;
const PRESSURE_LEARN_ALPHA_BASE = 0.35;
const PRESSURE_LEARN_ALPHA_MIN = 0.18;
const PRESSURE_LEARN_ALPHA_MAX = 0.68;
const PRESSURE_JITTER_DEADBAND = 0.015;
const PRESSURE_JITTER_DEADBAND_UTILIZATION = 0.01;
const PRESSURE_MAX_STEP_UTILIZATION = 0.045;
const PRESSURE_MAX_STEP_RATE = 0.06;
const OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_BASE = 0.42;
const OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MIN = 0.22;
const OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MAX = 0.78;
const OUTCOME_REQUIRED_TRANSITIONS_EWMA_MAX_STEP = 2;
const OUTCOME_REQUIRED_TRANSITIONS_EWMA_DEADBAND = 0.35;
const OUTCOME_DRIFT_GUARD_MIN_COMBINED_EVIDENCE_SCORE = 0.72;
const OUTCOME_DRIFT_GUARD_HARDEN_RATE_THRESHOLD = 0.70;
const OUTCOME_DRIFT_GUARD_MIN_HIGH_EVIDENCE_TURNS = 10;
const OUTCOME_DRIFT_GUARD_COUNTER_CAP = 1_000_000;
const OUTCOME_DRIFT_GUARD_MEDIUM_HARDEN_RATE_THRESHOLD = 0.78;
const OUTCOME_DRIFT_GUARD_HARD_HARDEN_RATE_THRESHOLD = 0.86;
const OUTCOME_DRIFT_GUARD_MEDIUM_MIN_HIGH_EVIDENCE_TURNS = 16;
const OUTCOME_DRIFT_GUARD_HARD_MIN_HIGH_EVIDENCE_TURNS = 24;
const OUTCOME_DRIFT_GUARD_AUTO_ACTION_WINDOW_SIZE = 32;

function stageWeight(stage: PromptCompactionStage): number {
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

function lowerStage(stage: PromptCompactionStage): PromptCompactionStage {
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

function normalizeStage(raw: unknown): PromptCompactionStage {
  if (raw === "proactive" || raw === "forced" || raw === "minimal") {
    return raw;
  }
  return "normal";
}

function clampUnitRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function clampNonNegativeInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return fallback;
  }
  return normalized;
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
  return resolve(workDir, QUALITY_GUARD_STATE_RELATIVE_PATH);
}

export interface PromptQualityGuardPolicy {
  enabled: boolean;
  promoteStreak: number;
  severePromoteStreak: number;
  releaseStreak: number;
  holdTurns: number;
  maxFloorStage: PromptCompactionStage;
  severeOverallThreshold: number;
  severeLowQualityRateThreshold: number;
}

export interface PromptQualityGuardState {
  floorStage: PromptCompactionStage;
  degradedStreak: number;
  severeStreak: number;
  healthyStreak: number;
  holdTurnsRemaining: number;
  lastReason: string;
  updatedAt: string | null;
  pressureUtilizationThreshold: number;
  pressureSemanticRateThreshold: number;
  pressureAutoLimitRateThreshold: number;
  pressureJointRateThreshold: number;
  pressureTrendUtilizationDelta: number;
  pressureTrendSemanticDelta: number;
  pressureTrendAutoLimitDelta: number;
  pressureTrendMomentum: number;
  outcomeRequiredTransitions: number;
  outcomeCombinedEvidenceScore: number;
  outcomeHighEvidenceTurns: number;
  outcomeHighEvidenceHardenTurns: number;
  outcomeDriftRecentAutoActionLevels: PromptQualityGuardDriftAutoActionLevel[];
}

export interface PromptQualityGuardObservation {
  degraded: boolean;
  reason: string;
  observedOverall: number | null;
  observedLowQualityRate: number | null;
}

export interface PromptQualityGuardDecision {
  floorStage: PromptCompactionStage;
  triggered: boolean;
  promoted: boolean;
  released: boolean;
  severe: boolean;
  severeEscalated: boolean;
  state: PromptQualityGuardState;
}

export type PromptQualityGuardRuntimePhase =
  | "disabled"
  | "idle"
  | "escalating"
  | "holding"
  | "recovering";

export type PromptQualityGuardRuntimeTransition = "none" | "promote" | "hold" | "release";

export interface PromptQualityGuardRuntimeAssessment {
  enabled: boolean;
  phase: PromptQualityGuardRuntimePhase;
  transition: PromptQualityGuardRuntimeTransition;
  degraded: boolean;
  severe: boolean;
  reason: string;
  triggered: boolean;
  floorStage: PromptCompactionStage;
  proposedFloorStage: PromptCompactionStage;
  promoteRemaining: number;
  severePromoteRemaining: number;
  releaseRemaining: number;
  holdTurnsRemaining: number;
  observedOverall: number | null;
  observedLowQualityRate: number | null;
}

export type PromptQualityGuardAdaptiveMode = "disabled" | "stable" | "harden" | "relax";
export type PromptQualityGuardAdaptiveMutableMode = Exclude<
  PromptQualityGuardAdaptiveMode,
  "disabled" | "stable"
>;

const DEFAULT_ADAPTIVE_MODE_ALLOWLIST: PromptQualityGuardAdaptiveMutableMode[] = ["harden", "relax"];

export interface PromptQualityGuardAdaptiveInput {
  basePolicy: PromptQualityGuardPolicy;
  adaptiveEnabled: boolean;
  adaptiveModeAllowlist?: PromptQualityGuardAdaptiveMutableMode[];
  currentState: PromptQualityGuardState;
  window: {
    degraded: boolean;
    reason: string;
    lowQualityRate: number | null;
    averageOverall: number | null;
    observedOverall: number | null;
    observedLowQualityRate: number | null;
    snapshotSemanticCompressRate: number | null;
    autoLimitTriggeredRate: number | null;
    averageUtilizationRatio: number | null;
    shortSnapshotSemanticCompressRate?: number | null;
    mediumSnapshotSemanticCompressRate?: number | null;
    shortAutoLimitTriggeredRate?: number | null;
    mediumAutoLimitTriggeredRate?: number | null;
    shortAverageUtilizationRatio?: number | null;
    mediumAverageUtilizationRatio?: number | null;
    hardBudgetStrategyRate?: number | null;
    qualityFirstStrategyRate?: number | null;
    averagePreSendOverflowRatio?: number | null;
    averagePreSendPressureScore?: number | null;
    shortHardBudgetStrategyRate?: number | null;
    mediumHardBudgetStrategyRate?: number | null;
    shortAveragePreSendOverflowRatio?: number | null;
    mediumAveragePreSendOverflowRatio?: number | null;
    shortAveragePreSendPressureScore?: number | null;
    mediumAveragePreSendPressureScore?: number | null;
    hardBudgetFollowupOverallDelta?: number | null;
    qualityFirstFollowupOverallDelta?: number | null;
    hardBudgetRecoveryRate?: number | null;
    qualityFirstImprovedRate?: number | null;
    hardBudgetTransitionCount?: number | null;
    qualityFirstTransitionCount?: number | null;
  };
}

export interface PromptQualityGuardAdaptiveDecision {
  enabled: boolean;
  mode: PromptQualityGuardAdaptiveMode;
  reason: string;
  allowlist: PromptQualityGuardAdaptiveMutableMode[];
  modeBlocked: boolean;
  blockedMode: PromptQualityGuardAdaptiveMutableMode | null;
  basePolicy: PromptQualityGuardPolicy;
  effectivePolicy: PromptQualityGuardPolicy;
  adjustment: {
    promoteStreakDelta: number;
    severePromoteStreakDelta: number;
    releaseStreakDelta: number;
    holdTurnsDelta: number;
  };
  pressurePolicy: {
    source: "state" | "learned";
    updated: boolean;
    learnAlpha: number;
    utilizationThreshold: number;
    semanticRateThreshold: number;
    autoLimitRateThreshold: number;
    jointRateThreshold: number;
    trendUtilizationDelta: number;
    trendSemanticDelta: number;
    trendAutoLimitDelta: number;
    trendMomentum: number;
    trendFlipSuppressed: boolean;
  };
  outcomeReliability: {
    requiredTransitions: number;
    nextRequiredTransitions: number;
    hardBudgetTransitions: number;
    qualityFirstTransitions: number;
    hardBudgetEvidenceScore: number;
    qualityFirstEvidenceScore: number;
    combinedEvidenceScore: number;
    hardBudgetReliable: boolean;
    qualityFirstReliable: boolean;
  };
  outcomeDriftGuard: PromptQualityGuardOutcomeDriftGuard;
}

export interface PromptQualityGuardOutcomeDriftGuard {
  highEvidenceHardenBias: boolean;
  highEvidenceTurn: boolean;
  highEvidenceTurns: number;
  highEvidenceHardenTurns: number;
  highEvidenceHardenRate: number;
  thresholdHardenRate: number;
  minHighEvidenceTurns: number;
  autoActionLevel: PromptQualityGuardDriftAutoActionLevel;
  recentAutoActionLevels: PromptQualityGuardDriftAutoActionLevel[];
  windowSummary: PromptQualityGuardOutcomeDriftWindowSummary;
  reason: "ok" | "high_evidence_harden_bias";
  recommendation: "none" | "prefer_relax";
}

export type PromptQualityGuardDriftAutoActionLevel = "none" | "soft" | "medium" | "hard";
export type PromptQualityGuardDriftWindowAlertLevel = "green" | "yellow" | "red";

export interface PromptQualityGuardOutcomeDriftWindowSummary {
  windowSize: number;
  entries: number;
  latest: PromptQualityGuardDriftAutoActionLevel;
  dominant: PromptQualityGuardDriftAutoActionLevel;
  alertLevel: PromptQualityGuardDriftWindowAlertLevel;
  transitionCount: number;
  activeRate: number;
  mediumOrHardRate: number;
  hardRate: number;
  levelCounts: Record<PromptQualityGuardDriftAutoActionLevel, number>;
}

function normalizeAdaptiveModeAllowlist(
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

function normalizeMaxFloorStage(raw: PromptCompactionStage): PromptCompactionStage {
  if (raw === "minimal" || raw === "forced" || raw === "proactive") {
    return raw;
  }
  return "forced";
}

function clampPressureUtilizationThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(0.98, Math.max(0.70, value));
}

function clampPressureRateThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(0.95, Math.max(0.05, value));
}

function clampSignedUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(-1, value));
}

function roundThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function smoothThreshold(current: number, target: number, alpha: number): number {
  const normalizedAlpha = Math.min(1, Math.max(0, alpha));
  return roundThreshold(current + (target - current) * normalizedAlpha);
}

function smoothThresholdWithGuard(args: {
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

function clampLearnAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return PRESSURE_LEARN_ALPHA_BASE;
  }
  return roundThreshold(
    Math.min(PRESSURE_LEARN_ALPHA_MAX, Math.max(PRESSURE_LEARN_ALPHA_MIN, value)),
  );
}

function clampRequiredTransitions(value: number, fallback: number): number {
  return Math.min(8, Math.max(2, clampPositiveInt(value, fallback)));
}

function clampOutcomeDriftCounter(value: number, fallback: number): number {
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

function normalizeDriftAutoActionLevels(raw: unknown): PromptQualityGuardDriftAutoActionLevel[] {
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

function clampEwmaAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_BASE;
  }
  return Math.min(
    OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MAX,
    Math.max(OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_MIN, value),
  );
}

function deriveOutcomeRequiredTransitionsEwma(args: {
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

function clamp01(value: number): number {
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
  const currentState = normalizePromptQualityGuardState(input.currentState);
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

function deriveAdaptiveLearnAlpha(args: {
  window: PromptQualityGuardAdaptiveInput["window"];
  guardTriggered: boolean;
  baseUtilization: number;
  baseSemantic: number;
  baseAutoLimit: number;
  trendRising: boolean;
  trendFalling: boolean;
  trendFlipSuppressed: boolean;
}): number {
  const deltas: number[] = [];
  if (typeof args.window.averageUtilizationRatio === "number") {
    deltas.push(Math.abs(args.window.averageUtilizationRatio - args.baseUtilization));
  }
  if (typeof args.window.snapshotSemanticCompressRate === "number") {
    deltas.push(Math.abs(args.window.snapshotSemanticCompressRate - args.baseSemantic));
  }
  if (typeof args.window.autoLimitTriggeredRate === "number") {
    deltas.push(Math.abs(args.window.autoLimitTriggeredRate - args.baseAutoLimit));
  }
  if (deltas.length === 0) {
    return PRESSURE_LEARN_ALPHA_BASE;
  }
  const meanDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  let alpha = PRESSURE_LEARN_ALPHA_BASE + meanDelta * 0.9;
  if (args.window.degraded || args.guardTriggered) {
    alpha += 0.08;
  } else {
    alpha -= 0.05;
  }
  if (args.trendRising) {
    alpha += 0.06;
  } else if (args.trendFalling) {
    alpha -= 0.04;
  }
  if (args.trendFlipSuppressed) {
    alpha -= 0.09;
  }
  return clampLearnAlpha(alpha);
}

function deriveAdaptivePressurePolicy(args: {
  state: PromptQualityGuardState;
  window: PromptQualityGuardAdaptiveInput["window"];
  guardTriggered: boolean;
}): {
  source: "state" | "learned";
  updated: boolean;
  learnAlpha: number;
  utilizationThreshold: number;
  semanticRateThreshold: number;
  autoLimitRateThreshold: number;
  jointRateThreshold: number;
  trendUtilizationDelta: number;
  trendSemanticDelta: number;
  trendAutoLimitDelta: number;
  trendMomentum: number;
  trendFlipSuppressed: boolean;
} {
  const baseUtilization = clampPressureUtilizationThreshold(
    args.state.pressureUtilizationThreshold,
    DEFAULT_PRESSURE_UTILIZATION_THRESHOLD,
  );
  const baseSemantic = clampPressureRateThreshold(
    args.state.pressureSemanticRateThreshold,
    DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD,
  );
  const baseAutoLimit = clampPressureRateThreshold(
    args.state.pressureAutoLimitRateThreshold,
    DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD,
  );
  const baseJoint = clampPressureRateThreshold(
    args.state.pressureJointRateThreshold,
    DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD,
  );
  const hasWindowPressureSignal =
    typeof args.window.snapshotSemanticCompressRate === "number"
    || typeof args.window.autoLimitTriggeredRate === "number"
    || typeof args.window.averageUtilizationRatio === "number"
    || typeof args.window.averagePreSendPressureScore === "number"
    || typeof args.window.averagePreSendOverflowRatio === "number"
    || typeof args.window.hardBudgetStrategyRate === "number";
  if (!hasWindowPressureSignal) {
    return {
      source: "state",
      updated: false,
      learnAlpha: PRESSURE_LEARN_ALPHA_BASE,
      utilizationThreshold: baseUtilization,
      semanticRateThreshold: baseSemantic,
      autoLimitRateThreshold: baseAutoLimit,
      jointRateThreshold: baseJoint,
      trendUtilizationDelta: roundThreshold(
        clampSignedUnit(args.state.pressureTrendUtilizationDelta, 0),
      ),
      trendSemanticDelta: roundThreshold(
        clampSignedUnit(args.state.pressureTrendSemanticDelta, 0),
      ),
      trendAutoLimitDelta: roundThreshold(
        clampSignedUnit(args.state.pressureTrendAutoLimitDelta, 0),
      ),
      trendMomentum: roundThreshold(
        clampSignedUnit(args.state.pressureTrendMomentum, 0),
      ),
      trendFlipSuppressed: false,
    };
  }
  const observedUtilization = typeof args.window.averageUtilizationRatio === "number"
    ? args.window.averageUtilizationRatio
    : baseUtilization;
  const observedSemanticRate = typeof args.window.snapshotSemanticCompressRate === "number"
    ? args.window.snapshotSemanticCompressRate
    : baseSemantic;
  const observedAutoLimitRate = typeof args.window.autoLimitTriggeredRate === "number"
    ? args.window.autoLimitTriggeredRate
    : baseAutoLimit;
  const trendUtilizationDelta = roundThreshold(
    clampSignedUnit(
      (
        typeof args.window.shortAverageUtilizationRatio === "number"
        && typeof args.window.mediumAverageUtilizationRatio === "number"
      )
        ? args.window.shortAverageUtilizationRatio - args.window.mediumAverageUtilizationRatio
        : args.state.pressureTrendUtilizationDelta,
      0,
    ),
  );
  const trendSemanticDelta = roundThreshold(
    clampSignedUnit(
      (
        typeof args.window.shortSnapshotSemanticCompressRate === "number"
        && typeof args.window.mediumSnapshotSemanticCompressRate === "number"
      )
        ? args.window.shortSnapshotSemanticCompressRate - args.window.mediumSnapshotSemanticCompressRate
        : args.state.pressureTrendSemanticDelta,
      0,
    ),
  );
  const trendAutoLimitDelta = roundThreshold(
    clampSignedUnit(
      (
        typeof args.window.shortAutoLimitTriggeredRate === "number"
        && typeof args.window.mediumAutoLimitTriggeredRate === "number"
      )
        ? args.window.shortAutoLimitTriggeredRate - args.window.mediumAutoLimitTriggeredRate
        : args.state.pressureTrendAutoLimitDelta,
      0,
    ),
  );
  const trendSignal = roundThreshold(
    clampSignedUnit(
      trendUtilizationDelta * 0.45
      + trendSemanticDelta * 0.30
      + trendAutoLimitDelta * 0.25,
      0,
    ),
  );
  const previousTrendMomentum = roundThreshold(
    clampSignedUnit(args.state.pressureTrendMomentum, 0),
  );
  const trendMomentum = roundThreshold(
    clampSignedUnit(previousTrendMomentum * 0.65 + trendSignal * 0.35, 0),
  );
  const trendRising = trendMomentum >= 0.04 || trendSignal >= 0.06;
  const trendFalling = trendMomentum <= -0.04 || trendSignal <= -0.06;
  const trendFlipSuppressed =
    Math.sign(previousTrendMomentum) !== 0
    && Math.sign(trendMomentum) !== 0
    && Math.sign(previousTrendMomentum) !== Math.sign(trendMomentum)
    && Math.abs(trendMomentum) < 0.16;
  const learnAlpha = deriveAdaptiveLearnAlpha({
    window: args.window,
    guardTriggered: args.guardTriggered,
    baseUtilization,
    baseSemantic,
    baseAutoLimit,
    trendRising,
    trendFalling,
    trendFlipSuppressed,
  });
  let utilizationTarget = clampPressureUtilizationThreshold(
    observedUtilization + 0.03,
    baseUtilization,
  );
  let semanticRateTarget = clampPressureRateThreshold(
    observedSemanticRate + 0.06,
    baseSemantic,
  );
  let autoLimitRateTarget = clampPressureRateThreshold(
    observedAutoLimitRate + 0.08,
    baseAutoLimit,
  );
  const strategyStress = Math.min(
    1,
    Math.max(
      0,
      (typeof args.window.averagePreSendPressureScore === "number"
        ? args.window.averagePreSendPressureScore
        : 0)
      + (typeof args.window.averagePreSendOverflowRatio === "number"
        ? args.window.averagePreSendOverflowRatio * 1.8
        : 0)
      + (typeof args.window.hardBudgetStrategyRate === "number"
        ? args.window.hardBudgetStrategyRate * 0.6
        : 0),
    ),
  );
  const strategyRecovered =
    (typeof args.window.qualityFirstStrategyRate !== "number"
      || args.window.qualityFirstStrategyRate >= 0.62)
    && (typeof args.window.hardBudgetStrategyRate !== "number"
      || args.window.hardBudgetStrategyRate <= 0.24)
    && (typeof args.window.averagePreSendPressureScore !== "number"
      || args.window.averagePreSendPressureScore <= 0.42)
    && (typeof args.window.averagePreSendOverflowRatio !== "number"
      || args.window.averagePreSendOverflowRatio <= 0.08);
  if (args.window.degraded) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget - 0.03,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget - 0.03,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget - 0.03,
      autoLimitRateTarget,
    );
  } else if (strategyStress >= 0.56) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget - 0.015,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget - 0.015,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget - 0.015,
      autoLimitRateTarget,
    );
  } else if (!args.guardTriggered && strategyRecovered) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget + 0.008,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget + 0.008,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget + 0.008,
      autoLimitRateTarget,
    );
  } else if (!args.guardTriggered) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget + 0.01,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget + 0.01,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget + 0.01,
      autoLimitRateTarget,
    );
  }
  const utilizationThreshold = smoothThresholdWithGuard({
    current: baseUtilization,
    target: utilizationTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND_UTILIZATION,
    maxStep: PRESSURE_MAX_STEP_UTILIZATION,
  });
  const semanticRateThreshold = smoothThresholdWithGuard({
    current: baseSemantic,
    target: semanticRateTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND,
    maxStep: PRESSURE_MAX_STEP_RATE,
  });
  const autoLimitRateThreshold = smoothThresholdWithGuard({
    current: baseAutoLimit,
    target: autoLimitRateTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND,
    maxStep: PRESSURE_MAX_STEP_RATE,
  });
  const jointRateTarget = clampPressureRateThreshold(
    Math.max(0.05, Math.min(semanticRateThreshold, autoLimitRateThreshold) - 0.05),
    baseJoint,
  );
  const jointRateThreshold = smoothThresholdWithGuard({
    current: baseJoint,
    target: jointRateTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND,
    maxStep: PRESSURE_MAX_STEP_RATE,
  });
  const updated = Math.abs(utilizationThreshold - baseUtilization) >= 0.001
    || Math.abs(semanticRateThreshold - baseSemantic) >= 0.001
    || Math.abs(autoLimitRateThreshold - baseAutoLimit) >= 0.001
    || Math.abs(jointRateThreshold - baseJoint) >= 0.001;
  return {
    source: "learned",
    updated,
    learnAlpha,
    utilizationThreshold,
    semanticRateThreshold,
    autoLimitRateThreshold,
    jointRateThreshold,
    trendUtilizationDelta,
    trendSemanticDelta,
    trendAutoLimitDelta,
    trendMomentum,
    trendFlipSuppressed,
  };
}

function isSevereObservation(args: {
  policy: PromptQualityGuardPolicy;
  observation: PromptQualityGuardObservation;
}): boolean {
  return (
    (typeof args.observation.observedOverall === "number"
      && args.observation.observedOverall <= args.policy.severeOverallThreshold)
    || (
      typeof args.observation.observedLowQualityRate === "number"
      && args.observation.observedLowQualityRate >= args.policy.severeLowQualityRateThreshold
    )
  );
}

function resolvePromoteTargetFloor(args: {
  policy: PromptQualityGuardPolicy;
  severe: boolean;
  severeStreak: number;
}): PromptCompactionStage {
  let targetFloor: PromptCompactionStage = args.severe ? "forced" : "proactive";
  if (
    args.severe
    && args.severeStreak >= args.policy.severePromoteStreak
    && stageWeight(args.policy.maxFloorStage) >= stageWeight("minimal")
  ) {
    targetFloor = "minimal";
  }
  if (stageWeight(targetFloor) > stageWeight(args.policy.maxFloorStage)) {
    targetFloor = args.policy.maxFloorStage;
  }
  return targetFloor;
}

export function normalizePromptQualityGuardPolicy(
  policy: PromptQualityGuardPolicy,
): PromptQualityGuardPolicy {
  return {
    enabled: policy.enabled === true,
    promoteStreak: clampPositiveInt(policy.promoteStreak, 2),
    severePromoteStreak: clampPositiveInt(policy.severePromoteStreak, 2),
    releaseStreak: clampPositiveInt(policy.releaseStreak, 3),
    holdTurns: Math.max(0, Math.min(64, clampPositiveInt(policy.holdTurns, 2))),
    maxFloorStage: normalizeMaxFloorStage(policy.maxFloorStage),
    severeOverallThreshold: clampUnitRatio(policy.severeOverallThreshold, 0.45),
    severeLowQualityRateThreshold: clampUnitRatio(policy.severeLowQualityRateThreshold, 0.7),
  };
}

export function assessPromptQualityGuardRuntime(input: {
  policy: PromptQualityGuardPolicy;
  currentState: PromptQualityGuardState;
  observation: PromptQualityGuardObservation;
}): PromptQualityGuardRuntimeAssessment {
  const policy = normalizePromptQualityGuardPolicy(input.policy);
  const state = normalizePromptQualityGuardState(input.currentState);
  const observation = {
    degraded: input.observation.degraded === true,
    reason: input.observation.reason?.trim() || "unknown",
    observedOverall:
      typeof input.observation.observedOverall === "number"
      ? input.observation.observedOverall
      : null,
    observedLowQualityRate:
      typeof input.observation.observedLowQualityRate === "number"
      ? input.observation.observedLowQualityRate
      : null,
  };
  if (!policy.enabled) {
    return {
      enabled: false,
      phase: "disabled",
      transition: "none",
      degraded: observation.degraded,
      severe: false,
      reason: "guard_disabled",
      triggered: false,
      floorStage: state.floorStage,
      proposedFloorStage: "normal",
      promoteRemaining: 0,
      severePromoteRemaining: 0,
      releaseRemaining: 0,
      holdTurnsRemaining: 0,
      observedOverall: observation.observedOverall,
      observedLowQualityRate: observation.observedLowQualityRate,
    };
  }
  const severe = observation.degraded
    ? isSevereObservation({
      policy,
      observation,
    })
    : false;
  const promoteRemaining = Math.max(0, policy.promoteStreak - state.degradedStreak);
  const severePromoteRemaining = Math.max(0, policy.severePromoteStreak - state.severeStreak);
  const releaseRemaining = Math.max(0, policy.releaseStreak - state.healthyStreak);

  let proposedFloorStage = state.floorStage;
  if (observation.degraded && state.degradedStreak >= policy.promoteStreak) {
    const targetFloor = resolvePromoteTargetFloor({
      policy,
      severe,
      severeStreak: state.severeStreak,
    });
    if (stageWeight(targetFloor) > stageWeight(state.floorStage)) {
      proposedFloorStage = targetFloor;
    }
  }
  if (
    !observation.degraded
    && state.holdTurnsRemaining === 0
    && state.healthyStreak >= policy.releaseStreak
    && stageWeight(state.floorStage) > stageWeight("normal")
  ) {
    proposedFloorStage = lowerStage(state.floorStage);
  }

  const triggered = stageWeight(state.floorStage) > stageWeight("normal");
  let phase: PromptQualityGuardRuntimePhase = "idle";
  let transition: PromptQualityGuardRuntimeTransition = "none";
  if (observation.degraded) {
    if (stageWeight(proposedFloorStage) > stageWeight(state.floorStage)) {
      phase = "escalating";
      transition = "promote";
    } else if (triggered) {
      phase = "holding";
      transition = "hold";
    } else {
      phase = "escalating";
      transition = "hold";
    }
  } else if (triggered) {
    if (state.holdTurnsRemaining > 0) {
      phase = "holding";
      transition = "hold";
    } else {
      phase = "recovering";
      transition = stageWeight(proposedFloorStage) < stageWeight(state.floorStage) ? "release" : "hold";
    }
  }

  return {
    enabled: true,
    phase,
    transition,
    degraded: observation.degraded,
    severe,
    reason: observation.reason,
    triggered,
    floorStage: state.floorStage,
    proposedFloorStage,
    promoteRemaining,
    severePromoteRemaining,
    releaseRemaining,
    holdTurnsRemaining: state.holdTurnsRemaining,
    observedOverall: observation.observedOverall,
    observedLowQualityRate: observation.observedLowQualityRate,
  };
}

export function derivePromptQualityGuardAdaptivePolicy(
  input: PromptQualityGuardAdaptiveInput,
): PromptQualityGuardAdaptiveDecision {
  const basePolicy = normalizePromptQualityGuardPolicy(input.basePolicy);
  const allowlist = normalizeAdaptiveModeAllowlist(input.adaptiveModeAllowlist);
  const state = normalizePromptQualityGuardState(input.currentState);
  const window = {
    degraded: input.window.degraded === true,
    reason: input.window.reason?.trim() || "unknown",
    lowQualityRate: typeof input.window.lowQualityRate === "number" ? input.window.lowQualityRate : null,
    averageOverall: typeof input.window.averageOverall === "number" ? input.window.averageOverall : null,
    observedOverall: typeof input.window.observedOverall === "number" ? input.window.observedOverall : null,
    observedLowQualityRate: typeof input.window.observedLowQualityRate === "number"
      ? input.window.observedLowQualityRate
      : null,
    snapshotSemanticCompressRate:
      typeof input.window.snapshotSemanticCompressRate === "number"
        ? input.window.snapshotSemanticCompressRate
        : null,
    autoLimitTriggeredRate:
      typeof input.window.autoLimitTriggeredRate === "number"
        ? input.window.autoLimitTriggeredRate
        : null,
    averageUtilizationRatio:
      typeof input.window.averageUtilizationRatio === "number"
        ? input.window.averageUtilizationRatio
        : null,
    shortSnapshotSemanticCompressRate:
      typeof input.window.shortSnapshotSemanticCompressRate === "number"
        ? input.window.shortSnapshotSemanticCompressRate
        : null,
    mediumSnapshotSemanticCompressRate:
      typeof input.window.mediumSnapshotSemanticCompressRate === "number"
        ? input.window.mediumSnapshotSemanticCompressRate
        : null,
    shortAutoLimitTriggeredRate:
      typeof input.window.shortAutoLimitTriggeredRate === "number"
        ? input.window.shortAutoLimitTriggeredRate
        : null,
    mediumAutoLimitTriggeredRate:
      typeof input.window.mediumAutoLimitTriggeredRate === "number"
        ? input.window.mediumAutoLimitTriggeredRate
        : null,
    shortAverageUtilizationRatio:
      typeof input.window.shortAverageUtilizationRatio === "number"
        ? input.window.shortAverageUtilizationRatio
        : null,
    mediumAverageUtilizationRatio:
      typeof input.window.mediumAverageUtilizationRatio === "number"
        ? input.window.mediumAverageUtilizationRatio
        : null,
    hardBudgetStrategyRate:
      typeof input.window.hardBudgetStrategyRate === "number"
        ? input.window.hardBudgetStrategyRate
        : null,
    qualityFirstStrategyRate:
      typeof input.window.qualityFirstStrategyRate === "number"
        ? input.window.qualityFirstStrategyRate
        : null,
    averagePreSendOverflowRatio:
      typeof input.window.averagePreSendOverflowRatio === "number"
        ? input.window.averagePreSendOverflowRatio
        : null,
    averagePreSendPressureScore:
      typeof input.window.averagePreSendPressureScore === "number"
        ? input.window.averagePreSendPressureScore
        : null,
    shortHardBudgetStrategyRate:
      typeof input.window.shortHardBudgetStrategyRate === "number"
        ? input.window.shortHardBudgetStrategyRate
        : null,
    mediumHardBudgetStrategyRate:
      typeof input.window.mediumHardBudgetStrategyRate === "number"
        ? input.window.mediumHardBudgetStrategyRate
        : null,
    shortAveragePreSendOverflowRatio:
      typeof input.window.shortAveragePreSendOverflowRatio === "number"
        ? input.window.shortAveragePreSendOverflowRatio
        : null,
    mediumAveragePreSendOverflowRatio:
      typeof input.window.mediumAveragePreSendOverflowRatio === "number"
        ? input.window.mediumAveragePreSendOverflowRatio
        : null,
    shortAveragePreSendPressureScore:
      typeof input.window.shortAveragePreSendPressureScore === "number"
        ? input.window.shortAveragePreSendPressureScore
        : null,
    mediumAveragePreSendPressureScore:
      typeof input.window.mediumAveragePreSendPressureScore === "number"
        ? input.window.mediumAveragePreSendPressureScore
        : null,
    hardBudgetFollowupOverallDelta:
      typeof input.window.hardBudgetFollowupOverallDelta === "number"
        ? input.window.hardBudgetFollowupOverallDelta
        : null,
    qualityFirstFollowupOverallDelta:
      typeof input.window.qualityFirstFollowupOverallDelta === "number"
        ? input.window.qualityFirstFollowupOverallDelta
        : null,
    hardBudgetRecoveryRate:
      typeof input.window.hardBudgetRecoveryRate === "number"
        ? input.window.hardBudgetRecoveryRate
        : null,
    qualityFirstImprovedRate:
      typeof input.window.qualityFirstImprovedRate === "number"
        ? input.window.qualityFirstImprovedRate
        : null,
    hardBudgetTransitionCount:
      typeof input.window.hardBudgetTransitionCount === "number"
      && Number.isFinite(input.window.hardBudgetTransitionCount)
        ? Math.max(0, Math.floor(input.window.hardBudgetTransitionCount))
        : null,
    qualityFirstTransitionCount:
      typeof input.window.qualityFirstTransitionCount === "number"
      && Number.isFinite(input.window.qualityFirstTransitionCount)
        ? Math.max(0, Math.floor(input.window.qualityFirstTransitionCount))
        : null,
  };
  if (!basePolicy.enabled || input.adaptiveEnabled !== true) {
    const pressurePolicy = deriveAdaptivePressurePolicy({
      state,
      window,
      guardTriggered: stageWeight(state.floorStage) > stageWeight("normal"),
    });
    const hardBudgetTransitions = window.hardBudgetTransitionCount ?? 0;
    const qualityFirstTransitions = window.qualityFirstTransitionCount ?? 0;
    const requiredTransitions = clampRequiredTransitions(
      state.outcomeRequiredTransitions,
      DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
    );
    const hardBudgetReliable = hardBudgetTransitions >= requiredTransitions;
    const qualityFirstReliable = qualityFirstTransitions >= requiredTransitions;
    const outcomeDrift = advancePromptQualityGuardOutcomeDriftGuard({
      currentState: state,
      mode: "disabled",
      combinedEvidenceScore: roundThreshold(
        clamp01((hardBudgetTransitions + qualityFirstTransitions) / (requiredTransitions * 2)),
      ),
      hardBudgetReliable,
      qualityFirstReliable,
    });
    return {
      enabled: false,
      mode: "disabled",
      reason: basePolicy.enabled ? "adaptive_disabled" : "guard_disabled",
      allowlist,
      modeBlocked: false,
      blockedMode: null,
      basePolicy,
      effectivePolicy: basePolicy,
      adjustment: {
        promoteStreakDelta: 0,
        severePromoteStreakDelta: 0,
        releaseStreakDelta: 0,
        holdTurnsDelta: 0,
      },
      pressurePolicy,
      outcomeReliability: {
        requiredTransitions,
        nextRequiredTransitions: requiredTransitions,
        hardBudgetTransitions,
        qualityFirstTransitions,
        hardBudgetEvidenceScore: roundThreshold(
          clamp01(hardBudgetTransitions / requiredTransitions),
        ),
        qualityFirstEvidenceScore: roundThreshold(
          clamp01(qualityFirstTransitions / requiredTransitions),
        ),
        combinedEvidenceScore: roundThreshold(
          clamp01((hardBudgetTransitions + qualityFirstTransitions) / (requiredTransitions * 2)),
        ),
        hardBudgetReliable,
        qualityFirstReliable,
      },
      outcomeDriftGuard: outcomeDrift.driftGuard,
    };
  }

  const severePressure =
    (typeof window.observedOverall === "number" && window.observedOverall <= basePolicy.severeOverallThreshold + 0.03)
    || (
      typeof window.observedLowQualityRate === "number"
      && window.observedLowQualityRate >= Math.max(0, basePolicy.severeLowQualityRateThreshold - 0.05)
    );
  const healthyWindow =
    window.degraded === false
    && typeof window.lowQualityRate === "number"
    && typeof window.averageOverall === "number"
    && window.lowQualityRate <= 0.18
    && window.averageOverall >= 0.84;
  const guardTriggered = stageWeight(state.floorStage) > stageWeight("normal");
  const pressurePolicy = deriveAdaptivePressurePolicy({
    state,
    window,
    guardTriggered,
  });
  const compressionPressure =
    typeof window.averageUtilizationRatio === "number"
    && (
      (
        window.averageUtilizationRatio >= pressurePolicy.utilizationThreshold
        && (
          (typeof window.snapshotSemanticCompressRate === "number"
            && window.snapshotSemanticCompressRate >= pressurePolicy.semanticRateThreshold)
          || (
            typeof window.autoLimitTriggeredRate === "number"
            && window.autoLimitTriggeredRate >= pressurePolicy.autoLimitRateThreshold
          )
        )
      )
      || (
        typeof window.snapshotSemanticCompressRate === "number"
        && typeof window.autoLimitTriggeredRate === "number"
        && window.snapshotSemanticCompressRate >= pressurePolicy.jointRateThreshold
        && window.autoLimitTriggeredRate >= pressurePolicy.jointRateThreshold
      )
    );
  const hardBudgetTrendDelta =
    typeof window.shortHardBudgetStrategyRate === "number"
    && typeof window.mediumHardBudgetStrategyRate === "number"
      ? window.shortHardBudgetStrategyRate - window.mediumHardBudgetStrategyRate
      : null;
  const preSendPressureTrendDelta =
    typeof window.shortAveragePreSendPressureScore === "number"
    && typeof window.mediumAveragePreSendPressureScore === "number"
      ? window.shortAveragePreSendPressureScore - window.mediumAveragePreSendPressureScore
      : null;
  const preSendOverflowTrendDelta =
    typeof window.shortAveragePreSendOverflowRatio === "number"
    && typeof window.mediumAveragePreSendOverflowRatio === "number"
      ? window.shortAveragePreSendOverflowRatio - window.mediumAveragePreSendOverflowRatio
      : null;
  const baselineRequiredTransitions = clampRequiredTransitions(
    state.outcomeRequiredTransitions,
    DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
  );
  let requiredTransitions = baselineRequiredTransitions;
  if (window.degraded) {
    requiredTransitions += 1;
  }
  if (typeof hardBudgetTrendDelta === "number" && Math.abs(hardBudgetTrendDelta) >= 0.10) {
    requiredTransitions += 1;
  }
  if (typeof preSendPressureTrendDelta === "number" && Math.abs(preSendPressureTrendDelta) >= 0.08) {
    requiredTransitions += 1;
  }
  if (typeof preSendOverflowTrendDelta === "number" && Math.abs(preSendOverflowTrendDelta) >= 0.05) {
    requiredTransitions += 1;
  }
  requiredTransitions = clampRequiredTransitions(requiredTransitions, baselineRequiredTransitions);
  const hardBudgetTransitions = window.hardBudgetTransitionCount ?? 0;
  const qualityFirstTransitions = window.qualityFirstTransitionCount ?? 0;
  const hardBudgetEvidenceScore = roundThreshold(
    clamp01(hardBudgetTransitions / requiredTransitions),
  );
  const qualityFirstEvidenceScore = roundThreshold(
    clamp01(qualityFirstTransitions / requiredTransitions),
  );
  const combinedEvidenceScore = roundThreshold(
    clamp01((hardBudgetTransitions + qualityFirstTransitions) / (requiredTransitions * 2)),
  );
  const strategyPressureBase =
    (
      (typeof window.hardBudgetStrategyRate === "number" && window.hardBudgetStrategyRate >= 0.48)
      || (typeof hardBudgetTrendDelta === "number" && hardBudgetTrendDelta >= 0.10)
    )
    && (
      (typeof window.averagePreSendPressureScore === "number" && window.averagePreSendPressureScore >= 0.58)
      || (typeof window.averagePreSendOverflowRatio === "number" && window.averagePreSendOverflowRatio >= 0.14)
      || (typeof preSendPressureTrendDelta === "number" && preSendPressureTrendDelta >= 0.10)
      || (typeof preSendOverflowTrendDelta === "number" && preSendOverflowTrendDelta >= 0.06)
    );
  const hardBudgetOutcomeStrong =
    (
      typeof window.hardBudgetFollowupOverallDelta === "number"
      && window.hardBudgetFollowupOverallDelta >= 0.03
      && typeof window.hardBudgetRecoveryRate === "number"
      && window.hardBudgetRecoveryRate >= 0.55
    )
    || (
      typeof window.hardBudgetRecoveryRate === "number"
      && window.hardBudgetRecoveryRate >= 0.70
    );
  const hardBudgetOutcomeReliable = hardBudgetEvidenceScore >= 1;
  const hardBudgetOutcomeWeak =
    (typeof window.hardBudgetFollowupOverallDelta === "number"
      && window.hardBudgetFollowupOverallDelta <= -0.02)
    || (
      typeof window.hardBudgetRecoveryRate === "number"
      && window.hardBudgetRecoveryRate <= 0.40
    );
  const qualityFirstOutcomeStrong =
    (typeof window.qualityFirstFollowupOverallDelta === "number"
      && window.qualityFirstFollowupOverallDelta >= 0.01)
    || (
      typeof window.qualityFirstImprovedRate === "number"
      && window.qualityFirstImprovedRate >= 0.58
    );
  const qualityFirstOutcomeReliable = qualityFirstEvidenceScore >= 1;
  const qualityFirstOutcomeWeak =
    (typeof window.qualityFirstFollowupOverallDelta === "number"
      && window.qualityFirstFollowupOverallDelta <= -0.03)
    && (
      typeof window.qualityFirstImprovedRate === "number"
      && window.qualityFirstImprovedRate < 0.45
    );
  const strategyPressure =
    strategyPressureBase
    && (
      (hardBudgetOutcomeReliable && hardBudgetOutcomeWeak)
      || (
        !hardBudgetOutcomeReliable
        || !hardBudgetOutcomeStrong
      )
    );
  const strategyRecovered =
    (typeof window.qualityFirstStrategyRate !== "number" || window.qualityFirstStrategyRate >= 0.58)
    && (typeof window.hardBudgetStrategyRate !== "number" || window.hardBudgetStrategyRate <= 0.26)
    && (typeof window.averagePreSendPressureScore !== "number" || window.averagePreSendPressureScore <= 0.48)
    && (typeof window.averagePreSendOverflowRatio !== "number" || window.averagePreSendOverflowRatio <= 0.10)
    && (typeof hardBudgetTrendDelta !== "number" || hardBudgetTrendDelta <= 0.03)
    && (!qualityFirstOutcomeReliable || !qualityFirstOutcomeWeak)
    && (
      (hardBudgetOutcomeReliable && hardBudgetOutcomeStrong)
      || (qualityFirstOutcomeReliable && qualityFirstOutcomeStrong)
    );
  let nextRequiredTransitionsTarget = baselineRequiredTransitions;
  const baselineCombinedEvidenceScore = clamp01(state.outcomeCombinedEvidenceScore);
  const combinedEvidenceScoreDelta = roundThreshold(
    combinedEvidenceScore - baselineCombinedEvidenceScore,
  );
  if (window.degraded || strategyPressure || compressionPressure) {
    nextRequiredTransitionsTarget += 1;
  } else if (strategyRecovered && combinedEvidenceScore >= 0.85) {
    nextRequiredTransitionsTarget -= 1;
  } else if (!hardBudgetOutcomeReliable && !qualityFirstOutcomeReliable) {
    nextRequiredTransitionsTarget += 1;
  }
  if (combinedEvidenceScoreDelta <= -0.18) {
    nextRequiredTransitionsTarget += 1;
  } else if (combinedEvidenceScoreDelta >= 0.20 && strategyRecovered) {
    nextRequiredTransitionsTarget -= 1;
  }
  nextRequiredTransitionsTarget = clampRequiredTransitions(
    nextRequiredTransitionsTarget,
    baselineRequiredTransitions,
  );
  const trendVolatility = clamp01(
    (Math.abs(hardBudgetTrendDelta ?? 0)
      + Math.abs(preSendPressureTrendDelta ?? 0)
      + Math.abs(preSendOverflowTrendDelta ?? 0)) / 0.45,
  );
  const requiredTransitionsAlpha = clampEwmaAlpha(
    OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_BASE
    + trendVolatility * 0.24
    + (window.degraded ? 0.08 : 0)
    + (strategyPressure ? 0.05 : 0),
  );
  const nextRequiredTransitions = deriveOutcomeRequiredTransitionsEwma({
    baseline: baselineRequiredTransitions,
    target: nextRequiredTransitionsTarget,
    alpha: requiredTransitionsAlpha,
  });

  let mode: PromptQualityGuardAdaptiveMode = "stable";
  let reason = "window_stable";
  const effectivePolicy: PromptQualityGuardPolicy = { ...basePolicy };
  const applyHardenPolicy = (): void => {
    effectivePolicy.promoteStreak = Math.max(1, basePolicy.promoteStreak - 1);
    effectivePolicy.severePromoteStreak = Math.max(1, basePolicy.severePromoteStreak - 1);
    effectivePolicy.releaseStreak = Math.min(64, basePolicy.releaseStreak + 1);
    effectivePolicy.holdTurns = Math.min(64, basePolicy.holdTurns + 1);
  };
  const applyRelaxPolicy = (): void => {
    effectivePolicy.promoteStreak = Math.min(32, basePolicy.promoteStreak + 1);
    effectivePolicy.severePromoteStreak = Math.min(32, basePolicy.severePromoteStreak + 1);
    effectivePolicy.releaseStreak = Math.max(1, basePolicy.releaseStreak - 1);
    effectivePolicy.holdTurns = Math.max(0, basePolicy.holdTurns - 1);
  };
  const applyStablePolicy = (): void => {
    effectivePolicy.promoteStreak = basePolicy.promoteStreak;
    effectivePolicy.severePromoteStreak = basePolicy.severePromoteStreak;
    effectivePolicy.releaseStreak = basePolicy.releaseStreak;
    effectivePolicy.holdTurns = basePolicy.holdTurns;
  };

  if (window.degraded && severePressure) {
    mode = "harden";
    reason = "severe_window_pressure";
    applyHardenPolicy();
  } else if (compressionPressure || strategyPressure) {
    mode = "harden";
    reason = strategyPressure ? "strategy_window_pressure" : "compression_window_pressure";
    applyHardenPolicy();
  } else if (healthyWindow && guardTriggered && strategyRecovered) {
    mode = "relax";
    reason = "window_recovered";
    applyRelaxPolicy();
  }

  let modeBlocked = false;
  let blockedMode: PromptQualityGuardAdaptiveMutableMode | null = null;
  if ((mode === "harden" || mode === "relax") && !allowlist.includes(mode)) {
    modeBlocked = true;
    blockedMode = mode;
    mode = "stable";
    reason = "mode_blocked_by_allowlist";
    applyStablePolicy();
  }

  let outcomeDrift = advancePromptQualityGuardOutcomeDriftGuard({
    currentState: state,
    mode,
    combinedEvidenceScore,
    hardBudgetReliable: hardBudgetOutcomeReliable,
    qualityFirstReliable: qualityFirstOutcomeReliable,
  });
  const driftActionLevel = outcomeDrift.driftGuard.autoActionLevel;
  const driftAutoCorrectionAllowed =
    mode === "harden"
    && outcomeDrift.driftGuard.highEvidenceHardenBias
    && !window.degraded
    && (
      driftActionLevel === "hard"
      || driftActionLevel === "medium"
      || (driftActionLevel === "soft" && strategyRecovered)
    );
  if (driftAutoCorrectionAllowed) {
    const forceRelax = driftActionLevel === "hard" || driftActionLevel === "medium";
    if (allowlist.includes("relax") && (forceRelax || strategyRecovered)) {
      mode = "relax";
      reason = `drift_guard_auto_${driftActionLevel}_relax`;
      applyRelaxPolicy();
    } else {
      mode = "stable";
      reason = `drift_guard_auto_${driftActionLevel}_stable`;
      applyStablePolicy();
    }
    outcomeDrift = advancePromptQualityGuardOutcomeDriftGuard({
      currentState: state,
      mode,
      combinedEvidenceScore,
      hardBudgetReliable: hardBudgetOutcomeReliable,
      qualityFirstReliable: qualityFirstOutcomeReliable,
    });
  }

  return {
    enabled: true,
    mode,
    reason,
    allowlist,
    modeBlocked,
    blockedMode,
    basePolicy,
    effectivePolicy: normalizePromptQualityGuardPolicy(effectivePolicy),
    adjustment: {
      promoteStreakDelta: effectivePolicy.promoteStreak - basePolicy.promoteStreak,
      severePromoteStreakDelta: effectivePolicy.severePromoteStreak - basePolicy.severePromoteStreak,
      releaseStreakDelta: effectivePolicy.releaseStreak - basePolicy.releaseStreak,
      holdTurnsDelta: effectivePolicy.holdTurns - basePolicy.holdTurns,
    },
    pressurePolicy,
    outcomeReliability: {
      requiredTransitions,
      nextRequiredTransitions,
      hardBudgetTransitions,
      qualityFirstTransitions,
      hardBudgetEvidenceScore,
      qualityFirstEvidenceScore,
      combinedEvidenceScore,
      hardBudgetReliable: hardBudgetOutcomeReliable,
      qualityFirstReliable: qualityFirstOutcomeReliable,
    },
    outcomeDriftGuard: outcomeDrift.driftGuard,
  };
}

export function normalizePromptQualityGuardState(raw: unknown): PromptQualityGuardState {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return defaultPromptQualityGuardState();
  }
  const row = raw as Record<string, unknown>;
  return {
    floorStage: normalizeStage(row.floorStage),
    degradedStreak:
      typeof row.degradedStreak === "number" && Number.isFinite(row.degradedStreak)
        ? Math.max(0, Math.floor(row.degradedStreak))
        : 0,
    severeStreak:
      typeof row.severeStreak === "number" && Number.isFinite(row.severeStreak)
        ? Math.max(0, Math.floor(row.severeStreak))
        : 0,
    healthyStreak:
      typeof row.healthyStreak === "number" && Number.isFinite(row.healthyStreak)
        ? Math.max(0, Math.floor(row.healthyStreak))
        : 0,
    holdTurnsRemaining:
      typeof row.holdTurnsRemaining === "number" && Number.isFinite(row.holdTurnsRemaining)
        ? Math.max(0, Math.floor(row.holdTurnsRemaining))
        : 0,
    lastReason: typeof row.lastReason === "string" ? row.lastReason : "init",
    updatedAt:
      typeof row.updatedAt === "string" && row.updatedAt.trim().length > 0
        ? row.updatedAt
        : null,
    pressureUtilizationThreshold: clampPressureUtilizationThreshold(
      typeof row.pressureUtilizationThreshold === "number"
        ? row.pressureUtilizationThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_UTILIZATION_THRESHOLD,
    ),
    pressureSemanticRateThreshold: clampPressureRateThreshold(
      typeof row.pressureSemanticRateThreshold === "number"
        ? row.pressureSemanticRateThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD,
    ),
    pressureAutoLimitRateThreshold: clampPressureRateThreshold(
      typeof row.pressureAutoLimitRateThreshold === "number"
        ? row.pressureAutoLimitRateThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD,
    ),
    pressureJointRateThreshold: clampPressureRateThreshold(
      typeof row.pressureJointRateThreshold === "number"
        ? row.pressureJointRateThreshold
        : Number.NaN,
      DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD,
    ),
    pressureTrendUtilizationDelta: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendUtilizationDelta === "number"
          ? row.pressureTrendUtilizationDelta
          : Number.NaN,
        0,
      ),
    ),
    pressureTrendSemanticDelta: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendSemanticDelta === "number"
          ? row.pressureTrendSemanticDelta
          : Number.NaN,
        0,
      ),
    ),
    pressureTrendAutoLimitDelta: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendAutoLimitDelta === "number"
          ? row.pressureTrendAutoLimitDelta
          : Number.NaN,
        0,
      ),
    ),
    pressureTrendMomentum: roundThreshold(
      clampSignedUnit(
        typeof row.pressureTrendMomentum === "number"
          ? row.pressureTrendMomentum
          : Number.NaN,
        0,
      ),
    ),
    outcomeRequiredTransitions: clampRequiredTransitions(
      typeof row.outcomeRequiredTransitions === "number"
        ? row.outcomeRequiredTransitions
        : Number.NaN,
      DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
    ),
    outcomeCombinedEvidenceScore: roundThreshold(
      clamp01(
        typeof row.outcomeCombinedEvidenceScore === "number"
          ? row.outcomeCombinedEvidenceScore
          : Number.NaN,
      ),
    ),
    outcomeHighEvidenceTurns: clampOutcomeDriftCounter(
      typeof row.outcomeHighEvidenceTurns === "number"
        ? row.outcomeHighEvidenceTurns
        : Number.NaN,
      DEFAULT_OUTCOME_HIGH_EVIDENCE_TURNS,
    ),
    outcomeHighEvidenceHardenTurns: clampOutcomeDriftCounter(
      typeof row.outcomeHighEvidenceHardenTurns === "number"
        ? row.outcomeHighEvidenceHardenTurns
        : Number.NaN,
      DEFAULT_OUTCOME_HIGH_EVIDENCE_HARDEN_TURNS,
    ),
    outcomeDriftRecentAutoActionLevels: normalizeDriftAutoActionLevels(
      row.outcomeDriftRecentAutoActionLevels,
    ),
  };
}

export function readPromptQualityGuardState(input: {
  workDir: string;
}): PromptQualityGuardState {
  const path = resolveStatePath(input.workDir);
  if (!existsSync(path)) {
    return defaultPromptQualityGuardState();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return normalizePromptQualityGuardState(parsed);
  } catch {
    return defaultPromptQualityGuardState();
  }
}

export function writePromptQualityGuardState(input: {
  workDir: string;
  state: PromptQualityGuardState;
}): void {
  const path = resolveStatePath(input.workDir);
  const normalized = normalizePromptQualityGuardState(input.state);
  try {
    mkdirSync(resolveParentDir(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch {
    // best effort only
  }
}

export function evaluatePromptQualityGuard(input: {
  policy: PromptQualityGuardPolicy;
  currentState: PromptQualityGuardState;
  observation: PromptQualityGuardObservation;
}): PromptQualityGuardDecision {
  const policy = normalizePromptQualityGuardPolicy(input.policy);
  const currentState = normalizePromptQualityGuardState(input.currentState);
  const reason = input.observation.reason?.trim() || "unknown";
  const next: PromptQualityGuardState = {
    ...currentState,
    lastReason: reason,
    updatedAt: new Date().toISOString(),
  };

  let promoted = false;
  let released = false;
  let severe = false;
  let severeEscalated = false;

  if (!policy.enabled) {
    const resetState: PromptQualityGuardState = {
      ...defaultPromptQualityGuardState(),
      lastReason: "guard_disabled",
      updatedAt: next.updatedAt,
    };
    return {
      floorStage: "normal",
      triggered: false,
      promoted: false,
      released: false,
      severe: false,
      severeEscalated: false,
      state: resetState,
    };
  }

  if (input.observation.degraded) {
    next.degradedStreak += 1;
    next.healthyStreak = 0;
    severe = isSevereObservation({
      policy,
      observation: input.observation,
    });
    next.severeStreak = severe ? next.severeStreak + 1 : 0;
    if (next.degradedStreak >= policy.promoteStreak) {
      const before = next.floorStage;
      const targetFloor = resolvePromoteTargetFloor({
        policy,
        severe,
        severeStreak: next.severeStreak,
      });
      if (stageWeight(targetFloor) > stageWeight(next.floorStage)) {
        next.floorStage = targetFloor;
      }
      next.holdTurnsRemaining = Math.max(next.holdTurnsRemaining, policy.holdTurns);
      promoted = stageWeight(next.floorStage) > stageWeight(before);
      severeEscalated = severe
        && next.floorStage === "minimal"
        && next.severeStreak >= policy.severePromoteStreak;
    }
  } else {
    next.healthyStreak += 1;
    next.degradedStreak = 0;
    next.severeStreak = 0;
    if (next.holdTurnsRemaining > 0) {
      next.holdTurnsRemaining -= 1;
    }
    if (
      next.holdTurnsRemaining === 0
      && next.healthyStreak >= policy.releaseStreak
      && stageWeight(next.floorStage) > stageWeight("normal")
    ) {
      const before = next.floorStage;
      next.floorStage = lowerStage(next.floorStage);
      next.healthyStreak = 0;
      released = stageWeight(next.floorStage) < stageWeight(before);
    }
  }

  return {
    floorStage: next.floorStage,
    triggered: stageWeight(next.floorStage) > stageWeight("normal"),
    promoted,
    released,
    severe,
    severeEscalated,
    state: next,
  };
}

export function applyPromptQualityGuardFloor(input: {
  selectedStage: PromptCompactionStage;
  floorStage: PromptCompactionStage;
}): PromptCompactionStage {
  return stageWeight(input.floorStage) > stageWeight(input.selectedStage)
    ? input.floorStage
    : input.selectedStage;
}
