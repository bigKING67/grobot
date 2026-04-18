import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface LineageSummaryRow {
  commitId: string;
  author?: string;
  timestamp?: string;
  summary: string;
}

type LineageIntentTag =
  | "feature"
  | "fix"
  | "refactor"
  | "test"
  | "perf"
  | "docs"
  | "chore"
  | "security"
  | "deps"
  | "ci";

interface LineageCommitRow {
  commitId: string;
  author: string;
  timestamp: string;
  subject: string;
  files: string[];
  normalizedFiles: string[];
  insertions: number;
  deletions: number;
  fileChangeCount: number;
  subjectTokens: Set<string>;
  fileTokens: Set<string>;
  normalizedSubject: string;
  intentTags: Set<LineageIntentTag>;
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

function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/:(\d+)(?::\d+)?$/, "")
    .toLowerCase();
}

function extractPathHints(raw: string): string[] {
  const matches = raw.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g) ?? [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of matches) {
    const normalized = normalizePath(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 10) {
      break;
    }
  }
  return output;
}

function isPathOverlap(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function inferIntentTags(raw: string): Set<LineageIntentTag> {
  const text = normalizeText(raw);
  const tags = new Set<LineageIntentTag>();
  const add = (tag: LineageIntentTag): void => {
    tags.add(tag);
  };
  if (
    /(^|\s)(feat|feature|add|introduce|implement|support)(\(|:|\s)/.test(text)
    || /(新增|实现|支持|功能)/.test(text)
  ) {
    add("feature");
  }
  if (
    /(^|\s)(fix|bug|hotfix|repair|resolve|patch)(\(|:|\s)/.test(text)
    || /(修复|修正|补丁|故障)/.test(text)
  ) {
    add("fix");
  }
  if (
    /(^|\s)(refactor|cleanup|rename|restructure|reorg)(\(|:|\s)/.test(text)
    || /(重构|整理|重命名)/.test(text)
  ) {
    add("refactor");
  }
  if (
    /(^|\s)(test|spec|contract|e2e|unit)(\(|:|\s)/.test(text)
    || /(测试|回归|验收)/.test(text)
  ) {
    add("test");
  }
  if (
    /(^|\s)(perf|optimi[sz]e|latency|throughput|cache)(\(|:|\s)/.test(text)
    || /(性能|优化|延迟|吞吐|缓存)/.test(text)
  ) {
    add("perf");
  }
  if (
    /(^|\s)(docs|readme|comment|guide|manual)(\(|:|\s)/.test(text)
    || /(文档|说明|注释)/.test(text)
  ) {
    add("docs");
  }
  if (
    /(^|\s)(chore|infra|build|tooling)(\(|:|\s)/.test(text)
    || /(工程|脚本|工具链)/.test(text)
  ) {
    add("chore");
  }
  if (
    /(^|\s)(security|auth|permission|rbac|abac|vuln|cve)(\(|:|\s)/.test(text)
    || /(安全|权限|鉴权|漏洞|风控)/.test(text)
  ) {
    add("security");
  }
  if (
    /(^|\s)(deps?|dependency|upgrade|bump)(\(|:|\s)/.test(text)
    || /(依赖|升级|版本)/.test(text)
  ) {
    add("deps");
  }
  if (
    /(^|\s)(ci|pipeline|workflow|action)(\(|:|\s)/.test(text)
    || /(流水线|发布流程|工作流)/.test(text)
  ) {
    add("ci");
  }
  return tags;
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
        const normalizedFiles = current.files.map((item) => normalizePath(item)).filter((item) => item.length > 0);
        const rowIntentTags = inferIntentTags(`${current.subject} ${current.files.join(" ")}`);
        rows.push({
          commitId: current.commitId,
          author: current.author,
          timestamp: current.timestamp,
          subject: current.subject,
          files: [...current.files],
          normalizedFiles,
          insertions: current.insertions,
          deletions: current.deletions,
          fileChangeCount: current.files.length,
          subjectTokens: new Set(tokenize(current.subject)),
          fileTokens: new Set(tokenize(current.files.join(" "))),
          normalizedSubject: normalizeText(current.subject),
          intentTags: rowIntentTags,
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
    const normalizedFiles = current.files.map((item) => normalizePath(item)).filter((item) => item.length > 0);
    const rowIntentTags = inferIntentTags(`${current.subject} ${current.files.join(" ")}`);
    rows.push({
      commitId: current.commitId,
      author: current.author,
      timestamp: current.timestamp,
      subject: current.subject,
      files: [...current.files],
      normalizedFiles,
      insertions: current.insertions,
      deletions: current.deletions,
      fileChangeCount: current.files.length,
      subjectTokens: new Set(tokenize(current.subject)),
      fileTokens: new Set(tokenize(current.files.join(" "))),
      normalizedSubject: normalizeText(current.subject),
      intentTags: rowIntentTags,
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
  queryIntentTags: Set<LineageIntentTag>,
  queryPathHints: readonly string[],
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
  let intentOverlap = 0;
  for (const tag of queryIntentTags) {
    if (row.intentTags.has(tag)) {
      intentOverlap += 1;
    }
  }
  score += Math.min(5.6, intentOverlap * 2.2);
  let pathOverlap = 0;
  if (queryPathHints.length > 0 && row.normalizedFiles.length > 0) {
    for (const queryPath of queryPathHints) {
      if (row.normalizedFiles.some((rowPath) => isPathOverlap(queryPath, rowPath))) {
        pathOverlap += 1;
      }
    }
  }
  score += Math.min(6, pathOverlap * 2.1);
  const recencyBonus = 2.3 * Math.exp(-recencyIndex / 72);
  const changeMagnitude = row.insertions + row.deletions;
  const changeBonus = Math.min(2.4, Math.log10(changeMagnitude + 1));
  const focusedChangeBonus = row.fileChangeCount > 0 && row.fileChangeCount <= 6 ? 0.6 : 0;
  const broadChangePenalty = row.fileChangeCount >= 24 && pathOverlap === 0 ? -1 : 0;
  return score + recencyBonus + changeBonus + focusedChangeBonus + broadChangePenalty;
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
  const intentTags = Array.from(row.intentTags).slice(0, 2);
  const intentSuffix = intentTags.length > 0
    ? ` | intent: ${intentTags.join("/")}`
    : "";
  return truncateSummary(`${row.subject}${changeStats} | files: ${filePreview.join(", ")}${fileSuffix}${intentSuffix}`);
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
  const queryIntentTags = inferIntentTags(query);
  const queryPathHints = extractPathHints(query);
  const normalizedQuery = normalizeText(query);
  const ranked = rows
    .map((row, index) => ({
      row,
      score: scoreLineageRow(
        row,
        queryTokens,
        queryIntentTags,
        queryPathHints,
        normalizedQuery,
        index,
      ),
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
