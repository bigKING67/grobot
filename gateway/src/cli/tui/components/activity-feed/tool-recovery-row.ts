import type { RuntimeEvent } from "../../../../models/types";
import { compactSpaces } from "../../terminal/display-width";
import { formatTuiErrorClassLabel } from "../error-labels";
import type { ActivityFeedRow } from "./contract";
import {
  firstString,
  humanToolLabel,
  normalizeActivityPayload,
  payloadString,
  payloadToolCallId,
} from "./tool-event";

function detailFromParts(parts: string[]): string | undefined {
  const detail = parts
    .map((part) => compactSpaces(part))
    .filter(Boolean)
    .join(" · ");
  return detail || undefined;
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

export function buildRecoveryRow(event: RuntimeEvent): ActivityFeedRow | undefined {
  const payload = normalizeActivityPayload(event);
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
    kind: "recovery",
    toolName,
    toolCallId: payloadToolCallId(payload) || undefined,
  };
}
