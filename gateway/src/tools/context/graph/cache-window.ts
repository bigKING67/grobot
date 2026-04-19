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
import { resolveContextStoragePath } from "../storage-boundary";

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

export interface GraphCacheWindowDependencyQuality {
  rows: number;
  multiHopRows: number;
  depth4PlusRows: number;
  maxChainDepth: number;
}

export interface GraphCacheWindowSymbolQuality {
  rows: number;
  rowsWithBridge: number;
  rowsWithBreadth: number;
  bridgeTotal: number;
  breadthTotal: number;
  refsTotal: number;
  refsCount: number;
  maxRefs: number;
}

export interface GraphCacheWindowTurnQuality {
  dependency: GraphCacheWindowDependencyQuality;
  symbol: GraphCacheWindowSymbolQuality;
}

export interface GraphCacheWindowTurnEntry {
  ts: string;
  sessionKey: string;
  stage: string;
  selectionReason: string;
  delta: GraphCacheWindowBucketSet;
  total: GraphCacheWindowBucketSet;
  quality?: GraphCacheWindowTurnQuality;
}

export interface GraphCacheWindowQualitySummary {
  entriesWithQuality: number;
  dependency: {
    avgRows: number | null;
    avgMultiHopRows: number | null;
    avgMaxChainDepth: number | null;
    multiHopRate: number | null;
    depth4PlusRate: number | null;
  };
  symbol: {
    avgRows: number | null;
    bridgeCoverageRate: number | null;
    breadthCoverageRate: number | null;
    avgBridge: number | null;
    avgBreadth: number | null;
    avgRefs: number | null;
    maxRefs: number | null;
  };
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
  quality: GraphCacheWindowQualitySummary;
}

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

function createEmptyDependencyQuality(): GraphCacheWindowDependencyQuality {
  return {
    rows: 0,
    multiHopRows: 0,
    depth4PlusRows: 0,
    maxChainDepth: 0,
  };
}

function createEmptySymbolQuality(): GraphCacheWindowSymbolQuality {
  return {
    rows: 0,
    rowsWithBridge: 0,
    rowsWithBreadth: 0,
    bridgeTotal: 0,
    breadthTotal: 0,
    refsTotal: 0,
    refsCount: 0,
    maxRefs: 0,
  };
}

function createEmptyTurnQuality(): GraphCacheWindowTurnQuality {
  return {
    dependency: createEmptyDependencyQuality(),
    symbol: createEmptySymbolQuality(),
  };
}

function parseNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function parseNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
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

function normalizeTurnQuality(raw: unknown): GraphCacheWindowTurnQuality | undefined {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined;
  }
  const row = raw as Record<string, unknown>;
  const dependencyRaw = typeof row.dependency === "object" && row.dependency != null && !Array.isArray(row.dependency)
    ? row.dependency as Record<string, unknown>
    : null;
  const symbolRaw = typeof row.symbol === "object" && row.symbol != null && !Array.isArray(row.symbol)
    ? row.symbol as Record<string, unknown>
    : null;
  if (!dependencyRaw && !symbolRaw) {
    return undefined;
  }
  const dependency = createEmptyDependencyQuality();
  const symbol = createEmptySymbolQuality();
  if (dependencyRaw) {
    dependency.rows = parseNonNegativeInteger(dependencyRaw.rows);
    dependency.multiHopRows = parseNonNegativeInteger(dependencyRaw.multiHopRows);
    dependency.depth4PlusRows = parseNonNegativeInteger(dependencyRaw.depth4PlusRows);
    dependency.maxChainDepth = parseNonNegativeInteger(dependencyRaw.maxChainDepth);
  }
  if (symbolRaw) {
    symbol.rows = parseNonNegativeInteger(symbolRaw.rows);
    symbol.rowsWithBridge = parseNonNegativeInteger(symbolRaw.rowsWithBridge);
    symbol.rowsWithBreadth = parseNonNegativeInteger(symbolRaw.rowsWithBreadth);
    symbol.bridgeTotal = parseNonNegativeNumber(symbolRaw.bridgeTotal);
    symbol.breadthTotal = parseNonNegativeNumber(symbolRaw.breadthTotal);
    symbol.refsTotal = parseNonNegativeNumber(symbolRaw.refsTotal);
    symbol.refsCount = parseNonNegativeInteger(symbolRaw.refsCount);
    symbol.maxRefs = parseNonNegativeInteger(symbolRaw.maxRefs);
  }
  return {
    dependency,
    symbol,
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
    quality: normalizeTurnQuality(row.quality),
  };
}

function normalizeWindowSize(raw: number | undefined, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(256, Math.max(1, Math.floor(raw)));
}

function resolveWindowPath(workDir: string): string {
  return resolveContextStoragePath(workDir, "graph_cache_window");
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

function computeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function parseMetricValue(row: string, key: string): number {
  const match = row.match(new RegExp(`\\b${key}=(\\d+)\\b`, "i"));
  if (!match) {
    return 0;
  }
  const parsed = Number.parseInt(match[1] ?? "0", 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, parsed);
}

function parseSectionRowsFromPrompt(prompt: string, sectionTitle: string): string[] {
  const lines = prompt.split(/\r?\n/);
  const normalizedTarget = sectionTitle.trim().toLowerCase();
  const output: string[] = [];
  let inSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inSection) {
      if (/^\[[^\]]+\]$/.test(line)) {
        const title = line.slice(1, -1).trim().toLowerCase();
        if (title === normalizedTarget) {
          inSection = true;
        }
      }
      continue;
    }
    if (/^\[[^\]]+\]$/.test(line)) {
      break;
    }
    const bulletMatch = line.match(/^-+\s*(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    const value = String(bulletMatch[1] ?? "").trim();
    if (!value || value === "(none)") {
      continue;
    }
    output.push(value);
  }
  return output;
}

export function summarizeGraphHintQuality(args: {
  dependencyRows: readonly string[];
  symbolRows: readonly string[];
}): GraphCacheWindowTurnQuality {
  const dependency = createEmptyDependencyQuality();
  for (const row of args.dependencyRows) {
    const depth = row
      .split("->")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .length;
    if (depth < 2) {
      continue;
    }
    dependency.rows += 1;
    dependency.maxChainDepth = Math.max(dependency.maxChainDepth, depth);
    if (depth >= 3) {
      dependency.multiHopRows += 1;
    }
    if (depth >= 4) {
      dependency.depth4PlusRows += 1;
    }
  }
  const symbol = createEmptySymbolQuality();
  for (const row of args.symbolRows) {
    symbol.rows += 1;
    const bridge = parseMetricValue(row, "bridge");
    const breadth = parseMetricValue(row, "breadth");
    const refs = parseMetricValue(row, "refs");
    if (bridge > 0) {
      symbol.rowsWithBridge += 1;
      symbol.bridgeTotal += bridge;
    }
    if (breadth > 0) {
      symbol.rowsWithBreadth += 1;
      symbol.breadthTotal += breadth;
    }
    if (refs > 0) {
      symbol.refsTotal += refs;
      symbol.refsCount += 1;
      symbol.maxRefs = Math.max(symbol.maxRefs, refs);
    }
  }
  return {
    dependency,
    symbol,
  };
}

export function summarizeGraphHintQualityFromPrompt(prompt: string): GraphCacheWindowTurnQuality {
  const dependencyRows = parseSectionRowsFromPrompt(prompt, "Dependency graph hints");
  const symbolRows = parseSectionRowsFromPrompt(prompt, "Symbol graph hints");
  return summarizeGraphHintQuality({
    dependencyRows,
    symbolRows,
  });
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
  const qualityAccumulator = {
    entriesWithQuality: 0,
    dependencyRowsTotal: 0,
    dependencyMultiHopRowsTotal: 0,
    dependencyDepth4PlusRowsTotal: 0,
    dependencyMaxDepthTotal: 0,
    symbolRowsTotal: 0,
    symbolRowsWithBridgeTotal: 0,
    symbolRowsWithBreadthTotal: 0,
    symbolBridgeTotal: 0,
    symbolBreadthTotal: 0,
    symbolRefsTotal: 0,
    symbolRefsCountTotal: 0,
    symbolMaxRefs: 0,
  };
  for (const row of entries) {
    if (!row.quality) {
      continue;
    }
    qualityAccumulator.entriesWithQuality += 1;
    qualityAccumulator.dependencyRowsTotal += row.quality.dependency.rows;
    qualityAccumulator.dependencyMultiHopRowsTotal += row.quality.dependency.multiHopRows;
    qualityAccumulator.dependencyDepth4PlusRowsTotal += row.quality.dependency.depth4PlusRows;
    qualityAccumulator.dependencyMaxDepthTotal += row.quality.dependency.maxChainDepth;
    qualityAccumulator.symbolRowsTotal += row.quality.symbol.rows;
    qualityAccumulator.symbolRowsWithBridgeTotal += row.quality.symbol.rowsWithBridge;
    qualityAccumulator.symbolRowsWithBreadthTotal += row.quality.symbol.rowsWithBreadth;
    qualityAccumulator.symbolBridgeTotal += row.quality.symbol.bridgeTotal;
    qualityAccumulator.symbolBreadthTotal += row.quality.symbol.breadthTotal;
    qualityAccumulator.symbolRefsTotal += row.quality.symbol.refsTotal;
    qualityAccumulator.symbolRefsCountTotal += row.quality.symbol.refsCount;
    qualityAccumulator.symbolMaxRefs = Math.max(
      qualityAccumulator.symbolMaxRefs,
      row.quality.symbol.maxRefs,
    );
  }
  const quality: GraphCacheWindowQualitySummary = {
    entriesWithQuality: qualityAccumulator.entriesWithQuality,
    dependency: {
      avgRows: qualityAccumulator.entriesWithQuality > 0
        ? qualityAccumulator.dependencyRowsTotal / qualityAccumulator.entriesWithQuality
        : null,
      avgMultiHopRows: qualityAccumulator.entriesWithQuality > 0
        ? qualityAccumulator.dependencyMultiHopRowsTotal / qualityAccumulator.entriesWithQuality
        : null,
      avgMaxChainDepth: qualityAccumulator.entriesWithQuality > 0
        ? qualityAccumulator.dependencyMaxDepthTotal / qualityAccumulator.entriesWithQuality
        : null,
      multiHopRate: computeRatio(
        qualityAccumulator.dependencyMultiHopRowsTotal,
        qualityAccumulator.dependencyRowsTotal,
      ),
      depth4PlusRate: computeRatio(
        qualityAccumulator.dependencyDepth4PlusRowsTotal,
        qualityAccumulator.dependencyRowsTotal,
      ),
    },
    symbol: {
      avgRows: qualityAccumulator.entriesWithQuality > 0
        ? qualityAccumulator.symbolRowsTotal / qualityAccumulator.entriesWithQuality
        : null,
      bridgeCoverageRate: computeRatio(
        qualityAccumulator.symbolRowsWithBridgeTotal,
        qualityAccumulator.symbolRowsTotal,
      ),
      breadthCoverageRate: computeRatio(
        qualityAccumulator.symbolRowsWithBreadthTotal,
        qualityAccumulator.symbolRowsTotal,
      ),
      avgBridge: computeRatio(
        qualityAccumulator.symbolBridgeTotal,
        qualityAccumulator.symbolRowsWithBridgeTotal,
      ),
      avgBreadth: computeRatio(
        qualityAccumulator.symbolBreadthTotal,
        qualityAccumulator.symbolRowsWithBreadthTotal,
      ),
      avgRefs: computeRatio(
        qualityAccumulator.symbolRefsTotal,
        qualityAccumulator.symbolRefsCountTotal,
      ),
      maxRefs: qualityAccumulator.entriesWithQuality > 0
        ? qualityAccumulator.symbolMaxRefs
        : null,
    },
  };
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
    quality,
  };
}
