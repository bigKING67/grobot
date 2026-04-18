import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  rootPath: string;
  repoLabel: string;
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

interface LineageDiffSemantic {
  tags: Set<LineageIntentTag>;
  tokens: Set<string>;
  normalizedFiles: Set<string>;
  summary: string;
}

interface PersistedLineageDiffSemantic {
  commitId: string;
  tags: LineageIntentTag[];
  tokens: string[];
  files: string[];
  summary: string;
}

const DEFAULT_MAX_COMMITS = 120;
const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_MAX_COMMITS = 500;
const MIN_MAX_COMMITS = 20;
const MIN_CACHE_TTL_MS = 1_000;
const MAX_CACHE_TTL_MS = 600_000;
const MAX_CROSS_REPO_ROOTS = 5;
const MAX_DIFF_TOKEN_COUNT = 220;
const MAX_DIFF_FILE_HINTS = 80;
const MAX_PERSISTED_DIFF_ENTRIES = 3_500;
const LINEAGE_DIFF_CACHE_RELATIVE_PATH = ".grobot/context/lineage-diff-cache.json";
const LOG_MARKER = "__GROBOT_COMMIT__";
const LOG_FIELD_SEPARATOR = "\u001f";
const lineageCache = new Map<string, LineageCacheEntry>();
const lineageDiffCacheByRoot = new Map<string, Map<string, PersistedLineageDiffSemantic>>();

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

function resolveRepoLabel(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  const label = (slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized).trim();
  if (!label) {
    return "repo";
  }
  return label;
}

function resolveParentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

function resolveExtraLineageRepoRoots(workDir: string, primaryRoot: string): string[] {
  const configured = process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_EXTRA_REPOS;
  if (!configured || !configured.trim()) {
    return [];
  }
  const rawItems = configured
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (rawItems.length === 0) {
    return [];
  }
  const resolvedRoots: string[] = [];
  const seen = new Set<string>([primaryRoot]);
  for (const rawPath of rawItems) {
    if (resolvedRoots.length >= MAX_CROSS_REPO_ROOTS) {
      break;
    }
    const candidateWorkDir = rawPath.startsWith("/")
      ? rawPath
      : resolve(workDir, rawPath);
    const gitRoot = resolveGitRoot(candidateWorkDir);
    if (!gitRoot || seen.has(gitRoot)) {
      continue;
    }
    seen.add(gitRoot);
    resolvedRoots.push(gitRoot);
  }
  return resolvedRoots;
}

function resolveLineageDiffCachePath(rootPath: string): string {
  return resolve(rootPath, LINEAGE_DIFF_CACHE_RELATIVE_PATH);
}

function loadPersistedLineageDiffCache(rootPath: string): Map<string, PersistedLineageDiffSemantic> {
  const existing = lineageDiffCacheByRoot.get(rootPath);
  if (existing) {
    return existing;
  }
  const path = resolveLineageDiffCachePath(rootPath);
  if (!existsSync(path)) {
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

function getLineageDiffSemantic(rootPath: string, row: LineageCommitRow): LineageDiffSemantic | undefined {
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

function parseGitLogRows(raw: string, rootPath: string): LineageCommitRow[] {
  const rows: LineageCommitRow[] = [];
  const repoLabel = resolveRepoLabel(rootPath);
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
          rootPath,
          repoLabel,
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
      rootPath,
      repoLabel,
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
  return parseGitLogRows(output, rootPath);
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

function scoreLineageDiffSemantic(args: {
  queryTokens: Set<string>;
  queryIntentTags: Set<LineageIntentTag>;
  queryPathHints: readonly string[];
  semantic?: LineageDiffSemantic;
}): number {
  const semantic = args.semantic;
  if (!semantic) {
    return 0;
  }
  let score = 0;
  let tokenOverlap = 0;
  for (const token of args.queryTokens) {
    if (semantic.tokens.has(token)) {
      tokenOverlap += 1;
    }
  }
  score += Math.min(4.2, tokenOverlap * 0.9);
  let intentOverlap = 0;
  for (const tag of args.queryIntentTags) {
    if (semantic.tags.has(tag)) {
      intentOverlap += 1;
    }
  }
  score += Math.min(5.5, intentOverlap * 2.1);
  let pathOverlap = 0;
  for (const path of args.queryPathHints) {
    for (const semanticPath of semantic.normalizedFiles) {
      if (isPathOverlap(path, semanticPath)) {
        pathOverlap += 1;
        break;
      }
    }
  }
  score += Math.min(6, pathOverlap * 2.2);
  return score;
}

function buildLineageSummary(row: LineageCommitRow, semantic?: LineageDiffSemantic): string {
  const repoPrefix = row.repoLabel ? `[${row.repoLabel}] ` : "";
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
  const semanticSuffix = semantic?.summary
    ? ` | diff: ${semantic.summary}`
    : "";
  return truncateSummary(`${repoPrefix}${row.subject}${changeStats} | files: ${filePreview.join(", ")}${fileSuffix}${intentSuffix}${semanticSuffix}`);
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
  const extraRoots = resolveExtraLineageRepoRoots(workDir, rootPath);
  const allRoots = [rootPath, ...extraRoots];
  const rows = allRoots.flatMap((root) => getCachedLineageRows(root, maxCommits, cacheTtlMs));
  if (rows.length === 0) {
    return [];
  }
  const sortedRows = [...rows].sort((left, right) => {
    if (left.timestamp && right.timestamp && left.timestamp !== right.timestamp) {
      return right.timestamp.localeCompare(left.timestamp);
    }
    return right.commitId.localeCompare(left.commitId);
  });
  const queryTokens = new Set(tokenize(query));
  const queryIntentTags = inferIntentTags(query);
  const queryPathHints = extractPathHints(query);
  const normalizedQuery = normalizeText(query);
  const ranked = sortedRows
    .map((row, index) => ({
      row,
      baseScore: scoreLineageRow(
        row,
        queryTokens,
        queryIntentTags,
        queryPathHints,
        normalizedQuery,
        index,
      ),
      index,
    }))
    .filter((item) => item.baseScore > 0)
    .sort((left, right) => {
      if (left.baseScore !== right.baseScore) {
        return right.baseScore - left.baseScore;
      }
      return left.index - right.index;
    });
  const semanticCandidateCount = Math.min(
    ranked.length,
    Math.max(normalizedLimit * 6, 20),
  );
  const semanticByCommit = new Map<string, LineageDiffSemantic>();
  for (let index = 0; index < semanticCandidateCount; index += 1) {
    const item = ranked[index];
    if (!item) {
      continue;
    }
    const semantic = getLineageDiffSemantic(item.row.rootPath, item.row);
    if (!semantic) {
      continue;
    }
    semanticByCommit.set(`${item.row.rootPath}::${item.row.commitId}`, semantic);
  }
  const reranked = ranked
    .map((item) => {
      const semantic = semanticByCommit.get(`${item.row.rootPath}::${item.row.commitId}`);
      const semanticScore = scoreLineageDiffSemantic({
        queryTokens,
        queryIntentTags,
        queryPathHints,
        semantic,
      });
      return {
        ...item,
        semantic,
        score: item.baseScore + semanticScore,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .slice(0, normalizedLimit)
    .sort((left, right) => left.index - right.index);
  return reranked.map((item) => ({
    commitId: item.row.commitId,
    author: item.row.author,
    timestamp: item.row.timestamp,
    summary: buildLineageSummary(item.row, item.semantic),
  }));
}
