import {
  padToDisplayWidth,
  truncateDisplayWidth,
} from "./display-width";

const ANSI_RESET = "\u001B[0m";
const ANSI_BOLD = "\u001B[1m";
const ANSI_SUGGESTION = "\u001B[96m";
const ANSI_DIM = "\u001B[90m";

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

function normalizeDescription(input: SlashOverlaySuggestion): string {
  return (input.description ?? "").trim().replace(/\s+/g, " ");
}

function formatSuggestionRow(input: {
  item: SlashOverlaySuggestion;
  commandColumnWidth: number;
  descriptionColumnWidth: number;
  selected: boolean;
}): string {
  const commandText = truncateDisplayWidth(input.item.command.trim(), input.commandColumnWidth, {
    compact: false,
  });
  const commandColumn = padToDisplayWidth(commandText, input.commandColumnWidth);
  const description = normalizeDescription(input.item);
  const descriptionColumn = description.length > 0
    ? truncateDisplayWidth(description, input.descriptionColumnWidth, {
      compact: false,
    })
    : "";
  const line = descriptionColumn.length > 0
    ? `${commandColumn}  ${descriptionColumn}`
    : commandColumn;
  if (input.selected) {
    return `${ANSI_BOLD}${ANSI_SUGGESTION}${line}${ANSI_RESET}`;
  }
  return `${ANSI_DIM}${line}${ANSI_RESET}`;
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
  const commandColumnWidth = Math.min(
    36,
    Math.max(
      14,
      Math.floor(Math.max(terminalColumns, 40) * 0.28),
    ),
  );
  const descriptionColumnWidth = Math.max(16, terminalColumns - commandColumnWidth - 2);
  const lines: string[] = [];
  for (let index = 0; index < limited.length; index += 1) {
    const item = limited[index];
    lines.push(formatSuggestionRow({
      item,
      commandColumnWidth,
      descriptionColumnWidth,
      selected: index === normalizedSelectedIndex,
    }));
  }
  const hiddenCount = suggestions.length - limited.length;
  if (hiddenCount > 0) {
    lines.push(`${ANSI_DIM}… and ${String(hiddenCount)} more${ANSI_RESET}`);
  }
  return `${lines.join("\n")}\n`;
}
