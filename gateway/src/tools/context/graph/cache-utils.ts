import { type ChangedCodeSnapshot } from "./changed-code-snapshot";

const SNAPSHOT_SAMPLE_SLICE_CHARS = 160;
const EMPTY_CACHE_STATS = {
  hit: 0,
  miss: 0,
  write: 0,
  evict: 0,
} as const;

export interface ContextGraphCacheStats {
  hit: number;
  miss: number;
  write: number;
  evict: number;
}

const cacheStats = new Map<string, ContextGraphCacheStats>();

export function hashContentFNV(raw: string): string {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashContentSample(raw: string): string {
  if (raw.length <= SNAPSHOT_SAMPLE_SLICE_CHARS * 2) {
    return hashContentFNV(raw);
  }
  const head = raw.slice(0, SNAPSHOT_SAMPLE_SLICE_CHARS);
  const tail = raw.slice(-SNAPSHOT_SAMPLE_SLICE_CHARS);
  return hashContentFNV(`${head}::${tail}::${String(raw.length)}`);
}

export function normalizeQueryKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeSnapshotFingerprint(snapshot: ChangedCodeSnapshot): string {
  const fileFingerprints = snapshot.files
    .map((file) => `${file.path}#${String(file.content.length)}#${hashContentSample(file.content)}`)
    .sort()
    .join("|");
  return hashContentFNV(`${snapshot.rootPath}::${fileFingerprints}`);
}

function getOrCreateCacheStats(bucket: string): ContextGraphCacheStats {
  const normalized = bucket.trim();
  if (!normalized) {
    return {
      hit: 0,
      miss: 0,
      write: 0,
      evict: 0,
    };
  }
  const existing = cacheStats.get(normalized);
  if (existing) {
    return existing;
  }
  const created: ContextGraphCacheStats = {
    hit: 0,
    miss: 0,
    write: 0,
    evict: 0,
  };
  cacheStats.set(normalized, created);
  return created;
}

export function recordContextGraphCacheHit(bucket: string): void {
  const stats = getOrCreateCacheStats(bucket);
  stats.hit += 1;
}

export function recordContextGraphCacheMiss(bucket: string): void {
  const stats = getOrCreateCacheStats(bucket);
  stats.miss += 1;
}

export function recordContextGraphCacheWrite(bucket: string): void {
  const stats = getOrCreateCacheStats(bucket);
  stats.write += 1;
}

export function recordContextGraphCacheEvict(bucket: string, count = 1): void {
  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (normalizedCount <= 0) {
    return;
  }
  const stats = getOrCreateCacheStats(bucket);
  stats.evict += normalizedCount;
}

export function readContextGraphCacheStats(): Record<string, ContextGraphCacheStats> {
  const output: Record<string, ContextGraphCacheStats> = {};
  for (const [bucket, stats] of cacheStats.entries()) {
    output[bucket] = {
      hit: stats.hit,
      miss: stats.miss,
      write: stats.write,
      evict: stats.evict,
    };
  }
  return output;
}

export function readContextGraphCacheStatsBucket(bucket: string): ContextGraphCacheStats {
  const normalized = bucket.trim();
  if (!normalized) {
    return {
      ...EMPTY_CACHE_STATS,
    };
  }
  const found = cacheStats.get(normalized);
  if (!found) {
    return {
      ...EMPTY_CACHE_STATS,
    };
  }
  return {
    hit: found.hit,
    miss: found.miss,
    write: found.write,
    evict: found.evict,
  };
}

export function resetContextGraphCacheStats(): void {
  cacheStats.clear();
}

export function setLruCacheEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): number {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  const limit = Math.max(1, Math.floor(maxEntries));
  let evicted = 0;
  while (map.size > limit) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) {
      break;
    }
    map.delete(oldestKey);
    evicted += 1;
  }
  return evicted;
}
