const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;
const COMBINING_MARK_PATTERN = /\p{Mark}/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const DEFAULT_ELLIPSIS = "...";

const CJK_WIDTH_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x3247],
  [0x3250, 0x4dbf],
  [0x4e00, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

const GRAPHEME_SEGMENTER = (
  Intl as unknown as {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity?: "grapheme" | "word" | "sentence" },
    ) => { segment(input: string): Iterable<{ segment: string }> };
  }
).Segmenter
  ? new (
    Intl as unknown as {
      Segmenter: new (
        locales?: string | string[],
        options?: { granularity?: "grapheme" | "word" | "sentence" },
      ) => { segment(input: string): Iterable<{ segment: string }> };
    }
  ).Segmenter(undefined, { granularity: "grapheme" })
  : undefined;

export interface TruncateDisplayWidthOptions {
  compact?: boolean;
  ellipsis?: string;
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

export function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function splitGraphemes(value: string): string[] {
  if (GRAPHEME_SEGMENTER) {
    const segments: string[] = [];
    for (const part of GRAPHEME_SEGMENTER.segment(value)) {
      segments.push(part.segment);
    }
    return segments;
  }
  return Array.from(value);
}

function isWideCodePoint(codePoint: number): boolean {
  for (const [start, end] of CJK_WIDTH_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

export function getGraphemeDisplayWidth(grapheme: string): number {
  if (!grapheme) {
    return 0;
  }
  if (EMOJI_PATTERN.test(grapheme)) {
    return 2;
  }
  let width = 0;
  for (const char of Array.from(grapheme)) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") {
      continue;
    }
    if ((codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      continue;
    }
    if (COMBINING_MARK_PATTERN.test(char) || codePoint === 0x200d || codePoint === 0xfe0f) {
      continue;
    }
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function measureDisplayWidth(value: string): number {
  const normalized = stripAnsi(value);
  let width = 0;
  for (const grapheme of splitGraphemes(normalized)) {
    width += getGraphemeDisplayWidth(grapheme);
  }
  return width;
}

export function truncateDisplayWidth(
  value: string,
  maxWidth: number,
  options: TruncateDisplayWidthOptions = {},
): string {
  if (maxWidth <= 0) {
    return "";
  }
  const normalized = options.compact ? compactSpaces(value) : value;
  if (!normalized) {
    return "";
  }
  const fullWidth = measureDisplayWidth(normalized);
  if (fullWidth <= maxWidth) {
    return normalized;
  }
  const ellipsis = options.ellipsis ?? DEFAULT_ELLIPSIS;
  const ellipsisWidth = measureDisplayWidth(ellipsis);
  if (maxWidth <= ellipsisWidth) {
    let output = "";
    let usedWidth = 0;
    for (const grapheme of splitGraphemes(normalized)) {
      const nextWidth = getGraphemeDisplayWidth(grapheme);
      if (usedWidth + nextWidth > maxWidth) {
        break;
      }
      output += grapheme;
      usedWidth += nextWidth;
    }
    return output;
  }
  const targetWidth = maxWidth - ellipsisWidth;
  let output = "";
  let usedWidth = 0;
  for (const grapheme of splitGraphemes(normalized)) {
    const nextWidth = getGraphemeDisplayWidth(grapheme);
    if (usedWidth + nextWidth > targetWidth) {
      break;
    }
    output += grapheme;
    usedWidth += nextWidth;
  }
  return `${output}${ellipsis}`;
}

export function padToDisplayWidth(value: string, width: number): string {
  const missing = width - measureDisplayWidth(value);
  if (missing <= 0) {
    return value;
  }
  return `${value}${" ".repeat(missing)}`;
}
