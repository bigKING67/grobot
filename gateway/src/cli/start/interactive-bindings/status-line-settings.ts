import {
  type StatusLineConfig,
  type StatusLineLayoutMode,
  type StatusLineSegmentId,
  type StatusLineTheme,
} from "../../tui/components/status-line/contract";
import { renderInfoPanel } from "../../tui/components/info-panel/render";

const STATUS_SEGMENT_LABELS: Record<StatusLineSegmentId, string> = {
  model: "Model",
  project: "Project",
  context: "Context",
  tokens: "Token",
  session: "Session",
};

const STATUS_THEME_LABELS: Record<StatusLineTheme, string> = {
  plain: "Plain",
  ccline: "Two-line",
  nerd_font: "Nerd font",
};

const STATUS_LAYOUT_MODE_LABELS: Record<StatusLineLayoutMode, string> = {
  adaptive: "Adaptive",
  full: "Full",
  compact: "Compact",
};

export function formatStatusSegmentLabel(
  segmentId: StatusLineSegmentId,
): string {
  return STATUS_SEGMENT_LABELS[segmentId] ?? segmentId;
}

export function formatStatusThemeLabel(theme: StatusLineTheme): string {
  return STATUS_THEME_LABELS[theme] ?? theme;
}

export function formatStatusLayoutModeLabel(layoutMode: StatusLineLayoutMode): string {
  return STATUS_LAYOUT_MODE_LABELS[layoutMode] ?? layoutMode;
}

export function formatStatusSegmentStateLine(
  segmentId: StatusLineSegmentId,
  enabled: boolean,
): string {
  return `${formatStatusSegmentLabel(segmentId)} ${enabled ? "on" : "off"}`;
}

export function normalizeStatusSegmentId(
  raw: string,
): StatusLineSegmentId | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "model" || normalized === "模型") {
    return "model";
  }
  if (normalized === "project" || normalized === "项目") {
    return "project";
  }
  if (normalized === "context" || normalized === "上下文") {
    return "context";
  }
  if (normalized === "tokens" || normalized === "token") {
    return "tokens";
  }
  if (raw.trim() === "Token") {
    return "tokens";
  }
  if (normalized === "session" || normalized === "会话") {
    return "session";
  }
  return undefined;
}

export function formatStatusLineCurrentSnapshot(
  config: StatusLineConfig,
): string {
  const segmentText = config.segmentOrder
    .map(
      (segmentId) =>
        formatStatusSegmentStateLine(segmentId, config.segments[segmentId]),
    )
    .join(", ");
  return renderInfoPanel({
    title: "Status bar",
    subtitle: "Current bottom status config",
    sections: [
      {
        rows: [
          {
            title: `Status · ${config.enabled ? "on" : "off"}`,
            detailLines: [
              `layout ${formatStatusLayoutModeLabel(config.layoutMode)} · theme ${formatStatusThemeLabel(config.theme)}`,
              `separator ${JSON.stringify(config.separator)}`,
            ],
          },
          {
            title: "Status segments",
            detailLines: [
              segmentText,
            ],
          },
          {
            title: "Thresholds and cache",
            detailLines: [
              `warning threshold ${String(Math.round(config.warningThresholdRatio * 100))}% · critical threshold ${String(Math.round(config.criticalThresholdRatio * 100))}%`,
              `budget snapshot cache ${String(config.budgetSnapshotCacheTtlMs)}ms · session topic cache ${String(config.sessionTopicCacheTtlMs)}ms`,
              `session topic width ${String(config.sessionTopicMaxWidth)}`,
            ],
          },
        ],
      },
    ],
  });
}

function buildStatusUsageSurface(title: string, command: string): string {
  return renderInfoPanel({
    title,
    sections: [{
      title: "Available entry",
      rows: [{
        title: `Usage ${command}`,
      }],
    }],
  });
}

export function buildStatusThemeUsageSurface(title = "Invalid status theme"): string {
  return buildStatusUsageSurface(
    title,
    "/status theme <plain|ccline|nerd_font>",
  );
}

export function buildStatusLayoutUsageSurface(title = "Invalid status layout"): string {
  return buildStatusUsageSurface(
    title,
    "/status layout <adaptive|full|compact>",
  );
}

export function buildStatusSegmentUsageSurface(title = "Invalid status segment"): string {
  return buildStatusUsageSurface(
    title,
    "/status segment <model|project|context|tokens|session> <on|off>",
  );
}

export function resolveStatusTheme(input: string): StatusLineTheme | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "plain" || normalized === "极简") {
    return "plain";
  }
  if (normalized === "ccline" || normalized === "cometix" || normalized === "双行") {
    return "ccline";
  }
  if (
    normalized === "nerd" ||
    normalized === "nerd_font" ||
    normalized === "nerd-font" ||
    normalized === "图标增强" ||
    normalized === "图标"
  ) {
    return "nerd_font";
  }
  return undefined;
}

export function resolveStatusLayoutMode(
  input: string,
): StatusLineLayoutMode | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "adaptive" || normalized === "自适应") {
    return "adaptive";
  }
  if (normalized === "full" || normalized === "完整") {
    return "full";
  }
  if (normalized === "compact" || normalized === "紧凑") {
    return "compact";
  }
  return undefined;
}
