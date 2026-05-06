import type { RuntimeEvent } from "../../../../models/types";
import { compactSpaces } from "../../terminal/display-width";
import type { ActivityFeedRow } from "./contract";
import { formatBashCommandDisplay } from "./bash-format";

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

function payloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return isRecord(value) ? value : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function firstString(...values: string[]): string {
  for (const value of values) {
    const normalized = compactSpaces(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function compactPath(path: string): string {
  const normalized = compactSpaces(path);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/^\.?\//, "");
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

function normalizeToolName(payload: Record<string, unknown>): string {
  return firstString(payloadString(payload, "tool_name")) || "unknown_tool";
}

function resolveCommandPreview(payload: Record<string, unknown>, inputSummary: Record<string, unknown>): string {
  return formatBashCommandDisplay(firstString(
    payloadString(inputSummary, "command_preview"),
    payloadString(inputSummary, "command"),
    payloadString(payload, "command_preview"),
    payloadString(payload, "command"),
  ));
}

function resolveClassifierLine(toolName: string, classifier: string): string {
  const normalized = classifier.trim().toLowerCase();
  if (normalized.includes("auto")) {
    return "Auto classifier checking…";
  }
  if (toolName === "bash" || normalized.includes("bash")) {
    return "Bash classifier checking…";
  }
  return "Classifier checking…";
}

function resolveToolStartState(input: {
  toolName: string;
  payload: Record<string, unknown>;
  inputSummary: Record<string, unknown>;
}): Pick<ActivityFeedRow, "detailLines" | "state"> {
  const status = firstString(
    payloadString(input.payload, "status"),
    payloadString(input.payload, "state"),
    payloadString(input.inputSummary, "status"),
    payloadString(input.inputSummary, "state"),
  ).toLowerCase();
  const permission = firstString(
    payloadString(input.payload, "permission_state"),
    payloadString(input.payload, "permission_status"),
    payloadString(input.inputSummary, "permission_state"),
    payloadString(input.inputSummary, "permission_status"),
  ).toLowerCase();
  const classifier = firstString(
    payloadString(input.payload, "classifier_state"),
    payloadString(input.payload, "classifier"),
    payloadString(input.inputSummary, "classifier_state"),
    payloadString(input.inputSummary, "classifier"),
  );
  if (status === "queued" || status === "waiting" || status === "pending") {
    return { detailLines: ["Waiting…"], state: "queued" };
  }
  if (status === "waiting_for_permission" || permission === "waiting" || permission === "pending") {
    return { detailLines: ["Waiting for permission…"], state: "running" };
  }
  if (status === "classifier_checking" || classifier.toLowerCase() === "checking") {
    return { detailLines: [resolveClassifierLine(input.toolName, classifier)], state: "running" };
  }
  return {
    detailLines: input.toolName === "bash" ? ["Running…"] : [],
    state: "running",
  };
}

export function buildActivityToolStartRow(event: RuntimeEvent): ActivityFeedRow | undefined {
  const payload = normalizePayload(event);
  const toolName = normalizeToolName(payload);
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
    ? resolveCommandPreview(payload, inputSummary)
    : "";
  const title = compactSpaces(
    toolName === "bash" && commandPreview
      ? `${label} $ ${commandPreview.replace(/"/g, "'")}`
      : `${label}${path ? ` ${path}` : ""}${query ? ` ${query}` : ""}`,
  );
  if (!title) {
    return undefined;
  }
  const startState = resolveToolStartState({ toolName, payload, inputSummary });
  return {
    title,
    detailLines: startState.detailLines,
    severity: "ok",
    state: startState.state,
  };
}
