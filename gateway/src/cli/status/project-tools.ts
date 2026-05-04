import { readFileSync } from "node:fs";

function stripInlineComment(rawLine: string): string {
  const hashIndex = rawLine.indexOf("#");
  if (hashIndex < 0) {
    return rawLine;
  }
  return rawLine.slice(0, hashIndex);
}

function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const content = trimmed.slice(1, -1).trim();
  if (content.length === 0) {
    return [];
  }
  const items: string[] = [];
  for (const part of content.split(",")) {
    const value = part.trim();
    if (!value.startsWith("\"") || !value.endsWith("\"")) {
      continue;
    }
    const normalized = value.slice(1, -1).trim();
    if (normalized.length === 0) {
      continue;
    }
    items.push(normalized);
  }
  return items;
}

export function readToolsAllowlistFromProjectToml(projectTomlPath?: string): string[] {
  if (!projectTomlPath) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  let inToolsSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inToolsSection = sectionMatch[1] === "tools";
      continue;
    }
    if (!inToolsSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch || kvMatch[1] !== "allow") {
      continue;
    }
    return parseTomlStringArray(kvMatch[2]);
  }
  return [];
}
