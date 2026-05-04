import { resolveCliRenderMode } from "../../kernel/render-mode";
import { createCliTheme } from "../../theme/ansi-theme";
import {
  measureDisplayWidth,
  truncateDisplayWidth,
} from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import {
  type RenderTerminalSelectMenuInput,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuModelPickerMeta,
} from "./contract";
import {
  ASK_USER_DIVIDER_MAX_WIDTH,
  MODEL_PICKER_CHECK,
  MODEL_PICKER_DEFAULT_HINT,
  MODEL_PICKER_DEFAULT_SUBTITLE,
  MODEL_PICKER_DIVIDER_MAX_WIDTH,
  PLAN_APPROVAL_DIVIDER_MAX_WIDTH,
  PLAN_APPROVAL_PLAN_DIVIDER,
  PLAN_APPROVAL_SURFACE_MAX_WIDTH,
  buildCompactMenuHint,
  prepareStandaloneRenderMenu,
  renderTwoColumnRows,
  renderVerticalRows,
  resolveInputOptionDisplayText,
  resolveMenuColumns,
  resolveMenuLabelBudget,
  resolveMenuLayout,
  resolveModelPickerMarker,
  resolveRenderViewport,
  resolveScrollAwareMarker,
  resolveViewportOrdinal,
  sanitizeMenuText,
  shouldRenderMenuDescriptions,
  truncateMenuLabelWithSuffix,
  type RenderMenuRow,
  type TruncatedMenuLabel,
} from "./render-helpers";

export type {
  RenderTerminalSelectMenuInput,
  TerminalSelectMenuInput,
  TerminalSelectMenuItem,
  TerminalSelectMenuLayout,
  TerminalSelectMenuModelPickerMeta,
  TerminalSelectMenuPlanApprovalMeta,
  TerminalSelectMenuResult,
  TerminalSelectMenuViewport,
} from "./contract";

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
  const title = sanitizeMenuText(input.menu.title, "选择");
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
      isActive,
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

  const hiddenCount = Math.max(0, viewport.totalCount - viewport.visibleCount);
  if (hiddenCount > 0) {
    lines.push(`   ${theme.color("muted", `and ${String(hiddenCount)} more…`)}`);
  }

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
      isActive,
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
  const title = sanitizeMenuText(input.menu.title, "准备开始实现？");
  const agentName = sanitizeMenuText(input.menu.planApprovalMeta?.agentName, "Grobot");
  const editorName = sanitizeMenuText(input.menu.planApprovalMeta?.editorName, "editor");
  const planContent = input.menu.planApprovalMeta?.planContent ?? "";
  const planPath = sanitizeTerminalDisplayText(input.menu.planApprovalMeta?.planPath ?? "").trim();
  const hintBase = sanitizeMenuText(input.menu.hint, "↑/↓ 选择 · Enter 确认 · Esc 返回输入框");
  const isEmptyPlanApproval =
    input.menu.planApprovalMeta?.emptyPlan === true || planContent.trim().length === 0;
  if (isEmptyPlanApproval) {
    const emptyTitle = input.menu.planApprovalMeta?.emptyPlan === true
      ? "退出 plan mode?"
      : sanitizeMenuText(input.menu.title, "退出 plan mode?");
    const lines: string[] = [];
    const optionLabelBudget = Math.max(12, surfaceWidth - 4);
    lines.push(theme.color("planMode", "─".repeat(dividerWidth)));
    lines.push(`  ${theme.bold(truncateDisplayWidth(emptyTitle, surfaceWidth))}`);
    lines.push(`  ${truncateDisplayWidth(`${agentName} 将退出 plan mode`, surfaceWidth)}`);
    lines.push("");
    for (let index = 0; index < input.menu.items.length; index += 1) {
      const item = input.menu.items[index];
      const isActive = index === input.activeIndex;
      const marker = isActive
        ? theme.color("planMode", "❯")
        : " ";
      const label = truncateDisplayWidth(
        sanitizeMenuText(item.label, item.id),
        optionLabelBudget,
      );
      const renderedLabel = isActive ? theme.color("planMode", label) : label;
      lines.push(`  ${marker} ${renderedLabel}`);
    }
    if (viewport.totalCount > input.menu.items.length) {
      lines.push(theme.color("muted", `  ${String(viewport.startIndex + 1)}-${String(viewport.startIndex + input.menu.items.length)} / ${String(viewport.totalCount)}`));
    }
    lines.push("");
    lines.push(theme.color("muted", `  ${truncateDisplayWidth(hintBase, surfaceWidth)}`));
    return lines.join("\n");
  }
  const subtitle = sanitizeMenuText(input.menu.subtitle, "执行前请确认计划。");
  const editHint = planPath.length > 0
    ? `Ctrl-G 编辑计划 · ${editorName} · ${planPath}`
    : `Ctrl-G 编辑计划 · ${editorName}`;
  const editHintWithSaveState = input.menu.planApprovalMeta?.planEdited
    ? `${editHint} · ✓ 计划已保存`
    : editHint;
  const planLines = planContent.length > 0 ? planContent.split(/\r?\n/) : ["未找到计划。"];
  const optionLabelBudget = Math.max(12, surfaceWidth - 4);
  const lines: string[] = [];
  const sectionDivider = theme.color("muted", PLAN_APPROVAL_PLAN_DIVIDER.repeat(surfaceWidth));

  lines.push(theme.color("planMode", "─".repeat(dividerWidth)));
  if (planPath.length > 0) {
    lines.push(theme.color("muted", `  ${truncateDisplayWidth(`计划文件: ${planPath}`, surfaceWidth)}`));
  }
  lines.push(`  ${theme.bold(truncateDisplayWidth(title, surfaceWidth))}`);
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(subtitle, surfaceWidth)}`));
  lines.push(sectionDivider);
  lines.push(`  ${agentName} 的计划：`);
  lines.push("");
  for (const rawLine of planLines) {
    const sanitizedLine = sanitizeTerminalDisplayText(rawLine).trimEnd();
    const renderedLine = sanitizedLine.length > 0
      ? truncateDisplayWidth(sanitizedLine, surfaceWidth - 2)
      : "";
    lines.push(`  ${renderedLine}`);
  }
  lines.push(sectionDivider);
  lines.push("");

  lines.push(theme.color("planMode", "─".repeat(dividerWidth)));
  lines.push(theme.color("muted", "  是否开始执行？"));
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
      fallbackPlaceholder: "输入反馈",
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
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(editHintWithSaveState, surfaceWidth)}`));
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(hintBase, surfaceWidth)}`));
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
      isActive,
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
