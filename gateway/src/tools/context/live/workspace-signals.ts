import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface WorkspaceSignalRow {
  statusCode: string;
  path: string;
  summary: string;
}

interface RetrieveWorkspaceSignalsOptions {
  workDir?: string;
  includeUntracked?: boolean;
  cacheTtlMs?: number;
}

interface WorkspaceStatusRow {
  statusCode: string;
  path: string;
  normalizedPath: string;
  pathTokens: Set<string>;
}

interface WorkspaceCacheEntry {
  expiresAtMs: number;
  rows: WorkspaceStatusRow[];
}

const DEFAULT_CACHE_TTL_MS = 2_000;
const MIN_CACHE_TTL_MS = 200;
const MAX_CACHE_TTL_MS = 60_000;
const workspaceStatusCache = new Map<string, WorkspaceCacheEntry>();

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

function runGitCommand(cwd: string, args: readonly string[]): string | undefined {
  const run = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 2_000,
    maxBuffer: 1_000_000,
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
  const line = output.split(/\r?\n/)[0] ?? output;
  return resolve(line);
}

function parseStatusLine(line: string): WorkspaceStatusRow | undefined {
  if (line.length < 4) {
    return undefined;
  }
  const statusCode = line.slice(0, 2);
  let path = line.slice(3).trim();
  if (!path) {
    return undefined;
  }
  const renameIndex = path.indexOf(" -> ");
  if (renameIndex >= 0) {
    path = path.slice(renameIndex + 4).trim();
  }
  if (!path) {
    return undefined;
  }
  const normalizedPath = normalizeText(path);
  return {
    statusCode,
    path,
    normalizedPath,
    pathTokens: new Set(tokenize(path)),
  };
}

function loadWorkspaceRows(rootPath: string, includeUntracked: boolean): WorkspaceStatusRow[] {
  const output = runGitCommand(rootPath, [
    "status",
    "--porcelain=v1",
    includeUntracked ? "--untracked-files=all" : "--untracked-files=no",
  ]);
  if (!output) {
    return [];
  }
  const rows: WorkspaceStatusRow[] = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const row = parseStatusLine(line);
    if (!row) {
      continue;
    }
    if (!includeUntracked && row.statusCode === "??") {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

function getWorkspaceRows(
  rootPath: string,
  includeUntracked: boolean,
  cacheTtlMs: number,
): WorkspaceStatusRow[] {
  const cacheKey = `${rootPath}::${includeUntracked ? "u1" : "u0"}`;
  const nowMs = Date.now();
  const cached = workspaceStatusCache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.rows;
  }
  const rows = loadWorkspaceRows(rootPath, includeUntracked);
  workspaceStatusCache.set(cacheKey, {
    expiresAtMs: nowMs + cacheTtlMs,
    rows,
  });
  return rows;
}

function scoreStatusCode(statusCode: string): number {
  if (statusCode === "??") {
    return 1;
  }
  let score = 0;
  const staged = statusCode[0] ?? " ";
  const unstaged = statusCode[1] ?? " ";
  if (staged !== " ") {
    score += 2;
  }
  if (unstaged !== " ") {
    score += 2;
  }
  if (statusCode.includes("D")) {
    score += 1;
  }
  if (statusCode.includes("R")) {
    score += 1;
  }
  return score;
}

function scoreWorkspaceRow(
  row: WorkspaceStatusRow,
  queryTokens: Set<string>,
  normalizedQuery: string,
): number {
  let score = scoreStatusCode(row.statusCode);
  if (normalizedQuery && row.normalizedPath.includes(normalizedQuery)) {
    score += 8;
  }
  for (const token of queryTokens) {
    if (row.pathTokens.has(token)) {
      score += 2;
    }
  }
  return score;
}

export function retrieveWorkspaceSignals(
  query: string,
  limit: number,
  options: RetrieveWorkspaceSignalsOptions = {},
): WorkspaceSignalRow[] {
  const normalizedLimit = clampInteger(limit, 0, 0, 24);
  if (normalizedLimit <= 0) {
    return [];
  }
  const workDir = resolve(options.workDir ?? process.cwd());
  const rootPath = resolveGitRoot(workDir);
  if (!rootPath) {
    return [];
  }
  const includeUntracked = options.includeUntracked !== false;
  const cacheTtlMs = clampInteger(
    options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    MIN_CACHE_TTL_MS,
    MAX_CACHE_TTL_MS,
  );
  const rows = getWorkspaceRows(rootPath, includeUntracked, cacheTtlMs);
  if (rows.length === 0) {
    return [];
  }
  const queryTokens = new Set(tokenize(query));
  const normalizedQuery = normalizeText(query);
  return rows
    .map((row, index) => ({
      row,
      index,
      score: scoreWorkspaceRow(row, queryTokens, normalizedQuery),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .slice(0, normalizedLimit)
    .map((item) => ({
      statusCode: item.row.statusCode,
      path: item.row.path,
      summary: `[${item.row.statusCode}] ${item.row.path}`,
    }));
}
