import { AskUserEnvelope } from "./schema";
import { buildAskUserOptionDisplayLabel } from "./display";
import { compactAskUserDisplayLine } from "./display-text";
import {
  ASK_USER_SECRET_DISPLAY_VALUE,
  formatAskUserAnswerForDisplay,
  isAskUserSecret,
} from "./privacy";
import {
  ASK_USER_INTERACTION_NAV_LIMIT,
  ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT,
  ASK_USER_INTERACTION_QUESTION_LIMIT,
  ASK_USER_INTERACTION_TAB_LABEL_LIMIT,
  ASK_USER_INTERACTION_TITLE_LIMIT,
  ASK_USER_INTERACTION_VISIBLE_OPTION_LIMIT,
  ASK_USER_OTHER_OPTION_ID,
  ASK_USER_OTHER_OPTION_LABEL,
  ASK_USER_OTHER_OPTION_PLACEHOLDER,
  type AskUserQuestionnaireAction,
  type AskUserQuestionnaireMode,
  type AskUserQuestionnaireOptionItem,
  type AskUserQuestionnaireReviewItem,
  type AskUserQuestionnaireState,
  type AskUserQuestionnaireTab,
  type AskUserQuestionnaireTextInputMode,
  type AskUserQuestionnaireView,
  type AskUserSelectMenuDescriptor,
  type AskUserSelectMenuItemDescriptor,
} from "./interaction/contract";
export type {
  AskUserQuestionnaireAction,
  AskUserQuestionnaireMode,
  AskUserQuestionnaireOptionKind,
  AskUserQuestionnaireOptionItem,
  AskUserQuestionnaireReviewItem,
  AskUserQuestionnaireState,
  AskUserQuestionnaireTab,
  AskUserQuestionnaireTextInputMode,
  AskUserQuestionnaireView,
  AskUserReviewActionId,
  AskUserSelectMenuDescriptor,
  AskUserSelectMenuItemDescriptor,
} from "./interaction/contract";

export function getAskUserOtherOptionId(): string {
  return ASK_USER_OTHER_OPTION_ID;
}

function compactSingleLine(value: string, maxChars: number): string {
  return compactAskUserDisplayLine(value, maxChars);
}

function normalizeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  return clamp(Math.floor(index), 0, count - 1);
}

function wrapIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  const normalized = Math.floor(index) % count;
  return normalized < 0 ? normalized + count : normalized;
}

function normalizeQuestionnaireState(input: AskUserQuestionnaireState): AskUserQuestionnaireState {
  const currentQuestionIndex = normalizeCount(input.currentQuestionIndex);
  const focusedOptionIndex = normalizeCount(input.focusedOptionIndex);
  return {
    currentQuestionIndex,
    focusedOptionIndex,
    answers: input.answers ?? {},
    notes: input.notes ?? {},
    textInputValue: input.textInputValue,
    textInputMode: input.textInputMode ?? "none",
    mode: input.mode,
  };
}

function resolveCurrentEnvelope(
  queue: readonly AskUserEnvelope[],
  state: AskUserQuestionnaireState,
): AskUserEnvelope | undefined {
  return queue[clampIndex(state.currentQuestionIndex, queue.length)];
}

function resolveEnvelopeHeader(envelope: AskUserEnvelope, index: number): string {
  const header = compactSingleLine(envelope.header ?? `Q${String(index + 1)}`, ASK_USER_INTERACTION_TAB_LABEL_LIMIT);
  return header.length > 0 ? header : `Q${String(index + 1)}`;
}

function resolveEnvelopeDisplayNumber(envelope: AskUserEnvelope, index: number): number {
  if (
    typeof envelope.questionIndex === "number"
    && Number.isFinite(envelope.questionIndex)
    && envelope.questionIndex > 0
  ) {
    return Math.floor(envelope.questionIndex);
  }
  return index + 1;
}

function resolveEnvelopeTotal(queue: readonly AskUserEnvelope[], envelope?: AskUserEnvelope): number {
  if (
    envelope
    && typeof envelope.questionTotal === "number"
    && Number.isFinite(envelope.questionTotal)
    && envelope.questionTotal > queue.length
  ) {
    return Math.floor(envelope.questionTotal);
  }
  return queue.length;
}

function resolveAnswerKey(envelope: AskUserEnvelope): string {
  return envelope.askId;
}

function buildQuestionnaireTitle(input: {
  envelope: AskUserEnvelope;
  queue: readonly AskUserEnvelope[];
  index: number;
}): string {
  const header = compactSingleLine(input.envelope.header ?? "Choose an option", ASK_USER_INTERACTION_TITLE_LIMIT);
  const total = resolveEnvelopeTotal(input.queue, input.envelope);
  const number = resolveEnvelopeDisplayNumber(input.envelope, input.index);
  if (total > 1) {
    return compactSingleLine(`Input needed · ${header} · ${String(number)}/${String(total)}`, ASK_USER_INTERACTION_TITLE_LIMIT);
  }
  return compactSingleLine(`Input needed · ${header}`, ASK_USER_INTERACTION_TITLE_LIMIT);
}

function buildNavigationTabs(
  queue: readonly AskUserEnvelope[],
  state: AskUserQuestionnaireState,
): AskUserQuestionnaireTab[] {
  const tabs = queue.map((envelope, index): AskUserQuestionnaireTab => {
    const key = resolveAnswerKey(envelope);
    const hasAnswer = typeof state.answers[key] === "string" && state.answers[key].trim().length > 0;
    const isCurrentQuestion = state.mode !== "review" && index === state.currentQuestionIndex;
    return {
      index,
      label: resolveEnvelopeHeader(envelope, index),
      status: isCurrentQuestion ? "current" : hasAnswer ? "answered" : "pending",
    };
  });
  if (queue.length > 1) {
    tabs.push({
      index: queue.length,
      label: "Submit",
      status: state.mode === "review" ? "current" : "submit",
    });
  }
  return tabs;
}

function formatQuestionnaireTab(tab: AskUserQuestionnaireTab): string {
  if (tab.label === "Submit") {
    return tab.status === "current" ? "[✓ Submit]" : "✓ Submit";
  }
  if (tab.status === "current") {
    return `[□ ${tab.label}]`;
  }
  if (tab.status === "answered") {
    return `✓ ${tab.label}`;
  }
  return tab.label;
}

function buildNavigationText(tabs: readonly AskUserQuestionnaireTab[]): string {
  if (tabs.length <= 0) {
    return "";
  }
  return compactSingleLine(tabs.map(formatQuestionnaireTab).join("  "), ASK_USER_INTERACTION_NAV_LIMIT);
}

function buildQuestionnaireHint(envelope: AskUserEnvelope): string {
  if (envelope.optionsDetailed.length <= 0) {
    return "Type reply · Enter submit · Esc back to input";
  }
  const maxDirect = Math.min(envelope.optionsDetailed.length, 9);
  const numberHint = maxDirect > 1 ? `1-${String(maxDirect)}` : "1";
  return `↑/↓ select · ${numberHint} direct · Custom · Enter confirm · Esc back to input`;
}

function buildQueueHint(input: {
  queue: readonly AskUserEnvelope[];
  index: number;
}): string {
  if (input.queue.length <= 1) {
    return "Pending: 1 item";
  }
  const remaining = Math.max(0, input.queue.length - input.index - 1);
  if (remaining > 0) {
    return `Pending: ${String(input.queue.length)} items · continue to next after select · ${String(remaining)} remaining`;
  }
  return `Pending: ${String(input.queue.length)} items · this is the last one`;
}

function buildOptionItems(input: {
  envelope: AskUserEnvelope;
  state: AskUserQuestionnaireState;
}): AskUserQuestionnaireOptionItem[] {
  const rows = input.envelope.optionsDetailed.map((option, index): AskUserQuestionnaireOptionItem => {
    const id = resolveAskUserAnswerFromSelection(input.envelope, index) ?? option.value ?? option.label;
    const descriptionRaw = compactSingleLine(
      option.description ?? "",
      ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT,
    );
    const baseItem = {
      id,
      label: buildAskUserOptionDisplayLabel(option.label, index),
      optionIndex: index,
      selected: index === input.state.focusedOptionIndex,
      kind: "option" as const,
    };
    if (descriptionRaw.length <= 0) {
      return baseItem;
    }
    return {
      ...baseItem,
      description: descriptionRaw,
    };
  });
  if (input.envelope.optionsDetailed.length > 0) {
    const otherIndex = input.envelope.optionsDetailed.length;
    const displayInputValue = formatAskUserAnswerForDisplay({
      envelope: input.envelope,
      answer: input.state.textInputValue,
    }) ?? input.state.textInputValue;
    const textInputValue = compactSingleLine(
      displayInputValue,
      ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT,
    );
    rows.push({
      id: ASK_USER_OTHER_OPTION_ID,
      label: ASK_USER_OTHER_OPTION_LABEL,
      optionIndex: otherIndex,
      selected: otherIndex === input.state.focusedOptionIndex,
      kind: "other",
      placeholder: ASK_USER_OTHER_OPTION_PLACEHOLDER,
      inputValue: textInputValue,
      sensitive: isAskUserSecret(input.envelope),
      description: textInputValue.length > 0 ? textInputValue : ASK_USER_OTHER_OPTION_PLACEHOLDER,
    });
  }
  return rows;
}

export function createAskUserQuestionnaireState(input?: {
  currentQuestionIndex?: number;
  focusedOptionIndex?: number;
  answers?: Record<string, string>;
  notes?: Record<string, string>;
  textInputValue?: string;
  textInputMode?: AskUserQuestionnaireTextInputMode;
  mode?: AskUserQuestionnaireMode;
}): AskUserQuestionnaireState {
  return normalizeQuestionnaireState({
    currentQuestionIndex: input?.currentQuestionIndex ?? 0,
    focusedOptionIndex: input?.focusedOptionIndex ?? 0,
    answers: input?.answers ?? {},
    notes: input?.notes ?? {},
    textInputValue: input?.textInputValue ?? "",
    textInputMode: input?.textInputMode ?? "none",
    mode: input?.mode ?? "question",
  });
}

export function reduceAskUserQuestionnaire(
  state: AskUserQuestionnaireState,
  action: AskUserQuestionnaireAction,
): AskUserQuestionnaireState {
  const normalized = normalizeQuestionnaireState(state);
  if (action.type === "previous_question") {
    return {
      ...normalized,
      currentQuestionIndex: clampIndex(normalized.currentQuestionIndex - 1, action.totalCount),
      focusedOptionIndex: 0,
      textInputMode: "none",
      mode: "question",
    };
  }
  if (action.type === "next_question") {
    return {
      ...normalized,
      currentQuestionIndex: clampIndex(normalized.currentQuestionIndex + 1, action.totalCount),
      focusedOptionIndex: 0,
      textInputMode: "none",
      mode: "question",
    };
  }
  if (action.type === "go_question") {
    return {
      ...normalized,
      currentQuestionIndex: clampIndex(action.index, action.totalCount),
      focusedOptionIndex: 0,
      textInputMode: "none",
      mode: "question",
    };
  }
  if (action.type === "previous_option") {
    return {
      ...normalized,
      focusedOptionIndex: wrapIndex(normalized.focusedOptionIndex - 1, action.optionCount),
    };
  }
  if (action.type === "next_option") {
    return {
      ...normalized,
      focusedOptionIndex: wrapIndex(normalized.focusedOptionIndex + 1, action.optionCount),
    };
  }
  if (action.type === "focus_option") {
    return {
      ...normalized,
      focusedOptionIndex: clampIndex(action.index, action.optionCount),
    };
  }
  if (action.type === "set_note") {
    return {
      ...normalized,
      notes: {
        ...normalized.notes,
        [action.askId]: action.value,
      },
    };
  }
  if (action.type === "set_answer") {
    const totalCount = normalizeCount(action.totalCount);
    const shouldAdvance = action.shouldAdvance !== false && normalized.currentQuestionIndex < totalCount - 1;
    return {
      ...normalized,
      answers: {
        ...normalized.answers,
        [action.askId]: action.answer,
      },
      currentQuestionIndex: shouldAdvance
        ? clampIndex(normalized.currentQuestionIndex + 1, totalCount)
        : normalized.currentQuestionIndex,
      focusedOptionIndex: 0,
      textInputValue: shouldAdvance ? "" : normalized.textInputValue,
      textInputMode: "none",
      mode: shouldAdvance ? "question" : normalized.mode,
    };
  }
  if (action.type === "set_text_input_value") {
    return {
      ...normalized,
      textInputValue: action.value,
    };
  }
  if (action.type === "set_text_input_mode") {
    return {
      ...normalized,
      textInputMode: action.value,
    };
  }
  if (action.type === "go_review") {
    return {
      ...normalized,
      textInputMode: "none",
      mode: "review",
    };
  }
  return {
    ...normalized,
    focusedOptionIndex: 0,
    textInputMode: "none",
  };
}

export function resolveAskUserAnswerFromSelection(
  envelope: AskUserEnvelope,
  optionIndex: number,
): string | undefined {
  const option = envelope.optionsDetailed[optionIndex];
  if (!option) {
    return undefined;
  }
  return option.value ?? option.label;
}

export function buildAskUserQuestionnaireView(input: {
  queue: readonly AskUserEnvelope[];
  state?: AskUserQuestionnaireState;
}): AskUserQuestionnaireView {
  const state = createAskUserQuestionnaireState(input.state);
  if (input.queue.length <= 0) {
    return {
      kind: "empty",
      title: "No pending questions",
      hint: "Back to input to continue",
    };
  }
  const currentIndex = clampIndex(state.currentQuestionIndex, input.queue.length);
  const normalizedState = {
    ...state,
    currentQuestionIndex: currentIndex,
  };
  const tabs = buildNavigationTabs(input.queue, normalizedState);
  const answeredCount = input.queue.filter((envelope) => {
    const answer = normalizedState.answers[resolveAnswerKey(envelope)];
    return typeof answer === "string" && answer.trim().length > 0;
  }).length;
  const navigationText = buildNavigationText(tabs);
  if (normalizedState.mode === "review") {
    const reviewItems = input.queue.map((envelope): AskUserQuestionnaireReviewItem => {
      const answer = normalizedState.answers[resolveAnswerKey(envelope)];
      const baseItem = {
        askId: envelope.askId,
        question: compactSingleLine(envelope.question, ASK_USER_INTERACTION_QUESTION_LIMIT),
        isSecret: isAskUserSecret(envelope),
      };
      if (typeof answer !== "string") {
        return baseItem;
      }
      return {
        ...baseItem,
        answer: compactSingleLine(formatAskUserAnswerForDisplay({
          envelope,
          answer,
        }) ?? "", ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT),
      };
    });
    return {
      kind: "review",
      title: "Review answers",
      navigationText,
      reviewItems,
      hint: "Enter submit · Esc back to input",
      totalCount: input.queue.length,
      answeredCount,
      unansweredCount: Math.max(0, input.queue.length - answeredCount),
    };
  }
  const envelope = resolveCurrentEnvelope(input.queue, normalizedState);
  if (!envelope) {
    return {
      kind: "empty",
      title: "No pending questions",
      hint: "Back to input to continue",
    };
  }
  const optionItems = buildOptionItems({
    envelope,
    state: normalizedState,
  });
  const noteValue = normalizedState.notes[resolveAnswerKey(envelope)] ?? "";
  return {
    kind: "question",
    title: buildQuestionnaireTitle({
      envelope,
      queue: input.queue,
      index: currentIndex,
    }),
    subtitle: compactSingleLine(envelope.question, ASK_USER_INTERACTION_QUESTION_LIMIT),
    question: compactSingleLine(envelope.question, ASK_USER_INTERACTION_QUESTION_LIMIT),
    navigationText,
    tabs,
    optionItems,
    hint: buildQuestionnaireHint(envelope),
    queueHint: buildQueueHint({
      queue: input.queue,
      index: currentIndex,
    }),
    noteValue: compactSingleLine(noteValue, ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT),
    textInputMode: normalizedState.textInputMode,
    isSecret: isAskUserSecret(envelope),
    visibleOptionCount: Math.min(
      ASK_USER_INTERACTION_VISIBLE_OPTION_LIMIT,
      Math.max(1, optionItems.length),
    ),
    activeOptionIndex: clampIndex(normalizedState.focusedOptionIndex, optionItems.length),
    currentQuestionIndex: currentIndex,
    currentQuestionNumber: resolveEnvelopeDisplayNumber(envelope, currentIndex),
    totalCount: resolveEnvelopeTotal(input.queue, envelope),
    answeredCount,
    defaultAnswer: envelope.defaultOnTimeout,
  };
}

export function buildAskUserSelectMenuDescriptor(input: {
  queue: readonly AskUserEnvelope[];
  state?: AskUserQuestionnaireState;
}): AskUserSelectMenuDescriptor | undefined {
  const view = buildAskUserQuestionnaireView(input);
  if (view.kind !== "question" || view.optionItems.length <= 0) {
    return undefined;
  }
  const subtitleParts = [view.subtitle];
  if (view.navigationText && input.queue.length > 1) {
    subtitleParts.push(view.navigationText);
  }
  return {
    title: view.title,
    subtitle: compactSingleLine(subtitleParts.join(" · "), ASK_USER_INTERACTION_QUESTION_LIMIT),
    hint: view.hint,
    items: view.optionItems.map((item) => {
      const baseItem = {
        id: item.id,
        label: item.label,
      };
      if (!item.description) {
        return baseItem;
      }
      return {
        ...baseItem,
        description: item.description,
      };
    }),
    initialIndex: view.activeOptionIndex,
    visibleOptionCount: view.visibleOptionCount,
  };
}

export function buildAskUserBatchAnswerText(input: {
  queue: readonly AskUserEnvelope[];
  answers: Record<string, string>;
  notes?: Record<string, string>;
}): string {
  const lines: string[] = [];
  for (let index = 0; index < input.queue.length; index += 1) {
    const envelope = input.queue[index];
    if (!envelope) {
      continue;
    }
    const answer = input.answers[resolveAnswerKey(envelope)]?.trim();
    if (!answer) {
      continue;
    }
    const note = input.notes?.[resolveAnswerKey(envelope)]?.trim();
    const payload = note
      ? {
        answer,
        notes: note,
      }
      : answer;
    lines.push(`${String(index + 1)}. ${JSON.stringify(payload)}`);
  }
  return lines.join("\n");
}

export function buildAskUserReviewMenuDescriptor(input: {
  queue: readonly AskUserEnvelope[];
  answers: Record<string, string>;
}): AskUserSelectMenuDescriptor {
  const answeredCount = input.queue.filter((envelope) =>
    Boolean(input.answers[resolveAnswerKey(envelope)]?.trim())).length;
  const totalCount = input.queue.length;
  const items: AskUserSelectMenuItemDescriptor[] = [{
    id: "__submit",
    label: "Submit answers",
    description: `Answered ${String(answeredCount)}/${String(totalCount)}`,
  }];
  for (let index = 0; index < input.queue.length; index += 1) {
    const envelope = input.queue[index];
    if (!envelope) {
      continue;
    }
    const answerRaw = input.answers[resolveAnswerKey(envelope)]?.trim();
    const answer = answerRaw
      ? formatAskUserAnswerForDisplay({
        envelope,
        answer: answerRaw,
      }) ?? ASK_USER_SECRET_DISPLAY_VALUE
      : "<unanswered>";
    items.push({
      id: `edit:${String(index)}`,
      label: `Edit ${String(index + 1)}. ${resolveEnvelopeHeader(envelope, index)}`,
      description: compactSingleLine(answer, ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT),
    });
  }
  items.push({
    id: "__cancel",
    label: "Cancel",
    description: "Back to input; questions stay pending",
  });
    return {
    title: "Review answers",
    subtitle: `Answered ${String(answeredCount)}/${String(totalCount)} · continue after confirm`,
    hint: "↑/↓ select · Enter confirm · Esc back to input",
    items,
    initialIndex: 0,
    visibleOptionCount: Math.min(ASK_USER_INTERACTION_VISIBLE_OPTION_LIMIT, items.length),
  };
}

export function buildAskUserQueueDisplay(input: {
  queue: readonly AskUserEnvelope[];
  state?: AskUserQuestionnaireState;
}): string {
  const view = buildAskUserQuestionnaireView(input);
  if (view.kind === "empty") {
    return `${view.title}\n\n`;
  }
  if (view.kind === "review") {
    const lines = [view.title];
    if (view.navigationText) {
      lines.push(`  ${view.navigationText}`);
      lines.push("");
    }
    if (view.unansweredCount > 0) {
      lines.push(`  ${String(view.unansweredCount)} items unanswered.`);
    }
    for (const item of view.reviewItems) {
      const answer = item.answer?.trim() || "<unanswered>";
      lines.push(`  - ${item.question}`);
      lines.push(`    ${answer}`);
    }
    lines.push("");
    lines.push(`  ${view.hint}`);
    return `${lines.join("\n")}\n`;
  }
  const lines = [view.title, `  ${view.question}`, ""];
  if (view.navigationText && input.queue.length > 1) {
    lines.push(`  ${view.navigationText}`);
  }
  if (view.optionItems.length > 0) {
    for (const item of view.optionItems) {
      const marker = item.selected ? "❯" : " ";
      const description = item.description ? ` — ${item.description}` : "";
      lines.push(`  ${marker} ${String(item.optionIndex + 1)}  ${compactSingleLine(`${item.label}${description}`, ASK_USER_INTERACTION_QUESTION_LIMIT)}`);
    }
  } else {
    lines.push("  Type your reply.");
    if (view.defaultAnswer && view.defaultAnswer.trim().length > 0) {
      lines.push(`  Default: ${compactSingleLine(view.defaultAnswer, ASK_USER_INTERACTION_QUESTION_LIMIT)}`);
    }
  }
  lines.push("");
  lines.push(`  ${view.queueHint}`);
  lines.push(`  ${view.hint}`);
  return `${lines.join("\n")}\n`;
}
