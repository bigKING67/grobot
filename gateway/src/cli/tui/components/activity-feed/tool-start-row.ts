import type { RuntimeEvent } from "../../../../models/types";
import { compactSpaces } from "../../terminal/display-width";
import type { ActivityFeedRow } from "./contract";
import { formatBashCommandDisplay } from "./bash-format";
import {
  firstString,
  humanToolLabel,
  normalizeActivityPayload,
  normalizeToolName,
  payloadRecord,
  payloadString,
  payloadToolCallId,
} from "./tool-event";

function compactPath(path: string): string {
  const normalized = compactSpaces(path);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/^\.?\//, "");
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
  const payload = normalizeActivityPayload(event);
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
    kind: "tool",
    toolName,
    toolCallId: payloadToolCallId(payload) || undefined,
  };
}
