import type { RuntimeEvent } from "../../../../models/types";
import { compactSpaces } from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import { formatTuiErrorClassLabel } from "../error-labels";
import { formatBashCommandDisplay } from "./bash-format";
import type { ActivityFeedRow } from "./contract";
import {
  firstNumber,
  firstRawString,
  firstString,
  humanToolLabel,
  isRecord,
  normalizeActivityPayload,
  normalizeToolName,
  outputSummary,
  payloadBoolean,
  payloadNumber,
  payloadRecord,
  payloadString,
  payloadToolCallId,
} from "./tool-event";

const WRITE_PREVIEW_MAX_LINES = 10;
const SHELL_OUTPUT_TAIL_LINES = 5;

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

export function buildToolEndRow(
  event: RuntimeEvent,
  maxDiffLines: number,
): ActivityFeedRow | undefined {
  const payload = normalizeActivityPayload(event);
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
      kind: "tool",
      toolName,
      toolCallId: payloadToolCallId(payload) || undefined,
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
    kind: "tool",
    toolName,
    toolCallId: payloadToolCallId(payload) || undefined,
  };
}
