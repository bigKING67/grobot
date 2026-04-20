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
} from "../ui/interactive/display-width";
import { type TerminalSelectMenuInput, type TerminalSelectMenuResult } from "../ui/screens/select-menu-screen";

const HANDOFF_FILENAME = "HANDOFF.md";
const DEFAULT_SESSION_PROMPT = "› ";
const INLINE_IMAGE_PARSE_PATTERN = /\[Image #(\d+)\]/g;
const INLINE_IMAGE_RENDER_PATTERN = /\[Image #\d+\]/g;
const INLINE_IMAGE_REGISTRY_LIMIT = 512;
const ANSI_RESET = "\u001B[0m";
const ANSI_DIM = "\u001B[90m";
const ANSI_INVERSE = "\u001B[7m";
const ANSI_INLINE_IMAGE_TOKEN_PLAIN = "\u001B[96m";
const ANSI_INLINE_IMAGE_TOKEN_NERD = "\u001B[94m";
const ANSI_INLINE_IMAGE_TOKEN_CCLINE = "\u001B[1m\u001B[96m";
const BRACKETED_PASTE_START = "\u001B[200~";
const BRACKETED_PASTE_END = "\u001B[201~";
const BRACKETED_PASTE_BLOCK_PATTERN = /\u001B\[200~([\s\S]*?)\u001B\[201~/g;
const BRACKETED_PASTE_BUFFER_LIMIT = 16_384;

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

export interface SessionInputLoopOptions {
  onEscapeInterrupt?: () => void | Promise<void>;
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
  getInlineImageHighlightTheme?: () => "plain" | "nerd_font" | "ccline" | undefined;
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

export type MenuInputAction =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "enter" }
  | { kind: "cancel" }
  | { kind: "ignore" }
  | { kind: "select_index"; index: number };

const MENU_DIGIT_SELECTION_COMMIT_DELAY_MS = 250;

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
  interface InputLineDescriptor {
    start: number;
    end: number;
    text: string;
    textWidth: number;
    codeStart: number;
    codeEnd: number;
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

  const triggerEscInterrupt = (): void => {
    if (typeof options.onEscapeInterrupt !== "function") {
      return;
    }
    const maybePromise = options.onEscapeInterrupt();
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
    triggerEscInterrupt();
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

  const buildCodeOffsets = (graphemes: readonly string[]): number[] => {
    const offsets: number[] = [0];
    let total = 0;
    for (const grapheme of graphemes) {
      total += grapheme.length;
      offsets.push(total);
    }
    return offsets;
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

  const renderInlineImageTokens = (input: {
    text: string;
    theme: "plain" | "nerd_font" | "ccline" | undefined;
    selectedStartOffset?: number;
  }): string => {
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
  };

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
    let activeSlashSuggestionIndex = 0;
    let lastSlashLineInput = "";
    let slashSuggestionsHiddenForLine = "";
    let latestSnapshot: InputRenderSnapshot | undefined;
    let closed = false;

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
    }): InputLineDescriptor[] => {
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
    };

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
      const inputLineWidth = Math.max(promptLabelWidth + 8, terminalColumns - 1);
      const wrapWidth = Math.max(1, inputLineWidth - promptLabelWidth);
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

      const topBorder = `${ANSI_DIM}${"─".repeat(inputLineWidth)}${ANSI_RESET}`;
      const bottomBorder = `${ANSI_DIM}${"─".repeat(inputLineWidth)}${ANSI_RESET}`;
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
        return padToDisplayWidth(`${prefix}${renderedText}`, inputLineWidth);
      });
      const slash = resolveSlashSuggestions(activeLineInput);
      const shouldRenderFooter = slash.panelLines.length === 0;
      const renderedLines = [
        topBorder,
        ...bodyLines,
        bottomBorder,
        ...slash.panelLines,
        ...(shouldRenderFooter ? footerLines : []),
      ];
      const cursorRenderLineIndex = 1 + activeLineIndex;
      const cursorColumn = resolveCursorColumn(activeDescriptor);
      return {
        renderedLines,
        cursorRenderLineIndex,
        cursorColumn,
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

    return await new Promise<{ kind: "submit"; value: string } | { kind: "sigint" }>((resolve) => {
      const finish = (result: { kind: "submit"; value: string } | { kind: "sigint" }): void => {
        if (closed) {
          return;
        }
        closed = true;
        keypressInput.off?.("keypress", onKeypress);
        menuInput.off?.("data", onData);
        moveCursorToOutputLine();
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
          finish({ kind: "sigint" });
          return;
        }
        const coalescedSubmit = resolveCoalescedSubmitChunk(raw);
        if (coalescedSubmit.shouldSubmit) {
          const normalized = stripBracketedPasteMarkers(coalescedSubmit.normalizedChunk)
            .replace(/\r/g, "\n");
          if (normalized.length > 0) {
            insertTextAtCursor(normalized);
          }
          handleEnterLikeAction("submit");
          return;
        }
        const submitKeyAction = resolveSubmitKeyAction({
          chunk: raw,
          key: {},
        });
        if (submitKeyAction !== "none") {
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

        if (key.ctrl && key.name === "c") {
          finish({ kind: "sigint" });
          return;
        }
        if (key.name === "left") {
          cursor -= 1;
          clampCursor();
          render();
          return;
        }
        if (key.name === "right") {
          cursor += 1;
          clampCursor();
          render();
          return;
        }
        if (key.name === "home") {
          const descriptor = latestSnapshot?.descriptors[latestSnapshot.activeLineIndex ?? 0];
          if (descriptor) {
            cursor = descriptor.start;
            render();
          }
          return;
        }
        if (key.name === "end") {
          const descriptor = latestSnapshot?.descriptors[latestSnapshot.activeLineIndex ?? 0];
          if (descriptor) {
            cursor = descriptor.end;
            render();
          }
          return;
        }
        if (moveSuggestionUp) {
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
          if (!removeSelectedInlineImageToken() && cursor > 0) {
            graphemes.splice(cursor - 1, 1);
            cursor -= 1;
          }
          render();
          return;
        }
        if (key.name === "delete") {
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
            const replacedLine = replaceActiveLineWithCommand(slashAction.appliedCommand);
            if (typeof replacedLine === "string") {
              slashSuggestionsHiddenForLine = replacedLine;
            }
            render();
            return;
          }
          if (slashAction.kind === "hide_panel") {
            slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
            activeSlashSuggestionIndex = 0;
            render();
          }
          return;
        }
        if (key.name === "escape") {
          const slashAction = resolveSlashSuggestionKeyAction({
            key: "escape",
            hasActiveSuggestions: hasActiveSlashSuggestions,
            selectedCommand: activeSuggestions[activeSlashSuggestionIndex]?.command,
            activeLineInput: latestSnapshot?.activeLineInput,
          });
          if (slashAction.kind === "hide_panel") {
            slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
            activeSlashSuggestionIndex = 0;
            render();
          }
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
          handleEnterLikeAction("submit");
          return;
        }
        if (!normalized) {
          return;
        }
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
  return { kind: "ignore" };
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
  let activeIndex = normalizeMenuIndex(input.items.length, input.initialIndex);
  let resolved = false;
  let numericSelectionBuffer = "";
  let numericSelectionTimer: ReturnType<typeof setTimeout> | undefined;

  const render = (): void => {
    stdout.write("\x1b[2J\x1b[H");
    stdout.write(`${uiRenderer.renderSelectMenu(input, activeIndex)}\n`);
  };

  const clearNumericSelectionBuffer = (): void => {
    numericSelectionBuffer = "";
    if (numericSelectionTimer) {
      clearTimeout(numericSelectionTimer);
      numericSelectionTimer = undefined;
    }
  };

  return await new Promise<TerminalSelectMenuResult>((resolve) => {
    const cleanup = (): void => {
      if (!resolved) {
        return;
      }
      clearNumericSelectionBuffer();
      offInput.call(stdin, "data", onData);
      try {
        setRawMode.call(stdin, false);
      } catch {
        // ignore raw mode teardown errors
      }
      stdout.write("\x1b[?25h");
      stdout.write("\x1b[?1049l");
    };

    const finish = (result: TerminalSelectMenuResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(result);
    };

    const selectAndFinish = (nextIndex: number): void => {
      activeIndex = nextIndex;
      finish({
        kind: "selected",
        item: input.items[activeIndex],
        index: activeIndex,
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
          input.items.length,
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
        input.items.length,
      );
      if (typeof firstMatchIndex !== "number") {
        clearNumericSelectionBuffer();
        return false;
      }
      numericSelectionBuffer = nextDigits;
      activeIndex = firstMatchIndex;
      const exactIndex = resolveMenuIndexFromDigits(
        numericSelectionBuffer,
        input.items.length,
      );
      const canContinue = hasMenuDigitsContinuation(
        numericSelectionBuffer,
        input.items.length,
      );
      if (typeof exactIndex === "number" && !canContinue) {
        selectAndFinish(exactIndex);
        return true;
      }
      scheduleNumericSelectionCommit();
      render();
      return true;
    };

    const onData = (chunk: string): void => {
      const rawInput = String(chunk ?? "");
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
          input.items.length,
        );
        if (typeof bufferedIndex === "number") {
          selectAndFinish(bufferedIndex);
        }
        return;
      }
      const action = decodeMenuInput(chunk, input.items.length);
      if (action.kind === "up") {
        activeIndex = (activeIndex - 1 + input.items.length) % input.items.length;
        render();
        return;
      }
      if (action.kind === "down") {
        activeIndex = (activeIndex + 1) % input.items.length;
        render();
        return;
      }
      if (action.kind === "select_index") {
        selectAndFinish(action.index);
        return;
      }
      if (action.kind === "enter") {
        selectAndFinish(activeIndex);
        return;
      }
      if (action.kind === "cancel") {
        finish({ kind: "cancelled" });
      }
    };

    stdout.write("\x1b[?1049h");
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
