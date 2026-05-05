import React from "react";
import { Box, Text, renderStaticInk } from "./static-ink";
import { createCliTheme } from "../theme/ansi-theme";
import {
  measureDisplayWidth,
  truncateDisplayWidth,
} from "../terminal/display-width";
import type {
  InfoPanelRow,
  InfoPanelTone,
  InfoPanelViewModel,
} from "../components/info-panel/contract";

const DEFAULT_INFO_PANEL_COLUMNS = 96;

function resolvePanelWidth(input: InfoPanelViewModel): number {
  if (
    typeof input.terminalColumns === "number"
    && Number.isFinite(input.terminalColumns)
  ) {
    return Math.max(40, Math.floor(input.terminalColumns));
  }
  return DEFAULT_INFO_PANEL_COLUMNS;
}

function contentWidth(width: number): number {
  return Math.max(24, width);
}

function resolveRowTone(row: InfoPanelRow): InfoPanelTone {
  return row.tone ?? "brand";
}

function renderDetailLine(
  detail: string,
  width: number,
  index: number,
): React.ReactElement {
  const prefix = "  ⎿  ";
  const detailWidth = Math.max(8, width - measureDisplayWidth(prefix));
  return (
    <Text key={index} tone="muted">
      {`${prefix}${truncateDisplayWidth(detail, detailWidth, { compact: true })}`}
    </Text>
  );
}

function renderRow(
  row: InfoPanelRow,
  width: number,
  index: number,
): React.ReactElement {
  return (
    <Box key={`${row.title}-${index}`} flexDirection="column">
      <Box flexDirection="row">
        <Text tone={resolveRowTone(row)}>•</Text>
        <Text>{` ${truncateDisplayWidth(row.title, Math.max(8, width - 2), { compact: true })}`}</Text>
      </Box>
      {(row.detailLines ?? []).map((detail, detailIndex) =>
        renderDetailLine(detail, width, detailIndex)
      )}
    </Box>
  );
}

export function renderReactInfoPanel(input: InfoPanelViewModel): string {
  const width = contentWidth(resolvePanelWidth(input));
  return renderStaticInk(
    <Box flexDirection="column">
      <Text tone={input.titleTone ?? "brand"} bold>{input.title}</Text>
      {input.subtitle
        ? (
          <Text tone="muted">
            {truncateDisplayWidth(input.subtitle, width, { compact: true })}
          </Text>
        )
        : null}
      {input.sections.map((section, sectionIndex) => (
        <Box key={`${section.title ?? "section"}-${sectionIndex}`} flexDirection="column" paddingTop={sectionIndex > 0 || input.subtitle ? 1 : 0}>
          {section.title ? <Text bold>{section.title}</Text> : null}
          {section.rows.map((row, rowIndex) => renderRow(row, width, rowIndex))}
        </Box>
      ))}
      {(input.footerLines ?? []).map((line, index) => (
        <Text key={`footer-${index}`} tone="muted">
          {truncateDisplayWidth(line, width, { compact: true })}
        </Text>
      ))}
    </Box>,
    createCliTheme(input.interactiveMode ? "interactive_tty" : "plain_tty"),
  );
}
