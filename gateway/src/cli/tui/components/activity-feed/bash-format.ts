import { compactSpaces } from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";

export const BASH_COMMAND_DISPLAY_MAX_LINES = 2;
export const BASH_COMMAND_DISPLAY_MAX_CHARS = 160;

export function formatBashCommandDisplay(command: string): string {
  const normalized = command
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => sanitizeTerminalDisplayText(line.replace(/\t/g, " ")))
    .join("\n")
    .trim();
  if (!normalized) {
    return "";
  }
  const lines = normalized.split("\n");
  let truncated = lines.slice(0, BASH_COMMAND_DISPLAY_MAX_LINES).join("\n");
  const wasTruncatedByLine = lines.length > BASH_COMMAND_DISPLAY_MAX_LINES;
  const wasTruncatedByChar = truncated.length > BASH_COMMAND_DISPLAY_MAX_CHARS;
  if (wasTruncatedByChar) {
    truncated = truncated.slice(0, BASH_COMMAND_DISPLAY_MAX_CHARS);
  }
  const display = compactSpaces(truncated.trim());
  return wasTruncatedByLine || wasTruncatedByChar ? `${display}…` : display;
}
