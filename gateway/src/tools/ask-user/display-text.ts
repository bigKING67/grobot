const ANSI_CSI_SEQUENCE_PATTERN = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_SEQUENCE_PATTERN = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;
const ANSI_SINGLE_ESCAPE_PATTERN = /\u001B[@-Z\\-_]/g;

function stripAnsiSequences(value: string): string {
  return value
    .replace(ANSI_OSC_SEQUENCE_PATTERN, "")
    .replace(ANSI_CSI_SEQUENCE_PATTERN, "")
    .replace(ANSI_SINGLE_ESCAPE_PATTERN, "");
}

function isDisallowedCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f
    || codePoint === 0x7f
    || codePoint === 0x00ad
    || codePoint === 0x034f
    || codePoint === 0x061c
    || codePoint === 0x180e
    || (codePoint >= 0x200b && codePoint <= 0x200f)
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2060 && codePoint <= 0x206f)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || codePoint === 0xfeff
    || (codePoint >= 0xfff9 && codePoint <= 0xfffb)
  );
}

export function sanitizeAskUserDisplayText(value: string): string {
  if (!value) {
    return "";
  }
  const stripped = stripAnsiSequences(value);
  let result = "";
  for (const char of stripped) {
    if (char === "\t") {
      result += "    ";
      continue;
    }
    if (char === "\r" || char === "\n") {
      result += " ";
      continue;
    }
    const codePoint = char.codePointAt(0);
    if (typeof codePoint === "number" && isDisallowedCodePoint(codePoint)) {
      continue;
    }
    result += char;
  }
  return result;
}

export function compactAskUserDisplayLine(value: string, maxChars: number): string {
  const normalized = sanitizeAskUserDisplayText(value).trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return normalized.slice(0, Math.max(0, maxChars));
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}
