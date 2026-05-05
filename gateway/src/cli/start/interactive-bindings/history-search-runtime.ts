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
        buildCompactNotice("对话历史", ["暂无对话历史。"]),
      );
      return undefined;
    }
    const query = formatHistorySearchQuery(historyInput.currentInput);
    const filtered = filterHistorySearchCandidates(candidates, query);
    const effectiveCandidates = filtered.length > 0 ? filtered : candidates;
    const picked = await runSelectMenu({
      title: "历史搜索 (Ctrl+R)",
      subtitle:
        query.length >= 2
          ? filtered.length > 0
            ? `查询 ${compactSingleLine(query, 60)} · 匹配 ${String(filtered.length)}`
            : `查询 ${compactSingleLine(query, 60)} · 无精确匹配，显示最近历史`
          : "最近的 prompts 和回复",
      hint: "↑/↓ 选择 · Enter 填入 · Esc 返回",
      items: effectiveCandidates.slice(0, 30).map((candidate) => ({
        id: candidate.id,
        label: compactSingleLine(candidate.content, 120),
        description: `${candidate.role === "user" ? "用户" : "助手"} · ${compactSingleLine(candidate.content, 240)}`,
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
