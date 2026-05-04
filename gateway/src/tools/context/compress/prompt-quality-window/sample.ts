import { type PromptCompactionStage } from "../../types";
import type {
  PromptPreSendStrategy,
  PromptQualityScores,
  PromptQualitySignals,
} from "./contract";
import {
  extractRecentRows,
  extractSnapshotSectionTitles,
} from "./prompt-parse";
import {
  clampNonNegativeRatio,
  expectedRecentRowsByStage,
  normalizePreSendStrategy,
  roundRatio,
  roundScore,
} from "./scoring";

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
