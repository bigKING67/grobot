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
  return normalized.length > 0 ? normalized : "current session";
}

function formatCheckpointCreatedAt(value: string): string {
  const normalized = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalized);
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return normalized.length > 0 ? normalized : "unknown";
}

function formatChangedFileCount(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
}

export function buildCheckpointSummaryText(
  sessionKey: string,
  summaries: readonly RewindCheckpointSummary[],
): string {
  const rows: InfoPanelRow[] = [
    {
      title: `Session ${formatSessionKeyForDisplay(sessionKey)}`,
      detailLines: [`checkpoints ${String(summaries.length)}`],
    },
  ];
  if (summaries.length === 0) {
    rows.push({
      title: "No available checkpoints.",
    });
    return renderInfoPanel({
      title: "Checkpoint overview",
      sections: [{ rows }],
    });
  }
  for (const row of summaries) {
    rows.push({
      title: row.checkpointId,
      detailLines: [
        `${formatCheckpointCreatedAt(row.createdAt)} · ${formatChangedFileCount(row.changedFilesCount)} · messages ${String(
          row.historyBeforeCount,
        )}->${String(row.historyAfterCount)}`,
        `user ${compactSingleLine(row.userText, 72)}`,
        `assistant ${compactSingleLine(row.assistantText, 72)}`,
      ],
    });
  }
  return renderInfoPanel({
    title: "Checkpoint overview",
    sections: [{ rows }],
  });
}
