import {
  compactSpaces,
  measureDisplayWidth as measureDisplayWidthInternal,
  splitGraphemes,
  stripAnsi,
  truncateDisplayWidth,
} from "../../terminal/display-width";
import { renderReactStatusLineLines } from "../../react/status-line";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import {
  STATUS_LINE_TEMPLATE_FALLBACKS,
  STATUS_LINE_TEMPLATES,
  type StatusLineConfig,
  type StatusLineLayoutMode,
  type StatusLinePromptInput,
  type StatusLinePromptParts,
  type StatusLineSegmentId,
  type StatusLineTemplateConfig,
  type StatusLineTemplateId,
  type StatusLineTheme,
} from "./contract";
import { normalizeStatusLineConfig } from "./reducer";

export const measureDisplayWidth = measureDisplayWidthInternal;

const SESSION_SHORT_ID_LEN = 8;
const ANSI_RESET = "\u001B[0m";
const ANSI_DIM = "\u001B[90m";
const ANSI_CCLINE_MODEL = "\u001B[96m";
const ANSI_CCLINE_PROJECT = "\u001B[92m";
const ANSI_CCLINE_CONTEXT = "\u001B[95m";
const ANSI_CCLINE_TOKENS = "\u001B[93m";
const ANSI_CCLINE_SESSION = "\u001B[94m";
const ANSI_PLAN_MODE = "\u001B[38;2;72;150;140m";
const PLAN_MODE_SYMBOL = "⏸";

function clampRatio(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function truncateText(value: string, maxWidth: number): string {
  const normalized = compactSpaces(sanitizeDisplayLabel(value));
  if (maxWidth <= 0) {
    return "";
  }
  return truncateDisplayWidth(normalized, maxWidth);
}

function sanitizeDisplayLabel(value: string): string {
  return sanitizeTerminalDisplayText(value);
}

function formatWindowTokenCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "n/a";
  }
  const normalized = Math.max(1, Math.floor(value));
  if (normalized >= 1000) {
    return `${String(Math.round(normalized / 1000))}K`;
  }
  return String(normalized);
}

function resolveContextLeftPercent(input: {
  contextWindowUsageRatio?: number;
  contextWindowTokens?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
}): number | undefined {
  const preferredWindow =
    typeof input.contextWindowTokens === "number" &&
    Number.isFinite(input.contextWindowTokens) &&
    input.contextWindowTokens > 0
      ? input.contextWindowTokens
      : typeof input.targetTokenLimit === "number" &&
          Number.isFinite(input.targetTokenLimit) &&
          input.targetTokenLimit > 0
        ? input.targetTokenLimit
        : undefined;
  let ratio: number | undefined;
  if (
    typeof input.estimatedTokens === "number" &&
    Number.isFinite(input.estimatedTokens) &&
    input.estimatedTokens >= 0 &&
    typeof preferredWindow === "number" &&
    preferredWindow > 0
  ) {
    ratio = input.estimatedTokens / preferredWindow;
  } else {
    ratio = clampRatio(input.contextWindowUsageRatio);
  }
  if (typeof ratio !== "number") {
    return undefined;
  }
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  return Math.round((1 - boundedRatio) * 100);
}

function formatContextLeft(input: {
  contextWindowUsageRatio?: number;
  contextWindowTokens?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
}): string {
  const leftPercent = resolveContextLeftPercent(input);
  if (typeof leftPercent !== "number") {
    return "n/a 剩余";
  }
  return `剩余 ${String(leftPercent)}%`;
}

function formatWindowUsage(input: {
  compact: boolean;
  contextWindowTokens?: number;
  targetTokenLimit?: number;
}): string {
  const windowTokens =
    typeof input.contextWindowTokens === "number" &&
    Number.isFinite(input.contextWindowTokens) &&
    input.contextWindowTokens > 0
      ? input.contextWindowTokens
      : input.targetTokenLimit;
  const windowLabel = formatWindowTokenCount(windowTokens);
  return input.compact ? `${windowLabel} win` : `${windowLabel} window`;
}

function formatSessionShortId(sessionId: string): string {
  const normalized = compactSpaces(sanitizeDisplayLabel(sessionId));
  if (normalized.length === 0) {
    return "<none>";
  }
  const chars = splitGraphemes(normalized);
  if (chars.length <= SESSION_SHORT_ID_LEN) {
    return normalized;
  }
  return chars.slice(0, SESSION_SHORT_ID_LEN).join("");
}

function resolveTemplateByWidth(terminalColumns: number): StatusLineTemplateId {
  if (terminalColumns >= 140) {
    return "wide";
  }
  if (terminalColumns >= 108) {
    return "medium";
  }
  if (terminalColumns >= 82) {
    return "compact";
  }
  if (terminalColumns >= 62) {
    return "minimal";
  }
  return "tiny";
}

function resolveTemplate(
  layoutMode: StatusLineLayoutMode,
  terminalColumns: number,
): StatusLineTemplateId {
  if (layoutMode === "full") {
    return "wide";
  }
  if (layoutMode === "compact") {
    return terminalColumns >= 62 ? "compact" : "tiny";
  }
  return resolveTemplateByWidth(terminalColumns);
}

function resolveTemplateSegmentIds(input: {
  orderedEnabledSegments: StatusLineSegmentId[];
  template: StatusLineTemplateConfig;
}): StatusLineSegmentId[] {
  const { orderedEnabledSegments, template } = input;
  if (orderedEnabledSegments.length === 0) {
    return ["session"];
  }
  if (template.id === "wide" || template.id === "medium") {
    return orderedEnabledSegments;
  }
  if (template.id === "compact") {
    return orderedEnabledSegments.slice(0, template.maxSegments);
  }
  if (template.id === "minimal") {
    const minimalPreferredOrder: StatusLineSegmentId[] = [
      "context",
      "tokens",
      "session",
    ];
    const selectedPreferred = minimalPreferredOrder
      .filter((id) => orderedEnabledSegments.includes(id))
      .slice(0, template.maxSegments);
    if (selectedPreferred.length >= 2) {
      return selectedPreferred;
    }
    return orderedEnabledSegments.slice(0, template.maxSegments);
  }
  if (template.id === "tiny") {
    const tinyPreferredOrder: StatusLineSegmentId[] = [
      "context",
      "tokens",
      "session",
    ];
    const selectedPreferred = tinyPreferredOrder
      .filter((id) => orderedEnabledSegments.includes(id))
      .slice(0, template.maxSegments);
    if (selectedPreferred.length > 0) {
      return selectedPreferred;
    }
  }
  return [orderedEnabledSegments[0]];
}

function resolveStatusSegmentLabel(input: {
  segmentId: StatusLineSegmentId;
  compact: boolean;
  theme: StatusLineTheme;
}): string {
  const plainFull: Record<StatusLineSegmentId, string> = {
    model: "",
    project: "",
    context: "上下文",
    tokens: "",
    session: "",
  };
  const plainCompact: Record<StatusLineSegmentId, string> = {
    model: "",
    project: "",
    context: "ctx",
    tokens: "",
    session: "",
  };
  const nerdFull: Record<StatusLineSegmentId, string> = {
    model: "󰭻",
    project: "󰉋",
    context: "󰋼",
    tokens: "󰌪",
    session: "󱂬",
  };
  const nerdCompact: Record<StatusLineSegmentId, string> = {
    model: "󰭻",
    project: "󰉋",
    context: "󰋼",
    tokens: "󰌪",
    session: "󱂬",
  };
  const cclineLabels: Record<StatusLineSegmentId, string> = {
    model: "🤖",
    project: "📁",
    context: "⚡️",
    tokens: "📊",
    session: "⏱️",
  };
  if (input.theme === "ccline") {
    return cclineLabels[input.segmentId];
  }
  if (input.theme === "nerd_font") {
    return input.compact
      ? nerdCompact[input.segmentId]
      : nerdFull[input.segmentId];
  }
  return input.compact
    ? plainCompact[input.segmentId]
    : plainFull[input.segmentId];
}

function applyStatusSegmentThemeColor(
  theme: StatusLineTheme,
  segmentId: StatusLineSegmentId,
  value: string,
): string {
  if (theme !== "ccline") {
    return value;
  }
  const color =
    segmentId === "model"
      ? ANSI_CCLINE_MODEL
      : segmentId === "project"
        ? ANSI_CCLINE_PROJECT
        : segmentId === "context"
          ? ANSI_CCLINE_CONTEXT
          : segmentId === "tokens"
            ? ANSI_CCLINE_TOKENS
            : ANSI_CCLINE_SESSION;
  return `${color}${value}${ANSI_RESET}`;
}

function buildStatusSegments(input: {
  prompt: StatusLinePromptInput;
  config: StatusLineConfig;
  template: StatusLineTemplateConfig;
}): {
  segments: Array<{
    id: StatusLineSegmentId;
    value: string;
  }>;
  sessionShortId: string;
} {
  const modelWidth = input.template.compactLabels ? 14 : 28;
  const projectWidth = input.template.compactLabels ? 10 : 20;
  const sessionShortId = formatSessionShortId(input.prompt.sessionId);
  const sessionTopic = truncateText(
    input.prompt.sessionTopic ?? "",
    input.config.sessionTopicMaxWidth,
  );
  const sessionText =
    input.template.includeSessionTopic && sessionTopic.length > 0
      ? `${sessionShortId} (${sessionTopic})`
      : sessionShortId;
  const valueMap: Record<StatusLineSegmentId, string> = {
    model: truncateText(input.prompt.model, modelWidth) || "<unset>",
    project: truncateText(input.prompt.projectFolder, projectWidth) || "<none>",
    context: formatContextLeft({
      contextWindowUsageRatio: input.prompt.contextWindowUsageRatio,
      contextWindowTokens: input.prompt.contextWindowTokens,
      estimatedTokens: input.prompt.estimatedTokens,
      targetTokenLimit: input.prompt.targetTokenLimit,
    }),
    tokens: formatWindowUsage({
      compact: input.template.compactLabels,
      contextWindowTokens: input.prompt.contextWindowTokens,
      targetTokenLimit: input.prompt.targetTokenLimit,
    }),
    session: sessionText,
  };
  const orderedEnabledSegments = input.config.segmentOrder.filter(
    (segmentId) => input.config.segments[segmentId],
  );
  const templateSegmentIds = resolveTemplateSegmentIds({
    orderedEnabledSegments,
    template: input.template,
  });
  const segments = templateSegmentIds.map((segmentId) => {
    const label = resolveStatusSegmentLabel({
      segmentId,
      compact: input.template.compactLabels,
      theme: input.config.theme,
    });
    const rendered =
      label.length === 0 ? valueMap[segmentId] : `${label} ${valueMap[segmentId]}`;
    return {
      id: segmentId,
      value: applyStatusSegmentThemeColor(
        input.config.theme,
        segmentId,
        rendered,
      ),
    };
  });
  return {
    segments,
    sessionShortId,
  };
}

function renderTemplateStatusLine(input: {
  prompt: StatusLinePromptInput;
  config: StatusLineConfig;
  templateId: StatusLineTemplateId;
}): { line: string; sessionShortId: string } {
  const template = STATUS_LINE_TEMPLATES[input.templateId];
  const segments = buildStatusSegments({
    prompt: input.prompt,
    config: input.config,
    template,
  });
  const defaultSeparator =
    input.config.theme === "ccline"
      ? `${ANSI_DIM}${input.config.separator}${ANSI_RESET}`
      : input.config.separator;
  const line = segments.segments.reduce((acc, segment, index) => {
    if (index === 0) {
      return segment.value;
    }
    return `${acc}${defaultSeparator}${segment.value}`;
  }, "");
  return {
    line,
    sessionShortId: segments.sessionShortId,
  };
}

function fitStatusLine(input: {
  prompt: StatusLinePromptInput;
  config: StatusLineConfig;
}): string {
  const terminalColumns =
    typeof input.prompt.terminalColumns === "number" &&
    Number.isFinite(input.prompt.terminalColumns)
      ? Math.floor(input.prompt.terminalColumns)
      : 0;
  const baseTemplate = resolveTemplate(input.config.layoutMode, terminalColumns);
  const fallbackTemplates = STATUS_LINE_TEMPLATE_FALLBACKS[baseTemplate];
  for (const templateId of fallbackTemplates) {
    const rendered = renderTemplateStatusLine({
      prompt: input.prompt,
      config: input.config,
      templateId,
    });
    if (
      terminalColumns <= 0 ||
      measureDisplayWidth(rendered.line) <= terminalColumns
    ) {
      return rendered.line;
    }
  }
  const tinyLine = renderTemplateStatusLine({
    prompt: input.prompt,
    config: input.config,
    templateId: "tiny",
  });
  if (terminalColumns > 0) {
    return truncateDisplayWidth(tinyLine.line, terminalColumns);
  }
  return tinyLine.line;
}

function buildWarningLine(input: {
  prompt: StatusLinePromptInput;
  config: StatusLineConfig;
}): string | undefined {
  const ratio = clampRatio(input.prompt.contextWindowUsageRatio);
  if (typeof ratio !== "number") {
    return undefined;
  }
  if (ratio < input.config.warningThresholdRatio) {
    return undefined;
  }
  const level =
    ratio >= input.config.criticalThresholdRatio ? "critical" : "warning";
  const icon = input.config.theme === "nerd_font" ? "" : "!";
  return `${icon} context ${Math.round(ratio * 100)}% (${level})`;
}

function buildActivityLine(input: {
  prompt: StatusLinePromptInput;
  config: StatusLineConfig;
}): string | undefined {
  const activityText = compactSpaces(input.prompt.activityText ?? "");
  if (!activityText) {
    return undefined;
  }
  const icon = input.config.theme === "nerd_font" ? "" : "~";
  return `${icon} ${activityText}`;
}

function resolvePlanModeBadge(input: {
  prompt: StatusLinePromptInput;
}): string | undefined {
  if (!input.prompt.planMode) {
    return undefined;
  }
  const label = compactSpaces(input.prompt.planModeLabel ?? "plan mode");
  if (!label) {
    return undefined;
  }
  return `${ANSI_PLAN_MODE}${PLAN_MODE_SYMBOL} ${label}${ANSI_RESET}`;
}

function applyPlanModeBadge(input: {
  statusLine: string;
  prompt: StatusLinePromptInput;
  config: StatusLineConfig;
}): string {
  const badge = resolvePlanModeBadge({
    prompt: input.prompt,
  });
  if (!badge) {
    return input.statusLine;
  }
  const separator =
    input.config.theme === "ccline"
      ? `${ANSI_DIM}${input.config.separator}${ANSI_RESET}`
      : input.config.separator;
  if (measureDisplayWidth(input.statusLine) <= 0) {
    return badge;
  }
  // Match the reference TUI footer: active modes are a left-side mode pill,
  // not a low-visibility suffix after the model/context status.
  const withBadge = `${badge}${separator}${input.statusLine}`;
  const terminalColumns =
    typeof input.prompt.terminalColumns === "number" &&
    Number.isFinite(input.prompt.terminalColumns)
      ? Math.floor(input.prompt.terminalColumns)
      : 0;
  if (
    terminalColumns > 0 &&
    measureDisplayWidth(withBadge) > terminalColumns
  ) {
    const reservedWidth =
      measureDisplayWidth(separator) + measureDisplayWidth(badge);
    const statusWidth = terminalColumns - reservedWidth;
    if (statusWidth <= 0) {
      return measureDisplayWidth(badge) <= terminalColumns
        ? badge
        : truncateDisplayWidth(stripAnsi(badge), terminalColumns);
    }
    const compactStatusLine = truncateDisplayWidth(
      stripAnsi(input.statusLine),
      statusWidth,
    );
    if (!compactStatusLine) {
      return measureDisplayWidth(badge) <= terminalColumns
        ? badge
        : truncateDisplayWidth(stripAnsi(badge), terminalColumns);
    }
    return `${badge}${separator}${ANSI_DIM}${compactStatusLine}${ANSI_RESET}`;
  }
  return withBadge;
}

export function resolveStatusLinePromptParts(
  input: StatusLinePromptInput,
): StatusLinePromptParts {
  const config = normalizeStatusLineConfig(input.config);
  if (!config.enabled) {
    return {
      statusLine: resolvePlanModeBadge({ prompt: input }) ?? "",
    };
  }
  const statusLine = fitStatusLine({
    prompt: input,
    config,
  });
  const statusLineWithPlanMode = applyPlanModeBadge({
    statusLine,
    prompt: input,
    config,
  });
  const warningLine = buildWarningLine({
    prompt: input,
    config,
  });
  const activityLine = buildActivityLine({
    prompt: input,
    config,
  });
  const terminalColumns =
    typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
      ? Math.floor(input.terminalColumns)
      : 0;
  const warningToRender = warningLine
    ? terminalColumns > 0
      ? truncateDisplayWidth(warningLine, terminalColumns)
      : warningLine
    : undefined;
  const activityToRender = activityLine
    ? terminalColumns > 0
      ? truncateDisplayWidth(activityLine, terminalColumns)
      : activityLine
    : undefined;
  return {
    statusLine: statusLineWithPlanMode,
    warningLine: warningToRender,
    activityLine: activityToRender,
  };
}

export function renderStatusLinePrompt(input: StatusLinePromptInput): string {
  const parts = resolveStatusLinePromptParts(input);
  return renderReactStatusLineLines({
    lines: [parts.statusLine, parts.warningLine ?? "", parts.activityLine ?? ""],
    terminalColumns: input.terminalColumns,
  });
}
