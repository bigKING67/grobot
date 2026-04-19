import {
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "./display-width";

export interface SlashOverlaySuggestion {
  command: string;
  description?: string;
  source?: string;
}

export function resolveSlashOverlayColumns(): number {
  const stdoutState = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdoutState.isTTY
    && typeof stdoutState.columns === "number"
    && Number.isFinite(stdoutState.columns)
    && stdoutState.columns > 0
  ) {
    return Math.floor(stdoutState.columns);
  }
  return 96;
}

export function normalizeSuggestionIndex(itemsLength: number, index: number): number {
  if (itemsLength <= 0) {
    return 0;
  }
  const normalized = index % itemsLength;
  if (normalized < 0) {
    return normalized + itemsLength;
  }
  return normalized;
}

function commandHasArgumentPlaceholder(command: string): boolean {
  return /<[^>]+>|\[[^\]]+\]/.test(command);
}

function toOverlayBoxLine(content: string, innerWidth: number): string {
  const normalized = truncateDisplayWidth(content, innerWidth, {
    compact: false,
  });
  return `│ ${padToDisplayWidth(normalized, innerWidth)} │`;
}

export function formatSlashSuggestionPanel(
  suggestions: readonly SlashOverlaySuggestion[],
  lineInput: string,
  selectedIndex: number,
  terminalColumns: number,
): string {
  const trimmed = lineInput.trimStart();
  if (!trimmed.startsWith("/")) {
    return "";
  }
  if (suggestions.length === 0) {
    return "";
  }
  const limited = suggestions.slice(0, 8);
  const normalizedSelectedIndex = normalizeSuggestionIndex(limited.length, selectedIndex);
  const selected = limited[normalizedSelectedIndex];
  const rows = limited.map((item, index) => {
    const isSelected = index === normalizedSelectedIndex;
    const source = item.source ? ` (${item.source})` : "";
    const detail = item.description?.trim().length ? ` - ${item.description.trim()}` : "";
    const pointer = isSelected ? ">" : " ";
    return `${pointer} ${item.command}${source}${detail}`;
  });
  const selectedHint = selected
    ? commandHasArgumentPlaceholder(selected.command)
      ? `hint: fill args for ${selected.command}`
      : `hint: ready to run ${selected.command}`
    : "hint: select a command";
  const keyHint = "keys: Up/Down select | Tab complete | Enter run selected";
  const title = `commands ${suggestions.length > limited.length
    ? `(${String(limited.length)}/${String(suggestions.length)})`
    : `(${String(limited.length)})`}`;

  const allLines = [title, ...rows, selectedHint, keyHint];
  const desiredInnerWidth = allLines.reduce((max, line) => Math.max(max, measureDisplayWidth(line)), 0);
  const maxInnerWidth = Math.max(16, terminalColumns - 4);
  const innerWidth = Math.min(Math.max(16, desiredInnerWidth), maxInnerWidth);
  const divider = "─".repeat(innerWidth + 2);
  const top = `┌${divider}┐`;
  const middle = `├${divider}┤`;
  const bottom = `└${divider}┘`;
  const lines: string[] = [];
  lines.push(top);
  lines.push(toOverlayBoxLine(title, innerWidth));
  lines.push(middle);
  for (const row of rows) {
    lines.push(toOverlayBoxLine(row, innerWidth));
  }
  lines.push(middle);
  lines.push(toOverlayBoxLine(selectedHint, innerWidth));
  lines.push(toOverlayBoxLine(keyHint, innerWidth));
  lines.push(bottom);
  return `${lines.join("\n")}\n`;
}
