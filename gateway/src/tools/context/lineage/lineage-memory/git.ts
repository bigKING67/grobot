import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  LOG_FIELD_SEPARATOR,
  LOG_MARKER,
  MAX_CROSS_REPO_ROOTS,
  type LineageCacheEntry,
  type LineageCommitRow,
} from "./types";
import { inferIntentTags, normalizePath, normalizeText, resolveRepoLabel, tokenize } from "./text";

const lineageCache = new Map<string, LineageCacheEntry>();

export function runGitCommand(cwd: string, args: readonly string[]): string | undefined {
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

export function resolveGitRoot(workDir: string): string | undefined {
  const output = runGitCommand(workDir, ["rev-parse", "--show-toplevel"]);
  if (!output) {
    return undefined;
  }
  return resolve(output.split(/\r?\n/)[0] ?? output);
}

export function resolveExtraLineageRepoRoots(workDir: string, primaryRoot: string): string[] {
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

function resolveHeadCommit(rootPath: string): string {
  const output = runGitCommand(rootPath, ["rev-parse", "HEAD"]);
  if (!output) {
    return "";
  }
  return String(output.split(/\r?\n/)[0] ?? "").trim();
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
        rows.push(buildLineageRow(rootPath, repoLabel, current));
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
    rows.push(buildLineageRow(rootPath, repoLabel, current));
  }
  return rows;
}

function buildLineageRow(
  rootPath: string,
  repoLabel: string,
  current: {
    commitId: string;
    author: string;
    timestamp: string;
    subject: string;
    files: string[];
    insertions: number;
    deletions: number;
  },
): LineageCommitRow {
  const normalizedFiles = current.files.map((item) => normalizePath(item)).filter((item) => item.length > 0);
  const rowIntentTags = inferIntentTags(`${current.subject} ${current.files.join(" ")}`);
  return {
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
  };
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

export function getCachedLineageRows(rootPath: string, maxCommits: number, cacheTtlMs: number): LineageCommitRow[] {
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
