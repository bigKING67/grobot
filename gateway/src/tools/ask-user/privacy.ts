import type { AskUserEnvelope, ResolvedAskUser } from "./schema";

export const ASK_USER_SECRET_DISPLAY_VALUE = "••••••";
export const ASK_USER_SECRET_PERSISTENCE_VALUE = "<redacted:ask_user_secret>";

export function isAskUserSecret(envelope: AskUserEnvelope | undefined | null): boolean {
  return envelope?.isSecret === true;
}

export function formatAskUserAnswerForDisplay(input: {
  envelope: AskUserEnvelope;
  answer: string | undefined;
}): string | undefined {
  if (typeof input.answer !== "string") {
    return undefined;
  }
  if (!isAskUserSecret(input.envelope)) {
    return input.answer;
  }
  return input.answer.trim().length > 0 ? ASK_USER_SECRET_DISPLAY_VALUE : input.answer;
}

export function formatAskUserAnswerForPersistence(input: {
  envelope: AskUserEnvelope;
  answer: string | undefined;
}): string | undefined {
  if (typeof input.answer !== "string") {
    return undefined;
  }
  return isAskUserSecret(input.envelope) ? ASK_USER_SECRET_PERSISTENCE_VALUE : input.answer;
}

export function formatAskUserResolvedAnswerForPersistence(resolvedAsk: ResolvedAskUser): string {
  return formatAskUserAnswerForPersistence({
    envelope: resolvedAsk.envelope,
    answer: resolvedAsk.answer,
  }) ?? "";
}

export function countAskUserSecretAnswers(resolvedAsks: readonly ResolvedAskUser[]): number {
  return resolvedAsks.filter((resolvedAsk) => isAskUserSecret(resolvedAsk.envelope)).length;
}

export function buildAskUserSafeUserText(input: {
  rawUserText: string;
  resolvedAsks: readonly ResolvedAskUser[];
}): string {
  const secretAnswerCount = countAskUserSecretAnswers(input.resolvedAsks);
  if (secretAnswerCount <= 0) {
    return input.rawUserText;
  }
  const lines = [
    "[ask_user answer redaction]",
    `secret_answer_count=${String(secretAnswerCount)}`,
    `answer_count=${String(input.resolvedAsks.length)}`,
  ];
  for (let index = 0; index < input.resolvedAsks.length; index += 1) {
    const resolvedAsk = input.resolvedAsks[index];
    const order = index + 1;
    lines.push(`ask_${String(order)}_id=${resolvedAsk.envelope.askId}`);
    lines.push(`ask_${String(order)}_is_secret=${isAskUserSecret(resolvedAsk.envelope) ? "true" : "false"}`);
    lines.push(`ask_${String(order)}_answer=${formatAskUserResolvedAnswerForPersistence(resolvedAsk)}`);
  }
  return lines.join("\n");
}
