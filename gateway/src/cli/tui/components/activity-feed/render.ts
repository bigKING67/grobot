import type { RuntimeEvent } from "../../../../models/types";
import type {
  ActivityFeedRow,
  RuntimeActivityFeedDetailMode,
  RuntimeActivityFeedInput,
} from "./contract";
import {
  compactSpaces,
} from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import { renderReactRuntimeActivityFeed } from "../../react/activity-feed";
import { formatTuiErrorClassLabel } from "../error-labels";
import { formatBashCommandDisplay } from "./bash-format";

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_DIFF_LINES = 5;
const DEFAULT_TERMINAL_COLUMNS = 96;
const WRITE_PREVIEW_MAX_LINES = 10;
const SHELL_OUTPUT_TAIL_LINES = 5;

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
    case "$web_search":
    case "web_search":
      return "Search";
    case "read":
      return "Read";
    case "glob":
    case "list":
      return "Explore";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "bash":
      return "Run";
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

function parseJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function payloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return isRecord(value) ? value : {};
}

function formatByteSize(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const bytes = Math.max(0, Math.round(value));
  const kb = bytes / 1024;
  if (kb < 1) {
    return `${String(bytes)} bytes`;
  }
  if (kb < 1024) {
    return `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  }
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, "")}GB`;
}

function formatLineStatus(value: number | undefined, estimated: boolean): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const lines = Math.floor(value);
  if (estimated) {
    return `~${String(lines)} lines`;
  }
  if (lines <= SHELL_OUTPUT_TAIL_LINES) {
    return undefined;
  }
  return `+${String(lines - SHELL_OUTPUT_TAIL_LINES)} lines`;
}

function firstRawBashCommand(
  payload: Record<string, unknown>,
  summary: Record<string, unknown>,
): string {
  const audit = payloadRecord(summary, "audit");
  const payloadAudit = payloadRecord(payload, "audit");
  return firstRawString(
    payloadString(summary, "command_preview"),
    payloadString(audit, "command_preview"),
    payloadString(summary, "command"),
    payloadString(payload, "command_preview"),
    payloadString(payloadAudit, "command_preview"),
  );
}

function resolveBashCommandPreview(
  payload: Record<string, unknown>,
  summary: Record<string, unknown>,
): string {
  return formatBashCommandDisplay(firstRawBashCommand(payload, summary));
}

function resolveBashOutputPreview(summary: Record<string, unknown>, preferStderr: boolean): {
  lines: string[];
  lineStatus?: string;
  byteStatus?: string;
} {
  const stdout = firstRawString(
    payloadString(summary, "stdout"),
    payloadString(summary, "stdout_preview"),
  );
  const stderr = firstRawString(
    payloadString(summary, "stderr"),
    payloadString(summary, "stderr_preview"),
  );
  const selectedStream = preferStderr && stderr.trim().length > 0
    ? "stderr"
    : stdout.trim().length > 0
      ? "stdout"
      : stderr.trim().length > 0
        ? "stderr"
        : "";
  const selected = selectedStream === "stderr" ? stderr : stdout;
  const lines = splitVisibleLines(selected.trim())
    .map((line) => sanitizeTerminalDisplayText(line))
    .filter((line) => line.trim().length > 0)
    .slice(-SHELL_OUTPUT_TAIL_LINES);
  const truncation = payloadRecord(summary, "truncation");
  const outputTruncation = payloadRecord(truncation, selectedStream || "stdout");
  const totalLines = firstNumber(
    payloadNumber(summary, selectedStream === "stderr" ? "stderr_lines" : "stdout_lines"),
    payloadNumber(summary, "total_lines"),
    payloadNumber(outputTruncation, "total_lines"),
  );
  const totalBytes = firstNumber(
    payloadNumber(summary, selectedStream === "stderr" ? "stderr_bytes" : "stdout_bytes"),
    payloadNumber(summary, "total_bytes"),
    payloadNumber(outputTruncation, "total_bytes"),
  );
  const estimatedLines = payloadBoolean(outputTruncation, "truncated") === true
    || Boolean(firstString(payloadString(outputTruncation, "truncated_by")));
  return {
    lines,
    lineStatus: formatLineStatus(totalLines, estimatedLines),
    byteStatus: formatByteSize(totalBytes),
  };
}

function buildBashOutputSummaryFromErrorData(payload: Record<string, unknown>): Record<string, unknown> {
  const errorData = payloadRecord(payload, "error_data");
  const commandPreview = firstString(
    payloadString(errorData, "command_preview"),
    payloadString(payloadRecord(errorData, "audit"), "command_preview"),
  );
  if (!commandPreview) {
    return {};
  }
  return {
    tool: "bash",
    command_preview: commandPreview,
  };
}

function detailFromParts(parts: string[]): string | undefined {
  const detail = parts
    .map((part) => compactSpaces(part))
    .filter(Boolean)
    .join(" · ");
  return detail || undefined;
}

function rowStateForSeverity(severity: ActivityFeedRow["severity"]): NonNullable<ActivityFeedRow["state"]> {
  if (severity === "error") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "success";
}

function formatToolStatusTitle(status: string, label: string): string {
  if (status === "failed") {
    return `${label} failed`;
  }
  if (status === "deferred") {
    return `${label} deferred`;
  }
  return label;
}

function normalizeToolEndStatus(toolName: string, payload: Record<string, unknown>, summary: Record<string, unknown>): string {
  const status = firstString(payloadString(payload, "status"), payloadString(summary, "status"));
  if (toolName === "bash") {
    const exitCode = firstNumber(payloadNumber(summary, "exit_code"));
    if (typeof exitCode === "number" && exitCode !== 0 && status !== "deferred") {
      return "failed";
    }
  }
  return status;
}

function formatRecoveryAction(value: string): string {
  switch (value) {
    case "inspect_visible_tool_schema_then_retry":
      return "Inspect visible tool args, then retry";
    case "inspect_error_and_switch_strategy":
      return "Inspect error, then switch strategy";
    case "switch_tool_strategy":
      return "Switch tool strategy";
    case "use_suggested_distinct_tool":
      return "Use suggested tool";
    case "reread_target_then_retry":
      return "Reread target, then retry";
    case "request_environment_fix":
      return "Environment fix needed";
    case "observe_prior_tool_result":
      return "Observe prior tool result first";
    case "inspect_runtime_tool_recovery_policy":
      return "Inspect tool recovery strategy";
    case "ask_user_for_config_or_switch_provider":
      return "Configure or switch provider";
    case "observe_and_continue":
      return "Observe and continue";
    case "avoid_unknown_tool":
      return "Avoid unknown tool";
    case "":
      return "";
    default:
      return value.replace(/_/g, " ");
  }
}

function formatRecoveryStage(value: string): string {
  switch (value) {
    case "strategy_switch":
      return "Switch strategy";
    case "ask_user":
      return "Waiting for confirmation";
    case "local_fix":
      return "Local fix";
    case "observe_first":
      return "Observe first";
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
      return "Create";
    case "update":
      return "Update";
    case "overwrite":
      return "Overwrite";
    case "delete":
      return "Delete";
    default:
      return operation;
  }
}

function buildToolEndRow(
  event: RuntimeEvent,
  maxDiffLines: number,
): ActivityFeedRow | undefined {
  const payload = normalizePayload(event);
  const parsedOutputSummary = outputSummary(payload);
  const toolName = normalizeToolName(payload, parsedOutputSummary);
  const summary = toolName === "bash"
    ? {
      ...buildBashOutputSummaryFromErrorData(payload),
      ...parseJsonObject(payloadString(payload, "output_preview")),
      ...parsedOutputSummary,
    }
    : parsedOutputSummary;
  const status = normalizeToolEndStatus(toolName, payload, summary);
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
    const detailLines = status === "failed" ? [] : ["/plan preview"];
    if (errorClass) {
      detailLines.push(`Error ${formatTuiErrorClassLabel(errorClass)}`);
    }
    return {
      title: status === "failed"
        ? "Plan update failed"
        : status === "deferred"
          ? "Plan update deferred"
          : "Plan updated",
      detailLines,
      severity,
      state: rowStateForSeverity(severity),
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

  if (toolName === "search" || toolName === "semantic_search" || toolName === "$web_search" || toolName === "web_search") {
    const matches = firstNumber(
      payloadNumber(summary, "matches_count"),
      payloadNumber(summary, "count"),
    );
    const engine = firstString(payloadString(summary, "engine"));
    const limitReached = payloadBoolean(summary, "limit_reached");
    const detail = detailFromParts([
      typeof matches === "number" ? `${String(matches)} matches` : "",
      engine,
      limitReached === true ? "limit reached" : "",
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
        ? `lines ${String(lineStart)}-${String(lineEnd)}`
        : "",
      kind && kind !== "text" ? kind : "",
      hasMore === true ? "more available" : "",
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
      typeof count === "number" ? `${String(count)} items` : "",
      engine,
      payloadBoolean(summary, "limit_reached") === true ? "limit reached" : "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  } else if (toolName === "edit") {
    const replacements = firstNumber(payloadNumber(summary, "replacements"));
    const firstChangedLine = firstNumber(payloadNumber(summary, "first_changed_line"));
    const editLocation = typeof firstChangedLine === "number" ? `line ${String(firstChangedLine)}` : "";
    const replacementDetail = typeof replacements === "number"
      ? `${String(replacements)} replacement${replacements === 1 ? "" : "s"}${editLocation ? `, ${editLocation}` : ""}`
      : editLocation;
    const detail = detailFromParts([
      replacementDetail,
      payloadBoolean(summary, "fuzzy_fallback_used") === true ? "fuzzy match" : "",
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
          ? `Write ${path} · ${String(preview.lineCount)} lines`
          : `Write ${String(preview.lineCount)} lines`,
      );
    }
    if (preview.lines.length > 0) {
      detailLines.push(...preview.lines);
      if (preview.hiddenLineCount > 0) {
        detailLines.push(
          `... ${String(preview.hiddenLineCount)} more lines`,
        );
      }
    }
    const detail = detailFromParts([
      operation ? formatOperationLabel(operation) : "",
      typeof bytesWritten === "number" ? `${String(bytesWritten)} bytes` : "",
    ]);
    if (detail && preview.lines.length === 0) {
      detailLines.push(detail);
    }
  } else if (toolName === "bash") {
    const commandPreview = resolveBashCommandPreview(payload, summary);
    const exitCode = firstNumber(payloadNumber(summary, "exit_code"));
    const preview = resolveBashOutputPreview(
      summary,
      status === "failed" || (typeof exitCode === "number" && exitCode !== 0),
    );
    detailLines.push(...preview.lines);
    const detail = detailFromParts([
      commandPreview ? `$ ${commandPreview.replace(/"/g, "'")}` : "",
      typeof exitCode === "number" ? `exit ${String(exitCode)}` : "",
      duration ?? "",
      preview.lineStatus ?? "",
      preview.byteStatus ?? "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  }

  if (errorClass) {
    detailLines.push(`Error ${formatTuiErrorClassLabel(errorClass)}`);
  }
  return {
    title,
    detailLines,
    severity,
    state: rowStateForSeverity(severity),
  };
}

function payloadToolCallId(payload: Record<string, unknown>): string {
  return firstString(payloadString(payload, "tool_call_id"), payloadString(payload, "id"));
}

function buildToolStartRow(event: RuntimeEvent): ActivityFeedRow | undefined {
  const payload = normalizePayload(event);
  const toolName = normalizeToolName(payload, {});
  const inputSummary = payloadRecord(payload, "input_summary");
  const label = humanToolLabel(toolName);
  const path = compactPath(firstString(
    payloadString(inputSummary, "path"),
    payloadString(inputSummary, "file_path"),
    payloadString(payload, "path"),
    payloadString(payload, "file_path"),
  ));
  const query = firstString(
    payloadString(inputSummary, "query"),
    payloadString(inputSummary, "pattern"),
  );
  const commandPreview = toolName === "bash"
    ? resolveBashCommandPreview(payload, inputSummary)
    : "";
  const title = compactSpaces(
    toolName === "bash" && commandPreview
      ? `${label} $ ${commandPreview.replace(/"/g, "'")}`
      : `${label}${path ? ` ${path}` : ""}${query ? ` ${query}` : ""}`,
  );
  if (!title) {
    return undefined;
  }
  return {
    title,
    detailLines: toolName === "bash" ? ["Running…"] : [],
    severity: "ok",
    state: "running",
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
    title: `Recovery · ${label}`,
    detailLines: [
      detailFromParts([
        formatRecoveryStage(stage),
        formatRecoveryAction(action),
        errorClass ? `Error ${formatTuiErrorClassLabel(errorClass)}` : "",
      ]) ?? "",
    ].filter(Boolean),
    severity: "warning",
    state: "warning",
  };
}

function buildRows(input: RuntimeActivityFeedInput): ActivityFeedRow[] {
  const rows: ActivityFeedRow[] = [];
  const maxDiffLines = typeof input.maxDiffLines === "number" && Number.isFinite(input.maxDiffLines)
    ? Math.max(0, Math.floor(input.maxDiffLines))
    : DEFAULT_MAX_DIFF_LINES;
  const resolvedToolCallIds = new Set<string>();
  for (const event of input.events) {
    if (event.eventType !== "tool_end") {
      continue;
    }
    const toolCallId = payloadToolCallId(normalizePayload(event));
    if (toolCallId) {
      resolvedToolCallIds.add(toolCallId);
    }
  }
  for (const event of input.events) {
    const row = (() => {
      if (event.eventType === "tool_start") {
        const toolCallId = payloadToolCallId(normalizePayload(event));
        return toolCallId && resolvedToolCallIds.has(toolCallId)
          ? undefined
          : buildToolStartRow(event);
      }
      if (event.eventType === "tool_end") {
        return buildToolEndRow(event, maxDiffLines);
      }
      if (event.eventType === "tool_recovery") {
        return buildRecoveryRow(event);
      }
      return undefined;
    })();
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
