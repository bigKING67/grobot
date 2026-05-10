const STDERR_EVENT_STREAM_MODE: &str = "stderr_jsonl";

fn invalid_event_stream_value(raw_value: Value) -> Value {
    json!({
        "diagnostic_kind": "invalid_event_stream",
        "field": "event_stream",
        "source": "event_stream",
        "raw_value": raw_value,
        "valid_values": [STDERR_EVENT_STREAM_MODE, "stderr-jsonl"],
        "recovery_hint": "omit event_stream to disable runtime event streaming, or set it to stderr_jsonl",
    })
}

fn parse_event_stream_mode(value: Option<&Value>) -> Result<bool, Value> {
    let Some(value) = value else {
        return Ok(false);
    };
    let Some(raw_value) = value.as_str() else {
        return Err(invalid_event_stream_value(value.clone()));
    };
    let normalized = raw_value.trim().to_ascii_lowercase().replace('-', "_");
    if normalized == STDERR_EVENT_STREAM_MODE {
        return Ok(true);
    }
    Err(invalid_event_stream_value(json!(raw_value)))
}

fn invalid_turn_execute_shape(
    diagnostic_kind: &str,
    field: &str,
    raw_value: &Value,
    recovery_hint: &str,
) -> Value {
    json!({
        "diagnostic_kind": diagnostic_kind,
        "field": field,
        "source": format!("runtime.turn.execute.params.{field}"),
        "raw_value": raw_value,
        "recovery_hint": recovery_hint,
    })
}

fn validate_optional_object_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    if let Some(value) = parent.get(key) {
        if !value.is_object() {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                field,
                value,
                recovery_hint,
            ));
        }
    }
    Ok(())
}

fn validate_optional_string_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    if let Some(value) = parent.get(key) {
        if !value.is_string() {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                field,
                value,
                recovery_hint,
            ));
        }
    }
    Ok(())
}

fn validate_required_string_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    diagnostic_kind: &str,
    missing_hint: &str,
    empty_hint: &str,
) -> Result<(), Value> {
    let Some(value) = parent.get(key) else {
        return Err(invalid_turn_execute_shape(
            diagnostic_kind,
            key,
            &Value::Null,
            missing_hint,
        ));
    };
    let Some(raw_value) = value.as_str() else {
        return Err(invalid_turn_execute_shape(
            diagnostic_kind,
            key,
            value,
            missing_hint,
        ));
    };
    if raw_value.trim().is_empty() {
        return Err(invalid_turn_execute_shape(
            diagnostic_kind,
            key,
            value,
            empty_hint,
        ));
    }
    Ok(())
}

fn validate_optional_bool_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    if let Some(value) = parent.get(key) {
        if !value.is_boolean() {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                field,
                value,
                recovery_hint,
            ));
        }
    }
    Ok(())
}

fn validate_optional_u32_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    if let Some(value) = parent.get(key) {
        let Some(raw_value) = value.as_u64() else {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                field,
                value,
                recovery_hint,
            ));
        };
        if raw_value > u64::from(u32::MAX) {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                field,
                value,
                recovery_hint,
            ));
        }
    }
    Ok(())
}

fn validate_optional_u64_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    if let Some(value) = parent.get(key) {
        if value.as_u64().is_none() {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                field,
                value,
                recovery_hint,
            ));
        }
    }
    Ok(())
}

fn validate_optional_number_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    if let Some(value) = parent.get(key) {
        if !value.is_number() {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                field,
                value,
                recovery_hint,
            ));
        }
    }
    Ok(())
}

fn validate_optional_string_array_shape(
    parent: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
    diagnostic_kind: &str,
    recovery_hint: &str,
) -> Result<(), Value> {
    let Some(value) = parent.get(key) else {
        return Ok(());
    };
    let Some(items) = value.as_array() else {
        return Err(invalid_turn_execute_shape(
            diagnostic_kind,
            field,
            value,
            recovery_hint,
        ));
    };
    for (index, item) in items.iter().enumerate() {
        if !item.is_string() {
            return Err(invalid_turn_execute_shape(
                diagnostic_kind,
                &format!("{field}[{index}]"),
                item,
                recovery_hint,
            ));
        }
    }
    Ok(())
}

fn validate_turn_prompt_cache_field_shapes(
    prompt_cache: &serde_json::Map<String, Value>,
) -> Result<(), Value> {
    validate_optional_bool_shape(
        prompt_cache,
        "enabled",
        "model_config.provider_options.kimi.prompt_cache.enabled",
        "invalid_model_config_provider_options_kimi_prompt_cache_enabled_shape",
        "omit prompt_cache.enabled to use the runtime default, or pass true/false",
    )?;
    validate_optional_string_shape(
        prompt_cache,
        "strategy",
        "model_config.provider_options.kimi.prompt_cache.strategy",
        "invalid_model_config_provider_options_kimi_prompt_cache_strategy_shape",
        "omit prompt_cache.strategy to use the runtime default, or pass a strategy string",
    )?;
    validate_optional_u32_shape(
        prompt_cache,
        "user_last_n",
        "model_config.provider_options.kimi.prompt_cache.user_last_n",
        "invalid_model_config_provider_options_kimi_prompt_cache_user_last_n_shape",
        "omit prompt_cache.user_last_n to use the runtime default, or pass an unsigned integer",
    )?;
    validate_optional_string_shape(
        prompt_cache,
        "capability",
        "model_config.provider_options.kimi.prompt_cache.capability",
        "invalid_model_config_provider_options_kimi_prompt_cache_capability_shape",
        "omit prompt_cache.capability to use the runtime default, or pass a capability string",
    )?;
    Ok(())
}

fn validate_turn_kimi_field_shapes(
    kimi_options: &serde_json::Map<String, Value>,
) -> Result<(), Value> {
    validate_optional_string_shape(
        kimi_options,
        "web_search_mode",
        "model_config.provider_options.kimi.web_search_mode",
        "invalid_model_config_provider_options_kimi_web_search_mode_shape",
        "omit web_search_mode to use the runtime default, or pass a web-search mode string",
    )?;
    validate_optional_bool_shape(
        kimi_options,
        "disable_thinking_on_builtin_web_search",
        "model_config.provider_options.kimi.disable_thinking_on_builtin_web_search",
        "invalid_model_config_provider_options_kimi_disable_thinking_on_builtin_web_search_shape",
        "omit disable_thinking_on_builtin_web_search to use the runtime default, or pass true/false",
    )?;
    validate_optional_string_array_shape(
        kimi_options,
        "official_tools_allowlist",
        "model_config.provider_options.kimi.official_tools_allowlist",
        "invalid_model_config_provider_options_kimi_official_tools_allowlist_shape",
        "omit official_tools_allowlist to use the runtime default, or pass an array of tool-name strings",
    )?;
    validate_optional_object_shape(
        kimi_options,
        "official_tool_formulas",
        "model_config.provider_options.kimi.official_tool_formulas",
        "invalid_model_config_provider_options_kimi_official_tool_formulas_shape",
        "omit official_tool_formulas to use runtime defaults, or pass an object map of tool formulas",
    )?;
    validate_optional_object_shape(
        kimi_options,
        "prompt_cache",
        "model_config.provider_options.kimi.prompt_cache",
        "invalid_model_config_provider_options_kimi_prompt_cache_shape",
        "omit model_config.provider_options.kimi.prompt_cache to use prompt-cache defaults, or pass a prompt_cache object",
    )?;
    if let Some(prompt_cache) = kimi_options.get("prompt_cache").and_then(Value::as_object) {
        validate_turn_prompt_cache_field_shapes(prompt_cache)?;
    }
    validate_optional_u32_shape(
        kimi_options,
        "max_tokens",
        "model_config.provider_options.kimi.max_tokens",
        "invalid_model_config_provider_options_kimi_max_tokens_shape",
        "omit max_tokens to use the runtime default, or pass an unsigned integer",
    )?;
    validate_optional_bool_shape(
        kimi_options,
        "stream",
        "model_config.provider_options.kimi.stream",
        "invalid_model_config_provider_options_kimi_stream_shape",
        "omit stream to use the runtime default, or pass true/false",
    )?;
    validate_optional_number_shape(
        kimi_options,
        "temperature",
        "model_config.provider_options.kimi.temperature",
        "invalid_model_config_provider_options_kimi_temperature_shape",
        "omit temperature to use the runtime default, or pass a number",
    )?;
    validate_optional_number_shape(
        kimi_options,
        "top_p",
        "model_config.provider_options.kimi.top_p",
        "invalid_model_config_provider_options_kimi_top_p_shape",
        "omit top_p to use the runtime default, or pass a number",
    )?;
    validate_optional_bool_shape(
        kimi_options,
        "files_enabled",
        "model_config.provider_options.kimi.files_enabled",
        "invalid_model_config_provider_options_kimi_files_enabled_shape",
        "omit files_enabled to use the runtime default, or pass true/false",
    )?;
    validate_optional_bool_shape(
        kimi_options,
        "allow_file_admin",
        "model_config.provider_options.kimi.allow_file_admin",
        "invalid_model_config_provider_options_kimi_allow_file_admin_shape",
        "omit allow_file_admin to use the runtime default, or pass true/false",
    )?;
    Ok(())
}

fn validate_turn_model_config_field_shapes(
    model_config: &serde_json::Map<String, Value>,
) -> Result<(), Value> {
    validate_optional_string_shape(
        model_config,
        "base_url",
        "model_config.base_url",
        "invalid_model_config_base_url_shape",
        "omit model_config.base_url only when runtime env provides the provider endpoint, or pass an http/https URL string",
    )?;
    validate_optional_string_shape(
        model_config,
        "api_key",
        "model_config.api_key",
        "invalid_model_config_api_key_shape",
        "omit model_config.api_key only when runtime env provides the provider token, or pass a non-empty string",
    )?;
    validate_optional_string_shape(
        model_config,
        "model",
        "model_config.model",
        "invalid_model_config_model_shape",
        "omit model_config.model only when runtime env provides the model name, or pass a non-empty string",
    )?;
    validate_optional_u64_shape(
        model_config,
        "timeout_ms",
        "model_config.timeout_ms",
        "invalid_model_config_timeout_ms_shape",
        "omit model_config.timeout_ms to use the runtime default, or pass an unsigned integer",
    )?;
    validate_optional_string_shape(
        model_config,
        "provider_kind",
        "model_config.provider_kind",
        "invalid_model_config_provider_kind_shape",
        "omit provider_kind to derive it from base_url/model, or pass kimi/openai_compatible",
    )?;
    validate_optional_object_shape(
        model_config,
        "provider_options",
        "model_config.provider_options",
        "invalid_model_config_provider_options_shape",
        "omit model_config.provider_options to use provider defaults, or pass a provider_options object",
    )?;
    if let Some(provider_options) = model_config
        .get("provider_options")
        .and_then(Value::as_object)
    {
        validate_optional_object_shape(
            provider_options,
            "kimi",
            "model_config.provider_options.kimi",
            "invalid_model_config_provider_options_kimi_shape",
            "omit model_config.provider_options.kimi to use Kimi defaults, or pass a kimi options object",
        )?;
        if let Some(kimi_options) = provider_options.get("kimi").and_then(Value::as_object) {
            validate_turn_kimi_field_shapes(kimi_options)?;
        }
    }
    Ok(())
}

fn validate_turn_attachment_field_shapes(
    attachment: &serde_json::Map<String, Value>,
    index: usize,
) -> Result<(), Value> {
    validate_optional_string_shape(
        attachment,
        "type",
        &format!("attachments[{index}].type"),
        "invalid_attachments_type_shape",
        "pass each attachment type as a string: file, image, or video",
    )?;
    validate_optional_string_shape(
        attachment,
        "source_type",
        &format!("attachments[{index}].source_type"),
        "invalid_attachments_source_type_shape",
        "omit source_type to use the default, or pass path/url/file_id as a string",
    )?;
    validate_optional_string_shape(
        attachment,
        "source",
        &format!("attachments[{index}].source"),
        "invalid_attachments_source_shape",
        "pass each attachment source as a path, URL, or file id string",
    )?;
    validate_optional_string_shape(
        attachment,
        "mime_type",
        &format!("attachments[{index}].mime_type"),
        "invalid_attachments_mime_type_shape",
        "omit mime_type when unknown, or pass a MIME type string",
    )?;
    validate_optional_string_shape(
        attachment,
        "filename",
        &format!("attachments[{index}].filename"),
        "invalid_attachments_filename_shape",
        "omit filename when unknown, or pass a filename string",
    )?;
    Ok(())
}

fn validate_turn_attachments_shape(
    params_object: &serde_json::Map<String, Value>,
) -> Result<(), Value> {
    let Some(value) = params_object.get("attachments") else {
        return Ok(());
    };
    let Some(attachments) = value.as_array() else {
        return Err(invalid_turn_execute_shape(
            "invalid_attachments_shape",
            "attachments",
            value,
            "omit attachments when unused, or pass an array of attachment objects",
        ));
    };
    for (index, attachment) in attachments.iter().enumerate() {
        let Some(attachment_object) = attachment.as_object() else {
            return Err(invalid_turn_execute_shape(
                "invalid_attachments_entry_shape",
                &format!("attachments[{index}]"),
                attachment,
                "each attachment entry must be an object with type and source fields",
            ));
        };
        validate_turn_attachment_field_shapes(attachment_object, index)?;
    }
    Ok(())
}

fn validate_turn_tool_context_field_shapes(
    tool_context: &serde_json::Map<String, Value>,
) -> Result<(), Value> {
    validate_optional_string_shape(
        tool_context,
        "work_dir",
        "tool_context.work_dir",
        "invalid_tool_context_work_dir_shape",
        "omit tool_context.work_dir only when no local tools are needed, or pass a workspace path string",
    )?;
    validate_optional_string_array_shape(
        tool_context,
        "enabled_tools",
        "tool_context.enabled_tools",
        "invalid_tool_context_enabled_tools_shape",
        "omit enabled_tools to use defaults, or pass an array of tool-name strings",
    )?;
    validate_optional_string_array_shape(
        tool_context,
        "model_visible_tools",
        "tool_context.model_visible_tools",
        "invalid_tool_context_model_visible_tools_shape",
        "omit model_visible_tools to mirror enabled_tools, or pass an array of tool-name strings",
    )?;
    validate_optional_string_shape(
        tool_context,
        "tool_surface_profile",
        "tool_context.tool_surface_profile",
        "invalid_tool_context_tool_surface_profile_shape",
        "omit tool_surface_profile to use coding defaults, or pass a profile string",
    )?;
    validate_optional_string_shape(
        tool_context,
        "tool_surface_source",
        "tool_context.tool_surface_source",
        "invalid_tool_context_tool_surface_source_shape",
        "omit tool_surface_source or pass a source string",
    )?;
    validate_optional_string_shape(
        tool_context,
        "tool_surface_reason",
        "tool_context.tool_surface_reason",
        "invalid_tool_context_tool_surface_reason_shape",
        "omit tool_surface_reason or pass a reason string",
    )?;
    validate_optional_string_shape(
        tool_context,
        "tool_policy_version",
        "tool_context.tool_policy_version",
        "invalid_tool_context_tool_policy_version_shape",
        "omit tool_policy_version or pass a policy-version string",
    )?;
    validate_optional_bool_shape(
        tool_context,
        "advanced_tool_schema",
        "tool_context.advanced_tool_schema",
        "invalid_tool_context_advanced_tool_schema_shape",
        "omit advanced_tool_schema to use slim defaults, or pass true/false",
    )?;
    validate_optional_string_array_shape(
        tool_context,
        "bash_allowlist",
        "tool_context.bash_allowlist",
        "invalid_tool_context_bash_allowlist_shape",
        "omit bash_allowlist to require permission for mutating commands, or pass an array of rule strings",
    )?;
    validate_optional_u32_shape(
        tool_context,
        "max_tool_rounds",
        "tool_context.max_tool_rounds",
        "invalid_tool_context_max_tool_rounds_shape",
        "omit max_tool_rounds to use runtime defaults, or pass an unsigned integer",
    )?;
    validate_optional_string_shape(
        tool_context,
        "no_tool_fallback_mode",
        "tool_context.no_tool_fallback_mode",
        "invalid_tool_context_no_tool_fallback_mode_shape",
        "omit no_tool_fallback_mode to use safe mode, or pass off/safe/strict as a string",
    )?;
    validate_optional_u32_shape(
        tool_context,
        "max_recovery_rounds",
        "tool_context.max_recovery_rounds",
        "invalid_tool_context_max_recovery_rounds_shape",
        "omit max_recovery_rounds to use runtime defaults, or pass an unsigned integer",
    )?;
    Ok(())
}

fn validate_turn_execute_param_shapes(params: &Value) -> Result<(), Value> {
    let Some(params_object) = params.as_object() else {
        return Err(invalid_turn_execute_shape(
            "invalid_turn_execute_params",
            "params",
            params,
            "pass runtime.turn.execute params as an object with the required turn fields",
        ));
    };

    validate_required_string_shape(
        params_object,
        "request_id",
        "invalid_request_id_shape",
        "pass request_id as a non-empty string",
        "request_id must not be empty or whitespace-only",
    )?;
    validate_required_string_shape(
        params_object,
        "session_key",
        "invalid_session_key_shape",
        "pass session_key as a non-empty string",
        "session_key must not be empty or whitespace-only",
    )?;
    validate_required_string_shape(
        params_object,
        "user_message",
        "invalid_user_message_shape",
        "pass user_message as a non-empty string",
        "user_message must not be empty or whitespace-only",
    )?;
    validate_optional_string_shape(
        params_object,
        "system_prompt",
        "system_prompt",
        "invalid_system_prompt_shape",
        "omit system_prompt when unused, or pass a system prompt string",
    )?;
    validate_optional_string_array_shape(
        params_object,
        "context_lines",
        "context_lines",
        "invalid_context_lines_shape",
        "omit context_lines when unused, or pass an array of context strings",
    )?;
    validate_turn_attachments_shape(params_object)?;
    validate_optional_object_shape(
        params_object,
        "model_config",
        "model_config",
        "invalid_model_config_shape",
        "omit model_config to use runtime env/config fallback, or pass a model_config object",
    )?;
    validate_optional_object_shape(
        params_object,
        "tool_context",
        "tool_context",
        "invalid_tool_context_shape",
        "omit tool_context only for turns that do not execute local tools, or pass a tool_context object",
    )?;

    if let Some(model_config) = params_object.get("model_config").and_then(Value::as_object) {
        validate_turn_model_config_field_shapes(model_config)?;
    }

    if let Some(tool_context) = params_object.get("tool_context").and_then(Value::as_object) {
        validate_turn_tool_context_field_shapes(tool_context)?;
    }
    Ok(())
}

fn invalid_turn_execute_params_message(data: &Value) -> &'static str {
    match data
        .get("diagnostic_kind")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "invalid_request_id_shape" => "invalid_request_id",
        "invalid_session_key_shape" => "invalid_session_key",
        "invalid_user_message_shape" => "invalid_user_message",
        "invalid_model_config_shape" => "invalid_model_config",
        "invalid_model_config_provider_options_shape" => "invalid_provider_options",
        "invalid_model_config_provider_options_kimi_shape" => "invalid_provider_options_kimi",
        "invalid_model_config_provider_options_kimi_prompt_cache_shape" => "invalid_prompt_cache",
        "invalid_turn_execute_params" => "invalid params",
        value if value.starts_with("invalid_model_config_provider_options_kimi_prompt_cache_") => {
            "invalid_prompt_cache"
        }
        value if value.starts_with("invalid_model_config_provider_options_kimi_") => {
            "invalid_provider_options_kimi"
        }
        value if value.starts_with("invalid_attachments_") => "invalid_attachments",
        value if value.starts_with("invalid_model_config_") => "invalid_model_config",
        value if value.starts_with("invalid_tool_context_") => "invalid_tool_context",
        "invalid_context_lines_shape" => "invalid_context_lines",
        "invalid_system_prompt_shape" => "invalid_system_prompt",
        _ => "invalid params",
    }
}
