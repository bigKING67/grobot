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
  resolvedAsks: ResolvedAskUser[];
  pendingNextAsk: AskUserEnvelope | undefined;
  queueSizeAfterResolve: number;
  resolvedEvent: string;
  promptParts: string[];
}

function parseNumberedBatchAnswers(userText: string): string[] | undefined {
  const lines = userText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) {
    return undefined;
  }
  const answers: string[] = [];
  let expectedIndex = 1;
  for (const line of lines) {
    const match = /^(\d+|[０-９]+)[.)、:：-]\s*(.+)$/u.exec(line);
    if (!match) {
      return undefined;
    }
    const ordinal = match[1] ?? "";
    const answerRaw = (match[2] ?? "").trim();
    const answer = (() => {
      if (answerRaw.startsWith("\"")) {
        try {
          const parsed = JSON.parse(answerRaw);
          if (typeof parsed === "string") {
            return parsed;
          }
        } catch {
          return answerRaw;
        }
      }
      return answerRaw;
    })();
    const normalizedOrdinal = ordinal.replace(/[０-９]/gu, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
    const parsed = Number.parseInt(normalizedOrdinal, 10);
    if (!Number.isFinite(parsed) || parsed !== expectedIndex || answer.trim().length <= 0) {
      return undefined;
    }
    answers.push(answer);
    expectedIndex += 1;
  }
  return answers.length > 1 ? answers : undefined;
}

export function createAskUserTurnPromptContext(input: {
  runtime: AskUserRuntimeAdapter;
  sessionKey: string;
  userText: string;
}): AskUserTurnPromptContext {
  const promptParts: string[] = [];
  const answers = parseNumberedBatchAnswers(input.userText) ?? [input.userText];
  const resolvedAsks: ResolvedAskUser[] = [];
  let pendingNextAsk: AskUserEnvelope | undefined;
  let queueSizeAfterResolve = 0;
  let finalResumePrompt = "";
  for (let index = 0; index < answers.length; index += 1) {
    const resolved = input.runtime.resolvePendingAsk(input.sessionKey, answers[index] ?? "");
    if (!resolved) {
      break;
    }
    resolvedAsks.push(resolved.resolvedAsk);
    pendingNextAsk = resolved.pendingNextAsk;
    queueSizeAfterResolve = resolved.queueSizeAfterResolve;
    finalResumePrompt = resolved.resumePrompt?.trim() ?? "";
    if (!pendingNextAsk) {
      break;
    }
  }
  if (finalResumePrompt) {
    promptParts.push(finalResumePrompt);
  }
  const resolvedAsk = resolvedAsks[0];
  return {
    resolvedAsk,
    resolvedAsks,
    pendingNextAsk,
    queueSizeAfterResolve,
    resolvedEvent: resolvedAsks.map((item) => formatAskUserResolvedEvent(item)).join(""),
    promptParts,
  };
}

export function formatAskUserResolvedEvent(resolvedAsk: ResolvedAskUser): string {
  return `[ask-user] event=resolved ask_id=${resolvedAsk.envelope.askId} blocking_node_id=${resolvedAsk.envelope.blockingNodeId}\n`;
}

export function formatAskUserIssuedEvent(envelope: AskUserEnvelope): string {
  return `[ask-user] event=issued ask_id=${envelope.askId} blocking_node_id=${envelope.blockingNodeId}\n`;
}
