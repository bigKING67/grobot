import {
  readContextGraphCacheStatsBucket,
  recordContextGraphCacheEvict,
  recordContextGraphCacheHit,
  recordContextGraphCacheMiss,
  recordContextGraphCacheWrite,
  setLruCacheEntry,
} from "../cache-utils";
import {
  DEPENDENCY_IMPORT_CACHE_BUCKET,
  DEPENDENCY_QUERY_CACHE_BUCKET,
  MAX_QUERY_CACHE_ENTRIES,
  MAX_QUERY_CACHE_ROWS,
  QUERY_CACHE_TTL_MS,
} from "./constants";
import { type DependencyQueryCacheEntry } from "./types";
import { dedupeRows } from "./utils";

const dependencyQueryCache = new Map<string, DependencyQueryCacheEntry>();

export function readQueryCacheRows(
  cacheKey: string,
  snapshotFingerprint: string,
): string[] | undefined {
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

export function writeQueryCacheRows(
  cacheKey: string,
  snapshotFingerprint: string,
  rows: readonly string[],
): void {
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
