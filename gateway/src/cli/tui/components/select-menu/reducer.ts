import { splitGraphemes } from "../../terminal/display-width";
import { resolveCoalescedSubmitChunk } from "../../terminal/keyboard";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import {
  type TerminalSelectMenuInput,
  type TerminalSelectMenuInputAction,
  type TerminalSelectMenuInlineInputReduction,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuViewportResolution,
} from "./contract";

const DEFAULT_SELECT_VISIBLE_OPTION_COUNT = 5;
const MODEL_PICKER_VISIBLE_OPTION_COUNT = 10;
const MENU_SEARCH_QUERY_LIMIT = 80;
const MENU_SEARCH_CLEAR_CONTROL = "\u0015";
const MENU_INPUT_TAB_WIDTH = "    ";

export type SelectNavigationInitialPlacement = "end" | "center";

export interface SelectNavigationState {
  optionCount: number;
  focusedIndex: number;
  visibleFromIndex: number;
  visibleToIndex: number;
  visibleOptionCount: number;
}

export type SelectNavigationAction =
  | { type: "previous" }
  | { type: "next" }
  | { type: "page_up" }
  | { type: "page_down" }
  | { type: "focus_index"; index: number }
  | { type: "set_options"; optionCount: number; focusedIndex?: number };

function normalizeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapIndex(optionCount: number, focusedIndex: number): number {
  if (optionCount <= 0) {
    return 0;
  }
  const normalized = focusedIndex % optionCount;
  return normalized < 0 ? normalized + optionCount : normalized;
}

export function normalizeSelectNavigationState(input: {
  optionCount: number;
  focusedIndex: number;
  visibleOptionCount: number;
  previousVisibleFromIndex?: number;
  initialPlacement?: SelectNavigationInitialPlacement;
}): SelectNavigationState {
  const optionCount = normalizeCount(input.optionCount);
  if (optionCount <= 0) {
    return {
      optionCount: 0,
      focusedIndex: 0,
      visibleFromIndex: 0,
      visibleToIndex: 0,
      visibleOptionCount: 0,
    };
  }
  const visibleOptionCount = Math.max(
    1,
    Math.min(optionCount, normalizeCount(input.visibleOptionCount)),
  );
  const focusedIndex = wrapIndex(optionCount, input.focusedIndex);
  const maxStart = Math.max(0, optionCount - visibleOptionCount);
  const fallbackStart = input.initialPlacement === "center"
    ? focusedIndex - Math.floor(visibleOptionCount / 2)
    : focusedIndex - visibleOptionCount + 1;
  let visibleFromIndex =
    typeof input.previousVisibleFromIndex === "number" && Number.isFinite(input.previousVisibleFromIndex)
      ? Math.floor(input.previousVisibleFromIndex)
      : fallbackStart;
  visibleFromIndex = clamp(visibleFromIndex, 0, maxStart);
  if (focusedIndex < visibleFromIndex) {
    visibleFromIndex = focusedIndex;
  } else if (focusedIndex >= visibleFromIndex + visibleOptionCount) {
    visibleFromIndex = focusedIndex - visibleOptionCount + 1;
  }
  visibleFromIndex = clamp(visibleFromIndex, 0, maxStart);
  return {
    optionCount,
    focusedIndex,
    visibleFromIndex,
    visibleToIndex: Math.min(optionCount, visibleFromIndex + visibleOptionCount),
    visibleOptionCount,
  };
}

export function reduceSelectNavigation(
  state: SelectNavigationState,
  action: SelectNavigationAction,
): SelectNavigationState {
  if (state.optionCount <= 0) {
    return normalizeSelectNavigationState({
      optionCount: 0,
      focusedIndex: 0,
      visibleOptionCount: 0,
    });
  }
  const nextFocusedIndex = (() => {
    if (action.type === "previous") {
      return wrapIndex(state.optionCount, state.focusedIndex - 1);
    }
    if (action.type === "next") {
      return wrapIndex(state.optionCount, state.focusedIndex + 1);
    }
    if (action.type === "page_up") {
      return clamp(state.focusedIndex - Math.max(1, state.visibleOptionCount), 0, state.optionCount - 1);
    }
    if (action.type === "page_down") {
      return clamp(state.focusedIndex + Math.max(1, state.visibleOptionCount), 0, state.optionCount - 1);
    }
    if (action.type === "focus_index") {
      return wrapIndex(state.optionCount, action.index);
    }
    return wrapIndex(
      normalizeCount(action.optionCount),
      action.focusedIndex ?? state.focusedIndex,
    );
  })();
  const nextOptionCount = action.type === "set_options"
    ? normalizeCount(action.optionCount)
    : state.optionCount;
  return normalizeSelectNavigationState({
    optionCount: nextOptionCount,
    focusedIndex: nextFocusedIndex,
    visibleOptionCount: state.visibleOptionCount,
    previousVisibleFromIndex: state.visibleFromIndex,
  });
}

export function normalizeTerminalSelectMenuIndex(
  itemsLength: number,
  initialIndex: number | undefined,
): number {
  if (itemsLength <= 0) {
    return 0;
  }
  if (typeof initialIndex !== "number" || !Number.isFinite(initialIndex)) {
    return 0;
  }
  const rounded = Math.floor(initialIndex);
  if (rounded < 0) {
    return 0;
  }
  if (rounded >= itemsLength) {
    return itemsLength - 1;
  }
  return rounded;
}

export function normalizeTerminalSelectMenuVisibleOptionCount(input: {
  itemsLength: number;
  visibleOptionCount?: number;
  variant?: TerminalSelectMenuInput["variant"];
}): number {
  if (input.itemsLength <= 0) {
    return 0;
  }
  const fallback = input.variant === "model_picker"
    ? MODEL_PICKER_VISIBLE_OPTION_COUNT
    : input.variant === "ask_user"
      ? 6
      : input.variant === "plan_approval"
        ? 2
        : DEFAULT_SELECT_VISIBLE_OPTION_COUNT;
  const requested =
    typeof input.visibleOptionCount === "number" && Number.isFinite(input.visibleOptionCount)
      ? Math.floor(input.visibleOptionCount)
      : fallback;
  return Math.max(1, Math.min(input.itemsLength, requested));
}

export function resolveTerminalSelectMenuViewport(input: {
  itemsLength: number;
  activeIndex: number;
  visibleOptionCount?: number;
  previousStartIndex?: number;
  variant?: TerminalSelectMenuInput["variant"];
}): TerminalSelectMenuViewportResolution {
  const totalCount = Math.max(0, Math.floor(input.itemsLength));
  if (totalCount <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      visibleCount: 0,
      totalCount: 0,
      activeIndex: 0,
    };
  }
  const activeIndex = normalizeTerminalSelectMenuIndex(totalCount, input.activeIndex);
  const visibleCount = normalizeTerminalSelectMenuVisibleOptionCount({
    itemsLength: totalCount,
    visibleOptionCount: input.visibleOptionCount,
    variant: input.variant,
  });
  const navigation = normalizeSelectNavigationState({
    optionCount: totalCount,
    focusedIndex: activeIndex,
    visibleOptionCount: visibleCount,
    previousVisibleFromIndex: input.previousStartIndex,
    initialPlacement: "end",
  });
  return {
    startIndex: navigation.visibleFromIndex,
    endIndex: navigation.visibleToIndex,
    visibleCount: navigation.visibleOptionCount,
    totalCount: navigation.optionCount,
    activeIndex: navigation.focusedIndex,
  };
}

export function resolveTerminalSelectMenuItemInputValue(item: TerminalSelectMenuItem): string {
  return item.inputValue ?? item.input?.initialValue ?? "";
}

export function resolveMenuIndexFromDigits(
  digitsRaw: string,
  itemsLength: number,
): number | undefined {
  if (!/^[0-9]+$/.test(digitsRaw)) {
    return undefined;
  }
  const parsed = Number.parseInt(digitsRaw, 10);
  if (
    !Number.isFinite(parsed)
    || parsed <= 0
    || parsed > itemsLength
    || String(parsed) !== digitsRaw
  ) {
    return undefined;
  }
  return parsed - 1;
}

export function resolveFirstMenuPrefixMatchIndex(
  digitsPrefixRaw: string,
  itemsLength: number,
): number | undefined {
  if (!/^[0-9]+$/.test(digitsPrefixRaw)) {
    return undefined;
  }
  for (let index = 1; index <= itemsLength; index += 1) {
    if (String(index).startsWith(digitsPrefixRaw)) {
      return index - 1;
    }
  }
  return undefined;
}

export function hasMenuDigitsContinuation(
  digitsPrefixRaw: string,
  itemsLength: number,
): boolean {
  if (!/^[0-9]+$/.test(digitsPrefixRaw)) {
    return false;
  }
  for (let index = 1; index <= itemsLength; index += 1) {
    const candidate = String(index);
    if (candidate.startsWith(digitsPrefixRaw) && candidate.length > digitsPrefixRaw.length) {
      return true;
    }
  }
  return false;
}

function normalizeMenuSearchQueryText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeMenuSearchCompactText(value: string): string {
  return normalizeMenuSearchQueryText(value).replace(/[\s_-]+/g, "");
}

function normalizeMenuSearchDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

export function isTerminalSelectMenuPrintableInput(rawInput: string): boolean {
  const input = String(rawInput ?? "");
  if (input.length === 0 || input.includes("\r") || input.includes("\n")) {
    return false;
  }
  return normalizeTerminalSelectMenuTextInput(input).length > 0;
}

export function trimTerminalSelectMenuSearchQuery(rawQuery: string): string {
  const graphemes = splitGraphemes(rawQuery);
  if (graphemes.length <= MENU_SEARCH_QUERY_LIMIT) {
    return rawQuery;
  }
  return graphemes.slice(0, MENU_SEARCH_QUERY_LIMIT).join("");
}

export function normalizeTerminalSelectMenuTextInput(rawInput: string): string {
  if (!rawInput) {
    return "";
  }
  const visibleWhitespace = String(rawInput)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, MENU_INPUT_TAB_WIDTH)
    .replace(/\n/g, " ");
  return sanitizeTerminalDisplayText(visibleWhitespace);
}

function resolveTerminalSelectMenuInlineSubmitText(
  rawInput: string,
): { shouldSubmit: boolean; text: string } {
  const strictSubmit = resolveCoalescedSubmitChunk(rawInput);
  if (strictSubmit.shouldSubmit) {
    return {
      shouldSubmit: true,
      text: normalizeTerminalSelectMenuTextInput(strictSubmit.normalizedChunk),
    };
  }
  const input = String(rawInput ?? "");
  const trailingLength = input.endsWith("\r\n")
    ? 2
    : input.endsWith("\r") || input.endsWith("\n")
      ? 1
      : 0;
  if (trailingLength === 0) {
    return { shouldSubmit: false, text: "" };
  }
  const payload = input.slice(0, input.length - trailingLength);
  if (payload.length === 0 || payload.endsWith("\\")) {
    return { shouldSubmit: false, text: "" };
  }
  const normalizedPayload = normalizeTerminalSelectMenuTextInput(payload);
  return normalizedPayload.length > 0
    ? { shouldSubmit: true, text: normalizedPayload }
    : { shouldSubmit: false, text: "" };
}

export function resolveMenuSearchMatchedIndices(
  queryRaw: string,
  items: readonly TerminalSelectMenuItem[],
): number[] {
  const query = normalizeMenuSearchQueryText(queryRaw);
  if (!query) {
    return items.map((_, index) => index);
  }
  const compactQuery = normalizeMenuSearchCompactText(query);
  const queryDigits = normalizeMenuSearchDigits(query);
  const exactMatches: number[] = [];
  const prefixMatches: number[] = [];
  const containsMatches: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const fields = [item.id, item.label, item.description ?? ""];
    const normalizedFields = fields.map((field) => normalizeMenuSearchQueryText(field));
    const compactFields = fields.map((field) => normalizeMenuSearchCompactText(field));
    const digitFields = fields.map((field) => normalizeMenuSearchDigits(field));
    const exact = normalizedFields.some((field) => field === query)
      || (compactQuery.length > 0 && compactFields.some((field) => field === compactQuery))
      || (queryDigits.length > 0 && digitFields.some((field) => field === queryDigits));
    if (exact) {
      exactMatches.push(index);
      continue;
    }
    const prefix = normalizedFields.some((field) => field.startsWith(query))
      || (compactQuery.length > 0 && compactFields.some((field) => field.startsWith(compactQuery)))
      || (queryDigits.length > 0 && digitFields.some((field) => field.startsWith(queryDigits)));
    if (prefix) {
      prefixMatches.push(index);
      continue;
    }
    const contains = normalizedFields.some((field) => field.includes(query))
      || (compactQuery.length > 0 && compactFields.some((field) => field.includes(compactQuery)))
      || (queryDigits.length > 0 && digitFields.some((field) => field.includes(queryDigits)));
    if (contains) {
      containsMatches.push(index);
    }
  }
  return [...exactMatches, ...prefixMatches, ...containsMatches];
}

export function reduceTerminalSelectMenuInlineInput(input: {
  rawInput: string;
  item: TerminalSelectMenuItem;
  currentValue?: string;
  inputMode?: boolean;
  variant?: TerminalSelectMenuInput["variant"];
}): TerminalSelectMenuInlineInputReduction {
  if (!input.item.input) {
    return { kind: "ignored" };
  }
  const rawInput = String(input.rawInput ?? "");
  const currentValue = input.currentValue ?? resolveTerminalSelectMenuItemInputValue(input.item);
  const inputMode = input.inputMode === true;
  if (rawInput === "\u0007" && input.variant === "plan_approval") {
    return { kind: "edit_plan", value: currentValue };
  }
  if (rawInput === "\t") {
    return { kind: "toggle_input", value: currentValue };
  }
  const submitChunk = resolveTerminalSelectMenuInlineSubmitText(rawInput);
  if (submitChunk.shouldSubmit) {
    const nextValue = submitChunk.text.length > 0
      ? `${currentValue}${submitChunk.text}`
      : currentValue;
    if (nextValue.trim().length > 0 || input.item.input.allowEmptySubmitToCancel === true) {
      return { kind: "submit", value: nextValue };
    }
    return { kind: "activate", value: nextValue };
  }
  if (rawInput === "\r" || rawInput === "\n") {
    if (currentValue.trim().length > 0 || input.item.input.allowEmptySubmitToCancel === true) {
      return { kind: "submit", value: currentValue };
    }
    return { kind: "activate", value: currentValue };
  }
  if (rawInput === "\u001b") {
    return inputMode
      ? { kind: "exit_input", value: currentValue }
      : { kind: "ignored" };
  }
  if (!inputMode) {
    return { kind: "ignored" };
  }
  if (rawInput === "\u007f" || rawInput === "\b") {
    const graphemes = splitGraphemes(currentValue);
    return { kind: "update", value: graphemes.slice(0, -1).join("") };
  }
  if (rawInput === MENU_SEARCH_CLEAR_CONTROL) {
    return { kind: "update", value: "" };
  }
  if (rawInput.includes("\r") || rawInput.includes("\n")) {
    return { kind: "ignored" };
  }
  const normalizedInput = normalizeTerminalSelectMenuTextInput(rawInput);
  if (normalizedInput.length > 0) {
    return { kind: "update", value: `${currentValue}${normalizedInput}` };
  }
  return { kind: "ignored" };
}

export function shouldEnableTerminalSelectMenuNumericSelection(input: {
  hideIndexes?: boolean;
}): boolean {
  return input.hideIndexes !== true;
}

export function decodeTerminalSelectMenuInput(
  rawInput: string,
  itemsLength: number,
): TerminalSelectMenuInputAction {
  if (rawInput.length === 0) {
    return { kind: "ignore" };
  }
  const parseNumericSelection = (input: string): TerminalSelectMenuInputAction => {
    if (!/^\d+$/.test(input)) {
      return { kind: "ignore" };
    }
    const parsedIndex = Number.parseInt(input, 10) - 1;
    if (!Number.isFinite(parsedIndex) || parsedIndex < 0 || parsedIndex >= itemsLength) {
      return { kind: "ignore" };
    }
    return {
      kind: "select_index",
      index: parsedIndex,
    };
  };
  const coalescedSubmit = resolveCoalescedSubmitChunk(rawInput);
  if (coalescedSubmit.shouldSubmit) {
    const normalizedPayload = coalescedSubmit.normalizedChunk.trim();
    if (normalizedPayload.length === 0) {
      return { kind: "enter" };
    }
    return parseNumericSelection(normalizedPayload);
  }
  if (rawInput.length === 1) {
    const firstChar = rawInput[0];
    if (firstChar === "\u0003" || firstChar === "\u001b") {
      return { kind: "cancel" };
    }
    if (firstChar === "\r" || firstChar === "\n" || firstChar === " ") {
      return { kind: "enter" };
    }
    if (firstChar === "\u0007") {
      return { kind: "edit_plan" };
    }
    if (firstChar === "k" || firstChar === "\u0010") {
      return { kind: "up" };
    }
    if (firstChar === "j" || firstChar === "\u000e") {
      return { kind: "down" };
    }
    return parseNumericSelection(firstChar);
  }
  if (/^\d+$/.test(rawInput.trim())) {
    return parseNumericSelection(rawInput.trim());
  }
  if (rawInput.startsWith("\u001b[A") || rawInput.startsWith("\u001bOA")) {
    return { kind: "up" };
  }
  if (rawInput.startsWith("\u001b[B") || rawInput.startsWith("\u001bOB")) {
    return { kind: "down" };
  }
  if (rawInput.startsWith("\u001b[5~")) {
    return { kind: "page_up" };
  }
  if (rawInput.startsWith("\u001b[6~")) {
    return { kind: "page_down" };
  }
  return { kind: "ignore" };
}

export { decodeTerminalSelectMenuInput as decodeMenuInput };
