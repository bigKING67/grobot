import {
  type AskUserEnvelope,
  type AskUserResolveResult,
  type ResolvedAskUser,
} from "./schema";

export interface AskUserRuntimeAdapter {
  buildAskUserDisplay(envelope: AskUserEnvelope): string;
  registerPendingAsk(sessionKey: string, envelope: AskUserEnvelope): void;
  resolvePendingAsk(sessionKey: string, answer: string): AskUserResolveResult | undefined;
}

export interface AskUserTurnPromptContext {
  resolvedAsk: ResolvedAskUser | undefined;
  pendingNextAsk: AskUserEnvelope | undefined;
  queueSizeAfterResolve: number;
  resolvedEvent: string;
  promptParts: string[];
}

export function createAskUserTurnPromptContext(input: {
  runtime: AskUserRuntimeAdapter;
  sessionKey: string;
  userText: string;
}): AskUserTurnPromptContext {
  const promptParts: string[] = [];
  const resolved = input.runtime.resolvePendingAsk(input.sessionKey, input.userText);
  const resolvedAsk = resolved?.resolvedAsk;
  const resumePrompt = resolved?.resumePrompt?.trim();
  if (resumePrompt) {
    promptParts.push(resumePrompt);
  }
  return {
    resolvedAsk,
    pendingNextAsk: resolved?.pendingNextAsk,
    queueSizeAfterResolve: resolved?.queueSizeAfterResolve ?? 0,
    resolvedEvent: resolvedAsk ? formatAskUserResolvedEvent(resolvedAsk) : "",
    promptParts,
  };
}

export function formatAskUserResolvedEvent(resolvedAsk: ResolvedAskUser): string {
  return `[ask-user] event=resolved ask_id=${resolvedAsk.envelope.askId} blocking_node_id=${resolvedAsk.envelope.blockingNodeId}\n`;
}

export function formatAskUserIssuedEvent(envelope: AskUserEnvelope): string {
  return `[ask-user] event=issued ask_id=${envelope.askId} blocking_node_id=${envelope.blockingNodeId}\n`;
}
