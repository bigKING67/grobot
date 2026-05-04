import {
  HISTORY_SECTION_ARCHITECTURE,
  HISTORY_SECTION_MODIFIED,
  HISTORY_SECTION_TODO,
  HISTORY_SECTION_TOOL_OUTPUT,
  HISTORY_SECTION_VERIFICATION,
} from "./constants.mjs";
import { isObject } from "./shared.mjs";

function extractCompactSections(history) {
  const sections = {
    [HISTORY_SECTION_ARCHITECTURE]: [],
    [HISTORY_SECTION_MODIFIED]: [],
    [HISTORY_SECTION_VERIFICATION]: [],
    [HISTORY_SECTION_TODO]: [],
    [HISTORY_SECTION_TOOL_OUTPUT]: [],
  };
  for (const item of history) {
    if (!isObject(item)) {
      continue;
    }
    const contentRaw = item.content;
    if (typeof contentRaw !== "string") {
      continue;
    }
    const content = contentRaw.trim();
    if (!content) {
      continue;
    }
    const lowered = content.toLowerCase();
    if (lowered.includes("architecture decision") || lowered.includes("architecture")) {
      sections[HISTORY_SECTION_ARCHITECTURE].push(content);
      continue;
    }
    if (lowered.includes("modified files")) {
      sections[HISTORY_SECTION_MODIFIED].push(content);
      continue;
    }
    if (lowered.includes("todo") || lowered.includes("rollback")) {
      sections[HISTORY_SECTION_TODO].push(content);
      continue;
    }
    if (lowered.includes("fail") || lowered.includes("error") || lowered.includes("timeout")) {
      sections[HISTORY_SECTION_TOOL_OUTPUT].push(content);
      continue;
    }
    if (lowered.includes("pass") || lowered.includes("verification") || lowered.includes("test")) {
      sections[HISTORY_SECTION_VERIFICATION].push(content);
    }
  }
  return sections;
}

export function buildContinueBridgeMessage(payload) {
  const sourceSessionId = typeof payload.source_session_id === "string" ? payload.source_session_id : "";
  const sourceSessionKey = typeof payload.source_session_key === "string" ? payload.source_session_key : "";
  const historyRaw = payload.source_history_messages;
  if (!Array.isArray(historyRaw) || historyRaw.length === 0) {
    return null;
  }
  const sections = extractCompactSections(historyRaw);
  const lines = [
    "[Session Continue Bridge]",
    `source_session_id=${sourceSessionId}`,
    `source_session_key=${sourceSessionKey}`,
  ];
  let hasSection = false;
  const ordered = [
    HISTORY_SECTION_ARCHITECTURE,
    HISTORY_SECTION_MODIFIED,
    HISTORY_SECTION_VERIFICATION,
    HISTORY_SECTION_TODO,
    HISTORY_SECTION_TOOL_OUTPUT,
  ];
  for (const section of ordered) {
    const values = sections[section] ?? [];
    if (values.length === 0) {
      continue;
    }
    hasSection = true;
    lines.push(`- ${section}:`);
    for (const row of values.slice(0, 3)) {
      lines.push(`  - ${row}`);
    }
  }
  if (!hasSection) {
    lines.push("- Recent turns:");
    const maxTurns = typeof payload.max_turns === "number" ? Math.max(1, payload.max_turns) : 2;
    const recent = historyRaw.slice(-maxTurns * 2);
    for (const row of recent) {
      if (!isObject(row)) {
        continue;
      }
      const role = typeof row.role === "string" ? row.role : "unknown";
      const content = typeof row.content === "string" ? row.content.trim() : "";
      if (!content) {
        continue;
      }
      lines.push(`  - ${role}: ${content}`);
    }
  }
  lines.push("This bridge is summary-only; full history was not imported.");
  return { role: "assistant", content: lines.join("\n") };
}
