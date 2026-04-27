import {
  type AskUserEnvelope,
  type AskUserResolveResult,
  type ResolvedAskUser,
} from "./schema";
import {
  buildAskUserSafeUserText,
  countAskUserSecretAnswers,
} from "./privacy";

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
  safeUserText: string;
  hasSecretAnswers: boolean;
  secretAnswerCount: number;
}

interface ParsedAskUserAnswer {
  answer: string;
  notes?: string;
}

function parseAnswerPayload(answerRaw: string): ParsedAskUserAnswer {
  if (answerRaw.startsWith("\"") || answerRaw.startsWith("{")) {
    try {
      const parsed = JSON.parse(answerRaw) as unknown;
      if (typeof parsed === "string") {
        return { answer: parsed };
      }
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.answer === "string" && record.answer.trim().length > 0) {
          const notes = typeof record.notes === "string" && record.notes.trim().length > 0
            ? record.notes
            : undefined;
          return notes
            ? { answer: record.answer, notes }
            : { answer: record.answer };
        }
      }
    } catch {
      return { answer: answerRaw };
    }
  }
  return { answer: answerRaw };
}

function compactAskUserNotes(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function buildAskUserNotesPrompt(input: {
  rows: readonly { resolvedAsk: ResolvedAskUser; notes: string }[];
}): string {
  if (input.rows.length <= 0) {
    return "";
  }
  const lines = [
    "[AskUser Notes]",
    `note_count=${String(input.rows.length)}`,
  ];
  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const order = index + 1;
    lines.push(`ask_${String(order)}_id=${row.resolvedAsk.envelope.askId}`);
    lines.push(`ask_${String(order)}_notes=${compactAskUserNotes(row.notes)}`);
  }
  return lines.join("\n");
}

function parseNumberedBatchAnswers(userText: string): ParsedAskUserAnswer[] | undefined {
  const lines = userText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 0) {
    return undefined;
  }
  const answers: ParsedAskUserAnswer[] = [];
  let expectedIndex = 1;
  for (const line of lines) {
    const match = /^(\d+|[０-９]+)[.)、:：-]\s*(.+)$/u.exec(line);
    if (!match) {
      return undefined;
    }
    const ordinal = match[1] ?? "";
    const answerRaw = (match[2] ?? "").trim();
    const parsedAnswer = parseAnswerPayload(answerRaw);
    const normalizedOrdinal = ordinal.replace(/[０-９]/gu, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
    const parsed = Number.parseInt(normalizedOrdinal, 10);
    if (!Number.isFinite(parsed) || parsed !== expectedIndex || parsedAnswer.answer.trim().length <= 0) {
      return undefined;
    }
    answers.push(parsedAnswer);
    expectedIndex += 1;
  }
  return answers.length > 0 ? answers : undefined;
}

export function createAskUserTurnPromptContext(input: {
  runtime: AskUserRuntimeAdapter;
  sessionKey: string;
  userText: string;
}): AskUserTurnPromptContext {
  const promptParts: string[] = [];
  const answers = parseNumberedBatchAnswers(input.userText) ?? [{ answer: input.userText }];
  const resolvedAsks: ResolvedAskUser[] = [];
  const resolvedNotes: Array<{ resolvedAsk: ResolvedAskUser; notes: string }> = [];
  let pendingNextAsk: AskUserEnvelope | undefined;
  let queueSizeAfterResolve = 0;
  let finalResumePrompt = "";
  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index];
    const resolved = input.runtime.resolvePendingAsk(input.sessionKey, answer?.answer ?? "");
    if (!resolved) {
      break;
    }
    resolvedAsks.push(resolved.resolvedAsk);
    if (answer?.notes && answer.notes.trim().length > 0) {
      resolvedNotes.push({
        resolvedAsk: resolved.resolvedAsk,
        notes: answer.notes,
      });
    }
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
  const notesPrompt = buildAskUserNotesPrompt({ rows: resolvedNotes });
  if (notesPrompt) {
    promptParts.push(notesPrompt);
  }
  const resolvedAsk = resolvedAsks[0];
  const secretAnswerCount = countAskUserSecretAnswers(resolvedAsks);
  return {
    resolvedAsk,
    resolvedAsks,
    pendingNextAsk,
    queueSizeAfterResolve,
    resolvedEvent: resolvedAsks.map((item) => formatAskUserResolvedEvent(item)).join(""),
    promptParts,
    safeUserText: buildAskUserSafeUserText({
      rawUserText: input.userText,
      resolvedAsks,
    }),
    hasSecretAnswers: secretAnswerCount > 0,
    secretAnswerCount,
  };
}

export function formatAskUserResolvedEvent(resolvedAsk: ResolvedAskUser): string {
  return `[ask-user] event=resolved ask_id=${resolvedAsk.envelope.askId} blocking_node_id=${resolvedAsk.envelope.blockingNodeId}\n`;
}

export function formatAskUserIssuedEvent(envelope: AskUserEnvelope): string {
  return `[ask-user] event=issued ask_id=${envelope.askId} blocking_node_id=${envelope.blockingNodeId}\n`;
}
