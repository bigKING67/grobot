export interface PromptInputTurnState {
  graphemes: string[];
  cursor: number;
  historySearchInFlight: boolean;
  activeSlashSuggestionIndex: number;
  lastSlashLineInput: string;
  slashSuggestionsHiddenForLine: string;
  shortcutOverlayVisible: boolean;
}

export function createInitialPromptInputTurnState(): PromptInputTurnState {
  return {
    graphemes: [],
    cursor: 0,
    historySearchInFlight: false,
    activeSlashSuggestionIndex: 0,
    lastSlashLineInput: "",
    slashSuggestionsHiddenForLine: "",
    shortcutOverlayVisible: false,
  };
}
