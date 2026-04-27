import { AskUserEnvelope } from "./schema";
import { buildAskUserOptionDisplayLabel } from "./display";

const ASK_USER_INTERACTION_TITLE_LIMIT = 72;
const ASK_USER_INTERACTION_QUESTION_LIMIT = 120;
const ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT = 96;
const ASK_USER_INTERACTION_NAV_LIMIT = 120;
const ASK_USER_INTERACTION_TAB_LABEL_LIMIT = 18;
const ASK_USER_INTERACTION_VISIBLE_OPTION_LIMIT = 7;
const ASK_USER_OTHER_OPTION_ID = "__other__";
const ASK_USER_OTHER_OPTION_LABEL = "Other";
const ASK_USER_OTHER_OPTION_PLACEHOLDER = "Type something.";

export type AskUserQuestionnaireMode = "question" | "review";
export type AskUserQuestionnaireOptionKind = "option" | "other";
export type AskUserQuestionnaireTextInputMode = "none" | "other" | "notes";

export interface AskUserQuestionnaireState {
  currentQuestionIndex: number;
  focusedOptionIndex: number;
  answers: Record<string, string>;
  notes: Record<string, string>;
  textInputValue: string;
  textInputMode: AskUserQuestionnaireTextInputMode;
  mode: AskUserQuestionnaireMode;
}

export type AskUserQuestionnaireAction =
  | { type: "previous_question"; totalCount: number }
  | { type: "next_question"; totalCount: number }
  | { type: "go_question"; index: number; totalCount: number }
  | { type: "previous_option"; optionCount: number }
  | { type: "next_option"; optionCount: number }
  | { type: "focus_option"; index: number; optionCount: number }
  | { type: "set_note"; askId: string; value: string }
  | {
    type: "set_answer";
    askId: string;
    answer: string;
    totalCount: number;
    shouldAdvance?: boolean;
  }
  | { type: "set_text_input_value"; value: string }
  | { type: "set_text_input_mode"; value: AskUserQuestionnaireTextInputMode }
  | { type: "go_review" }
  | { type: "reset_focus" };

export interface AskUserQuestionnaireTab {
  index: number;
  label: string;
  status: "current" | "answered" | "pending" | "submit";
}

export interface AskUserQuestionnaireOptionItem {
  id: string;
  label: string;
  description?: string;
  optionIndex: number;
  selected: boolean;
  kind: AskUserQuestionnaireOptionKind;
  placeholder?: string;
  inputValue?: string;
}

export interface AskUserQuestionnaireReviewItem {
  askId: string;
  question: string;
  answer?: string;
}

export type AskUserQuestionnaireView =
  | {
    kind: "empty";
    title: string;
    hint: string;
  }
  | {
    kind: "question";
    title: string;
    subtitle: string;
    question: string;
    navigationText: string;
    tabs: AskUserQuestionnaireTab[];
    optionItems: AskUserQuestionnaireOptionItem[];
    hint: string;
    queueHint: string;
    noteValue: string;
    textInputMode: AskUserQuestionnaireTextInputMode;
    visibleOptionCount: number;
    activeOptionIndex: number;
    currentQuestionIndex: number;
    currentQuestionNumber: number;
    totalCount: number;
    answeredCount: number;
    defaultAnswer?: string;
  }
  | {
    kind: "review";
    title: string;
    navigationText: string;
    reviewItems: AskUserQuestionnaireReviewItem[];
    hint: string;
    totalCount: number;
    answeredCount: number;
    unansweredCount: number;
  };

export interface AskUserSelectMenuItemDescriptor {
  id: string;
  label: string;
  description?: string;
}

export interface AskUserSelectMenuDescriptor {
  title: string;
  subtitle: string;
  hint: string;
  items: AskUserSelectMenuItemDescriptor[];
  initialIndex: number;
  visibleOptionCount: number;
}

export type AskUserReviewActionId =
  | "__submit"
  | "__cancel"
  | `edit:${number}`;

export function getAskUserOtherOptionId(): string {
  return ASK_USER_OTHER_OPTION_ID;
}

function compactSingleLine(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return normalized.slice(0, Math.max(0, maxChars));
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
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
  const header = compactSingleLine(input.envelope.header ?? "需要你选择", ASK_USER_INTERACTION_TITLE_LIMIT);
  const total = resolveEnvelopeTotal(input.queue, input.envelope);
  const number = resolveEnvelopeDisplayNumber(input.envelope, input.index);
  if (total > 1) {
    return compactSingleLine(`需要确认 · ${header} · ${String(number)}/${String(total)}`, ASK_USER_INTERACTION_TITLE_LIMIT);
  }
  return compactSingleLine(`需要确认 · ${header}`, ASK_USER_INTERACTION_TITLE_LIMIT);
}

function buildNavigationTabs(
  queue: readonly AskUserEnvelope[],
  state: AskUserQuestionnaireState,
): AskUserQuestionnaireTab[] {
  const tabs = queue.map((envelope, index): AskUserQuestionnaireTab => {
    const key = resolveAnswerKey(envelope);
    const hasAnswer = typeof state.answers[key] === "string" && state.answers[key].trim().length > 0;
    return {
      index,
      label: resolveEnvelopeHeader(envelope, index),
      status: index === state.currentQuestionIndex ? "current" : hasAnswer ? "answered" : "pending",
    };
  });
  if (queue.length > 1) {
    tabs.push({
      index: queue.length,
      label: "提交",
      status: state.mode === "review" ? "current" : "submit",
    });
  }
  return tabs;
}

function formatQuestionnaireTab(tab: AskUserQuestionnaireTab): string {
  if (tab.status === "current") {
    return `[${tab.label}]`;
  }
  if (tab.status === "answered") {
    return `${tab.label} ✓`;
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
    return "输入回复 · Enter 提交 · Esc 返回输入框";
  }
  const maxDirect = Math.min(envelope.optionsDetailed.length, 9);
  const numberHint = maxDirect > 1 ? `1-${String(maxDirect)}` : "1";
  return `↑/↓ 选择 · ${numberHint} 直选 · Other 输入 · Enter 确认 · Esc 返回输入框`;
}

function buildQueueHint(input: {
  queue: readonly AskUserEnvelope[];
  index: number;
}): string {
  if (input.queue.length <= 1) {
    return "待确认：1 项";
  }
  const remaining = Math.max(0, input.queue.length - input.index - 1);
  if (remaining > 0) {
    return `待确认：${String(input.queue.length)} 项 · 选择后继续下一题 · 后续 ${String(remaining)} 项`;
  }
  return `待确认：${String(input.queue.length)} 项 · 这是最后一题`;
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
    const textInputValue = compactSingleLine(
      input.state.textInputValue,
      ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT,
    );
    rows.push({
      id: ASK_USER_OTHER_OPTION_ID,
      label: ASK_USER_OTHER_OPTION_LABEL,
      optionIndex: otherIndex,
      selected: otherIndex === input.state.focusedOptionIndex,
      kind: "other",
      placeholder: ASK_USER_OTHER_OPTION_PLACEHOLDER,
      inputValue: input.state.textInputValue,
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
      title: "没有待确认问题",
      hint: "返回输入框继续对话",
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
      };
      if (typeof answer !== "string") {
        return baseItem;
      }
      return {
        ...baseItem,
        answer,
      };
    });
    return {
      kind: "review",
      title: "检查答案",
      navigationText,
      reviewItems,
      hint: "Enter 提交 · Esc 返回输入框",
      totalCount: input.queue.length,
      answeredCount,
      unansweredCount: Math.max(0, input.queue.length - answeredCount),
    };
  }
  const envelope = resolveCurrentEnvelope(input.queue, normalizedState);
  if (!envelope) {
    return {
      kind: "empty",
      title: "没有待确认问题",
      hint: "返回输入框继续对话",
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
    noteValue,
    textInputMode: normalizedState.textInputMode,
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
    label: "提交答案",
    description: `已回答 ${String(answeredCount)}/${String(totalCount)}`,
  }];
  for (let index = 0; index < input.queue.length; index += 1) {
    const envelope = input.queue[index];
    if (!envelope) {
      continue;
    }
    const answer = input.answers[resolveAnswerKey(envelope)]?.trim() || "<未回答>";
    items.push({
      id: `edit:${String(index)}`,
      label: `修改 ${String(index + 1)}. ${resolveEnvelopeHeader(envelope, index)}`,
      description: compactSingleLine(answer, ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT),
    });
  }
  items.push({
    id: "__cancel",
    label: "取消",
    description: "返回输入框，问题仍保留",
  });
  return {
    title: "检查答案",
    subtitle: `已回答 ${String(answeredCount)}/${String(totalCount)} · 确认后继续当前任务`,
    hint: "↑/↓ 选择 · Enter 确认 · Esc 返回输入框",
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
      lines.push(`  还有 ${String(view.unansweredCount)} 项未回答。`);
    }
    for (const item of view.reviewItems) {
      const answer = item.answer?.trim() || "<未回答>";
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
    lines.push("  请输入你的回复。");
    if (view.defaultAnswer && view.defaultAnswer.trim().length > 0) {
      lines.push(`  默认：${compactSingleLine(view.defaultAnswer, ASK_USER_INTERACTION_QUESTION_LIMIT)}`);
    }
  }
  lines.push("");
  lines.push(`  ${view.queueHint}`);
  lines.push(`  ${view.hint}`);
  return `${lines.join("\n")}\n`;
}
