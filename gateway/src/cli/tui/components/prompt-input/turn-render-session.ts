import type { SessionPromptLayout } from "../../interactive/interactive-frame";
import { measureDisplayWidth } from "../../terminal/display-width";
import {
  DEFAULT_SESSION_PROMPT,
  type SessionInputLoopOptions,
} from "./contract";
import {
  buildPromptInputRenderSnapshot,
  renderSubmittedInputTranscriptLines,
  type PromptInputRenderSnapshot,
} from "./render";
import type { PromptInputTurnState } from "./turn-state";

export interface PromptInputTerminalSizeProvider {
  columns(): number;
  rows(): number | undefined;
}

export interface PromptInputTurnRenderSession {
  getLatestSnapshot(): PromptInputRenderSnapshot | undefined;
  render(): void;
  replaceRenderedInputWithSubmittedTranscript(value: string): void;
  clearRenderedInput(): void;
  moveCursorToOutputLine(): void;
}

export function createPromptInputTurnRenderSession(input: {
  resolvedPrompt: SessionPromptLayout;
  options: SessionInputLoopOptions;
  state: PromptInputTurnState;
  size: PromptInputTerminalSizeProvider;
}): PromptInputTurnRenderSession {
  const promptLabel = input.resolvedPrompt.inlinePrompt.length > 0
    ? input.resolvedPrompt.inlinePrompt
    : DEFAULT_SESSION_PROMPT;
  const promptLabelWidth = Math.max(1, measureDisplayWidth(promptLabel));
  const continuationPrefix = " ".repeat(promptLabelWidth);
  const footerLines = (input.resolvedPrompt.suffix ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const getTheme = (): "plain" | "nerd_font" | "ccline" | undefined =>
    input.options.getInlineImageHighlightTheme?.();

  let lastRenderedLineCount = 0;
  let lastCursorRenderLineIndex = 0;
  let latestSnapshot: PromptInputRenderSnapshot | undefined;

  const moveCursorToRenderedTop = (): boolean => {
    if (lastRenderedLineCount <= 0) {
      return false;
    }
    process.stdout.write("\r");
    if (lastCursorRenderLineIndex > 0) {
      process.stdout.write(`\x1b[${String(lastCursorRenderLineIndex)}A`);
    }
    return true;
  };

  const buildRenderSnapshot = (): PromptInputRenderSnapshot => {
    const resolution = buildPromptInputRenderSnapshot({
      resolvedPrompt: input.resolvedPrompt,
      footerLines,
      promptLabelWidth,
      continuationPrefix,
      graphemes: input.state.graphemes,
      cursor: input.state.cursor,
      historySearchInFlight: input.state.historySearchInFlight,
      shortcutOverlayVisible: input.state.shortcutOverlayVisible,
      activeSlashSuggestionIndex: input.state.activeSlashSuggestionIndex,
      lastSlashLineInput: input.state.lastSlashLineInput,
      slashSuggestionsHiddenForLine: input.state.slashSuggestionsHiddenForLine,
      terminalColumns: input.size.columns(),
      terminalRows: input.size.rows(),
      inlineImageTheme: getTheme(),
      getSlashSuggestions: input.options.getSlashSuggestions,
    });
    input.state.activeSlashSuggestionIndex = resolution.activeSlashSuggestionIndex;
    input.state.lastSlashLineInput = resolution.lastSlashLineInput;
    input.state.slashSuggestionsHiddenForLine = resolution.slashSuggestionsHiddenForLine;
    input.state.shortcutOverlayVisible = resolution.shortcutOverlayVisible;
    return resolution.snapshot;
  };

  const clearRenderedInput = (): void => {
    const moved = moveCursorToRenderedTop();
    if (moved) {
      process.stdout.write("\x1b[J");
    } else {
      process.stdout.write("\n");
    }
    lastRenderedLineCount = 0;
    lastCursorRenderLineIndex = 0;
    latestSnapshot = undefined;
  };

  return {
    getLatestSnapshot: () => latestSnapshot,
    render: (): void => {
      const snapshot = buildRenderSnapshot();
      if (lastRenderedLineCount > 0) {
        process.stdout.write("\r");
        if (lastCursorRenderLineIndex > 0) {
          process.stdout.write(`\x1b[${String(lastCursorRenderLineIndex)}A`);
        }
      }
      process.stdout.write("\x1b[J");
      process.stdout.write(snapshot.renderedLines.join("\n"));
      process.stdout.write("\r");
      const linesUp = Math.max(
        0,
        snapshot.renderedLines.length - 1 - snapshot.cursorRenderLineIndex,
      );
      if (linesUp > 0) {
        process.stdout.write(`\x1b[${String(linesUp)}A`);
      }
      if (snapshot.cursorColumn > 0) {
        process.stdout.write(`\x1b[${String(snapshot.cursorColumn)}C`);
      }
      lastRenderedLineCount = snapshot.renderedLines.length;
      lastCursorRenderLineIndex = snapshot.cursorRenderLineIndex;
      latestSnapshot = snapshot;
    },
    replaceRenderedInputWithSubmittedTranscript: (value: string): void => {
      const moved = moveCursorToRenderedTop();
      if (moved) {
        process.stdout.write("\x1b[J");
      }
      const lines = renderSubmittedInputTranscriptLines({
        value,
        promptLabel,
        terminalColumns: input.size.columns(),
        theme: getTheme(),
        getSlashSuggestions: input.options.getSlashSuggestions,
      });
      process.stdout.write(lines.join("\n"));
      process.stdout.write("\n");
      lastRenderedLineCount = 0;
      lastCursorRenderLineIndex = 0;
      latestSnapshot = undefined;
    },
    clearRenderedInput,
    moveCursorToOutputLine: (): void => {
      const snapshot = latestSnapshot;
      if (!snapshot) {
        process.stdout.write("\n");
        return;
      }
      process.stdout.write("\r");
      const linesDown = Math.max(
        0,
        snapshot.renderedLines.length - 1 - snapshot.cursorRenderLineIndex,
      );
      if (linesDown > 0) {
        process.stdout.write(`\x1b[${String(linesDown)}B`);
      }
      process.stdout.write("\n");
    },
  };
}
