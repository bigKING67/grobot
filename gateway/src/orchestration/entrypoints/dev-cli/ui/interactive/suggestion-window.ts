import {
  compactSpaces,
  getGraphemeDisplayWidth,
  measureDisplayWidth,
  padToDisplayWidth,
  splitGraphemes,
  truncateDisplayWidth,
} from "./display-width";
import { TERMINAL_SYMBOL, terminalStyle } from "../theme/terminal-style";

export const OVERLAY_MAX_ITEMS = 5;

export interface VisibleSuggestionWindowInput<T> {
  items: readonly T[];
  selectedIndex: number;
  visibleCount: number;
}

export interface VisibleSuggestionWindow<T> {
  startIndex: number;
  endIndex: number;
  selectedIndex: number;
  selectedVisibleIndex: number;
  visibleItems: readonly T[];
}

export function normalizeSuggestionIndex(itemsLength: number, index: number): number {
  if (itemsLength <= 0) {
    return 0;
  }
  const normalized = index % itemsLength;
  if (normalized < 0) {
    return normalized + itemsLength;
  }
  return normalized;
}

export function resolveVisibleSuggestionWindow<T>(
  input: VisibleSuggestionWindowInput<T>,
): VisibleSuggestionWindow<T> {
  const itemsLength = input.items.length;
  if (itemsLength <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      selectedIndex: 0,
      selectedVisibleIndex: 0,
      visibleItems: [],
    };
  }
  const selectedIndex = normalizeSuggestionIndex(itemsLength, input.selectedIndex);
  const visibleCount = Math.max(1, Math.min(Math.floor(input.visibleCount), itemsLength));
  const maxStart = Math.max(0, itemsLength - visibleCount);
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleCount / 2),
      maxStart,
    ),
  );
  const endIndex = startIndex + visibleCount;
  return {
    startIndex,
    endIndex,
    selectedIndex,
    selectedVisibleIndex: selectedIndex - startIndex,
    visibleItems: input.items.slice(startIndex, endIndex),
  };
}

export type PromptSuggestionType =
  | "command"
  | "file"
  | "directory"
  | "agent"
  | "mcp-resource"
  | "shell"
  | "custom-title"
  | "slack-channel"
  | "none";

export interface PromptSuggestionItem {
  id: string;
  displayText: string;
  tag?: string;
  description?: string;
  type?: PromptSuggestionType;
}

export interface FormatPromptSuggestionPanelInput {
  suggestions: readonly PromptSuggestionItem[];
  selectedIndex: number;
  terminalColumns: number;
  terminalRows?: number;
  overlay?: boolean;
  maxColumnWidth?: number;
  showDescription?: boolean;
  showSelectionPointer?: boolean;
}

function resolveTerminalColumns(value: number): number {
  if (Number.isFinite(value) && value > 0) {
    return Math.max(24, Math.floor(value));
  }
  return 96;
}

function resolveVisibleCount(input: {
  terminalRows?: number;
  overlay?: boolean;
}): number {
  if (input.overlay) {
    return OVERLAY_MAX_ITEMS;
  }
  const rows = Number.isFinite(input.terminalRows) && typeof input.terminalRows === "number"
    ? Math.floor(input.terminalRows)
    : 24;
  return Math.min(6, Math.max(1, rows - 3));
}

function isUnifiedSuggestion(item: PromptSuggestionItem): boolean {
  return item.type === "file"
    || item.type === "directory"
    || item.type === "mcp-resource"
    || item.type === "agent"
    || item.id.startsWith("file-")
    || item.id.startsWith("mcp-resource-")
    || item.id.startsWith("agent-");
}

function isFileLikeSuggestion(item: PromptSuggestionItem): boolean {
  return item.type === "file"
    || item.type === "directory"
    || item.id.startsWith("file-");
}

function isMcpResourceSuggestion(item: PromptSuggestionItem): boolean {
  return item.type === "mcp-resource" || item.id.startsWith("mcp-resource-");
}

function getUnifiedSuggestionIcon(item: PromptSuggestionItem): string {
  if (item.type === "mcp-resource" || item.id.startsWith("mcp-resource-")) {
    return "◇";
  }
  if (item.type === "agent" || item.id.startsWith("agent-")) {
    return "*";
  }
  return "+";
}

export function truncateDisplayWidthMiddle(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  if (measureDisplayWidth(value) <= maxWidth) {
    return value;
  }
  const ellipsis = "...";
  const ellipsisWidth = measureDisplayWidth(ellipsis);
  if (maxWidth <= ellipsisWidth + 1) {
    return truncateDisplayWidth(value, maxWidth, { compact: false });
  }

  const targetWidth = maxWidth - ellipsisWidth;
  const prefixTargetWidth = Math.ceil(targetWidth / 2);
  const suffixTargetWidth = Math.floor(targetWidth / 2);
  const graphemes = splitGraphemes(value);
  let prefix = "";
  let prefixWidth = 0;
  for (const grapheme of graphemes) {
    const width = getGraphemeDisplayWidth(grapheme);
    if (prefixWidth + width > prefixTargetWidth) {
      break;
    }
    prefix += grapheme;
    prefixWidth += width;
  }

  let suffix = "";
  let suffixWidth = 0;
  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    const grapheme = graphemes[index] ?? "";
    const width = getGraphemeDisplayWidth(grapheme);
    if (suffixWidth + width > suffixTargetWidth) {
      break;
    }
    suffix = `${grapheme}${suffix}`;
    suffixWidth += width;
  }

  return `${prefix}${ellipsis}${suffix}`;
}

function colorSuggestionPart(value: string, selected: boolean): string {
  if (!value) {
    return "";
  }
  return selected ? terminalStyle.brand(value) : terminalStyle.muted(value);
}

function formatSelectionPrefix(selected: boolean, showSelectionPointer: boolean): string {
  if (!showSelectionPointer) {
    return "";
  }
  const marker = selected ? TERMINAL_SYMBOL.pointer : " ";
  return `${selected ? terminalStyle.pointer(marker) : marker} `;
}

function resolveSelectionPrefixWidth(showSelectionPointer: boolean): number {
  return showSelectionPointer ? 2 : 0;
}

function fitPlainContentToWidth(value: string, width: number): string {
  return truncateDisplayWidth(value, Math.max(0, width), { compact: false });
}

function formatUnifiedSuggestionRow(input: {
  item: PromptSuggestionItem;
  selected: boolean;
  contentColumns: number;
  showDescription: boolean;
}): string {
  const icon = getUnifiedSuggestionIcon(input.item);
  const rawDescription = input.showDescription ? compactSpaces(input.item.description ?? "") : "";
  const separatorWidth = rawDescription ? 3 : 0;
  const iconWidth = measureDisplayWidth(`${icon} `);
  const paddingReserve = rawDescription ? 4 : 0;
  const descriptionReserve = rawDescription
    ? Math.min(20, measureDisplayWidth(rawDescription))
    : 0;
  const textBudget = Math.max(
    1,
    input.contentColumns - iconWidth - separatorWidth - paddingReserve - descriptionReserve,
  );
  const displayText = (() => {
    if (isFileLikeSuggestion(input.item)) {
      return truncateDisplayWidthMiddle(input.item.displayText, textBudget);
    }
    if (isMcpResourceSuggestion(input.item)) {
      return truncateDisplayWidth(input.item.displayText, Math.min(30, textBudget), {
        compact: false,
      });
    }
    return truncateDisplayWidth(input.item.displayText, textBudget, {
      compact: false,
    });
  })();
  const descriptionBudget = Math.max(
    0,
    input.contentColumns
      - iconWidth
      - measureDisplayWidth(displayText)
      - separatorWidth
      - paddingReserve,
  );
  const description = rawDescription
    ? truncateDisplayWidth(rawDescription, descriptionBudget, { compact: false })
    : "";
  const content = description
    ? `${icon} ${displayText} - ${description}`
    : `${icon} ${displayText}`;
  const fitted = fitPlainContentToWidth(content, input.contentColumns);
  return colorSuggestionPart(fitted, input.selected);
}

function formatStandardSuggestionRow(input: {
  item: PromptSuggestionItem;
  selected: boolean;
  contentColumns: number;
  maxColumnWidth: number;
  showDescription: boolean;
}): string {
  const maxNameWidth = Math.max(8, Math.floor(input.contentColumns * 0.4));
  const displayTextWidth = Math.max(
    8,
    Math.min(input.maxColumnWidth, maxNameWidth, input.contentColumns),
  );
  const nameBudget = Math.max(1, displayTextWidth - 2);
  const displayText = truncateDisplayWidth(input.item.displayText, nameBudget, {
    compact: false,
  });
  const paddedDisplayText = input.showDescription
    ? padToDisplayWidth(displayText, displayTextWidth)
    : displayText;
  const tagText = input.item.tag ? `[${compactSpaces(input.item.tag)}] ` : "";
  const tagWidth = measureDisplayWidth(tagText);
  const descriptionWidth = input.showDescription
    ? Math.max(0, input.contentColumns - displayTextWidth - tagWidth - 4)
    : 0;
  const description = input.showDescription && input.item.description
    ? truncateDisplayWidth(compactSpaces(input.item.description), descriptionWidth, {
      compact: false,
    })
    : "";
  const plainContentWidth =
    measureDisplayWidth(paddedDisplayText) + tagWidth + measureDisplayWidth(description);
  const availableContentColumns = Math.max(0, input.contentColumns);
  if (plainContentWidth > availableContentColumns && !description) {
    return colorSuggestionPart(
      truncateDisplayWidth(displayText, availableContentColumns, { compact: false }),
      input.selected,
    );
  }

  const command = colorSuggestionPart(paddedDisplayText, input.selected);
  const tag = tagText ? terminalStyle.muted(tagText) : "";
  const detail = description ? colorSuggestionPart(description, input.selected) : "";
  return `${command}${tag}${detail}`;
}

function formatPromptSuggestionRow(input: {
  item: PromptSuggestionItem;
  selected: boolean;
  terminalColumns: number;
  maxColumnWidth: number;
  showDescription: boolean;
  showSelectionPointer: boolean;
}): string {
  const prefix = formatSelectionPrefix(input.selected, input.showSelectionPointer);
  const contentColumns = Math.max(
    1,
    input.terminalColumns - resolveSelectionPrefixWidth(input.showSelectionPointer),
  );
  const content = isUnifiedSuggestion(input.item)
    ? formatUnifiedSuggestionRow({
      item: input.item,
      selected: input.selected,
      contentColumns,
      showDescription: input.showDescription,
    })
    : formatStandardSuggestionRow({
      item: input.item,
      selected: input.selected,
      contentColumns,
      maxColumnWidth: input.maxColumnWidth,
      showDescription: input.showDescription,
    });
  return `${prefix}${content}`.trimEnd();
}

export function formatPromptSuggestionPanel(input: FormatPromptSuggestionPanelInput): string {
  if (input.suggestions.length === 0) {
    return "";
  }
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  const visibleCount = resolveVisibleCount({
    terminalRows: input.terminalRows,
    overlay: input.overlay,
  });
  const maxColumnWidth = input.maxColumnWidth
    ?? Math.max(
      1,
      ...input.suggestions.map((item) => measureDisplayWidth(item.displayText)),
    ) + 5;
  const visibleWindow = resolveVisibleSuggestionWindow({
    items: input.suggestions,
    selectedIndex: input.selectedIndex,
    visibleCount,
  });
  const showDescription = input.showDescription !== false;
  const lines = visibleWindow.visibleItems.map((item, visibleIndex) =>
    formatPromptSuggestionRow({
      item,
      selected: visibleIndex === visibleWindow.selectedVisibleIndex,
      terminalColumns,
      maxColumnWidth,
      showDescription,
      showSelectionPointer: input.showSelectionPointer === true,
    }),
  );
  return `${lines.join("\n")}\n`;
}
