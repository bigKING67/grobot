import type { RuntimeEvent } from "../../../../models/types";
import type {
  ActivityFeedRow,
  RuntimeActivityFeedDetailMode,
  RuntimeActivityFeedInput,
} from "./contract";
import {
  compactSpaces,
} from "../../terminal/display-width";
import { renderReactRuntimeActivityFeed } from "../../react/activity-feed";
import { formatTuiErrorClassLabel } from "../error-labels";

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_DIFF_LINES = 5;
const DEFAULT_TERMINAL_COLUMNS = 96;
const WRITE_PREVIEW_MAX_LINES = 10;

export function resolveRuntimeActivityFeedDetailMode(
  valueRaw: string | undefined,
): RuntimeActivityFeedDetailMode {
  const value = (valueRaw ?? "").trim().toLowerCase();
  if (!value || value === "0" || value === "false" || value === "off" || value === "none") {
    return "none";
  }
  if (value === "1" || value === "true" || value === "on" || value === "compact") {
    return "compact";
  }
  if (value === "full" || value === "verbose" || value === "debug") {
    return "full";
  }
  return "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePayload(event: RuntimeEvent): Record<string, unknown> {
  const raw = isRecord(event.payload) ? event.payload : {};
  const nested = isRecord(raw.payload) ? raw.payload : {};
  return {
    ...raw,
    ...nested,
  };
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function outputSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.output_summary) ? payload.output_summary : {};
}

function firstString(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = compactSpaces(value ?? "");
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function firstRawString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeToolName(payload: Record<string, unknown>, summary: Record<string, unknown>): string {
  return firstString(
    payloadString(payload, "tool_name"),
    payloadString(summary, "tool"),
    payloadString(summary, "tool_name"),
  ) || "unknown_tool";
}

function humanToolLabel(toolName: string): string {
  switch (toolName) {
    case "search":
    case "semantic_search":
      return "搜索";
    case "read":
      return "读取";
    case "glob":
    case "list":
      return "探索";
    case "edit":
      return "编辑";
    case "write":
      return "写入";
    case "bash":
      return "运行";
    default:
      return toolName
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" ") || "Tool";
  }
}

function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function formatDurationMs(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 1000) {
    return `${String(Math.max(0, Math.round(value)))}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function compactPath(path: string): string {
  const normalized = compactSpaces(path);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/^\.?\//, "");
}

function isPlanArtifactPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(".grobot/plans/") || normalized.includes("/.grobot/plans/");
}

function isPlanFileTool(toolName: string, path: string): boolean {
  return (toolName === "edit" || toolName === "write") && isPlanArtifactPath(path);
}

function compactDiffLines(diff: string, maxLines: number): string[] {
  if (!diff.trim()) {
    return [];
  }
  return diff
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, Math.max(0, maxLines));
}

function countVisibleLines(content: string): number {
  const parts = content.split("\n");
  return content.endsWith("\n") ? parts.length - 1 : parts.length;
}

function splitVisibleLines(content: string): string[] {
  const parts = content.split("\n");
  return content.endsWith("\n") ? parts.slice(0, -1) : parts;
}

function writeLineCount(summary: Record<string, unknown>, content: string): number | undefined {
  const explicit = firstNumber(
    payloadNumber(summary, "line_count"),
    payloadNumber(summary, "lines_count"),
    payloadNumber(summary, "lines_written"),
    payloadNumber(summary, "content_line_count"),
  );
  if (typeof explicit === "number") {
    return Math.max(0, Math.floor(explicit));
  }
  if (content.trim().length > 0 || content.length > 0) {
    return countVisibleLines(content);
  }
  return undefined;
}

function resolveWriteContent(summary: Record<string, unknown>): { content: string; isFullContent: boolean } {
  const content = firstRawString(payloadString(summary, "content"));
  if (content) {
    return { content, isFullContent: true };
  }
  const preview = firstRawString(
    payloadString(summary, "content_preview"),
    payloadString(summary, "preview"),
    payloadString(summary, "new_content_preview"),
  );
  return { content: preview, isFullContent: false };
}

function compactWriteContentPreview(
  summary: Record<string, unknown>,
): { lineCount: number | undefined; lines: string[]; hiddenLineCount: number } {
  const resolved = resolveWriteContent(summary);
  const lineCount = writeLineCount(summary, resolved.content);
  if (!resolved.content) {
    return { lineCount, lines: [], hiddenLineCount: 0 };
  }
  const visibleLines = splitVisibleLines(resolved.content);
  const previewLines = visibleLines.slice(0, WRITE_PREVIEW_MAX_LINES);
  const knownTotal = typeof lineCount === "number"
    ? lineCount
    : resolved.isFullContent
      ? visibleLines.length
      : undefined;
  const hiddenLineCount = typeof knownTotal === "number"
    ? Math.max(0, knownTotal - previewLines.length)
    : 0;
  return {
    lineCount: knownTotal,
    lines: previewLines,
    hiddenLineCount,
  };
}

function detailFromParts(parts: string[]): string | undefined {
  const detail = parts
    .map((part) => compactSpaces(part))
    .filter(Boolean)
    .join(" ");
  return detail || undefined;
}

function formatToolStatusTitle(status: string, label: string): string {
  if (status === "failed") {
    return `${label}失败`;
  }
  if (status === "deferred") {
    return `${label}已延后`;
  }
  return label;
}

function formatRecoveryAction(value: string): string {
  switch (value) {
    case "inspect_visible_tool_schema_then_retry":
      return "检查可见工具参数后重试";
    case "inspect_error_and_switch_strategy":
      return "检查错误后切换策略";
    case "switch_tool_strategy":
      return "切换工具策略";
    case "use_suggested_distinct_tool":
      return "改用建议工具";
    case "reread_target_then_retry":
      return "重新读取后重试";
    case "request_environment_fix":
      return "需要修复环境";
    case "observe_prior_tool_result":
      return "先观察已有工具结果";
    case "inspect_runtime_tool_recovery_policy":
      return "检查工具恢复策略";
    case "ask_user_for_config_or_switch_provider":
      return "需要配置或切换通道";
    case "observe_and_continue":
      return "观察结果后继续";
    case "avoid_unknown_tool":
      return "避开未知工具";
    case "":
      return "";
    default:
      return value.replace(/_/g, " ");
  }
}

function formatRecoveryStage(value: string): string {
  switch (value) {
    case "strategy_switch":
      return "切换策略";
    case "ask_user":
      return "等待确认";
    case "local_fix":
      return "本地修复";
    case "observe_first":
      return "先观察";
    case "none":
    case "":
      return "";
    default:
      return value.replace(/[_-]+/g, " ");
  }
}

function formatOperationLabel(operation: string): string {
  switch (operation) {
    case "create":
      return "创建";
    case "update":
      return "更新";
    case "overwrite":
      return "覆盖";
    case "delete":
      return "删除";
    default:
      return operation;
  }
}

function buildToolEndRow(
  event: RuntimeEvent,
  maxDiffLines: number,
): ActivityFeedRow | undefined {
  const payload = normalizePayload(event);
  const summary = outputSummary(payload);
  const toolName = normalizeToolName(payload, summary);
  const status = firstString(payloadString(payload, "status"), payloadString(summary, "status"));
  const errorClass = firstString(
    payloadString(payload, "error_class"),
    payloadString(summary, "error_class"),
  );
  const path = compactPath(firstString(
    payloadString(summary, "path"),
    payloadString(payload, "path"),
    payloadString(summary, "file_path"),
    payloadString(payload, "file_path"),
  ));
  const duration = formatDurationMs(firstNumber(
    payloadNumber(payload, "duration_ms"),
    payloadNumber(summary, "duration_ms"),
  ));
  const label = humanToolLabel(toolName);
  const severity = status === "failed" ? "error" : status === "deferred" ? "warning" : "ok";
  if (isPlanFileTool(toolName, path)) {
    const detailLines = status === "failed" ? [] : ["/plan 预览"];
    if (errorClass) {
      detailLines.push(`错误 ${formatTuiErrorClassLabel(errorClass)}`);
    }
    return {
      title: status === "failed"
        ? "计划更新失败"
        : status === "deferred"
          ? "计划更新已延后"
          : "计划已更新",
      detailLines,
      severity,
    };
  }
  const titlePrefix = formatToolStatusTitle(status, label);
  const diff = firstRawString(payloadString(summary, "diff"), payloadString(summary, "diff_preview"));
  const stats = diffStats(diff);
  const titleSuffix = toolName === "edit" && (stats.added > 0 || stats.removed > 0)
    ? ` (+${String(stats.added)} -${String(stats.removed)})`
    : "";
  let title = compactSpaces(`${titlePrefix}${path ? ` ${path}` : ""}${titleSuffix}`);
  const detailLines: string[] = [];

  if (toolName === "search" || toolName === "semantic_search") {
    const matches = firstNumber(
      payloadNumber(summary, "matches_count"),
      payloadNumber(summary, "count"),
    );
    const engine = firstString(payloadString(summary, "engine"));
    const limitReached = payloadBoolean(summary, "limit_reached");
    const detail = detailFromParts([
      typeof matches === "number" ? `${String(matches)} 个匹配` : "",
      engine,
      limitReached === true ? "已到结果上限" : "",
      duration ?? "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  } else if (toolName === "read") {
    const lineStart = payloadNumber(summary, "line_start");
    const lineEnd = payloadNumber(summary, "line_end");
    const hasMore = payloadBoolean(summary, "has_more");
    const kind = firstString(payloadString(summary, "kind"), payloadString(summary, "type"));
    const detail = detailFromParts([
      typeof lineStart === "number" && typeof lineEnd === "number"
        ? `行 ${String(lineStart)}-${String(lineEnd)}`
        : "",
      kind && kind !== "text" ? kind : "",
      hasMore === true ? "还有更多" : "",
      duration ?? "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  } else if (toolName === "glob" || toolName === "list") {
    const count = firstNumber(
      payloadNumber(summary, "matches_count"),
      payloadNumber(summary, "entries_count"),
      payloadNumber(summary, "count"),
    );
    const engine = firstString(payloadString(summary, "engine"));
    const detail = detailFromParts([
      typeof count === "number" ? `${String(count)} 项` : "",
      engine,
      payloadBoolean(summary, "limit_reached") === true ? "已到结果上限" : "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  } else if (toolName === "edit") {
    const replacements = firstNumber(payloadNumber(summary, "replacements"));
    const firstChangedLine = firstNumber(payloadNumber(summary, "first_changed_line"));
    const editLocation = typeof firstChangedLine === "number" ? `行 ${String(firstChangedLine)}` : "";
    const replacementDetail = typeof replacements === "number"
      ? `${String(replacements)} 处替换${editLocation ? `，${editLocation}` : ""}`
      : editLocation;
    const detail = detailFromParts([
      replacementDetail,
      payloadBoolean(summary, "fuzzy_fallback_used") === true ? "模糊匹配" : "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
    detailLines.push(...compactDiffLines(diff, maxDiffLines));
  } else if (toolName === "write") {
    const operation = firstString(payloadString(summary, "operation"));
    const bytesWritten = firstNumber(payloadNumber(summary, "bytes_written"));
    const preview = compactWriteContentPreview(summary);
    if (status !== "failed" && status !== "deferred" && typeof preview.lineCount === "number") {
      title = compactSpaces(
        path
          ? `写入 ${path} · ${String(preview.lineCount)} 行`
          : `写入 ${String(preview.lineCount)} 行`,
      );
    }
    if (preview.lines.length > 0) {
      detailLines.push(...preview.lines);
      if (preview.hiddenLineCount > 0) {
        detailLines.push(
          `… 还有 ${String(preview.hiddenLineCount)} 行，Ctrl+O 展开`,
        );
      }
    }
    const detail = detailFromParts([
      operation ? formatOperationLabel(operation) : "",
      typeof bytesWritten === "number" ? `${String(bytesWritten)} 字节` : "",
    ]);
    if (detail && preview.lines.length === 0) {
      detailLines.push(detail);
    }
  } else if (toolName === "bash") {
    const commandPreview = firstString(
      payloadString(summary, "command_preview"),
      payloadString(summary, "command"),
    );
    const exitCode = firstNumber(payloadNumber(summary, "exit_code"));
    const detail = detailFromParts([
      commandPreview ? `命令 ${commandPreview.replace(/"/g, "'")}` : "",
      typeof exitCode === "number" ? `退出码 ${String(exitCode)}` : "",
      duration ?? "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  }

  if (errorClass) {
    detailLines.push(`错误 ${formatTuiErrorClassLabel(errorClass)}`);
  }
  return {
    title,
    detailLines,
    severity,
  };
}

function buildRecoveryRow(event: RuntimeEvent): ActivityFeedRow | undefined {
  const payload = normalizePayload(event);
  const toolName = payloadString(payload, "tool_name") || "unknown_tool";
  const label = humanToolLabel(toolName);
  const stage = firstString(payloadString(payload, "recovery_stage"), payloadString(payload, "stage"));
  if (!stage || stage === "none") {
    return undefined;
  }
  const action = firstString(payloadString(payload, "recommended_next_action"));
  const errorClass = firstString(payloadString(payload, "error_class"));
  return {
    title: `恢复策略 · ${label}`,
    detailLines: [
      detailFromParts([
        formatRecoveryStage(stage),
        formatRecoveryAction(action),
        errorClass ? `错误 ${formatTuiErrorClassLabel(errorClass)}` : "",
      ]) ?? "",
    ].filter(Boolean),
    severity: "warning",
  };
}

function buildRows(input: RuntimeActivityFeedInput): ActivityFeedRow[] {
  const rows: ActivityFeedRow[] = [];
  const maxDiffLines = typeof input.maxDiffLines === "number" && Number.isFinite(input.maxDiffLines)
    ? Math.max(0, Math.floor(input.maxDiffLines))
    : DEFAULT_MAX_DIFF_LINES;
  for (const event of input.events) {
    const row = event.eventType === "tool_end"
      ? buildToolEndRow(event, maxDiffLines)
      : event.eventType === "tool_recovery"
        ? buildRecoveryRow(event)
        : undefined;
    if (row) {
      rows.push(row);
    }
  }
  const maxItems = typeof input.maxItems === "number" && Number.isFinite(input.maxItems)
    ? Math.max(1, Math.floor(input.maxItems))
    : DEFAULT_MAX_ITEMS;
  return rows.slice(0, maxItems);
}

export function renderRuntimeActivityFeed(input: RuntimeActivityFeedInput): string {
  if (input.detailMode === "none") {
    return "";
  }
  const rows = buildRows(input);
  if (rows.length === 0) {
    return "";
  }
  const detailMode = input.detailMode ?? "compact";
  const terminalColumns = typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
    ? Math.max(24, Math.floor(input.terminalColumns))
    : DEFAULT_TERMINAL_COLUMNS;
  const rendered = renderReactRuntimeActivityFeed({
    rows,
    detailMode,
    terminalColumns,
  });
  return rendered ? `${rendered}\n` : "";
}
