export function nowIsoUtc(): string {
  return new Date().toISOString();
}

export function compactSingleLine(raw: string, maxChars: number): string {
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return normalized.slice(0, 1);
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

export function buildCheckpointId(): string {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `rw_${now}_${random}`;
}
