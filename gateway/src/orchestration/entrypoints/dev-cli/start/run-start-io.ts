import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface, Interface } from "node:readline";
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
import { type TerminalSelectMenuInput, type TerminalSelectMenuResult } from "../ui/screens/select-menu-screen";

const HANDOFF_FILENAME = "HANDOFF.md";
const DEFAULT_SESSION_PROMPT = "› ";
const INLINE_IMAGE_PARSE_PATTERN = /\[Image #(\d+)\]/g;
const INLINE_IMAGE_RENDER_PATTERN = /\[Image #\d+\]/g;
const INLINE_IMAGE_REGISTRY_LIMIT = 512;
const ANSI_RESET = "\u001B[0m";
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

interface PauseableInput {
  pause?: () => void;
  resume?: () => void;
}

interface MenuInputStream {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
  on?: (event: "data", listener: (chunk: string) => void) => void;
  off?: (event: "data", listener: (chunk: string) => void) => void;
  resume?: () => void;
  setEncoding?: (encoding: string) => void;
}

interface ReadlineState extends Interface {
  line: string;
  cursor?: number;
  _writeToOutput?: (value: string) => void;
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

function highlightInlineImageToken(
  value: string,
  theme: "plain" | "nerd_font" | "ccline" | undefined,
): string {
  if (!value || !value.includes("[Image #")) {
    return value;
  }
  const tokenColor = resolveInlineImageTokenColor(theme);
  return value.replace(
    INLINE_IMAGE_RENDER_PATTERN,
    (placeholder) => `${tokenColor}${placeholder}${ANSI_RESET}`,
  );
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

function questionAsync(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (value) => {
      resolve(value);
    });
  });
}

function replaceReadlineInputLine(rl: Interface, value: string): void {
  const writer = rl as unknown as {
    write(data: string | null, key?: { ctrl?: boolean; name?: string }): void;
  };
  writer.write(null, {
    ctrl: true,
    name: "u",
  });
  if (value.length > 0) {
    writer.write(value);
  }
}

function buildSlashSuggestionCompleter(
  getSlashSuggestions: (input: string) => readonly SessionSlashSuggestion[],
): (line: string) => [string[], string] {
  return (line: string): [string[], string] => {
    const leadingSpaces = line.length - line.trimStart().length;
    const candidate = line.slice(leadingSpaces);
    if (!candidate.startsWith("/")) {
      return [[], candidate];
    }
    const suggestions = getSlashSuggestions(candidate);
    if (suggestions.length === 0) {
      return [[], candidate];
    }
    const completions = suggestions.map((item) => `${item.command} `);
    return [completions, candidate];
  };
}

function emitKeypressEventsCompat(input: unknown, rl: Interface): void {
  const maybeEmit = (readlineModule as unknown as {
    emitKeypressEvents?: (stream: unknown, iface?: Interface) => void;
  }).emitKeypressEvents;
  if (typeof maybeEmit === "function") {
    maybeEmit(input, rl);
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

  const completer = typeof options.getSlashSuggestions === "function"
    ? buildSlashSuggestionCompleter(options.getSlashSuggestions)
    : undefined;
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  } as unknown as {
    input: unknown;
    output?: unknown;
  });
  const readlineState = rl as ReadlineState;
  const originalWriteToOutput = typeof readlineState._writeToOutput === "function"
    ? readlineState._writeToOutput
    : undefined;
  if (originalWriteToOutput) {
    readlineState._writeToOutput = (value: string): void => {
      const highlightTheme = options.getInlineImageHighlightTheme?.();
      originalWriteToOutput.call(
        readlineState,
        highlightInlineImageToken(value, highlightTheme),
      );
    };
  }
  let sawSigint = false;
  rl.on("SIGINT", () => {
    sawSigint = true;
    rl.close();
  });
  const pauseableInput = process.stdin as unknown as PauseableInput;
  const menuInput = process.stdin as unknown as MenuInputStream;
  const keypressInput = process.stdin as unknown as KeypressInputStream;
  const controls: SessionInputLoopControls = {
    withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => {
      pauseableInput.pause?.();
      try {
        return await operation();
      } finally {
        pauseableInput.resume?.();
      }
    },
  };

  let handlerRunning = false;
  let escListenerAttached = false;
  let escArmedAt = 0;
  let liveFooterEnabled = false;
  let liveFooterContent = "";
  let activeSlashSuggestions: readonly SessionSlashSuggestion[] = [];
  let activeSlashSuggestionIndex = 0;
  let lastSlashLineInput = "";
  let slashOverlayPanel = "";
  let lowerDecorationSignature = "<empty>";
  let bracketedPasteBuffer = "";
  const escInputSupported = Boolean(
    options.onEscapeInterrupt
    && typeof menuInput.setRawMode === "function"
    && typeof menuInput.on === "function"
    && typeof menuInput.off === "function",
  );

  const renderLowerDecoration = (content: string): void => {
    const nextSignature = content.length > 0 ? content : "<empty>";
    if (nextSignature === lowerDecorationSignature) {
      return;
    }
    process.stdout.write("\x1b[s");
    process.stdout.write("\x1b[E");
    process.stdout.write("\x1b[J");
    if (content.length > 0) {
      process.stdout.write(content);
    }
    process.stdout.write("\x1b[u");
    lowerDecorationSignature = nextSignature;
  };

  const refreshLowerDecoration = (): void => {
    if (handlerRunning) {
      renderLowerDecoration("");
      return;
    }
    if (slashOverlayPanel.length > 0) {
      renderLowerDecoration(slashOverlayPanel);
      return;
    }
    if (liveFooterEnabled && liveFooterContent.length > 0) {
      renderLowerDecoration(`${liveFooterContent}\n`);
      return;
    }
    renderLowerDecoration("");
  };

  const clearSlashSuggestionOverlay = (): void => {
    slashOverlayPanel = "";
    activeSlashSuggestions = [];
    activeSlashSuggestionIndex = 0;
    lastSlashLineInput = "";
    refreshLowerDecoration();
  };

  const refreshSlashSuggestionOverlay = (): void => {
    if (handlerRunning || typeof options.getSlashSuggestions !== "function") {
      clearSlashSuggestionOverlay();
      return;
    }
    const lineInput = readlineState.line ?? "";
    if (lineInput !== lastSlashLineInput) {
      activeSlashSuggestionIndex = 0;
      lastSlashLineInput = lineInput;
    }
    const suggestions = options.getSlashSuggestions(lineInput);
    activeSlashSuggestions = suggestions;
    if (activeSlashSuggestions.length === 0) {
      activeSlashSuggestionIndex = 0;
    } else {
      activeSlashSuggestionIndex = normalizeSuggestionIndex(
        activeSlashSuggestions.length,
        activeSlashSuggestionIndex,
      );
    }
    const panel = formatSlashSuggestionPanel(
      activeSlashSuggestions,
      lineInput,
      activeSlashSuggestionIndex,
      resolveSlashOverlayColumns(),
    );
    slashOverlayPanel = panel;
    refreshLowerDecoration();
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

  const onEscData = (chunk: string): void => {
    if (!handlerRunning) {
      return;
    }
    const raw = String(chunk);
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

  const setEscListener = (enabled: boolean): void => {
    if (!escInputSupported) {
      return;
    }
    if (enabled) {
      if (escListenerAttached) {
        return;
      }
      menuInput.setEncoding?.("utf8");
      menuInput.on?.("data", onEscData);
      try {
        menuInput.setRawMode?.(true);
      } catch {
        menuInput.off?.("data", onEscData);
        return;
      }
      escListenerAttached = true;
      menuInput.resume?.();
      return;
    }
    if (!escListenerAttached) {
      return;
    }
    menuInput.off?.("data", onEscData);
    try {
      menuInput.setRawMode?.(false);
    } catch {
      // ignore raw mode restore errors
    }
    escListenerAttached = false;
  };

  const tryPasteInlineClipboardImage = (): boolean => {
    const attachment = saveClipboardImageToTempFile();
    if (!attachment) {
      return false;
    }
    const placeholder = registerInlineImageAttachment(attachment);
    const lineBefore = readlineState.line ?? "";
    const cursorBefore = typeof readlineState.cursor === "number"
      ? Math.max(0, Math.min(readlineState.cursor, lineBefore.length))
      : lineBefore.length;
    const nextLine = `${lineBefore.slice(0, cursorBefore)}${placeholder}${lineBefore.slice(cursorBefore)}`;
    replaceReadlineInputLine(rl, nextLine);
    const trailingChars = lineBefore.length - cursorBefore;
    if (trailingChars > 0) {
      process.stdout.write(`\x1b[${String(trailingChars)}D`);
    }
    return true;
  };

  const stripBracketedPasteMarkersFromInputLine = (): boolean => {
    const lineBefore = readlineState.line ?? "";
    const lineAfter = stripBracketedPasteMarkers(lineBefore);
    if (lineAfter === lineBefore) {
      return false;
    }
    replaceReadlineInputLine(rl, lineAfter);
    return true;
  };

  const handleBracketedPastePayload = (payload: string): void => {
    queueMicrotask(() => {
      if (handlerRunning) {
        return;
      }
      const stripped = stripBracketedPasteMarkersFromInputLine();
      if (payload.trim().length > 0) {
        if (stripped) {
          refreshSlashSuggestionOverlay();
        }
        return;
      }
      const pasted = tryPasteInlineClipboardImage();
      if (pasted || stripped) {
        refreshSlashSuggestionOverlay();
      }
    });
  };

  const onInputData = (chunk: string): void => {
    if (handlerRunning) {
      return;
    }
    const raw = String(chunk ?? "");
    if (raw.length === 0) {
      return;
    }
    if (!raw.includes(BRACKETED_PASTE_START) && !raw.includes(BRACKETED_PASTE_END) && bracketedPasteBuffer.length === 0) {
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
    const tailLength = Math.max(BRACKETED_PASTE_START.length - 1, BRACKETED_PASTE_END.length - 1);
    if (bracketedPasteBuffer.length > tailLength) {
      bracketedPasteBuffer = bracketedPasteBuffer.slice(-tailLength);
    }
  };

  const onKeypress = (_chunk: string, key: KeypressPayload): void => {
    if (handlerRunning) {
      return;
    }
    const imagePasteTriggered =
      (key.ctrl && key.name === "v")
      || (key.meta && key.name === "v")
      || (key.shift && key.name === "insert")
      || key.sequence === "\u0016";
    if (imagePasteTriggered) {
      const pasted = tryPasteInlineClipboardImage();
      if (pasted) {
        queueMicrotask(() => {
          if (handlerRunning) {
            return;
          }
          refreshSlashSuggestionOverlay();
        });
      }
      return;
    }
    const lineBefore = readlineState.line ?? "";
    const slashSuggestionsEnabled = typeof options.getSlashSuggestions === "function";
    const hasActiveSlashSuggestions = lineBefore.trimStart().startsWith("/")
      && activeSlashSuggestions.length > 0
      && slashSuggestionsEnabled;
    if (hasActiveSlashSuggestions && key.name === "up") {
      activeSlashSuggestionIndex = normalizeSuggestionIndex(
        activeSlashSuggestions.length,
        activeSlashSuggestionIndex - 1,
      );
      queueMicrotask(() => {
        if ((readlineState.line ?? "") !== lineBefore) {
          replaceReadlineInputLine(rl, lineBefore);
        }
        refreshSlashSuggestionOverlay();
      });
      return;
    }
    if (hasActiveSlashSuggestions && key.name === "down") {
      activeSlashSuggestionIndex = normalizeSuggestionIndex(
        activeSlashSuggestions.length,
        activeSlashSuggestionIndex + 1,
      );
      queueMicrotask(() => {
        if ((readlineState.line ?? "") !== lineBefore) {
          replaceReadlineInputLine(rl, lineBefore);
        }
        refreshSlashSuggestionOverlay();
      });
      return;
    }
    if (hasActiveSlashSuggestions && key.name === "return") {
      const selected = activeSlashSuggestions[activeSlashSuggestionIndex];
      if (selected?.command) {
        replaceReadlineInputLine(rl, selected.command);
        activeSlashSuggestionIndex = 0;
      }
      return;
    }
    if (key.ctrl && key.name === "c") {
      return;
    }
    queueMicrotask(() => {
      if (handlerRunning) {
        return;
      }
      refreshSlashSuggestionOverlay();
    });
  };

  emitKeypressEventsCompat(process.stdin, rl);
  menuInput.setEncoding?.("utf8");
  menuInput.on?.("data", onInputData);
  keypressInput.on?.("keypress", onKeypress);

  while (true) {
    let rawInput = "";
    let resolvedPrompt: SessionPromptLayout = {
      prefix: "",
      inlinePrompt: DEFAULT_SESSION_PROMPT,
      suffix: "",
    };
    let liveFooterMode = false;
    try {
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
      resolvedPrompt = resolveInteractivePromptLayout({
        promptText: promptValue,
        fallbackPrompt: DEFAULT_SESSION_PROMPT,
      });
      clearSlashSuggestionOverlay();
      liveFooterMode = Boolean(
        resolvedPrompt.renderSuffixWhileTyping
        && typeof resolvedPrompt.suffix === "string"
        && resolvedPrompt.suffix.length > 0,
      );
      liveFooterEnabled = liveFooterMode;
      liveFooterContent = liveFooterMode ? (resolvedPrompt.suffix ?? "") : "";
      if (resolvedPrompt.prefix.length > 0) {
        process.stdout.write(`${resolvedPrompt.prefix}\n`);
      }
      const promptPromise = questionAsync(rl, resolvedPrompt.inlinePrompt);
      if (liveFooterMode) {
        queueMicrotask(() => {
          if (handlerRunning) {
            return;
          }
          refreshSlashSuggestionOverlay();
        });
      }
      rawInput = await promptPromise;
    } catch {
      liveFooterEnabled = false;
      liveFooterContent = "";
      clearSlashSuggestionOverlay();
      break;
    }
    liveFooterEnabled = false;
    liveFooterContent = "";
    clearSlashSuggestionOverlay();
    if (!sawSigint && !liveFooterMode && resolvedPrompt.suffix && resolvedPrompt.suffix.length > 0) {
      process.stdout.write(`${resolvedPrompt.suffix}\n`);
    }
    if (sawSigint) {
      process.stdout.write("Interrupted\n");
      break;
    }
    handlerRunning = true;
    setEscListener(true);
    let action: "continue" | "break";
    try {
      action = await handler(rawInput, controls);
    } finally {
      setEscListener(false);
      handlerRunning = false;
    }
    if (action === "break") {
      break;
    }
  }

  clearSlashSuggestionOverlay();
  keypressInput.off?.("keypress", onKeypress);
  menuInput.off?.("data", onInputData);
  setEscListener(false);
  if (originalWriteToOutput) {
    readlineState._writeToOutput = originalWriteToOutput;
  }
  rl.close();
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
