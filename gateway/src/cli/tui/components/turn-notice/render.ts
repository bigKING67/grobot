import {
  compactSpaces,
  truncateDisplayWidth,
} from "../../terminal/display-width";
import { sanitizeTerminalDisplayText } from "../../terminal/text-sanitizer";
import { renderReactTurnNotice } from "../../react/turn-notice";
import { formatTuiErrorClassLabel } from "../error-labels";
import type {
  RuntimeFailureSummaryInput,
  TurnNoticeViewModel,
} from "./contract";

const DEFAULT_NOTICE_COLUMNS = 96;
const MAX_ERROR_DETAIL_LINES = 2;

function payloadString(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? compactNoticeText(value) : "";
}

function payloadNumber(payload: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function payloadBoolean(payload: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = payload?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function humanProviderDiagnosticKind(value: string): string {
  switch (value) {
    case "config_missing":
    case "semantic_config_missing":
      return "Configuration missing";
    case "config_invalid":
    case "semantic_index_config_invalid":
      return "Invalid configuration";
    case "upstream_http_error":
      return "Provider HTTP error";
    case "upstream_connect_failed":
      return "Provider connection failed";
    case "upstream_timeout":
      return "Provider timeout";
    case "upstream_invalid_json":
      return "Provider invalid response";
    default:
      return value.replace(/_/g, " ");
  }
}

function formatProviderFailureDiagnostics(errorData: Record<string, unknown> | undefined): string {
  if (!errorData) {
    return "";
  }
  const parts: string[] = [];
  const diagnosticKind = payloadString(errorData, "diagnostic_kind");
  const httpStatus = payloadNumber(errorData, "http_status");
  if (diagnosticKind && diagnosticKind === "upstream_http_error" && typeof httpStatus === "number") {
    parts.push(`Provider HTTP ${String(httpStatus)}`);
  } else if (diagnosticKind) {
    parts.push(humanProviderDiagnosticKind(diagnosticKind));
  }
  if (typeof httpStatus === "number" && diagnosticKind !== "upstream_http_error") {
    parts.push(`HTTP ${String(httpStatus)}`);
  }
  const attempt = payloadNumber(errorData, "attempt");
  const maxAttempts = payloadNumber(errorData, "max_attempts");
  if (typeof attempt === "number" || typeof maxAttempts === "number") {
    parts.push(`attempt ${String(attempt ?? "?")}/${String(maxAttempts ?? "?")}`);
  }
  const retryable = payloadBoolean(errorData, "retryable");
  if (typeof retryable === "boolean") {
    parts.push(retryable ? "retryable" : "not retryable");
  }
  return parts.slice(0, 4).join(" · ");
}

function formatProviderFailure(item: RuntimeFailureSummaryInput["failures"][number]): string {
  const diagnostic = formatProviderFailureDiagnostics(item.errorData);
  return [
    compactNoticeText(item.providerName, "unknown provider"),
    formatTuiErrorClassLabel(item.errorClass) || "Runtime error",
    diagnostic,
  ].filter(Boolean).join(" · ");
}

function formatRuntimeErrorLine(line: string): string {
  const normalized = compactNoticeText(line);
  if (!normalized) {
    return "";
  }
  if (normalized === "timeout") {
    return "Request timed out";
  }
  if (normalized === "server failed") {
    return "Server failed";
  }
  if (normalized === "caused by connection refused") {
    return "Connection refused";
  }
  if (normalized === "socket closed before handshake") {
    return "Socket closed before handshake";
  }
  return normalized
    .replace(/\bRuntimeRpcError:\s*/gi, "")
    .replace(/\bruntime rpc error\s*-?\d*:\s*/gi, "")
    .replace(/\bruntime turn execution failed\b/gi, "Runtime turn failed")
    .replace(/\(class=([^)]+)\)/g, (_match, errorClass: string) =>
      `(${formatTuiErrorClassLabel(errorClass)})`
    );
}

function renderNotice(input: TurnNoticeViewModel): string {
  const rendered = renderReactTurnNotice(input);
  return `${rendered}\n${input.interactiveMode ? "\n" : ""}`;
}

function compactNoticeText(value: string, fallback = ""): string {
  const normalized = compactSpaces(sanitizeTerminalDisplayText(value));
  return normalized.length > 0 ? normalized : fallback;
}

function compactErrorLines(value: string, terminalColumns: number): string[] {
  const sanitized = value
    .split(/\r?\n/)
    .map((line) => formatRuntimeErrorLine(sanitizeTerminalDisplayText(line)))
    .filter(Boolean);
  const lines = sanitized.length > 0 ? sanitized : ["no error detail"];
  const visible = lines
    .slice(0, MAX_ERROR_DETAIL_LINES)
    .map((line, index) =>
      truncateDisplayWidth(
        index === 0 ? `Last error ${line}` : line,
        Math.max(24, terminalColumns - 6),
      )
    );
  const hiddenCount = Math.max(0, lines.length - visible.length);
  if (hiddenCount > 0) {
    visible.push(`... ${String(hiddenCount)} more lines`);
  }
  return visible;
}

export function renderManagementInterruptNotice(interactiveMode: boolean): string {
  return renderNotice({
    title: "Session interrupted",
    detail: interactiveMode
      ? "Manager skipped the current input"
      : "Manager skipped the current request",
    tone: "muted",
    interactiveMode,
  });
}

export function renderTurnInterruptedNotice(interactiveMode: boolean): string {
  return renderNotice({
    title: "Turn interrupted",
    detail: interactiveMode ? "You can enter a new instruction." : undefined,
    tone: "muted",
    interactiveMode,
  });
}

export function renderRuntimeOpenCircuitNotice(interactiveMode: boolean): string {
  return renderNotice({
    title: "All model providers unavailable",
    detail: interactiveMode
      ? "Retry later, or use /model to switch models"
      : "Switch models before retrying",
    tone: "muted",
    interactiveMode,
  });
}

export function renderRuntimeFailureSummary(input: RuntimeFailureSummaryInput): string {
  const terminalColumns =
    typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
      ? Math.max(32, Math.floor(input.terminalColumns))
      : DEFAULT_NOTICE_COLUMNS;
  const failureSummary = input.failures
    .map((item) => formatProviderFailure(item))
    .join(", ");
  const attemptedProviders = input.orderedProviders
    .map((item) => compactNoticeText(item.name))
    .filter(Boolean)
    .join(" -> ");
  const footerLines: string[] = [];
  if (input.failures.length > 0) {
    const last = input.failures[input.failures.length - 1];
    footerLines.push(...compactErrorLines(last.errorMessage, terminalColumns));
  }
  footerLines.push(`Attempt order ${attemptedProviders || "no providers available"}`);
  footerLines.push(`Failed providers ${failureSummary || "no error detail"}`);
  const last = input.failures[input.failures.length - 1];
  const detail = last
    ? formatProviderFailure(last)
    : "no error detail";
  return renderNotice({
    title: "Turn failed",
    detail,
    footerLines,
    tone: "muted",
    interactiveMode: false,
    terminalColumns,
  });
}
