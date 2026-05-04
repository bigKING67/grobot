import { normalizeQueryKey } from "../cache-utils";
import {
  MAX_QUERY_ROWS,
  type PersistentGraphIndexEntry,
} from "./contract";
import { getRuntime } from "./runtime";
import {
  buildMultiHopDependencyRows,
  collectSeedPaths,
  readQueryCacheRows,
  scoreDependencyEdge,
  writeQueryCacheRows,
} from "./query-core";
import {
  clampInteger,
  dedupeRows,
  tokenize,
} from "./utils";

export function queryDependencyHintsWithEntry(
  entry: PersistentGraphIndexEntry,
  query: string,
  maxRowsInput?: number,
): string[] {
  const maxRows = clampInteger(maxRowsInput ?? 4, 4, 1, 24);
  const runtime = getRuntime(entry);
  if (runtime.edges.length === 0) {
    return [];
  }
  const queryKey = normalizeQueryKey(query);
  const cacheKey = `${entry.index.rootPath}::${queryKey}`;
  const cachedRows = readQueryCacheRows(entry.dependencyQueryCache, cacheKey, runtime.fingerprint);
  if (cachedRows) {
    return cachedRows.slice(0, maxRows);
  }
  const queryTokens = new Set(tokenize(query));
  const rankedDirect = runtime.edges
    .map((edge) => ({
      ...edge,
      score: scoreDependencyEdge(queryTokens, edge.fromPath, edge.target, edge.targetIsLocal),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leftKey = `${left.fromPath}->${left.target}`;
      const rightKey = `${right.fromPath}->${right.target}`;
      return leftKey.localeCompare(rightKey);
    });
  const directRows = rankedDirect.map((edge) => ({
    line: `${edge.fromPath} -> ${edge.target}`,
    score: edge.score,
  }));
  const seedPaths = collectSeedPaths({
    queryTokens,
    allPaths: Array.from(runtime.displayPathByLower.values()),
    rankedDirect,
  });
  const chainRows = buildMultiHopDependencyRows({
    queryTokens,
    seeds: seedPaths,
    forward: runtime.forward,
    reverse: runtime.reverse,
    changedPathSet: runtime.pathSet,
  });
  const merged = [...chainRows, ...directRows]
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .map((row) => row.line);
  const deduped = dedupeRows(merged, MAX_QUERY_ROWS);
  writeQueryCacheRows(entry.dependencyQueryCache, cacheKey, runtime.fingerprint, deduped);
  return deduped.slice(0, maxRows);
}
