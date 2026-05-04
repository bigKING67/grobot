import { type StatusIndicatorMode } from "../../tui/screens/status-indicator-screen";

export type InteractiveDiagnosticsMode = "compact" | "verbose" | "trace";
export type ProcessFailureCategory = "runtime" | "context" | "ask-user" | "interrupt";
export type ProcessSummaryDetail = "none" | "compact" | "full";

export interface ProcessActivitySnapshot {
  stageId: string;
  text: string;
}

export function formatTurnElapsedCompact(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours)}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${String(seconds)}s`;
}

export function compactSummaryText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function resolveInlineStatusIndicatorMode(input: {
  planMode: boolean;
  activityKind?: string;
  stageId?: string;
}): StatusIndicatorMode {
  const stageId = input.stageId ?? "";
  if (
    stageId.startsWith("runtime_model")
    || stageId.startsWith("runtime_route")
    || stageId.startsWith("runtime_retry")
  ) {
    return "requesting";
  }
  if (input.activityKind === "ask-user") {
    return "tool-input";
  }
  if (
    input.activityKind === "context"
    || input.activityKind === "governance"
    || input.activityKind === "memory"
    || input.activityKind === "plan"
  ) {
    return "thinking";
  }
  return input.planMode ? "thinking" : "responding";
}

export function resolveProcessFailureCategory(input: {
  result: "ok" | "error" | "interrupted";
  activitySnapshot?: ProcessActivitySnapshot;
  pendingAskCount?: number;
}): ProcessFailureCategory | undefined {
  if (input.result === "ok") {
    return undefined;
  }
  const stageId = input.activitySnapshot?.stageId ?? "";
  if (stageId.startsWith("ask_user")) {
    return "ask-user";
  }
  if (stageId.startsWith("context_")) {
    return "context";
  }
  if ((input.pendingAskCount ?? 0) > 0) {
    return "ask-user";
  }
  if (input.result === "interrupted" || stageId === "interrupt") {
    return "interrupt";
  }
  return "runtime";
}

export function resolveProcessResultCode(result: "ok" | "error" | "interrupted"): "ok" | "err" | "int" {
  if (result === "error") {
    return "err";
  }
  if (result === "interrupted") {
    return "int";
  }
  return "ok";
}

export function resolveProcessSummaryDetail(): ProcessSummaryDetail {
  const raw = process.env.GROBOT_PROCESS_SUMMARY_DETAIL?.trim().toLowerCase();
  if (raw === "none") {
    return "none";
  }
  if (raw === "full") {
    return "full";
  }
  if (raw === "compact") {
    return "compact";
  }
  return "none";
}

export function resolveInteractiveDiagnosticsMode(input: {
  interactiveDiagnosticsMode?: InteractiveDiagnosticsMode;
  interactiveDiagnosticsEnabled?: boolean;
}): InteractiveDiagnosticsMode {
  if (input.interactiveDiagnosticsMode === "trace") {
    return "trace";
  }
  if (input.interactiveDiagnosticsMode === "verbose") {
    return "verbose";
  }
  if (input.interactiveDiagnosticsMode === "compact") {
    return "compact";
  }
  return input.interactiveDiagnosticsEnabled ? "verbose" : "compact";
}
