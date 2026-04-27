export interface AskUserOption {
  label: string;
  description?: string;
  value?: string;
  isOther?: boolean;
}

export interface AskUserEnvelope {
  askId: string;
  blockingNodeId: string;
  question: string;
  options: string[];
  optionsDetailed: AskUserOption[];
  questionKey?: string;
  header?: string;
  questionIndex?: number;
  questionTotal?: number;
  isSecret?: boolean;
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

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
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
  const normalized = {
    label,
    description,
    value: canonicalValue,
  };
  const isOther = parseOptionalBoolean(record.isOther ?? record.is_other);
  if (typeof isOther === "boolean") {
    return {
      ...normalized,
      isOther,
    };
  }
  return normalized;
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
  const askId = parseOptionalString(record.askId, cleanText);
  const blockingNodeId = parseOptionalString(record.blockingNodeId, cleanText);
  const question = parseOptionalString(record.question, cleanText);
  if (!askId || !blockingNodeId || !question) {
    return undefined;
  }
  const optionsDetailed = ensureAskUserOptions(
    record.optionsDetailed ?? record.options,
    6,
    cleanText,
  );
  return {
    askId,
    blockingNodeId,
    question,
    options: optionsDetailed.map((option) => option.label),
    optionsDetailed,
    questionKey: parseOptionalString(record.questionKey, cleanText),
    header: parseOptionalString(record.header, cleanText),
    questionIndex: parseOptionalPositiveInteger(record.questionIndex),
    questionTotal: parseOptionalPositiveInteger(record.questionTotal),
    isSecret: parseOptionalBoolean(record.isSecret ?? record.is_secret),
    defaultOnTimeout: parseOptionalString(record.defaultOnTimeout, cleanText) ?? "continue_with_best_effort",
    resumeToken: parseOptionalString(record.resumeToken, cleanText) ?? randomId("resume"),
    createdAt: parseOptionalString(record.createdAt, cleanText) ?? nowIso(),
  };
}

function normalizeAskUserPayloadQuestion(
  input: {
    record: Record<string, unknown>;
    payload: Record<string, unknown>;
    index: number;
    total: number;
    cleanText: (value: string) => string;
    nowIso: () => string;
    randomId: (prefix: string) => string;
  },
): AskUserEnvelope | undefined {
  const askId = parseOptionalString(input.record.id, input.cleanText);
  const header = parseOptionalString(input.record.header, input.cleanText);
  const question = parseOptionalString(input.record.question, input.cleanText);
  if (!askId || !header || !question) {
    return undefined;
  }
  const optionsDetailed = ensureAskUserOptions(input.record.options, 6, input.cleanText);
  return {
    askId,
    blockingNodeId: parseOptionalString(input.payload.blocking_node_id, input.cleanText) ?? "node.unknown",
    question,
    options: optionsDetailed.map((option) => option.label),
    optionsDetailed,
    questionKey: askId,
    header,
    questionIndex: parseOptionalPositiveInteger(input.record.question_index ?? input.record.questionIndex)
      ?? input.index + 1,
    questionTotal: parseOptionalPositiveInteger(input.record.question_total ?? input.record.questionTotal)
      ?? parseOptionalPositiveInteger(input.payload.question_total)
      ?? input.total,
    isSecret: parseOptionalBoolean(input.record.isSecret ?? input.record.is_secret),
    defaultOnTimeout: parseOptionalString(input.payload.default_on_timeout, input.cleanText) ?? "continue_with_best_effort",
    resumeToken: parseOptionalString(input.payload.resume_token, input.cleanText) ?? input.randomId("resume"),
    createdAt: parseOptionalString(input.payload.created_at, input.cleanText) ?? input.nowIso(),
  };
}

export function normalizeAskUserEnvelopesFromPayload(
  raw: unknown,
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [];
  }
  const record = raw as Record<string, unknown>;
  const cleanText = options.cleanText ?? defaultCleanText;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const randomId = options.randomId
    ?? ((prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const questionRecords = normalizeQuestionRecords(record.questions);
  return questionRecords
    .map((questionRecord, index) => normalizeAskUserPayloadQuestion({
      record: questionRecord,
      payload: record,
      index,
      total: questionRecords.length,
      cleanText,
      nowIso,
      randomId,
    }))
    .filter((envelope): envelope is AskUserEnvelope => Boolean(envelope));
}

export function normalizeAskUserEnvelopeFromPayload(
  raw: unknown,
  options: AskUserNormalizeOptions = {},
): AskUserEnvelope | undefined {
  return normalizeAskUserEnvelopesFromPayload(raw, options)[0];
}
