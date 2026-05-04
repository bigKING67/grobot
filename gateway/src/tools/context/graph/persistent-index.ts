import { refreshPersistentIndex, readGraphIndexByRoot } from "./persistent-index/refresh";
import { queryDependencyHintsWithEntry } from "./persistent-index/dependency-query";
import { querySymbolHintsWithEntry } from "./persistent-index/symbol-query";
import { readIndexPath, readWindowSummary } from "./persistent-index/storage";
import {
  clampInteger,
  resolveGitRootForContext,
} from "./persistent-index/utils";
import type {
  PersistentGraphIndexEntry,
  RefreshMode,
} from "./persistent-index/contract";

function ensureIndexEntry(workDir?: string, forceRefresh = false): PersistentGraphIndexEntry | undefined {
  const rootPath = resolveGitRootForContext(workDir);
  if (!rootPath) {
    return undefined;
  }
  return refreshPersistentIndex(rootPath, forceRefresh);
}

function resolveIndexEntryForStatus(workDir?: string, forceRefresh = false): PersistentGraphIndexEntry | undefined {
  const rootPath = resolveGitRootForContext(workDir);
  if (!rootPath) {
    return undefined;
  }
  if (forceRefresh) {
    return refreshPersistentIndex(rootPath, true);
  }
  const existing = readGraphIndexByRoot(rootPath);
  if (existing) {
    return existing;
  }
  return refreshPersistentIndex(rootPath, true);
}

export function queryPersistentDependencyHints(
  query: string,
  options: {
    workDir?: string;
    maxRows?: number;
    forceRefresh?: boolean;
  } = {},
): string[] {
  const entry = ensureIndexEntry(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return [];
  }
  return queryDependencyHintsWithEntry(entry, query, options.maxRows);
}

export function queryPersistentSymbolHints(
  query: string,
  options: {
    workDir?: string;
    maxRows?: number;
    forceRefresh?: boolean;
  } = {},
): string[] {
  const entry = ensureIndexEntry(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return [];
  }
  return querySymbolHintsWithEntry(entry, query, options.maxRows);
}

export function readPersistentGraphIndexStatus(
  options: {
    workDir?: string;
    forceRefresh?: boolean;
    windowSize?: number;
  } = {},
): {
  enabled: boolean;
  root_path?: string;
  index_path?: string;
  version?: number;
  updated_at?: string;
  file_count?: number;
  symbol_count?: number;
  edge_count?: number;
  last_refresh?: {
    mode: RefreshMode;
    refreshed_at: string;
    scanned_files: number;
    parsed_files: number;
    reused_files: number;
    removed_files: number;
  };
  window?: {
    path: string;
    configured_size: number;
    entries: number;
    from_ts: string | null;
    to_ts: string | null;
    mode_counts: Record<RefreshMode, number>;
    totals: {
      scanned_files: number;
      parsed_files: number;
      reused_files: number;
      removed_files: number;
    };
    rates: {
      parsed_per_scanned: number | null;
      reused_per_scanned: number | null;
      removed_per_scanned: number | null;
    };
    latest: {
      mode: RefreshMode;
      scanned_files: number;
      parsed_files: number;
      reused_files: number;
      removed_files: number;
      file_count: number;
      symbol_count: number;
      edge_count: number;
    } | null;
  };
} {
  const entry = resolveIndexEntryForStatus(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return { enabled: false };
  }
  const refresh = entry.lastRefreshStats;
  const window = readWindowSummary(entry.index.rootPath, options.windowSize);
  return {
    enabled: true,
    root_path: entry.index.rootPath,
    index_path: readIndexPath(entry.index.rootPath),
    version: entry.index.version,
    updated_at: entry.index.updatedAt,
    file_count: entry.index.fileCount,
    symbol_count: entry.index.symbolCount,
    edge_count: entry.index.edgeCount,
    last_refresh: {
      mode: refresh.mode,
      refreshed_at: refresh.refreshedAtIso,
      scanned_files: refresh.scannedFiles,
      parsed_files: refresh.parsedFiles,
      reused_files: refresh.reusedFiles,
      removed_files: refresh.removedFiles,
    },
    window: {
      path: window.path,
      configured_size: window.configuredSize,
      entries: window.entries,
      from_ts: window.fromTs,
      to_ts: window.toTs,
      mode_counts: window.modeCounts,
      totals: {
        scanned_files: window.totals.scannedFiles,
        parsed_files: window.totals.parsedFiles,
        reused_files: window.totals.reusedFiles,
        removed_files: window.totals.removedFiles,
      },
      rates: {
        parsed_per_scanned: window.rates.parsedPerScanned,
        reused_per_scanned: window.rates.reusedPerScanned,
        removed_per_scanned: window.rates.removedPerScanned,
      },
      latest: window.latest == null
        ? null
        : {
          mode: window.latest.mode,
          scanned_files: window.latest.scannedFiles,
          parsed_files: window.latest.parsedFiles,
          reused_files: window.latest.reusedFiles,
          removed_files: window.latest.removedFiles,
          file_count: window.latest.fileCount,
          symbol_count: window.latest.symbolCount,
          edge_count: window.latest.edgeCount,
        },
    },
  };
}

export function readPersistentGraphIndexWindowSummary(
  options: {
    workDir?: string;
    size?: number;
    forceRefresh?: boolean;
  } = {},
): {
  enabled: boolean;
  root_path?: string;
  path?: string;
  configured_size?: number;
  entries?: number;
  from_ts?: string | null;
  to_ts?: string | null;
  mode_counts?: Record<RefreshMode, number>;
  totals?: {
    scanned_files: number;
    parsed_files: number;
    reused_files: number;
    removed_files: number;
  };
  rates?: {
    parsed_per_scanned: number | null;
    reused_per_scanned: number | null;
    removed_per_scanned: number | null;
  };
  latest?: {
    mode: RefreshMode;
    scanned_files: number;
    parsed_files: number;
    reused_files: number;
    removed_files: number;
    file_count: number;
    symbol_count: number;
    edge_count: number;
  } | null;
} {
  const entry = resolveIndexEntryForStatus(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return { enabled: false };
  }
  const window = readWindowSummary(
    entry.index.rootPath,
    clampInteger(options.size ?? 20, 20, 1, 200),
  );
  return {
    enabled: true,
    root_path: entry.index.rootPath,
    path: window.path,
    configured_size: window.configuredSize,
    entries: window.entries,
    from_ts: window.fromTs,
    to_ts: window.toTs,
    mode_counts: window.modeCounts,
    totals: {
      scanned_files: window.totals.scannedFiles,
      parsed_files: window.totals.parsedFiles,
      reused_files: window.totals.reusedFiles,
      removed_files: window.totals.removedFiles,
    },
    rates: {
      parsed_per_scanned: window.rates.parsedPerScanned,
      reused_per_scanned: window.rates.reusedPerScanned,
      removed_per_scanned: window.rates.removedPerScanned,
    },
    latest: window.latest == null
      ? null
      : {
        mode: window.latest.mode,
        scanned_files: window.latest.scannedFiles,
        parsed_files: window.latest.parsedFiles,
        reused_files: window.latest.reusedFiles,
        removed_files: window.latest.removedFiles,
        file_count: window.latest.fileCount,
        symbol_count: window.latest.symbolCount,
        edge_count: window.latest.edgeCount,
      },
  };
}

export type {
  RefreshMode,
};
