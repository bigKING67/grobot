import React from "react";
import { Box, Divider, Text, renderStaticInk } from "./static-ink";
import { createCliTheme } from "../theme/ansi-theme";
import {
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../terminal/display-width";
import type {
  HelpCommandItem,
  HelpScreenViewModel,
  HelpShortcutItem,
} from "../components/help/contract";

const DEFAULT_HELP_COLUMNS = 96;
const MIN_COMMAND_COLUMN = 10;
const MAX_COMMAND_COLUMN = 24;
const MIN_SHORTCUT_COLUMN = 7;
const MAX_SHORTCUT_COLUMN = 10;
const HELP_HORIZONTAL_MARGIN = 2;
const HELP_SIDE_PADDING = 2;

function resolveHelpWidth(input: HelpScreenViewModel): number {
  if (
    typeof input.terminalColumns === "number"
    && Number.isFinite(input.terminalColumns)
    && input.terminalColumns > 0
  ) {
    return Math.max(40, Math.floor(input.terminalColumns) - HELP_HORIZONTAL_MARGIN);
  }
  return DEFAULT_HELP_COLUMNS;
}

function contentWidth(width: number): number {
  return Math.max(24, width - (HELP_SIDE_PADDING * 2));
}

function resolveColumnWidth(
  values: readonly string[],
  min: number,
  max: number,
): number {
  const natural = values.reduce(
    (result, value) => Math.max(result, measureDisplayWidth(value)),
    min,
  );
  return Math.min(max, Math.max(min, natural));
}

function formatColumnValue(value: string, width: number): string {
  return padToDisplayWidth(
    truncateDisplayWidth(value, width, { compact: true }),
    width,
  );
}

function renderShortcutRow(
  shortcut: HelpShortcutItem,
  keyWidth: number,
  width: number,
  index: number,
): React.ReactElement {
  const descriptionWidth = Math.max(8, width - keyWidth - 3);
  return (
    <Box key={index} flexDirection="row">
      <Text tone="brand">•</Text>
      <Text>{` ${formatColumnValue(shortcut.key, keyWidth)} `}</Text>
      <Text tone="muted">
        {truncateDisplayWidth(shortcut.description, descriptionWidth, { compact: true })}
      </Text>
    </Box>
  );
}

function renderCommandRow(
  item: HelpCommandItem,
  commandWidth: number,
  width: number,
  index: number,
): React.ReactElement {
  const descriptionWidth = Math.max(10, width - commandWidth - 3);
  return (
    <Box key={`${item.command}-${index}`} flexDirection="row">
      <Text tone="brand">•</Text>
      <Text>{` ${formatColumnValue(item.command, commandWidth)} `}</Text>
      <Text tone="muted">
        {truncateDisplayWidth(item.description, descriptionWidth, { compact: true })}
      </Text>
    </Box>
  );
}

function renderNoteRow(note: string, width: number, index: number): React.ReactElement {
  const textWidth = Math.max(12, width - 5);
  return (
    <Box key={index} flexDirection="row">
      <Text tone="muted">  ⎿</Text>
      <Text tone="muted">
        {` ${truncateDisplayWidth(note, textWidth, { compact: true })}`}
      </Text>
    </Box>
  );
}

export function renderReactHelpScreen(input: HelpScreenViewModel): string {
  const width = resolveHelpWidth(input);
  const innerWidth = contentWidth(width);
  const commandColumnWidth = resolveColumnWidth(
    input.sections.flatMap((section) => section.items.map((item) => item.command)),
    MIN_COMMAND_COLUMN,
    MAX_COMMAND_COLUMN,
  );
  const shortcutColumnWidth = resolveColumnWidth(
    input.shortcuts.map((item) => item.key),
    MIN_SHORTCUT_COLUMN,
    MAX_SHORTCUT_COLUMN,
  );
  return renderStaticInk(
    <Box flexDirection="column" paddingTop={1}>
      <Divider width={width} tone="brand" />
      <Box flexDirection="column" paddingX={HELP_SIDE_PADDING}>
        <Text tone="brand" bold>{input.title}</Text>
        <Text tone="muted">
          {truncateDisplayWidth(input.subtitle, innerWidth, { compact: true })}
        </Text>
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>{input.shortcutsTitle}</Text>
          {input.shortcuts.map((shortcut, index) =>
            renderShortcutRow(shortcut, shortcutColumnWidth, innerWidth, index)
          )}
        </Box>
        {input.sections.map((section) => (
          <Box key={section.title} flexDirection="column" paddingTop={1}>
            <Text bold>{section.title}</Text>
            {section.items.map((item, index) =>
              renderCommandRow(item, commandColumnWidth, innerWidth, index)
            )}
          </Box>
        ))}
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>{input.notesTitle}</Text>
          {input.notes.map((note, index) => renderNoteRow(note, innerWidth, index))}
        </Box>
        <Text tone="muted">
          {truncateDisplayWidth(input.footer, innerWidth, { compact: true })}
        </Text>
      </Box>
    </Box>,
    createCliTheme(input.interactiveMode ? "interactive_tty" : "plain_tty"),
  );
}
