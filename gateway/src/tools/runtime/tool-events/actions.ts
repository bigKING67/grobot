import {
  RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS,
  type RuntimeToolRecoveryAction,
  type RuntimeToolRecoveryActionClassification,
} from "./contract";

export function isRuntimeToolRecoveryAction(value: string): value is RuntimeToolRecoveryAction {
  return Object.prototype.hasOwnProperty.call(RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS, value);
}

export function normalizeRuntimeToolRecoveryAction(
  value: string | null | undefined,
): RuntimeToolRecoveryAction {
  const normalized = typeof value === "string" ? value.trim() : "";
  return isRuntimeToolRecoveryAction(normalized)
    ? normalized
    : "inspect_error_and_switch_strategy";
}

export function knownRuntimeToolRecoveryActions(): RuntimeToolRecoveryAction[] {
  return Object.keys(RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS) as RuntimeToolRecoveryAction[];
}

export function classifyRuntimeToolRecoveryAction(
  action: string | null | undefined,
): RuntimeToolRecoveryActionClassification {
  const normalized = typeof action === "string" ? action.trim() : "";
  if (!normalized) {
    return {
      action: null,
      family: "none",
      reason: "no_action",
    };
  }
  switch (normalized) {
    case "observe_prior_tool_result":
      return { action: normalized, family: "observe", reason: "observe_prior_tool_result" };
    case "fix_tool_arguments":
    case "fix_mcp_tool_arguments":
    case "inspect_mcp_tool_result_and_change_arguments":
      return { action: normalized, family: "argument_fix", reason: normalized };
    case "reduce_mcp_argument_payload":
      return { action: normalized, family: "payload_reduce", reason: normalized };
    case "stop_or_change_target_content":
    case "split_non_overlapping_edits":
    case "narrow_edit_old_text_to_unique_match":
    case "reread_target_then_retry_exact_old_text":
    case "use_write_or_normalize_line_endings":
    case "read_target_before_mutation":
    case "reread_target_then_retry":
      return { action: normalized, family: "content_fix", reason: normalized };
    case "locate_path_with_glob_before_retry":
    case "choose_workspace_relative_path":
    case "choose_regular_file_path":
      return { action: normalized, family: "path_fix", reason: normalized };
    case "inspect_visible_tool_schema_then_retry":
      return { action: normalized, family: "schema_fix", reason: normalized };
    case "switch_tool_strategy":
    case "use_suggested_distinct_tool":
    case "inspect_error_and_switch_strategy":
    case "inspect_mcp_rpc_error_and_switch_strategy":
      return { action: normalized, family: "strategy_switch", reason: normalized };
    case "use_search_or_glob_fallback":
      return { action: normalized, family: "fallback_tool", reason: normalized };
    case "retry_with_smaller_scope_or_wait":
      return { action: normalized, family: "wait_or_retry", reason: normalized };
    case "use_media_read_or_external_extractor":
      return { action: normalized, family: "media_extract", reason: normalized };
    case "request_approval_or_use_safer_tool":
    case "use_allowed_mcp_tool_or_request_policy_change":
      return { action: normalized, family: "policy_or_permission", reason: normalized };
    case "request_environment_fix":
      return { action: normalized, family: "environment_fix", reason: normalized };
    case "ask_user_for_config_or_switch_provider":
      return { action: normalized, family: "user_intervention", reason: normalized };
    case "avoid_unknown_tool":
      return { action: normalized, family: "unknown_tool", reason: normalized };
    default:
      return { action: normalized, family: "unknown", reason: "uncataloged_action" };
  }
}
