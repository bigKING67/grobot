import {
  MAX_QUERY_CACHE_ENTRIES,
  MAX_QUERY_ROWS,
  QUERY_CACHE_TTL_MS,
  type PersistentGraphQueryCacheEntry,
} from "./contract";
import {
  dedupeRows,
  normalizePath,
  normalizePathLower,
  tokenize,
} from "./utils";

export function toPathCluster(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter((item) => item.length > 0);
  if (parts.length <= 1) {
    return normalized || "__root__";
  }
  return `${parts[0]}/${parts[1]}`;
}

export function countPathTokenMatches(path: string, queryTokens: ReadonlySet<string>): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const pathTokens = new Set(tokenize(path));
  let matched = 0;
  for (const token of queryTokens) {
    if (pathTokens.has(token)) {
      matched += 1;
    }
  }
  return matched;
}

export function scoreDependencyEdge(queryTokens: ReadonlySet<string>, fromPath: string, target: string, local: boolean): number {
  let score = 1;
  const tokens = new Set([...tokenize(fromPath), ...tokenize(target)]);
  for (const token of queryTokens) {
    if (tokens.has(token)) {
      score += 2;
    }
  }
  if (target.startsWith(".")) {
    score += 1;
  }
  if (target.includes("/") && /\.[A-Za-z0-9_]+$/.test(target)) {
    score += 1;
  }
  if (local) {
    score += 1.4;
  }
  return score;
}

function shouldPreferDeepChains(queryTokens: ReadonlySet<string>): boolean {
  if (queryTokens.size === 0) {
    return false;
  }
  const deepTokens = new Set([
    "trace",
    "chain",
    "call",
    "flow",
    "pipeline",
    "path",
    "route",
    "link",
    "lineage",
    "dependency",
    "依赖",
    "链路",
    "调用",
    "路径",
    "追踪",
  ]);
  for (const token of queryTokens) {
    if (deepTokens.has(token)) {
      return true;
    }
  }
  return false;
}

export function extractPathHints(raw: string): string[] {
  const matches = raw.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g) ?? [];
  return dedupeRows(matches.map((item) => normalizePath(item).replace(/:(\d+)(?::\d+)?$/, "")), 12);
}

export function isPathOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizePathLower(left);
  const normalizedRight = normalizePathLower(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  return normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}

export function readQueryCacheRows(
  cache: Map<string, PersistentGraphQueryCacheEntry>,
  key: string,
  fingerprint: string,
): string[] | undefined {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAtMs <= Date.now() || cached.fingerprint !== fingerprint) {
    cache.delete(key);
    return undefined;
  }
  return cached.rows.slice();
}

export function writeQueryCacheRows(
  cache: Map<string, PersistentGraphQueryCacheEntry>,
  key: string,
  fingerprint: string,
  rows: readonly string[],
): void {
  const deduped = dedupeRows(rows, MAX_QUERY_ROWS);
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, {
    expiresAtMs: Date.now() + QUERY_CACHE_TTL_MS,
    fingerprint,
    rows: deduped,
  });
  while (cache.size > MAX_QUERY_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }
}

export function collectSeedPaths(args: {
  queryTokens: ReadonlySet<string>;
  allPaths: readonly string[];
  rankedDirect: ReadonlyArray<{ fromPath: string; target: string; score: number; targetIsLocal: boolean }>;
}): string[] {
  const scores = new Map<string, number>();
  const add = (path: string, delta: number): void => {
    if (!path) {
      return;
    }
    scores.set(path, (scores.get(path) ?? 0) + delta);
  };
  for (const path of args.allPaths) {
    const pathScore = countPathTokenMatches(path, args.queryTokens);
    if (pathScore > 0) {
      add(path, 2 + pathScore * 1.15);
    }
  }
  for (const row of args.rankedDirect) {
    add(row.fromPath, row.score * 0.65);
    if (row.targetIsLocal) {
      add(row.target, row.score * 0.7);
    }
  }
  return Array.from(scores.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 14)
    .map((item) => item[0]);
}

export function buildMultiHopDependencyRows(args: {
  queryTokens: ReadonlySet<string>;
  seeds: readonly string[];
  forward: ReadonlyMap<string, ReadonlySet<string>>;
  reverse: ReadonlyMap<string, ReadonlySet<string>>;
  changedPathSet: ReadonlySet<string>;
}): Array<{ line: string; score: number }> {
  const maxDepth = shouldPreferDeepChains(args.queryTokens) ? 4 : 3;
  const maxBranchesPerStep = 4;
  const maxRows = MAX_QUERY_ROWS * 4;
  const degree = new Map<string, number>();
  for (const [path, targets] of args.forward.entries()) {
    degree.set(path, (degree.get(path) ?? 0) + targets.size);
    for (const target of targets) {
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }
  for (const [path, sources] of args.reverse.entries()) {
    degree.set(path, (degree.get(path) ?? 0) + sources.size);
    for (const source of sources) {
      degree.set(source, (degree.get(source) ?? 0) + 1);
    }
  }
  const rows: Array<{ line: string; score: number }> = [];
  const seen = new Set<string>();
  const scoreChain = (nodes: readonly string[]): number => {
    const uniqueNodes = Array.from(new Set(nodes));
    let score = 1 + Math.max(0, nodes.length - 1) * 0.9;
    let tokenHits = 0;
    for (const node of uniqueNodes) {
      tokenHits += countPathTokenMatches(node, args.queryTokens);
    }
    score += Math.min(4, tokenHits * 1.2);
    let changedHits = 0;
    for (const node of uniqueNodes) {
      if (args.changedPathSet.has(normalizePathLower(node))) {
        changedHits += 1;
      }
    }
    score += Math.min(3.8, changedHits * 1.3);
    const bridgeNodes = uniqueNodes.slice(1, Math.max(1, uniqueNodes.length - 1));
    const centrality = bridgeNodes.reduce((acc, node) => acc + (degree.get(node) ?? 0), 0);
    score += Math.min(3.1, centrality * 0.25);
    if (uniqueNodes.length >= 4) {
      score += 0.9;
    }
    return score;
  };
  const sortByPriority = (nodes: readonly string[]): string[] =>
    [...nodes].sort((left, right) => {
      const leftToken = countPathTokenMatches(left, args.queryTokens);
      const rightToken = countPathTokenMatches(right, args.queryTokens);
      if (leftToken !== rightToken) {
        return rightToken - leftToken;
      }
      const leftChanged = args.changedPathSet.has(normalizePathLower(left)) ? 1 : 0;
      const rightChanged = args.changedPathSet.has(normalizePathLower(right)) ? 1 : 0;
      if (leftChanged !== rightChanged) {
        return rightChanged - leftChanged;
      }
      const leftDegree = degree.get(left) ?? 0;
      const rightDegree = degree.get(right) ?? 0;
      if (leftDegree !== rightDegree) {
        return rightDegree - leftDegree;
      }
      return left.localeCompare(right);
    });
  const pushChain = (nodes: readonly string[]): boolean => {
    if (nodes.length < 2) {
      return false;
    }
    if (new Set(nodes).size !== nodes.length) {
      return false;
    }
    const line = nodes.join(" -> ");
    if (seen.has(line)) {
      return false;
    }
    seen.add(line);
    rows.push({
      line,
      score: scoreChain(nodes),
    });
    return rows.length >= maxRows;
  };
  const collectForwardChains = (seed: string): string[][] => {
    const output: string[][] = [];
    const walk = (path: string[]): void => {
      if (path.length >= 2) {
        output.push([...path]);
      }
      if (path.length >= maxDepth || output.length >= maxRows) {
        return;
      }
      const current = path[path.length - 1];
      if (!current) {
        return;
      }
      const neighbors = sortByPriority(Array.from(args.forward.get(current) ?? []))
        .filter((next) => !path.includes(next))
        .slice(0, maxBranchesPerStep);
      for (const next of neighbors) {
        walk([...path, next]);
      }
    };
    walk([seed]);
    return output;
  };
  for (const seed of args.seeds) {
    const forwardChains = collectForwardChains(seed);
    for (const chain of forwardChains) {
      if (pushChain(chain)) {
        break;
      }
    }
    if (rows.length >= maxRows) {
      break;
    }
    const reverseLevel1 = sortByPriority(Array.from(args.reverse.get(seed) ?? []))
      .slice(0, maxBranchesPerStep);
    for (const source of reverseLevel1) {
      if (pushChain([source, seed])) {
        break;
      }
      for (const chain of forwardChains) {
        if (chain.includes(source)) {
          continue;
        }
        const merged = [source, ...chain].slice(0, maxDepth);
        if (pushChain(merged)) {
          break;
        }
      }
      if (rows.length >= maxRows) {
        break;
      }
    }
    if (rows.length >= maxRows) {
      break;
    }
  }
  return rows
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .slice(0, MAX_QUERY_ROWS);
}
