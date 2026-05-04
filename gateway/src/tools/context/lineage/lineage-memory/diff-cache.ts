import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  resolveContextStoragePath,
  resolveContextStorageReadPaths,
} from "../../storage-boundary";
import { runGitCommand } from "./git";
import {
  inferIntentTags,
  normalizePath,
  resolveParentDir,
  tokenize,
  truncateSummary,
} from "./text";
import {
  MAX_DIFF_FILE_HINTS,
  MAX_DIFF_TOKEN_COUNT,
  MAX_PERSISTED_DIFF_ENTRIES,
  type LineageCommitRow,
  type LineageDiffSemantic,
  type LineageIntentTag,
  type PersistedLineageDiffSemantic,
} from "./types";

const lineageDiffCacheByRoot = new Map<string, Map<string, PersistedLineageDiffSemantic>>();

function resolveLineageDiffCachePath(rootPath: string): string {
  return resolveContextStoragePath(rootPath, "lineage_diff_cache");
}

function resolveLineageDiffCacheReadPaths(rootPath: string): string[] {
  return resolveContextStorageReadPaths(rootPath, "lineage_diff_cache");
}

function loadPersistedLineageDiffCache(rootPath: string): Map<string, PersistedLineageDiffSemantic> {
  const existing = lineageDiffCacheByRoot.get(rootPath);
  if (existing) {
    return existing;
  }
  const pathCandidates = resolveLineageDiffCacheReadPaths(rootPath);
  const path = pathCandidates.find((candidate) => existsSync(candidate));
  if (!path) {
    const empty = new Map<string, PersistedLineageDiffSemantic>();
    lineageDiffCacheByRoot.set(rootPath, empty);
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    const empty = new Map<string, PersistedLineageDiffSemantic>();
    lineageDiffCacheByRoot.set(rootPath, empty);
    return empty;
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    const empty = new Map<string, PersistedLineageDiffSemantic>();
    lineageDiffCacheByRoot.set(rootPath, empty);
    return empty;
  }
  const container = parsed as Record<string, unknown>;
  const rowsRaw = Array.isArray(container.rows) ? container.rows : [];
  const output = new Map<string, PersistedLineageDiffSemantic>();
  for (const rowRaw of rowsRaw) {
    if (typeof rowRaw !== "object" || rowRaw == null || Array.isArray(rowRaw)) {
      continue;
    }
    const row = rowRaw as Record<string, unknown>;
    const commitId = typeof row.commitId === "string" ? row.commitId.trim() : "";
    if (!commitId) {
      continue;
    }
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((item): item is LineageIntentTag => typeof item === "string")
      : [];
    const tokens = Array.isArray(row.tokens)
      ? row.tokens.filter((item): item is string => typeof item === "string")
      : [];
    const files = Array.isArray(row.files)
      ? row.files.filter((item): item is string => typeof item === "string")
      : [];
    const summary = typeof row.summary === "string" ? row.summary : "";
    output.set(commitId, {
      commitId,
      tags: tags.slice(0, 16),
      tokens: tokens.slice(0, MAX_DIFF_TOKEN_COUNT),
      files: files.slice(0, MAX_DIFF_FILE_HINTS),
      summary: summary.trim(),
    });
  }
  lineageDiffCacheByRoot.set(rootPath, output);
  return output;
}

function persistLineageDiffCache(rootPath: string): void {
  const cache = lineageDiffCacheByRoot.get(rootPath);
  if (!cache) {
    return;
  }
  const path = resolveLineageDiffCachePath(rootPath);
  const rows = Array.from(cache.values())
    .slice(-MAX_PERSISTED_DIFF_ENTRIES);
  try {
    mkdirSync(resolveParentDir(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, rows }, null, 2), "utf8");
  } catch {
    // best effort cache persistence only
  }
}

function parseLineageDiffSemantic(rootPath: string, row: LineageCommitRow): LineageDiffSemantic | undefined {
  const patch = runGitCommand(rootPath, [
    "show",
    "--format=",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    row.commitId,
    "--",
  ]);
  if (!patch) {
    return undefined;
  }
  const tags = inferIntentTags(`${row.subject}\n${patch}`);
  const files = new Set<string>();
  const tokens = new Set<string>();
  let addedFnCount = 0;
  let removedFnCount = 0;
  let changedLineCount = 0;
  const lines = patch.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const path = normalizePath(line.slice(6));
      if (path) {
        files.add(path);
      }
      continue;
    }
    const isAdded = line.startsWith("+") && !line.startsWith("+++");
    const isRemoved = line.startsWith("-") && !line.startsWith("---");
    if (!isAdded && !isRemoved) {
      continue;
    }
    changedLineCount += 1;
    const body = line.slice(1).trim();
    if (!body) {
      continue;
    }
    if (isAdded && /(function|def|fn|class|interface|type)\s+[A-Za-z_]/.test(body)) {
      addedFnCount += 1;
    }
    if (isRemoved && /(function|def|fn|class|interface|type)\s+[A-Za-z_]/.test(body)) {
      removedFnCount += 1;
    }
    for (const token of tokenize(body)) {
      if (token.length < 2) {
        continue;
      }
      tokens.add(token);
      if (tokens.size >= MAX_DIFF_TOKEN_COUNT) {
        break;
      }
    }
    if (tokens.size >= MAX_DIFF_TOKEN_COUNT) {
      break;
    }
  }
  for (const file of row.normalizedFiles) {
    files.add(file);
    for (const token of tokenize(file)) {
      tokens.add(token);
      if (tokens.size >= MAX_DIFF_TOKEN_COUNT) {
        break;
      }
    }
    if (files.size >= MAX_DIFF_FILE_HINTS || tokens.size >= MAX_DIFF_TOKEN_COUNT) {
      break;
    }
  }
  const intentPreview = Array.from(tags).slice(0, 3);
  const summaryParts: string[] = [];
  if (changedLineCount > 0) {
    summaryParts.push(`diff_lines=${String(changedLineCount)}`);
  }
  if (addedFnCount > 0 || removedFnCount > 0) {
    summaryParts.push(`fn(+${String(addedFnCount)}/-${String(removedFnCount)})`);
  }
  if (intentPreview.length > 0) {
    summaryParts.push(`intent=${intentPreview.join("/")}`);
  }
  if (files.size > 0) {
    summaryParts.push(`files=${Array.from(files).slice(0, 2).join(",")}${files.size > 2 ? "..." : ""}`);
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(" | ") : "diff semantic summary unavailable";
  return {
    tags,
    tokens,
    normalizedFiles: files,
    summary: truncateSummary(summary, 220),
  };
}

export function getLineageDiffSemantic(rootPath: string, row: LineageCommitRow): LineageDiffSemantic | undefined {
  const cache = loadPersistedLineageDiffCache(rootPath);
  const cached = cache.get(row.commitId);
  if (cached) {
    return {
      tags: new Set(cached.tags),
      tokens: new Set(cached.tokens),
      normalizedFiles: new Set(cached.files),
      summary: cached.summary,
    };
  }
  const parsed = parseLineageDiffSemantic(rootPath, row);
  if (!parsed) {
    return undefined;
  }
  cache.set(row.commitId, {
    commitId: row.commitId,
    tags: Array.from(parsed.tags).slice(0, 16),
    tokens: Array.from(parsed.tokens).slice(0, MAX_DIFF_TOKEN_COUNT),
    files: Array.from(parsed.normalizedFiles).slice(0, MAX_DIFF_FILE_HINTS),
    summary: parsed.summary,
  });
  if (cache.size > MAX_PERSISTED_DIFF_ENTRIES) {
    const overflow = cache.size - MAX_PERSISTED_DIFF_ENTRIES;
    const keys = Array.from(cache.keys()).slice(0, overflow);
    for (const key of keys) {
      cache.delete(key);
    }
  }
  persistLineageDiffCache(rootPath);
  return parsed;
}
