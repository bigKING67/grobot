import { MAX_QUERY_CACHE_ROWS } from "./constants";
import {
  type DependencyEdge,
  type ScoredDependencyRow,
} from "./types";
import {
  countPathTokenMatches,
  tokenize,
} from "./utils";

export function scoreEdge(
  queryTokens: ReadonlySet<string>,
  fromPath: string,
  target: string,
): number {
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

export function buildLocalAdjacency(
  edges: readonly DependencyEdge[],
): {
  forward: Map<string, string[]>;
  reverse: Map<string, string[]>;
} {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const push = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const current = map.get(key) ?? new Set<string>();
    current.add(value);
    map.set(key, current);
  };
  for (const edge of edges) {
    if (!edge.targetIsLocal) {
      continue;
    }
    push(forward, edge.fromPath, edge.target);
    push(reverse, edge.target, edge.fromPath);
  }
  const sortMap = (source: Map<string, Set<string>>): Map<string, string[]> =>
    new Map(Array.from(source.entries()).map(([key, value]) => [key, Array.from(value).sort()]));
  return {
    forward: sortMap(forward),
    reverse: sortMap(reverse),
  };
}

export function collectSeedPaths(args: {
  queryTokens: ReadonlySet<string>;
  snapshotPaths: readonly string[];
  edges: readonly DependencyEdge[];
}): string[] {
  const scores = new Map<string, number>();
  const add = (path: string, delta: number): void => {
    if (!path) {
      return;
    }
    const current = scores.get(path) ?? 0;
    scores.set(path, current + delta);
  };
  for (const path of args.snapshotPaths) {
    const tokenMatches = countPathTokenMatches(path, args.queryTokens);
    if (tokenMatches > 0) {
      add(path, 2 + tokenMatches * 1.1);
    }
  }
  for (const edge of args.edges) {
    add(edge.fromPath, edge.score * 0.65);
    if (edge.targetIsLocal) {
      add(edge.target, edge.score * 0.7);
    }
  }
  return Array.from(scores.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 12)
    .map((item) => item[0]);
}

export function buildMultiHopDependencyRows(args: {
  queryTokens: ReadonlySet<string>;
  seeds: readonly string[];
  forward: ReadonlyMap<string, readonly string[]>;
  reverse: ReadonlyMap<string, readonly string[]>;
  changedPathSet: ReadonlySet<string>;
}): ScoredDependencyRow[] {
  const maxDepth = shouldPreferDeepChains(args.queryTokens) ? 4 : 3;
  const maxBranchesPerStep = 4;
  const maxChainCandidates = MAX_QUERY_CACHE_ROWS * 4;
  const degree = new Map<string, number>();
  const accumulateDegree = (map: ReadonlyMap<string, readonly string[]>): void => {
    for (const [key, values] of map.entries()) {
      degree.set(key, (degree.get(key) ?? 0) + values.length);
      for (const value of values) {
        degree.set(value, (degree.get(value) ?? 0) + 1);
      }
    }
  };
  accumulateDegree(args.forward);
  accumulateDegree(args.reverse);

  const rows: ScoredDependencyRow[] = [];
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
      if (args.changedPathSet.has(node.toLowerCase())) {
        changedHits += 1;
      }
    }
    score += Math.min(4, changedHits * 1.4);
    const bridgeNodes = uniqueNodes.slice(1, Math.max(1, uniqueNodes.length - 1));
    const centrality = bridgeNodes.reduce((acc, node) => acc + (degree.get(node) ?? 0), 0);
    score += Math.min(3, centrality * 0.25);
    let changedTransitions = 0;
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const left = nodes[index]?.toLowerCase() ?? "";
      const right = nodes[index + 1]?.toLowerCase() ?? "";
      if (!left || !right) {
        continue;
      }
      if (args.changedPathSet.has(left) || args.changedPathSet.has(right)) {
        changedTransitions += 1;
      }
    }
    score += Math.min(2.5, changedTransitions * 0.7);
    if (uniqueNodes.length >= 4) {
      score += 0.9;
    }
    return score;
  };
  const pushChain = (nodes: string[]): boolean => {
    if (nodes.length < 2 || new Set(nodes).size !== nodes.length) {
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
    return rows.length >= maxChainCandidates;
  };
  const sortNodesByPriority = (nodes: readonly string[]): string[] =>
    [...nodes].sort((left, right) => {
      const leftTokenScore = countPathTokenMatches(left, args.queryTokens);
      const rightTokenScore = countPathTokenMatches(right, args.queryTokens);
      if (leftTokenScore !== rightTokenScore) {
        return rightTokenScore - leftTokenScore;
      }
      const leftChanged = args.changedPathSet.has(left.toLowerCase()) ? 1 : 0;
      const rightChanged = args.changedPathSet.has(right.toLowerCase()) ? 1 : 0;
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
  const collectForwardChains = (seed: string): string[][] => {
    const output: string[][] = [];
    const walk = (path: string[]): void => {
      if (path.length >= 2) {
        output.push([...path]);
      }
      if (path.length >= maxDepth || output.length >= maxChainCandidates) {
        return;
      }
      const current = path[path.length - 1];
      if (!current) {
        return;
      }
      const neighbors = sortNodesByPriority(args.forward.get(current) ?? [])
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
    if (rows.length >= maxChainCandidates) {
      break;
    }
    const reverseLevel1 = sortNodesByPriority(args.reverse.get(seed) ?? [])
      .slice(0, maxBranchesPerStep);
    for (const prev of reverseLevel1) {
      if (pushChain([prev, seed])) {
        break;
      }
      for (const chain of forwardChains) {
        if (chain.includes(prev)) {
          continue;
        }
        const merged = [prev, ...chain];
        const limited = merged.slice(0, maxDepth);
        if (pushChain(limited)) {
          break;
        }
      }
      if (rows.length >= maxChainCandidates) {
        break;
      }
    }
    if (rows.length >= maxChainCandidates) {
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
    .slice(0, MAX_QUERY_CACHE_ROWS);
}
