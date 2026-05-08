import { readFileSync } from "node:fs";
import {
  DEFAULT_STATUS_LINE_CONFIG,
  STATUS_LINE_SEGMENT_IDS,
  type StatusLineConfigInput,
  type StatusLineLayoutMode,
  type StatusLineSegmentId,
  type StatusLineTheme,
} from "../../tui/components/status-line/contract";
import {
  parsePercentageAsRatio,
  parseTomlBoolean,
  parseTomlInteger,
  parseTomlNumber,
  parseTomlString,
  parseTomlStringRaw,
  stripInlineComment,
} from "./toml";

const STATUS_LINE_LAYOUT_MODES: readonly StatusLineLayoutMode[] = [
  "adaptive",
  "full",
  "compact",
];
const STATUS_LINE_THEME_ALIASES: Record<string, StatusLineTheme> = {
  plain: "plain",
  nerd_font: "nerd_font",
  "nerd-font": "nerd_font",
  ccline: "ccline",
  cometix: "ccline",
};
const STATUS_LINE_SOURCE_PROJECT_TOML = "project_toml";
const STATUS_LINE_CACHE_TTL_MIN_MS = 250;
const STATUS_LINE_CACHE_TTL_MAX_MS = 120_000;
const STATUS_LINE_SESSION_TOPIC_MAX_WIDTH_MIN = 8;
const STATUS_LINE_SESSION_TOPIC_MAX_WIDTH_MAX = 160;

export class StatusLineConfigInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "StatusLineConfigInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isStatusLineConfigInputError(
  error: unknown,
): error is StatusLineConfigInputError {
  return error instanceof StatusLineConfigInputError;
}

function throwStatusLineConfigError(
  field: string,
  detail: string,
  source = STATUS_LINE_SOURCE_PROJECT_TOML,
): never {
  throw new StatusLineConfigInputError(field, `${detail} (source=${source})`);
}

function readStatusLineBoolean(raw: string, field: string): boolean {
  const parsed = parseTomlBoolean(raw);
  if (typeof parsed !== "boolean") {
    throwStatusLineConfigError(field, `${field} must be boolean`);
  }
  return parsed;
}

function readStatusLineString(raw: string, field: string): string {
  const parsed = parseTomlString(raw);
  if (typeof parsed !== "string") {
    throwStatusLineConfigError(field, `${field} must be a string`);
  }
  if (parsed.length === 0) {
    throwStatusLineConfigError(field, `${field} must not be empty`);
  }
  return parsed;
}

function readStatusLineRawString(raw: string, field: string): string {
  const parsed = parseTomlStringRaw(raw);
  if (typeof parsed !== "string") {
    throwStatusLineConfigError(field, `${field} must be a string`);
  }
  if (parsed.length === 0) {
    throwStatusLineConfigError(field, `${field} must not be empty`);
  }
  return parsed;
}

function normalizeStatusLineLayoutMode(raw: string): StatusLineLayoutMode {
  const normalized = raw.trim().toLowerCase();
  if (
    STATUS_LINE_LAYOUT_MODES.includes(normalized as StatusLineLayoutMode)
  ) {
    return normalized as StatusLineLayoutMode;
  }
  throwStatusLineConfigError(
    "statusline-layout-mode",
    "statusline-layout-mode must be adaptive, full, or compact",
  );
}

function normalizeStatusLineTheme(raw: string): StatusLineTheme {
  const normalized = raw.trim().toLowerCase();
  const theme = STATUS_LINE_THEME_ALIASES[normalized];
  if (theme) {
    return theme;
  }
  throwStatusLineConfigError(
    "statusline-theme",
    "statusline-theme must be plain, nerd_font, nerd-font, ccline, or cometix",
  );
}

function isStatusLineSegmentId(value: string): value is StatusLineSegmentId {
  return STATUS_LINE_SEGMENT_IDS.includes(value as StatusLineSegmentId);
}

function parseStrictTomlStringArray(raw: string, field: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throwStatusLineConfigError(field, `${field} must be an array of strings`);
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    throwStatusLineConfigError(field, `${field} must not be empty`);
  }
  const values: string[] = [];
  for (const token of content.split(",")) {
    const part = token.trim();
    const match = part.match(/^"([^"]*)"$/);
    if (!match || typeof match[1] !== "string") {
      throwStatusLineConfigError(field, `${field} must be an array of strings`);
    }
    const value = match[1].trim();
    if (!value) {
      throwStatusLineConfigError(field, `${field} values must not be empty`);
    }
    values.push(value);
  }
  return values;
}

function readStatusLineSegmentOrder(raw: string): StatusLineSegmentId[] {
  const values = parseStrictTomlStringArray(
    raw,
    "statusline-segment-order",
  );
  const seen = new Set<StatusLineSegmentId>();
  const segmentOrder: StatusLineSegmentId[] = [];
  for (const value of values) {
    if (!isStatusLineSegmentId(value)) {
      throwStatusLineConfigError(
        "statusline-segment-order",
        "statusline-segment-order values must be model, project, context, tokens, or session",
      );
    }
    if (seen.has(value)) {
      throwStatusLineConfigError(
        "statusline-segment-order",
        "statusline-segment-order values must be unique",
      );
    }
    seen.add(value);
    segmentOrder.push(value);
  }
  return segmentOrder;
}

function readStatusLineRatio(raw: string, field: string): number {
  const parsed = parseTomlNumber(raw);
  if (typeof parsed !== "number" || parsed < 0 || parsed > 1) {
    throwStatusLineConfigError(
      field,
      `${field} must be a number between 0 and 1`,
    );
  }
  return parsed;
}

function readStatusLinePercent(raw: string, field: string): number {
  const parsedPercent = parseTomlNumber(raw);
  if (
    typeof parsedPercent !== "number" ||
    parsedPercent < 0 ||
    parsedPercent > 100
  ) {
    throwStatusLineConfigError(
      field,
      `${field} must be a number between 0 and 100`,
    );
  }
  const ratio = parsePercentageAsRatio(raw);
  if (typeof ratio !== "number") {
    throwStatusLineConfigError(
      field,
      `${field} must be a number between 0 and 100`,
    );
  }
  return ratio;
}

function readStatusLineIntegerRange(input: {
  raw: string;
  field: string;
  min: number;
  max: number;
}): number {
  const parsed = parseTomlInteger(input.raw);
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < input.min ||
    parsed > input.max
  ) {
    throwStatusLineConfigError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
    );
  }
  return parsed;
}

function assertStatusLineThresholdOrder(
  statusLineConfig: StatusLineConfigInput,
): void {
  const warningThresholdRatio =
    statusLineConfig.warningThresholdRatio ??
    DEFAULT_STATUS_LINE_CONFIG.warningThresholdRatio;
  const criticalThresholdRatio =
    statusLineConfig.criticalThresholdRatio ??
    DEFAULT_STATUS_LINE_CONFIG.criticalThresholdRatio;
  if (warningThresholdRatio > criticalThresholdRatio) {
    throwStatusLineConfigError(
      "statusline-critical-threshold-ratio",
      "statusline-warning-threshold-ratio must be less than or equal to statusline-critical-threshold-ratio",
    );
  }
}

export function readStatusLineConfigFromProjectToml(
  projectTomlPath?: string,
): StatusLineConfigInput | undefined {
  if (!projectTomlPath) {
    return undefined;
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const statusLineConfig: StatusLineConfigInput = {};
  const statusLineSegments: Partial<
    Record<"model" | "project" | "context" | "tokens" | "session", boolean>
  > = {};
  let activeSection = "";
  let hasSignal = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      activeSection = sectionMatch[1];
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const rawValue = kvMatch[2];
    if (activeSection === "statusline") {
      if (key === "enabled") {
        statusLineConfig.enabled = readStatusLineBoolean(
          rawValue,
          "statusline-enabled",
        );
        hasSignal = true;
        continue;
      }
      if (key === "layout_mode" || key === "layout") {
        statusLineConfig.layoutMode = normalizeStatusLineLayoutMode(
          readStatusLineString(rawValue, "statusline-layout-mode"),
        );
        hasSignal = true;
        continue;
      }
      if (key === "theme") {
        statusLineConfig.theme = normalizeStatusLineTheme(
          readStatusLineString(rawValue, "statusline-theme"),
        );
        hasSignal = true;
        continue;
      }
      if (key === "separator") {
        statusLineConfig.separator = readStatusLineRawString(
          rawValue,
          "statusline-separator",
        );
        hasSignal = true;
        continue;
      }
      if (key === "segment_order") {
        statusLineConfig.segmentOrder = readStatusLineSegmentOrder(rawValue);
        hasSignal = true;
        continue;
      }
      if (key === "warning_threshold_ratio") {
        statusLineConfig.warningThresholdRatio = readStatusLineRatio(
          rawValue,
          "statusline-warning-threshold-ratio",
        );
        hasSignal = true;
        continue;
      }
      if (key === "critical_threshold_ratio") {
        statusLineConfig.criticalThresholdRatio = readStatusLineRatio(
          rawValue,
          "statusline-critical-threshold-ratio",
        );
        hasSignal = true;
        continue;
      }
      if (key === "warning_threshold_percent") {
        statusLineConfig.warningThresholdRatio = readStatusLinePercent(
          rawValue,
          "statusline-warning-threshold-percent",
        );
        hasSignal = true;
        continue;
      }
      if (key === "critical_threshold_percent") {
        statusLineConfig.criticalThresholdRatio = readStatusLinePercent(
          rawValue,
          "statusline-critical-threshold-percent",
        );
        hasSignal = true;
        continue;
      }
      if (key === "budget_snapshot_cache_ttl_ms") {
        statusLineConfig.budgetSnapshotCacheTtlMs =
          readStatusLineIntegerRange({
            raw: rawValue,
            field: "statusline-budget-snapshot-cache-ttl-ms",
            min: STATUS_LINE_CACHE_TTL_MIN_MS,
            max: STATUS_LINE_CACHE_TTL_MAX_MS,
          });
        hasSignal = true;
        continue;
      }
      if (key === "session_topic_cache_ttl_ms") {
        statusLineConfig.sessionTopicCacheTtlMs =
          readStatusLineIntegerRange({
            raw: rawValue,
            field: "statusline-session-topic-cache-ttl-ms",
            min: STATUS_LINE_CACHE_TTL_MIN_MS,
            max: STATUS_LINE_CACHE_TTL_MAX_MS,
          });
        hasSignal = true;
        continue;
      }
      if (key === "session_topic_max_width") {
        statusLineConfig.sessionTopicMaxWidth =
          readStatusLineIntegerRange({
            raw: rawValue,
            field: "statusline-session-topic-max-width",
            min: STATUS_LINE_SESSION_TOPIC_MAX_WIDTH_MIN,
            max: STATUS_LINE_SESSION_TOPIC_MAX_WIDTH_MAX,
          });
        hasSignal = true;
        continue;
      }
      continue;
    }
    if (activeSection === "statusline.segments") {
      if (
        key === "model" ||
        key === "project" ||
        key === "context" ||
        key === "tokens" ||
        key === "session"
      ) {
        statusLineSegments[key] = readStatusLineBoolean(
          rawValue,
          `statusline-segment-${key}`,
        );
        hasSignal = true;
        continue;
      }
      throwStatusLineConfigError(
        "statusline-segment",
        "statusline-segment key must be model, project, context, tokens, or session",
      );
    }
  }
  if (!hasSignal) {
    return undefined;
  }
  if (Object.keys(statusLineSegments).length > 0) {
    statusLineConfig.segments = statusLineSegments;
  }
  assertStatusLineThresholdOrder(statusLineConfig);
  return statusLineConfig;
}
