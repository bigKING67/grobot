import { terminalStyle } from "../../tui/theme/terminal-style";
import type { RewindCheckpointSummary } from "./contract";
import { compactSingleLine } from "./time";

export function buildCheckpointSummaryText(
  sessionKey: string,
  summaries: readonly RewindCheckpointSummary[],
): string {
  const lines: string[] = [];
  lines.push(`${terminalStyle.accent("●")} 检查点概览`);
  lines.push(`  ${terminalStyle.muted(`会话: ${sessionKey}`)}`);
  lines.push(`  ${terminalStyle.muted(`检查点: ${String(summaries.length)}`)}`);
  if (summaries.length === 0) {
    lines.push(`  ${terminalStyle.muted("暂无可用检查点。")}`);
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const row of summaries) {
    lines.push(
      `- ${row.checkpointId} | ${row.createdAt} | 文件=${String(row.changedFilesCount)} | 消息=${String(
        row.historyBeforeCount,
      )}->${String(row.historyAfterCount)} | 用户=${compactSingleLine(row.userText, 72)}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
