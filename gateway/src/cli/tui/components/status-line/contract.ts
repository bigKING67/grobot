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

export interface StatusLinePromptParts {
  statusLine: string;
  warningLine?: string;
  activityLine?: string;
}

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

export type StatusLineTemplateId =
  | "wide"
  | "medium"
  | "compact"
  | "minimal"
  | "tiny";

export interface StatusLineTemplateConfig {
  id: StatusLineTemplateId;
  compactLabels: boolean;
  includeSessionTopic: boolean;
  maxSegments: number;
}

export const STATUS_LINE_SEGMENT_IDS: StatusLineSegmentId[] = [
  "model",
  "project",
  "context",
  "tokens",
  "session",
];

export const DEFAULT_STATUS_LINE_SEGMENTS: Record<
  StatusLineSegmentId,
  boolean
> = {
  model: true,
  project: true,
  context: true,
  tokens: true,
  session: true,
};

export const DEFAULT_STATUS_LINE_SEGMENT_ORDER: StatusLineSegmentId[] = [
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

export const STATUS_LINE_TEMPLATES: Record<
  StatusLineTemplateId,
  StatusLineTemplateConfig
> = {
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
    maxSegments: 3,
  },
};

export const STATUS_LINE_TEMPLATE_FALLBACKS: Record<
  StatusLineTemplateId,
  StatusLineTemplateId[]
> = {
  wide: ["wide", "medium", "compact", "minimal", "tiny"],
  medium: ["medium", "compact", "minimal", "tiny"],
  compact: ["compact", "minimal", "tiny"],
  minimal: ["minimal", "tiny"],
  tiny: ["tiny"],
};
