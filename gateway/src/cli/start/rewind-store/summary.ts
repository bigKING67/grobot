import { renderInfoPanel } from "../../tui/components/info-panel/render";
import type { InfoPanelRow } from "../../tui/components/info-panel/contract";
import type { RewindCheckpointSummary } from "./contract";
import { compactSingleLine } from "./time";

function formatSessionKeyForDisplay(value: string): string {
  const normalized = value.trim();
  const scopedSessionMatch = /__s_([^:]+)$/.exec(normalized);
  if (scopedSessionMatch?.[1]) {
    return scopedSessionMatch[1];
  }
  const parts = normalized.split(":").filter((part) => part.length > 0);
  if (parts.length > 0 && normalized.includes(":")) {
    return parts[parts.length - 1];
  }
  return normalized.length > 0 ? normalized : "当前会话";
}

function formatCheckpointCreatedAt(value: string): string {
  const normalized = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalized);
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return normalized.length > 0 ? normalized : "未知";
}

export function buildCheckpointSummaryText(
  sessionKey: string,
  summaries: readonly RewindCheckpointSummary[],
): string {
  const rows: InfoPanelRow[] = [
    {
      title: `会话 ${formatSessionKeyForDisplay(sessionKey)}`,
      detailLines: [`检查点 ${String(summaries.length)}`],
    },
  ];
  if (summaries.length === 0) {
    rows.push({
      title: "暂无可用检查点。",
    });
    return renderInfoPanel({
      title: "检查点概览",
      sections: [{ rows }],
    });
  }
  for (const row of summaries) {
    rows.push({
      title: row.checkpointId,
      detailLines: [
        `${formatCheckpointCreatedAt(row.createdAt)} · ${String(row.changedFilesCount)} 个文件 · 消息 ${String(
          row.historyBeforeCount,
        )}->${String(row.historyAfterCount)}`,
        `用户 ${compactSingleLine(row.userText, 72)}`,
        `助手 ${compactSingleLine(row.assistantText, 72)}`,
      ],
    });
  }
  return renderInfoPanel({
    title: "检查点概览",
    sections: [{ rows }],
  });
}
