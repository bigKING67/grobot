import { splitGraphemes } from "../../terminal/display-width";
import type { MenuInputStream } from "../prompt-input/contract";
import { renderAskUserPanelScreen } from "./render";
import {
  buildAskUserBatchAnswerText,
  buildAskUserQuestionnaireView,
  createAskUserQuestionnaireState,
  reduceAskUserQuestionnaire,
  resolveAskUserAnswerFromSelection,
  type AskUserEnvelope,
  type AskUserQuestionnaireView,
} from "../../../../tools/ask-user";
import type {
  AskUserPanelInputAction,
  TerminalAskUserQuestionnairePanelInput,
  TerminalAskUserQuestionnairePanelResult,
} from "./contract";
import {
  clampAskUserPanelIndex,
  decodeAskUserPanelInput,
  resolveAskUserPanelCurrentEnvelope,
  resolveFirstUnansweredAskUserQuestionIndex,
  syncAskUserPanelTextInput,
  wrapAskUserPanelIndex,
} from "./reducer";

function resolveTerminalColumns(fallback?: number): number {
  if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) {
    return Math.floor(fallback);
  }
  const stdout = process.stdout as { columns?: number };
  if (typeof stdout.columns === "number" && Number.isFinite(stdout.columns) && stdout.columns > 0) {
    return Math.floor(stdout.columns);
  }
  return 80;
}

export async function runAskUserQuestionnairePanel(
  input: TerminalAskUserQuestionnairePanelInput,
): Promise<TerminalAskUserQuestionnairePanelResult> {
  if (!process.stdin.isTTY || input.queue.length <= 0) {
    return { kind: "cancelled" };
  }
  const stdin = process.stdin as unknown as MenuInputStream;
  const setRawMode = stdin.setRawMode;
  const onInput = stdin.on;
  const offInput = stdin.off;
  const resumeInput = stdin.resume;
  if (
    typeof setRawMode !== "function" ||
    typeof onInput !== "function" ||
    typeof offInput !== "function" ||
    typeof resumeInput !== "function"
  ) {
    return { kind: "cancelled" };
  }

  const stdout = process.stdout;
  let state = syncAskUserPanelTextInput(
    createAskUserQuestionnaireState(input.initialState),
    input.queue,
  );
  let reviewIndex = 0;
  let resolved = false;
  let lastRenderedFrameLineCount = 0;

  const writeInlinePanelLines = (panelLines: readonly string[]): void => {
    if (lastRenderedFrameLineCount > 0) {
      stdout.write("\r");
      stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
    }
    stdout.write("\x1b[J");
    stdout.write(panelLines.join("\n"));
    stdout.write("\n");
    lastRenderedFrameLineCount = panelLines.length;
  };

  const render = (): void => {
    const view = buildAskUserQuestionnaireView({
      queue: input.queue,
      state,
    });
    const current = resolveAskUserPanelCurrentEnvelope({
      queue: input.queue,
      state,
    });
    const textInputValue = current ? state.textInputValue || state.answers[current.askId] : "";
    writeInlinePanelLines(
      renderAskUserPanelScreen({
        view,
        terminalColumns: resolveTerminalColumns(input.terminalColumns),
        activeReviewIndex: reviewIndex,
        textInputValue,
        planMode: input.planMode,
        planFilePath: input.planFilePath,
      }).split("\n"),
    );
  };

  return await new Promise<TerminalAskUserQuestionnairePanelResult>((resolve) => {
    const teardownInput = (): void => {
      offInput.call(stdin, "data", onData);
      try {
        setRawMode.call(stdin, false);
      } catch {
        // ignore raw mode teardown errors
      }
    };

    const finish = (result: TerminalAskUserQuestionnairePanelResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      teardownInput();
      if (lastRenderedFrameLineCount > 0) {
        stdout.write("\r");
        stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
        stdout.write("\x1b[J");
        lastRenderedFrameLineCount = 0;
      }
      stdout.write("\x1b[?25h");
      resolve(result);
    };

    const submitAll = (): void => {
      const text = buildAskUserBatchAnswerText({
        queue: input.queue,
        answers: state.answers,
        notes: state.notes,
      });
      finish({
        kind: "submitted",
        answers: state.answers,
        notes: state.notes,
        text,
      });
    };

    const resolveFallbackAnswer = (envelope: AskUserEnvelope): string => {
      const answered = state.answers[envelope.askId]?.trim();
      if (answered) {
        return answered;
      }
      const defaultAnswer = envelope.defaultOnTimeout.trim();
      if (defaultAnswer && !/^none$/i.test(defaultAnswer)) {
        return defaultAnswer;
      }
      const firstOption = resolveAskUserAnswerFromSelection(envelope, 0)?.trim();
      if (firstOption) {
        return firstOption;
      }
      return "continue_with_best_effort";
    };

    const submitWithFallbacks = (): void => {
      const answers = {
        ...state.answers,
      };
      for (const envelope of input.queue) {
        answers[envelope.askId] = resolveFallbackAnswer(envelope);
      }
      const text = buildAskUserBatchAnswerText({
        queue: input.queue,
        answers,
        notes: state.notes,
      });
      finish({
        kind: "submitted",
        answers,
        notes: state.notes,
        text,
      });
    };

    const goQuestion = (index: number): void => {
      state = syncAskUserPanelTextInput(
        reduceAskUserQuestionnaire(state, {
          type: "go_question",
          index,
          totalCount: input.queue.length,
        }),
        input.queue,
      );
      reviewIndex = 0;
      render();
    };

    const goReview = (): void => {
      state = reduceAskUserQuestionnaire(state, {
        type: "go_review",
      });
      reviewIndex = 0;
      render();
    };

    const commitAnswer = (answer: string): void => {
      const current = resolveAskUserPanelCurrentEnvelope({
        queue: input.queue,
        state,
      });
      if (!current) {
        finish({ kind: "cancelled" });
        return;
      }
      const trimmedAnswer = answer.trim();
      if (!trimmedAnswer && current.optionsDetailed.length <= 0) {
        render();
        return;
      }
      const previousQuestionIndex = state.currentQuestionIndex;
      state = reduceAskUserQuestionnaire(state, {
        type: "set_answer",
        askId: current.askId,
        answer: trimmedAnswer,
        totalCount: input.queue.length,
      });
      if (input.queue.length <= 1) {
        submitAll();
        return;
      }
      if (state.currentQuestionIndex === previousQuestionIndex) {
        goReview();
        return;
      }
      state = syncAskUserPanelTextInput(state, input.queue);
      render();
    };

    const handleQuestionAction = (
      action: AskUserPanelInputAction,
      view: Extract<AskUserQuestionnaireView, { kind: "question" }>,
    ): void => {
      const current = resolveAskUserPanelCurrentEnvelope({
        queue: input.queue,
        state,
      });
      if (!current) {
        finish({ kind: "cancelled" });
        return;
      }
      const focusedItem = view.optionItems[state.focusedOptionIndex];
      const focusedOther = focusedItem?.kind === "other";
      const otherIndex = view.optionItems.findIndex((item) => item.kind === "other");
      const notesMode = state.textInputMode === "notes";
      if (action.kind === "chat") {
        finish({ kind: "chat" });
        return;
      }
      if (action.kind === "skip" && input.planMode) {
        submitWithFallbacks();
        return;
      }
      if (action.kind === "notes") {
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_mode",
          value: "notes",
        });
        render();
        return;
      }
      if (notesMode) {
        if (action.kind === "cancel" || action.kind === "enter") {
          state = reduceAskUserQuestionnaire(state, {
            type: "set_text_input_mode",
            value: "none",
          });
          render();
          return;
        }
        if (action.kind === "backspace") {
          const note = state.notes[current.askId] ?? "";
          const graphemes = splitGraphemes(note);
          state = reduceAskUserQuestionnaire(state, {
            type: "set_note",
            askId: current.askId,
            value: graphemes.slice(0, -1).join(""),
          });
          render();
          return;
        }
        if (action.kind === "text") {
          state = reduceAskUserQuestionnaire(state, {
            type: "set_note",
            askId: current.askId,
            value: `${state.notes[current.askId] ?? ""}${action.value}`,
          });
          render();
          return;
        }
        if (action.kind === "submit_text") {
          state = reduceAskUserQuestionnaire(state, {
            type: "set_note",
            askId: current.askId,
            value: action.value,
          });
          state = reduceAskUserQuestionnaire(state, {
            type: "set_text_input_mode",
            value: "none",
          });
          render();
          return;
        }
      }
      if (action.kind === "cancel") {
        if ((current.optionsDetailed.length <= 0 || focusedOther) && state.textInputValue.length > 0) {
          state = reduceAskUserQuestionnaire(state, {
            type: "set_text_input_value",
            value: "",
          });
          render();
          return;
        }
        if (focusedOther && current.optionsDetailed.length > 0) {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: 0,
            optionCount: view.optionItems.length,
          });
          render();
          return;
        }
        finish({ kind: "cancelled" });
        return;
      }
      if (action.kind === "up") {
        state = reduceAskUserQuestionnaire(state, {
          type: "previous_option",
          optionCount: Math.max(1, view.optionItems.length),
        });
        render();
        return;
      }
      if (action.kind === "down") {
        state = reduceAskUserQuestionnaire(state, {
          type: "next_option",
          optionCount: Math.max(1, view.optionItems.length),
        });
        render();
        return;
      }
      if (action.kind === "left") {
        state = syncAskUserPanelTextInput(
          reduceAskUserQuestionnaire(state, {
            type: "previous_question",
            totalCount: input.queue.length,
          }),
          input.queue,
        );
        render();
        return;
      }
      if (action.kind === "right") {
        state = syncAskUserPanelTextInput(
          reduceAskUserQuestionnaire(state, {
            type: "next_question",
            totalCount: input.queue.length,
          }),
          input.queue,
        );
        render();
        return;
      }
      if (action.kind === "tab") {
        if (input.queue.length > 1) {
          goReview();
        }
        return;
      }
      if (action.kind === "backspace" && (current.optionsDetailed.length <= 0 || focusedOther)) {
        const graphemes = splitGraphemes(state.textInputValue);
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: graphemes.slice(0, -1).join(""),
        });
        render();
        return;
      }
      if (action.kind === "text" && (current.optionsDetailed.length <= 0 || focusedOther)) {
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: `${state.textInputValue}${action.value}`,
        });
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_mode",
          value: "other",
        });
        render();
        return;
      }
      if (action.kind === "text" && current.optionsDetailed.length > 0 && otherIndex >= 0) {
        state = reduceAskUserQuestionnaire(state, {
          type: "focus_option",
          index: otherIndex,
          optionCount: view.optionItems.length,
        });
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_mode",
          value: "other",
        });
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: action.value,
        });
        render();
        return;
      }
      if (action.kind === "submit_text") {
        if (current.optionsDetailed.length > 0 && otherIndex >= 0) {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: otherIndex,
            optionCount: view.optionItems.length,
          });
        }
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_mode",
          value: "other",
        });
        state = reduceAskUserQuestionnaire(state, {
          type: "set_text_input_value",
          value: action.value,
        });
        commitAnswer(action.value);
        return;
      }
      if (action.kind === "select_index") {
        const selectedItem = view.optionItems[action.index];
        if (selectedItem?.kind === "other") {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: action.index,
            optionCount: view.optionItems.length,
          });
          render();
          return;
        }
        const selectedAnswer = resolveAskUserAnswerFromSelection(current, action.index);
        if (selectedAnswer) {
          state = reduceAskUserQuestionnaire(state, {
            type: "focus_option",
            index: action.index,
            optionCount: current.optionsDetailed.length,
          });
          commitAnswer(selectedAnswer);
        }
        return;
      }
      if (action.kind === "enter") {
        if (focusedOther) {
          commitAnswer(state.textInputValue);
          return;
        }
        if (current.optionsDetailed.length > 0) {
          const selectedAnswer = resolveAskUserAnswerFromSelection(current, state.focusedOptionIndex);
          if (selectedAnswer) {
            commitAnswer(selectedAnswer);
          }
          return;
        }
        commitAnswer(state.textInputValue);
      }
    };

    const handleReviewAction = (action: AskUserPanelInputAction): void => {
      const itemCount = input.queue.length + 2;
      if (action.kind === "up") {
        reviewIndex = wrapAskUserPanelIndex(reviewIndex - 1, itemCount);
        render();
        return;
      }
      if (action.kind === "down") {
        reviewIndex = wrapAskUserPanelIndex(reviewIndex + 1, itemCount);
        render();
        return;
      }
      if (action.kind === "left") {
        goQuestion(Math.max(0, input.queue.length - 1));
        return;
      }
      if (action.kind === "right") {
        goQuestion(0);
        return;
      }
      if (action.kind === "enter" || action.kind === "select_index") {
        const selectedIndex = action.kind === "select_index"
          ? clampAskUserPanelIndex(action.index, itemCount)
          : reviewIndex;
        if (selectedIndex === 0) {
          const firstUnanswered = resolveFirstUnansweredAskUserQuestionIndex({
            queue: input.queue,
            answers: state.answers,
          });
          if (typeof firstUnanswered === "number") {
            goQuestion(firstUnanswered);
            return;
          }
          submitAll();
          return;
        }
        if (selectedIndex === itemCount - 1) {
          finish({ kind: "cancelled" });
          return;
        }
        goQuestion(selectedIndex - 1);
      }
    };

    const onData = (chunk: string): void => {
      const view = buildAskUserQuestionnaireView({
        queue: input.queue,
        state,
      });
      const optionCount = view.kind === "question" ? view.optionItems.length : input.queue.length + 2;
      const textInputMode = view.kind === "question"
        && (
          state.textInputMode === "notes"
          || state.textInputMode === "other"
          || view.optionItems.length <= 0
          || view.optionItems[view.activeOptionIndex]?.kind === "other"
        );
      const action = decodeAskUserPanelInput(
        String(chunk ?? ""),
        optionCount,
        textInputMode,
        input.planMode === true,
        view.kind === "question"
          ? {
            chatIndex: view.optionItems.length + 1,
            skipIndex: input.planMode === true ? view.optionItems.length + 2 : undefined,
          }
          : {},
      );
      if (view.kind === "question") {
        handleQuestionAction(action, view);
        return;
      }
      if (action.kind === "cancel") {
        finish({ kind: "cancelled" });
        return;
      }
      if (view.kind === "review") {
        handleReviewAction(action);
      }
    };

    stdout.write("\x1b[?25l");
    stdin.setEncoding?.("utf8");
    onInput.call(stdin, "data", onData);
    try {
      setRawMode.call(stdin, true);
    } catch {
      finish({ kind: "cancelled" });
      return;
    }
    resumeInput.call(stdin);
    render();
  });
}
