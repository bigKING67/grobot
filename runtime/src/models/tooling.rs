fn parse_tool_arguments(raw: &str, tool_name: &str) -> Result<Value, ModelExecutionError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(json!({}));
    }
    let parsed: Value = serde_json::from_str(trimmed).map_err(|error| {
        ModelExecutionError::new(
            "invalid_tool_arguments",
            format!("tool arguments are invalid JSON ({tool_name}): {error}"),
        )
    })?;
    if !parsed.is_object() {
        return Err(ModelExecutionError::new(
            "invalid_tool_arguments",
            format!("tool arguments must be an object ({tool_name})"),
        ));
    }
    Ok(parsed)
}

fn extract_tool_calls(response: &Value) -> Result<Vec<ToolCallInput>, ModelExecutionError> {
    let choices = response
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ModelExecutionError::new(
                "upstream_invalid_response",
                "missing choices in model response",
            )
        })?;
    let first = choices.first().ok_or_else(|| {
        ModelExecutionError::new(
            "upstream_invalid_response",
            "empty choices in model response",
        )
    })?;
    let message = first.get("message").and_then(Value::as_object).ok_or_else(|| {
        ModelExecutionError::new(
            "upstream_invalid_response",
            "missing choices[0].message in model response",
        )
    })?;
    let Some(raw_calls) = message.get("tool_calls").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut calls: Vec<ToolCallInput> = Vec::new();
    for (index, raw_call) in raw_calls.iter().enumerate() {
        let Some(call_object) = raw_call.as_object() else {
            continue;
        };
        let function = call_object
            .get("function")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                ModelExecutionError::new(
                    "upstream_invalid_response",
                    "tool_call.function is missing",
                )
            })?;
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ModelExecutionError::new(
                    "upstream_invalid_response",
                    "tool_call.function.name is missing",
                )
            })?
            .to_string();
        let id = call_object
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("call_{}", index + 1));
        let arguments_raw = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        let arguments = parse_tool_arguments(arguments_raw, &name)?;
        calls.push(ToolCallInput { id, name, arguments });
    }
    Ok(calls)
}

fn build_local_tool_definitions(input: &TurnExecuteInput) -> Vec<Value> {
    let Some(context) = input.tool_context.as_ref() else {
        return Vec::new();
    };
    let _surface_metadata = (
        context.tool_surface_source.as_deref(),
        context.tool_surface_reason.as_deref(),
        context.tool_policy_version.as_deref(),
    );
    let visible_tools = context
        .model_visible_tools
        .clone()
        .or_else(|| context.enabled_tools.clone())
        .unwrap_or_default();
    crate::tools::tools::local_tool_definitions_for_surface(
        &visible_tools,
        context.tool_surface_profile.as_deref(),
        context.advanced_tool_schema.unwrap_or(false),
    )
}

fn build_kimi_builtin_tool_definitions(config: &RuntimeModelConfig) -> Vec<Value> {
    if config.provider_kind != ProviderKind::Kimi {
        return Vec::new();
    }
    match config.provider_options.kimi.web_search_mode {
        KimiWebSearchMode::BuiltinPreferred | KimiWebSearchMode::BuiltinOnly => {
            vec![json!({
                "type": "builtin_function",
                "function": {
                    "name": "$web_search"
                }
            })]
        }
        KimiWebSearchMode::OfficialOnly | KimiWebSearchMode::Off => Vec::new(),
    }
}

fn build_kimi_official_tool_definitions(config: &RuntimeModelConfig) -> Vec<Value> {
    if config.provider_kind != ProviderKind::Kimi {
        return Vec::new();
    }
    let allowlist = &config.provider_options.kimi.official_tools_allowlist;
    if allowlist.is_empty() {
        return Vec::new();
    }
    let mut definitions = Vec::new();
    let mut push_definition = |name: &str, description: &str| {
        definitions.push(json!({
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }));
    };
    for tool_name in allowlist {
        let canonical = canonical_kimi_tool_name(tool_name);
        match canonical.as_str() {
            "web_search" => {
                if matches!(
                    config.provider_options.kimi.web_search_mode,
                    KimiWebSearchMode::BuiltinOnly | KimiWebSearchMode::Off
                ) {
                    continue;
                }
                push_definition(
                    "web_search",
                    "Moonshot official web-search tool for real-time information retrieval.",
                );
            }
            "date" => push_definition(
                "date",
                "Moonshot official date tool for date and time processing.",
            ),
            "fetch" => push_definition(
                "fetch",
                "Moonshot official fetch tool for URL content extraction.",
            ),
            "rethink" => push_definition(
                "rethink",
                "Moonshot official rethink tool for thought organization.",
            ),
            "code_runner" => push_definition(
                "code_runner",
                "Moonshot official Python code execution tool.",
            ),
            "kimi_files_list" => push_definition(
                "kimi_files_list",
                "List uploaded files in Kimi file storage (admin operation).",
            ),
            "kimi_files_delete" => push_definition(
                "kimi_files_delete",
                "Delete an uploaded file by file_id from Kimi file storage (admin operation).",
            ),
            _ => {
                let description = format!("Moonshot official tool: {}", canonical);
                push_definition(&canonical, &description);
            }
        }
    }
    if config.provider_options.kimi.allow_file_admin {
        if !allowlist
            .iter()
            .any(|item| canonical_kimi_tool_name(item) == "kimi_files_list")
        {
            push_definition(
                "kimi_files_list",
                "List uploaded files in Kimi file storage (admin operation).",
            );
        }
        if !allowlist
            .iter()
            .any(|item| canonical_kimi_tool_name(item) == "kimi_files_delete")
        {
            push_definition(
                "kimi_files_delete",
                "Delete an uploaded file by file_id from Kimi file storage (admin operation).",
            );
        }
    }
    definitions
}

fn build_tool_definitions(input: &TurnExecuteInput, config: &RuntimeModelConfig) -> Option<Value> {
    let mut tools = Vec::new();
    if input.tool_context.is_some() {
        tools.extend(build_local_tool_definitions(input));
    }
    tools.extend(build_kimi_builtin_tool_definitions(config));
    tools.extend(build_kimi_official_tool_definitions(config));
    if tools.is_empty() {
        return None;
    }
    Some(Value::Array(tools))
}

fn should_disable_thinking_for_kimi_builtin_web_search(config: &RuntimeModelConfig) -> bool {
    if config.provider_kind != ProviderKind::Kimi {
        return false;
    }
    if !config
        .provider_options
        .kimi
        .disable_thinking_on_builtin_web_search
    {
        return false;
    }
    matches!(
        config.provider_options.kimi.web_search_mode,
        KimiWebSearchMode::BuiltinPreferred | KimiWebSearchMode::BuiltinOnly
    )
}

fn is_kimi_tool_call_supported_without_local_context(
    tool_call: &ToolCallInput,
    config: &RuntimeModelConfig,
) -> bool {
    if config.provider_kind != ProviderKind::Kimi {
        return false;
    }
    let raw_name = tool_call.name.trim();
    if raw_name == "$web_search" {
        return matches!(
            config.provider_options.kimi.web_search_mode,
            KimiWebSearchMode::BuiltinPreferred | KimiWebSearchMode::BuiltinOnly
        );
    }
    let normalized_name = canonical_kimi_tool_name(raw_name);
    if normalized_name.is_empty() {
        return false;
    }
    match normalized_name.as_str() {
        "web_search" => {
            if matches!(
                config.provider_options.kimi.web_search_mode,
                KimiWebSearchMode::BuiltinOnly | KimiWebSearchMode::Off
            ) {
                return false;
            }
        }
        "kimi_files_list" | "kimi_files_delete" => {
            if !config.provider_options.kimi.allow_file_admin
                || !config.provider_options.kimi.files_enabled
            {
                return false;
            }
        }
        _ => {}
    }
    config
        .provider_options
        .kimi
        .official_tools_allowlist
        .iter()
        .any(|tool_name| tool_name == &normalized_name)
        || matches!(
            normalized_name.as_str(),
            "kimi_files_list" | "kimi_files_delete"
        )
}

fn resolve_max_tool_rounds(input: &TurnExecuteInput) -> usize {
    let parsed = input
        .tool_context
        .as_ref()
        .and_then(|context| context.max_tool_rounds)
        .unwrap_or(8);
    let clamped = parsed.clamp(1, 32);
    clamped as usize
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NoToolFallbackMode {
    Off,
    Safe,
    Strict,
}

fn resolve_no_tool_fallback_mode(input: &TurnExecuteInput) -> NoToolFallbackMode {
    let normalized = input
        .tool_context
        .as_ref()
        .and_then(|context| context.no_tool_fallback_mode.as_ref())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "safe".to_string());
    match normalized.as_str() {
        "off" => NoToolFallbackMode::Off,
        "strict" => NoToolFallbackMode::Strict,
        _ => NoToolFallbackMode::Safe,
    }
}

fn resolve_max_recovery_rounds(input: &TurnExecuteInput) -> usize {
    let parsed = input
        .tool_context
        .as_ref()
        .and_then(|context| context.max_recovery_rounds)
        .unwrap_or(2);
    let clamped = parsed.clamp(0, 8);
    clamped as usize
}
