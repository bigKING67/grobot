import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { resolveContextStoragePath } from "../storage-boundary";
import { type PromptCompactionStage } from "../types";

export type PromptPreSendStrategy = "quality_first" | "hard_budget";

export interface PromptQualityScores {
  coverage: number;
  recency: number;
  size: number;
  overall: number;
}

export interface PromptQualitySignals {
  recentRows: number;
  snapshotSections: number;
  recentTrimRows: number;
  snapshotTrimSections: number;
  snapshotSemanticCompressSections: number;
  headTrimRetries: number;
  autoLimitTriggered: boolean;
  downshiftGuardTriggered: boolean;
  preSendStrategy: PromptPreSendStrategy;
  preSendOverflowRatio: number;
  preSendPressureScore: number;
}

export interface PromptQualitySignalAverages {
  recentRows: number;
  snapshotSections: number;
  recentTrimRows: number;
  snapshotTrimSections: number;
  snapshotSemanticCompressSections: number;
  headTrimRetries: number;
  preSendOverflowRatio: number;
  preSendPressureScore: number;
}

export interface PromptQualityCompressionActivity {
  recentTrimRate: number | null;
  snapshotTrimRate: number | null;
  snapshotSemanticCompressRate: number | null;
  headTrimRate: number | null;
  autoLimitTriggeredRate: number | null;
  downshiftGuardTriggeredRate: number | null;
}

export interface PromptQualityStrategyActivity {
  qualityFirstRate: number | null;
  hardBudgetRate: number | null;
}

export interface PromptQualityTokenBudgetSummary {
  averageEstimatedTokens: number | null;
  averageTargetTokenLimit: number | null;
  averageUtilizationRatio: number | null;
}

export interface PromptQualityPressureTrendWindow {
  windowSize: number;
  entries: number;
  snapshotSemanticCompressRate: number | null;
  autoLimitTriggeredRate: number | null;
  averageUtilizationRatio: number | null;
}

export interface PromptQualityStrategyTrendWindow {
  windowSize: number;
  entries: number;
  hardBudgetRate: number | null;
  averageOverflowRatio: number | null;
  averagePressureScore: number | null;
}

export interface PromptQualityStrategyTrends {
  short: PromptQualityStrategyTrendWindow;
  medium: PromptQualityStrategyTrendWindow;
  delta: {
    hardBudgetRate: number | null;
    averageOverflowRatio: number | null;
    averagePressureScore: number | null;
  };
}

export interface PromptQualityStrategyOutcomes {
  hardBudgetFollowupOverallDelta: number | null;
  qualityFirstFollowupOverallDelta: number | null;
  hardBudgetRecoveryRate: number | null;
  qualityFirstImprovedRate: number | null;
  hardBudgetTransitions: number;
  qualityFirstTransitions: number;
}

export interface PromptQualityPressureTrends {
  short: PromptQualityPressureTrendWindow;
  medium: PromptQualityPressureTrendWindow;
  delta: {
    snapshotSemanticCompressRate: number | null;
    autoLimitTriggeredRate: number | null;
    averageUtilizationRatio: number | null;
  };
}

export interface PromptQualityWindowEntry {
  ts: string;
  sessionKey: string;
  stage: PromptCompactionStage;
  selectionReason: string;
  estimatedTokens: number;
  targetTokenLimit: number;
  scores: PromptQualityScores;
  signals: PromptQualitySignals;
}

export interface PromptQualityWindowSummary {
  path: string;
  configuredSize: number;
  entries: number;
  fromTs: string | null;
  toTs: string | null;
  averageScores: PromptQualityScores | null;
  latestScores: PromptQualityScores | null;
  lowQualityCount: number;
  lowQualityRate: number | null;
  lowQualityThreshold: number;
  stageCounts: Record<PromptCompactionStage, number>;
  signalAverages: PromptQualitySignalAverages | null;
  compressionActivity: PromptQualityCompressionActivity;
  strategyActivity: PromptQualityStrategyActivity;
  tokenBudget: PromptQualityTokenBudgetSummary;
  strategyTrends: PromptQualityStrategyTrends;
  strategyOutcomes: PromptQualityStrategyOutcomes;
  pressureTrends: PromptQualityPressureTrends;
}

export interface PromptQualityWindowDegradation {
  degraded: boolean;
  reason: string;
  thresholdOverall: number;
  thresholdLowQualityRate: number;
  minEntries: number;
  observedEntries: number;
  observedOverall: number | null;
  observedLowQualityRate: number | null;
}

const MAX_PERSISTED_ENTRIES = 512;
const TRIM_TRIGGER_BYTES = 1_000_000;
const TRIM_LOCK_SUFFIX = ".trim.lock";
const DEFAULT_LOW_QUALITY_THRESHOLD = 0.6;
const SHORT_STRATEGY_WINDOW = 8;
const MEDIUM_STRATEGY_WINDOW = 24;
const SHORT_PRESSURE_WINDOW = 8;
const MEDIUM_PRESSURE_WINDOW = 24;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function roundRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function normalizePreSendStrategy(raw: unknown): PromptPreSendStrategy {
  return raw === "hard_budget" ? "hard_budget" : "quality_first";
}

function clampNonNegativeRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function computeStrategyTrendWindow(args: {
  entries: PromptQualityWindowEntry[];
  windowSize: number;
}): PromptQualityStrategyTrendWindow {
  const resolvedWindowSize = Math.max(1, Math.floor(args.windowSize));
  const selected = args.entries.slice(-resolvedWindowSize);
  const count = selected.length;
  if (count === 0) {
    return {
      windowSize: resolvedWindowSize,
      entries: 0,
      hardBudgetRate: null,
      averageOverflowRatio: null,
      averagePressureScore: null,
    };
  }
  let hardBudgetCount = 0;
  let totalOverflowRatio = 0;
  let totalPressureScore = 0;
  for (const entry of selected) {
    if (entry.signals.preSendStrategy === "hard_budget") {
      hardBudgetCount += 1;
    }
    totalOverflowRatio += entry.signals.preSendOverflowRatio;
    totalPressureScore += entry.signals.preSendPressureScore;
  }
  return {
    windowSize: resolvedWindowSize,
    entries: count,
    hardBudgetRate: roundScore(hardBudgetCount / count),
    averageOverflowRatio: roundRatio(totalOverflowRatio / count),
    averagePressureScore: roundScore(totalPressureScore / count),
  };
}

function computePressureTrendWindow(args: {
  entries: PromptQualityWindowEntry[];
  windowSize: number;
}): PromptQualityPressureTrendWindow {
  const resolvedWindowSize = Math.max(1, Math.floor(args.windowSize));
  const selected = args.entries.slice(-resolvedWindowSize);
  const count = selected.length;
  if (count === 0) {
    return {
      windowSize: resolvedWindowSize,
      entries: 0,
      snapshotSemanticCompressRate: null,
      autoLimitTriggeredRate: null,
      averageUtilizationRatio: null,
    };
  }
  let semanticTriggeredCount = 0;
  let autoLimitTriggeredCount = 0;
  let totalUtilizationRatio = 0;
  for (const entry of selected) {
    if (entry.signals.snapshotSemanticCompressSections > 0) {
      semanticTriggeredCount += 1;
    }
    if (entry.signals.autoLimitTriggered) {
      autoLimitTriggeredCount += 1;
    }
    totalUtilizationRatio += entry.estimatedTokens / Math.max(1, entry.targetTokenLimit);
  }
  return {
    windowSize: resolvedWindowSize,
    entries: count,
    snapshotSemanticCompressRate: roundScore(semanticTriggeredCount / count),
    autoLimitTriggeredRate: roundScore(autoLimitTriggeredCount / count),
    averageUtilizationRatio: roundRatio(totalUtilizationRatio / count),
  };
}

function derivePressureTrendDelta(shortValue: number | null, mediumValue: number | null): number | null {
  if (typeof shortValue !== "number" || typeof mediumValue !== "number") {
    return null;
  }
  return roundRatio(shortValue - mediumValue);
}

function computeStrategyOutcomes(args: {
  entries: PromptQualityWindowEntry[];
  lowQualityThreshold: number;
}): PromptQualityStrategyOutcomes {
  let hardBudgetTransitions = 0;
  let hardBudgetDeltaTotal = 0;
  let hardBudgetRecoveredCount = 0;
  let qualityFirstTransitions = 0;
  let qualityFirstDeltaTotal = 0;
  let qualityFirstImprovedCount = 0;
  for (let index = 0; index < args.entries.length - 1; index += 1) {
    const current = args.entries[index];
    const next = args.entries[index + 1];
    if (!current || !next) {
      continue;
    }
    const followupDelta = next.scores.overall - current.scores.overall;
    if (current.signals.preSendStrategy === "hard_budget") {
      hardBudgetTransitions += 1;
      hardBudgetDeltaTotal += followupDelta;
      if (next.scores.overall >= args.lowQualityThreshold) {
        hardBudgetRecoveredCount += 1;
      }
      continue;
    }
    qualityFirstTransitions += 1;
    qualityFirstDeltaTotal += followupDelta;
    if (followupDelta >= 0) {
      qualityFirstImprovedCount += 1;
    }
  }
  return {
    hardBudgetFollowupOverallDelta: hardBudgetTransitions > 0
      ? roundRatio(hardBudgetDeltaTotal / hardBudgetTransitions)
      : null,
    qualityFirstFollowupOverallDelta: qualityFirstTransitions > 0
      ? roundRatio(qualityFirstDeltaTotal / qualityFirstTransitions)
      : null,
    hardBudgetRecoveryRate: hardBudgetTransitions > 0
      ? roundScore(hardBudgetRecoveredCount / hardBudgetTransitions)
      : null,
    qualityFirstImprovedRate: qualityFirstTransitions > 0
      ? roundScore(qualityFirstImprovedCount / qualityFirstTransitions)
      : null,
    hardBudgetTransitions,
    qualityFirstTransitions,
  };
}

function normalizeWindowSize(raw: number | undefined, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(256, Math.max(1, Math.floor(raw)));
}

function resolveWindowPath(workDir: string): string {
  return resolveContextStoragePath(workDir, "prompt_quality_window");
}

function resolveParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

function expectedRecentRowsByStage(stage: PromptCompactionStage): number {
  switch (stage) {
    case "normal":
      return 12;
    case "proactive":
      return 6;
    case "forced":
      return 2;
    case "minimal":
      return 0;
    default:
      return 0;
  }
}

function extractRecentRows(prompt: string): number {
  const lines = prompt.split(/\r?\n/);
  const recentHeaderIndex = lines.findIndex((line) => line.trim() === "[Recent Turns]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (recentHeaderIndex < 0 || userHeaderIndex <= recentHeaderIndex + 1) {
    return 0;
  }
  const rows = lines.slice(recentHeaderIndex + 1, userHeaderIndex);
  let count = 0;
  for (const row of rows) {
    const normalized = row.trim().toLowerCase();
    if (normalized.startsWith("user:") || normalized.startsWith("assistant:")) {
      count += 1;
    }
  }
  return count;
}

function extractSnapshotSectionTitles(prompt: string): string[] {
  const lines = prompt.split(/\r?\n/);
  const snapshotHeaderIndex = lines.findIndex((line) => line.trim() === "[Compact Context Snapshot v2]");
  if (snapshotHeaderIndex < 0) {
    return [];
  }
  const recentHeaderIndex = lines.findIndex((line) => line.trim() === "[Recent Turns]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  const tailIndexCandidates = [recentHeaderIndex, userHeaderIndex].filter((value) => value >= 0);
  const snapshotTailIndex = tailIndexCandidates.length > 0
    ? Math.min(...tailIndexCandidates)
    : lines.length;
  const titles: string[] = [];
  for (let index = snapshotHeaderIndex + 1; index < snapshotTailIndex; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    const match = trimmed.match(/^\[(.+)\]$/);
    if (!match || typeof match[1] !== "string") {
      continue;
    }
    titles.push(match[1].trim());
  }
  return titles;
}

function buildStageCounts(): Record<PromptCompactionStage, number> {
  return {
    normal: 0,
    proactive: 0,
    forced: 0,
    minimal: 0,
  };
}

function normalizeScores(raw: unknown): PromptQualityScores {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return {
      coverage: 0,
      recency: 0,
      size: 0,
      overall: 0,
    };
  }
  const row = raw as Record<string, unknown>;
  return {
    coverage: roundScore(typeof row.coverage === "number" ? row.coverage : 0),
    recency: roundScore(typeof row.recency === "number" ? row.recency : 0),
    size: roundScore(typeof row.size === "number" ? row.size : 0),
    overall: roundScore(typeof row.overall === "number" ? row.overall : 0),
  };
}

function normalizeSignals(raw: unknown): PromptQualitySignals {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return {
      recentRows: 0,
      snapshotSections: 0,
      recentTrimRows: 0,
      snapshotTrimSections: 0,
      snapshotSemanticCompressSections: 0,
      headTrimRetries: 0,
      autoLimitTriggered: false,
      downshiftGuardTriggered: false,
      preSendStrategy: "quality_first",
      preSendOverflowRatio: 0,
      preSendPressureScore: 0,
    };
  }
  const row = raw as Record<string, unknown>;
  const normalizeInt = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0;
  return {
    recentRows: normalizeInt(row.recentRows),
    snapshotSections: normalizeInt(row.snapshotSections),
    recentTrimRows: normalizeInt(row.recentTrimRows),
    snapshotTrimSections: normalizeInt(row.snapshotTrimSections),
    snapshotSemanticCompressSections: normalizeInt(row.snapshotSemanticCompressSections),
    headTrimRetries: normalizeInt(row.headTrimRetries),
    autoLimitTriggered: row.autoLimitTriggered === true,
    downshiftGuardTriggered: row.downshiftGuardTriggered === true,
    preSendStrategy: normalizePreSendStrategy(row.preSendStrategy),
    preSendOverflowRatio: roundRatio(clampNonNegativeRatio(
      typeof row.preSendOverflowRatio === "number" ? row.preSendOverflowRatio : 0,
    )),
    preSendPressureScore: roundScore(clampNonNegativeRatio(
      typeof row.preSendPressureScore === "number" ? row.preSendPressureScore : 0,
    )),
  };
}

function parseWindowEntry(raw: string): PromptQualityWindowEntry | null {
  const line = raw.trim();
  if (!line) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    return null;
  }
  const row = parsed as Record<string, unknown>;
  const ts = typeof row.ts === "string" ? row.ts.trim() : "";
  const sessionKey = typeof row.sessionKey === "string" ? row.sessionKey.trim() : "";
  const stageRaw = typeof row.stage === "string" ? row.stage.trim() : "";
  const stage: PromptCompactionStage =
    stageRaw === "proactive" || stageRaw === "forced" || stageRaw === "minimal"
      ? stageRaw
      : "normal";
  const selectionReason = typeof row.selectionReason === "string"
    ? row.selectionReason.trim()
    : "";
  if (!ts || !sessionKey || !selectionReason) {
    return null;
  }
  const estimatedTokens =
    typeof row.estimatedTokens === "number" && Number.isFinite(row.estimatedTokens)
      ? Math.max(0, Math.floor(row.estimatedTokens))
      : 0;
  const targetTokenLimit =
    typeof row.targetTokenLimit === "number" && Number.isFinite(row.targetTokenLimit)
      ? Math.max(1, Math.floor(row.targetTokenLimit))
      : 1;
  return {
    ts,
    sessionKey,
    stage,
    selectionReason,
    estimatedTokens,
    targetTokenLimit,
    scores: normalizeScores(row.scores),
    signals: normalizeSignals(row.signals),
  };
}

function readWindowEntries(path: string): PromptQualityWindowEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => parseWindowEntry(line))
    .filter((entry): entry is PromptQualityWindowEntry => Boolean(entry));
}

function maybeTrimWindowFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const lockPath = `${path}${TRIM_LOCK_SUFFIX}`;
  let lockFd = -1;
  try {
    lockFd = openSync(lockPath, "wx");
  } catch {
    return;
  }
  try {
    let fileBytes = 0;
    try {
      const raw = readFileSync(path, "utf8");
      fileBytes = raw.length;
    } catch {
      return;
    }
    if (fileBytes < TRIM_TRIGGER_BYTES) {
      return;
    }
    const entries = readWindowEntries(path);
    if (entries.length <= MAX_PERSISTED_ENTRIES) {
      return;
    }
    const trimmed = entries.slice(-MAX_PERSISTED_ENTRIES);
    const content = trimmed.map((entry) => JSON.stringify(entry)).join("\n");
    try {
      writeFileSync(path, `${content}\n`, "utf8");
    } catch {
      // best effort only
    }
  } finally {
    try {
      if (lockFd >= 0) {
        closeSync(lockFd);
      }
    } catch {
      // ignore lock close failure
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore lock cleanup failure
    }
  }
}

export function computePromptQualitySample(input: {
  prompt: string;
  stage: PromptCompactionStage;
  estimatedTokens: number;
  targetTokenLimit: number;
  recentTrimRows: number;
  snapshotTrimSections: number;
  snapshotSemanticCompressSections: number;
  headTrimRetries: number;
  autoLimitTriggered: boolean;
  downshiftGuardTriggered: boolean;
  preSendStrategy: PromptPreSendStrategy;
  preSendOverflowRatio: number;
  preSendPressureScore: number;
}): {
  scores: PromptQualityScores;
  signals: PromptQualitySignals;
} {
  const recentRows = extractRecentRows(input.prompt);
  const snapshotSectionTitles = extractSnapshotSectionTitles(input.prompt);
  const sectionSet = new Set(snapshotSectionTitles.map((title) => title.trim().toLowerCase()));
  const coreSections = [
    "architecture decisions",
    "modified files and key changes",
    "current verification status",
    "open todos and rollback notes",
  ];
  let coreHits = 0;
  for (const key of coreSections) {
    if (sectionSet.has(key)) {
      coreHits += 1;
    }
  }
  const coverage = roundScore(coreHits / coreSections.length);
  const expectedRecentRows = expectedRecentRowsByStage(input.stage);
  const recency = expectedRecentRows <= 0
    ? 1
    : roundScore(recentRows / expectedRecentRows);
  const normalizedTarget = Math.max(1, input.targetTokenLimit);
  const ratio = input.estimatedTokens / normalizedTarget;
  const size = roundScore(
    ratio <= 1
      ? 1
      : Math.max(0, 1 - (ratio - 1) * 2),
  );
  const overall = roundScore(
    coverage * 0.45
    + recency * 0.25
    + size * 0.30,
  );
  return {
    scores: {
      coverage,
      recency,
      size,
      overall,
    },
    signals: {
      recentRows,
      snapshotSections: snapshotSectionTitles.length,
      recentTrimRows: Math.max(0, Math.floor(input.recentTrimRows)),
      snapshotTrimSections: Math.max(0, Math.floor(input.snapshotTrimSections)),
      snapshotSemanticCompressSections: Math.max(0, Math.floor(input.snapshotSemanticCompressSections)),
      headTrimRetries: Math.max(0, Math.floor(input.headTrimRetries)),
      autoLimitTriggered: input.autoLimitTriggered,
      downshiftGuardTriggered: input.downshiftGuardTriggered,
      preSendStrategy: normalizePreSendStrategy(input.preSendStrategy),
      preSendOverflowRatio: roundRatio(clampNonNegativeRatio(input.preSendOverflowRatio)),
      preSendPressureScore: roundScore(clampNonNegativeRatio(input.preSendPressureScore)),
    },
  };
}

export function appendPromptQualityWindowEntry(input: {
  workDir: string;
  entry: PromptQualityWindowEntry;
}): void {
  const path = resolveWindowPath(input.workDir);
  try {
    mkdirSync(resolveParentDir(path), { recursive: true });
    const serialized = `${JSON.stringify(input.entry)}\n`;
    const fd = openSync(path, "a");
    try {
      writeSync(fd, serialized, undefined, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return;
  }
  maybeTrimWindowFile(path);
}

export function readPromptQualityWindowSummary(input: {
  workDir: string;
  size?: number;
  lowQualityThreshold?: number;
}): PromptQualityWindowSummary {
  const configuredSize = normalizeWindowSize(input.size, 20);
  const path = resolveWindowPath(input.workDir);
  const lowQualityThreshold = clamp01(
    typeof input.lowQualityThreshold === "number"
      ? input.lowQualityThreshold
      : DEFAULT_LOW_QUALITY_THRESHOLD,
  );
  const entries = readWindowEntries(path).slice(-configuredSize);
  const stageCounts = buildStageCounts();
  let totalCoverage = 0;
  let totalRecency = 0;
  let totalSize = 0;
  let totalOverall = 0;
  let lowQualityCount = 0;
  let totalRecentRows = 0;
  let totalSnapshotSections = 0;
  let totalRecentTrimRows = 0;
  let totalSnapshotTrimSections = 0;
  let totalSnapshotSemanticCompressSections = 0;
  let totalHeadTrimRetries = 0;
  let totalPreSendOverflowRatio = 0;
  let totalPreSendPressureScore = 0;
  let recentTrimTriggeredCount = 0;
  let snapshotTrimTriggeredCount = 0;
  let snapshotSemanticCompressTriggeredCount = 0;
  let headTrimTriggeredCount = 0;
  let autoLimitTriggeredCount = 0;
  let downshiftGuardTriggeredCount = 0;
  let qualityFirstStrategyCount = 0;
  let hardBudgetStrategyCount = 0;
  let totalEstimatedTokens = 0;
  let totalTargetTokenLimit = 0;
  let totalUtilizationRatio = 0;
  for (const entry of entries) {
    stageCounts[entry.stage] += 1;
    totalCoverage += entry.scores.coverage;
    totalRecency += entry.scores.recency;
    totalSize += entry.scores.size;
    totalOverall += entry.scores.overall;
    totalRecentRows += entry.signals.recentRows;
    totalSnapshotSections += entry.signals.snapshotSections;
    totalRecentTrimRows += entry.signals.recentTrimRows;
    totalSnapshotTrimSections += entry.signals.snapshotTrimSections;
    totalSnapshotSemanticCompressSections += entry.signals.snapshotSemanticCompressSections;
    totalHeadTrimRetries += entry.signals.headTrimRetries;
    totalPreSendOverflowRatio += entry.signals.preSendOverflowRatio;
    totalPreSendPressureScore += entry.signals.preSendPressureScore;
    totalEstimatedTokens += entry.estimatedTokens;
    totalTargetTokenLimit += entry.targetTokenLimit;
    totalUtilizationRatio += entry.estimatedTokens / Math.max(1, entry.targetTokenLimit);
    if (entry.signals.preSendStrategy === "hard_budget") {
      hardBudgetStrategyCount += 1;
    } else {
      qualityFirstStrategyCount += 1;
    }
    if (entry.signals.recentTrimRows > 0) {
      recentTrimTriggeredCount += 1;
    }
    if (entry.signals.snapshotTrimSections > 0) {
      snapshotTrimTriggeredCount += 1;
    }
    if (entry.signals.snapshotSemanticCompressSections > 0) {
      snapshotSemanticCompressTriggeredCount += 1;
    }
    if (entry.signals.headTrimRetries > 0) {
      headTrimTriggeredCount += 1;
    }
    if (entry.signals.autoLimitTriggered) {
      autoLimitTriggeredCount += 1;
    }
    if (entry.signals.downshiftGuardTriggered) {
      downshiftGuardTriggeredCount += 1;
    }
    if (entry.scores.overall < lowQualityThreshold) {
      lowQualityCount += 1;
    }
  }
  const count = entries.length;
  const averageScores = count > 0
    ? {
      coverage: roundScore(totalCoverage / count),
      recency: roundScore(totalRecency / count),
      size: roundScore(totalSize / count),
      overall: roundScore(totalOverall / count),
    }
    : null;
  const signalAverages = count > 0
    ? {
      recentRows: roundRatio(totalRecentRows / count),
      snapshotSections: roundRatio(totalSnapshotSections / count),
      recentTrimRows: roundRatio(totalRecentTrimRows / count),
      snapshotTrimSections: roundRatio(totalSnapshotTrimSections / count),
      snapshotSemanticCompressSections: roundRatio(totalSnapshotSemanticCompressSections / count),
      headTrimRetries: roundRatio(totalHeadTrimRetries / count),
      preSendOverflowRatio: roundRatio(totalPreSendOverflowRatio / count),
      preSendPressureScore: roundScore(totalPreSendPressureScore / count),
    }
    : null;
  const latest = entries[count - 1] ?? null;
  const shortStrategyTrend = computeStrategyTrendWindow({
    entries,
    windowSize: SHORT_STRATEGY_WINDOW,
  });
  const mediumStrategyTrend = computeStrategyTrendWindow({
    entries,
    windowSize: MEDIUM_STRATEGY_WINDOW,
  });
  const shortPressureTrend = computePressureTrendWindow({
    entries,
    windowSize: SHORT_PRESSURE_WINDOW,
  });
  const mediumPressureTrend = computePressureTrendWindow({
    entries,
    windowSize: MEDIUM_PRESSURE_WINDOW,
  });
  const strategyOutcomes = computeStrategyOutcomes({
    entries,
    lowQualityThreshold,
  });
  return {
    path,
    configuredSize,
    entries: count,
    fromTs: entries[0]?.ts ?? null,
    toTs: latest?.ts ?? null,
    averageScores,
    latestScores: latest?.scores ?? null,
    lowQualityCount,
    lowQualityRate: count > 0 ? roundScore(lowQualityCount / count) : null,
    lowQualityThreshold,
    stageCounts,
    signalAverages,
    compressionActivity: {
      recentTrimRate: count > 0 ? roundScore(recentTrimTriggeredCount / count) : null,
      snapshotTrimRate: count > 0 ? roundScore(snapshotTrimTriggeredCount / count) : null,
      snapshotSemanticCompressRate:
        count > 0 ? roundScore(snapshotSemanticCompressTriggeredCount / count) : null,
      headTrimRate: count > 0 ? roundScore(headTrimTriggeredCount / count) : null,
      autoLimitTriggeredRate: count > 0 ? roundScore(autoLimitTriggeredCount / count) : null,
      downshiftGuardTriggeredRate: count > 0 ? roundScore(downshiftGuardTriggeredCount / count) : null,
    },
    strategyActivity: {
      qualityFirstRate: count > 0 ? roundScore(qualityFirstStrategyCount / count) : null,
      hardBudgetRate: count > 0 ? roundScore(hardBudgetStrategyCount / count) : null,
    },
    tokenBudget: {
      averageEstimatedTokens: count > 0 ? Math.round(totalEstimatedTokens / count) : null,
      averageTargetTokenLimit: count > 0 ? Math.round(totalTargetTokenLimit / count) : null,
      averageUtilizationRatio: count > 0 ? roundRatio(totalUtilizationRatio / count) : null,
    },
    strategyTrends: {
      short: shortStrategyTrend,
      medium: mediumStrategyTrend,
      delta: {
        hardBudgetRate: derivePressureTrendDelta(
          shortStrategyTrend.hardBudgetRate,
          mediumStrategyTrend.hardBudgetRate,
        ),
        averageOverflowRatio: derivePressureTrendDelta(
          shortStrategyTrend.averageOverflowRatio,
          mediumStrategyTrend.averageOverflowRatio,
        ),
        averagePressureScore: derivePressureTrendDelta(
          shortStrategyTrend.averagePressureScore,
          mediumStrategyTrend.averagePressureScore,
        ),
      },
    },
    strategyOutcomes,
    pressureTrends: {
      short: shortPressureTrend,
      medium: mediumPressureTrend,
      delta: {
        snapshotSemanticCompressRate: derivePressureTrendDelta(
          shortPressureTrend.snapshotSemanticCompressRate,
          mediumPressureTrend.snapshotSemanticCompressRate,
        ),
        autoLimitTriggeredRate: derivePressureTrendDelta(
          shortPressureTrend.autoLimitTriggeredRate,
          mediumPressureTrend.autoLimitTriggeredRate,
        ),
        averageUtilizationRatio: derivePressureTrendDelta(
          shortPressureTrend.averageUtilizationRatio,
          mediumPressureTrend.averageUtilizationRatio,
        ),
      },
    },
  };
}

export function assessPromptQualityWindowDegradation(input: {
  summary: PromptQualityWindowSummary;
  thresholdOverall: number;
  thresholdLowQualityRate: number;
  minEntries: number;
}): PromptQualityWindowDegradation {
  const thresholdOverall = clamp01(input.thresholdOverall);
  const thresholdLowQualityRate = clamp01(input.thresholdLowQualityRate);
  const minEntries = Math.max(1, Math.floor(input.minEntries));
  if (input.summary.entries < minEntries) {
    return {
      degraded: false,
      reason: "insufficient_entries",
      thresholdOverall,
      thresholdLowQualityRate,
      minEntries,
      observedEntries: input.summary.entries,
      observedOverall: input.summary.averageScores?.overall ?? null,
      observedLowQualityRate: input.summary.lowQualityRate,
    };
  }
  const observedOverall = input.summary.averageScores?.overall ?? null;
  const observedLowQualityRate = input.summary.lowQualityRate;
  if (typeof observedOverall === "number" && observedOverall < thresholdOverall) {
    return {
      degraded: true,
      reason: "overall_below_threshold",
      thresholdOverall,
      thresholdLowQualityRate,
      minEntries,
      observedEntries: input.summary.entries,
      observedOverall,
      observedLowQualityRate,
    };
  }
  if (
    typeof observedLowQualityRate === "number"
    && observedLowQualityRate > thresholdLowQualityRate
  ) {
    return {
      degraded: true,
      reason: "low_quality_rate_above_threshold",
      thresholdOverall,
      thresholdLowQualityRate,
      minEntries,
      observedEntries: input.summary.entries,
      observedOverall,
      observedLowQualityRate,
    };
  }
  return {
    degraded: false,
    reason: "healthy",
    thresholdOverall,
    thresholdLowQualityRate,
    minEntries,
    observedEntries: input.summary.entries,
    observedOverall,
    observedLowQualityRate,
  };
}
