import { getChangedCodeSnapshot } from "./changed-code-snapshot";
import {
  computeSnapshotFingerprint,
  normalizeQueryKey,
} from "./cache-utils";
import { MAX_QUERY_CACHE_ROWS } from "./dependency-hints/constants";
import {
  extractImports,
  resolveRelativeTarget,
  resolveRelativeTargetInSnapshot,
} from "./dependency-hints/imports";
import {
  buildLocalAdjacency,
  buildMultiHopDependencyRows,
  collectSeedPaths,
  scoreEdge,
} from "./dependency-hints/ranking";
import {
  readQueryCacheRows,
  writeQueryCacheRows,
} from "./dependency-hints/query-cache";
import {
  clampInteger,
  dedupeRows,
  normalizePath,
  stripTrailingSlash,
  tokenize,
} from "./dependency-hints/utils";
import {
  type DependencyEdge,
  type RetrieveDependencyHintsOptions,
  type ScoredDependencyRow,
} from "./dependency-hints/types";

export { readDependencyGraphCacheStats } from "./dependency-hints/query-cache";

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
  if (!snapshot || snapshot.files.length === 0) {
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
  const snapshotPathSet = new Set(
    snapshot.files.map((file) => normalizePath(file.path).toLowerCase()),
  );
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
      const score = scoreEdge(queryTokens, file.path, normalizedTarget)
        + (targetIsLocal ? 1.5 : 0);
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

  const rankedDirect: ScoredDependencyRow[] = edges
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
  const deduped = dedupeRows(merged, MAX_QUERY_CACHE_ROWS);
  writeQueryCacheRows(cacheKey, snapshotFingerprint, deduped);
  return deduped.slice(0, maxRows);
}
