export function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

export function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    return [];
  }
  const values: string[] = [];
  for (const token of content.split(",")) {
    const part = token.trim();
    if (!part.startsWith("\"") || !part.endsWith("\"")) {
      continue;
    }
    const value = part.slice(1, -1).trim();
    if (!value) {
      continue;
    }
    values.push(value);
  }
  return values;
}

export function parseTomlString(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = trimmed.match(/^"([^"]*)"$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1].trim();
}

export function parseTomlStringRaw(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = trimmed.match(/^"([^"]*)"$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1];
}

export function parseTomlBoolean(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

export function parseTomlNumber(raw: string): number | undefined {
  const normalized = raw.trim();
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parseTomlInteger(raw: string): number | undefined {
  const normalized = raw.trim();
  if (!normalized || !/^-?\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parsePercentageAsRatio(raw: string): number | undefined {
  const parsed = parseTomlNumber(raw);
  if (typeof parsed !== "number") {
    return undefined;
  }
  return parsed / 100;
}
