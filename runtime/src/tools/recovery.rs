#[derive(Debug, Clone, Copy)]
pub(crate) struct ToolRecoveryPolicy {
    pub(crate) stage: &'static str,
    pub(crate) recommended_next_action: &'static str,
    pub(crate) recoverable: bool,
}

impl ToolRecoveryPolicy {
    const fn new(
        stage: &'static str,
        recommended_next_action: &'static str,
        recoverable: bool,
    ) -> Self {
        Self {
            stage,
            recommended_next_action,
            recoverable,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ToolRecoveryCatalogRow {
    error_classes: &'static [&'static str],
    risk_class: &'static str,
    stage: &'static str,
    recommended_next_action: &'static str,
    recoverable: bool,
}

impl ToolRecoveryCatalogRow {
    const fn new(
        error_classes: &'static [&'static str],
        risk_class: &'static str,
        stage: &'static str,
        recommended_next_action: &'static str,
        recoverable: bool,
    ) -> Self {
        Self {
            error_classes,
            risk_class,
            stage,
            recommended_next_action,
            recoverable,
        }
    }
}

const TOOL_RECOVERY_POLICY_VERSION: &str = "v1";

const TOOL_RECOVERY_CATALOG: &[ToolRecoveryCatalogRow] = &[
    ToolRecoveryCatalogRow::new(
        &["tool_execution_deferred"],
        "*",
        "observe_first",
        "observe_prior_tool_result",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["invalid_tool_arguments", "range_out_of_bounds"],
        "*",
        "local_fix",
        "fix_tool_arguments",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["edit_no_changes", "write_no_changes"],
        "*",
        "local_fix",
        "stop_or_change_target_content",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["edit_overlap"],
        "*",
        "local_fix",
        "split_non_overlapping_edits",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["edit_match_not_unique"],
        "*",
        "local_fix",
        "narrow_edit_old_text_to_unique_match",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["edit_not_found"],
        "*",
        "local_fix",
        "reread_target_then_retry_exact_old_text",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["edit_mixed_line_endings_not_supported"],
        "*",
        "strategy_switch",
        "use_write_or_normalize_line_endings",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["path_not_found"],
        "*",
        "local_fix",
        "locate_path_with_glob_before_retry",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["path_escape_blocked"],
        "*",
        "local_fix",
        "choose_workspace_relative_path",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["path_invalid"],
        "*",
        "local_fix",
        "choose_regular_file_path",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["write_read_required", "edit_read_required", "write_partial_read_not_allowed"],
        "*",
        "local_fix",
        "read_target_before_mutation",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["write_stale_target", "edit_stale_target"],
        "*",
        "local_fix",
        "reread_target_then_retry",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["tool_argument_not_visible"],
        "*",
        "strategy_switch",
        "inspect_visible_tool_schema_then_retry",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &[
            "tool_not_visible",
            "tool_disabled",
            "unsupported_tool",
            "tool_call_not_supported",
            "tool_dispatch_not_implemented",
            "mcp_tool_not_found",
        ],
        "*",
        "strategy_switch",
        "switch_tool_strategy",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["tool_overlap_blocked"],
        "*",
        "strategy_switch",
        "use_suggested_distinct_tool",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["semantic_tool_unavailable"],
        "*",
        "strategy_switch",
        "use_search_or_glob_fallback",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["mcp_tool_result_error"],
        "*",
        "strategy_switch",
        "inspect_error_and_switch_strategy",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &[
            "mcp_timeout",
            "mcp_queue_timeout",
            "mcp_server_busy",
            "mcp_circuit_open",
            "mcp_transport_error",
            "mcp_protocol_error",
            "mcp_rpc_error",
            "mcp_spawn_failed",
            "mcp_server_unavailable",
            "bash_timeout",
        ],
        "*",
        "strategy_switch",
        "retry_with_smaller_scope_or_wait",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["binary_file_not_supported"],
        "*",
        "strategy_switch",
        "use_media_read_or_external_extractor",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["bash_not_allowed", "bash_security_denied", "mcp_policy_denied"],
        "*",
        "ask_user",
        "request_approval_or_use_safer_tool",
        false,
    ),
    ToolRecoveryCatalogRow::new(
        &["runtime_state_unavailable", "tool_context_invalid"],
        "*",
        "ask_user",
        "request_environment_fix",
        false,
    ),
    ToolRecoveryCatalogRow::new(
        &["config_missing"],
        "*",
        "ask_user",
        "ask_user_for_config_or_switch_provider",
        false,
    ),
    ToolRecoveryCatalogRow::new(
        &["*"],
        "unknown",
        "strategy_switch",
        "avoid_unknown_tool",
        true,
    ),
    ToolRecoveryCatalogRow::new(
        &["*"],
        "*",
        "strategy_switch",
        "inspect_error_and_switch_strategy",
        true,
    ),
];

fn stable_recovery_json_stringify(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(boolean) => {
            if *boolean {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Value::Number(number) => number.to_string(),
        Value::String(text) => serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string()),
        Value::Array(items) => {
            let rows = items
                .iter()
                .map(stable_recovery_json_stringify)
                .collect::<Vec<String>>()
                .join(",");
            format!("[{rows}]")
        }
        Value::Object(map) => {
            let rows = map
                .iter()
                .map(|(key, item)| (key, stable_recovery_json_stringify(item)))
                .collect::<Vec<(&String, String)>>();
            let mut sorted = rows;
            sorted.sort_by(|left, right| left.0.cmp(right.0));
            let body = sorted
                .into_iter()
                .map(|(key, item)| {
                    let key_json =
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string());
                    format!("{key_json}:{item}")
                })
                .collect::<Vec<String>>()
                .join(",");
            format!("{{{body}}}")
        }
    }
}

fn fnv1a32_hex_from_utf8(value: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in value.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn stable_recovery_catalog_fingerprint(prefix: &str, payload: &Value) -> String {
    let text = stable_recovery_json_stringify(payload);
    format!("{prefix}:{}", fnv1a32_hex_from_utf8(&text))
}

pub(crate) fn tool_recovery_policy_version() -> &'static str {
    TOOL_RECOVERY_POLICY_VERSION
}

pub(crate) fn tool_recovery_catalog() -> Vec<Value> {
    TOOL_RECOVERY_CATALOG
        .iter()
        .map(|row| {
            json!({
                "error_classes": row.error_classes,
                "risk_class": row.risk_class,
                "stage": row.stage,
                "recommended_next_action": row.recommended_next_action,
                "recoverable": row.recoverable,
            })
        })
        .collect()
}

pub(crate) fn tool_recovery_action_names() -> Vec<&'static str> {
    let mut seen = std::collections::HashSet::new();
    let mut rows = Vec::new();
    for row in TOOL_RECOVERY_CATALOG {
        if seen.insert(row.recommended_next_action) {
            rows.push(row.recommended_next_action);
        }
    }
    rows
}

pub(crate) fn tool_recovery_catalog_fingerprint(catalog: &[Value]) -> String {
    stable_recovery_catalog_fingerprint(
        "recovery_catalog",
        &json!({
            "policy_version": TOOL_RECOVERY_POLICY_VERSION,
            "catalog": catalog,
        }),
    )
}

pub(crate) fn classify_tool_recovery(error_class: &str, risk_class: &str) -> ToolRecoveryPolicy {
    for row in TOOL_RECOVERY_CATALOG {
        let risk_matches = row.risk_class == "*" || row.risk_class == risk_class;
        if !risk_matches {
            continue;
        }
        let error_matches = row.error_classes.contains(&"*") || row.error_classes.contains(&error_class);
        if !error_matches {
            continue;
        }
        return ToolRecoveryPolicy::new(
            row.stage,
            row.recommended_next_action,
            row.recoverable,
        );
    }
    ToolRecoveryPolicy::new("strategy_switch", "inspect_error_and_switch_strategy", true)
}
