#[derive(Debug, Clone, Copy)]
pub(crate) struct ToolRecoveryPolicy {
    pub(crate) stage: &'static str,
    pub(crate) recommended_next_action: &'static str,
    pub(crate) recoverable: bool,
}

impl ToolRecoveryPolicy {
    const fn new(stage: &'static str, recommended_next_action: &'static str, recoverable: bool) -> Self {
        Self {
            stage,
            recommended_next_action,
            recoverable,
        }
    }
}

pub(crate) fn classify_tool_recovery(error_class: &str, risk_class: &str) -> ToolRecoveryPolicy {
    match error_class {
        "tool_execution_deferred" => {
            ToolRecoveryPolicy::new("observe_first", "observe_prior_tool_result", true)
        }
        "invalid_tool_arguments" | "range_out_of_bounds" => {
            ToolRecoveryPolicy::new("local_fix", "fix_tool_arguments", true)
        }
        "edit_no_changes" | "write_no_changes" => {
            ToolRecoveryPolicy::new("local_fix", "stop_or_change_target_content", true)
        }
        "edit_overlap" => ToolRecoveryPolicy::new("local_fix", "split_non_overlapping_edits", true),
        "path_not_found" => {
            ToolRecoveryPolicy::new("local_fix", "locate_path_with_glob_before_retry", true)
        }
        "write_read_required" | "edit_read_required" | "write_partial_read_not_allowed" => {
            ToolRecoveryPolicy::new("local_fix", "read_target_before_mutation", true)
        }
        "write_stale_target" | "edit_stale_target" => {
            ToolRecoveryPolicy::new("local_fix", "reread_target_then_retry", true)
        }
        "tool_argument_not_visible" => {
            ToolRecoveryPolicy::new("strategy_switch", "inspect_visible_tool_schema_then_retry", true)
        }
        "tool_not_visible" | "tool_disabled" | "unsupported_tool" | "tool_call_not_supported"
        | "tool_dispatch_not_implemented" | "mcp_tool_not_found" => {
            ToolRecoveryPolicy::new("strategy_switch", "switch_tool_strategy", true)
        }
        "tool_overlap_blocked" => {
            ToolRecoveryPolicy::new("strategy_switch", "use_suggested_distinct_tool", true)
        }
        "semantic_tool_unavailable" => {
            ToolRecoveryPolicy::new("strategy_switch", "use_search_or_glob_fallback", true)
        }
        "mcp_timeout" | "mcp_queue_timeout" | "mcp_server_busy" | "mcp_circuit_open"
        | "mcp_transport_error" | "mcp_protocol_error" | "mcp_rpc_error" | "mcp_spawn_failed"
        | "mcp_server_unavailable" | "bash_timeout" => {
            ToolRecoveryPolicy::new("strategy_switch", "retry_with_smaller_scope_or_wait", true)
        }
        "binary_file_not_supported" => {
            ToolRecoveryPolicy::new("strategy_switch", "use_media_read_or_external_extractor", true)
        }
        "bash_not_allowed" | "bash_security_denied" | "mcp_policy_denied" => {
            ToolRecoveryPolicy::new("ask_user", "request_approval_or_use_safer_tool", false)
        }
        "runtime_state_unavailable" | "tool_context_invalid" => {
            ToolRecoveryPolicy::new("ask_user", "request_environment_fix", false)
        }
        "config_missing" => {
            ToolRecoveryPolicy::new("ask_user", "ask_user_for_config_or_switch_provider", false)
        }
        _ if risk_class == "unknown" => ToolRecoveryPolicy::new("strategy_switch", "avoid_unknown_tool", true),
        _ => ToolRecoveryPolicy::new("strategy_switch", "inspect_error_and_switch_strategy", true),
    }
}
