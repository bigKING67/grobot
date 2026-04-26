const ANSI_BOLD = "\u001B[1m";
const ANSI_DIM = "\u001B[90m";
const ANSI_RESET = "\u001B[0m";
const ANSI_PATTERN = /\u001B\[[0-9;]*m/;
const FENCE_PATTERN = /^\s*```/;
const STRONG_ASTERISK_PATTERN = /\*\*([^\n*](?:[^\n]*?[^\n*])?)\*\*/g;
const STRONG_UNDERSCORE_PATTERN = /__([^\n_](?:[^\n]*?[^\n_])?)__/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

function renderInlineMarkdown(line: string): string {
  if (!line || ANSI_PATTERN.test(line)) {
    return line;
  }
  const headingMatch = HEADING_PATTERN.exec(line);
  if (headingMatch) {
    return `${ANSI_BOLD}${headingMatch[2] ?? ""}${ANSI_RESET}`;
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
}): string {
  if (input.enabled === false || input.text.length === 0) {
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
