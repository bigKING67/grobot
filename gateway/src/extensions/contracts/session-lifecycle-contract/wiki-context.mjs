import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { SESSION_SCOPE_GROUP } from "./constants.mjs";
import {
  parseSessionKeyParts,
  pathBasename,
  pathJoin,
} from "./shared.mjs";

function normalizeQueryTokens(text) {
  const normalized = text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[,.;:!?()[\]{}"'`~]+|[,.;:!?()[\]{}"'`~]+$/g, ""))
    .filter((token) => token.length > 0);
  if (normalized.length > 0) {
    return normalized;
  }
  const compact = text.trim().toLowerCase();
  return compact ? [compact] : [];
}

function listTextFilesRecursive(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = pathJoin(current, name);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (name.toLowerCase().endsWith(".md") || name.toLowerCase().endsWith(".txt")) {
        found.push(abs);
      }
    }
  }
  return found;
}

function readTextSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function buildWikiContextBlock(prompt, projectWikiDir, globalWikiDir, sessionKey, allowOrgShared) {
  const roots = [];
  roots.push(resolve(projectWikiDir));
  const parsed = parseSessionKeyParts(sessionKey);
  if (allowOrgShared && parsed !== null && parsed[2] === SESSION_SCOPE_GROUP) {
    roots.push(pathJoin(resolve(globalWikiDir), "org"));
  }
  const queryTokens = normalizeQueryTokens(prompt);
  const scored = [];
  for (const root of roots) {
    const files = listTextFilesRecursive(root);
    for (const filePath of files) {
      const content = readTextSafe(filePath).trim();
      if (!content) {
        continue;
      }
      const normalized = content.replace(/\s+/g, " ").trim();
      const lowered = normalized.toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        if (token && lowered.includes(token)) {
          score += 1;
        }
      }
      if (score <= 0) {
        continue;
      }
      let relPath = "";
      try {
        relPath = pathBasename(filePath);
      } catch {
        relPath = filePath;
      }
      const snippet = normalized.length > 220 ? `${normalized.slice(0, 220).trim()}\u2026` : normalized;
      scored.push({ score, rel: relPath || filePath, snippet });
    }
  }
  if (scored.length === 0) {
    return null;
  }
  scored.sort((left, right) => right.score - left.score);
  const lines = [
    "[Wiki Context]",
    "Use only when relevant; explicit latest user instruction has highest priority.",
  ];
  for (const row of scored.slice(0, 8)) {
    lines.push(`- ${row.rel}: ${row.snippet}`);
  }
  return lines.join("\n");
}
