import { type PromptCompactionStage } from "../../types";
import type {
  PromptQualityScores,
  PromptQualitySignals,
  PromptQualityWindowEntry,
} from "./contract";
import {
  clampNonNegativeRatio,
  normalizePreSendStrategy,
  roundRatio,
  roundScore,
} from "./scoring";

export function buildStageCounts(): Record<PromptCompactionStage, number> {
  return {
    normal: 0,
    proactive: 0,
    forced: 0,
    minimal: 0,
  };
}

export function normalizeScores(raw: unknown): PromptQualityScores {
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

export function normalizeSignals(raw: unknown): PromptQualitySignals {
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

export function parseWindowEntry(raw: string): PromptQualityWindowEntry | null {
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
