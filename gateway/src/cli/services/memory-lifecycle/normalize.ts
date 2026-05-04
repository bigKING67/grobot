import {
  MEMORY_CLASSIFICATION_RESTRICTED,
  MEMORY_CLASSIFICATION_SECRET,
  MEMORY_CLASSIFICATIONS,
  MEMORY_LEVELS,
  MEMORY_SCOPE_AUTO,
  MEMORY_SCOPES,
  MEMORY_STATE_ACTIVE,
  MEMORY_STATE_ARCHIVED,
  MEMORY_KINDS,
  type MemoryClassification,
  type MemoryEvidenceRef,
  type MemoryKind,
  type MemoryLevel,
  type MemoryScope,
  type MemoryState,
} from "./contract";

export function normalizeMemoryScope(raw: string | undefined): MemoryScope | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_SCOPES.includes(normalized as MemoryScope)) {
    return normalized as MemoryScope;
  }
  return undefined;
}

export function normalizeMemoryKind(raw: string | undefined): MemoryKind | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_KINDS.includes(normalized as MemoryKind)) {
    return normalized as MemoryKind;
  }
  return undefined;
}

export function normalizeMemoryClassification(raw: string | undefined): MemoryClassification | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_CLASSIFICATIONS.includes(normalized as MemoryClassification)) {
    return normalized as MemoryClassification;
  }
  return undefined;
}

export function normalizeMemoryState(raw: string | undefined): MemoryState | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === MEMORY_STATE_ACTIVE || normalized === MEMORY_STATE_ARCHIVED) {
    return normalized;
  }
  return undefined;
}

export function normalizeMemoryLevel(raw: string | undefined): MemoryLevel | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toUpperCase();
  if (MEMORY_LEVELS.includes(normalized as MemoryLevel)) {
    return normalized as MemoryLevel;
  }
  return undefined;
}

export function normalizeMemoryEvidenceRef(raw: unknown): MemoryEvidenceRef | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const traceId = typeof record.trace_id === "string" ? record.trace_id.trim() : "";
  const turnId = typeof record.turn_id === "string" ? record.turn_id.trim() : "";
  const toolCallId = typeof record.tool_call_id === "string" ? record.tool_call_id.trim() : "";
  const source = typeof record.source === "string" ? record.source.trim() : "";
  if (!traceId && !turnId && !toolCallId && !source) {
    return undefined;
  }
  return {
    trace_id: traceId || undefined,
    turn_id: turnId || undefined,
    tool_call_id: toolCallId || undefined,
    source: source || undefined,
  };
}

export function clampUnitNumber(raw: unknown, defaultValue: number): {
  value: number;
  valid: boolean;
} {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      value: defaultValue,
      valid: false,
    };
  }
  if (raw < 0 || raw > 1) {
    return {
      value: defaultValue,
      valid: false,
    };
  }
  return {
    value: raw,
    valid: true,
  };
}

export function memoryScopeMatches(recordScopeRaw: unknown, requestedScope: MemoryScope): boolean {
  if (requestedScope === MEMORY_SCOPE_AUTO) {
    return true;
  }
  const recordScope = normalizeMemoryScope(typeof recordScopeRaw === "string" ? recordScopeRaw : undefined);
  return recordScope === requestedScope;
}

export function generateMemoryRecordId(): string {
  const nowPart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 10);
  return `mm_${nowPart}_${randPart}`;
}

export function buildMemoryScopeRoot(sessionId: string, scope: MemoryScope): string {
  return `memory://session/${encodeURIComponent(sessionId)}/${scope}`;
}

export function tokenizeQuery(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function memoryMatchesQuery(text: string, queryTokens: string[]): boolean {
  if (!queryTokens.length) {
    return true;
  }
  const lowered = text.toLowerCase();
  for (const token of queryTokens) {
    if (!lowered.includes(token)) {
      return false;
    }
  }
  return true;
}

export function memoryClassificationVisible(
  classification: MemoryClassification,
  includeRestricted: boolean,
  includeSecret: boolean,
): boolean {
  if (classification === MEMORY_CLASSIFICATION_SECRET) {
    return includeSecret;
  }
  if (classification === MEMORY_CLASSIFICATION_RESTRICTED) {
    return includeRestricted || includeSecret;
  }
  return true;
}
