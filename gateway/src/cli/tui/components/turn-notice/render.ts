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

function formatProviderFailure(item: RuntimeFailureSummaryInput["failures"][number]): string {
  return `${compactNoticeText(item.providerName, "未知通道")} · ${formatTuiErrorClassLabel(item.errorClass) || "运行时错误"}`;
}

function formatRuntimeErrorLine(line: string): string {
  const normalized = compactNoticeText(line);
  if (!normalized) {
    return "";
  }
  if (normalized === "timeout") {
    return "请求超时";
  }
  if (normalized === "server failed") {
    return "服务执行失败";
  }
  if (normalized === "caused by connection refused") {
    return "连接被拒绝";
  }
  if (normalized === "socket closed before handshake") {
    return "握手前连接关闭";
  }
  return normalized
    .replace(/\bRuntimeRpcError:\s*/gi, "")
    .replace(/\bruntime rpc error\s*-?\d*:\s*/gi, "")
    .replace(/\bruntime turn execution failed\b/gi, "运行时执行失败")
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
  const lines = sanitized.length > 0 ? sanitized : ["无错误明细"];
  const visible = lines
    .slice(0, MAX_ERROR_DETAIL_LINES)
    .map((line, index) =>
      truncateDisplayWidth(
        index === 0 ? `最近错误 ${line}` : line,
        Math.max(24, terminalColumns - 6),
      )
    );
  const hiddenCount = Math.max(0, lines.length - visible.length);
  if (hiddenCount > 0) {
    visible.push(`… 还有 ${String(hiddenCount)} 行`);
  }
  return visible;
}

export function renderManagementInterruptNotice(interactiveMode: boolean): string {
  return renderNotice({
    title: "会话已中断",
    detail: interactiveMode
      ? "管理端已跳过当前输入"
      : "管理端已跳过当前请求",
    tone: "muted",
    interactiveMode,
  });
}

export function renderTurnInterruptedNotice(interactiveMode: boolean): string {
  return renderNotice({
    title: "回合已中断",
    detail: interactiveMode ? "可以继续输入新指令。" : undefined,
    tone: "muted",
    interactiveMode,
  });
}

export function renderRuntimeOpenCircuitNotice(interactiveMode: boolean): string {
  return renderNotice({
    title: "所有模型通道暂不可用",
    detail: interactiveMode
      ? "稍后重试，或用 /model 切换模型"
      : "请切换模型后再执行",
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
  footerLines.push(`尝试顺序 ${attemptedProviders || "无可用通道"}`);
  footerLines.push(`失败通道 ${failureSummary || "无错误明细"}`);
  const last = input.failures[input.failures.length - 1];
  const detail = last
    ? formatProviderFailure(last)
    : "无错误明细";
  return renderNotice({
    title: "回合执行失败",
    detail,
    footerLines,
    tone: "muted",
    interactiveMode: false,
    terminalColumns,
  });
}
