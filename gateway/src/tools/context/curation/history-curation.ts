import { type ContextHistoryMessage } from "../types";
import { retrieveDependencyGraphHints } from "../graph/dependency-hints";
import { retrieveSymbolGraphHints } from "../graph/symbol-hints";
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

function extractPathHints(raw: string): string[] {
  const matches = raw.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g) ?? [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of matches) {
    const normalized = item.trim();
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

interface GraphFusionRow {
  row: string;
  source: "dependency" | "symbol";
  index: number;
  tokens: Set<string>;
  paths: Set<string>;
}

function buildGraphFusionRows(
  source: "dependency" | "symbol",
  rows: readonly string[],
): GraphFusionRow[] {
  return rows.map((row, index) => {
    const normalized = row.trim();
    const paths = extractPathHints(normalized).map((item) => item.toLowerCase());
    return {
      row: normalized,
      source,
      index,
      tokens: new Set(tokenizeForGraphFusion(normalized)),
      paths: new Set(paths),
    };
  }).filter((row) => row.row.length > 0);
}

function fuseGraphHints(args: {
  query: string;
  dependencyRows: readonly string[];
  symbolRows: readonly string[];
  maxRowsPerSection: number;
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
    return score;
  };
  const sortRows = (rows: GraphFusionRow[]): string[] =>
    rows
      .map((row) => ({
        row,
        score: scoreRow(row),
      }))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.row.index - right.row.index;
      })
      .slice(0, maxRows)
      .map((item) => item.row.row);
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
    const workspaceRows = retrieveWorkspaceSignals(
      userText,
      Math.max(1, Math.min(options.workspaceSignalsMaxRows ?? 4, 20)),
      {
        workDir: options.workDir,
        includeUntracked: options.workspaceSignalsIncludeUntracked,
        cacheTtlMs: options.workspaceSignalsCacheTtlMs,
      },
    );
    sections.workspace.push(...workspaceRows.map((row) => row.summary));
  }
  if (structuralHintsEnabled && options?.dependencyGraphEnabled) {
    dependencyRows = retrieveDependencyGraphHints(userText, {
      workDir: options.workDir,
      maxRows: options.dependencyGraphMaxRows,
      changedCodeSnapshot: options.changedCodeSnapshot,
    });
  }
  if (structuralHintsEnabled && options?.symbolGraphEnabled) {
    symbolRows = retrieveSymbolGraphHints(userText, {
      workDir: options.workDir,
      maxRows: options.symbolGraphMaxRows,
      changedCodeSnapshot: options.changedCodeSnapshot,
    });
  }
  if (dependencyRows.length > 0 || symbolRows.length > 0) {
    const fused = fuseGraphHints({
      query: userText,
      dependencyRows,
      symbolRows,
      maxRowsPerSection,
    });
    sections.dependencyGraph.push(...fused.dependencyGraph);
    sections.symbolGraph.push(...fused.symbolGraph);
  }
  if (structuralHintsEnabled && options?.lineageEnabled) {
    const lineageRows = retrieveLineageSummaries(
      userText,
      Math.max(1, Math.min(options.lineageMaxRows ?? 3, 16)),
      {
        workDir: options.workDir,
        maxCommits: options.lineageMaxCommits,
        cacheTtlMs: options.lineageCacheTtlMs,
      },
    );
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
