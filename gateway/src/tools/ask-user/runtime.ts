import { type AskUserEnvelope, type ResolvedAskUser } from "./schema";

export interface AskUserRuntimeAdapter {
  buildAskUserDisplay(envelope: AskUserEnvelope): string;
  registerPendingAsk(sessionKey: string, envelope: AskUserEnvelope): void;
  resolvePendingAsk(sessionKey: string, answer: string): ResolvedAskUser | undefined;
}

export interface AskUserTurnPromptContext {
  resolvedAsk: ResolvedAskUser | undefined;
  resolvedEvent: string;
  promptParts: string[];
}

export function createAskUserTurnPromptContext(input: {
  runtime: AskUserRuntimeAdapter;
  sessionKey: string;
  userText: string;
}): AskUserTurnPromptContext {
  const promptParts: string[] = [];
  const resolvedAsk = input.runtime.resolvePendingAsk(input.sessionKey, input.userText);
  if (resolvedAsk) {
    promptParts.push(resolvedAsk.resumePrompt);
  }
  return {
    resolvedAsk,
    resolvedEvent: resolvedAsk ? formatAskUserResolvedEvent(resolvedAsk) : "",
    promptParts,
  };
}

export function formatAskUserResolvedEvent(resolvedAsk: ResolvedAskUser): string {
  return `[ask-user] event=resolved question_id=${resolvedAsk.envelope.questionId} blocking_node_id=${resolvedAsk.envelope.blockingNodeId}\n`;
}

export function formatAskUserIssuedEvent(envelope: AskUserEnvelope): string {
  return `[ask-user] event=issued question_id=${envelope.questionId} blocking_node_id=${envelope.blockingNodeId}\n`;
}
