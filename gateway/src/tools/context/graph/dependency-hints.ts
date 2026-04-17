import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getChangedCodeSnapshot, type ChangedCodeSnapshot } from "./changed-code-snapshot";
import { extractTypeScriptAstDependencyTargets } from "./dependency-ts-ast";
import {
  computeSnapshotFingerprint,
  hashContentFNV,
  normalizeQueryKey,
  readContextGraphCacheStatsBucket,
  recordContextGraphCacheEvict,
  recordContextGraphCacheHit,
  recordContextGraphCacheMiss,
  recordContextGraphCacheWrite,
  setLruCacheEntry,
} from "./cache-utils";

interface RetrieveDependencyHintsOptions {
  workDir?: string;
  maxRows?: number;
  changedCodeSnapshot?: ChangedCodeSnapshot;
}

interface DependencyEdge {
  fromPath: string;
  target: string;
  score: number;
}

interface DependencyQueryCacheEntry {
  expiresAtMs: number;
  snapshotFingerprint: string;
  rows: string[];
}

const QUERY_CACHE_TTL_MS = 2_000;
const MAX_QUERY_CACHE_ENTRIES = 256;
const MAX_QUERY_CACHE_ROWS = 120;
const MAX_IMPORT_CACHE_ENTRIES = 640;

const dependencyQueryCache = new Map<string, DependencyQueryCacheEntry>();
const dependencyImportCache = new Map<string, string[]>();
const DEPENDENCY_QUERY_CACHE_BUCKET = "dependency_query";
const DEPENDENCY_IMPORT_CACHE_BUCKET = "dependency_import";

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

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function getDirPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function stripTrailingSlash(rawPath: string): string {
  if (!rawPath) {
    return rawPath;
  }
  return rawPath.replace(/\/+$/, "");
}

function resolveRelativeTarget(rootPath: string, fromPath: string, importPath: string): string | undefined {
  if (!importPath.startsWith(".")) {
    return undefined;
  }
  const baseDir = getDirPath(fromPath);
  const resolvedBase = resolve(rootPath, baseDir, importPath);
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`,
    `${resolvedBase}.mjs`,
    `${resolvedBase}.cjs`,
    `${resolvedBase}.py`,
    `${resolvedBase}.rs`,
    `${resolvedBase}.go`,
    `${resolvedBase}.java`,
    `${resolvedBase}/index.ts`,
    `${resolvedBase}/index.tsx`,
    `${resolvedBase}/index.js`,
    `${resolvedBase}/index.mjs`,
    `${resolvedBase}/index.py`,
    `${resolvedBase}/mod.rs`,
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const relativeRaw = candidate.startsWith(rootPath)
      ? candidate.slice(rootPath.length)
      : candidate;
    const relative = normalizePath(relativeRaw);
    if (!relative) {
      continue;
    }
    return relative;
  }
  return normalizePath(importPath);
}

function dedupeTargets(rows: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of rows) {
    const normalized = raw.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 160) {
      break;
    }
  }
  return output;
}

function extractRegexImports(content: string): string[] {
  const rows: string[] = [];
  const push = (value: string): void => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    rows.push(normalized);
  };
  const esmRegex = /from\s+["']([^"']+)["']/g;
  let esmMatch: RegExpExecArray | null = esmRegex.exec(content);
  while (esmMatch) {
    if (typeof esmMatch[1] === "string") {
      push(esmMatch[1]);
    }
    esmMatch = esmRegex.exec(content);
  }
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
  let requireMatch: RegExpExecArray | null = requireRegex.exec(content);
  while (requireMatch) {
    if (typeof requireMatch[1] === "string") {
      push(requireMatch[1]);
    }
    requireMatch = requireRegex.exec(content);
  }
  const pythonFromRegex = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/gm;
  let pythonFromMatch: RegExpExecArray | null = pythonFromRegex.exec(content);
  while (pythonFromMatch) {
    if (typeof pythonFromMatch[1] === "string") {
      push(pythonFromMatch[1]);
    }
    pythonFromMatch = pythonFromRegex.exec(content);
  }
  const pythonImportRegex = /^\s*import\s+([A-Za-z0-9_.]+)/gm;
  let pythonImportMatch: RegExpExecArray | null = pythonImportRegex.exec(content);
  while (pythonImportMatch) {
    if (typeof pythonImportMatch[1] === "string") {
      push(pythonImportMatch[1]);
    }
    pythonImportMatch = pythonImportRegex.exec(content);
  }
  const rustUseRegex = /^\s*use\s+([A-Za-z0-9_:]+)/gm;
  let rustUseMatch: RegExpExecArray | null = rustUseRegex.exec(content);
  while (rustUseMatch) {
    if (typeof rustUseMatch[1] === "string") {
      push(rustUseMatch[1]);
    }
    rustUseMatch = rustUseRegex.exec(content);
  }
  return dedupeTargets(rows).slice(0, 120);
}

function extractImports(filePath: string, content: string): string[] {
  const cacheKey = `${filePath}::${String(content.length)}::${hashContentFNV(content)}`;
  const cached = dependencyImportCache.get(cacheKey);
  if (cached) {
    recordContextGraphCacheHit(DEPENDENCY_IMPORT_CACHE_BUCKET);
    return cached;
  }
  recordContextGraphCacheMiss(DEPENDENCY_IMPORT_CACHE_BUCKET);
  const astTargets = extractTypeScriptAstDependencyTargets(filePath, content);
  const resolved = astTargets.length > 0
    ? dedupeTargets(astTargets).slice(0, 120)
    : extractRegexImports(content);
  const evicted = setLruCacheEntry(
    dependencyImportCache,
    cacheKey,
    resolved,
    MAX_IMPORT_CACHE_ENTRIES,
  );
  recordContextGraphCacheWrite(DEPENDENCY_IMPORT_CACHE_BUCKET);
  if (evicted > 0) {
    recordContextGraphCacheEvict(DEPENDENCY_IMPORT_CACHE_BUCKET, evicted);
  }
  return resolved;
}

function scoreEdge(queryTokens: Set<string>, fromPath: string, target: string): number {
  let score = 1;
  const tokens = new Set([...tokenize(fromPath), ...tokenize(target)]);
  for (const token of queryTokens) {
    if (tokens.has(token)) {
      score += 2;
    }
  }
  if (target.startsWith(".")) {
    score += 1;
  }
  return score;
}

function dedupeRows(rows: readonly string[], maxRows?: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const row of rows) {
    const normalized = row.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (typeof maxRows === "number" && output.length >= maxRows) {
      break;
    }
  }
  return output;
}

function readQueryCacheRows(cacheKey: string, snapshotFingerprint: string): string[] | undefined {
  const cached = dependencyQueryCache.get(cacheKey);
  if (!cached) {
    recordContextGraphCacheMiss(DEPENDENCY_QUERY_CACHE_BUCKET);
    return undefined;
  }
  if (cached.expiresAtMs <= Date.now() || cached.snapshotFingerprint !== snapshotFingerprint) {
    dependencyQueryCache.delete(cacheKey);
    recordContextGraphCacheMiss(DEPENDENCY_QUERY_CACHE_BUCKET);
    return undefined;
  }
  recordContextGraphCacheHit(DEPENDENCY_QUERY_CACHE_BUCKET);
  setLruCacheEntry(dependencyQueryCache, cacheKey, cached, MAX_QUERY_CACHE_ENTRIES);
  return cached.rows;
}

function writeQueryCacheRows(cacheKey: string, snapshotFingerprint: string, rows: readonly string[]): void {
  const normalizedRows = dedupeRows(rows, MAX_QUERY_CACHE_ROWS);
  const evicted = setLruCacheEntry(
    dependencyQueryCache,
    cacheKey,
    {
      expiresAtMs: Date.now() + QUERY_CACHE_TTL_MS,
      snapshotFingerprint,
      rows: normalizedRows,
    },
    MAX_QUERY_CACHE_ENTRIES,
  );
  recordContextGraphCacheWrite(DEPENDENCY_QUERY_CACHE_BUCKET);
  if (evicted > 0) {
    recordContextGraphCacheEvict(DEPENDENCY_QUERY_CACHE_BUCKET, evicted);
  }
}

export function readDependencyGraphCacheStats(): {
  query: ReturnType<typeof readContextGraphCacheStatsBucket>;
  import: ReturnType<typeof readContextGraphCacheStatsBucket>;
} {
  return {
    query: readContextGraphCacheStatsBucket(DEPENDENCY_QUERY_CACHE_BUCKET),
    import: readContextGraphCacheStatsBucket(DEPENDENCY_IMPORT_CACHE_BUCKET),
  };
}

export function retrieveDependencyGraphHints(
  query: string,
  options: RetrieveDependencyHintsOptions = {},
): string[] {
  const maxRows = clampInteger(options.maxRows ?? 4, 4, 1, 20);
  const snapshot = options.changedCodeSnapshot ?? getChangedCodeSnapshot({
    workDir: options.workDir,
    maxFiles: 40,
    maxFileBytes: 250_000,
    includeUntracked: true,
    cacheTtlMs: 1_500,
  });
  if (!snapshot) {
    return [];
  }
  if (snapshot.files.length === 0) {
    return [];
  }
  const snapshotFingerprint = computeSnapshotFingerprint(snapshot);
  const queryKey = normalizeQueryKey(query);
  const cacheKey = `${snapshot.rootPath}::${queryKey}`;
  const cachedRows = readQueryCacheRows(cacheKey, snapshotFingerprint);
  if (cachedRows) {
    return cachedRows.slice(0, maxRows);
  }
  const queryTokens = new Set(tokenize(query));
  const resolvedTargetCache = new Map<string, string>();
  const edges: DependencyEdge[] = [];
  for (const file of snapshot.files) {
    const imports = extractImports(file.path, file.content);
    for (const importPathRaw of imports) {
      const importPath = stripTrailingSlash(importPathRaw);
      if (!importPath) {
        continue;
      }
      const resolveCacheKey = `${file.path}::${importPath}`;
      let target = resolvedTargetCache.get(resolveCacheKey);
      if (!target) {
        target = resolveRelativeTarget(snapshot.rootPath, file.path, importPath) ?? importPath;
        resolvedTargetCache.set(resolveCacheKey, target);
      }
      const score = scoreEdge(queryTokens, file.path, target);
      edges.push({
        fromPath: file.path,
        target,
        score,
      });
    }
  }
  if (edges.length === 0) {
    writeQueryCacheRows(cacheKey, snapshotFingerprint, []);
    return [];
  }
  const ranked = edges
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leftKey = `${left.fromPath}->${left.target}`;
      const rightKey = `${right.fromPath}->${right.target}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((edge) => `${edge.fromPath} -> ${edge.target}`);
  const deduped = dedupeRows(ranked);
  writeQueryCacheRows(cacheKey, snapshotFingerprint, deduped);
  return deduped.slice(0, maxRows);
}
