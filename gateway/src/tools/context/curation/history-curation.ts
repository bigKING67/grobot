import { type ContextHistoryMessage } from "../types";
import { retrieveRelevantHistoryRows } from "../retrieve/history-retriever";

interface SnapshotSections {
  architecture: string[];
  modifiedFiles: string[];
  verification: string[];
  todos: string[];
  toolOutputs: string[];
}

function createEmptySections(): SnapshotSections {
  return {
    architecture: [],
    modifiedFiles: [],
    verification: [],
    todos: [],
    toolOutputs: [],
  };
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

function pushSection(lines: string[], title: string, items: readonly string[], cap: number): void {
  lines.push(`[${title}]`);
  if (items.length === 0) {
    lines.push("- (none)");
    return;
  }
  for (const item of items.slice(0, cap)) {
    lines.push(`- ${item}`);
  }
}

export function buildCompactSnapshot(
  userText: string,
  history: readonly ContextHistoryMessage[],
  maxRowsPerSection = 4,
): string {
  const sections = createEmptySections();
  const retrieved = retrieveRelevantHistoryRows(userText, history, 24);
  for (const row of retrieved) {
    const content = row.content.trim();
    if (!content) {
      continue;
    }
    classifyRow(content, sections);
  }
  const lines: string[] = ["[Compact Context Snapshot v2]"];
  pushSection(lines, "Architecture decisions", sections.architecture, maxRowsPerSection);
  pushSection(lines, "Modified files and key changes", sections.modifiedFiles, maxRowsPerSection);
  pushSection(lines, "Current verification status", sections.verification, maxRowsPerSection);
  pushSection(lines, "Open TODOs and rollback notes", sections.todos, maxRowsPerSection);
  pushSection(lines, "Tool outputs (pass/fail only)", sections.toolOutputs, maxRowsPerSection);
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
