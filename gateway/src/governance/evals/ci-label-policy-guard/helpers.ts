export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isColor(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{6}$/.test(value.trim());
}

export function formatSortedSet(values: Set<string>): string {
  const sorted = Array.from(values).sort();
  return `[${sorted.map((item) => `'${item}'`).join(", ")}]`;
}

export function matchesRegexAtStart(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  const match = regex.exec(value);
  return match !== null && match.index === 0;
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
