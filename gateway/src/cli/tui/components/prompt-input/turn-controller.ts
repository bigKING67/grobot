import {
  isPlainEnterDataChunk,
  resolveCoalescedSubmitChunk,
  resolveInteractiveEnterDataAction,
} from "../../terminal/keyboard";
import {
  type KeypressPayload,
  type PromptInputTurnResult,
  type PromptInputTurnRuntime,
} from "./contract";
import {
  resolveInputShortcutAction,
  resolveShortcutOverlayKeyAction,
  resolveSlashSuggestionKeyAction,
  resolveSubmitKeyAction,
} from "./reducer";
import {
  BRACKETED_PASTE_BLOCK_PATTERN,
  BRACKETED_PASTE_BUFFER_LIMIT,
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  ENTER_KEYPRESS_DEDUP_WINDOW_MS,
  PLAIN_ENTER_FALLBACK_DELAY_MS,
  stripBracketedPasteMarkers,
} from "./input-buffer";
import { createPromptInputTurnRenderSession } from "./turn-render-session";
import {
  createInitialPromptInputTurnState,
  type PromptInputTurnState,
} from "./turn-state";
import { createPromptInputTurnActions } from "./turn-controller/actions";
import {
  resolveTerminalColumns,
  resolveTerminalRows,
} from "./turn-controller/terminal-size";

export type {
  PromptInputTurnResult,
  PromptInputTurnRuntime,
} from "./contract";

export async function readPromptInputTurn(
  input: PromptInputTurnRuntime,
): Promise<PromptInputTurnResult> {
  const {
    resolvedPrompt,
    menuInput,
    keypressInput,
    controls,
    options,
  } = input;
  if (resolvedPrompt.prefix.length > 0) {
    process.stdout.write(`${resolvedPrompt.prefix}\n`);
  }

  const state: PromptInputTurnState = createInitialPromptInputTurnState(input.initialInput);
  const renderSession = createPromptInputTurnRenderSession({
    resolvedPrompt,
    options,
    state,
    size: {
      columns: resolveTerminalColumns,
      rows: resolveTerminalRows,
    },
  });
  let bracketedPasteBuffer = "";
  let closed = false;
  let pendingPlainEnterFallback: ReturnType<typeof setTimeout> | undefined;
  let lastEnterKeypressHandledAt = 0;
  let lastEnterDataHandledAt = 0;

  const clearPendingPlainEnterFallback = (): void => {
    if (!pendingPlainEnterFallback) {
      return;
    }
    clearTimeout(pendingPlainEnterFallback);
    pendingPlainEnterFallback = undefined;
  };

  return await new Promise<PromptInputTurnResult>((resolve) => {
    const finish = (result: PromptInputTurnResult): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearPendingPlainEnterFallback();
      keypressInput.off?.("keypress", onKeypress);
      menuInput.off?.("data", onData);
      if (result.kind === "submit") {
        const suppressTranscript = (() => {
          try {
            return options.shouldSuppressSubmitTranscript?.(result.value) === true;
          } catch {
            return false;
          }
        })();
        if (suppressTranscript) {
          renderSession.clearRenderedInput();
        } else {
          renderSession.replaceRenderedInputWithSubmittedTranscript(result.value);
        }
      } else {
        renderSession.moveCursorToOutputLine();
      }
      resolve(result);
    };

    const actions = createPromptInputTurnActions({
      state,
      renderSession,
      runtime: input,
      isClosed: () => closed,
      finish,
    });

    const schedulePlainEnterFallback = (): void => {
      clearPendingPlainEnterFallback();
      pendingPlainEnterFallback = setTimeout(() => {
        pendingPlainEnterFallback = undefined;
        if (closed || input.getPauseDepth() > 0) {
          return;
        }
        lastEnterDataHandledAt = Date.now();
        actions.handleEnterLikeAction("submit");
      }, PLAIN_ENTER_FALLBACK_DELAY_MS);
    };

    const onData = (chunk: string): void => {
      if (closed) {
        return;
      }
      const raw = String(chunk ?? "");
      if (raw.length === 0) {
        return;
      }
      const hasBracketedChunk =
        raw.includes(BRACKETED_PASTE_START)
        || raw.includes(BRACKETED_PASTE_END)
        || bracketedPasteBuffer.length > 0;
      if (hasBracketedChunk) {
        bracketedPasteBuffer = `${bracketedPasteBuffer}${raw}`;
        if (bracketedPasteBuffer.length > BRACKETED_PASTE_BUFFER_LIMIT) {
          bracketedPasteBuffer = bracketedPasteBuffer.slice(-BRACKETED_PASTE_BUFFER_LIMIT);
        }
        let matched = false;
        let lastConsumedIndex = 0;
        BRACKETED_PASTE_BLOCK_PATTERN.lastIndex = 0;
        for (const match of bracketedPasteBuffer.matchAll(BRACKETED_PASTE_BLOCK_PATTERN)) {
          const payload = match[1] ?? "";
          matched = true;
          lastConsumedIndex = (match.index ?? 0) + match[0].length;
          actions.handleBracketedPastePayload(payload);
        }
        if (matched) {
          bracketedPasteBuffer = bracketedPasteBuffer.slice(lastConsumedIndex);
          return;
        }
        const startIndex = bracketedPasteBuffer.lastIndexOf(BRACKETED_PASTE_START);
        if (startIndex >= 0) {
          bracketedPasteBuffer = bracketedPasteBuffer.slice(startIndex);
          return;
        }
        const tailLength = Math.max(
          BRACKETED_PASTE_START.length - 1,
          BRACKETED_PASTE_END.length - 1,
        );
        if (bracketedPasteBuffer.length > tailLength) {
          bracketedPasteBuffer = bracketedPasteBuffer.slice(-tailLength);
        }
        return;
      }

      if (input.getPauseDepth() > 0) {
        return;
      }
      if (raw === "\u0003") {
        state.shortcutOverlayVisible = false;
        finish({ kind: "sigint" });
        return;
      }
      if (raw === "\u001b") {
        if (state.shortcutOverlayVisible) {
          state.shortcutOverlayVisible = false;
          renderSession.render();
          return;
        }
        if (actions.handleEscapeLikeAction()) {
          return;
        }
        const now = Date.now();
        if (now - input.getEscArmedAt() < 150) {
          return;
        }
        input.setEscArmedAt(now);
        process.stdout.write("\n");
        input.triggerEscInterrupt("idle");
        return;
      }
      const enterDataAction = resolveInteractiveEnterDataAction({
        chunk: raw,
        keypressSupported: true,
        keypressHandledRecently:
          Date.now() - lastEnterKeypressHandledAt < ENTER_KEYPRESS_DEDUP_WINDOW_MS,
      });
      if (enterDataAction === "defer_to_keypress") {
        schedulePlainEnterFallback();
        return;
      }
      if (enterDataAction === "submit") {
        lastEnterDataHandledAt = Date.now();
        state.shortcutOverlayVisible = false;
        actions.handleEnterLikeAction("submit");
        return;
      }
      if (enterDataAction === "none" && isPlainEnterDataChunk(raw)) {
        return;
      }
      const coalescedSubmit = resolveCoalescedSubmitChunk(raw);
      if (coalescedSubmit.shouldSubmit) {
        const normalized = stripBracketedPasteMarkers(coalescedSubmit.normalizedChunk)
          .replace(/\r/g, "\n");
        if (normalized.length > 0) {
          actions.insertTextAtCursor(normalized);
        }
        state.shortcutOverlayVisible = false;
        actions.handleEnterLikeAction("submit");
        return;
      }
      const submitKeyAction = resolveSubmitKeyAction({
        chunk: raw,
        key: {},
      });
      if (submitKeyAction !== "none") {
        lastEnterDataHandledAt = Date.now();
        state.shortcutOverlayVisible = false;
        actions.handleEnterLikeAction(submitKeyAction);
      }
    };

    const onKeypress = (chunk: string, key: KeypressPayload): void => {
      const rawInput = String(chunk ?? "");
      if (closed || input.getPauseDepth() > 0) {
        return;
      }

      const imagePasteTriggered =
        (key.ctrl && key.name === "v")
        || (key.meta && key.name === "v")
        || (key.shift && key.name === "insert")
        || key.sequence === "\u0016";
      if (imagePasteTriggered) {
        state.shortcutOverlayVisible = false;
        if (actions.tryPasteInlineClipboardImage()) {
          renderSession.render();
        }
        return;
      }

      const slashState = actions.resolveSlashState();
      const activeSuggestions = slashState.activeSuggestions;
      const hasActiveSlashSuggestions = slashState.hasActiveSlashSuggestions;
      const moveSuggestionUp = key.name === "up" || (key.ctrl && key.name === "p");
      const moveSuggestionDown = key.name === "down" || (key.ctrl && key.name === "n");

      const shortcutOverlayAction = resolveShortcutOverlayKeyAction({
        chunk: rawInput,
        key,
        inputGraphemeLength: state.graphemes.length,
        hasActiveSlashSuggestions,
      });
      if (shortcutOverlayAction === "toggle_overlay") {
        state.shortcutOverlayVisible = !state.shortcutOverlayVisible;
        renderSession.render();
        return;
      }
      if (state.shortcutOverlayVisible && key.name === "escape") {
        state.shortcutOverlayVisible = false;
        renderSession.render();
        return;
      }

      const shortcutAction = resolveInputShortcutAction({
        chunk: rawInput,
        key,
      });
      if (shortcutAction === "sigint") {
        state.shortcutOverlayVisible = false;
        finish({ kind: "sigint" });
        return;
      }
      if (shortcutAction === "history_search") {
        state.shortcutOverlayVisible = false;
        void actions.runHistorySearchShortcut();
        return;
      }
      if (key.name === "left") {
        state.shortcutOverlayVisible = false;
        state.cursor -= 1;
        actions.clampCursor();
        renderSession.render();
        return;
      }
      if (key.name === "right") {
        state.shortcutOverlayVisible = false;
        state.cursor += 1;
        actions.clampCursor();
        renderSession.render();
        return;
      }
      if (key.name === "home") {
        state.shortcutOverlayVisible = false;
        const latestSnapshot = renderSession.getLatestSnapshot();
        const descriptor = latestSnapshot?.descriptors[latestSnapshot.activeLineIndex ?? 0];
        if (descriptor) {
          state.cursor = descriptor.start;
          renderSession.render();
        }
        return;
      }
      if (key.name === "end") {
        state.shortcutOverlayVisible = false;
        const latestSnapshot = renderSession.getLatestSnapshot();
        const descriptor = latestSnapshot?.descriptors[latestSnapshot.activeLineIndex ?? 0];
        if (descriptor) {
          state.cursor = descriptor.end;
          renderSession.render();
        }
        return;
      }
      if (moveSuggestionUp) {
        state.shortcutOverlayVisible = false;
        if (hasActiveSlashSuggestions) {
          actions.moveSlashSuggestion(-1, activeSuggestions);
          renderSession.render();
          return;
        }
        actions.moveCursorVertical(-1);
        renderSession.render();
        return;
      }
      if (moveSuggestionDown) {
        state.shortcutOverlayVisible = false;
        if (hasActiveSlashSuggestions) {
          actions.moveSlashSuggestion(1, activeSuggestions);
          renderSession.render();
          return;
        }
        actions.moveCursorVertical(1);
        renderSession.render();
        return;
      }
      if (key.name === "backspace") {
        state.shortcutOverlayVisible = false;
        if (!actions.removeSelectedInlineImageToken() && state.cursor > 0) {
          state.graphemes.splice(state.cursor - 1, 1);
          state.cursor -= 1;
        }
        renderSession.render();
        return;
      }
      if (key.name === "delete") {
        state.shortcutOverlayVisible = false;
        if (!actions.removeSelectedInlineImageToken() && state.cursor < state.graphemes.length) {
          state.graphemes.splice(state.cursor, 1);
        }
        renderSession.render();
        return;
      }
      const submitKeyAction = resolveSubmitKeyAction({
        chunk: rawInput,
        key,
      });
      if (submitKeyAction !== "none") {
        if (Date.now() - lastEnterDataHandledAt < ENTER_KEYPRESS_DEDUP_WINDOW_MS) {
          return;
        }
        clearPendingPlainEnterFallback();
        lastEnterKeypressHandledAt = Date.now();
        state.shortcutOverlayVisible = false;
        actions.handleEnterLikeAction(submitKeyAction);
        return;
      }
      if (key.name === "tab") {
        const slashAction = resolveSlashSuggestionKeyAction({
          key: "tab",
          hasActiveSuggestions: hasActiveSlashSuggestions,
          selectedCommand: activeSuggestions[state.activeSlashSuggestionIndex]?.command,
          activeLineInput: renderSession.getLatestSnapshot()?.activeLineInput,
        });
        if (slashAction.kind === "apply") {
          state.shortcutOverlayVisible = false;
          const replacedLine = actions.replaceActiveLineWithCommand(slashAction.appliedCommand);
          if (typeof replacedLine === "string") {
            state.slashSuggestionsHiddenForLine = replacedLine;
          }
          renderSession.render();
          return;
        }
        if (slashAction.kind === "hide_panel") {
          state.shortcutOverlayVisible = false;
          state.slashSuggestionsHiddenForLine = slashAction.hiddenLineInput;
          state.activeSlashSuggestionIndex = 0;
          renderSession.render();
        }
        return;
      }
      if (key.name === "escape") {
        if (actions.handleEscapeLikeAction()) {
          state.shortcutOverlayVisible = false;
          return;
        }
        const now = Date.now();
        if (now - input.getEscArmedAt() < 150) {
          return;
        }
        input.setEscArmedAt(now);
        process.stdout.write("\n");
        input.triggerEscInterrupt("idle");
        return;
      }

      if (!rawInput || key.ctrl || key.meta) {
        return;
      }
      const coalescedSubmit = resolveCoalescedSubmitChunk(rawInput);
      const normalized = stripBracketedPasteMarkers(coalescedSubmit.normalizedChunk)
        .replace(/\r/g, "\n");
      if (coalescedSubmit.shouldSubmit) {
        if (normalized.length > 0) {
          actions.insertTextAtCursor(normalized);
        }
        state.shortcutOverlayVisible = false;
        actions.handleEnterLikeAction("submit");
        return;
      }
      if (!normalized) {
        return;
      }
      state.shortcutOverlayVisible = false;
      actions.insertTextAtCursor(normalized);
      renderSession.render();
    };

    keypressInput.on?.("keypress", onKeypress);
    menuInput.on?.("data", onData);
    renderSession.render();
  });
}
