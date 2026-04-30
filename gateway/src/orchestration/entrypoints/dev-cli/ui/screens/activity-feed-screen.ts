import type { RuntimeEvent } from "../../../../../models/types";
import {
  compactSpaces,
  measureDisplayWidth,
  truncateDisplayWidth,
} from "../interactive/display-width";
import { terminalStyle } from "../theme/terminal-style";

export interface RuntimeActivityFeedInput {
  events: readonly RuntimeEvent[];
  terminalColumns?: number;
  maxItems?: number;
  maxDiffLines?: number;
  detailMode?: RuntimeActivityFeedDetailMode;
}

export type RuntimeActivityFeedDetailMode = "none" | "compact" | "full";

interface ActivityFeedRow {
  title: string;
  detailLines: string[];
  severity: "ok" | "warning" | "error";
}

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_DIFF_LINES = 5;
const DEFAULT_TERMINAL_COLUMNS = 96;

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
      return "Searched";
    case "read":
      return "Read";
    case "glob":
    case "list":
      return "Explored";
    case "edit":
      return "Edited";
    case "write":
      return "Wrote";
    case "bash":
      return "Ran";
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

function detailFromParts(parts: string[]): string | undefined {
  const detail = parts
    .map((part) => compactSpaces(part))
    .filter(Boolean)
    .join(" ");
  return detail || undefined;
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
  const path = compactPath(firstString(payloadString(summary, "path"), payloadString(payload, "path")));
  const duration = formatDurationMs(firstNumber(
    payloadNumber(payload, "duration_ms"),
    payloadNumber(summary, "duration_ms"),
  ));
  const label = humanToolLabel(toolName);
  const severity = status === "failed" ? "error" : status === "deferred" ? "warning" : "ok";
  const titlePrefix = status === "failed"
    ? `Failed ${toolName}`
    : status === "deferred"
      ? `Deferred ${toolName}`
      : label;
  const diff = firstRawString(payloadString(summary, "diff"), payloadString(summary, "diff_preview"));
  const stats = diffStats(diff);
  const titleSuffix = toolName === "edit" && (stats.added > 0 || stats.removed > 0)
    ? ` (+${String(stats.added)} -${String(stats.removed)})`
    : "";
  const title = compactSpaces(`${titlePrefix}${path ? ` ${path}` : ""}${titleSuffix}`);
  const detailLines: string[] = [];

  if (toolName === "search" || toolName === "semantic_search") {
    const matches = firstNumber(
      payloadNumber(summary, "matches_count"),
      payloadNumber(summary, "count"),
    );
    const engine = firstString(payloadString(summary, "engine"));
    const limitReached = payloadBoolean(summary, "limit_reached");
    const detail = detailFromParts([
      typeof matches === "number" ? `matches=${String(matches)}` : "",
      engine ? `engine=${engine}` : "",
      limitReached === true ? "limit=reached" : "",
      duration ? `duration=${duration}` : "",
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
      kind && kind !== "text" ? `kind=${kind}` : "",
      hasMore === true ? "has_more=true" : "",
      duration ? `duration=${duration}` : "",
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
      typeof count === "number" ? `items=${String(count)}` : "",
      engine ? `engine=${engine}` : "",
      payloadBoolean(summary, "limit_reached") === true ? "limit=reached" : "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  } else if (toolName === "edit") {
    const replacements = firstNumber(payloadNumber(summary, "replacements"));
    const firstChangedLine = firstNumber(payloadNumber(summary, "first_changed_line"));
    const detail = detailFromParts([
      typeof replacements === "number" ? `replacements=${String(replacements)}` : "",
      typeof firstChangedLine === "number" ? `line=${String(firstChangedLine)}` : "",
      payloadBoolean(summary, "fuzzy_fallback_used") === true ? "fuzzy=true" : "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
    detailLines.push(...compactDiffLines(diff, maxDiffLines));
  } else if (toolName === "write") {
    const operation = firstString(payloadString(summary, "operation"));
    const bytesWritten = firstNumber(payloadNumber(summary, "bytes_written"));
    const detail = detailFromParts([
      operation ? `operation=${operation}` : "",
      typeof bytesWritten === "number" ? `bytes=${String(bytesWritten)}` : "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  } else if (toolName === "bash") {
    const commandPreview = firstString(
      payloadString(summary, "command_preview"),
      payloadString(summary, "command"),
    );
    const exitCode = firstNumber(payloadNumber(summary, "exit_code"));
    const detail = detailFromParts([
      commandPreview ? `command="${commandPreview.replace(/"/g, "'")}"` : "",
      typeof exitCode === "number" ? `exit=${String(exitCode)}` : "",
      duration ? `duration=${duration}` : "",
    ]);
    if (detail) {
      detailLines.push(detail);
    }
  }

  if (errorClass) {
    detailLines.push(`error_class=${errorClass}`);
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
  const stage = firstString(payloadString(payload, "recovery_stage"), payloadString(payload, "stage"));
  if (!stage || stage === "none") {
    return undefined;
  }
  const action = firstString(payloadString(payload, "recommended_next_action"));
  const errorClass = firstString(payloadString(payload, "error_class"));
  return {
    title: `Recovery ${toolName}`,
    detailLines: [
      detailFromParts([
        `stage=${stage}`,
        action ? `action=${action}` : "",
        errorClass ? `error_class=${errorClass}` : "",
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

function fitLine(line: string, terminalColumns: number): string {
  if (terminalColumns <= 0 || measureDisplayWidth(line) <= terminalColumns) {
    return line;
  }
  return truncateDisplayWidth(line, terminalColumns, { compact: true });
}

function styleTitle(row: ActivityFeedRow, line: string): string {
  const bullet = row.severity === "ok"
    ? terminalStyle.brand("•")
    : row.severity === "warning"
      ? terminalStyle.remember("•")
      : terminalStyle.info("•");
  return `${bullet} ${line}`;
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
  const output: string[] = [];
  for (const row of rows) {
    output.push(styleTitle(row, fitLine(row.title, Math.max(1, terminalColumns - 2))));
    if (detailMode === "full") {
      for (const detail of row.detailLines) {
        const plain = `  ⎿  ${detail}`;
        output.push(terminalStyle.muted(fitLine(plain, terminalColumns)));
      }
    }
  }
  return `${output.join("\n")}\n`;
}
