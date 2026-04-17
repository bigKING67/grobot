import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface LineageSummaryRow {
  commitId: string;
  author?: string;
  timestamp?: string;
  summary: string;
}

interface LineageCommitRow {
  commitId: string;
  author: string;
  timestamp: string;
  subject: string;
  files: string[];
  insertions: number;
  deletions: number;
  fileChangeCount: number;
  subjectTokens: Set<string>;
  fileTokens: Set<string>;
  normalizedSubject: string;
}

interface LineageCacheEntry {
  expiresAtMs: number;
  headCommit: string;
  rows: LineageCommitRow[];
}

interface RetrieveLineageOptions {
  workDir?: string;
  maxCommits?: number;
  cacheTtlMs?: number;
}

const DEFAULT_MAX_COMMITS = 120;
const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_MAX_COMMITS = 500;
const MIN_MAX_COMMITS = 20;
const MIN_CACHE_TTL_MS = 1_000;
const MAX_CACHE_TTL_MS = 600_000;
const LOG_MARKER = "__GROBOT_COMMIT__";
const LOG_FIELD_SEPARATOR = "\u001f";
const lineageCache = new Map<string, LineageCacheEntry>();

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function normalizeText(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

function truncateSummary(text: string, maxLength = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function runGitCommand(cwd: string, args: readonly string[]): string | undefined {
  const run = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 2_000,
    maxBuffer: 2_000_000,
  });
  if (run.error || run.status !== 0) {
    return undefined;
  }
  const stdout = String(run.stdout ?? "").trim();
  if (!stdout) {
    return undefined;
  }
  return stdout;
}

function resolveGitRoot(workDir: string): string | undefined {
  const output = runGitCommand(workDir, ["rev-parse", "--show-toplevel"]);
  if (!output) {
    return undefined;
  }
  return resolve(output.split(/\r?\n/)[0] ?? output);
}

function resolveHeadCommit(rootPath: string): string {
  const output = runGitCommand(rootPath, ["rev-parse", "HEAD"]);
  if (!output) {
    return "";
  }
  return String(output.split(/\r?\n/)[0] ?? "").trim();
}

function parseGitLogRows(raw: string): LineageCommitRow[] {
  const rows: LineageCommitRow[] = [];
  const lines = raw.split(/\r?\n/);
  let current: {
    commitId: string;
    author: string;
    timestamp: string;
    subject: string;
    files: string[];
    insertions: number;
    deletions: number;
  } | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith(LOG_MARKER)) {
      if (current) {
        rows.push({
          commitId: current.commitId,
          author: current.author,
          timestamp: current.timestamp,
          subject: current.subject,
          files: [...current.files],
          insertions: current.insertions,
          deletions: current.deletions,
          fileChangeCount: current.files.length,
          subjectTokens: new Set(tokenize(current.subject)),
          fileTokens: new Set(tokenize(current.files.join(" "))),
          normalizedSubject: normalizeText(current.subject),
        });
      }
      const fields = line.slice(LOG_MARKER.length).split(LOG_FIELD_SEPARATOR);
      const commitId = String(fields[0] ?? "").trim();
      const author = String(fields[1] ?? "").trim();
      const timestamp = String(fields[2] ?? "").trim();
      const subject = String(fields[3] ?? "").trim();
      if (!commitId || !subject) {
        current = null;
        continue;
      }
      current = {
        commitId,
        author,
        timestamp,
        subject,
        files: [],
        insertions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    const numStatMatch = rawLine.match(/^([0-9-]+)\t([0-9-]+)\t(.+)$/);
    if (numStatMatch) {
      const insertedRaw = numStatMatch[1] ?? "0";
      const deletedRaw = numStatMatch[2] ?? "0";
      const filePath = String(numStatMatch[3] ?? "").trim();
      if (filePath.length > 0) {
        current.files.push(filePath);
      }
      const insertions = insertedRaw === "-" ? 0 : Number.parseInt(insertedRaw, 10);
      const deletions = deletedRaw === "-" ? 0 : Number.parseInt(deletedRaw, 10);
      current.insertions += Number.isFinite(insertions) ? Math.max(0, insertions) : 0;
      current.deletions += Number.isFinite(deletions) ? Math.max(0, deletions) : 0;
      continue;
    }
    current.files.push(line.trim());
  }
  if (current) {
    rows.push({
      commitId: current.commitId,
      author: current.author,
      timestamp: current.timestamp,
      subject: current.subject,
      files: [...current.files],
      insertions: current.insertions,
      deletions: current.deletions,
      fileChangeCount: current.files.length,
      subjectTokens: new Set(tokenize(current.subject)),
      fileTokens: new Set(tokenize(current.files.join(" "))),
      normalizedSubject: normalizeText(current.subject),
    });
  }
  return rows;
}

function loadLineageRows(rootPath: string, maxCommits: number): LineageCommitRow[] {
  const output = runGitCommand(rootPath, [
    "log",
    "--date=iso-strict",
    `--pretty=format:${LOG_MARKER}%H%x1f%an%x1f%aI%x1f%s`,
    "--numstat",
    "-n",
    String(maxCommits),
    "--",
  ]);
  if (!output) {
    return [];
  }
  return parseGitLogRows(output);
}

function getCachedLineageRows(rootPath: string, maxCommits: number, cacheTtlMs: number): LineageCommitRow[] {
  const cacheKey = `${rootPath}::${String(maxCommits)}`;
  const nowMs = Date.now();
  const headCommit = resolveHeadCommit(rootPath);
  const cached = lineageCache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs && cached.headCommit === headCommit) {
    return cached.rows;
  }
  const rows = loadLineageRows(rootPath, maxCommits);
  lineageCache.set(cacheKey, {
    expiresAtMs: nowMs + cacheTtlMs,
    headCommit,
    rows,
  });
  return rows;
}

function scoreLineageRow(
  row: LineageCommitRow,
  queryTokens: Set<string>,
  normalizedQuery: string,
  recencyIndex: number,
): number {
  if (queryTokens.size === 0 && !normalizedQuery) {
    return 1;
  }
  let score = 0;
  if (normalizedQuery && row.normalizedSubject.includes(normalizedQuery)) {
    score += 8;
  }
  for (const token of queryTokens) {
    if (row.subjectTokens.has(token)) {
      score += 3;
      continue;
    }
    if (row.fileTokens.has(token)) {
      score += 1;
    }
  }
  const recencyBonus = Math.max(0, 2 - recencyIndex * 0.02);
  const changeMagnitude = row.insertions + row.deletions;
  const changeBonus = Math.min(2, Math.log10(changeMagnitude + 1));
  return score + recencyBonus + changeBonus;
}

function buildLineageSummary(row: LineageCommitRow): string {
  const filePreview = row.files
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);
  const fileSuffix = row.files.length > 3
    ? ` +${String(row.files.length - 3)} files`
    : "";
  if (filePreview.length === 0) {
    return truncateSummary(row.subject);
  }
  const changeStats = row.fileChangeCount > 0
    ? ` | delta: +${String(row.insertions)}/-${String(row.deletions)} in ${String(row.fileChangeCount)} files`
    : "";
  return truncateSummary(`${row.subject}${changeStats} | files: ${filePreview.join(", ")}${fileSuffix}`);
}

export function retrieveLineageSummaries(
  query: string,
  limit: number,
  options: RetrieveLineageOptions = {},
): LineageSummaryRow[] {
  const normalizedLimit = clampInteger(limit, 0, 0, 24);
  if (normalizedLimit <= 0) {
    return [];
  }
  const workDir = resolve(options.workDir ?? process.cwd());
  const rootPath = resolveGitRoot(workDir);
  if (!rootPath) {
    return [];
  }
  const maxCommits = clampInteger(
    options.maxCommits ?? DEFAULT_MAX_COMMITS,
    DEFAULT_MAX_COMMITS,
    MIN_MAX_COMMITS,
    MAX_MAX_COMMITS,
  );
  const cacheTtlMs = clampInteger(
    options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    MIN_CACHE_TTL_MS,
    MAX_CACHE_TTL_MS,
  );
  const rows = getCachedLineageRows(rootPath, maxCommits, cacheTtlMs);
  if (rows.length === 0) {
    return [];
  }
  const queryTokens = new Set(tokenize(query));
  const normalizedQuery = normalizeText(query);
  const ranked = rows
    .map((row, index) => ({
      row,
      score: scoreLineageRow(row, queryTokens, normalizedQuery, index),
      index,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .slice(0, normalizedLimit)
    .sort((left, right) => left.index - right.index);
  return ranked.map((item) => ({
    commitId: item.row.commitId,
    author: item.row.author,
    timestamp: item.row.timestamp,
    summary: buildLineageSummary(item.row),
  }));
}
