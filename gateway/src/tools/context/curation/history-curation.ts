import { type ContextHistoryMessage } from "../types";
import { retrieveDependencyGraphHints } from "../graph/dependency-hints";
import { retrieveSymbolGraphHints } from "../graph/symbol-hints";
import { queryPersistentDependencyHints, queryPersistentSymbolHints } from "../graph/persistent-index";
import { type ChangedCodeSnapshot } from "../graph/changed-code-snapshot";
import { retrieveLineageSummaries } from "../lineage/lineage-memory";
import { retrieveWorkspaceSignals } from "../live/workspace-signals";
import { retrieveRelevantHistoryRows } from "../retrieve/history-retriever";
import {
  classifyRow,
  createEmptySections,
  looksLikeCodeIntent,
  pushSection,
} from "./history-curation/sections";
import {
  dedupeGraphRows,
  fuseGraphHints,
  resolveGraphExtraRepoRoots,
  resolveRepoLabel,
} from "./history-curation/graph-fusion";

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
