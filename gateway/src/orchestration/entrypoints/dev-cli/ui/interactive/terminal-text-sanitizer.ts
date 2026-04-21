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

export function sanitizeTerminalDisplayText(value: string): string {
  if (!value) {
    return "";
  }
  const stripped = stripAnsiSequences(value);
  let result = "";
  for (const char of stripped) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint === "number" && isDisallowedCodePoint(codePoint)) {
      continue;
    }
    result += char;
  }
  return result;
}

export function sanitizeTerminalTitle(
  value: string,
  maxLength = 96,
): string {
  const normalized = sanitizeTerminalDisplayText(value).trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (maxLength <= 0) {
    return "";
  }
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 3) {
    return chars.slice(0, maxLength).join("");
  }
  return `${chars.slice(0, maxLength - 3).join("")}...`;
}

function resolveProcessPlatform(): string {
  const runtimeProcess = process as unknown as { platform?: string };
  return (runtimeProcess.platform ?? "").toLowerCase();
}

function setProcessTitle(value: string): void {
  const runtimeProcess = process as unknown as { title?: string };
  runtimeProcess.title = value;
}

export function setTerminalWindowTitle(rawTitle: string): void {
  const stdout = process.stdout as typeof process.stdout & { isTTY?: boolean };
  if (!stdout.isTTY) {
    return;
  }
  const title = sanitizeTerminalTitle(rawTitle);
  if (!title) {
    return;
  }
  if (resolveProcessPlatform() === "win32") {
    setProcessTitle(title);
    return;
  }
  process.stdout.write(`\u001B]0;${title}\u0007`);
}

export function clearTerminalWindowTitle(): void {
  const stdout = process.stdout as typeof process.stdout & { isTTY?: boolean };
  if (!stdout.isTTY) {
    return;
  }
  if (resolveProcessPlatform() === "win32") {
    setProcessTitle("");
    return;
  }
  process.stdout.write("\u001B]0;\u0007");
}
