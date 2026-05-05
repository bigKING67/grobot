import { createCliTheme } from "../../theme/ansi-theme";
import {
  compactSpaces,
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import { TERMINAL_SYMBOL } from "../../theme/terminal-style";
import type {
  RenderTerminalSelectMenuInput,
  TerminalSelectMenuInput,
  TerminalSelectMenuItem,
  TerminalSelectMenuLayout,
  TerminalSelectMenuViewport,
} from "./contract";

export const MENU_POINTER = TERMINAL_SYMBOL.pointer;
export const MODEL_PICKER_POINTER = "❯";
export const MODEL_PICKER_CHECK = "✓";
export const MODEL_PICKER_DEFAULT_HINT = "Enter confirm · Esc back";
export const MODEL_PICKER_DEFAULT_SUBTITLE =
  "Switch the configured model for future sessions; use /model use <id> for custom models.";
export const MENU_TWO_COLUMN_MIN_WIDTH = 64;
export const MENU_DESCRIPTION_MIN_WIDTH = 22;
export const MENU_DESCRIPTION_GAP = 2;
export const MENU_MIN_LABEL_WIDTH = 8;
export const DEFAULT_RENDER_VISIBLE_OPTION_COUNT = 5;
export const MODEL_PICKER_RENDER_VISIBLE_OPTION_COUNT = 10;
export const MODEL_PICKER_DIVIDER_MAX_WIDTH = 120;
export const ASK_USER_RENDER_VISIBLE_OPTION_COUNT = 6;
export const ASK_USER_DIVIDER_MAX_WIDTH = 96;
export const PLAN_APPROVAL_RENDER_VISIBLE_OPTION_COUNT = 2;
export const PLAN_APPROVAL_DIVIDER_MAX_WIDTH = 120;
export const PLAN_APPROVAL_SURFACE_MAX_WIDTH = 96;
export const PLAN_APPROVAL_PLAN_DIVIDER = "┄";

const MENU_INPUT_CURSOR = "▌";

export interface RenderMenuRow {
  leftPlain: string;
  leftRendered: string;
  description: string;
  descriptionIndentWidth: number;
}

export interface TruncatedMenuLabel {
  plain: string;
  label: string;
  suffix: string;
}

interface PreparedRenderMenu {
  menu: TerminalSelectMenuInput;
  activeIndex: number;
}

function resolveMenuPrimaryAction(hintRaw: string): "select" | "apply" | "continue" | "fill" {
  const hint = hintRaw.toLowerCase();
  if (hint.includes("apply")) {
    return "apply";
  }
  if (hint.includes("continue")) {
    return "continue";
  }
  if (hint.includes("fill")) {
    return "fill";
  }
  return "select";
}

export function buildCompactMenuHint(hintRaw?: string): string {
  const fallback = "↑/↓ select · Enter confirm · Esc back";
  if (!hintRaw || hintRaw.trim().length === 0) {
    return fallback;
  }
  const action = resolveMenuPrimaryAction(hintRaw);
  const actionLabel = action === "apply"
    ? "apply"
    : action === "continue"
      ? "continue"
      : action === "fill"
        ? "fill"
        : "confirm";
  return `↑/↓ select · Enter ${actionLabel} · Esc back`;
}

export function sanitizeMenuText(value: string | undefined, fallback = ""): string {
  const sanitized = compactSpaces(sanitizeTerminalDisplayText(value ?? fallback));
  return sanitized.length > 0 ? sanitized : fallback;
}

export function resolveMenuLayout(menu: TerminalSelectMenuInput): TerminalSelectMenuLayout {
  if (
    menu.layout === "compact"
    || menu.layout === "expanded"
    || menu.layout === "compact-vertical"
  ) {
    return menu.layout;
  }
  return "compact";
}

export function resolveInputOptionDisplayText(input: {
  item: TerminalSelectMenuItem;
  isActive?: boolean;
  fallbackPlaceholder?: string;
  fallbackSeparator?: string;
}): string {
  const item = input.item;
  const baseLabel = sanitizeMenuText(item.label, item.id);
  if (!item.input) {
    return baseLabel;
  }
  const inputValue = sanitizeMenuText(
    item.inputValue ?? item.input.initialValue,
    "",
  );
  const activeInput = item.inputActive === true || input.isActive === true;
  const placeholder = sanitizeMenuText(
    item.input.placeholder,
    input.fallbackPlaceholder ?? baseLabel,
  );
  const cursor = activeInput ? MENU_INPUT_CURSOR : "";
  const showLabel =
    item.input.showLabelWithValue === true
    || item.input.labelValueSeparator !== undefined;
  if (showLabel) {
    if (!activeInput && inputValue.length <= 0) {
      return baseLabel;
    }
    const separator = item.input.labelValueSeparator ?? input.fallbackSeparator ?? ", ";
    return `${baseLabel}${separator}${inputValue.length > 0 ? inputValue : placeholder}${cursor}`;
  }
  if (activeInput) {
    return `${inputValue.length > 0 ? inputValue : placeholder}${cursor}`;
  }
  return inputValue.length > 0 ? inputValue : placeholder;
}

function normalizeViewportBound(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

export function resolveRenderViewport(
  menu: TerminalSelectMenuInput,
): Required<TerminalSelectMenuViewport> {
  const itemCount = menu.items.length;
  const totalCount = Math.max(
    itemCount,
    normalizeViewportBound(menu.viewport?.totalCount, itemCount),
  );
  const visibleCount = Math.min(
    totalCount,
    Math.max(
      itemCount,
      normalizeViewportBound(menu.viewport?.visibleCount, itemCount),
    ),
  );
  const maxStart = Math.max(0, totalCount - itemCount);
  const startIndex = Math.min(
    maxStart,
    normalizeViewportBound(menu.viewport?.startIndex, 0),
  );
  return {
    startIndex,
    visibleCount,
    totalCount,
  };
}

function normalizeRenderActiveIndex(itemsLength: number, activeIndex: number): number {
  if (itemsLength <= 0) {
    return 0;
  }
  if (typeof activeIndex !== "number" || !Number.isFinite(activeIndex)) {
    return 0;
  }
  return Math.max(0, Math.min(itemsLength - 1, Math.floor(activeIndex)));
}

function resolveRenderVisibleOptionCount(menu: TerminalSelectMenuInput): number {
  const itemCount = menu.items.length;
  if (itemCount <= 0) {
    return 0;
  }
  const fallback = (() => {
    if (menu.variant === "model_picker") {
      return MODEL_PICKER_RENDER_VISIBLE_OPTION_COUNT;
    }
    if (menu.variant === "ask_user") {
      return ASK_USER_RENDER_VISIBLE_OPTION_COUNT;
    }
    if (menu.variant === "plan_approval") {
      return PLAN_APPROVAL_RENDER_VISIBLE_OPTION_COUNT;
    }
    return DEFAULT_RENDER_VISIBLE_OPTION_COUNT;
  })();
  const requested =
    typeof menu.visibleOptionCount === "number" && Number.isFinite(menu.visibleOptionCount)
      ? Math.floor(menu.visibleOptionCount)
      : fallback;
  return Math.max(1, Math.min(itemCount, requested));
}

export function prepareStandaloneRenderMenu(input: RenderTerminalSelectMenuInput): PreparedRenderMenu {
  if (input.menu.viewport) {
    return {
      menu: input.menu,
      activeIndex: normalizeRenderActiveIndex(input.menu.items.length, input.activeIndex),
    };
  }
  const itemCount = input.menu.items.length;
  const activeIndex = normalizeRenderActiveIndex(itemCount, input.activeIndex);
  const visibleCount = resolveRenderVisibleOptionCount(input.menu);
  if (visibleCount <= 0 || visibleCount >= itemCount) {
    return {
      menu: input.menu,
      activeIndex,
    };
  }
  const maxStart = Math.max(0, itemCount - visibleCount);
  const startIndex = Math.max(
    0,
    Math.min(activeIndex - Math.floor(visibleCount / 2), maxStart),
  );
  return {
    menu: {
      ...input.menu,
      items: input.menu.items.slice(startIndex, startIndex + visibleCount),
      initialIndex: activeIndex - startIndex,
      viewport: {
        startIndex,
        visibleCount,
        totalCount: itemCount,
      },
    },
    activeIndex: activeIndex - startIndex,
  };
}

export function resolveViewportOrdinal(input: {
  viewport: Required<TerminalSelectMenuViewport>;
  rowIndex: number;
}): number {
  return input.viewport.startIndex + input.rowIndex + 1;
}

export function resolveScrollAwareMarker(input: {
  isActive: boolean;
  theme: ReturnType<typeof createCliTheme>;
}): { plain: string; rendered: string } {
  if (input.isActive) {
    return {
      plain: MENU_POINTER,
      rendered: input.theme.pointer(MENU_POINTER),
    };
  }
  return {
    plain: " ",
    rendered: " ",
  };
}

export function resolveModelPickerMarker(input: {
  isActive: boolean;
  theme: ReturnType<typeof createCliTheme>;
}): { plain: string; rendered: string } {
  if (input.isActive) {
    return {
      plain: MODEL_PICKER_POINTER,
      rendered: input.theme.pointer(MODEL_PICKER_POINTER),
    };
  }
  return {
    plain: " ",
    rendered: " ",
  };
}

export function resolveMenuColumns(columns?: number): number {
  if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0) {
    return 80;
  }
  return Math.max(48, Math.floor(columns));
}

export function shouldRenderMenuDescriptions(maxWidth: number): boolean {
  return maxWidth >= MENU_TWO_COLUMN_MIN_WIDTH;
}

export function resolveMenuLabelBudget(input: {
  surfaceWidth: number;
  ordinalWidth: number;
  hasDescriptionColumn: boolean;
  hideIndexes?: boolean;
}): number {
  const prefixWidth = input.hideIndexes === true
    ? 1 + 1
    : 1 + 1 + input.ordinalWidth + 1;
  const leftBudget = input.hasDescriptionColumn
    ? Math.max(prefixWidth + MENU_MIN_LABEL_WIDTH, input.surfaceWidth - MENU_DESCRIPTION_MIN_WIDTH)
    : input.surfaceWidth;
  const budgetWithGap = input.hasDescriptionColumn
    ? Math.max(prefixWidth + MENU_MIN_LABEL_WIDTH, leftBudget - MENU_DESCRIPTION_GAP)
    : leftBudget;
  return Math.max(MENU_MIN_LABEL_WIDTH, budgetWithGap - prefixWidth);
}

export function truncateMenuLabelWithSuffix(input: {
  label: string;
  suffix?: string;
  maxWidth: number;
}): TruncatedMenuLabel {
  const maxWidth = Math.max(1, Math.floor(input.maxWidth));
  const label = sanitizeMenuText(input.label);
  const suffixRaw = sanitizeTerminalDisplayText(input.suffix ?? "").replace(/\s+/g, " ");
  const suffix = suffixRaw.trim().length > 0 ? suffixRaw : "";
  if (!suffix) {
    const plain = truncateDisplayWidth(label, maxWidth);
    return {
      plain,
      label: plain,
      suffix: "",
    };
  }
  const suffixWidth = measureDisplayWidth(suffix);
  if (suffixWidth < maxWidth) {
    const labelPart = truncateDisplayWidth(label, maxWidth - suffixWidth);
    return {
      plain: `${labelPart}${suffix}`,
      label: labelPart,
      suffix,
    };
  }
  const plain = truncateDisplayWidth(`${label}${suffix}`, maxWidth);
  return {
    plain,
    label: plain,
    suffix: "",
  };
}

function resolveDescriptionColumn(input: {
  rowLeftWidths: readonly number[];
  maxWidth: number;
}): number {
  const maxLeftWidth = Math.max(0, ...input.rowLeftWidths);
  const maxDescriptionStart = Math.max(12, input.maxWidth - MENU_DESCRIPTION_MIN_WIDTH);
  return Math.max(12, Math.min(maxLeftWidth + MENU_DESCRIPTION_GAP, maxDescriptionStart));
}

export function renderTwoColumnRows(input: {
  rows: readonly RenderMenuRow[];
  maxWidth: number;
  theme: ReturnType<typeof createCliTheme>;
}): string[] {
  if (input.rows.length === 0) {
    return [];
  }
  const hasDescriptions =
    shouldRenderMenuDescriptions(input.maxWidth)
    && input.rows.some((row) => sanitizeMenuText(row.description).length > 0);
  if (!hasDescriptions) {
    return input.rows.map((row) => row.leftRendered);
  }
  const descriptionStart = resolveDescriptionColumn({
    rowLeftWidths: input.rows.map((row) => measureDisplayWidth(row.leftPlain)),
    maxWidth: input.maxWidth,
  });
  const descriptionWidth = Math.max(12, input.maxWidth - descriptionStart);
  const lines: string[] = [];
  for (const row of input.rows) {
    const description = sanitizeMenuText(row.description);
    if (description.length === 0) {
      lines.push(row.leftRendered);
      continue;
    }
    const left = padToDisplayWidth(row.leftRendered, descriptionStart);
    const descriptionLine = truncateDisplayWidth(description, descriptionWidth);
    lines.push(`${left}${input.theme.color("muted", descriptionLine)}`);
  }
  return lines;
}

export function renderVerticalRows(input: {
  rows: readonly RenderMenuRow[];
  maxWidth: number;
  theme: ReturnType<typeof createCliTheme>;
  expanded?: boolean;
}): string[] {
  const lines: string[] = [];
  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    lines.push(row.leftRendered);
    const description = sanitizeMenuText(row.description);
    if (description.length > 0) {
      const indent = padToDisplayWidth("", Math.max(2, row.descriptionIndentWidth));
      const descriptionWidth = Math.max(8, input.maxWidth - measureDisplayWidth(indent));
      lines.push(`${indent}${input.theme.color("muted", truncateDisplayWidth(description, descriptionWidth))}`);
    }
    if (input.expanded === true && index < input.rows.length - 1) {
      lines.push("");
    }
  }
  return lines;
}
