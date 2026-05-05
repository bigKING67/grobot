import {
  type StatusLineConfig,
  type StatusLineLayoutMode,
  type StatusLineSegmentId,
  type StatusLineTheme,
} from "../../tui/components/status-line/contract";
import { renderInfoPanel } from "../../tui/components/info-panel/render";

const STATUS_SEGMENT_LABELS: Record<StatusLineSegmentId, string> = {
  model: "模型",
  project: "项目",
  context: "上下文",
  tokens: "Token",
  session: "会话",
};

const STATUS_THEME_LABELS: Record<StatusLineTheme, string> = {
  plain: "极简",
  ccline: "双行",
  nerd_font: "图标增强",
};

const STATUS_LAYOUT_MODE_LABELS: Record<StatusLineLayoutMode, string> = {
  adaptive: "自适应",
  full: "完整",
  compact: "紧凑",
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
  return `${formatStatusSegmentLabel(segmentId)} ${enabled ? "开启" : "关闭"}`;
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
    title: "状态栏",
    subtitle: "当前底部状态配置",
    sections: [
      {
        rows: [
          {
            title: `状态 · ${config.enabled ? "开启" : "关闭"}`,
            detailLines: [
              `布局 ${formatStatusLayoutModeLabel(config.layoutMode)} · 主题 ${formatStatusThemeLabel(config.theme)}`,
              `分隔符 ${JSON.stringify(config.separator)}`,
            ],
          },
          {
            title: "状态段",
            detailLines: [
              segmentText,
            ],
          },
          {
            title: "阈值与缓存",
            detailLines: [
              `提醒阈值 ${String(Math.round(config.warningThresholdRatio * 100))}% · 危险阈值 ${String(Math.round(config.criticalThresholdRatio * 100))}%`,
              `预算快照缓存 ${String(config.budgetSnapshotCacheTtlMs)}ms · 会话主题缓存 ${String(config.sessionTopicCacheTtlMs)}ms`,
              `会话主题宽度 ${String(config.sessionTopicMaxWidth)}`,
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
      title: "可用入口",
      rows: [{
        title: `用法 ${command}`,
      }],
    }],
  });
}

export function buildStatusThemeUsageSurface(title = "无效状态主题"): string {
  return buildStatusUsageSurface(
    title,
    "/status 主题 <极简|双行|图标增强>",
  );
}

export function buildStatusLayoutUsageSurface(title = "无效状态布局"): string {
  return buildStatusUsageSurface(
    title,
    "/status 布局 <自适应|完整|紧凑>",
  );
}

export function buildStatusSegmentUsageSurface(title = "无效状态段"): string {
  return buildStatusUsageSurface(
    title,
    "/status 状态段 <模型|项目|上下文|Token|会话> <开启|关闭>",
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
