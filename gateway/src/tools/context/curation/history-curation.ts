import { resolve } from "node:path";
import { type ContextHistoryMessage } from "../types";
import { retrieveDependencyGraphHints } from "../graph/dependency-hints";
import { retrieveSymbolGraphHints } from "../graph/symbol-hints";
import { queryPersistentDependencyHints, queryPersistentSymbolHints } from "../graph/persistent-index";
import { type ChangedCodeSnapshot } from "../graph/changed-code-snapshot";
import { retrieveLineageSummaries } from "../lineage/lineage-memory";
import { retrieveWorkspaceSignals } from "../live/workspace-signals";
import { retrieveRelevantHistoryRows } from "../retrieve/history-retriever";

interface SnapshotSections {
  architecture: string[];
  dependencyGraph: string[];
  symbolGraph: string[];
  workspace: string[];
  lineage: string[];
  modifiedFiles: string[];
  verification: string[];
  todos: string[];
  toolOutputs: string[];
}

function createEmptySections(): SnapshotSections {
  return {
    architecture: [],
    dependencyGraph: [],
    symbolGraph: [],
    workspace: [],
    lineage: [],
    modifiedFiles: [],
    verification: [],
    todos: [],
    toolOutputs: [],
  };
}

function looksLikeCodeIntent(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return false;
  }
  if (/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/.test(normalized)) {
    return true;
  }
  if (/```|`[^`]+`/.test(normalized)) {
    return true;
  }
  if (/[{}()[\];<>=>]/.test(normalized)) {
    return true;
  }
  const lowered = normalized.toLowerCase();
  const keywords = [
    "code",
    "coding",
    "source",
    "repo",
    "project",
    "module",
    "function",
    "class",
    "symbol",
    "dependency",
    "import",
    "compile",
    "build",
    "lint",
    "test",
    "debug",
    "error",
    "fix",
    "refactor",
    "pull request",
    "commit",
    "branch",
    "context engine",
    "context",
    "源码",
    "代码",
    "仓库",
    "工程",
    "函数",
    "类",
    "文件",
    "路径",
    "依赖",
    "符号",
    "报错",
    "修复",
    "重构",
    "测试",
    "编译",
    "压缩",
    "上下文",
  ];
  return keywords.some((keyword) => lowered.includes(keyword));
}

function classifyRow(content: string, sections: SnapshotSections): void {
  const lowered = content.toLowerCase();
  if (lowered.includes("architecture")) {
    sections.architecture.push(content);
    return;
  }
  if (
    lowered.includes("modified files") ||
    lowered.includes("changed files") ||
    lowered.includes("file:")
  ) {
    sections.modifiedFiles.push(content);
    return;
  }
  if (
    lowered.includes("verification") ||
    lowered.includes("test") ||
    lowered.includes("pass") ||
    lowered.includes("fail")
  ) {
    sections.verification.push(content);
    return;
  }
  if (lowered.includes("todo") || lowered.includes("rollback")) {
    sections.todos.push(content);
    return;
  }
  if (lowered.includes("error") || lowered.includes("warning") || lowered.includes("timeout")) {
    sections.toolOutputs.push(content);
  }
}

function truncateLine(raw: string, maxChars: number): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function pushSection(
  lines: string[],
  title: string,
  items: readonly string[],
  cap: number,
  itemMaxChars: number,
): void {
  lines.push(`[${title}]`);
  if (items.length === 0) {
    lines.push("- (none)");
    return;
  }
  const seen = new Set<string>();
  const deduplicated: string[] = [];
  for (const item of items) {
    const normalized = truncateLine(item, itemMaxChars);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduplicated.push(normalized);
    if (deduplicated.length >= cap) {
      break;
    }
  }
  if (deduplicated.length === 0) {
    lines.push("- (none)");
    return;
  }
  for (const item of deduplicated) {
    lines.push(`- ${item}`);
  }
}

function tokenizeForGraphFusion(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function hasDeepChainIntent(queryTokens: ReadonlySet<string>): boolean {
  if (queryTokens.size === 0) {
    return false;
  }
  const deepTokens = new Set([
    "trace",
    "chain",
    "call",
    "flow",
    "path",
    "route",
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

function parseDependencyDepth(row: string): number {
  const depth = row
    .split("->")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .length;
  return Math.max(0, depth);
}

function normalizePathHint(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/:(\d+)(?::\d+)?$/, "");
}

function extractPathHints(raw: string): string[] {
  const matches = raw.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g) ?? [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of matches) {
    const normalized = normalizePathHint(item);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= 8) {
      break;
    }
  }
  return output;
}

function collectNormalizedPathHints(rows: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const path of extractPathHints(row)) {
      const normalized = normalizePathHint(path).toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push(normalized);
      if (output.length >= 128) {
        return output;
      }
    }
  }
  return output;
}

function isPathOverlap(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function countPathSetOverlap(paths: ReadonlySet<string>, targets: ReadonlySet<string>): number {
  if (paths.size === 0 || targets.size === 0) {
    return 0;
  }
  let overlapCount = 0;
  for (const path of paths) {
    let matched = false;
    for (const target of targets) {
      if (isPathOverlap(path, target)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      overlapCount += 1;
    }
  }
  return overlapCount;
}

function toPathClusterKey(path: string): string {
  const normalized = normalizePathHint(path).toLowerCase();
  if (!normalized) {
    return "__none__";
  }
  const segments = normalized.split("/").filter((item) => item.length > 0);
  if (segments.length === 0) {
    return "__none__";
  }
  if (segments.length === 1) {
    return segments[0] as string;
  }
  return `${segments[0]}/${segments[1]}`;
}

function resolveRepoLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return normalized || "repo";
  }
  const label = normalized.slice(slashIndex + 1).trim();
  return label || "repo";
}

function resolveGraphExtraRepoRoots(workDir?: string): string[] {
  const configured = process.env.GROBOT_CONTEXT_ENGINE_GRAPH_EXTRA_REPOS;
  if (!configured || !configured.trim()) {
    return [];
  }
  const base = resolve(workDir ?? process.cwd());
  const items = configured
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 5);
  const output: string[] = [];
  const seen = new Set<string>([base]);
  for (const item of items) {
    const resolved = item.startsWith("/")
      ? resolve(item)
      : resolve(base, item);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    output.push(resolved);
  }
  return output;
}

function dedupeGraphRows(rows: readonly string[], maxRows: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const normalized = row.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maxRows) {
      break;
    }
  }
  return output;
}

interface GraphFusionRow {
  row: string;
  source: "dependency" | "symbol";
  index: number;
  tokens: Set<string>;
  paths: Set<string>;
  pathList: string[];
  dependencyDepth: number;
  symbolRefs: number;
  symbolBridge: number;
  symbolBreadth: number;
}

function buildGraphFusionRows(
  source: "dependency" | "symbol",
  rows: readonly string[],
): GraphFusionRow[] {
  return rows.map((row, index) => {
    const normalized = row.trim();
    const paths = extractPathHints(normalized).map((item) => normalizePathHint(item).toLowerCase());
    const dependencyDepth = source === "dependency"
      ? parseDependencyDepth(normalized)
      : 0;
    const symbolRefs = source === "symbol"
      ? parseMetricValue(normalized, "refs")
      : 0;
    const symbolBridge = source === "symbol"
      ? parseMetricValue(normalized, "bridge")
      : 0;
    const symbolBreadth = source === "symbol"
      ? parseMetricValue(normalized, "breadth")
      : 0;
    return {
      row: normalized,
      source,
      index,
      tokens: new Set(tokenizeForGraphFusion(normalized)),
      paths: new Set(paths),
      pathList: paths,
      dependencyDepth,
      symbolRefs,
      symbolBridge,
      symbolBreadth,
    };
  }).filter((row) => row.row.length > 0);
}

function fuseGraphHints(args: {
  query: string;
  dependencyRows: readonly string[];
  symbolRows: readonly string[];
  maxRowsPerSection: number;
  lineageRows?: readonly string[];
  workspaceRows?: readonly string[];
  changedCodeSnapshot?: ChangedCodeSnapshot;
}): {
  dependencyGraph: string[];
  symbolGraph: string[];
} {
  const maxRows = Math.max(1, Math.min(args.maxRowsPerSection, 20));
  const dependency = buildGraphFusionRows("dependency", args.dependencyRows);
  const symbol = buildGraphFusionRows("symbol", args.symbolRows);
  if (dependency.length === 0 && symbol.length === 0) {
    return {
      dependencyGraph: [],
      symbolGraph: [],
    };
  }
  const allRows = [...dependency, ...symbol];
  const queryTokens = new Set(tokenizeForGraphFusion(args.query));
  const deepChainIntent = hasDeepChainIntent(queryTokens);
  const lineagePathSet = new Set(collectNormalizedPathHints(args.lineageRows ?? []));
  const workspacePathSet = new Set(collectNormalizedPathHints(args.workspaceRows ?? []));
  const changedPathSet = new Set(
    (args.changedCodeSnapshot?.files ?? [])
      .map((row) => normalizePathHint(row.path).toLowerCase())
      .filter((row) => row.length > 0)
      .slice(0, 240),
  );
  const pathFrequency = new Map<string, number>();
  for (const row of allRows) {
    for (const path of row.paths) {
      pathFrequency.set(path, (pathFrequency.get(path) ?? 0) + 1);
    }
  }
  const dependencyPathSet = new Set(dependency.flatMap((row) => Array.from(row.paths)));
  const symbolPathSet = new Set(symbol.flatMap((row) => Array.from(row.paths)));
  const scoreRow = (row: GraphFusionRow): number => {
    let score = 1;
    for (const token of queryTokens) {
      if (row.tokens.has(token)) {
        score += 1.8;
      }
    }
    let centrality = 0;
    for (const path of row.paths) {
      centrality += pathFrequency.get(path) ?? 0;
    }
    score += Math.min(4, centrality * 0.35);
    const oppositePathSet = row.source === "dependency" ? symbolPathSet : dependencyPathSet;
    let overlapCount = 0;
    for (const path of row.paths) {
      if (oppositePathSet.has(path)) {
        overlapCount += 1;
      }
    }
    score += Math.min(3, overlapCount * 1.2);
    if (row.source === "symbol" && /\brefs=\d+\b/i.test(row.row)) {
      score += 0.8;
    }
    if (row.source === "dependency") {
      score += Math.min(4, Math.max(0, row.dependencyDepth - 1) * 0.95);
      if (deepChainIntent) {
        score += Math.min(3.2, Math.max(0, row.dependencyDepth - 2) * 1.2);
        if (row.dependencyDepth <= 2) {
          score -= 0.4;
        }
      }
    } else {
      score += Math.min(3.2, row.symbolBridge * 0.85);
      score += Math.min(2.6, row.symbolBreadth * 0.65);
      score += Math.min(2.8, row.symbolRefs * 0.38);
      if (deepChainIntent && row.symbolBridge <= 0) {
        score -= 0.3;
      }
    }
    const lineageOverlap = countPathSetOverlap(row.paths, lineagePathSet);
    if (lineageOverlap > 0) {
      score += Math.min(3, lineageOverlap * 1.3);
    }
    const workspaceOverlap = countPathSetOverlap(row.paths, workspacePathSet);
    if (workspaceOverlap > 0) {
      score += Math.min(2.4, workspaceOverlap * 1.1);
    }
    const changedOverlap = countPathSetOverlap(row.paths, changedPathSet);
    if (changedOverlap > 0) {
      score += Math.min(3.2, changedOverlap * 1.6);
      if (row.source === "dependency") {
        score += 0.6;
      }
    }
    return score;
  };
  const resolveClusterKey = (row: GraphFusionRow): string => {
    if (row.pathList.length > 0) {
      return `path:${toPathClusterKey(row.pathList[0] ?? "")}`;
    }
    const firstToken = Array.from(row.tokens).find((token) => token.length >= 3);
    if (firstToken) {
      return `token:${row.source}:${firstToken}`;
    }
    return `fallback:${row.source}:${String(row.index)}`;
  };
  const selectDiverseRows = (rows: Array<{ row: GraphFusionRow; score: number }>): string[] => {
    const output: string[] = [];
    const usedRows = new Set<number>();
    const seenClusters = new Set<string>();
    for (let index = 0; index < rows.length; index += 1) {
      if (output.length >= maxRows) {
        break;
      }
      const item = rows[index];
      if (!item) {
        continue;
      }
      const clusterKey = resolveClusterKey(item.row);
      if (seenClusters.has(clusterKey)) {
        continue;
      }
      seenClusters.add(clusterKey);
      usedRows.add(index);
      output.push(item.row.row);
    }
    for (let index = 0; index < rows.length; index += 1) {
      if (output.length >= maxRows) {
        break;
      }
      if (usedRows.has(index)) {
        continue;
      }
      const item = rows[index];
      if (!item) {
        continue;
      }
      output.push(item.row.row);
    }
    return output.slice(0, maxRows);
  };
  const sortRows = (rows: GraphFusionRow[]): string[] =>
    selectDiverseRows(rows
      .map((row) => ({
        row,
        score: scoreRow(row),
      }))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.row.index - right.row.index;
      }));
  return {
    dependencyGraph: sortRows(dependency),
    symbolGraph: sortRows(symbol),
  };
}

export function buildCompactSnapshot(
  userText: string,
  history: readonly ContextHistoryMessage[],
  maxRowsPerSection = 4,
  itemMaxChars = 240,
  options?: {
    workDir?: string;
    forceStructuralHints?: boolean;
    lineageEnabled?: boolean;
    lineageMaxRows?: number;
    lineageMaxCommits?: number;
    lineageCacheTtlMs?: number;
    workspaceSignalsEnabled?: boolean;
    workspaceSignalsMaxRows?: number;
    workspaceSignalsIncludeUntracked?: boolean;
    workspaceSignalsCacheTtlMs?: number;
    dependencyGraphEnabled?: boolean;
    dependencyGraphMaxRows?: number;
    symbolGraphEnabled?: boolean;
    symbolGraphMaxRows?: number;
    changedCodeSnapshot?: ChangedCodeSnapshot;
  },
): string {
  const sections = createEmptySections();
  let dependencyRows: string[] = [];
  let symbolRows: string[] = [];
  let workspaceSignalRows: ReturnType<typeof retrieveWorkspaceSignals> = [];
  let lineageRows: ReturnType<typeof retrieveLineageSummaries> = [];
  const structuralHintsEnabled =
    typeof options?.forceStructuralHints === "boolean"
      ? options.forceStructuralHints
      : looksLikeCodeIntent(userText);
  const retrieved = retrieveRelevantHistoryRows(userText, history, 24);
  for (const row of retrieved) {
    const content = row.content.trim();
    if (!content) {
      continue;
    }
    classifyRow(content, sections);
  }
  if (structuralHintsEnabled && options?.workspaceSignalsEnabled) {
    workspaceSignalRows = retrieveWorkspaceSignals(
      userText,
      Math.max(1, Math.min(options.workspaceSignalsMaxRows ?? 4, 20)),
      {
        workDir: options.workDir,
        includeUntracked: options.workspaceSignalsIncludeUntracked,
        cacheTtlMs: options.workspaceSignalsCacheTtlMs,
      },
    );
    sections.workspace.push(...workspaceSignalRows.map((row) => row.summary));
  }
  if (structuralHintsEnabled && options?.lineageEnabled) {
    lineageRows = retrieveLineageSummaries(
      userText,
      Math.max(1, Math.min(options.lineageMaxRows ?? 3, 16)),
      {
        workDir: options.workDir,
        maxCommits: options.lineageMaxCommits,
        cacheTtlMs: options.lineageCacheTtlMs,
      },
    );
  }
  if (structuralHintsEnabled && options?.dependencyGraphEnabled) {
    const primaryMaxRows = Math.max(2, Math.min(options.dependencyGraphMaxRows ?? 4, 12));
    const persistentPrimaryRows = queryPersistentDependencyHints(userText, {
      workDir: options.workDir,
      maxRows: primaryMaxRows,
    });
    const changedPrimaryRows = retrieveDependencyGraphHints(userText, {
      workDir: options.workDir,
      maxRows: primaryMaxRows,
      changedCodeSnapshot: options.changedCodeSnapshot,
    });
    dependencyRows = [...persistentPrimaryRows, ...changedPrimaryRows];
    const extraRoots = resolveGraphExtraRepoRoots(options.workDir);
    const extraMaxRows = Math.max(2, Math.min(options.dependencyGraphMaxRows ?? 4, 8));
    for (const root of extraRoots) {
      const persistentRows = queryPersistentDependencyHints(userText, {
        workDir: root,
        maxRows: extraMaxRows,
      });
      const changedRows = retrieveDependencyGraphHints(userText, {
        workDir: root,
        maxRows: extraMaxRows,
      });
      const rows = dedupeGraphRows([...persistentRows, ...changedRows], 24);
      if (rows.length === 0) {
        continue;
      }
      const repoLabel = resolveRepoLabel(root);
      dependencyRows.push(...rows.map((row) => `[${repoLabel}] ${row}`));
    }
    dependencyRows = dedupeGraphRows(dependencyRows, 48);
  }
  if (structuralHintsEnabled && options?.symbolGraphEnabled) {
    const primaryMaxRows = Math.max(2, Math.min(options.symbolGraphMaxRows ?? 4, 12));
    const persistentPrimaryRows = queryPersistentSymbolHints(userText, {
      workDir: options.workDir,
      maxRows: primaryMaxRows,
    });
    const changedPrimaryRows = retrieveSymbolGraphHints(userText, {
      workDir: options.workDir,
      maxRows: primaryMaxRows,
      changedCodeSnapshot: options.changedCodeSnapshot,
    });
    symbolRows = [...persistentPrimaryRows, ...changedPrimaryRows];
    const extraRoots = resolveGraphExtraRepoRoots(options.workDir);
    const extraMaxRows = Math.max(2, Math.min(options.symbolGraphMaxRows ?? 4, 8));
    for (const root of extraRoots) {
      const persistentRows = queryPersistentSymbolHints(userText, {
        workDir: root,
        maxRows: extraMaxRows,
      });
      const changedRows = retrieveSymbolGraphHints(userText, {
        workDir: root,
        maxRows: extraMaxRows,
      });
      const rows = dedupeGraphRows([...persistentRows, ...changedRows], 24);
      if (rows.length === 0) {
        continue;
      }
      const repoLabel = resolveRepoLabel(root);
      symbolRows.push(...rows.map((row) => `[${repoLabel}] ${row}`));
    }
    symbolRows = dedupeGraphRows(symbolRows, 48);
  }
  if (dependencyRows.length > 0 || symbolRows.length > 0) {
    const fused = fuseGraphHints({
      query: userText,
      dependencyRows,
      symbolRows,
      maxRowsPerSection,
      lineageRows: lineageRows.map((row) => row.summary),
      workspaceRows: workspaceSignalRows.map((row) => row.path),
      changedCodeSnapshot: options?.changedCodeSnapshot,
    });
    sections.dependencyGraph.push(...fused.dependencyGraph);
    sections.symbolGraph.push(...fused.symbolGraph);
  }
  if (structuralHintsEnabled && options?.lineageEnabled) {
    for (const row of lineageRows) {
      const commitShort = row.commitId.slice(0, 8);
      const timestamp = row.timestamp ? row.timestamp.slice(0, 10) : "";
      const author = row.author?.trim() ?? "";
      const meta = [timestamp, author].filter((item) => item.length > 0).join(" ");
      sections.lineage.push(
        meta.length > 0
          ? `${commitShort} ${row.summary} (${meta})`
          : `${commitShort} ${row.summary}`,
      );
    }
  }
  const lines: string[] = ["[Compact Context Snapshot v2]"];
  pushSection(lines, "Architecture decisions", sections.architecture, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Dependency graph hints", sections.dependencyGraph, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Symbol graph hints", sections.symbolGraph, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Live workspace changes", sections.workspace, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Commit lineage hints", sections.lineage, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Modified files and key changes", sections.modifiedFiles, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Current verification status", sections.verification, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Open TODOs and rollback notes", sections.todos, maxRowsPerSection, itemMaxChars);
  pushSection(lines, "Tool outputs (pass/fail only)", sections.toolOutputs, maxRowsPerSection, itemMaxChars);
  return lines.join("\n");
}

export function buildPromptFromSnapshot(args: {
  userText: string;
  snapshot: string;
  recentRows: readonly ContextHistoryMessage[];
  includeRecentRows: boolean;
}): string {
  const lines: string[] = ["[Conversation Context]", args.snapshot];
  if (args.includeRecentRows && args.recentRows.length > 0) {
    lines.push("[Recent Turns]");
    for (const row of args.recentRows) {
      lines.push(`${row.role}: ${row.content}`);
    }
  }
  lines.push("", "[Current User Message]", args.userText);
  return lines.join("\n");
}
