export interface GraphCacheCounter {
  hit: number;
  miss: number;
  write: number;
  evict: number;
}

export function readGraphCacheCounter(
  stats: Record<string, { hit?: number; miss?: number; write?: number; evict?: number }>,
  bucket: string,
): GraphCacheCounter {
  const row = stats[bucket];
  return {
    hit: Number.isFinite(row?.hit) ? Number(row?.hit) : 0,
    miss: Number.isFinite(row?.miss) ? Number(row?.miss) : 0,
    write: Number.isFinite(row?.write) ? Number(row?.write) : 0,
    evict: Number.isFinite(row?.evict) ? Number(row?.evict) : 0,
  };
}

export function diffGraphCacheCounter(
  before: GraphCacheCounter,
  after: GraphCacheCounter,
): GraphCacheCounter {
  return {
    hit: Math.max(0, after.hit - before.hit),
    miss: Math.max(0, after.miss - before.miss),
    write: Math.max(0, after.write - before.write),
    evict: Math.max(0, after.evict - before.evict),
  };
}
