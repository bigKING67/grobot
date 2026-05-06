import React from "react";
import { createCliTheme } from "../theme/ansi-theme";
import { resolveCliRenderMode } from "../kernel/render-mode";
import {
  measureDisplayWidth,
  truncateDisplayWidth,
} from "../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../terminal/text-sanitizer";
import { Box, Text, renderStaticInk } from "./static-ink";
import {
  type RenderTerminalSelectMenuInput,
  type TerminalSelectMenuEffortLevel,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuModelPickerMeta,
  type TerminalSelectMenuSearchMeta,
} from "../components/select-menu/contract";
import {
  ASK_USER_DIVIDER_MAX_WIDTH,
  MODEL_PICKER_CHECK,
  MODEL_PICKER_DEFAULT_HINT,
  MODEL_PICKER_DEFAULT_SUBTITLE,
  MODEL_PICKER_DIVIDER_MAX_WIDTH,
  MODEL_PICKER_EFFORT_SYMBOL,
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
  shouldShowViewportScrollDown,
  shouldShowViewportScrollUp,
  shouldRenderMenuDescriptions,
  truncateMenuLabelWithSuffix,
  type RenderMenuRow,
  type TruncatedMenuLabel,
} from "../components/select-menu/render-helpers";

function capitalizeAscii(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function renderLineStack(lines: string[], theme: ReturnType<typeof createCliTheme>): string {
  return renderStaticInk(
    <Box flexDirection="column">
      {lines.map((renderedLine, index) => (
        <Text key={index}>{renderedLine}</Text>
      ))}
    </Box>,
    theme,
  );
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

function buildModelPickerContextLine(input: {
  meta?: TerminalSelectMenuModelPickerMeta;
  viewportTotalCount: number;
}): string {
  const meta = input.meta;
  const providerName = sanitizeMenuText(meta?.providerName, "");
  const totalModelCount =
    typeof meta?.totalModelCount === "number" && Number.isFinite(meta.totalModelCount)
      ? Math.max(0, Math.floor(meta.totalModelCount))
      : input.viewportTotalCount;
  const parts = [
    providerName.length > 0 ? `provider ${providerName}` : "",
    totalModelCount > 0 ? `${String(totalModelCount)} models` : "",
    "writes current config",
  ].filter((part) => part.length > 0);
  return parts.join(" · ");
}

function buildModelPickerHiddenCountLine(hiddenCount: number): string {
  return `and ${String(hiddenCount)} more...`;
}

function resolveMenuSearchMeta(input: RenderTerminalSelectMenuInput): TerminalSelectMenuSearchMeta | undefined {
  const search = input.menu.search;
  if (!search) {
    return undefined;
  }
  const query = sanitizeMenuText(search.query, "");
  const rawMatchedCount =
    typeof search.matchedCount === "number" && Number.isFinite(search.matchedCount)
      ? search.matchedCount
      : 0;
  const rawTotalCount =
    typeof search.totalCount === "number" && Number.isFinite(search.totalCount)
      ? search.totalCount
      : input.menu.items.length;
  const matchedCount = Math.max(0, Math.floor(rawMatchedCount));
  const totalCount = Math.max(
    matchedCount,
    Math.floor(rawTotalCount),
  );
  if (search.active !== true && query.length === 0) {
    return undefined;
  }
  return {
    active: search.active === true,
    query,
    matchedCount,
    totalCount,
  };
}

function buildMenuSearchStatusLine(input: {
  search: TerminalSelectMenuSearchMeta;
  maxWidth: number;
  theme: ReturnType<typeof createCliTheme>;
}): string {
  const query = sanitizeMenuText(input.search.query, "");
  const queryLabel = query.length > 0 ? query : "type to narrow";
  const line = `Filter: ${queryLabel}  matched ${String(input.search.matchedCount)}/${String(input.search.totalCount)}`;
  return `  ${input.theme.color("muted", truncateDisplayWidth(line, input.maxWidth - 2))}`;
}

function buildMenuNoMatchLine(input: {
  search: TerminalSelectMenuSearchMeta;
  maxWidth: number;
  theme: ReturnType<typeof createCliTheme>;
}): string {
  const query = sanitizeMenuText(input.search.query, "");
  const message = query.length > 0 ? `No matches for "${query}"` : "Type to filter";
  return `  ${input.theme.color("muted", truncateDisplayWidth(message, input.maxWidth - 2))}`;
}

function buildMenuFooterHint(input: {
  hint?: string;
  search?: TerminalSelectMenuSearchMeta;
  fallback?: string;
}): string {
  if (!input.search) {
    return input.fallback ?? buildCompactMenuHint(input.hint);
  }
  if (input.search.active) {
    return "Type to filter · Ctrl-U clear · Esc back";
  }
  if (input.search.query.length > 0) {
    return "Enter confirm · Ctrl-U clear · Esc clear";
  }
  return input.fallback ?? buildCompactMenuHint(input.hint);
}

function resolveSearchHighlightQuery(search?: TerminalSelectMenuSearchMeta): string {
  if (!search) {
    return "";
  }
  return sanitizeMenuText(search.query, "").trim();
}

function renderSearchHighlightedMenuLabel(input: {
  label: string;
  query: string;
  theme: ReturnType<typeof createCliTheme>;
}): string {
  if (input.query.length === 0 || input.label.length === 0) {
    return input.label;
  }
  const labelLower = input.label.toLowerCase();
  const queryLower = input.query.toLowerCase();
  if (queryLower.length === 0) {
    return input.label;
  }
  const parts: string[] = [];
  let offset = 0;
  let matchIndex = labelLower.indexOf(queryLower, offset);
  if (matchIndex === -1) {
    return input.label;
  }
  while (matchIndex !== -1) {
    if (matchIndex > offset) {
      parts.push(input.label.slice(offset, matchIndex));
    }
    const match = input.label.slice(matchIndex, matchIndex + input.query.length);
    parts.push(input.theme.color("accent", input.theme.bold(match)));
    offset = matchIndex + input.query.length;
    matchIndex = labelLower.indexOf(queryLower, offset);
  }
  if (offset < input.label.length) {
    parts.push(input.label.slice(offset));
  }
  return parts.join("");
}

function normalizeEffortLevel(
  value: TerminalSelectMenuEffortLevel | undefined,
): TerminalSelectMenuEffortLevel | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }
  return undefined;
}

function buildModelPickerEffortLine(input: {
  meta?: TerminalSelectMenuModelPickerMeta;
  focusedModelName?: string;
}): string {
  const meta = input.meta;
  if (!meta) {
    return "";
  }
  const hasEffortMeta =
    meta.effortSupported !== undefined
    || meta.effortLevel !== undefined
    || meta.effortDefaultLevel !== undefined
    || meta.effortAdjustHint !== undefined;
  if (!hasEffortMeta) {
    return "";
  }
  const effortSupported = meta.effortSupported !== false;
  const focusedModelName = sanitizeMenuText(input.focusedModelName, "");
  if (!effortSupported) {
    return `${MODEL_PICKER_EFFORT_SYMBOL.low} Effort not supported${focusedModelName.length > 0 ? ` for ${focusedModelName}` : ""}`;
  }
  const effortLevel = normalizeEffortLevel(meta.effortLevel)
    ?? normalizeEffortLevel(meta.effortDefaultLevel)
    ?? "high";
  const defaultEffortLevel = normalizeEffortLevel(meta.effortDefaultLevel);
  const defaultSuffix = defaultEffortLevel === effortLevel ? " (default)" : "";
  const hint = sanitizeMenuText(meta.effortAdjustHint, "← → to adjust");
  return `${MODEL_PICKER_EFFORT_SYMBOL[effortLevel]} ${capitalizeAscii(effortLevel)} effort${defaultSuffix}  ${hint}`;
}

function renderModelPickerLabel(input: {
  isActive: boolean;
  isCurrent: boolean;
  labelParts: TruncatedMenuLabel;
  highlightQuery: string;
  theme: ReturnType<typeof createCliTheme>;
}): string {
  if (input.isCurrent) {
    const label = input.isActive
      ? input.theme.color("accent", input.labelParts.label)
      : renderSearchHighlightedMenuLabel({
        label: input.labelParts.label,
        query: input.highlightQuery,
        theme: input.theme,
      });
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
  const label = renderSearchHighlightedMenuLabel({
    label: input.labelParts.label,
    query: input.highlightQuery,
    theme: input.theme,
  });
  return `${label}${suffix}`;
}

function resolveRenderContext(input: RenderTerminalSelectMenuInput): {
  theme: ReturnType<typeof createCliTheme>;
  columns: number;
} {
  const mode = resolveCliRenderMode({
    stdinIsTTY: input.stdinIsTTY,
    stdoutIsTTY: input.stdoutIsTTY,
    env: input.env,
  });
  return {
    theme: createCliTheme(mode),
    columns: resolveMenuColumns(input.terminalColumns),
  };
}

function renderModelPickerMenu(input: RenderTerminalSelectMenuInput): string {
  const { theme, columns } = resolveRenderContext(input);
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
  const search = resolveMenuSearchMeta(input);
  const highlightQuery = resolveSearchHighlightQuery(search);

  lines.push("");
  lines.push(theme.color("brand", "─".repeat(dividerWidth)));
  lines.push(theme.color("brand", theme.bold(`  ${title}`)));
  if (surfaceWidth >= 56 && subtitle.length > 0) {
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(subtitle, surfaceWidth - 2))}`);
  }
  if (search) {
    lines.push(buildMenuSearchStatusLine({ search, maxWidth: surfaceWidth, theme }));
  }
  lines.push("");

  const rows: RenderMenuRow[] = [];
  for (let index = 0; index < visibleItems.length; index += 1) {
    const item = visibleItems[index]!;
    const isActive = index === input.activeIndex;
    const marker = resolveModelPickerMarker({
      isActive,
      showScrollUp: shouldShowViewportScrollUp({ rowIndex: index, viewport }),
      showScrollDown: shouldShowViewportScrollDown({
        rowIndex: index,
        visibleLength: visibleItems.length,
        viewport,
      }),
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
      highlightQuery,
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
  if (rows.length === 0 && search) {
    lines.push(buildMenuNoMatchLine({ search, maxWidth: surfaceWidth, theme }));
  } else {
    lines.push(...renderTwoColumnRows({
      rows,
      maxWidth: surfaceWidth,
      theme,
    }));
  }

  const hiddenCount = Math.max(0, viewport.totalCount - viewport.visibleCount);
  if (hiddenCount > 0) {
    lines.push(`   ${theme.color("muted", buildModelPickerHiddenCountLine(hiddenCount))}`);
  }

  const activeItem = visibleItems[input.activeIndex];
  const effortLine = buildModelPickerEffortLine({
    meta,
    focusedModelName: activeItem?.label ?? activeItem?.id,
  });
  if (effortLine.length > 0) {
    lines.push("");
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(effortLine, surfaceWidth - 2))}`);
  }

  const contextLine = buildModelPickerContextLine({
    meta,
    viewportTotalCount: viewport.totalCount,
  });
  if (contextLine.length > 0 && surfaceWidth >= 56) {
    lines.push("");
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(contextLine, surfaceWidth - 2))}`);
  }

  lines.push("");
  lines.push(theme.color("muted", `  ${buildMenuFooterHint({ hint, search, fallback: hint })}`));
  return renderLineStack(lines, theme);
}

function renderAskUserMenu(input: RenderTerminalSelectMenuInput): string {
  const { theme, columns } = resolveRenderContext(input);
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
  const title = sanitizeMenuText(input.menu.title, "Confirmation needed");
  const subtitle = sanitizeMenuText(input.menu.subtitle);
  const hint = sanitizeMenuText(input.menu.hint, "↑/↓ select · Enter confirm · Esc back to input");
  const search = resolveMenuSearchMeta(input);
  const highlightQuery = resolveSearchHighlightQuery(search);
  const lines: string[] = [];

  lines.push(theme.color("brand", "─".repeat(dividerWidth)));
  lines.push(`  ${theme.color("brand", theme.bold(title))}`);
  if (surfaceWidth >= 56 && subtitle.length > 0) {
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(subtitle, surfaceWidth - 2))}`);
  }
  if (search) {
    lines.push(buildMenuSearchStatusLine({ search, maxWidth: surfaceWidth, theme }));
  }
  lines.push("");

  const rows: RenderMenuRow[] = [];
  for (let index = 0; index < input.menu.items.length; index += 1) {
    const item = input.menu.items[index]!;
    const isActive = index === input.activeIndex;
    const marker = resolveModelPickerMarker({
      isActive,
      showScrollUp: shouldShowViewportScrollUp({ rowIndex: index, viewport }),
      showScrollDown: shouldShowViewportScrollDown({
        rowIndex: index,
        visibleLength: input.menu.items.length,
        viewport,
      }),
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
      : `${renderSearchHighlightedMenuLabel({
        label: labelParts.label,
        query: highlightQuery,
        theme,
      })}${labelParts.suffix ? theme.currentTag(labelParts.suffix) : ""}`;
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
  if (rows.length === 0 && search) {
    lines.push(buildMenuNoMatchLine({ search, maxWidth: surfaceWidth, theme }));
  } else {
    lines.push(...renderTwoColumnRows({
      rows,
      maxWidth: surfaceWidth,
      theme,
    }));
  }

  lines.push("");
  lines.push(theme.color("muted", `  ${buildMenuFooterHint({ hint, search, fallback: hint })}`));
  return renderLineStack(lines, theme);
}

function renderPlanApprovalMenu(input: RenderTerminalSelectMenuInput): string {
  const { theme, columns } = resolveRenderContext(input);
  const surfaceWidth = Math.max(48, Math.min(PLAN_APPROVAL_SURFACE_MAX_WIDTH, columns - 4));
  const dividerWidth = Math.max(48, Math.min(PLAN_APPROVAL_DIVIDER_MAX_WIDTH, columns));
  const viewport = resolveRenderViewport(input.menu);
  const title = sanitizeMenuText(input.menu.title, "Ready to implement?");
  const agentName = sanitizeMenuText(input.menu.planApprovalMeta?.agentName, "Grobot");
  const editorName = sanitizeMenuText(input.menu.planApprovalMeta?.editorName, "editor");
  const planContent = input.menu.planApprovalMeta?.planContent ?? "";
  const planPath = sanitizeTerminalDisplayText(input.menu.planApprovalMeta?.planPath ?? "").trim();
  const hintBase = sanitizeMenuText(input.menu.hint, "↑/↓ select · Enter confirm · Esc back to input");
  const isEmptyPlanApproval =
    input.menu.planApprovalMeta?.emptyPlan === true || planContent.trim().length === 0;
  if (isEmptyPlanApproval) {
    const emptyTitle = input.menu.planApprovalMeta?.emptyPlan === true
      ? "Exit plan mode?"
      : sanitizeMenuText(input.menu.title, "Exit plan mode?");
    const lines: string[] = [];
    const optionLabelBudget = Math.max(12, surfaceWidth - 4);
    lines.push(theme.color("planMode", "─".repeat(dividerWidth)));
    lines.push(`  ${theme.bold(truncateDisplayWidth(emptyTitle, surfaceWidth))}`);
    lines.push(`  ${truncateDisplayWidth(`${agentName} will exit plan mode`, surfaceWidth)}`);
    lines.push("");
    for (let index = 0; index < input.menu.items.length; index += 1) {
      const item = input.menu.items[index]!;
      const isActive = index === input.activeIndex;
      const marker = isActive ? theme.color("planMode", "❯") : " ";
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
    return renderLineStack(lines, theme);
  }

  const subtitle = sanitizeMenuText(input.menu.subtitle, "Confirm the plan before execution.");
  const editHint = planPath.length > 0
    ? `Ctrl-G edit plan · ${editorName} · ${planPath}`
    : `Ctrl-G edit plan · ${editorName}`;
  const editHintWithSaveState = input.menu.planApprovalMeta?.planEdited
    ? `✓ Plan saved · ${editHint}`
    : editHint;
  const planLines = planContent.length > 0 ? planContent.split(/\r?\n/) : ["Plan not found."];
  const optionLabelBudget = Math.max(12, surfaceWidth - 4);
  const lines: string[] = [];
  const sectionDivider = theme.color("muted", PLAN_APPROVAL_PLAN_DIVIDER.repeat(surfaceWidth));

  lines.push(theme.color("planMode", "─".repeat(dividerWidth)));
  if (planPath.length > 0) {
    lines.push(theme.color("muted", `  ${truncateDisplayWidth(`Plan file ${planPath}`, surfaceWidth)}`));
  }
  lines.push(`  ${theme.bold(truncateDisplayWidth(title, surfaceWidth))}`);
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(subtitle, surfaceWidth)}`));
  lines.push(sectionDivider);
  lines.push(`  ${agentName}'s plan:`);
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
  lines.push(theme.color("muted", "  Start execution?"));
  lines.push("");

  for (let index = 0; index < input.menu.items.length; index += 1) {
    const item = input.menu.items[index]!;
    const isActive = index === input.activeIndex;
    const marker = isActive ? theme.color("planMode", "❯") : " ";
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
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(editHintWithSaveState, surfaceWidth)}`));
  lines.push(theme.color("muted", `  ${truncateDisplayWidth(hintBase, surfaceWidth)}`));
  return renderLineStack(lines, theme);
}

function renderDefaultMenu(input: RenderTerminalSelectMenuInput): string {
  const { theme, columns } = resolveRenderContext(input);
  const surfaceWidth = Math.max(44, Math.min(86, columns - 4));
  const viewport = resolveRenderViewport(input.menu);
  const hideIndexes = input.menu.hideIndexes === true;
  const menuLayout = resolveMenuLayout(input.menu);
  const verticalLayout = menuLayout === "expanded" || menuLayout === "compact-vertical";
  const renderIndexes = !hideIndexes && menuLayout !== "expanded";
  const ordinalWidth = renderIndexes ? `${String(Math.max(1, viewport.totalCount))}.`.length : 0;
  const indexDigitsWidth = renderIndexes ? Math.max(1, ordinalWidth - 1) : 0;
  const hasDescriptionColumn =
    !verticalLayout
    && input.menu.inlineDescriptions !== true
    && shouldRenderMenuDescriptions(surfaceWidth);
  const labelBudget = resolveMenuLabelBudget({
    surfaceWidth,
    ordinalWidth,
    hasDescriptionColumn,
    hideIndexes: !renderIndexes,
  });
  const lines: string[] = [];
  const search = resolveMenuSearchMeta(input);
  const highlightQuery = resolveSearchHighlightQuery(search);
  lines.push(`  ${theme.bold(input.menu.title)}`);
  if (surfaceWidth >= 56 && input.menu.subtitle && input.menu.subtitle.trim().length > 0) {
    lines.push(`  ${theme.color("muted", truncateDisplayWidth(input.menu.subtitle.trim(), surfaceWidth - 2))}`);
  }
  if (search) {
    lines.push(buildMenuSearchStatusLine({ search, maxWidth: surfaceWidth, theme }));
  }
  lines.push("");
  const rows: RenderMenuRow[] = [];
  for (let index = 0; index < input.menu.items.length; index += 1) {
    const item = input.menu.items[index]!;
    const isActive = index === input.activeIndex;
    const marker = resolveScrollAwareMarker({
      isActive,
      showScrollUp: shouldShowViewportScrollUp({ rowIndex: index, viewport }),
      showScrollDown: shouldShowViewportScrollDown({
        rowIndex: index,
        visibleLength: input.menu.items.length,
        viewport,
      }),
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
      input.menu.inlineDescriptions === true && descriptionPlain.length > 0;
    const labelPlain = inlineDescription ? `${labelBase} ${descriptionPlain}` : labelBase;
    const currentSuffix = item.current ? " ✓" : "";
    const labelParts = truncateMenuLabelWithSuffix({
      label: labelPlain,
      suffix: currentSuffix,
      maxWidth: labelBudget,
    });
    const label = isActive
      ? theme.color("accent", labelParts.plain)
      : `${renderSearchHighlightedMenuLabel({
        label: labelParts.label,
        query: highlightQuery,
        theme,
      })}${labelParts.suffix ? theme.currentTag(labelParts.suffix) : ""}`;
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
  if (rows.length === 0 && search) {
    lines.push(buildMenuNoMatchLine({ search, maxWidth: surfaceWidth, theme }));
  } else {
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
  }
  lines.push("");
  lines.push(theme.color("muted", `  ${buildMenuFooterHint({
    hint: input.menu.hint,
    search,
  })}`));
  return renderLineStack(lines, theme);
}

export function renderReactTerminalSelectMenu(input: RenderTerminalSelectMenuInput): string {
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
  return renderDefaultMenu(preparedInput);
}
