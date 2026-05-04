import { STOPWORDS } from "./constants";

export function nowIso(): string {
  return new Date().toISOString();
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function compactWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function parentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const match = normalized.match(/^(.*)[\\/][^\\/]+$/);
  if (match && typeof match[1] === "string" && match[1].length > 0) {
    return match[1];
  }
  return ".";
}

function normalizeTokenSource(raw: string): string {
  return compactWhitespace(raw.toLowerCase());
}

export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function normalizeTaskType(raw: string): string {
  const normalized = normalizeTag(raw);
  return normalized || "general_task";
}

export function uniqueTrimmed(rows: readonly string[], limit: number): string[] {
  const unique = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const normalized = compactWhitespace(row);
    if (!normalized || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

export function parseFiniteInt(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(0, Math.floor(raw));
}

export function parseFiniteFloat(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return clamp(raw, min, max);
}

export function extractTokens(raw: string): string[] {
  const source = normalizeTokenSource(raw);
  if (!source) {
    return [];
  }
  const unique = new Set<string>();
  for (const token of source.match(/[a-z0-9_]{2,}/g) ?? []) {
    if (STOPWORDS.has(token)) {
      continue;
    }
    unique.add(token);
    if (unique.size >= 64) {
      break;
    }
  }
  for (const token of source.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    if (STOPWORDS.has(token)) {
      continue;
    }
    unique.add(token);
    if (unique.size >= 64) {
      break;
    }
  }
  return Array.from(unique);
}

export function computeTokenOverlap(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(token.toLowerCase())) {
      overlap += 1;
    }
  }
  return overlap;
}
