import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ChangedCodeFile {
  path: string;
  content: string;
}

export interface ChangedCodeSnapshot {
  rootPath: string;
  files: ChangedCodeFile[];
}

interface ChangedCodeSnapshotOptions {
  workDir?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  includeUntracked?: boolean;
  cacheTtlMs?: number;
}

interface SnapshotCacheEntry {
  expiresAtMs: number;
  snapshot: ChangedCodeSnapshot;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_FILE_BYTES = 250_000;
const DEFAULT_CACHE_TTL_MS = 1_500;
const MIN_CACHE_TTL_MS = 0;
const MAX_CACHE_TTL_MS = 60_000;
const snapshotCache = new Map<string, SnapshotCacheEntry>();

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".php",
];

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

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function hasCodeExtension(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return CODE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
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
  return String(run.stdout ?? "");
}

function resolveGitRoot(workDir: string): string | undefined {
  const output = runGitCommand(workDir, ["rev-parse", "--show-toplevel"]);
  if (!output) {
    return undefined;
  }
  const firstLine = output.split(/\r?\n/)[0] ?? "";
  if (!firstLine.trim()) {
    return undefined;
  }
  return resolve(firstLine.trim());
}

function collectPaths(target: Set<string>, raw: string): void {
  for (const line of raw.split(/\r?\n/)) {
    const normalized = normalizePath(line);
    if (!normalized || !hasCodeExtension(normalized)) {
      continue;
    }
    target.add(normalized);
  }
}

function readChangedCodePaths(rootPath: string, includeUntracked: boolean, maxFiles: number): string[] {
  const rows = new Set<string>();
  collectPaths(
    rows,
    runGitCommand(rootPath, ["diff", "--name-only", "--relative"]) ?? "",
  );
  collectPaths(
    rows,
    runGitCommand(rootPath, ["diff", "--cached", "--name-only", "--relative"]) ?? "",
  );
  if (includeUntracked) {
    collectPaths(
      rows,
      runGitCommand(rootPath, ["ls-files", "--others", "--exclude-standard"]) ?? "",
    );
  }
  return Array.from(rows).slice(0, maxFiles);
}

function readChangedCodeFiles(
  rootPath: string,
  filePaths: readonly string[],
  maxFileBytes: number,
): ChangedCodeFile[] {
  const rows: ChangedCodeFile[] = [];
  for (const path of filePaths) {
    const absolutePath = resolve(rootPath, path);
    if (!existsSync(absolutePath)) {
      continue;
    }
    let content = "";
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    if (content.length > maxFileBytes) {
      continue;
    }
    rows.push({
      path,
      content,
    });
  }
  return rows;
}

export function getChangedCodeSnapshot(
  options: ChangedCodeSnapshotOptions = {},
): ChangedCodeSnapshot | undefined {
  const workDir = resolve(options.workDir ?? process.cwd());
  const rootPath = resolveGitRoot(workDir);
  if (!rootPath) {
    return undefined;
  }
  const maxFiles = clampInteger(options.maxFiles ?? DEFAULT_MAX_FILES, DEFAULT_MAX_FILES, 1, 200);
  const maxFileBytes = clampInteger(
    options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    DEFAULT_MAX_FILE_BYTES,
    5_000,
    2_000_000,
  );
  const includeUntracked = options.includeUntracked !== false;
  const cacheTtlMs = clampInteger(
    options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    MIN_CACHE_TTL_MS,
    MAX_CACHE_TTL_MS,
  );
  const cacheKey = `${rootPath}::${String(maxFiles)}::${String(maxFileBytes)}::${includeUntracked ? "u1" : "u0"}`;
  const nowMs = Date.now();
  if (cacheTtlMs > 0) {
    const cached = snapshotCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) {
      return {
        rootPath: cached.snapshot.rootPath,
        files: cached.snapshot.files.map((row) => ({ ...row })),
      };
    }
  }
  const changedPaths = readChangedCodePaths(rootPath, includeUntracked, maxFiles);
  if (changedPaths.length === 0) {
    return {
      rootPath,
      files: [],
    };
  }
  const files = readChangedCodeFiles(rootPath, changedPaths, maxFileBytes);
  const snapshot: ChangedCodeSnapshot = {
    rootPath,
    files,
  };
  if (cacheTtlMs > 0) {
    snapshotCache.set(cacheKey, {
      expiresAtMs: nowMs + cacheTtlMs,
      snapshot,
    });
  }
  return {
    rootPath: snapshot.rootPath,
    files: snapshot.files.map((row) => ({ ...row })),
  };
}
