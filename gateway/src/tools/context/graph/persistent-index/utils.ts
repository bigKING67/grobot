import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  CODE_EXTENSIONS,
  MAX_PATH_SCAN_BUFFER,
} from "./contract";

export function clampInteger(value: number, fallback: number, min: number, max: number): number {
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

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

export function normalizePathLower(raw: string): string {
  return normalizePath(raw).toLowerCase();
}

export function hasCodeExtension(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return CODE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

export function getDirPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function runGitCommand(cwd: string, args: readonly string[]): string | undefined {
  const run = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 4_500,
    maxBuffer: MAX_PATH_SCAN_BUFFER,
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
  const line = output.split(/\r?\n/)[0] ?? "";
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolve(trimmed);
}

export function resolveGitRootForContext(workDir?: string): string | undefined {
  const candidates = [
    resolve(workDir ?? process.cwd()),
    resolve(process.cwd()),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const root = resolveGitRoot(candidate);
    if (root) {
      return root;
    }
  }
  return undefined;
}

function parseNullSeparatedRows(raw: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split("\u0000")
    .map((item) => normalizePath(item))
    .filter((item) => item.length > 0);
}

export function collectRepositoryCodePaths(rootPath: string): string[] {
  const output = runGitCommand(rootPath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name"]);
  if (!output) {
    return [];
  }
  const dedup = new Set<string>();
  for (const path of parseNullSeparatedRows(output)) {
    if (!hasCodeExtension(path)) {
      continue;
    }
    dedup.add(path);
  }
  return Array.from(dedup).sort((left, right) => left.localeCompare(right));
}

export function dedupeStrings(rows: readonly string[], cap = 240): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const normalized = raw.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= cap) {
      break;
    }
  }
  return output;
}

export function readParentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export function tokenizeIdentifier(raw: string): string[] {
  const compact = raw.trim();
  if (!compact) {
    return [];
  }
  const spaced = compact.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const merged = [...tokenize(compact), ...tokenize(spaced)];
  return Array.from(new Set(merged));
}

export function dedupeRows(rows: readonly string[], cap: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const normalized = raw.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= cap) {
      break;
    }
  }
  return output;
}
