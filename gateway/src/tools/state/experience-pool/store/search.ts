import {
  type ExperienceRecord,
  type ExperienceSearchMatch,
} from "../types";
import {
  deriveScenarioTags,
  deriveTaskSignature,
  deriveTaskType,
} from "./derive";
import {
  compactWhitespace,
  computeTokenOverlap,
  extractTokens,
  uniqueTrimmed,
} from "./utils";

export interface ExperienceQueryProfile {
  rawQuery: string;
  tokens: string[];
  taskType: string;
  scenarioTags: string[];
  taskSignature: string;
  taskTokens: string[];
}

export function buildQueryProfile(rawQuery: string): ExperienceQueryProfile {
  const normalized = compactWhitespace(rawQuery);
  const tokens = extractTokens(normalized).slice(0, 24);
  const taskType = deriveTaskType(normalized);
  const scenarioTags = deriveScenarioTags(normalized);
  const taskSignature = deriveTaskSignature(normalized, "");
  const taskTokens = extractTokens(taskSignature);
  return {
    rawQuery: normalized,
    tokens,
    taskType,
    scenarioTags,
    taskSignature,
    taskTokens,
  };
}

export function scoreRecordForQuery(
  record: ExperienceRecord,
  profile: ExperienceQueryProfile,
): ExperienceSearchMatch {
  const signatureText = `${record.signature} ${record.summary}`.toLowerCase();
  const keywordSet = new Set<string>(record.keywords.map((token) => token.toLowerCase()));
  const queryTokens = profile.tokens.map((token) => token.toLowerCase());
  const matchedTokens: string[] = [];
  let lexicalOverlap = 0;
  for (const token of queryTokens) {
    if (keywordSet.has(token) || signatureText.includes(token)) {
      lexicalOverlap += 1;
      matchedTokens.push(token);
    }
  }

  const recordTaskTokens = extractTokens(record.taskSignature).map((token) => token.toLowerCase());
  const taskTokenOverlap = computeTokenOverlap(queryTokens, recordTaskTokens);
  const matchedTaskSignals: string[] = [];
  if (profile.taskType === record.taskType && profile.taskType !== "general_task") {
    matchedTaskSignals.push(`task_type:${record.taskType}`);
  }
  if (taskTokenOverlap > 0) {
    matchedTaskSignals.push(...recordTaskTokens.slice(0, Math.min(3, taskTokenOverlap)).map((token) => `task:${token}`));
  }

  const queryScenarioSet = new Set(profile.scenarioTags.map((tag) => tag.toLowerCase()));
  const matchedScenarioTags = record.scenarioTags.filter((tag) => queryScenarioSet.has(tag.toLowerCase()));

  const lexicalScore = lexicalOverlap * 16;
  const taskScore = taskTokenOverlap * 22;
  const taskTypeScore = matchedTaskSignals.some((item) => item.startsWith("task_type:")) ? 14 : 0;
  const scenarioScore = matchedScenarioTags.length * 18;
  const confidenceScore = record.confidence * 42;
  const verificationRate = record.successCount > 0
    ? record.verificationPassCount / Math.max(1, record.successCount)
    : 0;
  const verificationScore = verificationRate * 18;
  const successScore = Math.min(22, Math.log2(record.successCount + 1) * 9);
  const recoveryScore = Math.min(18, record.recoverySuccessCount * 4.5);
  const freshnessHours = Math.max(0, (Date.now() - Date.parse(record.updatedAt)) / 3_600_000);
  const freshnessScore = Math.max(0, 28 - Math.min(28, freshnessHours)) * 0.45;

  const failurePenalty = Math.min(26, record.failureCount * 2.8);
  const consecutivePenalty = Math.min(24, record.consecutiveFailureCount * 7);
  const outcomePenalty = record.lastOutcome === "failure" ? 8 : 0;
  const statePenalty = record.state === "active" ? 0 : record.state === "quarantined" ? 20 : 80;

  const score = lexicalScore
    + taskScore
    + taskTypeScore
    + scenarioScore
    + confidenceScore
    + verificationScore
    + successScore
    + recoveryScore
    + freshnessScore
    - failurePenalty
    - consecutivePenalty
    - outcomePenalty
    - statePenalty;

  return {
    record,
    score: Number(score.toFixed(4)),
    matchedTokens: uniqueTrimmed(matchedTokens, 8),
    matchedTaskSignals: uniqueTrimmed(matchedTaskSignals, 6),
    matchedScenarioTags: uniqueTrimmed(matchedScenarioTags, 6),
  };
}
