const TURN_EXECUTE_ALLOWED_FIELDS: &[&str] = &[
    "request_id",
    "session_key",
    "system_prompt",
    "user_message",
    "context_lines",
    "model_config",
    "tool_context",
    "attachments",
    "event_stream",
];

const TURN_MODEL_CONFIG_ALLOWED_FIELDS: &[&str] = &[
    "base_url",
    "api_key",
    "model",
    "timeout_ms",
    "provider_kind",
    "provider_options",
];

const TURN_PROVIDER_OPTIONS_ALLOWED_FIELDS: &[&str] = &["kimi"];

const TURN_KIMI_ALLOWED_FIELDS: &[&str] = &[
    "web_search_mode",
    "disable_thinking_on_builtin_web_search",
    "official_tools_allowlist",
    "official_tool_formulas",
    "prompt_cache",
    "max_tokens",
    "stream",
    "temperature",
    "top_p",
    "files_enabled",
    "allow_file_admin",
];

const TURN_PROMPT_CACHE_ALLOWED_FIELDS: &[&str] =
    &["enabled", "strategy", "user_last_n", "capability"];

const TURN_TOOL_CONTEXT_ALLOWED_FIELDS: &[&str] = &[
    "work_dir",
    "enabled_tools",
    "model_visible_tools",
    "tool_surface_profile",
    "tool_surface_source",
    "tool_surface_reason",
    "tool_policy_version",
    "advanced_tool_schema",
    "bash_allowlist",
    "max_tool_rounds",
    "no_tool_fallback_mode",
    "max_recovery_rounds",
];

const TURN_ATTACHMENT_ALLOWED_FIELDS: &[&str] =
    &["type", "source_type", "source", "mime_type", "filename"];

fn validate_known_fields(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
    parent_field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    for (key, value) in object {
        if !allowed.contains(&key.as_str()) {
            let field = if parent_field.is_empty() {
                key.to_string()
            } else {
                format!("{parent_field}.{key}")
            };
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                &field,
                value,
                recovery_hint,
            ));
        }
    }
    Ok(())
}
