import {
  padToDisplayWidth,
  truncateDisplayWidth,
} from "./display-width";
import {
  resolveVisibleSuggestionWindow,
  normalizeSuggestionIndex,
} from "./suggestion-window";
import { TERMINAL_SYMBOL, terminalStyle } from "../theme/terminal-style";

const VISIBLE_SLASH_SUGGESTION_COUNT = 5;
const SLASH_MARKER_WIDTH = 2;
const SLASH_COLUMN_GAP = 2;
const SLASH_TWO_COLUMN_MIN_WIDTH = 64;

export interface SlashOverlaySuggestion {
  command: string;
  description?: string;
  source?: string;
}

export function resolveSlashOverlayColumns(): number {
  const stdoutState = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdoutState.isTTY
    && typeof stdoutState.columns === "number"
    && Number.isFinite(stdoutState.columns)
    && stdoutState.columns > 0
  ) {
    return Math.floor(stdoutState.columns);
  }
  return 96;
}

export { normalizeSuggestionIndex };

function normalizeDescription(input: SlashOverlaySuggestion): string {
  return (input.description ?? "").trim().replace(/\s+/g, " ");
}

function colorDim(value: string): string {
  return terminalStyle.muted(value);
}

function colorSelected(value: string): string {
  return terminalStyle.brand(value);
}

function resolveCommandColumnWidth(input: {
  terminalColumns: number;
  showDescription: boolean;
}): number {
  const availableColumns = Math.max(24, input.terminalColumns - SLASH_MARKER_WIDTH);
  if (!input.showDescription) {
    return Math.max(12, availableColumns);
  }
  return Math.min(
    34,
    Math.max(
      14,
      Math.floor(Math.max(input.terminalColumns, 40) * 0.36),
    ),
  );
}

function hasSlashCommandArguments(lineInputRaw: string): boolean {
  const lineInput = lineInputRaw.trim();
  if (!lineInput.startsWith("/")) {
    return false;
  }
  const firstSpace = lineInput.indexOf(" ");
  if (firstSpace < 0) {
    return false;
  }
  return lineInput.slice(firstSpace + 1).trim().length > 0;
}

function formatSuggestionRow(input: {
  item: SlashOverlaySuggestion;
  commandColumnWidth: number;
  descriptionColumnWidth: number;
  showDescription: boolean;
  selected: boolean;
}): string {
  const commandText = truncateDisplayWidth(input.item.command.trim(), input.commandColumnWidth, {
    compact: false,
  });
  const commandColumn = input.showDescription
    ? padToDisplayWidth(commandText, input.commandColumnWidth)
    : commandText;
  const description = normalizeDescription(input.item);
  const descriptionColumn = input.showDescription && description.length > 0
    ? truncateDisplayWidth(description, input.descriptionColumnWidth, {
      compact: false,
    })
    : "";
  const marker = (() => {
    if (input.selected) {
      return TERMINAL_SYMBOL.pointer;
    }
    return " ";
  })();
  const renderedMarker = input.selected
    ? terminalStyle.pointer(marker)
    : marker.trim().length > 0
      ? colorDim(marker)
      : " ";
  const renderedCommand = input.selected ? colorSelected(commandColumn) : colorDim(commandColumn);
  const renderedDescription = descriptionColumn.length > 0
    ? `${" ".repeat(SLASH_COLUMN_GAP)}${colorDim(descriptionColumn)}`
    : "";
  return `${renderedMarker} ${renderedCommand}${renderedDescription}`;
}

export function formatSlashSuggestionPanel(
  suggestions: readonly SlashOverlaySuggestion[],
  lineInput: string,
  selectedIndex: number,
  terminalColumns: number,
): string {
  const trimmed = lineInput.trimStart();
  if (!trimmed.startsWith("/")) {
    return "";
  }
  if (hasSlashCommandArguments(trimmed)) {
    return "";
  }
  if (suggestions.length === 0) {
    return "";
  }
  const visibleWindow = resolveVisibleSuggestionWindow({
    items: suggestions,
    selectedIndex,
    visibleCount: VISIBLE_SLASH_SUGGESTION_COUNT,
  });
  const visibleSuggestions = visibleWindow.visibleItems;
  const resolvedColumns = Math.max(40, Math.floor(Number.isFinite(terminalColumns) ? terminalColumns : 96));
  const showDescription = resolvedColumns >= SLASH_TWO_COLUMN_MIN_WIDTH;
  const commandColumnWidth = resolveCommandColumnWidth({
    terminalColumns: resolvedColumns,
    showDescription,
  });
  const descriptionColumnWidth = showDescription
    ? Math.max(
      0,
      resolvedColumns
        - SLASH_MARKER_WIDTH
        - commandColumnWidth
        - SLASH_COLUMN_GAP,
    )
    : 0;
  const lines: string[] = [];
  for (let index = 0; index < visibleSuggestions.length; index += 1) {
    const item = visibleSuggestions[index];
    lines.push(formatSuggestionRow({
      item,
      commandColumnWidth,
      descriptionColumnWidth,
      showDescription,
      selected: index === visibleWindow.selectedVisibleIndex,
    }));
  }
  return `${lines.join("\n")}\n`;
}
