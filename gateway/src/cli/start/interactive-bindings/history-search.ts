import { compactSingleLine, type ChatHistoryMessage } from "../session-history";

export interface HistorySearchCandidate {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function buildHistorySearchCandidates(
  rows: readonly ChatHistoryMessage[],
): HistorySearchCandidate[] {
  if (rows.length === 0) {
    return [];
  }
  const recent = [...rows].reverse();
  const prioritized = [
    ...recent.filter((row) => row.role === "user"),
    ...recent.filter((row) => row.role === "assistant"),
  ];
  const dedup = new Set<string>();
  const candidates: HistorySearchCandidate[] = [];
  for (let index = 0; index < prioritized.length; index += 1) {
    const row = prioritized[index];
    const content = row.content.trim();
    if (!content || dedup.has(content)) {
      continue;
    }
    dedup.add(content);
    candidates.push({
      id: `${row.role}-${String(index + 1)}`,
      role: row.role,
      content,
    });
    if (candidates.length >= 120) {
      break;
    }
  }
  return candidates;
}

export function filterHistorySearchCandidates(
  candidates: readonly HistorySearchCandidate[],
  queryRaw: string,
): HistorySearchCandidate[] {
  const query = queryRaw.trim().toLowerCase();
  if (query.length < 2) {
    return [...candidates];
  }
  return candidates.filter((candidate) =>
    candidate.content.toLowerCase().includes(query),
  );
}

export function formatHistorySearchQuery(currentInput: string): string {
  return compactSingleLine(currentInput, 120).trim();
}
