export interface PromptInputTurnState {
  graphemes: string[];
  cursor: number;
  historySearchInFlight: boolean;
  activeSlashSuggestionIndex: number;
  lastSlashLineInput: string;
  slashSuggestionsHiddenForLine: string;
  shortcutOverlayVisible: boolean;
}

export function createInitialPromptInputTurnState(initialInput = ""): PromptInputTurnState {
  const graphemes = Array.from(initialInput);
  return {
    graphemes,
    cursor: graphemes.length,
    historySearchInFlight: false,
    activeSlashSuggestionIndex: 0,
    lastSlashLineInput: "",
    slashSuggestionsHiddenForLine: "",
    shortcutOverlayVisible: false,
  };
}
