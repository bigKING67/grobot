import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import { compactSingleLine } from "../session/history";
import {
  buildHistorySearchCandidates,
  filterHistorySearchCandidates,
  formatHistorySearchQuery,
} from "./history-search";
import { buildCompactNotice } from "./notice-surface";
import type {
  CreateRunStartInteractiveModeInput,
  InteractiveModeBindingPatch,
} from "./contract";

export function createOpenHistorySearch(
  input: CreateRunStartInteractiveModeInput,
  runSelectMenu: typeof runTerminalSelectMenu,
): InteractiveModeBindingPatch["openHistorySearch"] {
  return async (historyInput: {
    currentInput: string;
  }): Promise<string | undefined> => {
    if (!process.stdin.isTTY) {
      return undefined;
    }
    const rows = input.runtimeState.getHistoryMessages();
    const candidates = buildHistorySearchCandidates(rows);
    if (candidates.length === 0) {
      input.output.writeStdout(
        buildCompactNotice("Conversation history", ["No conversation history."]),
      );
      return undefined;
    }
    const query = formatHistorySearchQuery(historyInput.currentInput);
    const filtered = filterHistorySearchCandidates(candidates, query);
    const effectiveCandidates = filtered.length > 0 ? filtered : candidates;
    const picked = await runSelectMenu({
      title: "History search (Ctrl+R)",
      subtitle:
        query.length >= 2
          ? filtered.length > 0
            ? `query ${compactSingleLine(query, 60)} · matches ${String(filtered.length)}`
            : `query ${compactSingleLine(query, 60)} · no exact match, showing recent history`
          : "Recent prompts and replies",
      hint: "↑/↓ select · Enter fill · Esc back",
      items: effectiveCandidates.slice(0, 30).map((candidate) => ({
        id: candidate.id,
        label: compactSingleLine(candidate.content, 120),
        description: `${candidate.role === "user" ? "user" : "assistant"} · ${compactSingleLine(candidate.content, 240)}`,
      })),
      initialIndex: 0,
    });
    if (picked.kind === "cancelled") {
      return undefined;
    }
    const selected = effectiveCandidates[picked.index];
    if (!selected) {
      return undefined;
    }
    return selected.content;
  };
}
