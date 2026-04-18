import { resolve } from "node:path";
import { getChangedCodeSnapshot, type ChangedCodeSnapshot } from "./changed-code-snapshot";
import { extractTypeScriptAstDependencyTargets } from "./dependency-ts-ast";
import { extractTypeScriptAstSymbols } from "./symbol-ts-ast";
import {
  computeSnapshotFingerprint,
  hashContentFNV,
  normalizeQueryKey,
  readContextGraphCacheStatsBucket,
  recordContextGraphCacheEvict,
  recordContextGraphCacheHit,
  recordContextGraphCacheMiss,
  recordContextGraphCacheWrite,
  setLruCacheEntry,
} from "./cache-utils";

interface RetrieveSymbolGraphHintsOptions {
  workDir?: string;
  maxRows?: number;
  changedCodeSnapshot?: ChangedCodeSnapshot;
}

interface SymbolDeclaration {
  symbol: string;
  kind: string;
  filePath: string;
  line: number;
}

interface SymbolRankRow {
  score: number;
  line: string;
}

interface SymbolQueryCacheEntry {
  expiresAtMs: number;
  snapshotFingerprint: string;
  rows: string[];
}

const QUERY_CACHE_TTL_MS = 2_000;
const MAX_QUERY_CACHE_ENTRIES = 256;
const MAX_QUERY_CACHE_ROWS = 80;
const MAX_DECLARATION_CACHE_ENTRIES = 640;

const symbolQueryCache = new Map<string, SymbolQueryCacheEntry>();
const symbolDeclarationCache = new Map<string, SymbolDeclaration[]>();
const SYMBOL_QUERY_CACHE_BUCKET = "symbol_query";
const SYMBOL_DECLARATION_CACHE_BUCKET = "symbol_declaration";

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function tokenizeIdentifier(raw: string): string[] {
  const compact = raw.trim();
  if (!compact) {
    return [];
  }
  const spaced = compact.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const tokens = [...tokenize(compact), ...tokenize(spaced)];
  return Array.from(new Set(tokens));
}

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function getDirPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function resolveRelativeImportInSnapshot(
  fromPath: string,
  importPath: string,
  snapshotPathSet: ReadonlySet<string>,
): string | undefined {
  if (!importPath.startsWith(".")) {
    return undefined;
  }
  const baseDir = getDirPath(fromPath);
  const resolvedBase = normalizePath(resolve("/", baseDir, importPath)).replace(/^\//, "");
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`,
    `${resolvedBase}.mjs`,
    `${resolvedBase}.cjs`,
    `${resolvedBase}.py`,
    `${resolvedBase}.rs`,
    `${resolvedBase}.go`,
    `${resolvedBase}.java`,
    `${resolvedBase}/index.ts`,
    `${resolvedBase}/index.tsx`,
    `${resolvedBase}/index.js`,
    `${resolvedBase}/index.mjs`,
    `${resolvedBase}/index.py`,
    `${resolvedBase}/mod.rs`,
  ];
  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);
    if (!normalized) {
      continue;
    }
    if (snapshotPathSet.has(normalized.toLowerCase())) {
      return normalized;
    }
  }
  return undefined;
}

function extractRegexImports(content: string): string[] {
  const rows: string[] = [];
  const push = (value: string): void => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    rows.push(normalized);
  };
  const esmRegex = /from\s+["']([^"']+)["']/g;
  let esmMatch: RegExpExecArray | null = esmRegex.exec(content);
  while (esmMatch) {
    if (typeof esmMatch[1] === "string") {
      push(esmMatch[1]);
    }
    esmMatch = esmRegex.exec(content);
  }
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
  let requireMatch: RegExpExecArray | null = requireRegex.exec(content);
  while (requireMatch) {
    if (typeof requireMatch[1] === "string") {
      push(requireMatch[1]);
    }
    requireMatch = requireRegex.exec(content);
  }
  return rows.slice(0, 120);
}

function dedupeStrings(rows: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const normalized = row.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= 160) {
      break;
    }
  }
  return output;
}

function extractImportTargets(
  filePath: string,
  content: string,
  snapshotPathSet: ReadonlySet<string>,
): string[] {
  const astTargets = extractTypeScriptAstDependencyTargets(filePath, content);
  const rawTargets = astTargets.length > 0 ? astTargets : extractRegexImports(content);
  const resolved = rawTargets.map((row) => {
    const normalized = normalizePath(row);
    const resolvedRelative = resolveRelativeImportInSnapshot(filePath, normalized, snapshotPathSet);
    if (resolvedRelative) {
      return resolvedRelative;
    }
    return normalized;
  });
  return dedupeStrings(resolved);
}

function buildFileImportGraph(
  snapshot: ChangedCodeSnapshot,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const snapshotPathSet = new Set(snapshot.files.map((file) => normalizePath(file.path).toLowerCase()));
  for (const file of snapshot.files) {
    const fromPath = normalizePath(file.path);
    const targets = extractImportTargets(file.path, file.content, snapshotPathSet)
      .filter((target) => snapshotPathSet.has(target.toLowerCase()))
      .slice(0, 80);
    graph.set(fromPath, new Set(targets));
  }
  return graph;
}

function toPathCluster(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter((item) => item.length > 0);
  if (parts.length <= 1) {
    return normalized || "__root__";
  }
  return `${parts[0]}/${parts[1]}`;
}

function extractPathHints(raw: string): string[] {
  const matched = raw.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g) ?? [];
  return dedupeStrings(matched.map((row) => normalizePath(row).replace(/:(\d+)(?::\d+)?$/, "")));
}

function isPathOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left).toLowerCase();
  const normalizedRight = normalizePath(right).toLowerCase();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  return normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function buildLineStartOffsets(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function resolveLineNumber(lineStarts: readonly number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle] ?? 0;
    const next = middle + 1 < lineStarts.length
      ? lineStarts[middle + 1] ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
    if (index >= start && index < next) {
      return middle + 1;
    }
    if (index < start) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return 1;
}

function addByRegex(
  rows: SymbolDeclaration[],
  filePath: string,
  lineStarts: readonly number[],
  content: string,
  regex: RegExp,
  kind: string,
): void {
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    const symbolRaw = String(match[1] ?? "").trim();
    const symbol = symbolRaw.replace(/[^A-Za-z0-9_$]/g, "");
    if (symbol.length >= 2) {
      const line = resolveLineNumber(lineStarts, match.index);
      rows.push({
        symbol,
        kind,
        filePath,
        line,
      });
    }
    match = regex.exec(content);
  }
}

function dedupeDeclarations(rows: readonly SymbolDeclaration[]): SymbolDeclaration[] {
  const dedup = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.filePath}::${row.kind}::${row.symbol}::${String(row.line)}`;
    if (dedup.has(key)) {
      return false;
    }
    dedup.add(key);
    return true;
  }).slice(0, 200);
}

function extractRegexSymbolDeclarations(filePath: string, content: string): SymbolDeclaration[] {
  const rows: SymbolDeclaration[] = [];
  const lineStarts = buildLineStartOffsets(content);
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g, "fn");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "class");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "interface");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "type");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g, "const-fn");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/g, "class");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "struct");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "enum");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "trait");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  addByRegex(rows, filePath, lineStarts, content, /(?:^|\n)\s*(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "type");
  return dedupeDeclarations(rows);
}

function extractSymbolDeclarations(filePath: string, content: string): SymbolDeclaration[] {
  const astRows = extractTypeScriptAstSymbols(filePath, content).map((row) => ({
    symbol: row.symbol,
    kind: row.kind,
    filePath,
    line: row.line,
  }));
  if (astRows.length > 0) {
    return dedupeDeclarations(astRows);
  }
  return extractRegexSymbolDeclarations(filePath, content);
}

function getDeclarationCacheKey(filePath: string, content: string): string {
  return `${filePath}::${String(content.length)}::${hashContentFNV(content)}`;
}

function extractSymbolDeclarationsWithCache(filePath: string, content: string): SymbolDeclaration[] {
  const cacheKey = getDeclarationCacheKey(filePath, content);
  const cached = symbolDeclarationCache.get(cacheKey);
  if (cached) {
    recordContextGraphCacheHit(SYMBOL_DECLARATION_CACHE_BUCKET);
    return cached;
  }
  recordContextGraphCacheMiss(SYMBOL_DECLARATION_CACHE_BUCKET);
  const rows = extractSymbolDeclarations(filePath, content);
  const evicted = setLruCacheEntry(
    symbolDeclarationCache,
    cacheKey,
    rows,
    MAX_DECLARATION_CACHE_ENTRIES,
  );
  recordContextGraphCacheWrite(SYMBOL_DECLARATION_CACHE_BUCKET);
  if (evicted > 0) {
    recordContextGraphCacheEvict(SYMBOL_DECLARATION_CACHE_BUCKET, evicted);
  }
  return rows;
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countSymbolHits(content: string, symbol: string): number {
  if (!symbol) {
    return 0;
  }
  const regex = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "g");
  let hit = 0;
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    hit += 1;
    if (hit >= 12) {
      break;
    }
    match = regex.exec(content);
  }
  return hit;
}

function rankDeclaration(
  declaration: SymbolDeclaration,
  references: Array<{ path: string; hits: number }>,
  queryRaw: string,
  queryTokens: Set<string>,
  queryPathHints: ReadonlySet<string>,
  graphBridgeCount: number,
  referenceBreadth: number,
): SymbolRankRow {
  const symbolTokens = new Set(tokenizeIdentifier(declaration.symbol));
  const pathTokens = new Set(tokenize(declaration.filePath));
  const normalizedQuery = queryRaw.toLowerCase();
  let score = 1;
  if (normalizedQuery.includes(declaration.symbol.toLowerCase())) {
    score += 5;
  }
  for (const token of queryTokens) {
    if (symbolTokens.has(token)) {
      score += 2;
      continue;
    }
    if (pathTokens.has(token)) {
      score += 1;
    }
  }
  for (const pathHint of queryPathHints) {
    if (isPathOverlap(pathHint, declaration.filePath)) {
      score += 2.2;
      break;
    }
  }
  const totalRefHits = references.reduce((acc, row) => acc + row.hits, 0);
  score += Math.min(4, totalRefHits * 0.4);
  score += Math.min(3.6, graphBridgeCount * 1.2);
  score += Math.min(2.5, referenceBreadth * 0.75);
  const refPreview = references
    .sort((left, right) => right.hits - left.hits)
    .slice(0, 2)
    .map((row) => `${row.path}(${String(row.hits)})`)
    .join(", ");
  const line = refPreview.length > 0
    ? `${declaration.kind} ${declaration.symbol} @ ${declaration.filePath}:${String(declaration.line)} refs=${String(totalRefHits)} bridge=${String(graphBridgeCount)} breadth=${String(referenceBreadth)} -> ${refPreview}`
    : `${declaration.kind} ${declaration.symbol} @ ${declaration.filePath}:${String(declaration.line)} refs=${String(totalRefHits)} bridge=${String(graphBridgeCount)} breadth=${String(referenceBreadth)}`;
  return { score, line };
}

function dedupeLines(rows: readonly string[], maxRows?: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const row of rows) {
    const normalized = row.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (typeof maxRows === "number" && output.length >= maxRows) {
      break;
    }
  }
  return output;
}

function readQueryCacheRows(cacheKey: string, snapshotFingerprint: string): string[] | undefined {
  const cached = symbolQueryCache.get(cacheKey);
  if (!cached) {
    recordContextGraphCacheMiss(SYMBOL_QUERY_CACHE_BUCKET);
    return undefined;
  }
  if (cached.expiresAtMs <= Date.now() || cached.snapshotFingerprint !== snapshotFingerprint) {
    symbolQueryCache.delete(cacheKey);
    recordContextGraphCacheMiss(SYMBOL_QUERY_CACHE_BUCKET);
    return undefined;
  }
  recordContextGraphCacheHit(SYMBOL_QUERY_CACHE_BUCKET);
  setLruCacheEntry(symbolQueryCache, cacheKey, cached, MAX_QUERY_CACHE_ENTRIES);
  return cached.rows;
}

function writeQueryCacheRows(cacheKey: string, snapshotFingerprint: string, rows: readonly string[]): void {
  const normalizedRows = dedupeLines(rows, MAX_QUERY_CACHE_ROWS);
  const evicted = setLruCacheEntry(
    symbolQueryCache,
    cacheKey,
    {
      expiresAtMs: Date.now() + QUERY_CACHE_TTL_MS,
      snapshotFingerprint,
      rows: normalizedRows,
    },
    MAX_QUERY_CACHE_ENTRIES,
  );
  recordContextGraphCacheWrite(SYMBOL_QUERY_CACHE_BUCKET);
  if (evicted > 0) {
    recordContextGraphCacheEvict(SYMBOL_QUERY_CACHE_BUCKET, evicted);
  }
}

export function readSymbolGraphCacheStats(): {
  query: ReturnType<typeof readContextGraphCacheStatsBucket>;
  declaration: ReturnType<typeof readContextGraphCacheStatsBucket>;
} {
  return {
    query: readContextGraphCacheStatsBucket(SYMBOL_QUERY_CACHE_BUCKET),
    declaration: readContextGraphCacheStatsBucket(SYMBOL_DECLARATION_CACHE_BUCKET),
  };
}

export function retrieveSymbolGraphHints(
  query: string,
  options: RetrieveSymbolGraphHintsOptions = {},
): string[] {
  const maxRows = clampInteger(options.maxRows ?? 4, 4, 1, 20);
  const snapshot = options.changedCodeSnapshot ?? getChangedCodeSnapshot({
    workDir: options.workDir,
    maxFiles: 40,
    maxFileBytes: 250_000,
    includeUntracked: true,
    cacheTtlMs: 1_500,
  });
  if (!snapshot) {
    return [];
  }
  if (snapshot.files.length === 0) {
    return [];
  }
  const snapshotFingerprint = computeSnapshotFingerprint(snapshot);
  const queryKey = normalizeQueryKey(query);
  const cacheKey = `${snapshot.rootPath}::${queryKey}`;
  const cachedRows = readQueryCacheRows(cacheKey, snapshotFingerprint);
  if (cachedRows) {
    return cachedRows.slice(0, maxRows);
  }
  const fileContents = new Map<string, string>();
  const declarations: SymbolDeclaration[] = [];
  const referenceHitCache = new Map<string, number>();
  const importGraph = buildFileImportGraph(snapshot);
  for (const file of snapshot.files) {
    fileContents.set(file.path, file.content);
    declarations.push(...extractSymbolDeclarationsWithCache(file.path, file.content));
  }
  if (declarations.length === 0) {
    writeQueryCacheRows(cacheKey, snapshotFingerprint, []);
    return [];
  }
  const queryTokens = new Set(tokenize(query));
  const queryPathHints = new Set(extractPathHints(query).map((row) => row.toLowerCase()));
  const ranked = declarations
    .map((declaration) => {
      const references: Array<{ path: string; hits: number }> = [];
      for (const [path, content] of fileContents.entries()) {
        if (path === declaration.filePath) {
          continue;
        }
        const cacheKey = `${path}::${declaration.symbol}`;
        const cachedHits = referenceHitCache.get(cacheKey);
        const hits = typeof cachedHits === "number"
          ? cachedHits
          : countSymbolHits(content, declaration.symbol);
        if (typeof cachedHits !== "number") {
          referenceHitCache.set(cacheKey, hits);
        }
        if (hits <= 0) {
          continue;
        }
        references.push({ path, hits });
      }
      const declarationPath = normalizePath(declaration.filePath);
      const declarationImports = importGraph.get(declarationPath) ?? new Set<string>();
      let graphBridgeCount = 0;
      const breadthClusters = new Set<string>();
      for (const reference of references) {
        const referencePath = normalizePath(reference.path);
        breadthClusters.add(toPathCluster(referencePath));
        const referenceImports = importGraph.get(referencePath) ?? new Set<string>();
        if (declarationImports.has(referencePath) || referenceImports.has(declarationPath)) {
          graphBridgeCount += 1;
        }
      }
      return rankDeclaration(
        declaration,
        references,
        query,
        queryTokens,
        queryPathHints,
        graphBridgeCount,
        breadthClusters.size,
      );
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .map((row) => row.line);
  const deduped = dedupeLines(ranked);
  writeQueryCacheRows(cacheKey, snapshotFingerprint, deduped);
  return deduped.slice(0, maxRows);
}
