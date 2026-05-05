import type { InfoPanelRow } from "../tui/components/info-panel/contract";
import type { StatusProviderProbeResult } from "./provider-probe-status";
import type { RouteDecisionSummary } from "./route-status";
import type { RuntimeHealthStatus } from "./runtime-health-format";

export function displayValue(value: string | null | undefined, fallback = "未配置"): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "<auto>") {
    return "自动";
  }
  if (normalized === "<unset>") {
    return "未配置";
  }
  if (normalized === "<not-found>") {
    return "未找到";
  }
  return normalized;
}

export function humanizeMachineToken(value: string | null | undefined, fallback = "未知"): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  const labels: Record<string, string> = {
    "config_selected_provider": "配置指定通道",
    "config-toml": "配置文件",
    "runtime.tools.describe": "运行时描述",
    "session_registry_unavailable": "会话状态未读取",
    "session_sticky_provider": "会话固定通道",
    "sticky+score": "粘性路由 + 评分回退",
    "typescript-gateway": "TypeScript Gateway",
    "window_stable": "窗口稳定",
    "balanced": "平衡",
    "coding": "编码",
    "matched": "已匹配",
    "stable": "稳定",
  };
  const labeled = labels[normalized];
  if (labeled) {
    return labeled;
  }
  return normalized.replace(/\+/g, " + ").replace(/[_-]+/g, " ");
}

export function humanizeConfigSource(value: string | null | undefined): string {
  switch (value) {
    case "project_work_dir":
      return "工作区配置";
    case "project_root":
      return "项目配置";
    case "home":
      return "用户配置";
    case "custom":
      return "自定义配置";
    case "none":
    case undefined:
    case null:
      return "未找到";
    default:
      return humanizeMachineToken(value);
  }
}

export function humanizeStatusSource(
  value: string | null | undefined,
  configSource: string,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    return humanizeConfigSource(configSource);
  }
  if (normalized.startsWith("config_toml:")) {
    return humanizeConfigSource(configSource);
  }
  if (normalized === "env") {
    return "环境变量";
  }
  if (normalized === "cli") {
    return "CLI 参数";
  }
  return humanizeMachineToken(normalized);
}

export function humanizeExecutionSource(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "默认";
  }
  switch (normalized) {
    case "cli":
      return "CLI 参数";
    case "env":
      return "环境变量";
    case "config":
    case "config_toml":
      return "配置文件";
    case "default":
      return "默认";
    default:
      return humanizeMachineToken(normalized);
  }
}

function humanizeRuntimeHealthDetail(detail: string | null | undefined, ok: boolean): string {
  const normalized = detail?.trim();
  if (!normalized || normalized === "runtime.health=ok") {
    return ok ? "可用" : "无详情";
  }
  return humanizeMachineToken(normalized);
}

export function enabledText(value: boolean): string {
  return value ? "开启" : "关闭";
}

export function formatRouteSummary(row: RouteDecisionSummary): InfoPanelRow {
  return {
    title: `路由 ${displayValue(row.primaryProvider, "无可用通道")}`,
    detailLines: [
      `策略 ${humanizeMachineToken(row.strategy)} · 原因 ${humanizeMachineToken(row.reason)}`,
      `候选 ${row.orderedProviders.length > 0 ? row.orderedProviders.join(" -> ") : "无"}`,
      `固定 ${displayValue(row.observed.stickyProvider, "无")} · 当前 ${displayValue(row.observed.selectedProvider, "无")}`,
    ],
  };
}

export function formatRuntimeHealthSummary(
  runtimeHealth: RuntimeHealthStatus | undefined,
  runtimeBinaryPath: string | undefined,
): InfoPanelRow | undefined {
  if (!runtimeHealth || !runtimeBinaryPath) {
    return undefined;
  }
  return {
    title: `运行时 ${runtimeHealth.ok ? "健康" : "需要检查"}`,
    detailLines: [
      `路径 ${runtimeBinaryPath}`,
      `状态 ${humanizeRuntimeHealthDetail(runtimeHealth.detail, runtimeHealth.ok)}`,
    ],
  };
}

export function formatProbeSummary(
  probe: StatusProviderProbeResult | undefined,
): InfoPanelRow | undefined {
  if (!probe) {
    return undefined;
  }
  const detailLines = [`状态 ${humanizeMachineToken(probe.detail)}`];
  if (typeof probe.httpStatus === "number" && probe.httpStatus > 0) {
    detailLines.push(`HTTP ${String(probe.httpStatus)}`);
  }
  if (typeof probe.modelCount === "number") {
    detailLines.push(`模型 ${String(probe.modelCount)} 个`);
  }
  if (probe.selectedModel) {
    detailLines.push(`选中 ${probe.selectedModel} · ${probe.selectedFound ? "已找到" : "未找到"}`);
  }
  if (probe.resolvedModel) {
    detailLines.push(`解析 ${probe.resolvedModel}${probe.autoSelected ? " · 自动选择" : ""}`);
  }
  return {
    title: `探测 ${humanizeMachineToken(probe.state)}`,
    detailLines,
  };
}
