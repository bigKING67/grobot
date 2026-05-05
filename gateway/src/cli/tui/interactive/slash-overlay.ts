import {
  formatPromptSuggestionPanel,
  normalizeSuggestionIndex,
} from "./suggestion-window";

const VISIBLE_SLASH_SUGGESTION_COUNT = 5;
const SLASH_TWO_COLUMN_MIN_WIDTH = 64;

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

export { normalizeSuggestionIndex };

function normalizeDescription(input: SlashOverlaySuggestion): string {
  return (input.description ?? "").trim().replace(/\s+/g, " ");
}

function normalizeSlashSuggestionTag(input: SlashOverlaySuggestion): string | undefined {
  const source = (input.source ?? "").trim();
  if (!source || source.toLowerCase() === "builtin") {
    return undefined;
  }
  return source;
}

function hasSlashCommandArguments(lineInputRaw: string): boolean {
  const lineInput = lineInputRaw.trim();
  if (!lineInput.startsWith("/")) {
    return false;
  }
  const firstSpace = lineInput.indexOf(" ");
  if (firstSpace < 0) {
    return false;
  }
  return lineInput.slice(firstSpace + 1).trim().length > 0;
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
  if (hasSlashCommandArguments(trimmed)) {
    return "";
  }
  if (suggestions.length === 0) {
    return "";
  }
  const resolvedColumns = Math.max(40, Math.floor(Number.isFinite(terminalColumns) ? terminalColumns : 96));
  const showDescription = resolvedColumns >= SLASH_TWO_COLUMN_MIN_WIDTH;
  return formatPromptSuggestionPanel({
    suggestions: suggestions.map((item) => ({
      id: `command-${item.command}`,
      displayText: item.command.trim(),
      tag: normalizeSlashSuggestionTag(item),
      description: normalizeDescription(item),
      type: "command",
    })),
    selectedIndex,
    terminalColumns: resolvedColumns,
    terminalRows: VISIBLE_SLASH_SUGGESTION_COUNT + 3,
    overlay: true,
    showDescription,
    showSelectionPointer: true,
  });
}
