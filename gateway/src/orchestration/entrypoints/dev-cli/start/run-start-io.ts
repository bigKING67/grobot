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

export interface InlineAttachmentResolution {
  userInput: string;
  attachments: RuntimeAttachment[];
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
      return 2 + promptLabelWidth + measureDisplayWidth(before);
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
        return {
          suggestions: [],
          panelLines: [],
        };
      }
      if (activeLineInput !== lastSlashLineInput) {
        activeSlashSuggestionIndex = 0;
        lastSlashLineInput = activeLineInput;
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
      const maxContentWidth = Math.max(promptLabelWidth + 8, terminalColumns - 4);
      const wrapWidth = Math.max(1, maxContentWidth - promptLabelWidth);
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

      const topBorder = `${ANSI_DIM}╭${"─".repeat(maxContentWidth + 2)}╮${ANSI_RESET}`;
      const bottomBorder = `${ANSI_DIM}╰${"─".repeat(maxContentWidth + 2)}╯${ANSI_RESET}`;
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
        const content = padToDisplayWidth(`${prefix}${renderedText}`, maxContentWidth);
        return `${ANSI_DIM}│${ANSI_RESET} ${content} ${ANSI_DIM}│${ANSI_RESET}`;
      });
      const slash = resolveSlashSuggestions(activeLineInput);
      const renderedLines = [
        topBorder,
        ...bodyLines,
        bottomBorder,
        ...slash.panelLines,
        ...footerLines,
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

    const replaceActiveLineWithCommand = (command: string): void => {
      if (!latestSnapshot) {
        return;
      }
      const descriptor =
        latestSnapshot.descriptors[latestSnapshot.activeLineIndex]
        ?? latestSnapshot.descriptors[0];
      if (!descriptor) {
        return;
      }
      const leadingSpaces = latestSnapshot.activeLineInput.match(/^\s*/)?.[0] ?? "";
      const replacement = splitGraphemes(`${leadingSpaces}${command}`);
      graphemes.splice(
        descriptor.start,
        Math.max(0, descriptor.end - descriptor.start),
        ...replacement,
      );
      cursor = descriptor.start + replacement.length;
      activeSlashSuggestionIndex = 0;
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

      const onData = (chunk: string): void => {
        if (closed) {
          return;
        }
        const raw = String(chunk ?? "");
        if (
          raw.length === 0
          || (
            !raw.includes(BRACKETED_PASTE_START)
            && !raw.includes(BRACKETED_PASTE_END)
            && bracketedPasteBuffer.length === 0
          )
        ) {
          return;
        }
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
      };

      const onKeypress = (chunk: string, key: KeypressPayload): void => {
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

        const activeSuggestions = latestSnapshot?.activeSlashSuggestions ?? [];
        const hasActiveSlashSuggestions =
          latestSnapshot?.activeLineInput.trimStart().startsWith("/")
          && activeSuggestions.length > 0;

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
        if (key.name === "up") {
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
        if (key.name === "down") {
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
        if (key.name === "return") {
          if (hasActiveSlashSuggestions) {
            const selected = activeSuggestions[activeSlashSuggestionIndex];
            if (selected?.command) {
              replaceActiveLineWithCommand(selected.command);
              render();
            }
            return;
          }
          if (key.shift || key.meta) {
            insertTextAtCursor("\n");
            render();
            return;
          }
          finish({
            kind: "submit",
            value: graphemes.join(""),
          });
          return;
        }
        if (key.name === "tab") {
          return;
        }
        if (key.name === "escape") {
          return;
        }

        const rawInput = String(chunk ?? "");
        if (!rawInput || key.ctrl || key.meta) {
          return;
        }
        const normalized = stripBracketedPasteMarkers(rawInput)
          .replace(/\r/g, "\n");
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

function decodeMenuInput(rawInput: string): "up" | "down" | "enter" | "cancel" | "ignore" {
  if (rawInput.length === 0) {
    return "ignore";
  }
  if (rawInput.length === 1) {
    const firstChar = rawInput[0];
    if (firstChar === "\u0003" || firstChar === "\u001b") {
      return "cancel";
    }
    if (firstChar === "\r" || firstChar === "\n") {
      return "enter";
    }
    if (firstChar === "k") {
      return "up";
    }
    if (firstChar === "j") {
      return "down";
    }
    return "ignore";
  }
  if (rawInput.startsWith("\u001b[A") || rawInput.startsWith("\u001bOA")) {
    return "up";
  }
  if (rawInput.startsWith("\u001b[B") || rawInput.startsWith("\u001bOB")) {
    return "down";
  }
  return "ignore";
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

  const render = (): void => {
    stdout.write("\x1b[2J\x1b[H");
    stdout.write(`${uiRenderer.renderSelectMenu(input, activeIndex)}\n`);
  };

  return await new Promise<TerminalSelectMenuResult>((resolve) => {
    const cleanup = (): void => {
      if (!resolved) {
        return;
      }
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

    const onData = (chunk: string): void => {
      const action = decodeMenuInput(chunk);
      if (action === "up") {
        activeIndex = (activeIndex - 1 + input.items.length) % input.items.length;
        render();
        return;
      }
      if (action === "down") {
        activeIndex = (activeIndex + 1) % input.items.length;
        render();
        return;
      }
      if (action === "enter") {
        finish({
          kind: "selected",
          item: input.items[activeIndex],
          index: activeIndex,
        });
        return;
      }
      if (action === "cancel") {
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
