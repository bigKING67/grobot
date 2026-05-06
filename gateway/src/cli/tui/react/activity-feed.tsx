import React from "react";
import { Box, Text, renderStaticInk } from "./static-ink";
import { createCliTheme, type CliThemeToken } from "../theme/ansi-theme";
import {
  measureDisplayWidth,
  truncateDisplayWidth,
} from "../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../terminal/text-sanitizer";
import type {
  ActivityFeedRow,
  RuntimeActivityFeedViewModel,
} from "../components/activity-feed/contract";

const DEFAULT_ACTIVITY_COLUMNS = 96;
const REFERENCE_TOOL_STATUS_DOT = process.platform === "darwin" ? "⏺" : "●";

function resolveFeedWidth(input: RuntimeActivityFeedViewModel): number {
  if (
    typeof input.terminalColumns === "number"
    && Number.isFinite(input.terminalColumns)
  ) {
    return Math.max(24, Math.floor(input.terminalColumns));
  }
  return DEFAULT_ACTIVITY_COLUMNS;
}

function resolveBulletTone(row: ActivityFeedRow): CliThemeToken {
  if (row.state === "queued" || row.state === "running") {
    return "muted";
  }
  if (row.state === "success") {
    return "success";
  }
  if (row.state === "error") {
    return "error";
  }
  if (row.state === "warning") {
    return "remember";
  }
  if (row.severity === "warning") {
    return "remember";
  }
  if (row.severity === "error") {
    return "error";
  }
  return "success";
}

function fitMainTitle(title: string, width: number): string {
  const sanitizedTitle = sanitizeTerminalDisplayText(title);
  const titleWidth = Math.max(1, width - measureDisplayWidth(`${REFERENCE_TOOL_STATUS_DOT} `));
  return truncateDisplayWidth(sanitizedTitle, titleWidth, { compact: true });
}

function fitDetailLine(detail: string, width: number): string {
  const sanitizedDetail = sanitizeTerminalDisplayText(detail);
  return truncateDisplayWidth(`  ⎿  ${sanitizedDetail}`, width);
}

function renderActivityRow(
  row: ActivityFeedRow,
  detailMode: RuntimeActivityFeedViewModel["detailMode"],
  width: number,
  index: number,
): React.ReactElement {
  const title = fitMainTitle(row.title, width);
  return (
    <Box key={index} flexDirection="column">
      <Box flexDirection="row">
        <Text tone={resolveBulletTone(row)}>{REFERENCE_TOOL_STATUS_DOT}</Text>
        <Text>{` ${title}`}</Text>
      </Box>
      {detailMode === "full"
        ? row.detailLines.map((detail, detailIndex) => (
          <Text key={detailIndex} tone="muted">
            {fitDetailLine(detail, width)}
          </Text>
        ))
        : null}
    </Box>
  );
}

export function renderReactRuntimeActivityFeed(
  input: RuntimeActivityFeedViewModel,
): string {
  const rows = input.rows.filter((row) => row.title.trim().length > 0);
  if (rows.length === 0 || input.detailMode === "none") {
    return "";
  }
  const width = resolveFeedWidth(input);
  return renderStaticInk(
    <Box flexDirection="column">
      {rows.map((row, index) =>
        renderActivityRow(row, input.detailMode, width, index)
      )}
    </Box>,
    createCliTheme("interactive_tty"),
  );
}
