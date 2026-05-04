fn json_value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn mcp_call_argument_error_data(
    diagnostic_kind: &str,
    operation: &str,
    reason: &str,
    recovery_hint: &str,
    server_name: &str,
    tool_name: &str,
) -> Map<String, Value> {
    let mut data = mcp_error_data_map(diagnostic_kind, operation, reason, recovery_hint);
    data.insert("server".to_string(), json!(server_name));
    data.insert("tool_name".to_string(), json!(tool_name));
    data
}

fn parse_mcp_call_arguments(
    raw_arguments: &Value,
    server_name: &str,
    tool_name: &str,
) -> Result<Map<String, Value>, ToolExecutionError> {
    let argument_bytes = serde_json::to_vec(raw_arguments)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX);
    if argument_bytes > MAX_MCP_CALL_ARGUMENT_BYTES {
        let mut data = mcp_call_argument_error_data(
            "mcp_arguments_too_large",
            "parse_arguments",
            "arguments_exceed_byte_budget",
            "reduce MCP tool arguments, use file/context references, or split the request into smaller MCP calls",
            server_name,
            tool_name,
        );
        data.insert("argument_bytes".to_string(), json!(argument_bytes));
        data.insert(
            "max_argument_bytes".to_string(),
            json!(MAX_MCP_CALL_ARGUMENT_BYTES),
        );
        return Err(ToolExecutionError::new(
            "mcp_arguments_too_large",
            format!(
                "mcp_call.arguments is too large: {argument_bytes}>{MAX_MCP_CALL_ARGUMENT_BYTES} bytes"
            ),
        )
        .with_data(Value::Object(data)));
    }
    raw_arguments.as_object().cloned().ok_or_else(|| {
        let mut data = mcp_call_argument_error_data(
            "invalid_tool_arguments",
            "parse_arguments",
            "arguments_not_object",
            "pass mcp_call.arguments as a JSON object; use an empty object when the MCP tool has no arguments",
            server_name,
            tool_name,
        );
        data.insert("argument_type".to_string(), json!(json_value_kind(raw_arguments)));
        ToolExecutionError::new("invalid_tool_arguments", "mcp_call.arguments must be an object")
            .with_data(Value::Object(data))
    })
}

fn mcp_call_argument_keys(arguments: &Map<String, Value>) -> Vec<String> {
    let mut keys = arguments.keys().cloned().collect::<Vec<String>>();
    keys.sort();
    keys
}

fn mcp_call_argument_bytes(arguments: &Map<String, Value>) -> usize {
    serde_json::to_vec(&Value::Object(arguments.clone()))
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

fn mcp_call_argument_preview(arguments: &Map<String, Value>) -> String {
    let preview = stringify_value_preview(&Value::Object(arguments.clone()), 512);
    redact_tool_preview_secrets(&preview)
}

fn insert_mcp_call_argument_metadata(
    data: &mut Map<String, Value>,
    arguments: &Map<String, Value>,
) {
    if !data.contains_key("argument_keys") {
        data.insert(
            "argument_keys".to_string(),
            json!(mcp_call_argument_keys(arguments)),
        );
    }
    if !data.contains_key("argument_bytes") {
        data.insert(
            "argument_bytes".to_string(),
            json!(mcp_call_argument_bytes(arguments)),
        );
    }
    if !data.contains_key("max_argument_bytes") {
        data.insert(
            "max_argument_bytes".to_string(),
            json!(MAX_MCP_CALL_ARGUMENT_BYTES),
        );
    }
    if !data.contains_key("argument_preview") {
        data.insert(
            "argument_preview".to_string(),
            json!(mcp_call_argument_preview(arguments)),
        );
    }
}

fn insert_mcp_unresolved_call_context(
    data: &mut Map<String, Value>,
    server_name: &str,
    tool_name: &str,
    arguments: &Map<String, Value>,
) {
    if !data.contains_key("server") {
        data.insert("server".to_string(), json!(server_name));
    }
    if !data.contains_key("tool_name") {
        data.insert("tool_name".to_string(), json!(tool_name));
    }
    insert_mcp_call_argument_metadata(data, arguments);
}

fn insert_mcp_call_context(
    data: &mut Map<String, Value>,
    server: &McpServerResolved,
    tool_name: &str,
    arguments: &Map<String, Value>,
) {
    if !data.contains_key("server") {
        data.insert("server".to_string(), json!(server.name.as_str()));
    }
    if !data.contains_key("server_key") {
        data.insert(
            "server_key".to_string(),
            json!(normalize_server_key(&server.name)),
        );
    }
    if !data.contains_key("enabled") {
        data.insert("enabled".to_string(), json!(server.enabled));
    }
    if !data.contains_key("ready") {
        data.insert("ready".to_string(), json!(server.ready));
    }
    if !data.contains_key("ready_reason") {
        data.insert("ready_reason".to_string(), json!(server.ready_reason.as_str()));
    }
    if !data.contains_key("source") {
        data.insert("source".to_string(), json!(server.source.as_str()));
    }
    if !data.contains_key("tool_name") {
        data.insert("tool_name".to_string(), json!(tool_name));
    }
    insert_mcp_call_argument_metadata(data, arguments);
}

fn enrich_mcp_call_error_context(
    mut error: ToolExecutionError,
    server: &McpServerResolved,
    tool_name: &str,
    arguments: &Map<String, Value>,
) -> ToolExecutionError {
    match error.data.as_mut() {
        Some(Value::Object(data)) => {
            insert_mcp_call_context(data, server, tool_name, arguments);
        }
        Some(existing) => {
            let mut data = mcp_error_data_map(
                error.error_class.as_str(),
                "tools/call",
                "call_failed",
                "inspect MCP call diagnostics and change arguments, reduce scope, or choose an alternate server/tool",
            );
            data.insert("cause_error_data".to_string(), existing.clone());
            insert_mcp_call_context(&mut data, server, tool_name, arguments);
            error.data = Some(Value::Object(data));
        }
        None => {
            let mut data = mcp_error_data_map(
                error.error_class.as_str(),
                "tools/call",
                "call_failed",
                "inspect MCP call diagnostics and change arguments, reduce scope, or choose an alternate server/tool",
            );
            insert_mcp_call_context(&mut data, server, tool_name, arguments);
            error.data = Some(Value::Object(data));
        }
    }
    error
}

fn mcp_tool_result_error(
    server: &McpServerResolved,
    tool_name: &str,
    execution: &McpCallExecution,
    arguments: &Map<String, Value>,
) -> ToolExecutionError {
    let mut data = mcp_server_error_data(
        "mcp_tool_result_error",
        server,
        Some(tool_name),
        "tools/call",
        "tool_result_error",
        "inspect MCP tool result content and change arguments, reduce scope, or choose an alternate tool",
    );
    if let Value::Object(ref mut row) = data {
        insert_mcp_call_context(row, server, tool_name, arguments);
        row.insert(
            "available_tools".to_string(),
            json!(execution.available_tools.clone()),
        );
        row.insert("is_error".to_string(), json!(execution.is_error));
        if !execution.raw_preview.trim().is_empty() {
            row.insert(
                "result_preview".to_string(),
                json!(execution.raw_preview.clone()),
            );
        }
        if !execution.structured_content_preview.trim().is_empty() {
            row.insert(
                "structured_content_preview".to_string(),
                json!(execution.structured_content_preview.clone()),
            );
        }
    }
    let message = if execution.raw_preview.trim().is_empty() {
        format!("MCP tool `{tool_name}` on server `{}` returned isError=true", server.name)
    } else {
        format!(
            "MCP tool `{tool_name}` on server `{}` returned isError=true: {}",
            server.name,
            truncate_output(execution.raw_preview.clone(), 180)
        )
    };
    ToolExecutionError::new("mcp_tool_result_error", message).with_data(data)
}
