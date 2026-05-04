import type { MemoryLevel } from "./contract";

export function nowIso(): string {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function createMemoryLevelCounter(): Record<MemoryLevel, number> {
  return {
    L1: 0,
    L2: 0,
    L3: 0,
    L4: 0,
  };
}

export function normalizeText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function parseCreatedAtMs(createdAt: string): number | undefined {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function computeAgeHours(nowMs: number, createdAt: string): number {
  const createdAtMs = parseCreatedAtMs(createdAt);
  if (typeof createdAtMs !== "number") {
    return 0;
  }
  return Math.max(0, (nowMs - createdAtMs) / 3_600_000);
}

export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 36);
}

export function compactLine(raw: string, maxChars: number): string {
  const normalized = normalizeText(raw);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function extractFirstUrl(raw: string): string | undefined {
  const match = raw.match(/https?:\/\/\S+/);
  return match?.[0];
}
