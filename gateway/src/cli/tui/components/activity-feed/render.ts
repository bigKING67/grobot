import type {
  ActivityFeedRow,
  RuntimeActivityFeedDetailMode,
  RuntimeActivityFeedInput,
} from "./contract";
import { renderReactRuntimeActivityFeed } from "../../react/activity-feed";
import { buildActivityToolStartRow } from "./tool-start-row";
import { buildToolEndRow } from "./tool-end-row";
import { buildGroupedActivityRows } from "./tool-group";
import { buildRecoveryRow } from "./tool-recovery-row";

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_DIFF_LINES = 5;
const DEFAULT_TERMINAL_COLUMNS = 96;

export function resolveRuntimeActivityFeedDetailMode(
  valueRaw: string | undefined,
): RuntimeActivityFeedDetailMode {
  const value = (valueRaw ?? "").trim().toLowerCase();
  if (!value || value === "0" || value === "false" || value === "off" || value === "none") {
    return "none";
  }
  if (value === "1" || value === "true" || value === "on" || value === "compact") {
    return "compact";
  }
  if (value === "full" || value === "verbose" || value === "debug") {
    return "full";
  }
  return "none";
}

function resolveMaxDiffLines(input: RuntimeActivityFeedInput): number {
  return typeof input.maxDiffLines === "number" && Number.isFinite(input.maxDiffLines)
    ? Math.max(0, Math.floor(input.maxDiffLines))
    : DEFAULT_MAX_DIFF_LINES;
}

function resolveMaxItems(input: RuntimeActivityFeedInput): number {
  return typeof input.maxItems === "number" && Number.isFinite(input.maxItems)
    ? Math.max(1, Math.floor(input.maxItems))
    : DEFAULT_MAX_ITEMS;
}

function resolveTerminalColumns(input: RuntimeActivityFeedInput): number {
  return typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
    ? Math.max(24, Math.floor(input.terminalColumns))
    : DEFAULT_TERMINAL_COLUMNS;
}

function buildRows(input: RuntimeActivityFeedInput): ActivityFeedRow[] {
  const maxDiffLines = resolveMaxDiffLines(input);
  const rows = buildGroupedActivityRows({
    events: input.events,
    buildToolStartRow: buildActivityToolStartRow,
    buildToolEndRow: (event) => buildToolEndRow(event, maxDiffLines),
    buildRecoveryRow,
  });
  const maxItems = resolveMaxItems(input);
  return rows.slice(Math.max(0, rows.length - maxItems));
}

export function renderRuntimeActivityFeed(input: RuntimeActivityFeedInput): string {
  if (input.detailMode === "none") {
    return "";
  }
  const rows = buildRows(input);
  if (rows.length === 0) {
    return "";
  }
  const detailMode = input.detailMode ?? "compact";
  const rendered = renderReactRuntimeActivityFeed({
    rows,
    detailMode,
    terminalColumns: resolveTerminalColumns(input),
  });
  return rendered ? `${rendered}\n` : "";
}
