import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as readlineModule from "node:readline";
import { type RuntimeAttachment } from "../../../../models/types";
import { removeTrailingSlashes } from "../services/runtime-paths";
import { createCliUiRenderer } from "../ui/kernel/renderer";
import {
  resolveInteractivePromptLayout,
  type SessionPromptLayout,
} from "../ui/interactive/interactive-frame";
import {
  formatSlashSuggestionPanel,
  normalizeSuggestionIndex,
  resolveSlashOverlayColumns,
} from "../ui/interactive/slash-overlay";
import {
  getGraphemeDisplayWidth,
  measureDisplayWidth,
  padToDisplayWidth,
  splitGraphemes,
  stripAnsi,
} from "../ui/interactive/display-width";
import {
  normalizeSelectNavigationState,
  reduceSelectNavigation,
  type SelectNavigationAction,
} from "../ui/interactive/select-navigation";
import {
  type TerminalSelectMenuInput,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuResult,
} from "../ui/screens/select-menu-screen";
import {
  renderAskUserPanelScreen,
} from "../ui/screens/ask-user-panel-screen";
import {
  renderShortcutOverlayFooter,
} from "../ui/screens/bottom-pane-screen";
import {
  buildAskUserBatchAnswerText,
  buildAskUserQuestionnaireView,
  createAskUserQuestionnaireState,
  reduceAskUserQuestionnaire,
  resolveAskUserAnswerFromSelection,
  type AskUserEnvelope,
  type AskUserQuestionnaireState,
  type AskUserQuestionnaireView,
} from "../../../../tools/ask-user";

const HANDOFF_FILENAME = "HANDOFF.md";
const DEFAULT_SESSION_PROMPT = "❯ ";
const INLINE_IMAGE_PARSE_PATTERN = /\[Image #(\d+)\]/g;
const INLINE_IMAGE_RENDER_PATTERN = /\[Image #\d+\]/g;
const INLINE_IMAGE_REGISTRY_LIMIT = 512;
const ANSI_RESET = "\u001B[0m";
const ANSI_BOLD = "\u001B[1m";
const ANSI_DIM = "\u001B[90m";
const ANSI_BRAND = "\u001B[38;2;202;124;94m";
const ANSI_SUGGESTION = ANSI_BRAND;
const ANSI_INVERSE = "\u001B[7m";
const ANSI_INLINE_IMAGE_TOKEN_PLAIN = ANSI_BRAND;
const ANSI_INLINE_IMAGE_TOKEN_NERD = ANSI_BRAND;
const ANSI_INLINE_IMAGE_TOKEN_CCLINE = `\u001B[1m${ANSI_BRAND}`;
const BRACKETED_PASTE_START = "\u001B[200~";
const BRACKETED_PASTE_END = "\u001B[201~";
const BRACKETED_PASTE_BLOCK_PATTERN = /\u001B\[200~([\s\S]*?)\u001B\[201~/g;
const BRACKETED_PASTE_BUFFER_LIMIT = 16_384;
const PLAIN_ENTER_FALLBACK_DELAY_MS = 60;
const ENTER_KEYPRESS_DEDUP_WINDOW_MS = 80;
const DEFAULT_SELECT_VISIBLE_OPTION_COUNT = 5;
const MODEL_PICKER_VISIBLE_OPTION_COUNT = 10;
const INPUT_CHROME_BODY_LEFT_PADDING = 0;

const INLINE_IMAGE_REGISTRY = new Map<number, RuntimeAttachment>();
let nextInlineImageId = 1;

export type {
  TerminalSelectMenuInput,
  TerminalSelectMenuItem,
  TerminalSelectMenuResult,
} from "../ui/screens/select-menu-screen";

export interface SessionInputLoopControls {
  withInputPaused<T>(operation: () => Promise<T>): Promise<T>;
}

export type SessionEscapeInterruptPhase = "idle" | "running";

export interface SessionInputLoopOptions {
  onEscapeInterrupt?: (phase: SessionEscapeInterruptPhase) => void | Promise<void>;
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
  getInlineImageHighlightTheme?: () => "plain" | "nerd_font" | "ccline" | undefined;
  shouldSuppressSubmitTranscript?: (value: string) => boolean;
  openHistorySearch?: (input: {
    currentInput: string;
  }) => Promise<string | undefined>;
}

type SessionInputPromptValue = string | SessionPromptLayout;

export type SessionInputPrompt = SessionInputPromptValue | (() => SessionInputPromptValue);

export interface SessionSlashSuggestion {
  command: string;
  description?: string;
  source?: string;
}

interface MenuInputStream {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
  on?: (event: "data", listener: (chunk: string) => void) => void;
  off?: (event: "data", listener: (chunk: string) => void) => void;
  resume?: () => void;
  pause?: () => void;
  setEncoding?: (encoding: string) => void;
}

interface KeypressPayload {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

interface KeypressInputStream {
  on?: (event: "keypress", listener: (chunk: string, key: KeypressPayload) => void) => void;
  off?: (event: "keypress", listener: (chunk: string, key: KeypressPayload) => void) => void;
}

export interface SlashSuggestionApplyResult {
  command: string;
  submitImmediately: boolean;
}

export type SlashSuggestionKey = "enter" | "tab" | "escape";

export type SlashSuggestionKeyAction =
  | { kind: "noop" }
  | { kind: "hide_panel"; hiddenLineInput: string }
  | { kind: "apply"; appliedCommand: string; submitImmediately: boolean };

export type SubmitKeyAction = "submit" | "newline" | "none";

export interface CoalescedSubmitChunkResolution {
  normalizedChunk: string;
  shouldSubmit: boolean;
}

export type InteractiveEnterDataAction = "none" | "defer_to_keypress" | "submit";
export type ShortcutOverlayKeyAction = "none" | "toggle_overlay" | "insert_text";

export type MenuInputAction =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "page_up" }
  | { kind: "page_down" }
  | { kind: "enter" }
  | { kind: "cancel" }
  | { kind: "ignore" }
  | { kind: "select_index"; index: number };

export type TerminalLinePromptResult =
  | { kind: "submitted"; value: string }
  | { kind: "cancelled" };

export interface TerminalAskUserQuestionnairePanelInput {
  queue: readonly AskUserEnvelope[];
  initialState?: AskUserQuestionnaireState;
  terminalColumns?: number;
}

export type TerminalAskUserQuestionnairePanelResult =
  | {
    kind: "submitted";
    answers: Record<string, string>;
    text: string;
  }
  | { kind: "cancelled" };

interface InputLineDescriptor {
  start: number;
  end: number;
  text: string;
  textWidth: number;
  codeStart: number;
  codeEnd: number;
}

const MENU_DIGIT_SELECTION_COMMIT_DELAY_MS = 250;
const MENU_TRANSITION_DELAY_LIMIT_MS = 160;
const MENU_OPEN_FRAME_DELAY_DEFAULTS: readonly [number, number] = [18, 34];
const MENU_CLOSE_FRAME_DELAY_DEFAULTS: readonly [number, number] = [14, 28];
const ANSI_SEQUENCE_PATTERN = /\x1b\[[0-9;?]+[A-Za-z]/g;
const MENU_SEARCH_QUERY_LIMIT = 80;
const MENU_SEARCH_TOGGLE_CONTROL = "\u0006"; // Ctrl+f
const MENU_SEARCH_CLEAR_CONTROL = "\u0015"; // Ctrl+u

type MenuTransitionDelays = readonly [number, number];
type MenuTransitionPresetName = "fast" | "medium" | "slow";
type MenuTransitionFrameKind =
  | "open_initial"
  | "open_mid"
  | "close_initial"
  | "close_mid";

const MENU_TRANSITION_PRESETS: Readonly<
  Record<MenuTransitionPresetName, { open: MenuTransitionDelays; close: MenuTransitionDelays }>
> = {
  fast: {
    open: [12, 22],
    close: [10, 20],
  },
  medium: {
    open: MENU_OPEN_FRAME_DELAY_DEFAULTS,
    close: MENU_CLOSE_FRAME_DELAY_DEFAULTS,
  },
  slow: {
    open: [24, 44],
    close: [18, 34],
  },
};

function stripMenuTransitionAnsi(valueRaw: string): string {
  return valueRaw.replace(ANSI_SEQUENCE_PATTERN, "");
}

function resolveMenuTransitionPreset(valueRaw: string | undefined): {
  open: MenuTransitionDelays;
  close: MenuTransitionDelays;
} {
  const value = (valueRaw ?? "").trim().toLowerCase();
  if (value === "fast") {
    return MENU_TRANSITION_PRESETS.fast;
  }
  if (value === "slow") {
    return MENU_TRANSITION_PRESETS.slow;
  }
  return MENU_TRANSITION_PRESETS.medium;
}

function resolveMenuTransitionDelays(
  valueRaw: string | undefined,
  fallback: MenuTransitionDelays,
): [number, number] {
  const value = (valueRaw ?? "").trim();
  if (value.length === 0) {
    return [fallback[0], fallback[1]];
  }
  const segments = value.split(/[,\s]+/).map((segment) => segment.trim()).filter((segment) =>
    segment.length > 0
  );
  if (segments.length < 2) {
    return [fallback[0], fallback[1]];
  }
  const first = Number.parseInt(segments[0] ?? "", 10);
  const second = Number.parseInt(segments[1] ?? "", 10);
  if (!Number.isFinite(first) || !Number.isFinite(second) || first < 0 || second < 0) {
    return [fallback[0], fallback[1]];
  }
  return [
    Math.min(MENU_TRANSITION_DELAY_LIMIT_MS, Math.floor(first)),
    Math.min(MENU_TRANSITION_DELAY_LIMIT_MS, Math.floor(second)),
  ];
}

function buildMenuTransitionFrame(
  menuLines: readonly string[],
  kind: MenuTransitionFrameKind,
): string[] {
  return menuLines.map((line, index) => {
    const plain = stripMenuTransitionAnsi(line);
    if (plain.trim().length === 0) {
      return "";
    }
    const isSecondaryLine = plain.startsWith("  ");
    if (kind === "open_initial") {
      if (index <= 1) {
        return plain;
      }
      if (isSecondaryLine) {
        return "";
      }
      return `${ANSI_DIM}${plain}${ANSI_RESET}`;
    }
    if (kind === "open_mid") {
      if (index <= 1) {
        return plain;
      }
      return `${ANSI_DIM}${plain}${ANSI_RESET}`;
    }
    if (kind === "close_initial") {
      return `${ANSI_DIM}${plain}${ANSI_RESET}`;
    }
    if (isSecondaryLine) {
      return "";
    }
    return `${ANSI_DIM}${plain}${ANSI_RESET}`;
  });
}

function buildCodeOffsets(graphemes: readonly string[]): number[] {
  const offsets: number[] = [0];
  let total = 0;
  for (const grapheme of graphemes) {
    total += grapheme.length;
    offsets.push(total);
  }
  return offsets;
}

function resolveInputLineDescriptors(input: {
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

function renderInlineImageTokensForDisplay(input: {
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
    return `${prefix}${renderInlineImageTokensForDisplay({
      text: descriptor.text,
      theme: input.theme,
    })}`;
  });
  return renderInteractiveInputChromeLines({
    bodyLines,
    inputBodyWidth,
  });
}

export interface InlineAttachmentResolution {
  userInput: string;
  attachments: RuntimeAttachment[];
}

export function resolveSlashSuggestionApplyResult(
  commandRaw: string,
): SlashSuggestionApplyResult {
  const trimmed = commandRaw.trim();
  if (!trimmed) {
    return {
      command: commandRaw,
      submitImmediately: false,
    };
  }
  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return {
      command: trimmed,
      submitImmediately: false,
    };
  }
  const firstRequiredIndex = tokens.findIndex((token) => /^<[^>]+>$/.test(token));
  const firstOptionalIndex = tokens.findIndex((token) => /^\[[^\]]+\]$/.test(token));
  const firstPlaceholderIndex = [firstRequiredIndex, firstOptionalIndex]
    .filter((index) => index >= 0)
    .reduce((current, index) => Math.min(current, index), tokens.length);
  const baseTokens = firstPlaceholderIndex > 0
    ? tokens.slice(0, firstPlaceholderIndex)
    : [tokens[0]];
  const hasRequiredPlaceholder = firstRequiredIndex >= 0;
  const hasPlaceholder = firstPlaceholderIndex < tokens.length;
  const baseCommand = baseTokens.join(" ");
  return {
    command: hasPlaceholder ? `${baseCommand} ` : baseCommand,
    submitImmediately: !hasRequiredPlaceholder,
  };
}

function hasSlashCommandArguments(activeLineInputRaw: string | undefined): boolean {
  const activeLineInput = (activeLineInputRaw ?? "").trim();
  if (!activeLineInput.startsWith("/")) {
    return false;
  }
  const firstSpace = activeLineInput.indexOf(" ");
  if (firstSpace < 0) {
    return false;
  }
  return activeLineInput.slice(firstSpace + 1).trim().length > 0;
}

export function resolveSlashSuggestionKeyAction(input: {
  key: SlashSuggestionKey;
  hasActiveSuggestions: boolean;
  selectedCommand?: string;
  activeLineInput?: string;
}): SlashSuggestionKeyAction {
  if (!input.hasActiveSuggestions) {
    return { kind: "noop" };
  }
  if (input.key === "escape") {
    return {
      kind: "hide_panel",
      hiddenLineInput: input.activeLineInput ?? "",
    };
  }
  if (hasSlashCommandArguments(input.activeLineInput)) {
    // Keep explicit user arguments intact (for example `/plan <goal>`), instead
    // of replacing the whole line with the selected slash command.
    return { kind: "noop" };
  }
  const selectedCommand = input.selectedCommand?.trim();
  if (!selectedCommand) {
    return { kind: "noop" };
  }
  const applied = resolveSlashSuggestionApplyResult(selectedCommand);
  return {
    kind: "apply",
    appliedCommand: applied.command,
    submitImmediately: input.key === "enter" ? applied.submitImmediately : false,
  };
}

function parseCsiUKeypressSequence(
  sequenceRaw: string,
): { codepoint: number; shift: boolean; meta: boolean; ctrl: boolean } | undefined {
  const sequence = sequenceRaw.trim();
  const match = sequence.match(/^\u001b\[(\d+)(?:;(\d+))?u$/);
  if (!match) {
    return undefined;
  }
  const codepoint = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(codepoint) || codepoint <= 0) {
    return undefined;
  }
  const encodedModifiers = Number.parseInt(match[2] ?? "1", 10);
  const modifierMask = Number.isFinite(encodedModifiers) && encodedModifiers > 0
    ? Math.max(0, encodedModifiers - 1)
    : 0;
  return {
    codepoint,
    shift: (modifierMask & 0b0001) !== 0,
    meta: (modifierMask & 0b0010) !== 0 || (modifierMask & 0b1000) !== 0,
    ctrl: (modifierMask & 0b0100) !== 0,
  };
}

function isLegacyEnterSequence(sequence: string): boolean {
  return sequence === "\u001bOM" || sequence === "\u001b[13~";
}

export function resolveSubmitKeyAction(input: {
  chunk: string;
  key: KeypressPayload;
}): SubmitKeyAction {
  const rawChunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? rawChunk);
  const normalizedName = (input.key.name ?? "").trim().toLowerCase();
  const csiInfo = parseCsiUKeypressSequence(sequence)
    ?? parseCsiUKeypressSequence(rawChunk);
  const keyIndicatesEnter =
    normalizedName === "return"
    || normalizedName === "enter";
  const rawIndicatesEnter =
    sequence === "\r"
    || sequence === "\n"
    || rawChunk === "\r"
    || rawChunk === "\n"
    || isLegacyEnterSequence(sequence)
    || isLegacyEnterSequence(rawChunk);
  const csiIndicatesEnter = csiInfo?.codepoint === 13 || csiInfo?.codepoint === 10;
  if (!keyIndicatesEnter && !rawIndicatesEnter && !csiIndicatesEnter) {
    return "none";
  }
  const shift = Boolean(input.key.shift || csiInfo?.shift);
  const meta = Boolean(input.key.meta || csiInfo?.meta);
  if (shift || meta) {
    return "newline";
  }
  return "submit";
}

export function isHistorySearchShortcut(input: {
  chunk: string;
  key: KeypressPayload;
}): boolean {
  const chunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? chunk);
  const name = (input.key.name ?? "").trim().toLowerCase();
  if (input.key.ctrl && name === "r") {
    return true;
  }
  return sequence === "\u0012" || chunk === "\u0012";
}

export type InputShortcutAction = "none" | "sigint" | "history_search";

export function resolveInputShortcutAction(input: {
  chunk: string;
  key: KeypressPayload;
}): InputShortcutAction {
  const chunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? chunk);
  const name = (input.key.name ?? "").trim().toLowerCase();
  if (
    (input.key.ctrl && name === "c")
    || sequence === "\u0003"
    || chunk === "\u0003"
  ) {
    return "sigint";
  }
  if (isHistorySearchShortcut(input)) {
    return "history_search";
  }
  return "none";
}

export function resolveShortcutOverlayKeyAction(input: {
  chunk: string;
  key: KeypressPayload;
  inputGraphemeLength: number;
  hasActiveSlashSuggestions?: boolean;
}): ShortcutOverlayKeyAction {
  const chunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? chunk);
  const name = (input.key.name ?? "").trim().toLowerCase();
  const isQuestionMark = chunk === "?" || sequence === "?" || name === "?";
  if (!isQuestionMark || input.key.ctrl || input.key.meta) {
    return "none";
  }
  if ((input.hasActiveSlashSuggestions ?? false) || input.inputGraphemeLength > 0) {
    return "insert_text";
  }
  return "toggle_overlay";
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
      const shortcutHint = "? for shortcuts";
      const plainLine = stripAnsi(line);
      if (plainLine === shortcutHint) {
        return "";
      }
      const shortcutPrefix = `${shortcutHint} · `;
      if (plainLine.startsWith(shortcutPrefix)) {
        return plainLine.slice(shortcutPrefix.length).trimStart();
      }
      return line;
    })
    .filter((line) => line.length > 0);
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

export function resolveCoalescedSubmitChunk(
  chunkRaw: string,
): CoalescedSubmitChunkResolution {
  const chunk = String(chunkRaw ?? "");
  const trailingLength = chunk.endsWith("\r\n")
    ? 2
    : chunk.endsWith("\r") || chunk.endsWith("\n")
      ? 1
      : 0;
  if (trailingLength === 0) {
    return {
      normalizedChunk: chunk,
      shouldSubmit: false,
    };
  }
  const payload = chunk.slice(0, chunk.length - trailingLength);
  if (
    payload.includes("\r")
    || payload.includes("\n")
    || payload.endsWith("\\")
    || payload.includes("\u001b")
  ) {
    return {
      normalizedChunk: chunk,
      shouldSubmit: false,
    };
  }
  return {
    normalizedChunk: payload,
    shouldSubmit: true,
  };
}

export function isPlainEnterDataChunk(chunkRaw: string): boolean {
  const chunk = String(chunkRaw ?? "");
  return chunk === "\r" || chunk === "\n" || chunk === "\r\n";
}

export function resolveInteractiveEnterDataAction(input: {
  chunk: string;
  keypressSupported: boolean;
  keypressHandledRecently?: boolean;
}): InteractiveEnterDataAction {
  if (!isPlainEnterDataChunk(input.chunk)) {
    return "none";
  }
  if (!input.keypressSupported) {
    return "submit";
  }
  return input.keypressHandledRecently ? "none" : "defer_to_keypress";
}

export function resolveMenuIndexFromDigits(
  digitsRaw: string,
  itemsLength: number,
): number | undefined {
  if (!/^[0-9]+$/.test(digitsRaw)) {
    return undefined;
  }
  const parsed = Number.parseInt(digitsRaw, 10);
  if (
    !Number.isFinite(parsed)
    || parsed <= 0
    || parsed > itemsLength
    || String(parsed) !== digitsRaw
  ) {
    return undefined;
  }
  return parsed - 1;
}

export function resolveFirstMenuPrefixMatchIndex(
  digitsPrefixRaw: string,
  itemsLength: number,
): number | undefined {
  if (!/^[0-9]+$/.test(digitsPrefixRaw)) {
    return undefined;
  }
  for (let index = 1; index <= itemsLength; index += 1) {
    if (String(index).startsWith(digitsPrefixRaw)) {
      return index - 1;
    }
  }
  return undefined;
}

export function hasMenuDigitsContinuation(
  digitsPrefixRaw: string,
  itemsLength: number,
): boolean {
  if (!/^[0-9]+$/.test(digitsPrefixRaw)) {
    return false;
  }
  for (let index = 1; index <= itemsLength; index += 1) {
    const candidate = String(index);
    if (candidate.startsWith(digitsPrefixRaw) && candidate.length > digitsPrefixRaw.length) {
      return true;
    }
  }
  return false;
}

function buildInlineImagePlaceholder(id: number): string {
  return `[Image #${String(id)}]`;
}

function registerInlineImageAttachment(attachment: RuntimeAttachment): string {
  const id = nextInlineImageId;
  nextInlineImageId += 1;
  INLINE_IMAGE_REGISTRY.set(id, attachment);
  if (INLINE_IMAGE_REGISTRY.size > INLINE_IMAGE_REGISTRY_LIMIT) {
    const oldest = INLINE_IMAGE_REGISTRY.keys().next();
    if (!oldest.done) {
      INLINE_IMAGE_REGISTRY.delete(oldest.value);
    }
  }
  return buildInlineImagePlaceholder(id);
}

function resolveProcessPlatform(): string {
  const runtimeProcess = process as unknown as { platform?: string };
  return (runtimeProcess.platform ?? "").toLowerCase();
}

function trimTrailingSlashes(path: string): string {
  if (/^[\\/]+$/.test(path)) {
    return path.startsWith("\\") ? "\\" : "/";
  }
  return path.replace(/[\\/]+$/, "");
}

function concatPath(basePath: string, segment: string): string {
  const normalizedBase = trimTrailingSlashes(basePath);
  if (normalizedBase === "/" || normalizedBase === "\\") {
    return `${normalizedBase}${segment}`;
  }
  return `${normalizedBase}/${segment}`;
}

function resolveTempBaseDir(): string {
  const candidates = [
    process.env.CLAUDE_CODE_TMPDIR,
    process.env.TMPDIR,
    process.env.TEMP,
    process.env.TMP,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
  }
  return "/tmp";
}

function resolveClipboardImageTempDir(): string {
  const customDir = process.env.GROBOT_CLIPBOARD_IMAGE_DIR?.trim();
  if (customDir && customDir.length > 0) {
    return customDir;
  }
  return concatPath(resolveTempBaseDir(), "grobot-inline-images");
}

function saveClipboardImageToTempFile(): RuntimeAttachment | undefined {
  if (resolveProcessPlatform() !== "darwin") {
    return undefined;
  }
  const tempDir = resolveClipboardImageTempDir();
  mkdirSync(tempDir, { recursive: true });
  const filePath = concatPath(
    tempDir,
    `clipboard-${String(Date.now())}-${Math.random().toString(16).slice(2, 8)}.png`,
  );
  const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const result = spawnSync(
    "osascript",
    [
      "-e",
      "set png_data to (the clipboard as «class PNGf»)",
      "-e",
      `set fp to open for access POSIX file "${escapedPath}" with write permission`,
      "-e",
      "write png_data to fp",
      "-e",
      "close access fp",
    ],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return undefined;
  }
  return {
    type: "image",
    sourceType: "path",
    source: filePath,
    mimeType: "image/png",
    filename: filePath.slice(filePath.lastIndexOf("/") + 1),
  };
}

export function resolveInlineAttachmentsFromInput(
  userInput: string,
): InlineAttachmentResolution {
  const matches = [...userInput.matchAll(INLINE_IMAGE_PARSE_PATTERN)];
  if (matches.length === 0) {
    return {
      userInput,
      attachments: [],
    };
  }
  const attachments: RuntimeAttachment[] = [];
  const seen = new Set<number>();
  for (const match of matches) {
    const id = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const attachment = INLINE_IMAGE_REGISTRY.get(id);
    if (!attachment) {
      continue;
    }
    attachments.push(attachment);
  }
  return {
    userInput,
    attachments,
  };
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

function renderSlashCommandTokenHighlight(text: string): string {
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

export function shouldHighlightSlashInputToken(input: {
  activeLineInput: string;
  suggestions: readonly SessionSlashSuggestion[];
}): boolean {
  const normalizedInput = input.activeLineInput.trim();
  const inputToken = normalizedInput.split(/\s+/, 1)[0] ?? "";
  if (!inputToken.startsWith("/")) {
    return false;
  }
  return input.suggestions.some((suggestion) => {
    const suggestionToken = suggestion.command.trim().split(/\s+/, 1)[0] ?? "";
    if (!suggestionToken) {
      return false;
    }
    return suggestionToken === inputToken;
  });
}

function stripBracketedPasteMarkers(value: string): string {
  if (!value || !value.includes("\u001B[")) {
    return value;
  }
  return value
    .split(BRACKETED_PASTE_START)
    .join("")
    .split(BRACKETED_PASTE_END)
    .join("");
}

function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function emitKeypressEventsCompat(input: unknown): void {
  const maybeEmit = (readlineModule as unknown as {
    emitKeypressEvents?: (stream: unknown) => void;
  }).emitKeypressEvents;
  if (typeof maybeEmit === "function") {
    maybeEmit(input);
  }
}

export function buildHandoffPath(projectRoot: string): string {
  return `${projectRoot}/${HANDOFF_FILENAME}`;
}

export function writeHandoffFile(path: string, content: string): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function runSessionInputLoop(
  handler: (input: string, controls: SessionInputLoopControls) => Promise<"continue" | "break">,
  prompt: SessionInputPrompt = DEFAULT_SESSION_PROMPT,
  options: SessionInputLoopOptions = {},
): Promise<void> {
  const nonTtyControls: SessionInputLoopControls = {
    withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
  };
  if (!process.stdin.isTTY) {
    let stdinContent = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      stdinContent += String(chunk);
    }
    const lines = stdinContent.split(/\r?\n/);
    for (const line of lines) {
      const action = await handler(line, nonTtyControls);
      if (action === "break") {
        break;
      }
    }
    return;
  }
  interface InputRenderSnapshot {
    renderedLines: string[];
    cursorRenderLineIndex: number;
    cursorColumn: number;
    descriptors: InputLineDescriptor[];
    activeLineIndex: number;
    activeLineInput: string;
    activeSlashSuggestions: readonly SessionSlashSuggestion[];
  }

  const menuInput = process.stdin as unknown as MenuInputStream;
  const keypressInput = process.stdin as unknown as KeypressInputStream;
  const canUseRawMode = Boolean(
    typeof menuInput.setRawMode === "function"
    && typeof menuInput.on === "function"
    && typeof menuInput.off === "function"
    && typeof keypressInput.on === "function"
    && typeof keypressInput.off === "function",
  );
  if (!canUseRawMode) {
    // Fallback for unusual TTY implementations.
    let stdinContent = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      stdinContent += String(chunk);
    }
    const lines = stdinContent.split(/\r?\n/);
    for (const line of lines) {
      const action = await handler(line, nonTtyControls);
      if (action === "break") {
        break;
      }
    }
    return;
  }

  menuInput.setEncoding?.("utf8");
  emitKeypressEventsCompat(process.stdin);
  let rawModeEnabled = false;
  let pauseDepth = 0;
  let escArmedAt = 0;
  let handlerRunning = false;

  const setRawMode = (enabled: boolean): void => {
    if (rawModeEnabled === enabled) {
      return;
    }
    try {
      menuInput.setRawMode?.(enabled);
      rawModeEnabled = enabled;
    } catch {
      // ignore raw-mode transition failures
    }
  };

  const controls: SessionInputLoopControls = {
    withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => {
      pauseDepth += 1;
      if (pauseDepth === 1) {
        setRawMode(false);
      }
      try {
        return await operation();
      } finally {
        pauseDepth = Math.max(0, pauseDepth - 1);
        if (pauseDepth === 0) {
          setRawMode(true);
        }
      }
    },
  };

  const triggerEscInterrupt = (phase: SessionEscapeInterruptPhase): void => {
    if (typeof options.onEscapeInterrupt !== "function") {
      return;
    }
    const maybePromise = options.onEscapeInterrupt(phase);
    if (typeof (maybePromise as Promise<void> | undefined)?.then === "function") {
      void maybePromise;
    }
  };

  const onEscDataWhileHandler = (chunk: string): void => {
    if (!handlerRunning || pauseDepth > 0) {
      return;
    }
    const raw = String(chunk ?? "");
    if (raw !== "\u001b") {
      return;
    }
    const now = Date.now();
    if (now - escArmedAt < 150) {
      return;
    }
    escArmedAt = now;
    process.stdout.write("\n");
    triggerEscInterrupt("running");
  };

  const resolvePromptLayoutValue = (): SessionPromptLayout => {
    const promptValue: SessionInputPromptValue = typeof prompt === "function"
      ? (() => {
        try {
          const dynamicPrompt = prompt();
          if (
            (typeof dynamicPrompt === "string" && dynamicPrompt.length > 0)
            || typeof dynamicPrompt === "object"
          ) {
            return dynamicPrompt;
          }
        } catch {
          // fallback to default prompt
        }
        return DEFAULT_SESSION_PROMPT;
      })()
      : prompt;
    return resolveInteractivePromptLayout({
      promptText: promptValue,
      fallbackPrompt: DEFAULT_SESSION_PROMPT,
    });
  };

  const resolveTerminalColumns = (): number => {
    const stdout = process.stdout as unknown as {
      isTTY?: boolean;
      columns?: number;
    };
    if (
      stdout.isTTY
      && typeof stdout.columns === "number"
      && Number.isFinite(stdout.columns)
      && stdout.columns > 0
    ) {
      return Math.floor(stdout.columns);
    }
    return 96;
  };

  const codeOffsetFromGraphemeIndex = (
    graphemes: readonly string[],
    index: number,
  ): number => {
    const normalized = Math.max(0, Math.min(index, graphemes.length));
    let total = 0;
    for (let i = 0; i < normalized; i += 1) {
      total += graphemes[i]?.length ?? 0;
    }
    return total;
  };

  const graphemeIndexFromCodeOffset = (
    graphemes: readonly string[],
    codeOffset: number,
  ): number => {
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
  };

  const renderInlineImageTokens = renderInlineImageTokensForDisplay;

  const readSingleTurnInput = async (
    resolvedPrompt: SessionPromptLayout,
  ): Promise<{ kind: "submit"; value: string } | { kind: "sigint" }> => {
    if (resolvedPrompt.prefix.length > 0) {
      process.stdout.write(`${resolvedPrompt.prefix}\n`);
    }

    const promptLabel = resolvedPrompt.inlinePrompt.length > 0
      ? resolvedPrompt.inlinePrompt
      : DEFAULT_SESSION_PROMPT;
    const promptLabelWidth = Math.max(1, measureDisplayWidth(promptLabel));
    const continuationPrefix = " ".repeat(promptLabelWidth);
    const footerLines = (resolvedPrompt.suffix ?? "")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    const getTheme = (): "plain" | "nerd_font" | "ccline" | undefined =>
      options.getInlineImageHighlightTheme?.();

    let graphemes: string[] = [];
    let cursor = 0;
    let lastRenderedLineCount = 0;
    let lastCursorRenderLineIndex = 0;
    let bracketedPasteBuffer = "";
    let historySearchInFlight = false;
    let activeSlashSuggestionIndex = 0;
    let lastSlashLineInput = "";
    let slashSuggestionsHiddenForLine = "";
    let latestSnapshot: InputRenderSnapshot | undefined;
    let closed = false;
    let pendingPlainEnterFallback: ReturnType<typeof setTimeout> | undefined;
    let lastEnterKeypressHandledAt = 0;
    let lastEnterDataHandledAt = 0;
    let shortcutOverlayVisible = false;

    const moveCursorToRenderedTop = (): boolean => {
      if (lastRenderedLineCount <= 0) {
        return false;
      }
      process.stdout.write("\r");
      if (lastCursorRenderLineIndex > 0) {
        process.stdout.write(`\x1b[${String(lastCursorRenderLineIndex)}A`);
      }
      return true;
    };

    const moveCursorToOutputLine = (): void => {
      const snapshot = latestSnapshot;
      if (!snapshot) {
        process.stdout.write("\n");
        return;
      }
      process.stdout.write("\r");
      const linesDown = Math.max(
        0,
        snapshot.renderedLines.length - 1 - snapshot.cursorRenderLineIndex,
      );
      if (linesDown > 0) {
        process.stdout.write(`\x1b[${String(linesDown)}B`);
      }
      process.stdout.write("\n");
    };

    const replaceRenderedInputWithSubmittedTranscript = (value: string): void => {
      const moved = moveCursorToRenderedTop();
      if (moved) {
        process.stdout.write("\x1b[J");
      }
      const lines = renderSubmittedInputTranscriptLines({
        value,
        promptLabel,
        terminalColumns: resolveTerminalColumns(),
        theme: getTheme(),
      });
      process.stdout.write(lines.join("\n"));
      process.stdout.write("\n");
      lastRenderedLineCount = 0;
      lastCursorRenderLineIndex = 0;
      latestSnapshot = undefined;
    };

    const clampCursor = (): void => {
      cursor = Math.max(0, Math.min(cursor, graphemes.length));
    };

    const insertTextAtCursor = (value: string): void => {
      if (!value) {
        return;
      }
      const parsed = splitGraphemes(value);
      if (parsed.length === 0) {
        return;
      }
      graphemes.splice(cursor, 0, ...parsed);
      cursor += parsed.length;
    };

    const tryPasteInlineClipboardImage = (): boolean => {
      const attachment = saveClipboardImageToTempFile();
      if (!attachment) {
        return false;
      }
      const placeholder = registerInlineImageAttachment(attachment);
      insertTextAtCursor(placeholder);
      return true;
    };

    const removeSelectedInlineImageToken = (): boolean => {
      const value = graphemes.join("");
      const cursorCodeOffset = codeOffsetFromGraphemeIndex(graphemes, cursor);
      for (const match of value.matchAll(INLINE_IMAGE_RENDER_PATTERN)) {
        const start = match.index ?? -1;
        const token = match[0] ?? "";
        if (start < 0 || start !== cursorCodeOffset || token.length === 0) {
          continue;
        }
        const startIndex = graphemeIndexFromCodeOffset(graphemes, start);
        const endIndex = graphemeIndexFromCodeOffset(graphemes, start + token.length);
        graphemes.splice(startIndex, Math.max(0, endIndex - startIndex));
        cursor = startIndex;
        return true;
      }
      return false;
    };

    const stripBracketedMarkersFromBuffer = (): boolean => {
      const before = graphemes.join("");
      if (!before.includes(BRACKETED_PASTE_START) && !before.includes(BRACKETED_PASTE_END)) {
        return false;
      }
      const cursorCodeOffset = codeOffsetFromGraphemeIndex(graphemes, cursor);
      const beforeCursor = before.slice(0, cursorCodeOffset);
      const cleanedBeforeCursor = stripBracketedPasteMarkers(beforeCursor);
      const cleaned = stripBracketedPasteMarkers(before);
      if (cleaned === before) {
        return false;
      }
      graphemes = splitGraphemes(cleaned);
      cursor = graphemeIndexFromCodeOffset(
        graphemes,
        cleanedBeforeCursor.length,
      );
      clampCursor();
      return true;
    };

    const resolveDescriptors = (input: {
      valueGraphemes: readonly string[];
      wrapWidth: number;
    }): InputLineDescriptor[] => resolveInputLineDescriptors(input);

    const resolveCursorLineIndex = (
      descriptors: readonly InputLineDescriptor[],
    ): number => {
      if (descriptors.length === 0) {
        return 0;
      }
      for (let index = 0; index < descriptors.length; index += 1) {
        const descriptor = descriptors[index];
        if (cursor >= descriptor.start && cursor <= descriptor.end) {
          return index;
        }
      }
      return descriptors.length - 1;
    };

    const resolveCursorColumn = (
      descriptor: InputLineDescriptor,
    ): number => {
      const value = graphemes.join("");
      const codeOffsets = buildCodeOffsets(graphemes);
      const currentCodeOffset = codeOffsets[cursor] ?? codeOffsets[codeOffsets.length - 1] ?? 0;
      const before = value.slice(descriptor.codeStart, currentCodeOffset);
      return promptLabelWidth + measureDisplayWidth(before);
    };

    const resolveSlashSuggestions = (
      activeLineInput: string,
    ): {
      suggestions: readonly SessionSlashSuggestion[];
      panelLines: string[];
    } => {
      if (typeof options.getSlashSuggestions !== "function") {
        return {
          suggestions: [],
          panelLines: [],
        };
      }
      if (!activeLineInput.trimStart().startsWith("/")) {
        activeSlashSuggestionIndex = 0;
        lastSlashLineInput = "";
        slashSuggestionsHiddenForLine = "";
        return {
          suggestions: [],
          panelLines: [],
        };
      }
      if (activeLineInput !== lastSlashLineInput) {
        activeSlashSuggestionIndex = 0;
        lastSlashLineInput = activeLineInput;
        if (slashSuggestionsHiddenForLine === activeLineInput) {
          slashSuggestionsHiddenForLine = "";
        }
      }
      if (slashSuggestionsHiddenForLine === activeLineInput) {
        return {
          suggestions: [],
          panelLines: [],
        };
      }
      const suggestions = options.getSlashSuggestions(activeLineInput);
      if (suggestions.length === 0) {
        activeSlashSuggestionIndex = 0;
        return {
          suggestions,
          panelLines: [],
        };
      }
      activeSlashSuggestionIndex = normalizeSuggestionIndex(
        suggestions.length,
        activeSlashSuggestionIndex,
      );
      const panel = formatSlashSuggestionPanel(
        suggestions,
        activeLineInput,
        activeSlashSuggestionIndex,
        resolveSlashOverlayColumns(),
      );
      return {
        suggestions,
        panelLines: panel
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0),
      };
    };

    const buildRenderSnapshot = (): InputRenderSnapshot => {
      clampCursor();
      const terminalColumns = Math.max(32, resolveTerminalColumns());
      const inputBodyWidth = resolveInteractiveInputBodyWidth({
        terminalColumns,
        promptLabelWidth,
      });
      const wrapWidth = Math.max(1, inputBodyWidth - promptLabelWidth);
      const descriptors = resolveDescriptors({
        valueGraphemes: graphemes,
        wrapWidth,
      });
      const activeLineIndex = resolveCursorLineIndex(descriptors);
      const activeDescriptor = descriptors[activeLineIndex] ?? descriptors[0]!;
      const activeLineInput = activeDescriptor?.text ?? "";
      const selectedTokenCodeOffset = (() => {
        const value = graphemes.join("");
        const cursorCodeOffset = codeOffsetFromGraphemeIndex(graphemes, cursor);
        for (const match of value.matchAll(INLINE_IMAGE_RENDER_PATTERN)) {
          const start = match.index ?? -1;
          if (start === cursorCodeOffset) {
            return start;
          }
        }
        return undefined;
      })();

      const slash = resolveSlashSuggestions(activeLineInput);
      if (shortcutOverlayVisible && slash.panelLines.length > 0) {
        shortcutOverlayVisible = false;
      }
      const exactSlashMatch = shouldHighlightSlashInputToken({
        activeLineInput,
        suggestions: slash.suggestions,
      });
      const shortcutOverlayLines = shortcutOverlayVisible
        ? renderShortcutOverlayFooter({ terminalColumns }).split("\n")
        : [];
      const visibleFooterLines = resolveDraftAwareFooterLines({
        footerLines,
        inputGraphemeLength: graphemes.length,
      });
      const bodyLines: string[] = descriptors.map((descriptor, index) => {
        const prefix = index === 0 ? promptLabel : continuationPrefix;
        const selectedOffsetInLine =
          typeof selectedTokenCodeOffset === "number"
          && selectedTokenCodeOffset >= descriptor.codeStart
          && selectedTokenCodeOffset < descriptor.codeEnd
            ? selectedTokenCodeOffset - descriptor.codeStart
            : undefined;
        const renderedText = renderInlineImageTokens({
          text: descriptor.text,
          theme: getTheme(),
          selectedStartOffset: selectedOffsetInLine,
        });
        const highlightedText = exactSlashMatch && index === activeLineIndex
          ? renderSlashCommandTokenHighlight(renderedText)
          : renderedText;
        return `${prefix}${highlightedText}`;
      });
      const shouldRenderFooter = slash.panelLines.length === 0 && !shortcutOverlayVisible;
      const renderedLines = [
        ...renderInteractiveInputChromeLines({
          bodyLines,
          inputBodyWidth,
        }),
        ...slash.panelLines,
        ...shortcutOverlayLines,
        ...(shouldRenderFooter ? visibleFooterLines : []),
      ];
      const cursorRenderLineIndex = 1 + activeLineIndex;
      const cursorColumn = resolveCursorColumn(activeDescriptor);
      return {
        renderedLines,
        cursorRenderLineIndex,
        cursorColumn: resolveInteractiveInputCursorColumn({
          promptRelativeCursorColumn: cursorColumn,
        }),
        descriptors,
        activeLineIndex,
        activeLineInput,
        activeSlashSuggestions: slash.suggestions,
      };
    };

    const render = (): void => {
      const snapshot = buildRenderSnapshot();
      if (lastRenderedLineCount > 0) {
        process.stdout.write("\r");
        if (lastCursorRenderLineIndex > 0) {
          process.stdout.write(`\x1b[${String(lastCursorRenderLineIndex)}A`);
        }
      }
      process.stdout.write("\x1b[J");
      process.stdout.write(snapshot.renderedLines.join("\n"));
      process.stdout.write("\r");
      const linesUp = Math.max(
        0,
        snapshot.renderedLines.length - 1 - snapshot.cursorRenderLineIndex,
      );
      if (linesUp > 0) {
        process.stdout.write(`\x1b[${String(linesUp)}A`);
      }
      if (snapshot.cursorColumn > 0) {
        process.stdout.write(`\x1b[${String(snapshot.cursorColumn)}C`);
      }
      lastRenderedLineCount = snapshot.renderedLines.length;
      lastCursorRenderLineIndex = snapshot.cursorRenderLineIndex;
      latestSnapshot = snapshot;
    };

    const replaceActiveLineWithCommand = (command: string): string | undefined => {
      if (!latestSnapshot) {
        return undefined;
      }
      const descriptor =
        latestSnapshot.descriptors[latestSnapshot.activeLineIndex]
        ?? latestSnapshot.descriptors[0];
      if (!descriptor) {
        return undefined;
      }
      const leadingSpaces = latestSnapshot.activeLineInput.match(/^\s*/)?.[0] ?? "";
      const nextLine = `${leadingSpaces}${command}`;
      const replacement = splitGraphemes(nextLine);
      graphemes.splice(
        descriptor.start,
        Math.max(0, descriptor.end - descriptor.start),
        ...replacement,
      );
      cursor = descriptor.start + replacement.length;
      activeSlashSuggestionIndex = 0;
      return nextLine;
    };

    const moveCursorVertical = (direction: -1 | 1): void => {
      if (!latestSnapshot) {
        return;
      }
      const descriptor =
        latestSnapshot.descriptors[latestSnapshot.activeLineIndex]
        ?? latestSnapshot.descriptors[0];
      if (!descriptor) {
        return;
      }
      const column = Math.max(0, cursor - descriptor.start);
      if (direction < 0) {
        if (descriptor.start <= 0) {
          return;
        }
        const prevBreak = descriptor.start - 1;
        let prevStart = 0;
        for (let index = prevBreak - 1; index >= 0; index -= 1) {
          if (graphemes[index] === "\n") {
            prevStart = index + 1;
            break;
          }
        }
        const prevLength = Math.max(0, prevBreak - prevStart);
        cursor = prevStart + Math.min(column, prevLength);
        return;
      }
      if (descriptor.end >= graphemes.length || graphemes[descriptor.end] !== "\n") {
        return;
      }
      const nextStart = descriptor.end + 1;
      let nextEnd = graphemes.length;
      for (let index = nextStart; index < graphemes.length; index += 1) {
        if (graphemes[index] === "\n") {
          nextEnd = index;
          break;
        }
      }
      const nextLength = Math.max(0, nextEnd - nextStart);
      cursor = nextStart + Math.min(column, nextLength);
    };

    const handleBracketedPastePayload = (payload: string): void => {
      queueMicrotask(() => {
        if (closed) {
          return;
        }
        const stripped = stripBracketedMarkersFromBuffer();
        if (payload.trim().length > 0) {
          if (stripped) {
            render();
          }
          return;
        }
        const pasted = tryPasteInlineClipboardImage();
        if (pasted || stripped) {
          render();
        }
      });
    };

    const runHistorySearchShortcut = async (): Promise<void> => {
      if (historySearchInFlight || typeof options.openHistorySearch !== "function") {
        return;
      }
      historySearchInFlight = true;
      try {
        const selected = await controls.withInputPaused(() =>
          options.openHistorySearch?.({
            currentInput: graphemes.join(""),
          }) ?? Promise.resolve(undefined));
        if (closed) {
          return;
        }
        if (typeof selected === "string") {
          graphemes = splitGraphemes(selected);
          cursor = graphemes.length;
          activeSlashSuggestionIndex = 0;
          lastSlashLineInput = "";
          slashSuggestionsHiddenForLine = "";
        }
        render();
      } catch {
        if (!closed) {
          render();
        }
      } finally {
        historySearchInFlight = false;
      }
    };

    const clearPendingPlainEnterFallback = (): void => {
      if (!pendingPlainEnterFallback) {
        return;
      }
      clearTimeout(pendingPlainEnterFallback);
      pendingPlainEnterFallback = undefined;
    };

    return await new Promise<{ kind: "submit"; value: string } | { kind: "sigint" }>((resolve) => {
      const finish = (result: { kind: "submit"; value: string } | { kind: "sigint" }): void => {
        if (closed) {
          return;
        }
        closed = true;
        clearPendingPlainEnterFallback();
        keypressInput.off?.("keypress", onKeypress);
        menuInput.off?.("data", onData);
        if (result.kind === "submit") {
          const suppressTranscript = (() => {
            try {
              return options.shouldSuppressSubmitTranscript?.(result.value) === true;
            } catch {
              return false;
            }
          })();
          if (suppressTranscript) {
            const moved = moveCursorToRenderedTop();
            if (moved) {
              process.stdout.write("\x1b[J");
            } else {
              process.stdout.write("\n");
            }
            lastRenderedLineCount = 0;
            lastCursorRenderLineIndex = 0;
            latestSnapshot = undefined;
          } else {
            replaceRenderedInputWithSubmittedTranscript(result.value);
          }
        } else {
          moveCursorToOutputLine();
        }
        resolve(result);
      };

      const resolveSlashState = (): {
        activeSuggestions: readonly SessionSlashSuggestion[];
        hasActiveSlashSuggestions: boolean;
      } => {
        const activeSuggestions = latestSnapshot?.activeSlashSuggestions ?? [];
        const hasActiveSlashSuggestions = Boolean(
          latestSnapshot?.activeLineInput.trimStart().startsWith("/")
          && activeSuggestions.length > 0,
        );
        return {
          activeSuggestions,
          hasActiveSlashSuggestions,
        };
      };

      const handleEnterLikeAction = (action: SubmitKeyAction): void => {
        const slashState = resolveSlashState();
        const slashAction = resolveSlashSuggestionKeyAction({
          key: "enter",
          hasActiveSuggestions: slashState.hasActiveSlashSuggestions,
          selectedCommand: slashState.activeSuggestions[activeSlashSuggestionIndex]?.command,
          activeLineInput: latestSnapshot?.activeLineInput,
        });
        if (slashAction.kind === "apply") {
          const replacedLine = replaceActiveLineWithCommand(slashAction.appliedCommand);
          if (typeof replacedLine === "string") {
            slashSuggestionsHiddenForLine = replacedLine;
          }
          if (slashAction.submitImmediately) {
            finish({
              kind: "submit",
              value: graphemes.join(""),
            });
          } else {
            render();
          }
          return;
        }
        if (slashAction.kind === "hide_panel") {
          slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
          activeSlashSuggestionIndex = 0;
          render();
          return;
        }
        if (action === "newline") {
          insertTextAtCursor("\n");
          render();
          return;
        }
        finish({
          kind: "submit",
          value: graphemes.join(""),
        });
      };

      const schedulePlainEnterFallback = (): void => {
        clearPendingPlainEnterFallback();
        pendingPlainEnterFallback = setTimeout(() => {
          pendingPlainEnterFallback = undefined;
          if (closed || pauseDepth > 0) {
            return;
          }
          lastEnterDataHandledAt = Date.now();
          handleEnterLikeAction("submit");
        }, PLAIN_ENTER_FALLBACK_DELAY_MS);
      };

      const handleEscapeLikeAction = (): boolean => {
        if (shortcutOverlayVisible) {
          shortcutOverlayVisible = false;
          render();
          return true;
        }
        const slashState = resolveSlashState();
        const slashAction = resolveSlashSuggestionKeyAction({
          key: "escape",
          hasActiveSuggestions: slashState.hasActiveSlashSuggestions,
          selectedCommand: slashState.activeSuggestions[activeSlashSuggestionIndex]?.command,
          activeLineInput: latestSnapshot?.activeLineInput,
        });
        if (slashAction.kind === "hide_panel") {
          slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
          activeSlashSuggestionIndex = 0;
          render();
          return true;
        }
        if (graphemes.length > 0) {
          graphemes = [];
          cursor = 0;
          activeSlashSuggestionIndex = 0;
          lastSlashLineInput = "";
          slashSuggestionsHiddenForLine = "";
          render();
          return true;
        }
        return false;
      };

      const onData = (chunk: string): void => {
        if (closed) {
          return;
        }
        const raw = String(chunk ?? "");
        if (raw.length === 0) {
          return;
        }
        const hasBracketedChunk =
          raw.includes(BRACKETED_PASTE_START)
          || raw.includes(BRACKETED_PASTE_END)
          || bracketedPasteBuffer.length > 0;
        if (hasBracketedChunk) {
          bracketedPasteBuffer = `${bracketedPasteBuffer}${raw}`;
          if (bracketedPasteBuffer.length > BRACKETED_PASTE_BUFFER_LIMIT) {
            bracketedPasteBuffer = bracketedPasteBuffer.slice(-BRACKETED_PASTE_BUFFER_LIMIT);
          }
          let matched = false;
          let lastConsumedIndex = 0;
          BRACKETED_PASTE_BLOCK_PATTERN.lastIndex = 0;
          for (const match of bracketedPasteBuffer.matchAll(BRACKETED_PASTE_BLOCK_PATTERN)) {
            const payload = match[1] ?? "";
            matched = true;
            lastConsumedIndex = (match.index ?? 0) + match[0].length;
            handleBracketedPastePayload(payload);
          }
          if (matched) {
            bracketedPasteBuffer = bracketedPasteBuffer.slice(lastConsumedIndex);
            return;
          }
          const startIndex = bracketedPasteBuffer.lastIndexOf(BRACKETED_PASTE_START);
          if (startIndex >= 0) {
            bracketedPasteBuffer = bracketedPasteBuffer.slice(startIndex);
            return;
          }
          const tailLength = Math.max(
            BRACKETED_PASTE_START.length - 1,
            BRACKETED_PASTE_END.length - 1,
          );
          if (bracketedPasteBuffer.length > tailLength) {
            bracketedPasteBuffer = bracketedPasteBuffer.slice(-tailLength);
          }
          return;
        }

        if (pauseDepth > 0) {
          return;
        }
        if (raw === "\u0003") {
          shortcutOverlayVisible = false;
          finish({ kind: "sigint" });
          return;
        }
        if (raw === "\u001b") {
          if (shortcutOverlayVisible) {
            shortcutOverlayVisible = false;
            render();
            return;
          }
          if (handleEscapeLikeAction()) {
            return;
          }
          const now = Date.now();
          if (now - escArmedAt < 150) {
            return;
          }
          escArmedAt = now;
          process.stdout.write("\n");
          triggerEscInterrupt("idle");
          return;
        }
        const enterDataAction = resolveInteractiveEnterDataAction({
          chunk: raw,
          keypressSupported: true,
          keypressHandledRecently:
            Date.now() - lastEnterKeypressHandledAt < ENTER_KEYPRESS_DEDUP_WINDOW_MS,
        });
        if (enterDataAction === "defer_to_keypress") {
          schedulePlainEnterFallback();
          return;
        }
        if (enterDataAction === "submit") {
          lastEnterDataHandledAt = Date.now();
          shortcutOverlayVisible = false;
          handleEnterLikeAction("submit");
          return;
        }
        if (enterDataAction === "none" && isPlainEnterDataChunk(raw)) {
          return;
        }
        const coalescedSubmit = resolveCoalescedSubmitChunk(raw);
        if (coalescedSubmit.shouldSubmit) {
          const normalized = stripBracketedPasteMarkers(coalescedSubmit.normalizedChunk)
            .replace(/\r/g, "\n");
          if (normalized.length > 0) {
            insertTextAtCursor(normalized);
          }
          shortcutOverlayVisible = false;
          handleEnterLikeAction("submit");
          return;
        }
        const submitKeyAction = resolveSubmitKeyAction({
          chunk: raw,
          key: {},
        });
        if (submitKeyAction !== "none") {
          lastEnterDataHandledAt = Date.now();
          shortcutOverlayVisible = false;
          handleEnterLikeAction(submitKeyAction);
        }
      };

      const onKeypress = (chunk: string, key: KeypressPayload): void => {
        const rawInput = String(chunk ?? "");
        if (closed) {
          return;
        }
        if (pauseDepth > 0) {
          return;
        }

        const imagePasteTriggered =
          (key.ctrl && key.name === "v")
          || (key.meta && key.name === "v")
          || (key.shift && key.name === "insert")
          || key.sequence === "\u0016";
        if (imagePasteTriggered) {
          shortcutOverlayVisible = false;
          if (tryPasteInlineClipboardImage()) {
            render();
          }
          return;
        }

        const slashState = resolveSlashState();
        const activeSuggestions = slashState.activeSuggestions;
        const hasActiveSlashSuggestions = slashState.hasActiveSlashSuggestions;
        const moveSuggestionUp = key.name === "up" || (key.ctrl && key.name === "p");
        const moveSuggestionDown = key.name === "down" || (key.ctrl && key.name === "n");

        const shortcutOverlayAction = resolveShortcutOverlayKeyAction({
          chunk: rawInput,
          key,
          inputGraphemeLength: graphemes.length,
          hasActiveSlashSuggestions,
        });
        if (shortcutOverlayAction === "toggle_overlay") {
          shortcutOverlayVisible = !shortcutOverlayVisible;
          render();
          return;
        }
        if (shortcutOverlayVisible && key.name === "escape") {
          shortcutOverlayVisible = false;
          render();
          return;
        }

        const shortcutAction = resolveInputShortcutAction({
          chunk: rawInput,
          key,
        });
        if (shortcutAction === "sigint") {
          shortcutOverlayVisible = false;
          finish({ kind: "sigint" });
          return;
        }
        if (shortcutAction === "history_search") {
          shortcutOverlayVisible = false;
          void runHistorySearchShortcut();
          return;
        }
        if (key.name === "left") {
          shortcutOverlayVisible = false;
          cursor -= 1;
          clampCursor();
          render();
          return;
        }
        if (key.name === "right") {
          shortcutOverlayVisible = false;
          cursor += 1;
          clampCursor();
          render();
          return;
        }
        if (key.name === "home") {
          shortcutOverlayVisible = false;
          const descriptor = latestSnapshot?.descriptors[latestSnapshot.activeLineIndex ?? 0];
          if (descriptor) {
            cursor = descriptor.start;
            render();
          }
          return;
        }
        if (key.name === "end") {
          shortcutOverlayVisible = false;
          const descriptor = latestSnapshot?.descriptors[latestSnapshot.activeLineIndex ?? 0];
          if (descriptor) {
            cursor = descriptor.end;
            render();
          }
          return;
        }
        if (moveSuggestionUp) {
          shortcutOverlayVisible = false;
          if (hasActiveSlashSuggestions) {
            activeSlashSuggestionIndex = normalizeSuggestionIndex(
              activeSuggestions.length,
              activeSlashSuggestionIndex - 1,
            );
            render();
            return;
          }
          moveCursorVertical(-1);
          render();
          return;
        }
        if (moveSuggestionDown) {
          shortcutOverlayVisible = false;
          if (hasActiveSlashSuggestions) {
            activeSlashSuggestionIndex = normalizeSuggestionIndex(
              activeSuggestions.length,
              activeSlashSuggestionIndex + 1,
            );
            render();
            return;
          }
          moveCursorVertical(1);
          render();
          return;
        }
        if (key.name === "backspace") {
          shortcutOverlayVisible = false;
          if (!removeSelectedInlineImageToken() && cursor > 0) {
            graphemes.splice(cursor - 1, 1);
            cursor -= 1;
          }
          render();
          return;
        }
        if (key.name === "delete") {
          shortcutOverlayVisible = false;
          if (!removeSelectedInlineImageToken() && cursor < graphemes.length) {
            graphemes.splice(cursor, 1);
          }
          render();
          return;
        }
        const submitKeyAction = resolveSubmitKeyAction({
          chunk: rawInput,
          key,
        });
        if (submitKeyAction !== "none") {
          if (Date.now() - lastEnterDataHandledAt < ENTER_KEYPRESS_DEDUP_WINDOW_MS) {
            return;
          }
          clearPendingPlainEnterFallback();
          lastEnterKeypressHandledAt = Date.now();
          shortcutOverlayVisible = false;
          handleEnterLikeAction(submitKeyAction);
          return;
        }
        if (key.name === "tab") {
          const slashAction = resolveSlashSuggestionKeyAction({
            key: "tab",
            hasActiveSuggestions: hasActiveSlashSuggestions,
            selectedCommand: activeSuggestions[activeSlashSuggestionIndex]?.command,
            activeLineInput: latestSnapshot?.activeLineInput,
          });
          if (slashAction.kind === "apply") {
            shortcutOverlayVisible = false;
            const replacedLine = replaceActiveLineWithCommand(slashAction.appliedCommand);
            if (typeof replacedLine === "string") {
              slashSuggestionsHiddenForLine = replacedLine;
            }
            render();
            return;
          }
          if (slashAction.kind === "hide_panel") {
            shortcutOverlayVisible = false;
            slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
            activeSlashSuggestionIndex = 0;
            render();
          }
          return;
        }
        if (key.name === "escape") {
          if (handleEscapeLikeAction()) {
            shortcutOverlayVisible = false;
            return;
          }
          const now = Date.now();
          if (now - escArmedAt < 150) {
            return;
          }
          escArmedAt = now;
          process.stdout.write("\n");
          triggerEscInterrupt("idle");
          return;
        }

        if (!rawInput || key.ctrl || key.meta) {
          return;
        }
        const coalescedSubmit = resolveCoalescedSubmitChunk(rawInput);
        const normalized = stripBracketedPasteMarkers(coalescedSubmit.normalizedChunk)
          .replace(/\r/g, "\n");
        if (coalescedSubmit.shouldSubmit) {
          if (normalized.length > 0) {
            insertTextAtCursor(normalized);
          }
          shortcutOverlayVisible = false;
          handleEnterLikeAction("submit");
          return;
        }
        if (!normalized) {
          return;
        }
        shortcutOverlayVisible = false;
        insertTextAtCursor(normalized);
        render();
      };

      keypressInput.on?.("keypress", onKeypress);
      menuInput.on?.("data", onData);
      render();
    });
  };

  try {
    setRawMode(true);
    menuInput.resume?.();
    while (true) {
      const resolvedPrompt = resolvePromptLayoutValue();
      const inputResult = await readSingleTurnInput(resolvedPrompt);
      if (inputResult.kind === "sigint") {
        process.stdout.write("Interrupted\n");
        break;
      }
      handlerRunning = true;
      menuInput.on?.("data", onEscDataWhileHandler);
      let action: "continue" | "break";
      try {
        setRawMode(true);
        action = await handler(inputResult.value, controls);
      } finally {
        menuInput.off?.("data", onEscDataWhileHandler);
        handlerRunning = false;
      }
      if (action === "break") {
        break;
      }
    }
  } finally {
    menuInput.off?.("data", onEscDataWhileHandler);
    setRawMode(false);
    menuInput.pause?.();
  }
}

function normalizeMenuIndex(itemsLength: number, initialIndex: number | undefined): number {
  if (itemsLength <= 0) {
    return 0;
  }
  if (typeof initialIndex !== "number" || !Number.isFinite(initialIndex)) {
    return 0;
  }
  const rounded = Math.floor(initialIndex);
  if (rounded < 0) {
    return 0;
  }
  if (rounded >= itemsLength) {
    return itemsLength - 1;
  }
  return rounded;
}

function normalizeMenuVisibleOptionCount(input: {
  itemsLength: number;
  visibleOptionCount?: number;
  variant?: TerminalSelectMenuInput["variant"];
}): number {
  if (input.itemsLength <= 0) {
    return 0;
  }
  const fallback = input.variant === "model_picker"
    ? MODEL_PICKER_VISIBLE_OPTION_COUNT
    : input.variant === "ask_user"
      ? 6
      : DEFAULT_SELECT_VISIBLE_OPTION_COUNT;
  const requested =
    typeof input.visibleOptionCount === "number" && Number.isFinite(input.visibleOptionCount)
      ? Math.floor(input.visibleOptionCount)
      : fallback;
  return Math.max(1, Math.min(input.itemsLength, requested));
}

export function resolveTerminalSelectMenuViewport(input: {
  itemsLength: number;
  activeIndex: number;
  visibleOptionCount?: number;
  previousStartIndex?: number;
  variant?: TerminalSelectMenuInput["variant"];
}): {
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  totalCount: number;
  activeIndex: number;
} {
  const totalCount = Math.max(0, Math.floor(input.itemsLength));
  if (totalCount <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      visibleCount: 0,
      totalCount: 0,
      activeIndex: 0,
    };
  }
  const activeIndex = normalizeMenuIndex(totalCount, input.activeIndex);
  const visibleCount = normalizeMenuVisibleOptionCount({
    itemsLength: totalCount,
    visibleOptionCount: input.visibleOptionCount,
    variant: input.variant,
  });
  const navigation = normalizeSelectNavigationState({
    optionCount: totalCount,
    focusedIndex: activeIndex,
    visibleOptionCount: visibleCount,
    previousVisibleFromIndex: input.previousStartIndex,
    initialPlacement: "end",
  });
  return {
    startIndex: navigation.visibleFromIndex,
    endIndex: navigation.visibleToIndex,
    visibleCount: navigation.visibleOptionCount,
    totalCount: navigation.optionCount,
    activeIndex: navigation.focusedIndex,
  };
}

function normalizeMenuSearchQueryText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeMenuSearchCompactText(value: string): string {
  return normalizeMenuSearchQueryText(value).replace(/[\s_-]+/g, "");
}

function normalizeMenuSearchDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function isMenuSearchPrintableInput(rawInput: string): boolean {
  if (!rawInput || rawInput.length === 0) {
    return false;
  }
  if (rawInput.startsWith("\u001b")) {
    return false;
  }
  return !/[\u0000-\u001f\u007f]/.test(rawInput);
}

function trimMenuSearchQuery(rawQuery: string): string {
  const graphemes = splitGraphemes(rawQuery);
  if (graphemes.length <= MENU_SEARCH_QUERY_LIMIT) {
    return rawQuery;
  }
  return graphemes.slice(0, MENU_SEARCH_QUERY_LIMIT).join("");
}

export function resolveMenuSearchMatchedIndices(
  queryRaw: string,
  items: readonly TerminalSelectMenuItem[],
): number[] {
  const query = normalizeMenuSearchQueryText(queryRaw);
  if (!query) {
    return items.map((_, index) => index);
  }
  const compactQuery = normalizeMenuSearchCompactText(query);
  const queryDigits = normalizeMenuSearchDigits(query);
  const exactMatches: number[] = [];
  const prefixMatches: number[] = [];
  const containsMatches: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const fields = [item.id, item.label, item.description ?? ""];
    const normalizedFields = fields.map((field) => normalizeMenuSearchQueryText(field));
    const compactFields = fields.map((field) => normalizeMenuSearchCompactText(field));
    const digitFields = fields.map((field) => normalizeMenuSearchDigits(field));
    const exact = normalizedFields.some((field) => field === query)
      || (compactQuery.length > 0 && compactFields.some((field) => field === compactQuery))
      || (queryDigits.length > 0 && digitFields.some((field) => field === queryDigits));
    if (exact) {
      exactMatches.push(index);
      continue;
    }
    const prefix = normalizedFields.some((field) => field.startsWith(query))
      || (compactQuery.length > 0 && compactFields.some((field) => field.startsWith(compactQuery)))
      || (queryDigits.length > 0 && digitFields.some((field) => field.startsWith(queryDigits)));
    if (prefix) {
      prefixMatches.push(index);
      continue;
    }
    const contains = normalizedFields.some((field) => field.includes(query))
      || (compactQuery.length > 0 && compactFields.some((field) => field.includes(compactQuery)))
      || (queryDigits.length > 0 && digitFields.some((field) => field.includes(queryDigits)));
    if (contains) {
      containsMatches.push(index);
    }
  }
  return [...exactMatches, ...prefixMatches, ...containsMatches];
}

export function decodeMenuInput(rawInput: string, itemsLength: number): MenuInputAction {
  if (rawInput.length === 0) {
    return { kind: "ignore" };
  }
  const parseNumericSelection = (input: string): MenuInputAction => {
    if (!/^\d+$/.test(input)) {
      return { kind: "ignore" };
    }
    const parsedIndex = Number.parseInt(input, 10) - 1;
    if (!Number.isFinite(parsedIndex) || parsedIndex < 0 || parsedIndex >= itemsLength) {
      return { kind: "ignore" };
    }
    return {
      kind: "select_index",
      index: parsedIndex,
    };
  };
  const coalescedSubmit = resolveCoalescedSubmitChunk(rawInput);
  if (coalescedSubmit.shouldSubmit) {
    const normalizedPayload = coalescedSubmit.normalizedChunk.trim();
    if (normalizedPayload.length === 0) {
      return { kind: "enter" };
    }
    return parseNumericSelection(normalizedPayload);
  }
  if (rawInput.length === 1) {
    const firstChar = rawInput[0];
    if (firstChar === "\u0003" || firstChar === "\u001b") {
      return { kind: "cancel" };
    }
    if (firstChar === "\r" || firstChar === "\n" || firstChar === " ") {
      return { kind: "enter" };
    }
    if (firstChar === "k" || firstChar === "\u0010") {
      return { kind: "up" };
    }
    if (firstChar === "j" || firstChar === "\u000e") {
      return { kind: "down" };
    }
    return parseNumericSelection(firstChar);
  }
  if (/^\d+$/.test(rawInput.trim())) {
    return parseNumericSelection(rawInput.trim());
  }
  if (rawInput.startsWith("\u001b[A") || rawInput.startsWith("\u001bOA")) {
    return { kind: "up" };
  }
  if (rawInput.startsWith("\u001b[B") || rawInput.startsWith("\u001bOB")) {
    return { kind: "down" };
  }
  if (rawInput.startsWith("\u001b[5~")) {
    return { kind: "page_up" };
  }
  if (rawInput.startsWith("\u001b[6~")) {
    return { kind: "page_down" };
  }
  return { kind: "ignore" };
}

export async function runTerminalLinePrompt(input: {
  prompt: string;
}): Promise<TerminalLinePromptResult> {
  if (!process.stdin.isTTY) {
    return { kind: "cancelled" };
  }
  const stdin = process.stdin as unknown as MenuInputStream;
  stdin.setEncoding?.("utf8");
  stdin.resume?.();
  return await new Promise<TerminalLinePromptResult>((resolve) => {
    const rl = readlineModule.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    let settled = false;
    const finish = (result: TerminalLinePromptResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      resolve(result);
    };
    rl.on("SIGINT", () => {
      process.stdout.write("\n");
      finish({ kind: "cancelled" });
    });
    rl.question(input.prompt, (answer) => {
      finish({
        kind: "submitted",
        value: String(answer ?? ""),
      });
    });
  });
}

export type AskUserPanelInputAction =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "tab" }
  | { kind: "enter" }
  | { kind: "backspace" }
  | { kind: "cancel" }
  | { kind: "select_index"; index: number }
  | { kind: "text"; value: string }
  | { kind: "submit_text"; value: string }
  | { kind: "ignore" };

function resolveTerminalColumns(fallback?: number): number {
  if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) {
    return Math.floor(fallback);
  }
  const stdout = process.stdout as { columns?: number };
  if (typeof stdout.columns === "number" && Number.isFinite(stdout.columns) && stdout.columns > 0) {
    return Math.floor(stdout.columns);
  }
  return 80;
}

function clampAskUserPanelIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.max(0, Math.min(count - 1, Math.floor(index)));
}

function wrapAskUserPanelIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  const normalized = Math.floor(index) % count;
  return normalized < 0 ? normalized + count : normalized;
}

function resolveAskUserPanelCurrentEnvelope(input: {
  queue: readonly AskUserEnvelope[];
  state: AskUserQuestionnaireState;
}): AskUserEnvelope | undefined {
  return input.queue[clampAskUserPanelIndex(input.state.currentQuestionIndex, input.queue.length)];
}

function isAskUserStandardOptionAnswer(input: {
  envelope: AskUserEnvelope;
  answer: string;
}): boolean {
  const normalized = input.answer.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return input.envelope.optionsDetailed.some((option) => {
    const label = option.label.trim().toLowerCase();
    const value = (option.value ?? option.label).trim().toLowerCase();
    return normalized === label || normalized === value;
  });
}

function resolveFirstUnansweredAskUserQuestionIndex(input: {
  queue: readonly AskUserEnvelope[];
  answers: Record<string, string>;
}): number | undefined {
  for (let index = 0; index < input.queue.length; index += 1) {
    const envelope = input.queue[index];
    if (!envelope) {
      continue;
    }
    if (!input.answers[envelope.askId]?.trim()) {
      return index;
    }
  }
  return undefined;
}

function syncAskUserPanelTextInput(
  state: AskUserQuestionnaireState,
  queue: readonly AskUserEnvelope[],
): AskUserQuestionnaireState {
  const envelope = resolveAskUserPanelCurrentEnvelope({ queue, state });
  const answer = envelope ? state.answers[envelope.askId]?.trim() ?? "" : "";
  const value = envelope && answer && !isAskUserStandardOptionAnswer({ envelope, answer })
    ? answer
    : "";
  if (state.textInputValue === value) {
    return state;
  }
  return reduceAskUserQuestionnaire(state, {
    type: "set_text_input_value",
    value,
  });
}

function isAskUserPanelPrintableInput(rawInput: string): boolean {
  if (!rawInput || rawInput.length === 0 || rawInput.startsWith("\u001b")) {
    return false;
  }
  return !/[\u0000-\u001f\u007f]/.test(rawInput);
}

export function decodeAskUserPanelInput(
  rawInput: string,
  optionCount: number,
  textInputMode: boolean,
): AskUserPanelInputAction {
  if (rawInput.length === 0) {
    return { kind: "ignore" };
  }
  const coalescedSubmit = resolveCoalescedSubmitChunk(rawInput);
  if (coalescedSubmit.shouldSubmit) {
    const normalizedPayload = coalescedSubmit.normalizedChunk.trim();
    if (normalizedPayload.length === 0) {
      return { kind: "enter" };
    }
    if (/^\d+$/.test(normalizedPayload)) {
      const parsedIndex = Number.parseInt(normalizedPayload, 10) - 1;
      if (parsedIndex >= 0 && parsedIndex < optionCount) {
        return { kind: "select_index", index: parsedIndex };
      }
    }
    if (isAskUserPanelPrintableInput(coalescedSubmit.normalizedChunk)) {
      return {
        kind: "submit_text",
        value: coalescedSubmit.normalizedChunk,
      };
    }
  }
  if (rawInput.length === 1) {
    if (rawInput === "\u0003" || rawInput === "\u001b") {
      return { kind: "cancel" };
    }
    if (rawInput === "\r" || rawInput === "\n" || (!textInputMode && rawInput === " ")) {
      return { kind: "enter" };
    }
    if (rawInput === "\t") {
      return { kind: "tab" };
    }
    if (rawInput === "\u007f" || rawInput === "\b") {
      return { kind: "backspace" };
    }
    if (textInputMode && isAskUserPanelPrintableInput(rawInput)) {
      return { kind: "text", value: rawInput };
    }
    if (rawInput === "k" || rawInput === "\u0010") {
      return { kind: "up" };
    }
    if (rawInput === "j" || rawInput === "\u000e") {
      return { kind: "down" };
    }
    if (rawInput === "h") {
      return { kind: "left" };
    }
    if (rawInput === "l") {
      return { kind: "right" };
    }
    if (/^[1-9]$/.test(rawInput)) {
      const parsedIndex = Number.parseInt(rawInput, 10) - 1;
      if (parsedIndex >= 0 && parsedIndex < optionCount) {
        return { kind: "select_index", index: parsedIndex };
      }
    }
    if (isAskUserPanelPrintableInput(rawInput)) {
      return { kind: "text", value: rawInput };
    }
  }
  if (rawInput.startsWith("\u001b[A") || rawInput.startsWith("\u001bOA")) {
    return { kind: "up" };
  }
  if (rawInput.startsWith("\u001b[B") || rawInput.startsWith("\u001bOB")) {
    return { kind: "down" };
  }
  if (rawInput.startsWith("\u001b[D") || rawInput.startsWith("\u001bOD")) {
    return { kind: "left" };
  }
  if (rawInput.startsWith("\u001b[C") || rawInput.startsWith("\u001bOC")) {
    return { kind: "right" };
  }
  return { kind: "ignore" };
}

export async function runAskUserQuestionnairePanel(
  input: TerminalAskUserQuestionnairePanelInput,
): Promise<TerminalAskUserQuestionnairePanelResult> {
  if (!process.stdin.isTTY || input.queue.length <= 0) {
    return { kind: "cancelled" };
  }
  const stdin = process.stdin as unknown as MenuInputStream;
  const setRawMode = stdin.setRawMode;
  const onInput = stdin.on;
  const offInput = stdin.off;
  const resumeInput = stdin.resume;
  if (
    typeof setRawMode !== "function" ||
    typeof onInput !== "function" ||
    typeof offInput !== "function" ||
    typeof resumeInput !== "function"
  ) {
    return { kind: "cancelled" };
  }

  const stdout = process.stdout;
  let state = syncAskUserPanelTextInput(
    createAskUserQuestionnaireState(input.initialState),
    input.queue,
  );
  let reviewIndex = 0;
  let resolved = false;
  let lastRenderedFrameLineCount = 0;

  const writeInlinePanelLines = (panelLines: readonly string[]): void => {
    if (lastRenderedFrameLineCount > 0) {
      stdout.write("\r");
      stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
    }
    stdout.write("\x1b[J");
    stdout.write(panelLines.join("\n"));
    stdout.write("\n");
    lastRenderedFrameLineCount = panelLines.length;
  };

  const render = (): void => {
    const view = buildAskUserQuestionnaireView({
      queue: input.queue,
      state,
    });
    const current = resolveAskUserPanelCurrentEnvelope({
      queue: input.queue,
      state,
    });
    const textInputValue = current ? state.textInputValue || state.answers[current.askId] : "";
    writeInlinePanelLines(
      renderAskUserPanelScreen({
        view,
        terminalColumns: resolveTerminalColumns(input.terminalColumns),
        activeReviewIndex: reviewIndex,
        textInputValue,
      }).split("\n"),
    );
  };

  return await new Promise<TerminalAskUserQuestionnairePanelResult>((resolve) => {
    const teardownInput = (): void => {
      offInput.call(stdin, "data", onData);
      try {
        setRawMode.call(stdin, false);
      } catch {
        // ignore raw mode teardown errors
      }
    };

    const finish = (result: TerminalAskUserQuestionnairePanelResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      teardownInput();
      if (lastRenderedFrameLineCount > 0) {
        stdout.write("\r");
        stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
        stdout.write("\x1b[J");
        lastRenderedFrameLineCount = 0;
      }
      stdout.write("\x1b[?25h");
      resolve(result);
    };

    const submitAll = (): void => {
      const text = buildAskUserBatchAnswerText({
        queue: input.queue,
        answers: state.answers,
      });
      finish({
        kind: "submitted",
        answers: state.answers,
        text,
      });
    };

    const goQuestion = (index: number): void => {
      state = syncAskUserPanelTextInput(
        reduceAskUserQuestionnaire(state, {
          type: "go_question",
          index,
          totalCount: input.queue.length,
        }),
        input.queue,
      );
      reviewIndex = 0;
      render();
    };

    const goReview = (): void => {
      state = reduceAskUserQuestionnaire(state, {
        type: "go_review",
      });
      reviewIndex = 0;
      render();
    };

    const commitAnswer = (answer: string): void => {
      const current = resolveAskUserPanelCurrentEnvelope({
        queue: input.queue,
        state,
      });
      if (!current) {
        finish({ kind: "cancelled" });
        return;
      }
      const trimmedAnswer = answer.trim();
      if (!trimmedAnswer && current.optionsDetailed.length <= 0) {
        render();
        return;
      }
      const previousQuestionIndex = state.currentQuestionIndex;
      state = reduceAskUserQuestionnaire(state, {
        type: "set_answer",
        askId: current.askId,
        answer: trimmedAnswer,
        totalCount: input.queue.length,
      });
      if (input.queue.length <= 1) {
        submitAll();
        return;
      }
      if (state.currentQuestionIndex === previousQuestionIndex) {
        goReview();
        return;
      }
      state = syncAskUserPanelTextInput(state, input.queue);
      render();
    };

    const handleQuestionAction = (
      action: AskUserPanelInputAction,
      view: Extract<AskUserQuestionnaireView, { kind: "question" }>,
    ): void => {
      const current = resolveAskUserPanelCurrentEnvelope({
        queue: input.queue,
        state,
      });
      if (!current) {
        finish({ kind: "cancelled" });
        return;
      }
      const focusedItem = view.optionItems[state.focusedOptionIndex];
      const focusedOther = focusedItem?.kind === "other";
      const otherIndex = view.optionItems.findIndex((item) => item.kind === "other");
      if (action.kind === "cancel") {
        if ((current.optionsDetailed.length <= 0 || focusedOther) && state.textInputValue.length > 0) {
          state = reduceAskUserQuestionnaire(state, {
            type: "set_text_input_value",
            value: "",
          });
          render();
          return;
        }
        if (focusedOther && current.optionsDetailed.length > 0) {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: 0,
            optionCount: view.optionItems.length,
          });
          render();
          return;
        }
        finish({ kind: "cancelled" });
        return;
      }
      if (action.kind === "up") {
        state = reduceAskUserQuestionnaire(state, {
          type: "previous_option",
          optionCount: Math.max(1, view.optionItems.length),
        });
        render();
        return;
      }
      if (action.kind === "down") {
        state = reduceAskUserQuestionnaire(state, {
          type: "next_option",
          optionCount: Math.max(1, view.optionItems.length),
        });
        render();
        return;
      }
      if (action.kind === "left") {
        state = syncAskUserPanelTextInput(
          reduceAskUserQuestionnaire(state, {
            type: "previous_question",
            totalCount: input.queue.length,
          }),
          input.queue,
        );
        render();
        return;
      }
      if (action.kind === "right") {
        state = syncAskUserPanelTextInput(
          reduceAskUserQuestionnaire(state, {
            type: "next_question",
            totalCount: input.queue.length,
          }),
          input.queue,
        );
        render();
        return;
      }
      if (action.kind === "tab") {
        if (input.queue.length > 1) {
          goReview();
        }
        return;
      }
      if (action.kind === "backspace" && (current.optionsDetailed.length <= 0 || focusedOther)) {
        const graphemes = splitGraphemes(state.textInputValue);
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: graphemes.slice(0, -1).join(""),
        });
        render();
        return;
      }
      if (action.kind === "text" && (current.optionsDetailed.length <= 0 || focusedOther)) {
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: `${state.textInputValue}${action.value}`,
        });
        render();
        return;
      }
      if (action.kind === "text" && current.optionsDetailed.length > 0 && otherIndex >= 0) {
        state = reduceAskUserQuestionnaire(state, {
          type: "focus_option",
          index: otherIndex,
          optionCount: view.optionItems.length,
        });
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: action.value,
        });
        render();
        return;
      }
      if (action.kind === "submit_text") {
        if (current.optionsDetailed.length > 0 && otherIndex >= 0) {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: otherIndex,
            optionCount: view.optionItems.length,
          });
        }
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: action.value,
        });
        commitAnswer(action.value);
        return;
      }
      if (action.kind === "select_index") {
        const selectedItem = view.optionItems[action.index];
        if (selectedItem?.kind === "other") {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: action.index,
            optionCount: view.optionItems.length,
          });
          render();
          return;
        }
        const selectedAnswer = resolveAskUserAnswerFromSelection(current, action.index);
        if (selectedAnswer) {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: action.index,
            optionCount: current.optionsDetailed.length,
          });
          commitAnswer(selectedAnswer);
        }
        return;
      }
      if (action.kind === "enter") {
        if (focusedOther) {
          commitAnswer(state.textInputValue);
          return;
        }
        if (current.optionsDetailed.length > 0) {
          const selectedAnswer = resolveAskUserAnswerFromSelection(current, state.focusedOptionIndex);
          if (selectedAnswer) {
            commitAnswer(selectedAnswer);
          }
          return;
        }
        commitAnswer(state.textInputValue);
      }
    };

    const handleReviewAction = (action: AskUserPanelInputAction): void => {
      const itemCount = input.queue.length + 2;
      if (action.kind === "up") {
        reviewIndex = wrapAskUserPanelIndex(reviewIndex - 1, itemCount);
        render();
        return;
      }
      if (action.kind === "down") {
        reviewIndex = wrapAskUserPanelIndex(reviewIndex + 1, itemCount);
        render();
        return;
      }
      if (action.kind === "left") {
        goQuestion(Math.max(0, input.queue.length - 1));
        return;
      }
      if (action.kind === "right") {
        goQuestion(0);
        return;
      }
      if (action.kind === "enter" || action.kind === "select_index") {
        const selectedIndex = action.kind === "select_index"
          ? clampAskUserPanelIndex(action.index, itemCount)
          : reviewIndex;
        if (selectedIndex === 0) {
          const firstUnanswered = resolveFirstUnansweredAskUserQuestionIndex({
            queue: input.queue,
            answers: state.answers,
          });
          if (typeof firstUnanswered === "number") {
            goQuestion(firstUnanswered);
            return;
          }
          submitAll();
          return;
        }
        if (selectedIndex === itemCount - 1) {
          finish({ kind: "cancelled" });
          return;
        }
        goQuestion(selectedIndex - 1);
      }
    };

    const onData = (chunk: string): void => {
      const view = buildAskUserQuestionnaireView({
        queue: input.queue,
        state,
      });
      const optionCount = view.kind === "question" ? view.optionItems.length : input.queue.length + 2;
      const textInputMode = view.kind === "question"
        && (
          view.optionItems.length <= 0
          || view.optionItems[view.activeOptionIndex]?.kind === "other"
        );
      const action = decodeAskUserPanelInput(
        String(chunk ?? ""),
        optionCount,
        textInputMode,
      );
      if (view.kind === "question") {
        handleQuestionAction(action, view);
        return;
      }
      if (action.kind === "cancel") {
        finish({ kind: "cancelled" });
        return;
      }
      if (view.kind === "review") {
        handleReviewAction(action);
      }
    };

    stdout.write("\x1b[?25l");
    stdin.setEncoding?.("utf8");
    onInput.call(stdin, "data", onData);
    try {
      setRawMode.call(stdin, true);
    } catch {
      finish({ kind: "cancelled" });
      return;
    }
    resumeInput.call(stdin);
    render();
  });
}


export async function runTerminalSelectMenu(input: TerminalSelectMenuInput): Promise<TerminalSelectMenuResult> {
  if (!process.stdin.isTTY || input.items.length === 0) {
    return { kind: "cancelled" };
  }
  const stdin = process.stdin as unknown as MenuInputStream;
  const setRawMode = stdin.setRawMode;
  const onInput = stdin.on;
  const offInput = stdin.off;
  const resumeInput = stdin.resume;
  if (
    typeof setRawMode !== "function" ||
    typeof onInput !== "function" ||
    typeof offInput !== "function" ||
    typeof resumeInput !== "function"
  ) {
    return { kind: "cancelled" };
  }

  const stdout = process.stdout;
  const uiRenderer = createCliUiRenderer({
    stdinIsTTY: process.stdin.isTTY,
  });
  const menuTransitionPreset = resolveMenuTransitionPreset(
    process.env.GROBOT_MENU_TIMING_PRESET,
  );
  const openFrameDelays = resolveMenuTransitionDelays(
    process.env.GROBOT_MENU_OPEN_TIMING_MS,
    menuTransitionPreset.open,
  );
  const closeFrameDelays = resolveMenuTransitionDelays(
    process.env.GROBOT_MENU_CLOSE_TIMING_MS,
    menuTransitionPreset.close,
  );
  const supportsMenuTransitions = uiRenderer.mode === "interactive_tty";
  let visibleItemIndices = input.items.map((_, index) => index);
  let activeIndex = normalizeMenuIndex(
    visibleItemIndices.length,
    normalizeMenuIndex(input.items.length, input.initialIndex),
  );
  let viewportStartIndex = 0;
  let menuSearchMode = false;
  let menuSearchQuery = "";
  let resolved = false;
  let openTransitionStageOneTimer: ReturnType<typeof setTimeout> | undefined;
  let openTransitionStageTwoTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTransitionStageOneTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTransitionStageTwoTimer: ReturnType<typeof setTimeout> | undefined;
  let hasRenderedOpenPreview = false;
  let lastRenderedMenuLines: string[] = [];
  let lastRenderedFrameLineCount = 0;
  let numericSelectionBuffer = "";
  let numericSelectionTimer: ReturnType<typeof setTimeout> | undefined;

  const writeInlineMenuLines = (menuLines: readonly string[]): void => {
    const frameLines = [...menuLines];
    if (lastRenderedFrameLineCount > 0) {
      stdout.write("\r");
      stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
    }
    stdout.write("\x1b[J");
    stdout.write(frameLines.join("\n"));
    stdout.write("\n");
    lastRenderedFrameLineCount = frameLines.length;
  };

  const clearOpenTransitionTimers = (): void => {
    if (openTransitionStageOneTimer) {
      clearTimeout(openTransitionStageOneTimer);
      openTransitionStageOneTimer = undefined;
    }
    if (openTransitionStageTwoTimer) {
      clearTimeout(openTransitionStageTwoTimer);
      openTransitionStageTwoTimer = undefined;
    }
  };

  const resolveCurrentViewport = (): ReturnType<typeof resolveTerminalSelectMenuViewport> => {
    const viewport = resolveTerminalSelectMenuViewport({
      itemsLength: visibleItemIndices.length,
      activeIndex,
      visibleOptionCount: input.visibleOptionCount,
      previousStartIndex: viewportStartIndex,
      variant: input.variant,
    });
    viewportStartIndex = viewport.startIndex;
    activeIndex = viewport.activeIndex;
    return viewport;
  };

  const resolveVisibleItems = (
    viewport: ReturnType<typeof resolveTerminalSelectMenuViewport>,
  ): TerminalSelectMenuItem[] =>
    visibleItemIndices
      .slice(viewport.startIndex, viewport.endIndex)
      .map((index) => input.items[index])
      .filter((item): item is TerminalSelectMenuItem => typeof item !== "undefined");

  const resolveActiveSourceIndex = (): number | undefined => {
    if (activeIndex < 0 || activeIndex >= visibleItemIndices.length) {
      return undefined;
    }
    return visibleItemIndices[activeIndex];
  };

  const buildRenderableMenu = (): TerminalSelectMenuInput => {
    const viewport = resolveCurrentViewport();
    const visibleItems = resolveVisibleItems(viewport);
    const renderedActiveIndex = normalizeMenuIndex(
      visibleItems.length,
      activeIndex - viewport.startIndex,
    );
    const searchActive = menuSearchMode || menuSearchQuery.trim().length > 0;
    const baseSubtitle = input.subtitle?.trim();
    const searchSubtitle = searchActive
      ? `filter ${String(visibleItemIndices.length)}/${String(input.items.length)}${menuSearchQuery.trim().length > 0 ? `: "${menuSearchQuery}"` : ""}`
      : undefined;
    const subtitle = [baseSubtitle, searchSubtitle]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" · ");
    const searchHint = searchActive
      ? "Ctrl+f or / toggle filter · Ctrl+u clear · Esc exit filter"
      : undefined;
    const hint = [input.hint?.trim(), searchHint]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" · ");
    return {
      ...input,
      subtitle: subtitle.length > 0 ? subtitle : undefined,
      hint: hint.length > 0 ? hint : undefined,
      items: visibleItems,
      initialIndex: renderedActiveIndex,
      viewport: {
        startIndex: viewport.startIndex,
        visibleCount: viewport.visibleCount,
        totalCount: viewport.totalCount,
      },
    };
  };

  const render = (): void => {
    const renderableMenu = buildRenderableMenu();
    const renderedIndex = normalizeMenuIndex(
      renderableMenu.items.length,
      renderableMenu.initialIndex,
    );
    const menuLines = uiRenderer.renderSelectMenu(renderableMenu, renderedIndex).split("\n");
    lastRenderedMenuLines = menuLines;
    if (supportsMenuTransitions && !hasRenderedOpenPreview) {
      hasRenderedOpenPreview = true;
      const initialFrame = buildMenuTransitionFrame(menuLines, "open_initial");
      const middleFrame = buildMenuTransitionFrame(menuLines, "open_mid");
      writeInlineMenuLines(initialFrame);
      clearOpenTransitionTimers();
      openTransitionStageOneTimer = setTimeout(() => {
        openTransitionStageOneTimer = undefined;
        if (resolved) {
          return;
        }
        writeInlineMenuLines(middleFrame);
        openTransitionStageTwoTimer = setTimeout(() => {
          openTransitionStageTwoTimer = undefined;
          if (resolved) {
            return;
          }
          writeInlineMenuLines(menuLines);
        }, openFrameDelays[1]);
      }, openFrameDelays[0]);
      return;
    }
    clearOpenTransitionTimers();
    writeInlineMenuLines(menuLines);
  };

  const applyMenuSearchQuery = (nextQueryRaw: string): void => {
    const previousSourceIndex = resolveActiveSourceIndex();
    const normalizedNextQuery = trimMenuSearchQuery(nextQueryRaw);
    menuSearchQuery = normalizedNextQuery;
    visibleItemIndices = resolveMenuSearchMatchedIndices(menuSearchQuery, input.items);
    if (visibleItemIndices.length === 0) {
      activeIndex = 0;
      render();
      return;
    }
    if (typeof previousSourceIndex === "number") {
      const preservedVisibleIndex = visibleItemIndices.indexOf(previousSourceIndex);
      if (preservedVisibleIndex >= 0) {
        activeIndex = preservedVisibleIndex;
        render();
        return;
      }
    }
    activeIndex = normalizeMenuIndex(visibleItemIndices.length, 0);
    render();
  };

  const dropMenuSearchLastGrapheme = (): void => {
    if (menuSearchQuery.length === 0) {
      return;
    }
    const graphemes = splitGraphemes(menuSearchQuery);
    if (graphemes.length === 0) {
      return;
    }
    applyMenuSearchQuery(graphemes.slice(0, -1).join(""));
  };

  const clearNumericSelectionBuffer = (): void => {
    numericSelectionBuffer = "";
    if (numericSelectionTimer) {
      clearTimeout(numericSelectionTimer);
      numericSelectionTimer = undefined;
    }
  };

  return await new Promise<TerminalSelectMenuResult>((resolve) => {
    const clearCloseTransitionTimers = (): void => {
      if (closeTransitionStageOneTimer) {
        clearTimeout(closeTransitionStageOneTimer);
        closeTransitionStageOneTimer = undefined;
      }
      if (closeTransitionStageTwoTimer) {
        clearTimeout(closeTransitionStageTwoTimer);
        closeTransitionStageTwoTimer = undefined;
      }
    };

    const finalizeTeardown = (result: TerminalSelectMenuResult): void => {
      clearCloseTransitionTimers();
      if (lastRenderedFrameLineCount > 0) {
        stdout.write("\r");
        stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
        stdout.write("\x1b[J");
        lastRenderedFrameLineCount = 0;
      }
      stdout.write("\x1b[?25h");
      resolve(result);
    };

    const runCloseTransition = (result: TerminalSelectMenuResult): void => {
      if (
        !supportsMenuTransitions
        || lastRenderedFrameLineCount <= 0
        || lastRenderedMenuLines.length === 0
      ) {
        finalizeTeardown(result);
        return;
      }
      const initialFrame = buildMenuTransitionFrame(lastRenderedMenuLines, "close_initial");
      const middleFrame = buildMenuTransitionFrame(lastRenderedMenuLines, "close_mid");
      writeInlineMenuLines(initialFrame);
      clearCloseTransitionTimers();
      closeTransitionStageOneTimer = setTimeout(() => {
        closeTransitionStageOneTimer = undefined;
        writeInlineMenuLines(middleFrame);
        closeTransitionStageTwoTimer = setTimeout(() => {
          closeTransitionStageTwoTimer = undefined;
          finalizeTeardown(result);
        }, closeFrameDelays[1]);
      }, closeFrameDelays[0]);
    };

    const teardownInput = (): void => {
      clearNumericSelectionBuffer();
      clearOpenTransitionTimers();
      offInput.call(stdin, "data", onData);
      try {
        setRawMode.call(stdin, false);
      } catch {
        // ignore raw mode teardown errors
      }
    };

    const finish = (result: TerminalSelectMenuResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      teardownInput();
      runCloseTransition(result);
    };

    const selectAndFinish = (nextVisibleIndex: number): void => {
      if (visibleItemIndices.length === 0) {
        return;
      }
      const resolvedVisibleIndex = normalizeMenuIndex(visibleItemIndices.length, nextVisibleIndex);
      const sourceIndex = visibleItemIndices[resolvedVisibleIndex];
      if (typeof sourceIndex !== "number" || sourceIndex < 0 || sourceIndex >= input.items.length) {
        return;
      }
      activeIndex = resolvedVisibleIndex;
      finish({
        kind: "selected",
        item: input.items[sourceIndex],
        index: sourceIndex,
      });
    };

    const scheduleNumericSelectionCommit = (): void => {
      if (numericSelectionTimer) {
        clearTimeout(numericSelectionTimer);
      }
      numericSelectionTimer = setTimeout(() => {
        numericSelectionTimer = undefined;
        const index = resolveMenuIndexFromDigits(
          numericSelectionBuffer,
          visibleItemIndices.length,
        );
        if (typeof index === "number") {
          selectAndFinish(index);
          return;
        }
        clearNumericSelectionBuffer();
      }, MENU_DIGIT_SELECTION_COMMIT_DELAY_MS);
    };

    const handleSingleDigitSelection = (digit: string): boolean => {
      const nextDigits = `${numericSelectionBuffer}${digit}`;
      const firstMatchIndex = resolveFirstMenuPrefixMatchIndex(
        nextDigits,
        visibleItemIndices.length,
      );
      if (typeof firstMatchIndex !== "number") {
        clearNumericSelectionBuffer();
        return false;
      }
      numericSelectionBuffer = nextDigits;
      activeIndex = firstMatchIndex;
      const exactIndex = resolveMenuIndexFromDigits(
        numericSelectionBuffer,
        visibleItemIndices.length,
      );
      const canContinue = hasMenuDigitsContinuation(
        numericSelectionBuffer,
        visibleItemIndices.length,
      );
      if (typeof exactIndex === "number" && !canContinue) {
        selectAndFinish(exactIndex);
        return true;
      }
      scheduleNumericSelectionCommit();
      render();
      return true;
    };

    const applyNavigationAction = (action: SelectNavigationAction): void => {
      if (visibleItemIndices.length === 0) {
        render();
        return;
      }
      const visibleOptionCount = normalizeMenuVisibleOptionCount({
        itemsLength: visibleItemIndices.length,
        visibleOptionCount: input.visibleOptionCount,
        variant: input.variant,
      });
      const state = normalizeSelectNavigationState({
        optionCount: visibleItemIndices.length,
        focusedIndex: activeIndex,
        visibleOptionCount,
        previousVisibleFromIndex: viewportStartIndex,
      });
      const nextState = reduceSelectNavigation(state, action);
      activeIndex = nextState.focusedIndex;
      viewportStartIndex = nextState.visibleFromIndex;
      render();
    };

    const onData = (chunk: string): void => {
      const rawInput = String(chunk ?? "");
      if (rawInput === MENU_SEARCH_TOGGLE_CONTROL || (!menuSearchMode && rawInput === "/")) {
        menuSearchMode = !menuSearchMode || rawInput === "/";
        render();
        return;
      }
      if (rawInput === MENU_SEARCH_CLEAR_CONTROL && (menuSearchMode || menuSearchQuery.length > 0)) {
        applyMenuSearchQuery("");
        menuSearchMode = true;
        return;
      }
      if (menuSearchMode) {
        if (rawInput === "\u001b") {
          menuSearchMode = false;
          render();
          return;
        }
        if (rawInput === "\u007f" || rawInput === "\b") {
          dropMenuSearchLastGrapheme();
          return;
        }
        if (isMenuSearchPrintableInput(rawInput)) {
          applyMenuSearchQuery(`${menuSearchQuery}${rawInput}`);
          return;
        }
      }
      if (/^[0-9]$/.test(rawInput)) {
        if (handleSingleDigitSelection(rawInput)) {
          return;
        }
      } else {
        clearNumericSelectionBuffer();
      }
      if (/^[0-9]{2,}$/.test(rawInput.trim())) {
        const bufferedIndex = resolveMenuIndexFromDigits(
          rawInput.trim(),
          visibleItemIndices.length,
        );
        if (typeof bufferedIndex === "number") {
          selectAndFinish(bufferedIndex);
        }
        return;
      }
      const action = decodeMenuInput(chunk, visibleItemIndices.length);
      if (action.kind === "up") {
        applyNavigationAction({ type: "previous" });
        return;
      }
      if (action.kind === "down") {
        applyNavigationAction({ type: "next" });
        return;
      }
      if (action.kind === "page_up") {
        applyNavigationAction({ type: "page_up" });
        return;
      }
      if (action.kind === "page_down") {
        applyNavigationAction({ type: "page_down" });
        return;
      }
      if (action.kind === "select_index") {
        selectAndFinish(action.index);
        return;
      }
      if (action.kind === "enter") {
        if (visibleItemIndices.length === 0) {
          render();
          return;
        }
        selectAndFinish(activeIndex);
        return;
      }
      if (action.kind === "cancel") {
        if (menuSearchMode) {
          menuSearchMode = false;
          render();
          return;
        }
        if (menuSearchQuery.length > 0) {
          applyMenuSearchQuery("");
          return;
        }
        finish({ kind: "cancelled" });
      }
    };

    stdout.write("\x1b[?25l");
    stdin.setEncoding?.("utf8");
    onInput.call(stdin, "data", onData);
    try {
      setRawMode.call(stdin, true);
    } catch {
      finish({ kind: "cancelled" });
      return;
    }
    resumeInput.call(stdin);
    render();
  });
}
