import {
  type AskUserQuestionnaireOptionItem,
  type AskUserQuestionnaireReviewItem,
  type AskUserQuestionnaireTab,
  type AskUserQuestionnaireView,
} from "../../../../tools/ask-user";
import {
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import { TERMINAL_SYMBOL, terminalStyle } from "../../theme/terminal-style";

export interface AskUserPanelScreenInput {
  view: AskUserQuestionnaireView;
  terminalColumns?: number;
  activeReviewIndex?: number;
  textInputValue?: string;
  planMode?: boolean;
  planFilePath?: string;
}

const ASK_USER_PANEL_MIN_WIDTH = 44;
const ASK_USER_PANEL_MAX_WIDTH = 96;
const ASK_USER_PANEL_ROW_DESCRIPTION_MIN_WIDTH = 20;
const ASK_USER_PANEL_ROW_DESCRIPTION_GAP = 2;
const ASK_USER_PANEL_TEXT_INPUT_PLACEHOLDER = "输入回复后按 Enter";

function normalizeColumns(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 80;
  }
  return Math.max(ASK_USER_PANEL_MIN_WIDTH, Math.floor(value));
}

function resolveSurfaceWidth(columnsRaw: number | undefined): number {
  const columns = normalizeColumns(columnsRaw);
  return Math.max(
    ASK_USER_PANEL_MIN_WIDTH,
    Math.min(ASK_USER_PANEL_MAX_WIDTH, columns - 4),
  );
}

function sanitizePanelText(value: string | undefined, fallback = ""): string {
  const sanitized = sanitizeTerminalDisplayText(value ?? fallback).trim().replace(/\s+/g, " ");
  return sanitized.length > 0 ? sanitized : fallback;
}

function fitPlainLine(value: string, maxWidth: number): string {
  return truncateDisplayWidth(sanitizePanelText(value), Math.max(1, maxWidth), {
    compact: true,
  });
}

function renderMutedRule(width: number): string {
  return terminalStyle.muted("─".repeat(Math.max(1, width)));
}

function renderPanelTitle(value: string, maxWidth: number): string {
  return terminalStyle.bold(fitPlainLine(value, maxWidth));
}

function renderFooterAction(shortcut: string, label: string, maxWidth: number): string {
  const key = `${shortcut}.`;
  const plain = `${key} ${label}`;
  const fitted = fitPlainLine(plain, maxWidth);
  if (!fitted.startsWith(key)) {
    return terminalStyle.muted(fitted);
  }
  return `${terminalStyle.muted(key)} ${terminalStyle.muted(fitted.slice(key.length + 1))}`;
}

function buildProgressText(view: Extract<AskUserQuestionnaireView, { kind: "question" }>): string {
  const unanswered = Math.max(0, view.totalCount - view.answeredCount);
  const base = `问题 ${String(view.currentQuestionNumber)}/${String(view.totalCount)}`;
  if (unanswered <= 0) {
    return base;
  }
  return `${base} (${String(unanswered)} 项未回答)`;
}

function renderOptionLabel(item: AskUserQuestionnaireOptionItem): string {
  if (item.kind === "other" && sanitizePanelText(item.label, item.id).toLowerCase() === "other") {
    return "自定义";
  }
  return sanitizePanelText(item.label, item.id);
}

function renderOtherPlaceholder(value: string | undefined): string {
  const placeholder = sanitizePanelText(value, "输入自定义回复");
  return placeholder.toLowerCase() === "type something." ? "输入自定义回复" : placeholder;
}

function renderTab(tab: AskUserQuestionnaireTab, activeSubmit: boolean): string {
  if (tab.status === "submit") {
    return "✓ 提交";
  }
  const answeredMarker = tab.status === "answered" ? "✓" : "□";
  const text = `${answeredMarker} ${sanitizePanelText(tab.label, `Q${String(tab.index + 1)}`)}`;
  if (tab.status === "current" || activeSubmit) {
    return `[${text}]`;
  }
  return text;
}

function buildNavigationText(input: {
  tabs: readonly AskUserQuestionnaireTab[];
  maxWidth: number;
  activeSubmit?: boolean;
}): string {
  if (input.tabs.length <= 0) {
    return "";
  }
  const renderedTabs = input.tabs.map((tab) =>
    renderTab(tab, Boolean(input.activeSubmit && tab.status === "submit")));
  const plain = `←  ${renderedTabs.join("  ")}  →`;
  return fitPlainLine(plain, input.maxWidth);
}

function renderNavigationLine(input: {
  tabs: readonly AskUserQuestionnaireTab[];
  maxWidth: number;
  activeSubmit?: boolean;
}): string | undefined {
  const plain = buildNavigationText(input);
  if (!plain) {
    return undefined;
  }
  const currentMatch = /\[[^\]]+\]/.exec(plain);
  if (!currentMatch) {
    return terminalStyle.muted(plain);
  }
  const before = plain.slice(0, currentMatch.index);
  const current = currentMatch[0] ?? "";
  const after = plain.slice(currentMatch.index + current.length);
  return `${terminalStyle.muted(before)}${terminalStyle.selected(current)}${terminalStyle.muted(after)}`;
}

function resolveOptionColumns(input: {
  items: readonly AskUserQuestionnaireOptionItem[];
  maxWidth: number;
}): { labelWidth: number; descriptionWidth: number; hasDescriptions: boolean } {
  const hasDescriptions = input.maxWidth >= 64
    && input.items.some((item) => sanitizePanelText(item.description).length > 0);
  if (!hasDescriptions) {
    return {
      labelWidth: input.maxWidth,
      descriptionWidth: 0,
      hasDescriptions: false,
    };
  }
  const labelWidths = input.items.map((item) => {
    const ordinal = `${String(item.optionIndex + 1)}.`;
    return measureDisplayWidth(`${TERMINAL_SYMBOL.pointer} ${ordinal} ${sanitizePanelText(item.label, item.id)}`);
  });
  const preferredLabelWidth = Math.max(12, Math.max(...labelWidths));
  const maxLabelWidth = Math.max(14, input.maxWidth - ASK_USER_PANEL_ROW_DESCRIPTION_MIN_WIDTH);
  const labelWidth = Math.min(preferredLabelWidth, maxLabelWidth);
  const descriptionWidth = Math.max(
    0,
    input.maxWidth - labelWidth - ASK_USER_PANEL_ROW_DESCRIPTION_GAP,
  );
  return {
    labelWidth,
    descriptionWidth,
    hasDescriptions: descriptionWidth >= ASK_USER_PANEL_ROW_DESCRIPTION_MIN_WIDTH,
  };
}

function renderOptionRows(input: {
  items: readonly AskUserQuestionnaireOptionItem[];
  activeOptionIndex: number;
  maxWidth: number;
}): string[] {
  if (input.items.length <= 0) {
    return [];
  }
  const columns = resolveOptionColumns({
    items: input.items,
    maxWidth: input.maxWidth,
  });
  return input.items.map((item, index) => {
    const active = index === input.activeOptionIndex || item.selected;
    const markerPlain = active ? TERMINAL_SYMBOL.pointer : " ";
    const ordinalPlain = `${String(item.optionIndex + 1)}.`;
    const labelPlain = renderOptionLabel(item);
    const otherInputPlain = item.kind === "other"
      ? sanitizePanelText(item.inputValue).length > 0
        ? sanitizePanelText(item.inputValue)
        : renderOtherPlaceholder(item.placeholder)
      : "";
    const leftBudget = columns.hasDescriptions
      ? columns.labelWidth
      : input.maxWidth;
    const otherSuffixWidth = item.kind === "other" && !columns.hasDescriptions
      ? Math.max(0, input.maxWidth - measureDisplayWidth(`${markerPlain} ${ordinalPlain} ${labelPlain}`) - 3)
      : 0;
    const labelBudget = item.kind === "other" && otherSuffixWidth > 0
      ? Math.max(1, leftBudget - otherSuffixWidth - 6)
      : Math.max(1, leftBudget - 4);
    const leftPlain = `${markerPlain} ${ordinalPlain} ${fitPlainLine(labelPlain, labelBudget)}`;
    const marker = active ? terminalStyle.pointer(markerPlain) : markerPlain;
    const ordinal = active ? terminalStyle.accent(ordinalPlain) : terminalStyle.muted(ordinalPlain);
    const labelText = fitPlainLine(labelPlain, labelBudget);
    const label = active ? terminalStyle.accent(labelText) : labelText;
    const leftRendered = `${marker} ${ordinal} ${label}`;
    if (item.kind === "other" && !columns.hasDescriptions) {
      const inputText = fitPlainLine(otherInputPlain, Math.max(1, otherSuffixWidth));
      const styledInput = sanitizePanelText(item.inputValue).length > 0
        ? terminalStyle.accent(inputText)
        : terminalStyle.muted(inputText);
      return `${leftRendered} ${styledInput}`;
    }
    if (!columns.hasDescriptions) {
      const description = sanitizePanelText(item.description);
      if (!description) {
        return leftRendered;
      }
      return `${leftRendered} ${terminalStyle.muted(fitPlainLine(description, Math.max(8, input.maxWidth - measureDisplayWidth(leftPlain) - 1)))}`;
    }
    const padded = padToDisplayWidth(leftRendered, columns.labelWidth + ASK_USER_PANEL_ROW_DESCRIPTION_GAP);
    const descriptionPlain = item.kind === "other"
      ? otherInputPlain
      : sanitizePanelText(item.description);
    const description = fitPlainLine(descriptionPlain, columns.descriptionWidth);
    const renderedDescription = item.kind === "other" && sanitizePanelText(item.inputValue).length > 0
      ? terminalStyle.accent(description)
      : terminalStyle.muted(description);
    return `${padded}${renderedDescription}`;
  });
}

function renderTextInputLine(input: {
  value?: string;
  sensitive?: boolean;
  maxWidth: number;
}): string {
  const rawValue = sanitizeTerminalDisplayText(input.value ?? "");
  const placeholder = ASK_USER_PANEL_TEXT_INPUT_PLACEHOLDER;
  if (rawValue.trim().length <= 0) {
    return `${terminalStyle.pointer(TERMINAL_SYMBOL.pointer)} ${terminalStyle.muted(placeholder)}`;
  }
  const available = Math.max(8, input.maxWidth - 2);
  const displayValue = input.sensitive ? "••••••" : rawValue;
  return `${terminalStyle.pointer(TERMINAL_SYMBOL.pointer)} ${fitPlainLine(displayValue, available)}`;
}

function renderNotesLine(input: {
  value?: string;
  active: boolean;
  maxWidth: number;
}): string {
  const label = terminalStyle.accent("备注:");
  const rawValue = sanitizeTerminalDisplayText(input.value ?? "");
  const displayValue = rawValue.trim().length > 0
    ? rawValue
    : "按 n 添加备注";
  const available = Math.max(8, input.maxWidth - measureDisplayWidth("备注:  "));
  const text = fitPlainLine(displayValue, available);
  const renderedValue = input.active || rawValue.trim().length > 0
    ? terminalStyle.accent(text)
    : terminalStyle.muted(text);
  const marker = input.active ? `${terminalStyle.pointer(TERMINAL_SYMBOL.pointer)} ` : "  ";
  return `${marker}${label} ${renderedValue}`;
}

function renderReviewRows(input: {
  reviewItems: readonly AskUserQuestionnaireReviewItem[];
  activeIndex: number;
  maxWidth: number;
}): string[] {
  const rows: Array<{ label: string; description: string }> = [{
    label: "提交答案",
    description: `已回答 ${String(input.reviewItems.filter((item) => item.answer?.trim()).length)}/${String(input.reviewItems.length)}`,
  }];
  for (let index = 0; index < input.reviewItems.length; index += 1) {
    const item = input.reviewItems[index];
    rows.push({
      label: `修改 ${String(index + 1)}. ${sanitizePanelText(item?.question, `Q${String(index + 1)}`)}`,
      description: sanitizePanelText(item?.answer) || "<未回答>",
    });
  }
  rows.push({
    label: "取消",
    description: "返回输入框，问题仍保留",
  });
  const labelWidth = Math.min(
    Math.max(14, ...rows.map((row) => measureDisplayWidth(row.label) + 4)),
    Math.max(14, input.maxWidth - ASK_USER_PANEL_ROW_DESCRIPTION_MIN_WIDTH),
  );
  const descriptionWidth = Math.max(8, input.maxWidth - labelWidth - ASK_USER_PANEL_ROW_DESCRIPTION_GAP);
  return rows.map((row, index) => {
    const active = index === input.activeIndex;
    const markerPlain = active ? TERMINAL_SYMBOL.pointer : " ";
    const labelPlain = fitPlainLine(row.label, Math.max(8, labelWidth - 4));
    const marker = active ? terminalStyle.pointer(markerPlain) : markerPlain;
    const label = active ? terminalStyle.accent(labelPlain) : labelPlain;
    const left = padToDisplayWidth(`${marker} ${label}`, labelWidth + ASK_USER_PANEL_ROW_DESCRIPTION_GAP);
    return `${left}${terminalStyle.muted(fitPlainLine(row.description, descriptionWidth))}`;
  });
}

function renderQuestionPanel(input: {
  view: Extract<AskUserQuestionnaireView, { kind: "question" }>;
  surfaceWidth: number;
  textInputValue?: string;
  planMode?: boolean;
  planFilePath?: string;
}): string[] {
  const lines: string[] = [];
  const contentWidth = input.surfaceWidth - 2;
  const progress = buildProgressText(input.view);
  if (input.planMode && input.planFilePath?.trim()) {
    lines.push(`  ${terminalStyle.muted(fitPlainLine(`计划文件: ${input.planFilePath}`, contentWidth))}`);
    lines.push(`  ${renderMutedRule(contentWidth)}`);
  }
  const navigationLine = renderNavigationLine({
    tabs: input.view.tabs,
    maxWidth: contentWidth,
  });
  if (navigationLine) {
    lines.push(`  ${navigationLine}`);
  }
  lines.push(`  ${renderPanelTitle(input.view.question, contentWidth)}`);
  lines.push(`  ${terminalStyle.muted(fitPlainLine(progress, contentWidth))}`);
  lines.push("");
  if (input.view.optionItems.length > 0) {
    lines.push(...renderOptionRows({
      items: input.view.optionItems,
      activeOptionIndex: input.view.activeOptionIndex,
      maxWidth: contentWidth,
    }).map((line) => `  ${line}`));
  } else {
    lines.push(`  ${renderTextInputLine({
      value: input.textInputValue,
      sensitive: input.view.isSecret,
      maxWidth: contentWidth,
    })}`);
    if (input.view.defaultAnswer && input.view.defaultAnswer.trim().length > 0) {
      lines.push(`  ${terminalStyle.muted(`默认：${fitPlainLine(input.view.defaultAnswer, contentWidth - 6)}`)}`);
    }
  }
  lines.push("");
  lines.push(`  ${renderNotesLine({
    value: input.view.noteValue,
    active: input.view.textInputMode === "notes",
    maxWidth: contentWidth,
  })}`);
  lines.push("");
  lines.push(`  ${renderMutedRule(contentWidth)}`);
  lines.push(`  ${renderFooterAction("c", "继续对话补充", contentWidth)}`);
  if (input.planMode) {
    lines.push(`  ${renderFooterAction("s", "跳过访谈，直接进入计划", contentWidth)}`);
  }
  lines.push("");
  const standardOptionCount = input.view.optionItems.filter((item) => item.kind === "option").length;
  const maxDirect = Math.min(standardOptionCount, 9);
  const directHint = maxDirect > 0
    ? ` · ${maxDirect > 1 ? `1-${String(maxDirect)}` : "1"} 直选 · 自定义输入`
    : "";
  const primaryHint = `Enter 确认${directHint} · Esc 返回输入框`;
  const actionHint = input.planMode ? " · c 对话 · s 跳过" : " · c 对话";
  const secondaryHint = input.view.totalCount > 1
    ? `↑/↓ 选择 · n 添加备注 · ←/→ 切换${actionHint}`
    : `↑/↓ 选择 · n 添加备注${actionHint}`;
  lines.push(`  ${terminalStyle.muted(fitPlainLine(primaryHint, contentWidth))}`);
  lines.push(`  ${terminalStyle.muted(fitPlainLine(secondaryHint, contentWidth))}`);
  return lines;
}

function renderReviewPanel(input: {
  view: Extract<AskUserQuestionnaireView, { kind: "review" }>;
  surfaceWidth: number;
  activeReviewIndex?: number;
}): string[] {
  const lines: string[] = [];
  const contentWidth = input.surfaceWidth - 2;
  lines.push(`  ${renderPanelTitle(input.view.title, contentWidth)}`);
  lines.push(`  ${terminalStyle.muted(`问题复核 (${String(input.view.unansweredCount)} 项未回答)`)}`);
  const navigationLine = renderNavigationLine({
    tabs: [],
    maxWidth: contentWidth,
    activeSubmit: true,
  });
  if (input.view.navigationText) {
    lines.push(`  ${terminalStyle.muted(fitPlainLine(input.view.navigationText, contentWidth))}`);
  } else if (navigationLine) {
    lines.push(`  ${navigationLine}`);
  }
  lines.push("");
  if (input.view.unansweredCount > 0) {
    lines.push(`  ${terminalStyle.muted(`还有 ${String(input.view.unansweredCount)} 项未回答；提交前会回到第一项未答。`)}`);
    lines.push("");
  }
  lines.push(...renderReviewRows({
    reviewItems: input.view.reviewItems,
    activeIndex: input.activeReviewIndex ?? 0,
    maxWidth: contentWidth,
  }).map((line) => `  ${line}`));
  lines.push("");
  lines.push(`  ${renderMutedRule(contentWidth)}`);
  lines.push(`  ${terminalStyle.muted("↑/↓ 选择 | Enter 确认 | ←/→ 切换问题 | Esc 返回输入框")}`);
  return lines;
}

export function renderAskUserPanelScreen(input: AskUserPanelScreenInput): string {
  const surfaceWidth = resolveSurfaceWidth(input.terminalColumns);
  const lines: string[] = [];
  lines.push(terminalStyle.brand("─".repeat(surfaceWidth)));
  if (input.view.kind === "empty") {
    lines.push(`  ${renderPanelTitle(input.view.title, surfaceWidth - 2)}`);
    lines.push("");
    lines.push(`  ${terminalStyle.muted(fitPlainLine(input.view.hint, surfaceWidth - 2))}`);
    return lines.join("\n");
  }
  if (input.view.kind === "review") {
    lines.push(...renderReviewPanel({
      view: input.view,
      surfaceWidth,
      activeReviewIndex: input.activeReviewIndex,
    }));
    return lines.join("\n");
  }
  lines.push(...renderQuestionPanel({
    view: input.view,
    surfaceWidth,
    textInputValue: input.textInputValue,
    planMode: input.planMode,
    planFilePath: input.planFilePath,
  }));
  return lines.join("\n");
}
