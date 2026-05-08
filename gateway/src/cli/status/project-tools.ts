import { readFileSync } from "node:fs";
import { stripInlineComment } from "../start/context/toml";
import { parseRuntimeToolsAllowlist } from "../start/context/runtime-tool-controls";

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
    return parseRuntimeToolsAllowlist(kvMatch[2]);
  }
  return [];
}
