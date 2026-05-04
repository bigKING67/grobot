import type { AskUserEnvelope, AskUserQuestionnaireState } from "../../../../tools/ask-user";
import { reduceAskUserQuestionnaire } from "../../../../tools/ask-user";
import { resolveCoalescedSubmitChunk } from "../../terminal/keyboard";
import type { AskUserPanelInputAction } from "./contract";

export function clampAskUserPanelIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.max(0, Math.min(count - 1, Math.floor(index)));
}

export function wrapAskUserPanelIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  const normalized = Math.floor(index) % count;
  return normalized < 0 ? normalized + count : normalized;
}

export function resolveAskUserPanelCurrentEnvelope(input: {
  queue: readonly AskUserEnvelope[];
  state: AskUserQuestionnaireState;
}): AskUserEnvelope | undefined {
  return input.queue[clampAskUserPanelIndex(input.state.currentQuestionIndex, input.queue.length)];
}

export function isAskUserStandardOptionAnswer(input: {
  envelope: AskUserEnvelope;
  answer: string;
}): boolean {
  const normalized = input.answer.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return input.envelope.optionsDetailed.some((option) => {
    const label = option.label.trim().toLowerCase();
    const value = (option.value ?? option.label).trim().toLowerCase();
    return normalized === label || normalized === value;
  });
}

export function resolveFirstUnansweredAskUserQuestionIndex(input: {
  queue: readonly AskUserEnvelope[];
  answers: Record<string, string>;
}): number | undefined {
  for (let index = 0; index < input.queue.length; index += 1) {
    const envelope = input.queue[index];
    if (!envelope) {
      continue;
    }
    if (!input.answers[envelope.askId]?.trim()) {
      return index;
    }
  }
  return undefined;
}

export function syncAskUserPanelTextInput(
  state: AskUserQuestionnaireState,
  queue: readonly AskUserEnvelope[],
): AskUserQuestionnaireState {
  const envelope = resolveAskUserPanelCurrentEnvelope({ queue, state });
  const answer = envelope ? state.answers[envelope.askId]?.trim() ?? "" : "";
  const value = envelope && answer && !isAskUserStandardOptionAnswer({ envelope, answer })
    ? answer
    : "";
  if (state.textInputValue === value) {
    return state;
  }
  return reduceAskUserQuestionnaire(state, {
    type: "set_text_input_value",
    value,
  });
}

export function isAskUserPanelPrintableInput(rawInput: string): boolean {
  if (!rawInput || rawInput.length === 0 || rawInput.startsWith("\u001b")) {
    return false;
  }
  return !/[\u0000-\u001f\u007f]/.test(rawInput);
}

export function decodeAskUserPanelInput(
  rawInput: string,
  optionCount: number,
  textInputMode: boolean,
  planMode = false,
): AskUserPanelInputAction {
  if (rawInput.length === 0) {
    return { kind: "ignore" };
  }
  const coalescedSubmit = resolveCoalescedSubmitChunk(rawInput);
  if (coalescedSubmit.shouldSubmit) {
    const normalizedPayload = coalescedSubmit.normalizedChunk.trim();
    if (normalizedPayload.length === 0) {
      return { kind: "enter" };
    }
    if (/^\d+$/.test(normalizedPayload)) {
      const parsedIndex = Number.parseInt(normalizedPayload, 10) - 1;
      if (parsedIndex >= 0 && parsedIndex < optionCount) {
        return { kind: "select_index", index: parsedIndex };
      }
    }
    if (isAskUserPanelPrintableInput(coalescedSubmit.normalizedChunk)) {
      return {
        kind: "submit_text",
        value: coalescedSubmit.normalizedChunk,
      };
    }
  }
  if (rawInput.length === 1) {
    if (rawInput === "\u0003" || rawInput === "\u001b") {
      return { kind: "cancel" };
    }
    if (rawInput === "\r" || rawInput === "\n" || (!textInputMode && rawInput === " ")) {
      return { kind: "enter" };
    }
    if (rawInput === "\t") {
      return { kind: "tab" };
    }
    if (rawInput === "\u007f" || rawInput === "\b") {
      return { kind: "backspace" };
    }
    if (!textInputMode && rawInput === "n") {
      return { kind: "notes" };
    }
    if (!textInputMode && rawInput === "c") {
      return { kind: "chat" };
    }
    if (planMode && !textInputMode && rawInput === "s") {
      return { kind: "skip" };
    }
    if (textInputMode && isAskUserPanelPrintableInput(rawInput)) {
      return { kind: "text", value: rawInput };
    }
    if (rawInput === "k" || rawInput === "\u0010") {
      return { kind: "up" };
    }
    if (rawInput === "j" || rawInput === "\u000e") {
      return { kind: "down" };
    }
    if (rawInput === "h") {
      return { kind: "left" };
    }
    if (rawInput === "l") {
      return { kind: "right" };
    }
    if (/^[1-9]$/.test(rawInput)) {
      const parsedIndex = Number.parseInt(rawInput, 10) - 1;
      if (parsedIndex >= 0 && parsedIndex < optionCount) {
        return { kind: "select_index", index: parsedIndex };
      }
    }
    if (isAskUserPanelPrintableInput(rawInput)) {
      return { kind: "text", value: rawInput };
    }
  }
  if (rawInput.startsWith("\u001b[A") || rawInput.startsWith("\u001bOA")) {
    return { kind: "up" };
  }
  if (rawInput.startsWith("\u001b[B") || rawInput.startsWith("\u001bOB")) {
    return { kind: "down" };
  }
  if (rawInput.startsWith("\u001b[D") || rawInput.startsWith("\u001bOD")) {
    return { kind: "left" };
  }
  if (rawInput.startsWith("\u001b[C") || rawInput.startsWith("\u001bOC")) {
    return { kind: "right" };
  }
  return { kind: "ignore" };
}
