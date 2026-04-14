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

fn build_local_tool_definitions() -> Vec<Value> {
    let definitions = json!([
        {
            "type": "function",
            "function": {
                "name": "list",
                "description": "List files/directories under workspace",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "recursive": { "type": "boolean" },
                        "max_entries": { "type": "integer" }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "glob",
                "description": "Find workspace paths by glob pattern",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string" },
                        "path": { "type": "string" },
                        "max_entries": { "type": "integer" }
                    },
                    "required": ["pattern"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search",
                "description": "Search text in workspace files",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "path": { "type": "string" },
                        "fixed": { "type": "boolean" },
                        "regex": { "type": "boolean" },
                        "case_sensitive": { "type": "boolean" },
                        "context_before": { "type": "integer" },
                        "context_after": { "type": "integer" },
                        "max_results": { "type": "integer" }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read file content",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "line_start": { "type": "integer" },
                        "line_end": { "type": "integer" }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "write",
                "description": "Write file content",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "content": { "type": "string" },
                        "append": { "type": "boolean" }
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "edit",
                "description": "Replace text in file",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "old_text": { "type": "string" },
                        "new_text": { "type": "string" },
                        "replace_all": { "type": "boolean" }
                    },
                    "required": ["path", "old_text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Run an allowlisted shell command",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" }
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "mcp_servers",
                "description": "List MCP servers merged from global/project registry",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ready_only": { "type": "boolean" },
                        "include_disabled": { "type": "boolean" }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "mcp_call",
                "description": "Call one MCP tool via stdio",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "server": { "type": "string" },
                        "tool": { "type": "string" },
                        "arguments": { "type": "object" }
                    },
                    "required": ["server", "tool"]
                }
            }
        }
    ]);
    definitions
        .as_array()
        .cloned()
        .unwrap_or_default()
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
        tools.extend(build_local_tool_definitions());
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
