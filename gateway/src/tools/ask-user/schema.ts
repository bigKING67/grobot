export interface AskUserOption {
  label: string;
  description?: string;
  value?: string;
}

export interface AskUserEnvelope {
  questionId: string;
  blockingNodeId: string;
  question: string;
  options: string[];
  optionsDetailed: AskUserOption[];
  questionKey?: string;
  header?: string;
  questionIndex?: number;
  questionTotal?: number;
  defaultOnTimeout: string;
  resumeToken: string;
  createdAt: string;
}

export interface ResolvedAskUser {
  envelope: AskUserEnvelope;
  answer: string;
}

export interface AskUserResolveResult {
  resolvedAsk: ResolvedAskUser;
  pendingNextAsk?: AskUserEnvelope;
  queueSizeAfterResolve: number;
  resumePrompt?: string;
  resolvedBatch?: ResolvedAskUser[];
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

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function normalizeAskUserOption(
  value: unknown,
  cleanText: (value: string) => string,
): AskUserOption | undefined {
  if (typeof value === "string") {
    const label = parseOptionalString(value, cleanText);
    if (!label) {
      return undefined;
    }
    return {
      label,
      value: label,
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const label = parseOptionalString(record.label, cleanText)
    ?? parseOptionalString(record.value, cleanText)
    ?? parseOptionalString(record.id, cleanText);
  if (!label) {
    return undefined;
  }
  const description = parseOptionalString(record.description, cleanText);
  const canonicalValue = parseOptionalString(record.value, cleanText) ?? label;
  return {
    label,
    description,
    value: canonicalValue,
  };
}

function ensureAskUserOptions(
  value: unknown,
  limit: number,
  cleanText: (value: string) => string,
): AskUserOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: AskUserOption[] = [];
  for (const item of value) {
    const normalized = normalizeAskUserOption(item, cleanText);
    if (!normalized) {
      continue;
    }
    rows.push(normalized);
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

function normalizeQuestionRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: Record<string, unknown>[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    rows.push(item as Record<string, unknown>);
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
    createdAt: string;
    questionKey: string;
    header: string;
    questionIndex: string;
    questionTotal: string;
  },
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope | undefined {
  const cleanText = options.cleanText ?? defaultCleanText;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const randomId = options.randomId
    ?? ((prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const questionRecords = normalizeQuestionRecords(record.questions);
  const firstQuestion = questionRecords[0];
  const question = parseOptionalString(record.question, cleanText)
    ?? parseOptionalString(firstQuestion?.question, cleanText);
  if (!question) {
    return undefined;
  }
  const optionsDetailed = ensureAskUserOptions(
    record.optionsDetailed ?? record.options ?? firstQuestion?.options,
    6,
    cleanText,
  );
  const questionTotal = parseOptionalPositiveInteger(record[fieldMap.questionTotal])
    ?? parseOptionalPositiveInteger(record.questionTotal)
    ?? (questionRecords.length > 0 ? questionRecords.length : undefined);
  const questionIndex = parseOptionalPositiveInteger(record[fieldMap.questionIndex])
    ?? parseOptionalPositiveInteger(record.questionIndex);
  return {
    questionId: parseOptionalString(record[fieldMap.questionId], cleanText)
      ?? randomId("askq"),
    blockingNodeId: parseOptionalString(record[fieldMap.blockingNodeId], cleanText)
      ?? "node.unknown",
    question,
    options: optionsDetailed.map((option) => option.label),
    optionsDetailed,
    questionKey: parseOptionalString(record[fieldMap.questionKey], cleanText)
      ?? parseOptionalString(record.questionKey, cleanText)
      ?? parseOptionalString(firstQuestion?.id, cleanText),
    header: parseOptionalString(record[fieldMap.header], cleanText)
      ?? parseOptionalString(record.header, cleanText)
      ?? parseOptionalString(firstQuestion?.header, cleanText),
    questionIndex,
    questionTotal,
    defaultOnTimeout: parseOptionalString(
      record[fieldMap.defaultOnTimeout],
      cleanText,
    ) ?? "continue_with_best_effort",
    resumeToken: parseOptionalString(record[fieldMap.resumeToken], cleanText)
      ?? randomId("resume"),
    createdAt: parseOptionalString(record[fieldMap.createdAt], cleanText)
      ?? parseOptionalString(record.createdAt, cleanText)
      ?? nowIso(),
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
      createdAt: "createdAt",
      questionKey: "questionKey",
      header: "header",
      questionIndex: "questionIndex",
      questionTotal: "questionTotal",
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
      createdAt: "created_at",
      questionKey: "question_key",
      header: "header",
      questionIndex: "question_index",
      questionTotal: "question_total",
    },
    options,
  );
}
