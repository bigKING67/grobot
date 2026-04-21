import {
  compactSpaces,
  measureDisplayWidth as measureDisplayWidthInternal,
  splitGraphemes,
  truncateDisplayWidth,
} from "../interactive/display-width";

export const measureDisplayWidth = measureDisplayWidthInternal;

export interface StatusLinePromptInput {
  model: string;
  projectFolder: string;
  contextWindowUsageRatio?: number;
  contextWindowTokens?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
  sessionId: string;
  sessionTopic?: string;
  planMode?: boolean;
  planModeLabel?: string;
  terminalColumns?: number;
  activityText?: string;
  promptLabel?: string;
  config?: StatusLineConfigInput;
}

const SESSION_SHORT_ID_LEN = 8;
const ANSI_RESET = "\u001B[0m";
const ANSI_DIM = "\u001B[90m";
const ANSI_CCLINE_MODEL = "\u001B[96m";
const ANSI_CCLINE_PROJECT = "\u001B[92m";
const ANSI_CCLINE_CONTEXT = "\u001B[95m";
const ANSI_CCLINE_TOKENS = "\u001B[93m";
const ANSI_CCLINE_SESSION = "\u001B[94m";
const ANSI_PLAN_MODE = "\u001B[95m";
export type StatusLineLayoutMode = "adaptive" | "full" | "compact";
export type StatusLineTheme = "plain" | "nerd_font" | "ccline";
export type StatusLineSegmentId =
  | "model"
  | "project"
  | "context"
  | "tokens"
  | "session";

export interface StatusLineConfig {
  enabled: boolean;
  layoutMode: StatusLineLayoutMode;
  theme: StatusLineTheme;
  separator: string;
  segmentOrder: StatusLineSegmentId[];
  segments: Record<StatusLineSegmentId, boolean>;
  warningThresholdRatio: number;
  criticalThresholdRatio: number;
  budgetSnapshotCacheTtlMs: number;
  sessionTopicCacheTtlMs: number;
  sessionTopicMaxWidth: number;
}

export interface StatusLineConfigInput {
  enabled?: boolean;
  layoutMode?: string;
  theme?: string;
  separator?: string;
  segmentOrder?: string[];
  segments?: Partial<Record<StatusLineSegmentId, boolean>>;
  warningThresholdRatio?: number;
  criticalThresholdRatio?: number;
  budgetSnapshotCacheTtlMs?: number;
  sessionTopicCacheTtlMs?: number;
  sessionTopicMaxWidth?: number;
}

const STATUS_LINE_SEGMENT_IDS: StatusLineSegmentId[] = [
  "model",
  "project",
  "context",
  "tokens",
  "session",
];

const DEFAULT_STATUS_LINE_SEGMENTS: Record<StatusLineSegmentId, boolean> = {
  model: true,
  project: true,
  context: true,
  tokens: true,
  session: true,
};

const DEFAULT_STATUS_LINE_SEGMENT_ORDER: StatusLineSegmentId[] = [
  "model",
  "project",
  "context",
  "tokens",
  "session",
];

export const DEFAULT_STATUS_LINE_CONFIG: StatusLineConfig = {
  enabled: true,
  layoutMode: "adaptive",
  theme: "plain",
  separator: " · ",
  segmentOrder: [...DEFAULT_STATUS_LINE_SEGMENT_ORDER],
  segments: { ...DEFAULT_STATUS_LINE_SEGMENTS },
  warningThresholdRatio: 0.8,
  criticalThresholdRatio: 0.9,
  budgetSnapshotCacheTtlMs: 2_500,
  sessionTopicCacheTtlMs: 1_500,
  sessionTopicMaxWidth: 42,
};

type StatusLineTemplateId =
  | "wide"
  | "medium"
  | "compact"
  | "minimal"
  | "tiny";

interface StatusLineTemplateConfig {
  id: StatusLineTemplateId;
  compactLabels: boolean;
  includeSessionTopic: boolean;
  maxSegments: number;
}

const STATUS_LINE_TEMPLATES: Record<StatusLineTemplateId, StatusLineTemplateConfig> = {
  wide: {
    id: "wide",
    compactLabels: false,
    includeSessionTopic: true,
    maxSegments: 5,
  },
  medium: {
    id: "medium",
    compactLabels: false,
    includeSessionTopic: false,
    maxSegments: 5,
  },
  compact: {
    id: "compact",
    compactLabels: true,
    includeSessionTopic: false,
    maxSegments: 4,
  },
  minimal: {
    id: "minimal",
    compactLabels: true,
    includeSessionTopic: false,
    maxSegments: 3,
  },
  tiny: {
    id: "tiny",
    compactLabels: true,
    includeSessionTopic: false,
    maxSegments: 1,
  },
};

const STATUS_LINE_TEMPLATE_FALLBACKS: Record<StatusLineTemplateId, StatusLineTemplateId[]> = {
  wide: ["wide", "medium", "compact", "minimal", "tiny"],
  medium: ["medium", "compact", "minimal", "tiny"],
  compact: ["compact", "minimal", "tiny"],
  minimal: ["minimal", "tiny"],
  tiny: ["tiny"],
};

function isStatusLineSegmentId(value: string): value is StatusLineSegmentId {
  return STATUS_LINE_SEGMENT_IDS.includes(value as StatusLineSegmentId);
}

function normalizeSegmentOrder(
  segmentOrder: string[] | undefined,
): StatusLineSegmentId[] {
  const normalized: StatusLineSegmentId[] = [];
  if (Array.isArray(segmentOrder)) {
    for (const item of segmentOrder) {
      if (!isStatusLineSegmentId(item) || normalized.includes(item)) {
        continue;
      }
      normalized.push(item);
    }
  }
  for (const segmentId of DEFAULT_STATUS_LINE_SEGMENT_ORDER) {
    if (!normalized.includes(segmentId)) {
      normalized.push(segmentId);
    }
  }
  return normalized;
}

function clampRatioBound(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function normalizePositiveInt(
  value: number | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded < bounds.min) {
    return bounds.min;
  }
  if (rounded > bounds.max) {
    return bounds.max;
  }
  return rounded;
}

function normalizeLayoutMode(value: string | undefined): StatusLineLayoutMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "full" || normalized === "compact" || normalized === "adaptive") {
    return normalized;
  }
  return DEFAULT_STATUS_LINE_CONFIG.layoutMode;
}

function normalizeTheme(value: string | undefined): StatusLineTheme {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "plain"
    || normalized === "nerd_font"
    || normalized === "nerd-font"
    || normalized === "ccline"
    || normalized === "cometix"
  ) {
    if (normalized === "ccline" || normalized === "cometix") {
      return "ccline";
    }
    return normalized === "nerd-font" ? "nerd_font" : normalized;
  }
  return DEFAULT_STATUS_LINE_CONFIG.theme;
}

export function normalizeStatusLineConfig(
  input?: StatusLineConfigInput,
): StatusLineConfig {
  const warningThresholdRatio = clampRatioBound(
    input?.warningThresholdRatio,
    DEFAULT_STATUS_LINE_CONFIG.warningThresholdRatio,
  );
  const criticalThresholdRatio = clampRatioBound(
    input?.criticalThresholdRatio,
    DEFAULT_STATUS_LINE_CONFIG.criticalThresholdRatio,
  );
  const segments: Record<StatusLineSegmentId, boolean> = {
    model: input?.segments?.model ?? DEFAULT_STATUS_LINE_SEGMENTS.model,
    project: input?.segments?.project ?? DEFAULT_STATUS_LINE_SEGMENTS.project,
    context: input?.segments?.context ?? DEFAULT_STATUS_LINE_SEGMENTS.context,
    tokens: input?.segments?.tokens ?? DEFAULT_STATUS_LINE_SEGMENTS.tokens,
    session: input?.segments?.session ?? DEFAULT_STATUS_LINE_SEGMENTS.session,
  };
  return {
    enabled: input?.enabled ?? DEFAULT_STATUS_LINE_CONFIG.enabled,
    layoutMode: normalizeLayoutMode(input?.layoutMode),
    theme: normalizeTheme(input?.theme),
    separator:
      typeof input?.separator === "string" && input.separator.length > 0
        ? input.separator
        : DEFAULT_STATUS_LINE_CONFIG.separator,
    segmentOrder: normalizeSegmentOrder(input?.segmentOrder),
    segments,
    warningThresholdRatio,
    criticalThresholdRatio: Math.max(criticalThresholdRatio, warningThresholdRatio),
    budgetSnapshotCacheTtlMs: normalizePositiveInt(
      input?.budgetSnapshotCacheTtlMs,
      DEFAULT_STATUS_LINE_CONFIG.budgetSnapshotCacheTtlMs,
      { min: 250, max: 120_000 },
    ),
    sessionTopicCacheTtlMs: normalizePositiveInt(
      input?.sessionTopicCacheTtlMs,
      DEFAULT_STATUS_LINE_CONFIG.sessionTopicCacheTtlMs,
      { min: 250, max: 120_000 },
    ),
    sessionTopicMaxWidth: normalizePositiveInt(
      input?.sessionTopicMaxWidth,
      DEFAULT_STATUS_LINE_CONFIG.sessionTopicMaxWidth,
      { min: 8, max: 160 },
    ),
  };
}

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

function isDisallowedStatusChar(charCode: number): boolean {
  return (
    charCode <= 0x1f
    || charCode === 0x7f
    || charCode === 0x00ad
    || charCode === 0x034f
    || charCode === 0x061c
    || charCode === 0x180e
    || (charCode >= 0x200b && charCode <= 0x200f)
    || (charCode >= 0x202a && charCode <= 0x202e)
    || (charCode >= 0x2060 && charCode <= 0x206f)
    || (charCode >= 0xfe00 && charCode <= 0xfe0f)
    || charCode === 0xfeff
    || (charCode >= 0xfff9 && charCode <= 0xfffb)
  );
}

function sanitizeDisplayLabel(value: string): string {
  if (!value) {
    return "";
  }
  let result = "";
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint === "number" && isDisallowedStatusChar(codePoint)) {
      continue;
    }
    result += char;
  }
  return result;
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
  const preferredWindow = typeof input.contextWindowTokens === "number"
    && Number.isFinite(input.contextWindowTokens)
    && input.contextWindowTokens > 0
    ? input.contextWindowTokens
    : typeof input.targetTokenLimit === "number"
      && Number.isFinite(input.targetTokenLimit)
      && input.targetTokenLimit > 0
      ? input.targetTokenLimit
      : undefined;
  let ratio: number | undefined;
  if (
    typeof input.estimatedTokens === "number"
    && Number.isFinite(input.estimatedTokens)
    && input.estimatedTokens >= 0
    && typeof preferredWindow === "number"
    && preferredWindow > 0
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
    return "n/a left";
  }
  return `${String(leftPercent)}% left`;
}

function formatWindowUsage(input: {
  compact: boolean;
  contextWindowTokens?: number;
  targetTokenLimit?: number;
}): string {
  const windowTokens = typeof input.contextWindowTokens === "number"
    && Number.isFinite(input.contextWindowTokens)
    && input.contextWindowTokens > 0
    ? input.contextWindowTokens
    : input.targetTokenLimit;
  const windowLabel = formatWindowTokenCount(windowTokens);
  return input.compact
    ? `${windowLabel} win`
    : `${windowLabel} window`;
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
    const minimalPreferredOrder: StatusLineSegmentId[] = ["context", "tokens", "session"];
    const selectedPreferred = minimalPreferredOrder
      .filter((id) => orderedEnabledSegments.includes(id))
      .slice(0, template.maxSegments);
    if (selectedPreferred.length >= 2) {
      return selectedPreferred;
    }
    return orderedEnabledSegments.slice(0, template.maxSegments);
  }
  if (orderedEnabledSegments.includes("session")) {
    return ["session"];
  }
  return [orderedEnabledSegments[0]];
}

function resolveStatusSegmentLabel(
  input: {
    segmentId: StatusLineSegmentId;
    compact: boolean;
    theme: StatusLineTheme;
  },
): string {
  const plainFull: Record<StatusLineSegmentId, string> = {
    model: "",
    project: "",
    context: "Context",
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
    return input.compact ? nerdCompact[input.segmentId] : nerdFull[input.segmentId];
  }
  return input.compact ? plainCompact[input.segmentId] : plainFull[input.segmentId];
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
  const sessionText = input.template.includeSessionTopic && sessionTopic.length > 0
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
  const orderedEnabledSegments = input.config.segmentOrder
    .filter((segmentId) => input.config.segments[segmentId]);
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
    const rendered = label.length === 0
      ? valueMap[segmentId]
      : `${label} ${valueMap[segmentId]}`;
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
  const defaultSeparator = input.config.theme === "ccline"
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
    typeof input.prompt.terminalColumns === "number"
    && Number.isFinite(input.prompt.terminalColumns)
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
    if (terminalColumns <= 0 || measureDisplayWidth(rendered.line) <= terminalColumns) {
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

function buildWarningLine(
  input: {
    prompt: StatusLinePromptInput;
    config: StatusLineConfig;
  },
): string | undefined {
  const ratio = clampRatio(input.prompt.contextWindowUsageRatio);
  if (typeof ratio !== "number") {
    return undefined;
  }
  if (ratio < input.config.warningThresholdRatio) {
    return undefined;
  }
  const level = ratio >= input.config.criticalThresholdRatio ? "critical" : "warning";
  const icon = input.config.theme === "nerd_font" ? "" : "!";
  return `${icon} context ${Math.round(ratio * 100)}% (${level})`;
}

function buildActivityLine(
  input: {
    prompt: StatusLinePromptInput;
    config: StatusLineConfig;
  },
): string | undefined {
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
  const label = compactSpaces(input.prompt.planModeLabel ?? "Plan mode");
  if (!label) {
    return undefined;
  }
  return `${ANSI_PLAN_MODE}${label}${ANSI_RESET}`;
}

function appendPlanModeBadge(input: {
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
  const separator = input.config.theme === "ccline"
    ? `${ANSI_DIM}${input.config.separator}${ANSI_RESET}`
    : input.config.separator;
  const withBadge = `${input.statusLine}${separator}${badge}`;
  const terminalColumns =
    typeof input.prompt.terminalColumns === "number" && Number.isFinite(input.prompt.terminalColumns)
      ? Math.floor(input.prompt.terminalColumns)
      : 0;
  if (terminalColumns > 0 && measureDisplayWidth(withBadge) > terminalColumns) {
    return input.statusLine;
  }
  return withBadge;
}

export function renderStatusLinePrompt(input: StatusLinePromptInput): string {
  const config = normalizeStatusLineConfig(input.config);
  if (!config.enabled) {
    return "";
  }
  const statusLine = fitStatusLine({
    prompt: input,
    config,
  });
  const statusLineWithPlanMode = appendPlanModeBadge({
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
  const lines: string[] = [statusLineWithPlanMode];
  if (warningToRender) {
    lines.push(warningToRender);
  }
  if (activityToRender) {
    lines.push(activityToRender);
  }
  return lines.join("\n");
}
