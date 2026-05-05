import {
  getGraphemeDisplayWidth,
  measureDisplayWidth,
  padToDisplayWidth,
  splitGraphemes,
  stripAnsi,
} from "../../terminal/display-width";
import {
  formatSlashSuggestionPanel,
  normalizeSuggestionIndex,
  resolveSlashOverlayColumns,
} from "../../interactive/slash-overlay";
import {
  resolvePromptSlotState,
  type PromptSlotState,
  type PromptSlotStateInput,
} from "../../interactive/prompt-slot-state";
import { type SessionPromptLayout } from "../../interactive/interactive-frame";
import { renderShortcutOverlayFooter } from "../bottom-pane/render";
import {
  DEFAULT_SESSION_PROMPT,
  INLINE_IMAGE_RENDER_PATTERN,
  type InputLineDescriptor,
  type SessionSlashSuggestion,
} from "./contract";
import {
  resolveSlashInputHighlightSuggestions,
  shouldHighlightSlashInputToken,
} from "./reducer";
import { renderReactPromptInputLines } from "../../react/prompt-input";

const ANSI_RESET = "\u001B[0m";
const ANSI_BOLD = "\u001B[1m";
const ANSI_DIM = "\u001B[90m";
const ANSI_BRAND = "\u001B[38;2;202;124;94m";
const ANSI_SUGGESTION = ANSI_BRAND;
const ANSI_INVERSE = "\u001B[7m";
const ANSI_INLINE_IMAGE_TOKEN_PLAIN = ANSI_BRAND;
const ANSI_INLINE_IMAGE_TOKEN_NERD = ANSI_BRAND;
const ANSI_INLINE_IMAGE_TOKEN_CCLINE = `\u001B[1m${ANSI_BRAND}`;
const INPUT_CHROME_BODY_LEFT_PADDING = 0;
const SHORTCUT_HINT_TEXT = "? shortcuts";

export interface PromptInputRenderSnapshot {
  renderedLines: string[];
  cursorRenderLineIndex: number;
  cursorColumn: number;
  descriptors: InputLineDescriptor[];
  activeLineIndex: number;
  activeLineInput: string;
  activeSlashSuggestions: readonly SessionSlashSuggestion[];
}

export interface PromptInputRenderSnapshotInput {
  resolvedPrompt: SessionPromptLayout;
  footerLines: readonly string[];
  promptLabelWidth: number;
  continuationPrefix: string;
  graphemes: readonly string[];
  cursor: number;
  historySearchInFlight: boolean;
  shortcutOverlayVisible: boolean;
  activeSlashSuggestionIndex: number;
  lastSlashLineInput: string;
  slashSuggestionsHiddenForLine: string;
  terminalColumns: number;
  terminalRows?: number;
  inlineImageTheme?: "plain" | "nerd_font" | "ccline";
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
}

export interface PromptInputRenderSnapshotResolution {
  snapshot: PromptInputRenderSnapshot;
  activeSlashSuggestionIndex: number;
  lastSlashLineInput: string;
  slashSuggestionsHiddenForLine: string;
  shortcutOverlayVisible: boolean;
}

export function buildCodeOffsets(graphemes: readonly string[]): number[] {
  const offsets: number[] = [0];
  let total = 0;
  for (const grapheme of graphemes) {
    total += grapheme.length;
    offsets.push(total);
  }
  return offsets;
}

export function codeOffsetFromGraphemeIndex(
  graphemes: readonly string[],
  index: number,
): number {
  const normalized = Math.max(0, Math.min(index, graphemes.length));
  let total = 0;
  for (let i = 0; i < normalized; i += 1) {
    total += graphemes[i]?.length ?? 0;
  }
  return total;
}

export function graphemeIndexFromCodeOffset(
  graphemes: readonly string[],
  codeOffset: number,
): number {
  const target = Math.max(0, codeOffset);
  let total = 0;
  for (let index = 0; index < graphemes.length; index += 1) {
    const next = total + (graphemes[index]?.length ?? 0);
    if (next > target) {
      return index;
    }
    total = next;
  }
  return graphemes.length;
}

export function resolveInputLineDescriptors(input: {
  valueGraphemes: readonly string[];
  wrapWidth: number;
}): InputLineDescriptor[] {
  const descriptors: InputLineDescriptor[] = [];
  const value = input.valueGraphemes.join("");
  const codeOffsets = buildCodeOffsets(input.valueGraphemes);
  const pushDescriptor = (start: number, end: number): void => {
    const normalizedStart = Math.max(0, Math.min(start, input.valueGraphemes.length));
    const normalizedEnd = Math.max(normalizedStart, Math.min(end, input.valueGraphemes.length));
    const codeStart = codeOffsets[normalizedStart] ?? 0;
    const codeEnd = codeOffsets[normalizedEnd] ?? codeStart;
    const text = value.slice(codeStart, codeEnd);
    descriptors.push({
      start: normalizedStart,
      end: normalizedEnd,
      text,
      textWidth: measureDisplayWidth(text),
      codeStart,
      codeEnd,
    });
  };

  let lineStart = 0;
  let lineWidth = 0;
  for (let index = 0; index < input.valueGraphemes.length; index += 1) {
    const grapheme = input.valueGraphemes[index] ?? "";
    if (grapheme === "\n") {
      pushDescriptor(lineStart, index);
      lineStart = index + 1;
      lineWidth = 0;
      continue;
    }
    const graphemeWidth = Math.max(1, getGraphemeDisplayWidth(grapheme));
    if (lineWidth > 0 && lineWidth + graphemeWidth > input.wrapWidth) {
      pushDescriptor(lineStart, index);
      lineStart = index;
      lineWidth = 0;
    }
    lineWidth += graphemeWidth;
  }
  pushDescriptor(lineStart, input.valueGraphemes.length);
  if (descriptors.length === 0) {
    pushDescriptor(0, 0);
  }
  return descriptors;
}

export function renderInlineImageTokensForDisplay(input: {
  text: string;
  theme: "plain" | "nerd_font" | "ccline" | undefined;
  selectedStartOffset?: number;
}): string {
  if (!input.text || !input.text.includes("[Image #")) {
    return input.text;
  }
  const tokenColor = resolveInlineImageTokenColor(input.theme);
  const chunks: string[] = [];
  let cursor = 0;
  for (const match of input.text.matchAll(INLINE_IMAGE_RENDER_PATTERN)) {
    const start = match.index ?? 0;
    const token = match[0] ?? "";
    if (start > cursor) {
      chunks.push(input.text.slice(cursor, start));
    }
    if (
      typeof input.selectedStartOffset === "number"
      && start === input.selectedStartOffset
    ) {
      chunks.push(`${ANSI_INVERSE}${tokenColor}${token}${ANSI_RESET}`);
    } else {
      chunks.push(`${tokenColor}${token}${ANSI_RESET}`);
    }
    cursor = start + token.length;
  }
  if (cursor < input.text.length) {
    chunks.push(input.text.slice(cursor));
  }
  return chunks.join("");
}

export function renderSubmittedInputTranscriptLines(input: {
  value: string;
  promptLabel?: string;
  terminalColumns?: number;
  theme?: "plain" | "nerd_font" | "ccline";
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
}): string[] {
  const promptLabel = input.promptLabel && input.promptLabel.length > 0
    ? input.promptLabel
    : DEFAULT_SESSION_PROMPT;
  const promptLabelWidth = Math.max(1, measureDisplayWidth(promptLabel));
  const terminalColumns =
    typeof input.terminalColumns === "number"
    && Number.isFinite(input.terminalColumns)
      ? Math.max(32, Math.floor(input.terminalColumns))
      : 96;
  const inputBodyWidth = resolveInteractiveInputBodyWidth({
    terminalColumns,
    promptLabelWidth,
  });
  const wrapWidth = Math.max(1, inputBodyWidth - promptLabelWidth);
  const graphemes = splitGraphemes(input.value);
  const descriptors = resolveInputLineDescriptors({
    valueGraphemes: graphemes,
    wrapWidth,
  });
  const continuationPrefix = " ".repeat(promptLabelWidth);
  const bodyLines = descriptors.map((descriptor, index) => {
    const prefix = index === 0 ? promptLabel : continuationPrefix;
    const renderedText = renderInlineImageTokensForDisplay({
      text: descriptor.text,
      theme: input.theme,
    });
    const highlightSuggestions = typeof input.getSlashSuggestions === "function"
      ? resolveSlashInputHighlightSuggestions({
        activeLineInput: descriptor.text,
        suggestions: [],
        getSlashSuggestions: input.getSlashSuggestions,
      })
      : [];
    const highlightedText = shouldHighlightSlashInputToken({
      activeLineInput: descriptor.text,
      suggestions: highlightSuggestions,
    })
      ? renderSlashCommandTokenHighlight(renderedText)
      : renderedText;
    return `${prefix}${highlightedText}`;
  });
  return renderInteractiveInputSurfaceChromeLines({
    bodyLines,
    inputBodyWidth,
    terminalColumns,
  });
}

export function resolveDraftAwareFooterLines(input: {
  footerLines: readonly string[];
  inputGraphemeLength: number;
}): string[] {
  if (input.inputGraphemeLength <= 0) {
    return [...input.footerLines];
  }
  return input.footerLines
    .map((line) => {
      const plainLine = stripAnsi(line);
      if (plainLine === SHORTCUT_HINT_TEXT) {
        return "";
      }
      const shortcutPrefix = `${SHORTCUT_HINT_TEXT} · `;
      if (plainLine.startsWith(shortcutPrefix)) {
        return plainLine.slice(shortcutPrefix.length).trimStart();
      }
      return line;
    })
    .filter((line) => line.length > 0);
}

function shouldRenderResolvedFooterLines(slotState: PromptSlotState): boolean {
  return slotState.bottomSlot.kind === "status"
    || slotState.bottomSlot.kind === "idle_hint"
    || slotState.bottomSlot.kind === "pending_ask"
    || slotState.bottomSlot.kind === "running_activity";
}

function renderShortcutHintFooterLine(): string {
  return `${ANSI_DIM}${SHORTCUT_HINT_TEXT}${ANSI_RESET}`;
}

function resolveFooterLinesForPromptSlot(input: {
  footerLines: readonly string[];
  promptSlotState: PromptSlotState;
  inputGraphemeLength: number;
}): string[] {
  if (input.promptSlotState.bottomSlot.kind === "idle_hint") {
    if (input.inputGraphemeLength > 0) {
      return [];
    }
    const existingHintLine = input.footerLines.find((line) =>
      stripAnsi(line).trim() === SHORTCUT_HINT_TEXT
    );
    return [existingHintLine ?? renderShortcutHintFooterLine()];
  }
  return resolveDraftAwareFooterLines({
    footerLines: input.footerLines,
    inputGraphemeLength: input.inputGraphemeLength,
  });
}

export function resolveSessionInputFooterLines(input: {
  footerLines: readonly string[];
  inputGraphemeLength: number;
  promptSlot?: Partial<PromptSlotStateInput>;
  hasSuggestions?: boolean;
  shortcutOverlayVisible?: boolean;
  historySearchOpen?: boolean;
  terminalRows?: number;
  fullscreen?: boolean;
}): {
  promptSlotState: PromptSlotState;
  footerLines: string[];
} {
  const promptSlotState = resolvePromptSlotState({
    ...(input.promptSlot ?? {}),
    inputVisible: input.promptSlot?.inputVisible ?? true,
    hasSuggestions: input.hasSuggestions,
    shortcutOverlayVisible: input.shortcutOverlayVisible,
    historySearchOpen: input.historySearchOpen,
    hasStatusLine: input.promptSlot?.hasStatusLine ?? input.footerLines.length > 0,
    hasDraft: input.inputGraphemeLength > 0,
    terminalRows: input.promptSlot?.terminalRows ?? input.terminalRows,
    fullscreen: input.promptSlot?.fullscreen ?? input.fullscreen,
  });
  if (!promptSlotState.bottomSlot.renderFooter || !shouldRenderResolvedFooterLines(promptSlotState)) {
    return {
      promptSlotState,
      footerLines: [],
    };
  }
  return {
    promptSlotState,
    footerLines: resolveFooterLinesForPromptSlot({
      footerLines: input.footerLines,
      promptSlotState,
      inputGraphemeLength: input.inputGraphemeLength,
    }),
  };
}

export function renderInteractiveInputChromeLines(input: {
  bodyLines: readonly string[];
  inputBodyWidth: number;
}): string[] {
  const inputContentWidth =
    typeof input.inputBodyWidth === "number" && Number.isFinite(input.inputBodyWidth)
      ? Math.max(1, Math.floor(input.inputBodyWidth))
      : 1;
  const bodyPadding = " ".repeat(INPUT_CHROME_BODY_LEFT_PADDING);
  const bodyPrefix = bodyPadding.length > 0 ? `${ANSI_DIM}${bodyPadding}${ANSI_RESET}` : "";
  const horizontal = "─".repeat(inputContentWidth + INPUT_CHROME_BODY_LEFT_PADDING);
  return [
    `${ANSI_DIM}${horizontal}${ANSI_RESET}`,
    ...input.bodyLines.map((line) =>
      `${bodyPrefix}${padToDisplayWidth(line, inputContentWidth)}`),
    `${ANSI_DIM}${horizontal}${ANSI_RESET}`,
  ];
}

export function renderPromptInputSurfaceLines(input: {
  lines: readonly string[];
  terminalColumns?: number;
}): string[] {
  const rendered = renderReactPromptInputLines({
    lines: input.lines,
    terminalColumns: input.terminalColumns,
  });
  return rendered.length > 0 ? rendered.split("\n") : [];
}

export function renderInteractiveInputSurfaceChromeLines(input: {
  bodyLines: readonly string[];
  inputBodyWidth: number;
  terminalColumns?: number;
}): string[] {
  return renderPromptInputSurfaceLines({
    lines: renderInteractiveInputChromeLines(input),
    terminalColumns: input.terminalColumns,
  });
}

export function resolveInteractiveInputBodyWidth(input: {
  terminalColumns: number;
  promptLabelWidth: number;
}): number {
  const terminalColumns =
    typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
      ? Math.max(1, Math.floor(input.terminalColumns))
      : 1;
  const promptLabelWidth =
    typeof input.promptLabelWidth === "number" && Number.isFinite(input.promptLabelWidth)
      ? Math.max(0, Math.floor(input.promptLabelWidth))
      : 0;
  return Math.max(promptLabelWidth + 8, terminalColumns);
}

export function resolveInteractiveInputCursorColumn(input: {
  promptRelativeCursorColumn: number;
}): number {
  if (
    typeof input.promptRelativeCursorColumn !== "number"
    || !Number.isFinite(input.promptRelativeCursorColumn)
  ) {
    return INPUT_CHROME_BODY_LEFT_PADDING;
  }
  return INPUT_CHROME_BODY_LEFT_PADDING + Math.max(
    0,
    Math.floor(input.promptRelativeCursorColumn),
  );
}

function resolveInlineImageTokenColor(theme: "plain" | "nerd_font" | "ccline" | undefined): string {
  if (theme === "ccline") {
    return ANSI_INLINE_IMAGE_TOKEN_CCLINE;
  }
  if (theme === "nerd_font") {
    return ANSI_INLINE_IMAGE_TOKEN_NERD;
  }
  return ANSI_INLINE_IMAGE_TOKEN_PLAIN;
}

export function renderSlashCommandTokenHighlight(text: string): string {
  if (!text) {
    return text;
  }
  const match = text.match(/^(\s*)(\/\S+)([\s\S]*)$/);
  if (!match) {
    return text;
  }
  const leading = match[1] ?? "";
  const commandToken = match[2] ?? "";
  const tail = match[3] ?? "";
  return `${leading}${ANSI_BOLD}${ANSI_SUGGESTION}${commandToken}${ANSI_RESET}${tail}`;
}

function resolveCursorLineIndex(input: {
  descriptors: readonly InputLineDescriptor[];
  cursor: number;
}): number {
  if (input.descriptors.length === 0) {
    return 0;
  }
  for (let index = 0; index < input.descriptors.length; index += 1) {
    const descriptor = input.descriptors[index];
    if (input.cursor >= descriptor.start && input.cursor <= descriptor.end) {
      return index;
    }
  }
  return input.descriptors.length - 1;
}

function resolvePromptRelativeCursorColumn(input: {
  graphemes: readonly string[];
  cursor: number;
  descriptor: InputLineDescriptor;
  promptLabelWidth: number;
}): number {
  const value = input.graphemes.join("");
  const codeOffsets = buildCodeOffsets(input.graphemes);
  const currentCodeOffset = codeOffsets[input.cursor] ?? codeOffsets[codeOffsets.length - 1] ?? 0;
  const before = value.slice(input.descriptor.codeStart, currentCodeOffset);
  return input.promptLabelWidth + measureDisplayWidth(before);
}

function resolveInlineImageTokenCodeOffsetAtCursor(input: {
  graphemes: readonly string[];
  cursor: number;
}): number | undefined {
  const value = input.graphemes.join("");
  const cursorCodeOffset = codeOffsetFromGraphemeIndex(input.graphemes, input.cursor);
  for (const match of value.matchAll(INLINE_IMAGE_RENDER_PATTERN)) {
    const start = match.index ?? -1;
    if (start === cursorCodeOffset) {
      return start;
    }
  }
  return undefined;
}

function resolvePromptTurnSlashSuggestions(input: {
  activeLineInput: string;
  activeSlashSuggestionIndex: number;
  lastSlashLineInput: string;
  slashSuggestionsHiddenForLine: string;
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
}): {
  suggestions: readonly SessionSlashSuggestion[];
  panelLines: string[];
  activeSlashSuggestionIndex: number;
  lastSlashLineInput: string;
  slashSuggestionsHiddenForLine: string;
} {
  let activeSlashSuggestionIndex = input.activeSlashSuggestionIndex;
  let lastSlashLineInput = input.lastSlashLineInput;
  let slashSuggestionsHiddenForLine = input.slashSuggestionsHiddenForLine;
  if (typeof input.getSlashSuggestions !== "function") {
    return {
      suggestions: [],
      panelLines: [],
      activeSlashSuggestionIndex,
      lastSlashLineInput,
      slashSuggestionsHiddenForLine,
    };
  }
  if (!input.activeLineInput.trimStart().startsWith("/")) {
    return {
      suggestions: [],
      panelLines: [],
      activeSlashSuggestionIndex: 0,
      lastSlashLineInput: "",
      slashSuggestionsHiddenForLine: "",
    };
  }
  if (input.activeLineInput !== lastSlashLineInput) {
    activeSlashSuggestionIndex = 0;
    lastSlashLineInput = input.activeLineInput;
    if (slashSuggestionsHiddenForLine === input.activeLineInput) {
      slashSuggestionsHiddenForLine = "";
    }
  }
  if (slashSuggestionsHiddenForLine === input.activeLineInput) {
    return {
      suggestions: [],
      panelLines: [],
      activeSlashSuggestionIndex,
      lastSlashLineInput,
      slashSuggestionsHiddenForLine,
    };
  }
  const suggestions = input.getSlashSuggestions(input.activeLineInput);
  if (suggestions.length === 0) {
    return {
      suggestions,
      panelLines: [],
      activeSlashSuggestionIndex: 0,
      lastSlashLineInput,
      slashSuggestionsHiddenForLine,
    };
  }
  activeSlashSuggestionIndex = normalizeSuggestionIndex(
    suggestions.length,
    activeSlashSuggestionIndex,
  );
  const panel = formatSlashSuggestionPanel(
    suggestions,
    input.activeLineInput,
    activeSlashSuggestionIndex,
    resolveSlashOverlayColumns(),
  );
  return {
    suggestions,
    panelLines: panel
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0),
    activeSlashSuggestionIndex,
    lastSlashLineInput,
    slashSuggestionsHiddenForLine,
  };
}

export function buildPromptInputRenderSnapshot(
  input: PromptInputRenderSnapshotInput,
): PromptInputRenderSnapshotResolution {
  const terminalColumns = Math.max(32, input.terminalColumns);
  const promptLabel = input.resolvedPrompt.inlinePrompt.length > 0
    ? input.resolvedPrompt.inlinePrompt
    : DEFAULT_SESSION_PROMPT;
  const inputBodyWidth = resolveInteractiveInputBodyWidth({
    terminalColumns,
    promptLabelWidth: input.promptLabelWidth,
  });
  const wrapWidth = Math.max(1, inputBodyWidth - input.promptLabelWidth);
  const descriptors = resolveInputLineDescriptors({
    valueGraphemes: input.graphemes,
    wrapWidth,
  });
  const cursor = Math.max(0, Math.min(input.cursor, input.graphemes.length));
  const activeLineIndex = resolveCursorLineIndex({
    descriptors,
    cursor,
  });
  const activeDescriptor = descriptors[activeLineIndex] ?? descriptors[0]!;
  const activeLineInput = activeDescriptor?.text ?? "";
  const selectedTokenCodeOffset = resolveInlineImageTokenCodeOffsetAtCursor({
    graphemes: input.graphemes,
    cursor,
  });
  const slash = resolvePromptTurnSlashSuggestions({
    activeLineInput,
    activeSlashSuggestionIndex: input.activeSlashSuggestionIndex,
    lastSlashLineInput: input.lastSlashLineInput,
    slashSuggestionsHiddenForLine: input.slashSuggestionsHiddenForLine,
    getSlashSuggestions: input.getSlashSuggestions,
  });
  let shortcutOverlayVisible = input.shortcutOverlayVisible;
  if (shortcutOverlayVisible && slash.panelLines.length > 0) {
    shortcutOverlayVisible = false;
  }
  const highlightSuggestions = resolveSlashInputHighlightSuggestions({
    activeLineInput,
    suggestions: slash.suggestions,
    getSlashSuggestions: input.getSlashSuggestions,
  });
  const exactSlashMatch = shouldHighlightSlashInputToken({
    activeLineInput,
    suggestions: highlightSuggestions,
  });
  const shortcutOverlayLines = shortcutOverlayVisible
    ? renderShortcutOverlayFooter({ terminalColumns }).split("\n")
    : [];
  const footerResolution = resolveSessionInputFooterLines({
    footerLines: input.footerLines,
    inputGraphemeLength: input.graphemes.length,
    promptSlot: input.resolvedPrompt.promptSlot,
    hasSuggestions: slash.panelLines.length > 0,
    shortcutOverlayVisible,
    historySearchOpen: input.historySearchInFlight,
    terminalRows: input.terminalRows,
    fullscreen: true,
  });
  const bodyLines: string[] = descriptors.map((descriptor, index) => {
    const prefix = index === 0 ? promptLabel : input.continuationPrefix;
    const selectedOffsetInLine =
      typeof selectedTokenCodeOffset === "number"
      && selectedTokenCodeOffset >= descriptor.codeStart
      && selectedTokenCodeOffset < descriptor.codeEnd
        ? selectedTokenCodeOffset - descriptor.codeStart
        : undefined;
    const renderedText = renderInlineImageTokensForDisplay({
      text: descriptor.text,
      theme: input.inlineImageTheme,
      selectedStartOffset: selectedOffsetInLine,
    });
    const highlightedText = exactSlashMatch && index === activeLineIndex
      ? renderSlashCommandTokenHighlight(renderedText)
      : renderedText;
    return `${prefix}${highlightedText}`;
  });
  const rawRenderedLines = [
    ...renderInteractiveInputChromeLines({
      bodyLines,
      inputBodyWidth,
    }),
    ...slash.panelLines,
    ...shortcutOverlayLines,
    ...footerResolution.footerLines,
  ];
  const renderedLines = renderPromptInputSurfaceLines({
    lines: rawRenderedLines,
    terminalColumns,
  });
  const cursorRenderLineIndex = 1 + activeLineIndex;
  const cursorColumn = resolvePromptRelativeCursorColumn({
    graphemes: input.graphemes,
    cursor,
    descriptor: activeDescriptor,
    promptLabelWidth: input.promptLabelWidth,
  });
  return {
    snapshot: {
      renderedLines,
      cursorRenderLineIndex,
      cursorColumn: resolveInteractiveInputCursorColumn({
        promptRelativeCursorColumn: cursorColumn,
      }),
      descriptors,
      activeLineIndex,
      activeLineInput,
      activeSlashSuggestions: slash.suggestions,
    },
    activeSlashSuggestionIndex: slash.activeSlashSuggestionIndex,
    lastSlashLineInput: slash.lastSlashLineInput,
    slashSuggestionsHiddenForLine: slash.slashSuggestionsHiddenForLine,
    shortcutOverlayVisible,
  };
}
