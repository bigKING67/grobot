const ANSI_BOLD = "\u001B[1m";
const ANSI_DIM = "\u001B[90m";
const ANSI_RESET = "\u001B[0m";
const ANSI_PATTERN = /\u001B\[[0-9;]*m/;
const FENCE_PATTERN = /^\s*```/;
const STRONG_ASTERISK_PATTERN = /\*\*([^\n*](?:[^\n]*?[^\n*])?)\*\*/g;
const STRONG_UNDERSCORE_PATTERN = /__([^\n_](?:[^\n]*?[^\n_])?)__/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

export type TerminalMarkdownMode = "off" | "basic" | "rich";

export function resolveTerminalMarkdownMode(valueRaw?: string): TerminalMarkdownMode {
  const value = (valueRaw ?? "").trim().toLowerCase();
  if (
    value === "0"
    || value === "false"
    || value === "no"
    || value === "off"
    || value === "disable"
    || value === "disabled"
  ) {
    return "off";
  }
  if (value === "rich" || value === "full") {
    return "rich";
  }
  return "basic";
}

function renderInlineMarkdown(line: string): string {
  if (!line || ANSI_PATTERN.test(line)) {
    return line;
  }
  const headingMatch = HEADING_PATTERN.exec(line);
  if (headingMatch) {
    return `${ANSI_BOLD}${headingMatch[1] ?? ""} ${headingMatch[2] ?? ""}${ANSI_RESET}`;
  }
  return line
    .replace(
      STRONG_ASTERISK_PATTERN,
      (_match: string, content: string) => `${ANSI_BOLD}${content}${ANSI_RESET}`,
    )
    .replace(
      STRONG_UNDERSCORE_PATTERN,
      (_match: string, content: string) => `${ANSI_BOLD}${content}${ANSI_RESET}`,
    )
    .replace(
      INLINE_CODE_PATTERN,
      (_match: string, content: string) => `${ANSI_DIM}${content}${ANSI_RESET}`,
    );
}

export function renderTerminalMarkdown(input: {
  text: string;
  enabled?: boolean;
  mode?: TerminalMarkdownMode;
}): string {
  const mode = input.enabled === false ? "off" : input.mode ?? "basic";
  if (mode === "off" || input.text.length === 0) {
    return input.text;
  }

  let inFence = false;
  return input.text
    .split(/\r?\n/)
    .map((line) => {
      if (FENCE_PATTERN.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return renderInlineMarkdown(line);
    })
    .join("\n");
}
