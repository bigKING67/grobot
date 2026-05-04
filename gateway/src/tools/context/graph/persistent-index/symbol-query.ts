import { normalizeQueryKey } from "../cache-utils";
import {
  MAX_QUERY_ROWS,
  type PersistentGraphIndexEntry,
  type PersistentSymbolDeclaration,
} from "./contract";
import { getRuntime } from "./runtime";
import {
  extractPathHints,
  isPathOverlap,
  readQueryCacheRows,
  toPathCluster,
  writeQueryCacheRows,
} from "./query-core";
import {
  clampInteger,
  dedupeRows,
  tokenize,
  tokenizeIdentifier,
} from "./utils";

function rankPersistentSymbolRow(args: {
  declaration: PersistentSymbolDeclaration;
  references: string[];
  query: string;
  queryTokens: ReadonlySet<string>;
  queryPathHints: readonly string[];
  declarationImports: ReadonlySet<string>;
  reverseImports: ReadonlyMap<string, ReadonlySet<string>>;
}): { score: number; line: string } {
  const declaration = args.declaration;
  const symbolTokens = new Set(tokenizeIdentifier(declaration.symbol));
  const pathTokens = new Set(tokenize(declaration.filePath));
  const normalizedQuery = args.query.toLowerCase();
  let score = 1;
  if (normalizedQuery.includes(declaration.symbol.toLowerCase())) {
    score += 5;
  }
  for (const token of args.queryTokens) {
    if (symbolTokens.has(token)) {
      score += 2;
      continue;
    }
    if (pathTokens.has(token)) {
      score += 1;
    }
  }
  for (const pathHint of args.queryPathHints) {
    if (isPathOverlap(pathHint, declaration.filePath)) {
      score += 2.2;
      break;
    }
  }
  let bridge = 0;
  const breadthClusters = new Set<string>();
  const refsPreview: string[] = [];
  for (const path of args.references) {
    breadthClusters.add(toPathCluster(path));
    const reverse = args.reverseImports.get(path) ?? new Set<string>();
    if (args.declarationImports.has(path) || reverse.has(declaration.filePath)) {
      bridge += 1;
    }
    if (refsPreview.length < 2) {
      refsPreview.push(`${path}(1)`);
    }
  }
  const refCount = args.references.length;
  score += Math.min(4, refCount * 0.45);
  score += Math.min(3.8, bridge * 1.15);
  score += Math.min(2.8, breadthClusters.size * 0.75);
  const suffix = refsPreview.length > 0 ? ` -> ${refsPreview.join(", ")}` : "";
  return {
    score,
    line: `${declaration.kind} ${declaration.symbol} @ ${declaration.filePath}:${String(declaration.line)} refs=${String(refCount)} bridge=${String(bridge)} breadth=${String(breadthClusters.size)}${suffix}`,
  };
}

export function querySymbolHintsWithEntry(
  entry: PersistentGraphIndexEntry,
  query: string,
  maxRowsInput?: number,
): string[] {
  const maxRows = clampInteger(maxRowsInput ?? 4, 4, 1, 24);
  const runtime = getRuntime(entry);
  if (runtime.declarations.length === 0) {
    return [];
  }
  const queryKey = normalizeQueryKey(query);
  const cacheKey = `${entry.index.rootPath}::${queryKey}`;
  const cachedRows = readQueryCacheRows(entry.symbolQueryCache, cacheKey, runtime.fingerprint);
  if (cachedRows) {
    return cachedRows.slice(0, maxRows);
  }
  const queryTokens = new Set(tokenize(query));
  const queryPathHints = extractPathHints(query);
  const ranked = runtime.declarations
    .map((declaration) => {
      const references = Array.from(runtime.identifierToFiles.get(declaration.symbol.toLowerCase()) ?? [])
        .filter((path) => path !== declaration.filePath)
        .slice(0, 24);
      return rankPersistentSymbolRow({
        declaration,
        references,
        query,
        queryTokens,
        queryPathHints,
        declarationImports: runtime.declarationImports.get(declaration.filePath) ?? new Set<string>(),
        reverseImports: runtime.reverse,
      });
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .map((row) => row.line);
  const deduped = dedupeRows(ranked, MAX_QUERY_ROWS);
  writeQueryCacheRows(entry.symbolQueryCache, cacheKey, runtime.fingerprint, deduped);
  return deduped.slice(0, maxRows);
}
