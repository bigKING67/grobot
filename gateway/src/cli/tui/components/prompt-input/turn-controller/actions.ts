import { normalizeSuggestionIndex } from "../../../interactive/slash-overlay";
import { splitGraphemes } from "../../../terminal/display-width";
import {
  registerInlineImageAttachment,
  saveClipboardImageToTempFile,
} from "../attachments";
import {
  type PromptInputTurnResult,
  type PromptInputTurnRuntime,
  type SessionSlashSuggestion,
  type SubmitKeyAction,
} from "../contract";
import {
  clampPromptInputCursor,
  insertTextIntoPromptBuffer,
  movePromptBufferCursorVertical,
  normalizePromptPastedTextInput,
  removeSelectedInlineImageToken as removeInlineImageTokenFromBuffer,
  replacePromptBufferActiveLineWithCommand,
  stripPromptBufferBracketedPasteMarkers,
} from "../input-buffer";
import {
  resolveSlashSuggestionKeyAction,
} from "../reducer";
import {
  type PromptInputTurnRenderSession,
} from "../turn-render-session";
import {
  type PromptInputTurnState,
} from "../turn-state";

export interface PromptInputTurnSlashState {
  activeSuggestions: readonly SessionSlashSuggestion[];
  hasActiveSlashSuggestions: boolean;
}

export interface PromptInputTurnActions {
  clampCursor(): void;
  insertTextAtCursor(value: string): void;
  tryPasteInlineClipboardImage(): boolean;
  removeSelectedInlineImageToken(): boolean;
  stripBracketedMarkersFromBuffer(): boolean;
  replaceActiveLineWithCommand(command: string): string | undefined;
  moveCursorVertical(direction: -1 | 1): void;
  handleBracketedPastePayload(payload: string): void;
  runHistorySearchShortcut(): Promise<void>;
  resolveSlashState(): PromptInputTurnSlashState;
  handleEnterLikeAction(action: SubmitKeyAction): void;
  handleEscapeLikeAction(): boolean;
  moveSlashSuggestion(delta: -1 | 1, activeSuggestions: readonly SessionSlashSuggestion[]): void;
}

export function createPromptInputTurnActions(input: {
  state: PromptInputTurnState;
  renderSession: PromptInputTurnRenderSession;
  runtime: PromptInputTurnRuntime;
  isClosed(): boolean;
  finish(result: PromptInputTurnResult): void;
}): PromptInputTurnActions {
  const { state, renderSession, runtime } = input;

  const clampCursor = (): void => {
    state.cursor = clampPromptInputCursor({
      cursor: state.cursor,
      graphemeCount: state.graphemes.length,
    });
  };

  const insertTextAtCursor = (value: string): void => {
    const inserted = insertTextIntoPromptBuffer({
      graphemes: state.graphemes,
      cursor: state.cursor,
      value,
    });
    state.graphemes = inserted.graphemes;
    state.cursor = inserted.cursor;
  };

  const tryPasteInlineClipboardImage = (): boolean => {
    const attachment = saveClipboardImageToTempFile();
    if (!attachment) {
      return false;
    }
    const placeholder = registerInlineImageAttachment(attachment);
    insertTextAtCursor(placeholder);
    return true;
  };

  const removeSelectedInlineImageToken = (): boolean => {
    const removed = removeInlineImageTokenFromBuffer({
      graphemes: state.graphemes,
      cursor: state.cursor,
    });
    state.graphemes = removed.graphemes;
    state.cursor = removed.cursor;
    return removed.removed;
  };

  const stripBracketedMarkersFromBuffer = (): boolean => {
    const stripped = stripPromptBufferBracketedPasteMarkers({
      graphemes: state.graphemes,
      cursor: state.cursor,
    });
    state.graphemes = stripped.graphemes;
    state.cursor = stripped.cursor;
    return stripped.stripped;
  };

  const replaceActiveLineWithCommand = (command: string): string | undefined => {
    const replaced = replacePromptBufferActiveLineWithCommand({
      graphemes: state.graphemes,
      snapshot: renderSession.getLatestSnapshot(),
      command,
    });
    if (!replaced) {
      return undefined;
    }
    state.graphemes = replaced.graphemes;
    state.cursor = replaced.cursor;
    state.activeSlashSuggestionIndex = 0;
    return replaced.replacedLine;
  };

  const moveCursorVertical = (direction: -1 | 1): void => {
    state.cursor = movePromptBufferCursorVertical({
      graphemes: state.graphemes,
      cursor: state.cursor,
      snapshot: renderSession.getLatestSnapshot(),
      direction,
    });
  };

  const handleBracketedPastePayload = (payload: string): void => {
    queueMicrotask(() => {
      if (input.isClosed()) {
        return;
      }
      const stripped = stripBracketedMarkersFromBuffer();
      const normalizedPayload = normalizePromptPastedTextInput(payload);
      if (normalizedPayload.length > 0) {
        insertTextAtCursor(normalizedPayload);
        renderSession.render();
        return;
      }
      const pasted = tryPasteInlineClipboardImage();
      if (pasted || stripped) {
        renderSession.render();
      }
    });
  };

  const runHistorySearchShortcut = async (): Promise<void> => {
    if (
      state.historySearchInFlight
      || typeof runtime.options.openHistorySearch !== "function"
    ) {
      return;
    }
    state.historySearchInFlight = true;
    try {
      const selected = await runtime.controls.withInputPaused(() =>
        runtime.options.openHistorySearch?.({
          currentInput: state.graphemes.join(""),
        }) ?? Promise.resolve(undefined));
      if (input.isClosed()) {
        return;
      }
      if (typeof selected === "string") {
        state.graphemes = splitGraphemes(selected);
        state.cursor = state.graphemes.length;
        state.activeSlashSuggestionIndex = 0;
        state.lastSlashLineInput = "";
        state.slashSuggestionsHiddenForLine = "";
      }
      renderSession.render();
    } catch {
      if (!input.isClosed()) {
        renderSession.render();
      }
    } finally {
      state.historySearchInFlight = false;
    }
  };

  const resolveSlashState = (): PromptInputTurnSlashState => {
    const latestSnapshot = renderSession.getLatestSnapshot();
    const activeSuggestions = latestSnapshot?.activeSlashSuggestions ?? [];
    const hasActiveSlashSuggestions = Boolean(
      latestSnapshot?.activeLineInput.trimStart().startsWith("/")
      && activeSuggestions.length > 0,
    );
    return {
      activeSuggestions,
      hasActiveSlashSuggestions,
    };
  };

  const handleEnterLikeAction = (action: SubmitKeyAction): void => {
    const slashState = resolveSlashState();
    const slashAction = resolveSlashSuggestionKeyAction({
      key: "enter",
      hasActiveSuggestions: slashState.hasActiveSlashSuggestions,
      selectedCommand: slashState.activeSuggestions[state.activeSlashSuggestionIndex]?.command,
      activeLineInput: renderSession.getLatestSnapshot()?.activeLineInput,
    });
    if (slashAction.kind === "apply") {
      const replacedLine = replaceActiveLineWithCommand(slashAction.appliedCommand);
      if (typeof replacedLine === "string") {
        state.slashSuggestionsHiddenForLine = replacedLine;
      }
      if (slashAction.submitImmediately) {
        input.finish({
          kind: "submit",
          value: state.graphemes.join(""),
        });
      } else {
        renderSession.render();
      }
      return;
    }
    if (slashAction.kind === "hide_panel") {
      state.slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
      state.activeSlashSuggestionIndex = 0;
      renderSession.render();
      return;
    }
    if (action === "newline") {
      insertTextAtCursor("\n");
      renderSession.render();
      return;
    }
    input.finish({
      kind: "submit",
      value: state.graphemes.join(""),
    });
  };

  const handleEscapeLikeAction = (): boolean => {
    if (state.shortcutOverlayVisible) {
      state.shortcutOverlayVisible = false;
      renderSession.render();
      return true;
    }
    const slashState = resolveSlashState();
    const slashAction = resolveSlashSuggestionKeyAction({
      key: "escape",
      hasActiveSuggestions: slashState.hasActiveSlashSuggestions,
      selectedCommand: slashState.activeSuggestions[state.activeSlashSuggestionIndex]?.command,
      activeLineInput: renderSession.getLatestSnapshot()?.activeLineInput,
    });
    if (slashAction.kind === "hide_panel") {
      state.slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
      state.activeSlashSuggestionIndex = 0;
      renderSession.render();
      return true;
    }
    if (state.graphemes.length > 0) {
      state.graphemes = [];
      state.cursor = 0;
      state.activeSlashSuggestionIndex = 0;
      state.lastSlashLineInput = "";
      state.slashSuggestionsHiddenForLine = "";
      renderSession.render();
      return true;
    }
    return false;
  };

  const moveSlashSuggestion = (
    delta: -1 | 1,
    activeSuggestions: readonly SessionSlashSuggestion[],
  ): void => {
    state.activeSlashSuggestionIndex = normalizeSuggestionIndex(
      activeSuggestions.length,
      state.activeSlashSuggestionIndex + delta,
    );
  };

  return {
    clampCursor,
    insertTextAtCursor,
    tryPasteInlineClipboardImage,
    removeSelectedInlineImageToken,
    stripBracketedMarkersFromBuffer,
    replaceActiveLineWithCommand,
    moveCursorVertical,
    handleBracketedPastePayload,
    runHistorySearchShortcut,
    resolveSlashState,
    handleEnterLikeAction,
    handleEscapeLikeAction,
    moveSlashSuggestion,
  };
}
