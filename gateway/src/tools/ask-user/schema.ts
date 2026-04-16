export interface AskUserEnvelope {
  questionId: string;
  blockingNodeId: string;
  question: string;
  options: string[];
  defaultOnTimeout: string;
  resumeToken: string;
  createdAt: string;
}

export interface ResolvedAskUser {
  envelope: AskUserEnvelope;
  answer: string;
  resumePrompt: string;
}

export interface AskUserNormalizeOptions {
  cleanText?: (value: string) => string;
  nowIso?: () => string;
  randomId?: (prefix: string) => string;
}

function defaultCleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseOptionalString(
  value: unknown,
  cleanText: (value: string) => string,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function ensureStringArray(
  value: unknown,
  limit: number,
  cleanText: (value: string) => string,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const cleaned = cleanText(item);
    if (!cleaned) {
      continue;
    }
    rows.push(cleaned);
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

function normalizeEnvelopeRecord(
  record: Record<string, unknown>,
  fieldMap: {
    questionId: string;
    blockingNodeId: string;
    defaultOnTimeout: string;
    resumeToken: string;
  },
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope | undefined {
  const cleanText = options.cleanText ?? defaultCleanText;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const randomId = options.randomId
    ?? ((prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const question = parseOptionalString(record.question, cleanText);
  if (!question) {
    return undefined;
  }
  return {
    questionId: parseOptionalString(record[fieldMap.questionId], cleanText)
      ?? randomId("askq"),
    blockingNodeId: parseOptionalString(record[fieldMap.blockingNodeId], cleanText)
      ?? "node.unknown",
    question,
    options: ensureStringArray(record.options, 6, cleanText),
    defaultOnTimeout: parseOptionalString(
      record[fieldMap.defaultOnTimeout],
      cleanText,
    ) ?? "continue_with_best_effort",
    resumeToken: parseOptionalString(record[fieldMap.resumeToken], cleanText)
      ?? randomId("resume"),
    createdAt: parseOptionalString(record.createdAt, cleanText) ?? nowIso(),
  };
}

export function normalizeAskUserEnvelope(
  raw: unknown,
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  return normalizeEnvelopeRecord(
    raw as Record<string, unknown>,
    {
      questionId: "questionId",
      blockingNodeId: "blockingNodeId",
      defaultOnTimeout: "defaultOnTimeout",
      resumeToken: "resumeToken",
    },
    options,
  );
}

export function normalizeAskUserEnvelopeFromPayload(
  raw: unknown,
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  return normalizeEnvelopeRecord(
    raw as Record<string, unknown>,
    {
      questionId: "question_id",
      blockingNodeId: "blocking_node_id",
      defaultOnTimeout: "default_on_timeout",
      resumeToken: "resume_token",
    },
    options,
  );
}
