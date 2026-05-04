import { retrieveDependencyGraphHints } from "../../../tools/context/graph/dependency-hints";
import { retrieveSymbolGraphHints } from "../../../tools/context/graph/symbol-hints";
import {
  queryPersistentDependencyHints,
  queryPersistentSymbolHints,
  readPersistentGraphIndexStatus,
} from "../../../tools/context/graph/persistent-index";
import {
  readContextGraphCacheStats,
  resetContextGraphCacheStats,
  type ContextGraphCacheStats,
} from "../../../tools/context/graph/cache-utils";
import { type ChangedCodeSnapshot } from "../../../tools/context/graph/changed-code-snapshot";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalStringArray(
  payload: Record<string, unknown>,
  key: string,
  maxItems: number,
): string[] {
  const raw = payload[key];
  if (!Array.isArray(raw)) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function readChangedCodeSnapshot(raw: unknown): ChangedCodeSnapshot {
  if (!isRecord(raw)) {
    throw new Error("payload.snapshot must be an object");
  }
  const rootPath = typeof raw.root_path === "string" ? raw.root_path.trim() : "";
  if (!rootPath) {
    throw new Error("payload.snapshot.root_path must be non-empty");
  }
  const filesRaw = Array.isArray(raw.files) ? raw.files : [];
  const files = filesRaw
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const path = typeof item.path === "string" ? item.path.trim() : "";
      const content = typeof item.content === "string" ? item.content : "";
      if (!path) {
        return null;
      }
      return {
        path,
        content,
      };
    })
    .filter((item): item is { path: string; content: string } => Boolean(item));
  return {
    rootPath,
    files,
  };
}

function readBucketStat(
  stats: Record<string, ContextGraphCacheStats>,
  bucket: string,
): ContextGraphCacheStats {
  const row = stats[bucket];
  if (!row) {
    return {
      hit: 0,
      miss: 0,
      write: 0,
      evict: 0,
    };
  }
  return {
    hit: row.hit,
    miss: row.miss,
    write: row.write,
    evict: row.evict,
  };
}

function summarizeDependencyRows(rows: readonly string[]): {
  total_rows: number;
  multi_hop_rows: number;
  max_chain_depth: number;
  depth_histogram: Record<string, number>;
  unique_nodes: number;
} {
  const depthHistogram = {
    depth_2: 0,
    depth_3: 0,
    depth_4_plus: 0,
  };
  let multiHopRows = 0;
  let maxChainDepth = 0;
  const uniqueNodes = new Set<string>();
  for (const row of rows) {
    const nodes = row
      .split("->")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (nodes.length < 2) {
      continue;
    }
    for (const node of nodes) {
      uniqueNodes.add(node.toLowerCase());
    }
    if (nodes.length >= 3) {
      multiHopRows += 1;
    }
    maxChainDepth = Math.max(maxChainDepth, nodes.length);
    if (nodes.length >= 4) {
      depthHistogram.depth_4_plus += 1;
    } else if (nodes.length === 3) {
      depthHistogram.depth_3 += 1;
    } else {
      depthHistogram.depth_2 += 1;
    }
  }
  return {
    total_rows: rows.length,
    multi_hop_rows: multiHopRows,
    max_chain_depth: maxChainDepth,
    depth_histogram: depthHistogram,
    unique_nodes: uniqueNodes.size,
  };
}

function summarizeSymbolRows(rows: readonly string[]): {
  total_rows: number;
  rows_with_bridge: number;
  rows_with_breadth: number;
  avg_bridge: number;
  avg_breadth: number;
  avg_refs: number;
  max_refs: number;
} {
  let rowsWithBridge = 0;
  let rowsWithBreadth = 0;
  let bridgeTotal = 0;
  let breadthTotal = 0;
  let refsTotal = 0;
  let refsCount = 0;
  let maxRefs = 0;
  for (const row of rows) {
    const bridgeMatch = row.match(/\bbridge=(\d+)\b/i);
    const breadthMatch = row.match(/\bbreadth=(\d+)\b/i);
    const refsMatch = row.match(/\brefs=(\d+)\b/i);
    if (bridgeMatch) {
      const value = Number.parseInt(bridgeMatch[1] ?? "0", 10);
      if (Number.isFinite(value)) {
        bridgeTotal += Math.max(0, value);
        rowsWithBridge += 1;
      }
    }
    if (breadthMatch) {
      const value = Number.parseInt(breadthMatch[1] ?? "0", 10);
      if (Number.isFinite(value)) {
        breadthTotal += Math.max(0, value);
        rowsWithBreadth += 1;
      }
    }
    if (refsMatch) {
      const value = Number.parseInt(refsMatch[1] ?? "0", 10);
      if (Number.isFinite(value)) {
        const normalized = Math.max(0, value);
        refsTotal += normalized;
        refsCount += 1;
        maxRefs = Math.max(maxRefs, normalized);
      }
    }
  }
  return {
    total_rows: rows.length,
    rows_with_bridge: rowsWithBridge,
    rows_with_breadth: rowsWithBreadth,
    avg_bridge: rowsWithBridge > 0 ? bridgeTotal / rowsWithBridge : 0,
    avg_breadth: rowsWithBreadth > 0 ? breadthTotal / rowsWithBreadth : 0,
    avg_refs: refsCount > 0 ? refsTotal / refsCount : 0,
    max_refs: maxRefs,
  };
}

export function runGraphCache(payload: Record<string, unknown>): Record<string, unknown> {
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    throw new Error("payload.query must be non-empty");
  }
  const maxRows = typeof payload.max_rows === "number" && Number.isFinite(payload.max_rows)
    ? Math.max(1, Math.min(20, Math.floor(payload.max_rows)))
    : 4;
  const snapshot = readChangedCodeSnapshot(payload.snapshot);
  resetContextGraphCacheStats();
  const firstStartedAtMs = Date.now();
  const firstSymbolRows = retrieveSymbolGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const firstDependencyRows = retrieveDependencyGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const firstDurationMs = Math.max(0, Date.now() - firstStartedAtMs);
  const firstStats = readContextGraphCacheStats();
  const secondStartedAtMs = Date.now();
  const secondSymbolRows = retrieveSymbolGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const secondDependencyRows = retrieveDependencyGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const secondDurationMs = Math.max(0, Date.now() - secondStartedAtMs);
  const secondStats = readContextGraphCacheStats();
  const firstSymbolQuery = readBucketStat(firstStats, "symbol_query");
  const firstDependencyQuery = readBucketStat(firstStats, "dependency_query");
  const secondSymbolQuery = readBucketStat(secondStats, "symbol_query");
  const secondDependencyQuery = readBucketStat(secondStats, "dependency_query");
  const firstQuality = {
    dependency: summarizeDependencyRows(firstDependencyRows),
    symbol: summarizeSymbolRows(firstSymbolRows),
  };
  const secondQuality = {
    dependency: summarizeDependencyRows(secondDependencyRows),
    symbol: summarizeSymbolRows(secondSymbolRows),
  };
  return {
    timing: {
      first_pass_duration_ms: firstDurationMs,
      second_pass_duration_ms: secondDurationMs,
    },
    cache_reuse_observed:
      secondSymbolQuery.hit > firstSymbolQuery.hit
      && secondDependencyQuery.hit > firstDependencyQuery.hit,
    first_pass: {
      symbol_rows: firstSymbolRows,
      dependency_rows: firstDependencyRows,
      quality: firstQuality,
      stats: {
        symbol_query: firstSymbolQuery,
        symbol_declaration: readBucketStat(firstStats, "symbol_declaration"),
        dependency_query: firstDependencyQuery,
        dependency_import: readBucketStat(firstStats, "dependency_import"),
      },
    },
    second_pass: {
      symbol_rows: secondSymbolRows,
      dependency_rows: secondDependencyRows,
      quality: secondQuality,
      stats: {
        symbol_query: secondSymbolQuery,
        symbol_declaration: readBucketStat(secondStats, "symbol_declaration"),
        dependency_query: secondDependencyQuery,
        dependency_import: readBucketStat(secondStats, "dependency_import"),
      },
    },
  };
}

export function runGraphCacheHotLoop(payload: Record<string, unknown>): Record<string, unknown> {
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    throw new Error("payload.query must be non-empty");
  }
  const maxRows = typeof payload.max_rows === "number" && Number.isFinite(payload.max_rows)
    ? Math.max(1, Math.min(20, Math.floor(payload.max_rows)))
    : 4;
  const repeat = typeof payload.repeat === "number" && Number.isFinite(payload.repeat)
    ? Math.max(3, Math.min(24, Math.floor(payload.repeat)))
    : 8;
  const burst = typeof payload.burst === "number" && Number.isFinite(payload.burst)
    ? Math.max(1, Math.min(32, Math.floor(payload.burst)))
    : 1;
  const snapshot = readChangedCodeSnapshot(payload.snapshot);
  resetContextGraphCacheStats();
  const turns: Array<{
    turn: number;
    burst: number;
    duration_ms: number;
    rows_consistent: boolean;
    symbol_query: ContextGraphCacheStats;
    dependency_query: ContextGraphCacheStats;
  }> = [];
  let firstSymbolRows: string[] = [];
  let firstDependencyRows: string[] = [];
  let lastSymbolRows: string[] = [];
  let lastDependencyRows: string[] = [];
  for (let turn = 1; turn <= repeat; turn += 1) {
    const startedAtMs = Date.now();
    let symbolRows: string[] = [];
    let dependencyRows: string[] = [];
    let rowsConsistent = true;
    for (let burstIndex = 0; burstIndex < burst; burstIndex += 1) {
      const currentSymbolRows = retrieveSymbolGraphHints(query, {
        maxRows,
        changedCodeSnapshot: snapshot,
      });
      const currentDependencyRows = retrieveDependencyGraphHints(query, {
        maxRows,
        changedCodeSnapshot: snapshot,
      });
      if (burstIndex === 0) {
        symbolRows = currentSymbolRows;
        dependencyRows = currentDependencyRows;
        continue;
      }
      if (
        rowsConsistent
        && (
          JSON.stringify(symbolRows) !== JSON.stringify(currentSymbolRows)
          || JSON.stringify(dependencyRows) !== JSON.stringify(currentDependencyRows)
        )
      ) {
        rowsConsistent = false;
      }
    }
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    const stats = readContextGraphCacheStats();
    const symbolQuery = readBucketStat(stats, "symbol_query");
    const dependencyQuery = readBucketStat(stats, "dependency_query");
    if (turn === 1) {
      firstSymbolRows = symbolRows;
      firstDependencyRows = dependencyRows;
    }
    lastSymbolRows = symbolRows;
    lastDependencyRows = dependencyRows;
    turns.push({
      turn,
      burst,
      duration_ms: durationMs,
      rows_consistent: rowsConsistent,
      symbol_query: symbolQuery,
      dependency_query: dependencyQuery,
    });
  }
  const firstTurn = turns[0] ?? {
    symbol_query: { hit: 0, miss: 0, write: 0, evict: 0 },
    dependency_query: { hit: 0, miss: 0, write: 0, evict: 0 },
  };
  const lastTurn = turns[turns.length - 1] ?? firstTurn;
  return {
    repeat,
    burst,
    cache_reuse_observed:
      lastTurn.symbol_query.hit > firstTurn.symbol_query.hit
      && lastTurn.dependency_query.hit > firstTurn.dependency_query.hit,
    first_rows: {
      symbol_rows: firstSymbolRows,
      dependency_rows: firstDependencyRows,
    },
    last_rows: {
      symbol_rows: lastSymbolRows,
      dependency_rows: lastDependencyRows,
    },
    turns,
  };
}

export function runGraphPersistentIndex(payload: Record<string, unknown>): Record<string, unknown> {
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    throw new Error("payload.query must be non-empty");
  }
  const workDir = typeof payload.work_dir === "string" ? payload.work_dir.trim() : "";
  if (!workDir) {
    throw new Error("payload.work_dir must be non-empty");
  }
  const maxRows = typeof payload.max_rows === "number" && Number.isFinite(payload.max_rows)
    ? Math.max(1, Math.min(20, Math.floor(payload.max_rows)))
    : 4;
  const windowSize = typeof payload.window_size === "number" && Number.isFinite(payload.window_size)
    ? Math.max(1, Math.min(200, Math.floor(payload.window_size)))
    : 20;
  const extraWorkDirs = readOptionalStringArray(payload, "extra_work_dirs", 6)
    .filter((extraWorkDir) => extraWorkDir !== workDir);
  const firstDependencyRows = queryPersistentDependencyHints(query, {
    workDir,
    maxRows,
    forceRefresh: true,
  });
  const firstStatus = readPersistentGraphIndexStatus({
    workDir,
    windowSize,
  });
  const firstSymbolRows = queryPersistentSymbolHints(query, {
    workDir,
    maxRows,
  });
  const secondDependencyRows = queryPersistentDependencyHints(query, {
    workDir,
    maxRows,
  });
  const secondSymbolRows = queryPersistentSymbolHints(query, {
    workDir,
    maxRows,
  });
  const secondStatus = readPersistentGraphIndexStatus({
    workDir,
    windowSize,
  });
  const extraRoots = extraWorkDirs.map((extraWorkDir) => {
    const dependencyRows = queryPersistentDependencyHints(query, {
      workDir: extraWorkDir,
      maxRows,
      forceRefresh: true,
    });
    const symbolRows = queryPersistentSymbolHints(query, {
      workDir: extraWorkDir,
      maxRows,
    });
    const status = readPersistentGraphIndexStatus({
      workDir: extraWorkDir,
      windowSize,
    });
    return {
      work_dir: extraWorkDir,
      dependency_rows: dependencyRows,
      symbol_rows: symbolRows,
      quality: {
        dependency: summarizeDependencyRows(dependencyRows),
        symbol: summarizeSymbolRows(symbolRows),
      },
      status,
    };
  });
  return {
    cache_reuse_observed:
      JSON.stringify(firstDependencyRows) === JSON.stringify(secondDependencyRows)
      && JSON.stringify(firstSymbolRows) === JSON.stringify(secondSymbolRows),
    cross_repo_observed: extraRoots.some(
      (root) => root.dependency_rows.length > 0 || root.symbol_rows.length > 0,
    ),
    extra_roots: extraRoots,
    first_pass: {
      dependency_rows: firstDependencyRows,
      symbol_rows: firstSymbolRows,
      quality: {
        dependency: summarizeDependencyRows(firstDependencyRows),
        symbol: summarizeSymbolRows(firstSymbolRows),
      },
      status: firstStatus,
    },
    second_pass: {
      dependency_rows: secondDependencyRows,
      symbol_rows: secondSymbolRows,
      quality: {
        dependency: summarizeDependencyRows(secondDependencyRows),
        symbol: summarizeSymbolRows(secondSymbolRows),
      },
      status: secondStatus,
    },
  };
}
