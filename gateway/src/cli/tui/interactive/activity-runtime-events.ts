import type { RuntimeEvent } from "../../../models/types";
import { formatBashCommandDisplay } from "../components/activity-feed/bash-format";
import type { ActivityUpdate } from "./activity-state";

function detailFromParts(parts: string[]): string | undefined {
  const detail = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "<none>")
    .join(" · ");
  return detail || undefined;
}

function payloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = (value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeToolName(payload: Record<string, unknown>): string {
  return payloadString(payload, "tool_name")?.trim() || "unknown_tool";
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
    case "ask_user":
    case "ask_user_question":
      return "Ask";
    default:
      return toolName.replace(/[_-]+/g, " ");
  }
}

function compactRuntimeText(value: string | undefined, maxChars = 120): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function formatDurationMs(durationMs: number | undefined): string | undefined {
  if (typeof durationMs !== "number") {
    return undefined;
  }
  const ms = Math.max(0, Math.round(durationMs));
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  }
  return `${String(Math.round(seconds))}s`;
}

function fieldDetail(label: string, value: string | undefined): string {
  if (!value || value === "<none>") {
    return "";
  }
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(value)) {
    return `${label} ${value.replace(/[_-]+/g, " ")}`;
  }
  return `${label} ${value}`;
}

function buildToolInputDetail(toolName: string, payload: Record<string, unknown>): string | undefined {
  const inputSummary = payloadRecord(payload, "input_summary");
  if (toolName === "bash") {
    const commandPreview = formatBashCommandDisplay(payloadString(inputSummary, "command_preview") ?? "");
    return commandPreview ? `$ ${commandPreview.replace(/"/g, "'")}` : undefined;
  }
  const path = compactRuntimeText(
    payloadString(inputSummary, "path") ?? payloadString(inputSummary, "file_path"),
    120,
  );
  if (path) {
    return path;
  }
  const query = compactRuntimeText(
    payloadString(inputSummary, "query") ?? payloadString(inputSummary, "pattern"),
    120,
  );
  return query || undefined;
}

function resolveToolStartDetail(toolName: string, payload: Record<string, unknown>): string | undefined {
  const inputSummary = payloadRecord(payload, "input_summary");
  const status = firstString(
    payloadString(payload, "status"),
    payloadString(payload, "state"),
    payloadString(inputSummary, "status"),
    payloadString(inputSummary, "state"),
  ).toLowerCase();
  const permission = firstString(
    payloadString(payload, "permission_state"),
    payloadString(payload, "permission_status"),
    payloadString(inputSummary, "permission_state"),
    payloadString(inputSummary, "permission_status"),
  ).toLowerCase();
  const classifier = firstString(
    payloadString(payload, "classifier"),
    payloadString(payload, "classifier_state"),
    payloadString(inputSummary, "classifier"),
    payloadString(inputSummary, "classifier_state"),
  ).toLowerCase();
  if (status === "queued" || status === "waiting" || status === "pending") {
    return "Waiting…";
  }
  if (status === "waiting_for_permission" || permission === "waiting" || permission === "pending") {
    return "Waiting for permission…";
  }
  if (status === "classifier_checking" || classifier === "checking") {
    return classifier.includes("auto")
      ? "Auto classifier checking…"
      : toolName === "bash" || classifier.includes("bash")
        ? "Bash classifier checking…"
        : "Classifier checking…";
  }
  return undefined;
}

export function resolveRuntimeEventActivity(event: RuntimeEvent): ActivityUpdate | undefined {
  const payload = event.payload;
  if (event.eventType === "tool_start") {
    const toolName = normalizeToolName(payload);
    const label = humanToolLabel(toolName);
    const detail = buildToolInputDetail(toolName, payload);
    return {
      stageId: `tool_start_${toolName}`,
      text: compactRuntimeText(
        detail ? `${label} ${detail}` : `${label}${toolName === "bash" ? "" : " tool"}`,
        140,
      ),
      detail: resolveToolStartDetail(toolName, payload),
      status: "running",
    };
  }
  if (event.eventType === "tool_end") {
    const toolName = normalizeToolName(payload);
    const label = humanToolLabel(toolName);
    const status = payloadString(payload, "status") ?? "ok";
    const outputSummary = payloadRecord(payload, "output_summary");
    const exitCode = payloadNumber(outputSummary, "exit_code");
    const duration = formatDurationMs(payloadNumber(payload, "duration_ms"));
    const failed = status === "failed"
      || (toolName === "bash" && typeof exitCode === "number" && exitCode !== 0);
    return {
      stageId: failed ? `tool_end_failed_${toolName}` : `tool_end_done_${toolName}`,
      text: failed ? `${label} failed` : `${label} completed`,
      detail: detailFromParts([
        typeof exitCode === "number" ? `exit ${String(exitCode)}` : "",
        duration ?? "",
      ]),
      status: failed ? "error" : "done",
    };
  }
  if (event.eventType === "tool_recovery") {
    const toolName = normalizeToolName(payload);
    return {
      stageId: `tool_recovery_${toolName}`,
      text: "Recovering tool call",
      detail: detailFromParts([
        humanToolLabel(toolName),
        fieldDetail("reason", payloadString(payload, "recovery_reason")),
      ]),
      status: "warning",
    };
  }
  if (event.eventType === "model_request") {
    return {
      stageId: "runtime_model_request",
      text: "Sending model request",
      detail: fieldDetail("provider", payloadString(payload, "provider")),
    };
  }
  if (event.eventType === "model_response") {
    return {
      stageId: "runtime_model_response",
      text: "Model response received",
      detail: "formatting final reply",
      status: "done",
    };
  }
  if (event.eventType === "turn_failed") {
    return {
      stageId: "turn_failed",
      text: "Execution failed; see error output",
      detail: fieldDetail("reason", payloadString(payload, "error_class")),
      status: "error",
    };
  }
  return undefined;
}
