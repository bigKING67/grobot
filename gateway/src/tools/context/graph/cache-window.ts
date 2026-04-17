import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";

export interface GraphCacheBucketCounter {
  hit: number;
  miss: number;
  write: number;
  evict: number;
}

export interface GraphCacheWindowBucketSet {
  symbolQuery: GraphCacheBucketCounter;
  symbolDeclaration: GraphCacheBucketCounter;
  dependencyQuery: GraphCacheBucketCounter;
  dependencyImport: GraphCacheBucketCounter;
}

export interface GraphCacheWindowTurnEntry {
  ts: string;
  sessionKey: string;
  stage: string;
  selectionReason: string;
  delta: GraphCacheWindowBucketSet;
  total: GraphCacheWindowBucketSet;
}

export interface GraphCacheWindowSummary {
  path: string;
  configuredSize: number;
  entries: number;
  fromTs: string | null;
  toTs: string | null;
  deltaTotals: GraphCacheWindowBucketSet;
  queryTotals: GraphCacheBucketCounter;
  overallTotals: GraphCacheBucketCounter;
  queryHitRate: number | null;
  overallHitRate: number | null;
}

const GRAPH_CACHE_WINDOW_RELATIVE_PATH = ".grobot/context/graph-cache-window.jsonl";
const MAX_PERSISTED_ENTRIES = 512;
const TRIM_TRIGGER_BYTES = 1_000_000;
const TRIM_LOCK_SUFFIX = ".trim.lock";

function createEmptyCounter(): GraphCacheBucketCounter {
  return {
    hit: 0,
    miss: 0,
    write: 0,
    evict: 0,
  };
}

function createEmptyBucketSet(): GraphCacheWindowBucketSet {
  return {
    symbolQuery: createEmptyCounter(),
    symbolDeclaration: createEmptyCounter(),
    dependencyQuery: createEmptyCounter(),
    dependencyImport: createEmptyCounter(),
  };
}

function normalizeCounter(raw: unknown): GraphCacheBucketCounter {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return createEmptyCounter();
  }
  const row = raw as Record<string, unknown>;
  const asNumber = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.floor(value));
  };
  return {
    hit: asNumber(row.hit),
    miss: asNumber(row.miss),
    write: asNumber(row.write),
    evict: asNumber(row.evict),
  };
}

function normalizeBucketSet(raw: unknown): GraphCacheWindowBucketSet {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return createEmptyBucketSet();
  }
  const row = raw as Record<string, unknown>;
  return {
    symbolQuery: normalizeCounter(row.symbolQuery),
    symbolDeclaration: normalizeCounter(row.symbolDeclaration),
    dependencyQuery: normalizeCounter(row.dependencyQuery),
    dependencyImport: normalizeCounter(row.dependencyImport),
  };
}

function parseWindowEntry(raw: string): GraphCacheWindowTurnEntry | null {
  const line = raw.trim();
  if (!line) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    return null;
  }
  const row = parsed as Record<string, unknown>;
  const ts = typeof row.ts === "string" ? row.ts.trim() : "";
  const sessionKey = typeof row.sessionKey === "string" ? row.sessionKey.trim() : "";
  const stage = typeof row.stage === "string" ? row.stage.trim() : "";
  const selectionReason = typeof row.selectionReason === "string" ? row.selectionReason.trim() : "";
  if (!ts || !sessionKey || !stage || !selectionReason) {
    return null;
  }
  return {
    ts,
    sessionKey,
    stage,
    selectionReason,
    delta: normalizeBucketSet(row.delta),
    total: normalizeBucketSet(row.total),
  };
}

function normalizeWindowSize(raw: number | undefined, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(256, Math.max(1, Math.floor(raw)));
}

function resolveWindowPath(workDir: string): string {
  return resolve(workDir, GRAPH_CACHE_WINDOW_RELATIVE_PATH);
}

function resolveParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

function readWindowEntries(path: string): GraphCacheWindowTurnEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => parseWindowEntry(line))
    .filter((entry): entry is GraphCacheWindowTurnEntry => Boolean(entry));
}

function sumCounter(target: GraphCacheBucketCounter, delta: GraphCacheBucketCounter): void {
  target.hit += delta.hit;
  target.miss += delta.miss;
  target.write += delta.write;
  target.evict += delta.evict;
}

function sumBucketSet(target: GraphCacheWindowBucketSet, delta: GraphCacheWindowBucketSet): void {
  sumCounter(target.symbolQuery, delta.symbolQuery);
  sumCounter(target.symbolDeclaration, delta.symbolDeclaration);
  sumCounter(target.dependencyQuery, delta.dependencyQuery);
  sumCounter(target.dependencyImport, delta.dependencyImport);
}

function sumBucketCounters(counters: readonly GraphCacheBucketCounter[]): GraphCacheBucketCounter {
  const output = createEmptyCounter();
  for (const row of counters) {
    sumCounter(output, row);
  }
  return output;
}

function computeHitRate(counter: GraphCacheBucketCounter): number | null {
  const denominator = counter.hit + counter.miss;
  if (denominator <= 0) {
    return null;
  }
  return counter.hit / denominator;
}

function maybeTrimWindowFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const lockPath = `${path}${TRIM_LOCK_SUFFIX}`;
  let lockFd = -1;
  try {
    lockFd = openSync(lockPath, "wx");
  } catch {
    return;
  }
  try {
    let fileBytes = 0;
    try {
      const raw = readFileSync(path, "utf8");
      fileBytes = raw.length;
    } catch {
      return;
    }
    if (fileBytes < TRIM_TRIGGER_BYTES) {
      return;
    }
    const entries = readWindowEntries(path);
    if (entries.length <= MAX_PERSISTED_ENTRIES) {
      return;
    }
    const trimmed = entries.slice(-MAX_PERSISTED_ENTRIES);
    const content = trimmed.map((entry) => JSON.stringify(entry)).join("\n");
    try {
      writeFileSync(path, `${content}\n`, "utf8");
    } catch {
      // best effort only
    }
  } finally {
    try {
      if (lockFd >= 0) {
        closeSync(lockFd);
      }
    } catch {
      // ignore lock close failure
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore lock cleanup failure
    }
  }
}

export function appendGraphCacheWindowEntry(input: {
  workDir: string;
  entry: GraphCacheWindowTurnEntry;
}): void {
  const path = resolveWindowPath(input.workDir);
  try {
    mkdirSync(resolveParentDir(path), { recursive: true });
    const serialized = `${JSON.stringify(input.entry)}\n`;
    const fd = openSync(path, "a");
    try {
      writeSync(fd, serialized, undefined, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return;
  }
  maybeTrimWindowFile(path);
}

export function readGraphCacheWindowSummary(input: {
  workDir: string;
  size?: number;
}): GraphCacheWindowSummary {
  const configuredSize = normalizeWindowSize(input.size, 20);
  const path = resolveWindowPath(input.workDir);
  const entries = readWindowEntries(path).slice(-configuredSize);
  const deltaTotals = createEmptyBucketSet();
  for (const row of entries) {
    sumBucketSet(deltaTotals, row.delta);
  }
  const queryTotals = sumBucketCounters([
    deltaTotals.symbolQuery,
    deltaTotals.dependencyQuery,
  ]);
  const overallTotals = sumBucketCounters([
    deltaTotals.symbolQuery,
    deltaTotals.symbolDeclaration,
    deltaTotals.dependencyQuery,
    deltaTotals.dependencyImport,
  ]);
  return {
    path,
    configuredSize,
    entries: entries.length,
    fromTs: entries[0]?.ts ?? null,
    toTs: entries[entries.length - 1]?.ts ?? null,
    deltaTotals,
    queryTotals,
    overallTotals,
    queryHitRate: computeHitRate(queryTotals),
    overallHitRate: computeHitRate(overallTotals),
  };
}
