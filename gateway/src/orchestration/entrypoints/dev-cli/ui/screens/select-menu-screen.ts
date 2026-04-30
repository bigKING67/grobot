import { resolveCliRenderMode, type CliEnv } from "../kernel/render-mode";
import { createCliTheme } from "../theme/ansi-theme";
import {
  compactSpaces,
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../interactive/display-width";
import { sanitizeTerminalDisplayText } from "../interactive/terminal-text-sanitizer";
import { TERMINAL_SYMBOL } from "../theme/terminal-style";

export interface TerminalSelectMenuItem {
  id: string;
  label: string;
  description?: string;
  current?: boolean;
  input?: {
    placeholder?: string;
    initialValue?: string;
    allowEmptySubmitToCancel?: boolean;
    showLabelWithValue?: boolean;
    labelValueSeparator?: string;
    resetCursorOnUpdate?: boolean;
  };
  inputValue?: string;
  inputActive?: boolean;
}

export interface TerminalSelectMenuModelPickerMeta {
  providerName: string;
  currentModel?: string;
  startupModel?: string;
  totalModelCount?: number;
  sessionId?: string;
  sessionTitle?: string;
  sessionSummary?: string;
}

export interface TerminalSelectMenuPlanApprovalMeta {
  planContent: string;
  planPath?: string;
  agentName?: string;
  editorName?: string;
  planEdited?: boolean;
}

export interface TerminalSelectMenuViewport {
  startIndex: number;
  visibleCount: number;
  totalCount: number;
}

export type TerminalSelectMenuLayout = "compact" | "expanded" | "compact-vertical";

export interface TerminalSelectMenuInput {
  title: string;
  subtitle?: string;
  hint?: string;
  items: TerminalSelectMenuItem[];
  initialIndex?: number;
  visibleOptionCount?: number;
  hideIndexes?: boolean;
  layout?: TerminalSelectMenuLayout;
  inlineDescriptions?: boolean;
  viewport?: TerminalSelectMenuViewport;
  variant?: "default" | "model_picker" | "ask_user" | "plan_approval";
  modelPickerMeta?: TerminalSelectMenuModelPickerMeta;
  planApprovalMeta?: TerminalSelectMenuPlanApprovalMeta;
}

export type TerminalSelectMenuResult =
  | { kind: "selected"; item: TerminalSelectMenuItem; index: number; inputValue?: string }
  | { kind: "edit_plan"; item: TerminalSelectMenuItem; index: number }
  | { kind: "cancelled" };

interface RenderTerminalSelectMenuInput {
  menu: TerminalSelectMenuInput;
  activeIndex: number;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}

const MENU_POINTER = TERMINAL_SYMBOL.pointer;
const MODEL_PICKER_POINTER = "❯";
const MODEL_PICKER_CHECK = "✓";
const MODEL_PICKER_DEFAULT_HINT = "Enter 确认 · Esc 返回";
const MODEL_PICKER_DEFAULT_SUBTITLE =
  "Switch between Grobot models. Applies to this session and future Grobot sessions.";
const MENU_TWO_COLUMN_MIN_WIDTH = 64;
const MENU_DESCRIPTION_MIN_WIDTH = 22;
const MENU_DESCRIPTION_GAP = 2;
const MENU_MIN_LABEL_WIDTH = 8;
const DEFAULT_RENDER_VISIBLE_OPTION_COUNT = 5;
const MODEL_PICKER_RENDER_VISIBLE_OPTION_COUNT = 10;
const MODEL_PICKER_DIVIDER_MAX_WIDTH = 120;
const ASK_USER_RENDER_VISIBLE_OPTION_COUNT = 6;
const ASK_USER_DIVIDER_MAX_WIDTH = 96;
const PLAN_APPROVAL_RENDER_VISIBLE_OPTION_COUNT = 2;
const PLAN_APPROVAL_DIVIDER_MAX_WIDTH = 120;
const PLAN_APPROVAL_SURFACE_MAX_WIDTH = 96;
const PLAN_APPROVAL_PLAN_DIVIDER = "┄";
const MENU_INPUT_CURSOR = "▌";

interface RenderMenuRow {
  leftPlain: string;
  leftRendered: string;
  description: string;
  descriptionIndentWidth: number;
}

interface TruncatedMenuLabel {
  plain: string;
  label: string;
  suffix: string;
}

interface PreparedRenderMenu {
  menu: TerminalSelectMenuInput;
  activeIndex: number;
}

function resolveMenuPrimaryAction(hintRaw: string): "select" | "apply" | "continue" {
  const hint = hintRaw.toLowerCase();
  if (hint.includes("apply")) {
    return "apply";
  }
  if (hint.includes("continue")) {
    return "continue";
  }
  return "select";
}

function buildCompactMenuHint(hintRaw?: string): string {
  const fallback = "↑/↓ 选择 · Enter 确认 · Esc 返回";
  if (!hintRaw || hintRaw.trim().length === 0) {
    return fallback;
  }
  const action = resolveMenuPrimaryAction(hintRaw);
  const actionLabel = action === "apply" ? "应用" : action === "continue" ? "继续" : "确认";
  return `↑/↓ 选择 · Enter ${actionLabel} · Esc 返回`;
}

function sanitizeMenuText(value: string | undefined, fallback = ""): string {
  const sanitized = compactSpaces(sanitizeTerminalDisplayText(value ?? fallback));
  return sanitized.length > 0 ? sanitized : fallback;
}

function resolveMenuLayout(menu: TerminalSelectMenuInput): TerminalSelectMenuLayout {
  if (
    menu.layout === "compact"
    || menu.layout === "expanded"
    || menu.layout === "compact-vertical"
  ) {
    return menu.layout;
  }
  return "compact";
}

function resolveInputOptionDisplayText(input: {
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

function resolveRenderViewport(menu: TerminalSelectMenuInput): Required<TerminalSelectMenuViewport> {
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

function prepareStandaloneRenderMenu(input: RenderTerminalSelectMenuInput): PreparedRenderMenu {
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

function resolveViewportOrdinal(input: {
  viewport: Required<TerminalSelectMenuViewport>;
  rowIndex: number;
}): number {
  return input.viewport.startIndex + input.rowIndex + 1;
}

function resolveScrollAwareMarker(input: {
  rowIndex: number;
  rowCount: number;
  isActive: boolean;
  viewport: Required<TerminalSelectMenuViewport>;
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

function resolveModelPickerMarker(input: {
  rowIndex: number;
  rowCount: number;
  isActive: boolean;
  viewport: Required<TerminalSelectMenuViewport>;
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

function resolveMenuColumns(): number {
  const stdout = process.stdout as { columns?: number };
  if (typeof stdout.columns !== "number" || !Number.isFinite(stdout.columns) || stdout.columns <= 0) {
    return 80;
  }
  return Math.max(48, Math.floor(stdout.columns));
}

function shouldRenderMenuDescriptions(maxWidth: number): boolean {
  return maxWidth >= MENU_TWO_COLUMN_MIN_WIDTH;
}

function resolveMenuLabelBudget(input: {
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

function truncateMenuLabelWithSuffix(input: {
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

function renderTwoColumnRows(input: {
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

function renderVerticalRows(input: {
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

function isModelPickerCurrent(input: {
  item: TerminalSelectMenuItem;
  meta?: TerminalSelectMenuModelPickerMeta;
}): boolean {
  return input.item.current || input.item.id === input.meta?.currentModel;
}

function isModelPickerDefault(input: {
  item: TerminalSelectMenuItem;
  meta?: TerminalSelectMenuModelPickerMeta;
}): boolean {
  return Boolean(input.meta?.startupModel && input.item.id === input.meta.startupModel);
}

function resolveModelStatusSuffix(input: {
  item: TerminalSelectMenuItem;
  meta?: TerminalSelectMenuModelPickerMeta;
}): string {
  if (isModelPickerCurrent(input)) {
    return ` ${MODEL_PICKER_CHECK}`;
  }
  if (isModelPickerDefault(input)) {
    return " (default)";
  }
  return "";
}

function renderModelPickerLabel(input: {
  isActive: boolean;
  isCurrent: boolean;
  labelParts: TruncatedMenuLabel;
  theme: ReturnType<typeof createCliTheme>;
}): string {
  if (input.isCurrent) {
    const label = input.isActive
      ? input.theme.color("accent", input.labelParts.label)
      : input.labelParts.label;
    const suffix = input.labelParts.suffix
      ? input.theme.color("accent", input.labelParts.suffix)
      : "";
    return `${label}${suffix}`;
  }
  if (input.isActive) {
    return input.theme.color("accent", input.labelParts.plain);
  }
  const suffix = input.labelParts.suffix
    ? input.theme.color("muted", input.labelParts.suffix)
    : "";
  return `${input.labelParts.label}${suffix}`;
}

function renderModelPickerMenu(input: RenderTerminalSelectMenuInput): string {
  const mode = resolveCliRenderMode({
    stdinIsTTY: input.stdinIsTTY,
    stdoutIsTTY: input.stdoutIsTTY,
    env: input.env,
  });
  const theme = createCliTheme(mode);
  const columns = resolveMenuColumns();
  const surfaceWidth = Math.max(44, Math.min(86, columns - 4));
  const lines: string[] = [];
  const meta = input.menu.modelPickerMeta;
  const visibleItems = input.menu.items;
  const viewport = resolveRenderViewport(input.menu);
  const hideIndexes = input.menu.hideIndexes === true;
  const ordinalWidth = hideIndexes ? 0 : `${String(Math.max(1, viewport.totalCount))}.`.length;
  const hasDescriptionColumn = shouldRenderMenuDescriptions(surfaceWidth);
  const labelBudget = resolveMenuLabelBudget({
    surfaceWidth,
    ordinalWidth,
    hasDescriptionColumn,
    hideIndexes,
  });
  const hint = sanitizeMenuText(input.menu.hint, MODEL_PICKER_DEFAULT_HINT);
  const title = sanitizeMenuText(input.menu.title, "Select");
  const subtitle = sanitizeMenuText(input.menu.subtitle, MODEL_PICKER_DEFAULT_SUBTITLE);
  const dividerWidth = Math.max(44, Math.min(MODEL_PICKER_DIVIDER_MAX_WIDTH, columns));

  lines.push(theme.color("brand", "─".repeat(dividerWidth)));
  lines.push(theme.color("brand", theme.bold(`  ${title}`)));
  if (surfaceWidth >= 56 && subtitle.length > 0) {
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(subtitle, surfaceWidth - 2))}`);
  }
  lines.push("");

  const rows: RenderMenuRow[] = [];
  for (let index = 0; index < visibleItems.length; index += 1) {
    const item = visibleItems[index];
    const isActive = index === input.activeIndex;
    const marker = resolveModelPickerMarker({
      rowIndex: index,
      rowCount: visibleItems.length,
      isActive,
      viewport,
      theme,
    });
    const ordinalPlain = `${String(resolveViewportOrdinal({ viewport, rowIndex: index }))}.`
      .padEnd(ordinalWidth);
    const ordinal = hideIndexes
      ? ""
      : isActive
        ? theme.color("accent", ordinalPlain)
        : theme.color("muted", ordinalPlain);
    const isCurrent = isModelPickerCurrent({ item, meta });
    const statusSuffix = resolveModelStatusSuffix({ item, meta });
    const labelBase = sanitizeMenuText(item.label, item.id);
    const labelParts = truncateMenuLabelWithSuffix({
      label: labelBase,
      suffix: statusSuffix,
      maxWidth: labelBudget,
    });
    const renderedLabel = renderModelPickerLabel({
      isActive,
      isCurrent,
      labelParts,
      theme,
    });
    const prefixPlain = hideIndexes
      ? `${marker.plain} `
      : `${marker.plain} ${ordinalPlain} `;
    const prefixRendered = hideIndexes
      ? `${marker.rendered} `
      : `${marker.rendered} ${ordinal} `;
    rows.push({
      leftPlain: `${prefixPlain}${labelParts.plain}`,
      leftRendered: `${prefixRendered}${renderedLabel}`,
      description: hasDescriptionColumn ? sanitizeMenuText(item.description) : "",
      descriptionIndentWidth: measureDisplayWidth(prefixPlain),
    });
  }
  lines.push(...renderTwoColumnRows({
    rows,
    maxWidth: surfaceWidth,
    theme,
  }));

  lines.push("");
  lines.push(theme.color("muted", `  ${hint}`));
  return lines.join("\n");
}

function renderAskUserMenu(input: RenderTerminalSelectMenuInput): string {
  const mode = resolveCliRenderMode({
    stdinIsTTY: input.stdinIsTTY,
    stdoutIsTTY: input.stdoutIsTTY,
    env: input.env,
  });
  const theme = createCliTheme(mode);
  const columns = resolveMenuColumns();
  const surfaceWidth = Math.max(44, Math.min(88, columns - 4));
  const dividerWidth = Math.max(44, Math.min(ASK_USER_DIVIDER_MAX_WIDTH, columns));
  const viewport = resolveRenderViewport(input.menu);
  const hideIndexes = input.menu.hideIndexes === true;
  const ordinalWidth = hideIndexes ? 0 : `${String(Math.max(1, viewport.totalCount))}.`.length;
  const hasDescriptionColumn = shouldRenderMenuDescriptions(surfaceWidth);
  const labelBudget = resolveMenuLabelBudget({
    surfaceWidth,
    ordinalWidth,
    hasDescriptionColumn,
    hideIndexes,
  });
  const title = sanitizeMenuText(input.menu.title, "需要确认");
  const subtitle = sanitizeMenuText(input.menu.subtitle);
  const hint = sanitizeMenuText(input.menu.hint, "↑/↓ 选择 · Enter 确认 · Esc 返回输入框");
  const lines: string[] = [];

  lines.push(theme.color("brand", "─".repeat(dividerWidth)));
  lines.push(`  ${theme.color("brand", theme.bold(title))}`);
  if (surfaceWidth >= 56 && subtitle.length > 0) {
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(subtitle, surfaceWidth - 2))}`);
  }
  lines.push("");

  const rows: RenderMenuRow[] = [];
  for (let index = 0; index < input.menu.items.length; index += 1) {
    const item = input.menu.items[index];
    const isActive = index === input.activeIndex;
    const marker = resolveModelPickerMarker({
      rowIndex: index,
      rowCount: input.menu.items.length,
      isActive,
      viewport,
      theme,
    });
    const ordinalPlain = `${String(resolveViewportOrdinal({ viewport, rowIndex: index }))}.`
      .padEnd(ordinalWidth);
    const ordinal = hideIndexes
      ? ""
      : isActive
        ? theme.color("accent", ordinalPlain)
        : theme.color("muted", ordinalPlain);
    const labelPlain = resolveInputOptionDisplayText({
      item,
      isActive,
    });
    const currentSuffix = item.current ? " ✓" : "";
    const labelParts = truncateMenuLabelWithSuffix({
      label: labelPlain,
      suffix: currentSuffix,
      maxWidth: labelBudget,
    });
    const renderedLabel = isActive
      ? theme.color("accent", labelParts.plain)
      : `${labelParts.label}${labelParts.suffix ? theme.currentTag(labelParts.suffix) : ""}`;
    const prefixPlain = hideIndexes
      ? `${marker.plain} `
      : `${marker.plain} ${ordinalPlain} `;
    const prefixRendered = hideIndexes
      ? `${marker.rendered} `
      : `${marker.rendered} ${ordinal} `;
    rows.push({
      leftPlain: `${prefixPlain}${labelParts.plain}`,
      leftRendered: `${prefixRendered}${renderedLabel}`,
      description: hasDescriptionColumn ? sanitizeMenuText(item.description) : "",
      descriptionIndentWidth: measureDisplayWidth(prefixPlain),
    });
  }
  lines.push(...renderTwoColumnRows({
    rows,
    maxWidth: surfaceWidth,
    theme,
  }));

  lines.push("");
  lines.push(theme.color("muted", `  ${hint}`));
  return lines.join("\n");
}

function renderPlanApprovalMenu(input: RenderTerminalSelectMenuInput): string {
  const mode = resolveCliRenderMode({
    stdinIsTTY: input.stdinIsTTY,
    stdoutIsTTY: input.stdoutIsTTY,
    env: input.env,
  });
  const theme = createCliTheme(mode);
  const columns = resolveMenuColumns();
  const surfaceWidth = Math.max(48, Math.min(PLAN_APPROVAL_SURFACE_MAX_WIDTH, columns - 4));
  const dividerWidth = Math.max(48, Math.min(PLAN_APPROVAL_DIVIDER_MAX_WIDTH, columns));
  const viewport = resolveRenderViewport(input.menu);
  const title = sanitizeMenuText(input.menu.title, "Ready to code?");
  const agentName = sanitizeMenuText(input.menu.planApprovalMeta?.agentName, "Grobot");
  const editorName = sanitizeMenuText(input.menu.planApprovalMeta?.editorName, "editor");
  const planContent = input.menu.planApprovalMeta?.planContent ?? "";
  const planPath = sanitizeTerminalDisplayText(input.menu.planApprovalMeta?.planPath ?? "").trim();
  const hintBase = sanitizeMenuText(input.menu.hint, "↑/↓ 选择 · Enter 确认 · Esc 返回输入框");
  const editHint = planPath.length > 0
    ? `ctrl-g to edit in ${editorName} · ${planPath}`
    : `ctrl-g to edit in ${editorName}`;
  const editHintWithSaveState = input.menu.planApprovalMeta?.planEdited
    ? `${editHint} · Plan saved!`
    : editHint;
  const planLines = planContent.length > 0 ? planContent.split(/\r?\n/) : ["No plan found."];
  const optionLabelBudget = Math.max(12, surfaceWidth - 4);
  const lines: string[] = [];

  lines.push(theme.color("planMode", "─".repeat(dividerWidth)));
  lines.push(`  ${theme.color("planMode", theme.bold(title))}`);
  lines.push("");
  lines.push(`  Here is ${agentName}'s plan:`);
  lines.push("");
  lines.push(theme.color("muted", PLAN_APPROVAL_PLAN_DIVIDER.repeat(surfaceWidth)));
  for (const rawLine of planLines) {
    const sanitizedLine = sanitizeTerminalDisplayText(rawLine).trimEnd();
    const renderedLine = sanitizedLine.length > 0
      ? truncateDisplayWidth(sanitizedLine, surfaceWidth - 2)
      : "";
    lines.push(`  ${renderedLine}`);
  }
  lines.push(theme.color("muted", PLAN_APPROVAL_PLAN_DIVIDER.repeat(surfaceWidth)));
  lines.push("");
  lines.push(
    theme.color("muted", `  ${
        truncateDisplayWidth(
          `${agentName} has written up a plan and is ready to execute. Would you like to proceed?`,
          surfaceWidth,
        )
      }`),
  );
  lines.push("");

  for (let index = 0; index < input.menu.items.length; index += 1) {
    const item = input.menu.items[index];
    const isActive = index === input.activeIndex;
    const marker = isActive
      ? theme.color("planMode", "❯")
      : " ";
    const labelRaw = resolveInputOptionDisplayText({
      item,
      isActive,
      fallbackPlaceholder: "Type feedback",
      fallbackSeparator: ": ",
    });
    const label = truncateDisplayWidth(labelRaw, optionLabelBudget);
    const renderedLabel = isActive ? theme.color("planMode", label) : label;
    lines.push(`  ${marker} ${renderedLabel}`);
    const description = sanitizeMenuText(item.description);
    if (isActive && description.length > 0) {
      lines.push(theme.color("muted", `    ${truncateDisplayWidth(description, optionLabelBudget)}`));
    }
  }

  if (viewport.totalCount > input.menu.items.length) {
    lines.push(theme.color("muted", `  ${String(viewport.startIndex + 1)}-${String(viewport.startIndex + input.menu.items.length)} / ${String(viewport.totalCount)}`));
  }
  lines.push("");
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(hintBase, surfaceWidth)}`));
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(editHintWithSaveState, surfaceWidth)}`));
  return lines.join("\n");
}

export function renderTerminalSelectMenu(input: RenderTerminalSelectMenuInput): string {
  const prepared = prepareStandaloneRenderMenu(input);
  const preparedInput = {
    ...input,
    menu: prepared.menu,
    activeIndex: prepared.activeIndex,
  };
  if (preparedInput.menu.variant === "model_picker") {
    return renderModelPickerMenu(preparedInput);
  }
  if (preparedInput.menu.variant === "ask_user") {
    return renderAskUserMenu(preparedInput);
  }
  if (preparedInput.menu.variant === "plan_approval") {
    return renderPlanApprovalMenu(preparedInput);
  }
  const mode = resolveCliRenderMode({
    stdinIsTTY: preparedInput.stdinIsTTY,
    stdoutIsTTY: preparedInput.stdoutIsTTY,
    env: preparedInput.env,
  });
  const theme = createCliTheme(mode);
  const columns = resolveMenuColumns();
  const surfaceWidth = Math.max(44, Math.min(86, columns - 4));
  const viewport = resolveRenderViewport(preparedInput.menu);
  const hideIndexes = preparedInput.menu.hideIndexes === true;
  const menuLayout = resolveMenuLayout(preparedInput.menu);
  const verticalLayout = menuLayout === "expanded" || menuLayout === "compact-vertical";
  const renderIndexes = !hideIndexes && menuLayout !== "expanded";
  const ordinalWidth = renderIndexes ? `${String(Math.max(1, viewport.totalCount))}.`.length : 0;
  const indexDigitsWidth = renderIndexes ? Math.max(1, ordinalWidth - 1) : 0;
  const hasDescriptionColumn =
    !verticalLayout
    && preparedInput.menu.inlineDescriptions !== true
    && shouldRenderMenuDescriptions(surfaceWidth);
  const labelBudget = resolveMenuLabelBudget({
    surfaceWidth,
    ordinalWidth,
    hasDescriptionColumn,
    hideIndexes: !renderIndexes,
  });
  const lines: string[] = [];
  lines.push(`  ${theme.bold(preparedInput.menu.title)}`);
  if (surfaceWidth >= 56 && preparedInput.menu.subtitle && preparedInput.menu.subtitle.trim().length > 0) {
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(preparedInput.menu.subtitle.trim(), surfaceWidth - 2))}`);
  }
  lines.push("");
  const rows: RenderMenuRow[] = [];
  for (let index = 0; index < preparedInput.menu.items.length; index += 1) {
    const item = preparedInput.menu.items[index];
    const isActive = index === preparedInput.activeIndex;
    const marker = resolveScrollAwareMarker({
      rowIndex: index,
      rowCount: preparedInput.menu.items.length,
      isActive,
      viewport,
      theme,
    });
    const ordinalPlain = `${String(resolveViewportOrdinal({ viewport, rowIndex: index }))}.`
      .padEnd(ordinalWidth);
    const number = !renderIndexes
      ? ""
      : isActive
        ? theme.color("accent", ordinalPlain)
        : theme.color("muted", ordinalPlain);
    const labelBase = resolveInputOptionDisplayText({
      item,
      isActive,
    });
    const descriptionPlain = sanitizeMenuText(item.description);
    const inlineDescription =
      preparedInput.menu.inlineDescriptions === true
      && descriptionPlain.length > 0;
    const labelPlain = inlineDescription ? `${labelBase} ${descriptionPlain}` : labelBase;
    const currentSuffix = item.current ? " ✓" : "";
    const labelParts = truncateMenuLabelWithSuffix({
      label: labelPlain,
      suffix: currentSuffix,
      maxWidth: labelBudget,
    });
    const label = isActive
      ? theme.color("accent", labelParts.plain)
      : `${labelParts.label}${labelParts.suffix ? theme.currentTag(labelParts.suffix) : ""}`;
    const prefixPlain = !renderIndexes
      ? `${marker.plain} `
      : `${marker.plain} ${ordinalPlain} `;
    const prefixRendered = !renderIndexes
      ? `${marker.rendered} `
      : `${marker.rendered} ${number} `;
    const verticalDescriptionIndentWidth = (() => {
      if (menuLayout === "expanded") {
        return 2;
      }
      if (menuLayout === "compact-vertical") {
        return hideIndexes ? 4 : indexDigitsWidth + 4;
      }
      return measureDisplayWidth(prefixPlain);
    })();
    rows.push({
      leftPlain: `${prefixPlain}${labelParts.plain}`,
      leftRendered: `${prefixRendered}${label}`,
      description: inlineDescription ? "" : verticalLayout || hasDescriptionColumn ? descriptionPlain : "",
      descriptionIndentWidth: verticalDescriptionIndentWidth,
    });
  }
  lines.push(...(verticalLayout
    ? renderVerticalRows({
      rows,
      maxWidth: surfaceWidth,
      theme,
      expanded: menuLayout === "expanded",
    })
    : renderTwoColumnRows({
      rows,
      maxWidth: surfaceWidth,
      theme,
    })));
  lines.push("");
  lines.push(theme.color("muted", `  ${buildCompactMenuHint(preparedInput.menu.hint)}`));
  return lines.join("\n");
}
