import {
  DEFAULT_STATUS_LINE_CONFIG,
  DEFAULT_STATUS_LINE_SEGMENT_ORDER,
  DEFAULT_STATUS_LINE_SEGMENTS,
  STATUS_LINE_SEGMENT_IDS,
  type StatusLineConfig,
  type StatusLineConfigInput,
  type StatusLineLayoutMode,
  type StatusLineSegmentId,
  type StatusLineTheme,
} from "./contract";

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
  if (
    normalized === "full" ||
    normalized === "compact" ||
    normalized === "adaptive"
  ) {
    return normalized;
  }
  return DEFAULT_STATUS_LINE_CONFIG.layoutMode;
}

function normalizeTheme(value: string | undefined): StatusLineTheme {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "plain" ||
    normalized === "nerd_font" ||
    normalized === "nerd-font" ||
    normalized === "ccline" ||
    normalized === "cometix"
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
    criticalThresholdRatio: Math.max(
      criticalThresholdRatio,
      warningThresholdRatio,
    ),
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
