import { readFileSync } from "node:fs";

export function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

export function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
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
      return line.slice(0, i);
    }
  }
  return line;
}

export function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(/^"([^"]*)"$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1].trim();
}

export function parseTomlNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parseTomlInteger(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parseTomlBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

export function parseTomlStringArray(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    return [];
  }
  const items: string[] = [];
  for (const token of content.split(",")) {
    const parsed = parseTomlString(token);
    if (typeof parsed !== "string" || parsed.length === 0) {
      return undefined;
    }
    items.push(parsed);
  }
  return items;
}
