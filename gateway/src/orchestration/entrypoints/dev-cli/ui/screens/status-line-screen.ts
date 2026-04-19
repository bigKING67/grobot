export interface StatusLinePromptInput {
  model: string;
  projectFolder: string;
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
  sessionId: string;
  sessionTopic?: string;
  terminalColumns?: number;
  promptLabel?: string;
  config?: StatusLineConfigInput;
}

const DEFAULT_PROMPT_LABEL = "› ";
const SESSION_SHORT_ID_LEN = 8;
const ELLIPSIS = "...";
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;
const COMBINING_MARK_PATTERN = /\p{Mark}/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const ANSI_RESET = "\u001B[0m";
const ANSI_DIM = "\u001B[90m";
const ANSI_CCLINE_MODEL = "\u001B[96m";
const ANSI_CCLINE_PROJECT = "\u001B[92m";
const ANSI_CCLINE_CONTEXT = "\u001B[95m";
const ANSI_CCLINE_TOKENS = "\u001B[93m";
const ANSI_CCLINE_SESSION = "\u001B[94m";
const PROMPT_BLOCK_MIN_INNER_WIDTH = 32;

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

const CJK_WIDTH_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x3247],
  [0x3250, 0x4dbf],
  [0x4e00, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

const GRAPHEME_SEGMENTER = (
  Intl as unknown as {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity?: "grapheme" | "word" | "sentence" },
    ) => { segment(input: string): Iterable<{ segment: string }> };
  }
).Segmenter
  ? new (
    Intl as unknown as {
      Segmenter: new (
        locales?: string | string[],
        options?: { granularity?: "grapheme" | "word" | "sentence" },
      ) => { segment(input: string): Iterable<{ segment: string }> };
    }
  ).Segmenter(undefined, { granularity: "grapheme" })
  : undefined;

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

function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitGraphemes(value: string): string[] {
  if (GRAPHEME_SEGMENTER) {
    const segments: string[] = [];
    for (const part of GRAPHEME_SEGMENTER.segment(value)) {
      segments.push(part.segment);
    }
    return segments;
  }
  return Array.from(value);
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function isWideCodePoint(codePoint: number): boolean {
  for (const [start, end] of CJK_WIDTH_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

function getGraphemeDisplayWidth(grapheme: string): number {
  if (!grapheme) {
    return 0;
  }
  if (EMOJI_PATTERN.test(grapheme)) {
    return 2;
  }
  let width = 0;
  for (const char of Array.from(grapheme)) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") {
      continue;
    }
    if ((codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      continue;
    }
    if (COMBINING_MARK_PATTERN.test(char) || codePoint === 0x200d || codePoint === 0xfe0f) {
      continue;
    }
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function measureDisplayWidth(value: string): number {
  const normalized = stripAnsi(value);
  let width = 0;
  for (const grapheme of splitGraphemes(normalized)) {
    width += getGraphemeDisplayWidth(grapheme);
  }
  return width;
}

function truncateDisplayWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  const normalized = compactSpaces(value);
  if (!normalized) {
    return "";
  }
  const fullWidth = measureDisplayWidth(normalized);
  if (fullWidth <= maxWidth) {
    return normalized;
  }
  const ellipsisWidth = measureDisplayWidth(ELLIPSIS);
  if (maxWidth <= ellipsisWidth) {
    const segments = splitGraphemes(normalized);
    let output = "";
    let usedWidth = 0;
    for (const grapheme of segments) {
      const nextWidth = getGraphemeDisplayWidth(grapheme);
      if (usedWidth + nextWidth > maxWidth) {
        break;
      }
      output += grapheme;
      usedWidth += nextWidth;
    }
    return output;
  }
  const targetWidth = maxWidth - ellipsisWidth;
  let output = "";
  let usedWidth = 0;
  for (const grapheme of splitGraphemes(normalized)) {
    const nextWidth = getGraphemeDisplayWidth(grapheme);
    if (usedWidth + nextWidth > targetWidth) {
      break;
    }
    output += grapheme;
    usedWidth += nextWidth;
  }
  return `${output}${ELLIPSIS}`;
}

function truncateText(value: string, maxWidth: number): string {
  const normalized = compactSpaces(value);
  if (maxWidth <= 0) {
    return "";
  }
  return truncateDisplayWidth(normalized, maxWidth);
}

function formatTokenCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "n/a";
  }
  const normalized = Math.round(value);
  if (normalized >= 1000) {
    return `${(normalized / 1000).toFixed(1)}k`;
  }
  return String(normalized);
}

function formatContextUsage(value: number | undefined): string {
  const ratio = clampRatio(value);
  if (typeof ratio !== "number") {
    return "n/a";
  }
  return `${Math.round(ratio * 100)}%`;
}

function formatSessionShortId(sessionId: string): string {
  const normalized = compactSpaces(sessionId);
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
    context: "ctx",
    tokens: "tok",
    session: "",
  };
  const plainCompact: Record<StatusLineSegmentId, string> = {
    model: "",
    project: "",
    context: "ctx",
    tokens: "tok",
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
  segments: string[];
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
    context: formatContextUsage(input.prompt.contextWindowUsageRatio),
    tokens:
      `${formatTokenCount(input.prompt.estimatedTokens)}/${formatTokenCount(input.prompt.targetTokenLimit)}`,
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
    return applyStatusSegmentThemeColor(
      input.config.theme,
      segmentId,
      rendered,
    );
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
  const separator = input.config.theme === "ccline"
    ? `${ANSI_DIM}${input.config.separator}${ANSI_RESET}`
    : input.config.separator;
  return {
    line: segments.segments.join(separator),
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

function buildPromptBlock(input: {
  statusLine: string;
  promptLabel: string;
  terminalColumns?: number;
}): {
  topBorder: string;
  promptLine: string;
} {
  const terminalColumns =
    typeof input.terminalColumns === "number"
    && Number.isFinite(input.terminalColumns)
      ? Math.floor(input.terminalColumns)
      : 0;
  const statusWidth = measureDisplayWidth(input.statusLine);
  const promptWidth = Math.max(2, measureDisplayWidth(input.promptLabel) + 2);
  let innerWidth = Math.max(PROMPT_BLOCK_MIN_INNER_WIDTH, statusWidth, promptWidth);
  if (terminalColumns > 0) {
    innerWidth = Math.min(innerWidth, Math.max(8, terminalColumns - 2));
  }
  return {
    topBorder: `${ANSI_DIM}╭${"─".repeat(innerWidth)}╮${ANSI_RESET}`,
    promptLine: `${ANSI_DIM}│${ANSI_RESET} ${input.promptLabel}`,
  };
}

export function renderStatusLinePrompt(input: StatusLinePromptInput): string {
  const promptLabel = input.promptLabel ?? DEFAULT_PROMPT_LABEL;
  const config = normalizeStatusLineConfig(input.config);
  if (!config.enabled) {
    return promptLabel;
  }
  const statusLine = fitStatusLine({
    prompt: input,
    config,
  });
  const warningLine = buildWarningLine({
    prompt: input,
    config,
  });
  if (!warningLine) {
    const promptBlock = buildPromptBlock({
      statusLine,
      promptLabel,
      terminalColumns: input.terminalColumns,
    });
    return `${statusLine}\n${promptBlock.topBorder}\n${promptBlock.promptLine}`;
  }
  const terminalColumns =
    typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
      ? Math.floor(input.terminalColumns)
      : 0;
  const warningToRender =
    terminalColumns > 0
      ? truncateDisplayWidth(warningLine, terminalColumns)
      : warningLine;
  const promptBlock = buildPromptBlock({
    statusLine,
    promptLabel,
    terminalColumns: input.terminalColumns,
  });
  return `${statusLine}\n${warningToRender}\n${promptBlock.topBorder}\n${promptBlock.promptLine}`;
}
