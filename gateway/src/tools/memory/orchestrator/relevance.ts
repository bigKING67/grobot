import type {
  MemoryOrchestratorExperienceSearchMatch,
  MemoryOrchestratorGaMemoryRecord,
} from "./contract";
import {
  clamp,
  tokenize,
} from "./utils";

export function scoreGaMemoryRelevance(input: {
  userTokens: readonly string[];
  row: MemoryOrchestratorGaMemoryRecord;
}): number {
  const text = input.row.text.toLowerCase();
  let overlap = 0;
  for (const token of input.userTokens) {
    if (text.includes(token)) {
      overlap += 1;
    }
  }
  const overlapScore = Math.min(90, overlap * 18);
  const confidenceScore = clamp(input.row.confidence, 0, 1) * 48;
  const executionBoost = input.row.executionVerified ? 20 : 0;
  const memoryLevelBoost = input.row.memoryLevel === "L3" ? 16 : input.row.memoryLevel === "L2" ? 10 : 5;
  const ageHours = Math.max(0, (Date.now() - Date.parse(input.row.createdAt)) / 3_600_000);
  const freshnessScore = Math.max(0, 30 - Math.min(30, ageHours)) * 0.35;
  return Number((overlapScore + confidenceScore + executionBoost + memoryLevelBoost + freshnessScore).toFixed(4));
}

export function scoreTeamExperienceRelevance(input: {
  userText: string;
  row: MemoryOrchestratorExperienceSearchMatch;
}): number {
  const userTokens = tokenize(input.userText);
  const summary = input.row.record.summary.toLowerCase();
  const taskSignature = (input.row.record.taskSignature ?? "").toLowerCase();
  const taskType = (input.row.record.taskType ?? "").toLowerCase();
  const scenarioTags = (input.row.record.scenarioTags ?? []).map((item) => item.toLowerCase());
  let overlap = 0;
  let taskOverlap = 0;
  let scenarioOverlap = 0;
  for (const token of userTokens) {
    if (summary.includes(token)) {
      overlap += 1;
    }
    if (taskSignature.includes(token)) {
      taskOverlap += 1;
    }
    if (scenarioTags.some((tag) => tag.includes(token) || token.includes(tag))) {
      scenarioOverlap += 1;
    }
  }
  const overlapScore = overlap * 10;
  const taskScore = taskOverlap * 12;
  const scenarioScore = scenarioOverlap * 8;
  const taskTypeScore = taskType && input.userText.toLowerCase().includes(taskType) ? 8 : 0;
  const baseScore = input.row.score;
  const confidenceScore = clamp(input.row.record.confidence, 0, 1) * 25;
  const successBoost = Math.min(20, input.row.record.successCount * 2.5);
  const failurePenalty = Math.min(18, input.row.record.failureCount * 3);
  const recoveryBoost = Math.min(12, (input.row.record.recoverySuccessCount ?? 0) * 2.5);
  const instabilityPenalty = Math.min(14, (input.row.record.consecutiveFailureCount ?? 0) * 4);
  return Number((
    baseScore
    + overlapScore
    + taskScore
    + scenarioScore
    + taskTypeScore
    + confidenceScore
    + successBoost
    + recoveryBoost
    - failurePenalty
    - instabilityPenalty
  ).toFixed(4));
}
