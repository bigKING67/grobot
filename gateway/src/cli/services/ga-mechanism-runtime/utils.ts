import {
  ASK_USER_PENDING_MAX_AGE_MS_DEFAULT,
  type GaEvidenceRef,
} from "./contract";

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeConfidence(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 0.7;
  }
  if (raw <= 0) {
    return 0;
  }
  if (raw >= 1) {
    return 1;
  }
  return raw;
}

export function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function parseOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

export function parseTimestampMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function resolveAskUserPendingMaxAgeMs(): number {
  const rawMinutes = process.env.GROBOT_ASK_USER_PENDING_TTL_MINUTES;
  if (typeof rawMinutes !== "string") {
    return ASK_USER_PENDING_MAX_AGE_MS_DEFAULT;
  }
  const parsedMinutes = Number.parseInt(rawMinutes, 10);
  if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
    return ASK_USER_PENDING_MAX_AGE_MS_DEFAULT;
  }
  return parsedMinutes * 60 * 1000;
}

export function hasEvidenceRef(value: GaEvidenceRef | undefined): boolean {
  if (!value) {
    return false;
  }
  return [value.traceId, value.turnId, value.toolCallId, value.source].some(
    (item) => typeof item === "string" && item.trim().length > 0,
  );
}

export function normalizeEvidenceRef(raw: unknown): GaEvidenceRef | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const normalized: GaEvidenceRef = {
    traceId: parseOptionalString(record.traceId),
    turnId: parseOptionalString(record.turnId),
    toolCallId: parseOptionalString(record.toolCallId),
    source: parseOptionalString(record.source),
  };
  return hasEvidenceRef(normalized) ? normalized : undefined;
}

export function ensureStringArray(value: unknown, limit: number): string[] {
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
