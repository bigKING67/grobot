import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  INDEX_VERSION,
  REFRESH_MIN_INTERVAL_MS,
  type PersistentGraphFileRecord,
  type PersistentGraphIndexEntry,
  type PersistentGraphIndexMemory,
  type PersistentGraphQueryCacheEntry,
  type PersistentGraphRefreshStats,
  type RefreshMode,
} from "./contract";
import { parseCodeFile, readSafeFileStats } from "./extract";
import {
  appendWindowEntry,
  loadPersistedIndex,
  persistIndex,
} from "./storage";
import {
  collectRepositoryCodePaths,
  normalizePath,
  normalizePathLower,
  nowIso,
} from "./utils";

const graphIndexByRoot = new Map<string, PersistentGraphIndexEntry>();

function createEmptyIndex(rootPath: string): PersistentGraphIndexMemory {
  return {
    version: INDEX_VERSION,
    rootPath,
    updatedAt: nowIso(),
    files: new Map<string, PersistentGraphFileRecord>(),
    fileCount: 0,
    symbolCount: 0,
    edgeCount: 0,
  };
}

function buildDefaultRefreshStats(mode: RefreshMode): PersistentGraphRefreshStats {
  return {
    mode,
    refreshedAtIso: nowIso(),
    scannedFiles: 0,
    parsedFiles: 0,
    reusedFiles: 0,
    removedFiles: 0,
  };
}

function setEntryIndex(entry: PersistentGraphIndexEntry, nextIndex: PersistentGraphIndexMemory): void {
  entry.index = nextIndex;
  entry.runtime = undefined;
  entry.runtimeFingerprint = "";
  entry.dependencyQueryCache.clear();
  entry.symbolQueryCache.clear();
}

export function refreshPersistentIndex(rootPath: string, forceRefresh: boolean): PersistentGraphIndexEntry {
  const existing = graphIndexByRoot.get(rootPath);
  if (!existing) {
    const loaded = loadPersistedIndex(rootPath) ?? createEmptyIndex(rootPath);
    const created: PersistentGraphIndexEntry = {
      index: loaded,
      runtimeFingerprint: "",
      lastRefreshAtMs: 0,
      lastRefreshStats: buildDefaultRefreshStats("cold"),
      dependencyQueryCache: new Map<string, PersistentGraphQueryCacheEntry>(),
      symbolQueryCache: new Map<string, PersistentGraphQueryCacheEntry>(),
    };
    graphIndexByRoot.set(rootPath, created);
  }
  const entry = graphIndexByRoot.get(rootPath) as PersistentGraphIndexEntry;
  const nowMs = Date.now();
  if (!forceRefresh && nowMs - entry.lastRefreshAtMs < REFRESH_MIN_INTERVAL_MS) {
    entry.lastRefreshStats = {
      ...entry.lastRefreshStats,
      mode: "skipped",
      refreshedAtIso: nowIso(),
    };
    return entry;
  }
  const previousRows = entry.index.files;
  const codePaths = collectRepositoryCodePaths(rootPath);
  const seen = new Set<string>();
  const nextRows = new Map<string, PersistentGraphFileRecord>();
  let parsedFiles = 0;
  let reusedFiles = 0;
  for (const codePath of codePaths) {
    const normalizedPath = normalizePath(codePath);
    const key = normalizePathLower(normalizedPath);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const absolutePath = resolve(rootPath, normalizedPath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const stats = readSafeFileStats(absolutePath);
    if (!stats || !stats.isFile) {
      continue;
    }
    const size = stats.size;
    const mtimeMs = stats.mtimeMs;
    const previous = previousRows.get(key);
    if (previous && previous.size === size && previous.mtimeMs === mtimeMs) {
      nextRows.set(key, previous);
      reusedFiles += 1;
      continue;
    }
    const parsed = parseCodeFile(rootPath, normalizedPath);
    if (parsed) {
      nextRows.set(key, parsed);
      parsedFiles += 1;
      continue;
    }
    if (previous) {
      nextRows.set(key, previous);
      reusedFiles += 1;
    }
  }
  const removedFiles = Math.max(0, previousRows.size - reusedFiles - parsedFiles);
  const allRows = Array.from(nextRows.values());
  const nextIndex: PersistentGraphIndexMemory = {
    version: INDEX_VERSION,
    rootPath,
    updatedAt: nowIso(),
    files: nextRows,
    fileCount: allRows.length,
    symbolCount: allRows.reduce((acc, row) => acc + row.symbols.length, 0),
    edgeCount: allRows.reduce((acc, row) => acc + row.imports.length, 0),
  };
  const hadPreviousRows = previousRows.size > 0;
  const hasDelta = parsedFiles > 0 || removedFiles > 0 || nextRows.size !== previousRows.size;
  const mode: RefreshMode = !hadPreviousRows ? "cold" : hasDelta ? "incremental" : "steady";
  setEntryIndex(entry, nextIndex);
  entry.lastRefreshAtMs = nowMs;
  entry.lastRefreshStats = {
    mode,
    refreshedAtIso: nowIso(),
    scannedFiles: codePaths.length,
    parsedFiles,
    reusedFiles,
    removedFiles,
  };
  appendWindowEntry(rootPath, {
    ts: entry.lastRefreshStats.refreshedAtIso,
    rootPath,
    mode,
    scannedFiles: codePaths.length,
    parsedFiles,
    reusedFiles,
    removedFiles,
    fileCount: nextIndex.fileCount,
    symbolCount: nextIndex.symbolCount,
    edgeCount: nextIndex.edgeCount,
  });
  if (hasDelta || !hadPreviousRows) {
    persistIndex(nextIndex);
  }
  return entry;
}

export function readGraphIndexByRoot(rootPath: string): PersistentGraphIndexEntry | undefined {
  return graphIndexByRoot.get(rootPath);
}
