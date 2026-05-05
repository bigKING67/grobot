import { type RuntimeAskUserInterrupt } from "../../../models/types";
import { type AskUserEnvelope } from "../../../tools/ask-user";
import { nowIso } from "./time";

export function buildAskUserQueueContinuationHint(queuedExtra: number): string {
  if (queuedExtra <= 0) {
    return "";
  }
  return `${String(queuedExtra)} follow-up confirmations remain. Keep choosing or reply directly.\n`;
}

function normalizeRuntimeAskUserId(input: {
  askId: string;
  questionKey: string;
  index: number;
  total: number;
}): string {
  const normalizedBaseId = input.askId.trim() || `askq_${Date.now().toString(36)}`;
  const normalizedQuestionKey = input.questionKey.trim();
  if (input.total <= 1) {
    return normalizedQuestionKey || normalizedBaseId;
  }
  const suffix = normalizedQuestionKey || `q${String(input.index + 1)}`;
  if (suffix === normalizedBaseId) {
    return `${normalizedBaseId}:q${String(input.index + 1)}`;
  }
  return `${normalizedBaseId}:${suffix}`;
}

export function toAskUserEnvelopes(runtimeAskUser: RuntimeAskUserInterrupt): AskUserEnvelope[] {
  type NormalizedAskQuestion = {
    key: string;
    header: string;
    question: string;
    optionsDetailed: Array<{ label: string; description?: string; value: string }>;
  };
  const structuredQuestions: NormalizedAskQuestion[] = [];
  for (let index = 0; index < runtimeAskUser.questions.length; index += 1) {
    const question = runtimeAskUser.questions[index];
    if (!question) {
      continue;
    }
    const text = question.question.trim();
    if (!text) {
      continue;
    }
    const optionsDetailed: NormalizedAskQuestion["optionsDetailed"] = [];
    for (const option of question.options) {
      const label = option.label.trim();
      if (!label) {
        continue;
      }
      const description = option.description?.trim() || undefined;
      const value = (option.value ?? label).trim() || label;
      optionsDetailed.push({
        label,
        description,
        value,
      });
    }
    structuredQuestions.push({
      key: question.id.trim() || `q${String(index + 1)}`,
      header: question.header.trim() || `Question ${String(index + 1)}`,
      question: text,
      optionsDetailed,
    });
  }
  if (structuredQuestions.length === 0) {
    return [];
  }
  const normalizedResumeToken = runtimeAskUser.resumeToken
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const baseAskId = normalizedResumeToken
    ? `askq_${normalizedResumeToken}`
    : (structuredQuestions[0]?.key || `askq_${Date.now().toString(36)}`);
  const questionTotal = structuredQuestions.length;
  const envelopes: AskUserEnvelope[] = [];
  for (let index = 0; index < structuredQuestions.length; index += 1) {
    const question = structuredQuestions[index];
    if (!question) {
      continue;
    }
    envelopes.push({
      askId: normalizeRuntimeAskUserId({
        askId: baseAskId,
        questionKey: question.key,
        index,
        total: questionTotal,
      }),
      blockingNodeId: runtimeAskUser.blockingNodeId || "node.unknown",
      question: question.question,
      options: question.optionsDetailed.map((option) => option.label),
      optionsDetailed: question.optionsDetailed,
      questionKey: question.key,
      header: question.header,
      questionIndex: questionTotal > 1 ? index + 1 : undefined,
      questionTotal: questionTotal > 1 ? questionTotal : undefined,
      defaultOnTimeout: runtimeAskUser.defaultOnTimeout || "continue_with_best_effort",
      resumeToken: runtimeAskUser.resumeToken || `resume_${Date.now().toString(36)}`,
      createdAt: runtimeAskUser.createdAt || nowIso(),
    });
  }
  return envelopes;
}
