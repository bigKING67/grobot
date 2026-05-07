import { splitGraphemes } from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import { INLINE_IMAGE_RENDER_PATTERN } from "./contract";
import {
  codeOffsetFromGraphemeIndex,
  graphemeIndexFromCodeOffset,
  type PromptInputRenderSnapshot,
} from "./render";

export const BRACKETED_PASTE_START = "\u001B[200~";
export const BRACKETED_PASTE_END = "\u001B[201~";
export const BRACKETED_PASTE_BLOCK_PATTERN = /\u001B\[200~([\s\S]*?)\u001B\[201~/g;
export const BRACKETED_PASTE_BUFFER_LIMIT = 16_384;
export const PLAIN_ENTER_FALLBACK_DELAY_MS = 60;
export const ENTER_KEYPRESS_DEDUP_WINDOW_MS = 80;

export interface PromptInputBufferState {
  graphemes: string[];
  cursor: number;
}

export interface BracketedPasteKeypressGate {
  suppress: boolean;
  shouldIgnore: boolean;
}

export function stripBracketedPasteMarkers(value: string): string {
  if (!value || !value.includes("\u001B[")) {
    return value;
  }
  return value
    .split(BRACKETED_PASTE_START)
    .join("")
    .split(BRACKETED_PASTE_END)
    .join("");
}

export function resolveBracketedPasteKeypressGate(input: {
  currentSuppressed: boolean;
  keyName?: string;
  sequence?: string;
}): BracketedPasteKeypressGate {
  const normalizedName = (input.keyName ?? "").trim().toLowerCase();
  const sequence = String(input.sequence ?? "");
  if (normalizedName === "paste-start" || sequence === BRACKETED_PASTE_START) {
    return {
      suppress: true,
      shouldIgnore: true,
    };
  }
  if (normalizedName === "paste-end" || sequence === BRACKETED_PASTE_END) {
    return {
      suppress: false,
      shouldIgnore: true,
    };
  }
  if (input.currentSuppressed) {
    return {
      suppress: true,
      shouldIgnore: true,
    };
  }
  return {
    suppress: false,
    shouldIgnore: false,
  };
}

export function normalizePromptPastedTextInput(rawInput: string): string {
  if (!rawInput) {
    return "";
  }
  const normalizedWhitespace = String(rawInput)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ");
  return normalizedWhitespace
    .split("\n")
    .map((line) => sanitizeTerminalDisplayText(line))
    .join("\n");
}

export function clampPromptInputCursor(input: {
  cursor: number;
  graphemeCount: number;
}): number {
  return Math.max(0, Math.min(input.cursor, input.graphemeCount));
}

export function insertTextIntoPromptBuffer(input: {
  graphemes: readonly string[];
  cursor: number;
  value: string;
}): PromptInputBufferState {
  if (!input.value) {
    return {
      graphemes: [...input.graphemes],
      cursor: clampPromptInputCursor({
        cursor: input.cursor,
        graphemeCount: input.graphemes.length,
      }),
    };
  }
  const parsed = splitGraphemes(input.value);
  const cursor = clampPromptInputCursor({
    cursor: input.cursor,
    graphemeCount: input.graphemes.length,
  });
  if (parsed.length === 0) {
    return {
      graphemes: [...input.graphemes],
      cursor,
    };
  }
  const graphemes = [...input.graphemes];
  graphemes.splice(cursor, 0, ...parsed);
  return {
    graphemes,
    cursor: cursor + parsed.length,
  };
}

export function removeSelectedInlineImageToken(input: {
  graphemes: readonly string[];
  cursor: number;
}): PromptInputBufferState & { removed: boolean } {
  const value = input.graphemes.join("");
  const cursorCodeOffset = codeOffsetFromGraphemeIndex(input.graphemes, input.cursor);
  for (const match of value.matchAll(INLINE_IMAGE_RENDER_PATTERN)) {
    const start = match.index ?? -1;
    const token = match[0] ?? "";
    if (start < 0 || start !== cursorCodeOffset || token.length === 0) {
      continue;
    }
    const startIndex = graphemeIndexFromCodeOffset(input.graphemes, start);
    const endIndex = graphemeIndexFromCodeOffset(input.graphemes, start + token.length);
    const graphemes = [...input.graphemes];
    graphemes.splice(startIndex, Math.max(0, endIndex - startIndex));
    return {
      graphemes,
      cursor: startIndex,
      removed: true,
    };
  }
  return {
    graphemes: [...input.graphemes],
    cursor: clampPromptInputCursor({
      cursor: input.cursor,
      graphemeCount: input.graphemes.length,
    }),
    removed: false,
  };
}

export function stripPromptBufferBracketedPasteMarkers(input: {
  graphemes: readonly string[];
  cursor: number;
}): PromptInputBufferState & { stripped: boolean } {
  const before = input.graphemes.join("");
  if (!before.includes(BRACKETED_PASTE_START) && !before.includes(BRACKETED_PASTE_END)) {
    return {
      graphemes: [...input.graphemes],
      cursor: clampPromptInputCursor({
        cursor: input.cursor,
        graphemeCount: input.graphemes.length,
      }),
      stripped: false,
    };
  }
  const cursorCodeOffset = codeOffsetFromGraphemeIndex(input.graphemes, input.cursor);
  const beforeCursor = before.slice(0, cursorCodeOffset);
  const cleanedBeforeCursor = stripBracketedPasteMarkers(beforeCursor);
  const cleaned = stripBracketedPasteMarkers(before);
  if (cleaned === before) {
    return {
      graphemes: [...input.graphemes],
      cursor: clampPromptInputCursor({
        cursor: input.cursor,
        graphemeCount: input.graphemes.length,
      }),
      stripped: false,
    };
  }
  const graphemes = splitGraphemes(cleaned);
  return {
    graphemes,
    cursor: clampPromptInputCursor({
      cursor: graphemeIndexFromCodeOffset(graphemes, cleanedBeforeCursor.length),
      graphemeCount: graphemes.length,
    }),
    stripped: true,
  };
}

export function replacePromptBufferActiveLineWithCommand(input: {
  graphemes: readonly string[];
  snapshot: PromptInputRenderSnapshot | undefined;
  command: string;
}): (PromptInputBufferState & { replacedLine: string }) | undefined {
  const descriptor =
    input.snapshot?.descriptors[input.snapshot.activeLineIndex]
    ?? input.snapshot?.descriptors[0];
  if (!descriptor || !input.snapshot) {
    return undefined;
  }
  const leadingSpaces = input.snapshot.activeLineInput.match(/^\s*/)?.[0] ?? "";
  const replacedLine = `${leadingSpaces}${input.command}`;
  const replacement = splitGraphemes(replacedLine);
  const graphemes = [...input.graphemes];
  graphemes.splice(
    descriptor.start,
    Math.max(0, descriptor.end - descriptor.start),
    ...replacement,
  );
  return {
    graphemes,
    cursor: descriptor.start + replacement.length,
    replacedLine,
  };
}

export function movePromptBufferCursorVertical(input: {
  graphemes: readonly string[];
  cursor: number;
  snapshot: PromptInputRenderSnapshot | undefined;
  direction: -1 | 1;
}): number {
  const descriptor =
    input.snapshot?.descriptors[input.snapshot.activeLineIndex]
    ?? input.snapshot?.descriptors[0];
  if (!descriptor) {
    return input.cursor;
  }
  const column = Math.max(0, input.cursor - descriptor.start);
  if (input.direction < 0) {
    if (descriptor.start <= 0) {
      return input.cursor;
    }
    const prevBreak = descriptor.start - 1;
    let prevStart = 0;
    for (let index = prevBreak - 1; index >= 0; index -= 1) {
      if (input.graphemes[index] === "\n") {
        prevStart = index + 1;
        break;
      }
    }
    const prevLength = Math.max(0, prevBreak - prevStart);
    return prevStart + Math.min(column, prevLength);
  }
  if (descriptor.end >= input.graphemes.length || input.graphemes[descriptor.end] !== "\n") {
    return input.cursor;
  }
  const nextStart = descriptor.end + 1;
  let nextEnd = input.graphemes.length;
  for (let index = nextStart; index < input.graphemes.length; index += 1) {
    if (input.graphemes[index] === "\n") {
      nextEnd = index;
      break;
    }
  }
  const nextLength = Math.max(0, nextEnd - nextStart);
  return nextStart + Math.min(column, nextLength);
}
