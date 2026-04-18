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
  targetIsLocal: boolean;
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

function resolveRelativeTargetInSnapshot(
  fromPath: string,
  importPath: string,
  snapshotPathSet: ReadonlySet<string>,
): string | undefined {
  if (!importPath.startsWith(".")) {
    return undefined;
  }
  const baseDir = getDirPath(fromPath);
  const resolvedBase = normalizePath(resolve("/", baseDir, importPath)).replace(/^\//, "");
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
    const normalized = normalizePath(candidate);
    if (!normalized) {
      continue;
    }
    if (snapshotPathSet.has(normalized.toLowerCase())) {
      return normalized;
    }
  }
  return undefined;
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
  if (target.includes("/") && /\.[A-Za-z0-9_]+$/.test(target)) {
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

function countPathTokenMatches(path: string, queryTokens: ReadonlySet<string>): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const pathTokens = new Set(tokenize(path));
  let matched = 0;
  for (const token of queryTokens) {
    if (pathTokens.has(token)) {
      matched += 1;
    }
  }
  return matched;
}

function buildLocalAdjacency(
  edges: readonly DependencyEdge[],
): {
  forward: Map<string, string[]>;
  reverse: Map<string, string[]>;
} {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const push = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const current = map.get(key) ?? new Set<string>();
    current.add(value);
    map.set(key, current);
  };
  for (const edge of edges) {
    if (!edge.targetIsLocal) {
      continue;
    }
    push(forward, edge.fromPath, edge.target);
    push(reverse, edge.target, edge.fromPath);
  }
  const sortMap = (source: Map<string, Set<string>>): Map<string, string[]> =>
    new Map(Array.from(source.entries()).map(([key, value]) => [key, Array.from(value).sort()]));
  return {
    forward: sortMap(forward),
    reverse: sortMap(reverse),
  };
}

function collectSeedPaths(args: {
  queryTokens: ReadonlySet<string>;
  snapshotPaths: readonly string[];
  edges: readonly DependencyEdge[];
}): string[] {
  const scores = new Map<string, number>();
  const add = (path: string, delta: number): void => {
    if (!path) {
      return;
    }
    const current = scores.get(path) ?? 0;
    scores.set(path, current + delta);
  };
  for (const path of args.snapshotPaths) {
    const tokenMatches = countPathTokenMatches(path, args.queryTokens);
    if (tokenMatches > 0) {
      add(path, 2 + tokenMatches * 1.1);
    }
  }
  for (const edge of args.edges) {
    add(edge.fromPath, edge.score * 0.65);
    if (edge.targetIsLocal) {
      add(edge.target, edge.score * 0.7);
    }
  }
  return Array.from(scores.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 12)
    .map((item) => item[0]);
}

function buildMultiHopDependencyRows(args: {
  queryTokens: ReadonlySet<string>;
  seeds: readonly string[];
  forward: ReadonlyMap<string, readonly string[]>;
  reverse: ReadonlyMap<string, readonly string[]>;
  changedPathSet: ReadonlySet<string>;
}): Array<{ line: string; score: number }> {
  const degree = new Map<string, number>();
  const accumulateDegree = (map: ReadonlyMap<string, readonly string[]>): void => {
    for (const [key, values] of map.entries()) {
      degree.set(key, (degree.get(key) ?? 0) + values.length);
      for (const value of values) {
        degree.set(value, (degree.get(value) ?? 0) + 1);
      }
    }
  };
  accumulateDegree(args.forward);
  accumulateDegree(args.reverse);
  const rows: Array<{ line: string; score: number }> = [];
  const seen = new Set<string>();
  const scoreChain = (nodes: readonly string[]): number => {
    const uniqueNodes = Array.from(new Set(nodes));
    let score = 1 + Math.max(0, nodes.length - 1) * 0.9;
    let tokenHits = 0;
    for (const node of uniqueNodes) {
      tokenHits += countPathTokenMatches(node, args.queryTokens);
    }
    score += Math.min(4, tokenHits * 1.2);
    let changedHits = 0;
    for (const node of uniqueNodes) {
      if (args.changedPathSet.has(node.toLowerCase())) {
        changedHits += 1;
      }
    }
    score += Math.min(4, changedHits * 1.4);
    const bridgeNodes = uniqueNodes.slice(1, Math.max(1, uniqueNodes.length - 1));
    const centrality = bridgeNodes.reduce((acc, node) => acc + (degree.get(node) ?? 0), 0);
    score += Math.min(3, centrality * 0.25);
    return score;
  };
  const pushChain = (nodes: string[]): void => {
    if (nodes.length < 2) {
      return;
    }
    if (new Set(nodes).size !== nodes.length) {
      return;
    }
    const line = nodes.join(" -> ");
    if (seen.has(line)) {
      return;
    }
    seen.add(line);
    rows.push({
      line,
      score: scoreChain(nodes),
    });
  };
  for (const seed of args.seeds) {
    const forwardLevel1 = args.forward.get(seed) ?? [];
    const reverseLevel1 = args.reverse.get(seed) ?? [];
    for (const next of forwardLevel1) {
      pushChain([seed, next]);
      const forwardLevel2 = args.forward.get(next) ?? [];
      for (const next2 of forwardLevel2) {
        pushChain([seed, next, next2]);
      }
    }
    for (const prev of reverseLevel1) {
      pushChain([prev, seed]);
      for (const next of forwardLevel1) {
        if (next === prev) {
          continue;
        }
        pushChain([prev, seed, next]);
      }
    }
  }
  return rows
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .slice(0, MAX_QUERY_CACHE_ROWS);
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
  const snapshotPathSet = new Set(snapshot.files.map((file) => normalizePath(file.path).toLowerCase()));
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
      let normalizedTarget = normalizePath(target);
      let targetIsLocal = snapshotPathSet.has(normalizedTarget.toLowerCase());
      if (!targetIsLocal) {
        const resolvedInSnapshot = resolveRelativeTargetInSnapshot(
          file.path,
          importPath,
          snapshotPathSet,
        );
        if (resolvedInSnapshot) {
          normalizedTarget = resolvedInSnapshot;
          targetIsLocal = true;
        }
      }
      const score = scoreEdge(queryTokens, file.path, normalizedTarget) + (targetIsLocal ? 1.5 : 0);
      edges.push({
        fromPath: file.path,
        target: normalizedTarget,
        score,
        targetIsLocal,
      });
    }
  }
  if (edges.length === 0) {
    writeQueryCacheRows(cacheKey, snapshotFingerprint, []);
    return [];
  }
  const rankedDirect = edges
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leftKey = `${left.fromPath}->${left.target}`;
      const rightKey = `${right.fromPath}->${right.target}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((edge) => ({
      line: `${edge.fromPath} -> ${edge.target}`,
      score: edge.score,
    }));
  const adjacency = buildLocalAdjacency(edges);
  const seedPaths = collectSeedPaths({
    queryTokens,
    snapshotPaths: snapshot.files.map((file) => file.path),
    edges,
  });
  const rankedChains = buildMultiHopDependencyRows({
    queryTokens,
    seeds: seedPaths,
    forward: adjacency.forward,
    reverse: adjacency.reverse,
    changedPathSet: snapshotPathSet,
  });
  const merged = [...rankedChains, ...rankedDirect]
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .map((row) => row.line);
  const deduped = dedupeRows(merged);
  writeQueryCacheRows(cacheKey, snapshotFingerprint, deduped);
  return deduped.slice(0, maxRows);
}
