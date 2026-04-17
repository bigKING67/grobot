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
    const graphRows = retrieveDependencyGraphHints(userText, {
      workDir: options.workDir,
      maxRows: options.dependencyGraphMaxRows,
      changedCodeSnapshot: options.changedCodeSnapshot,
    });
    sections.dependencyGraph.push(...graphRows);
  }
  if (structuralHintsEnabled && options?.symbolGraphEnabled) {
    const symbolRows = retrieveSymbolGraphHints(userText, {
      workDir: options.workDir,
      maxRows: options.symbolGraphMaxRows,
      changedCodeSnapshot: options.changedCodeSnapshot,
    });
    sections.symbolGraph.push(...symbolRows);
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
