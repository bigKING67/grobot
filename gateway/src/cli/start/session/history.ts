export type ChatHistoryRole = "user" | "assistant";

export interface ChatHistoryMessage {
  role: ChatHistoryRole;
  content: string;
}

export function normalizeHistoryMessages(raw: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized: ChatHistoryMessage[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const roleRaw = typeof record.role === "string" ? record.role.trim() : "";
    const contentRaw = typeof record.content === "string" ? record.content.trim() : "";
    const role: ChatHistoryRole = roleRaw === "assistant" ? "assistant" : "user";
    if (!contentRaw) {
      continue;
    }
    normalized.push({
      role,
      content: contentRaw,
    });
  }
  return normalized;
}

export function trimHistoryMessages(history: ChatHistoryMessage[], maxTurns: number): ChatHistoryMessage[] {
  const maxMessages = Math.max(2, maxTurns * 2);
  if (history.length <= maxMessages) {
    return history;
  }
  return history.slice(history.length - maxMessages);
}

export function compactSingleLine(raw: string, limit: number): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= Math.max(1, limit)) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, limit)).trimEnd()}…`;
}

function extractHistorySections(history: ChatHistoryMessage[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {
    "Architecture decisions": [],
    "Modified files": [],
    "Verification status": [],
    "Open TODOs / rollback": [],
    "Tool outputs": [],
  };
  for (const item of history) {
    const content = item.content.trim();
    if (!content) {
      continue;
    }
    const lowered = content.toLowerCase();
    if (lowered.includes("architecture")) {
      sections["Architecture decisions"].push(content);
      continue;
    }
    if (lowered.includes("modified files") || lowered.includes("changed files") || lowered.includes("file:")) {
      sections["Modified files"].push(content);
      continue;
    }
    if (lowered.includes("todo") || lowered.includes("rollback")) {
      sections["Open TODOs / rollback"].push(content);
      continue;
    }
    if (lowered.includes("pass") || lowered.includes("fail") || lowered.includes("verification") || lowered.includes("test")) {
      sections["Verification status"].push(content);
      continue;
    }
    if (lowered.includes("error") || lowered.includes("warning") || lowered.includes("trace")) {
      sections["Tool outputs"].push(content);
    }
  }
  return sections;
}

export function buildContinueBridgeMessage(
  sourceSessionId: string,
  sourceSessionKey: string,
  sourceHistory: ChatHistoryMessage[],
  maxTurns: number,
): ChatHistoryMessage | undefined {
  if (!sourceHistory.length) {
    return undefined;
  }
  const sections = extractHistorySections(sourceHistory);
  const lines: string[] = [
    "[Session Continue Bridge]",
    `source_session_id=${sourceSessionId}`,
    `source_session_key=${sourceSessionKey}`,
  ];
  let sectionCount = 0;
  for (const [sectionName, sectionRows] of Object.entries(sections)) {
    if (!sectionRows.length) {
      continue;
    }
    sectionCount += 1;
    lines.push(`- ${sectionName}:`);
    for (const row of sectionRows.slice(0, 3)) {
      lines.push(`  - ${compactSingleLine(row, 220)}`);
    }
  }
  if (sectionCount === 0) {
    lines.push("- Recent turns:");
    const recentRows = sourceHistory.slice(-Math.max(1, maxTurns) * 2);
    for (const row of recentRows) {
      lines.push(`  - ${row.role}: ${compactSingleLine(row.content, 220)}`);
    }
  }
  lines.push("This bridge is summary-only; full history was not imported.");
  return {
    role: "assistant",
    content: lines.join("\n"),
  };
}

export function hasOpenTodoItems(history: ChatHistoryMessage[]): boolean {
  const sections = extractHistorySections(history);
  const todos = sections["Open TODOs / rollback"] ?? [];
  return todos.length > 0;
}

export function hasFailureSignals(history: ChatHistoryMessage[]): boolean {
  const sections = extractHistorySections(history);
  const verificationRows = sections["Verification status"] ?? [];
  const toolRows = sections["Tool outputs"] ?? [];
  const rows = [...verificationRows, ...toolRows];
  const failMarkers = [
    "fail",
    "failed",
    "error",
    "exception",
    "timeout",
    "failure",
    "error",
    "exception",
    "timeout",
  ];
  for (const row of rows) {
    const lowered = row.toLowerCase();
    for (const marker of failMarkers) {
      if (lowered.includes(marker)) {
        return true;
      }
    }
  }
  return false;
}

export function shouldAutoWriteHandoff(compacted: boolean, failover: boolean, todoOpen: boolean): boolean {
  return compacted || failover || todoOpen;
}

export function buildPromptWithHistory(
  userPrompt: string,
  historyMessages: ChatHistoryMessage[],
  maxTurns: number,
): string {
  if (!historyMessages.length) {
    return userPrompt;
  }
  const recentRows = historyMessages.slice(-Math.max(1, maxTurns) * 2);
  const lines = [
    "[Conversation Context]",
    ...recentRows.map((row) => `${row.role}: ${compactSingleLine(row.content, 280)}`),
    "",
    "[Current User Message]",
    userPrompt,
  ];
  return lines.join("\n");
}

export function buildHandoffMarkdown(args: {
  sessionKey: string;
  projectName: string;
  workDir: string;
  historyMessages: ChatHistoryMessage[];
  recentTurns: number;
  reason: string;
}): string {
  const { sessionKey, projectName, workDir, historyMessages, recentTurns, reason } = args;
  const sections = extractHistorySections(historyMessages);
  const recent = historyMessages.slice(-Math.max(1, recentTurns) * 2);
  const lines: string[] = [
    "# HANDOFF",
    "",
    `- generated_at: ${new Date().toISOString()}`,
    `- reason: ${reason}`,
    `- project: ${projectName}`,
    `- work_dir: ${workDir}`,
    `- session_key: ${sessionKey}`,
    "",
    "## Compact Instructions",
    "When compressing, preserve in priority order:",
    "1. Architecture decisions (NEVER summarize)",
    "2. Modified files and their key changes",
    "3. Current verification status (pass/fail)",
    "4. Open TODOs and rollback notes",
    "5. Tool outputs (can delete, keep pass/fail only)",
    "",
  ];
  for (const [sectionName, rows] of Object.entries(sections)) {
    if (!rows.length) {
      continue;
    }
    lines.push(`## ${sectionName}`);
    for (const row of rows.slice(0, 8)) {
      lines.push(`- ${row}`);
    }
    lines.push("");
  }
  lines.push("## Recent Turns");
  if (!recent.length) {
    lines.push("- (none)");
  } else {
    for (const row of recent) {
      lines.push(`- ${row.role}: ${row.content}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
