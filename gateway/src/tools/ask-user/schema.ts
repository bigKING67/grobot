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

export function normalizeAskUserEnvelope(
  raw: unknown,
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const cleanText = options.cleanText ?? defaultCleanText;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const randomId = options.randomId
    ?? ((prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const questionId = parseOptionalString(record.questionId, cleanText);
  const blockingNodeId = parseOptionalString(record.blockingNodeId, cleanText);
  const question = parseOptionalString(record.question, cleanText);
  if (!questionId || !blockingNodeId || !question) {
    return undefined;
  }
  const optionsDetailed = ensureAskUserOptions(
    record.optionsDetailed ?? record.options,
    6,
    cleanText,
  );
  return {
    questionId,
    blockingNodeId,
    question,
    options: optionsDetailed.map((option) => option.label),
    optionsDetailed,
    questionKey: parseOptionalString(record.questionKey, cleanText),
    header: parseOptionalString(record.header, cleanText),
    questionIndex: parseOptionalPositiveInteger(record.questionIndex),
    questionTotal: parseOptionalPositiveInteger(record.questionTotal),
    defaultOnTimeout: parseOptionalString(record.defaultOnTimeout, cleanText) ?? "continue_with_best_effort",
    resumeToken: parseOptionalString(record.resumeToken, cleanText) ?? randomId("resume"),
    createdAt: parseOptionalString(record.createdAt, cleanText) ?? nowIso(),
  };
}

export function normalizeAskUserEnvelopeFromPayload(
  raw: unknown,
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const cleanText = options.cleanText ?? defaultCleanText;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const randomId = options.randomId
    ?? ((prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const questionRecords = normalizeQuestionRecords(record.questions);
  const firstQuestion = questionRecords[0];
  if (!firstQuestion) {
    return undefined;
  }
  const questionId = parseOptionalString(firstQuestion.id, cleanText);
  const header = parseOptionalString(firstQuestion.header, cleanText);
  const question = parseOptionalString(firstQuestion.question, cleanText);
  if (!questionId || !header || !question) {
    return undefined;
  }
  const optionsDetailed = ensureAskUserOptions(firstQuestion.options, 6, cleanText);
  return {
    questionId,
    blockingNodeId: parseOptionalString(record.blocking_node_id, cleanText) ?? "node.unknown",
    question,
    options: optionsDetailed.map((option) => option.label),
    optionsDetailed,
    questionKey: questionId,
    header,
    questionIndex: parseOptionalPositiveInteger(record.question_index),
    questionTotal: parseOptionalPositiveInteger(record.question_total) ?? questionRecords.length,
    defaultOnTimeout: parseOptionalString(record.default_on_timeout, cleanText) ?? "continue_with_best_effort",
    resumeToken: parseOptionalString(record.resume_token, cleanText) ?? randomId("resume"),
    createdAt: parseOptionalString(record.created_at, cleanText) ?? nowIso(),
  };
}
