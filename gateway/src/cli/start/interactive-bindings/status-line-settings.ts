import {
  type StatusLineConfig,
  type StatusLineLayoutMode,
  type StatusLineSegmentId,
  type StatusLineTheme,
} from "../../tui/screens/status-line-screen";

export function normalizeStatusSegmentId(
  raw: string,
): StatusLineSegmentId | undefined {
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "model" ||
    normalized === "project" ||
    normalized === "context" ||
    normalized === "tokens" ||
    normalized === "session"
  ) {
    return normalized;
  }
  return undefined;
}

export function formatStatusLineCurrentSnapshot(
  config: StatusLineConfig,
): string {
  const segmentText = config.segmentOrder
    .map(
      (segmentId) =>
        `${segmentId} ${config.segments[segmentId] ? "开启" : "关闭"}`,
    )
    .join(", ");
  return [
    "● 状态栏",
    `  状态: ${config.enabled ? "开启" : "关闭"}`,
    `  布局: ${config.layoutMode}`,
    `  主题: ${config.theme}`,
    `  分隔符: ${JSON.stringify(config.separator)}`,
    `  状态段: ${segmentText}`,
    `  提醒阈值: ${String(Math.round(config.warningThresholdRatio * 100))}%`,
    `  危险阈值: ${String(Math.round(config.criticalThresholdRatio * 100))}%`,
    `  预算快照缓存: ${String(config.budgetSnapshotCacheTtlMs)}ms`,
    `  会话主题缓存: ${String(config.sessionTopicCacheTtlMs)}ms`,
    `  会话主题宽度: ${String(config.sessionTopicMaxWidth)}`,
    "",
  ].join("\n");
}

export function resolveStatusTheme(input: string): StatusLineTheme | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "plain") {
    return "plain";
  }
  if (normalized === "ccline" || normalized === "cometix") {
    return "ccline";
  }
  if (
    normalized === "nerd" ||
    normalized === "nerd_font" ||
    normalized === "nerd-font"
  ) {
    return "nerd_font";
  }
  return undefined;
}

export function resolveStatusLayoutMode(
  input: string,
): StatusLineLayoutMode | undefined {
  const normalized = input.trim().toLowerCase();
  if (
    normalized === "adaptive" ||
    normalized === "full" ||
    normalized === "compact"
  ) {
    return normalized;
  }
  return undefined;
}
