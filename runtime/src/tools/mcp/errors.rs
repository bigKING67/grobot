const MAX_MCP_CALL_ARGUMENT_BYTES: usize = 65_536;

fn mcp_error_data_map(
    diagnostic_kind: &str,
    operation: &str,
    reason: &str,
    recovery_hint: &str,
) -> Map<String, Value> {
    let mut data = Map::new();
    data.insert("diagnostic_kind".to_string(), json!(diagnostic_kind));
    data.insert("operation".to_string(), json!(operation));
    data.insert("reason".to_string(), json!(reason));
    data.insert("recovery_hint".to_string(), json!(recovery_hint));
    data
}

fn mcp_error_data(
    diagnostic_kind: &str,
    operation: &str,
    reason: &str,
    recovery_hint: &str,
) -> Value {
    Value::Object(mcp_error_data_map(
        diagnostic_kind,
        operation,
        reason,
        recovery_hint,
    ))
}

fn mcp_server_error_data(
    diagnostic_kind: &str,
    server: &McpServerResolved,
    tool_name: Option<&str>,
    operation: &str,
    reason: &str,
    recovery_hint: &str,
) -> Value {
    let mut data = mcp_error_data_map(diagnostic_kind, operation, reason, recovery_hint);
    data.insert("server".to_string(), json!(server.name.as_str()));
    data.insert(
        "server_key".to_string(),
        json!(normalize_server_key(&server.name)),
    );
    data.insert("enabled".to_string(), json!(server.enabled));
    data.insert("ready".to_string(), json!(server.ready));
    data.insert("ready_reason".to_string(), json!(server.ready_reason.as_str()));
    data.insert("source".to_string(), json!(server.source.as_str()));
    if let Some(tool_name) = tool_name {
        data.insert("tool_name".to_string(), json!(tool_name));
    }
    Value::Object(data)
}

fn mcp_rpc_error_data(request_id: i64, error: &Value) -> Value {
    let mut data = mcp_error_data_map(
        "mcp_rpc_error",
        "read_response",
        "json_rpc_error",
        "inspect MCP rpc error and change tool arguments or strategy",
    );
    data.insert("request_id".to_string(), json!(request_id));
    if let Some(code) = error.get("code") {
        data.insert("rpc_error_code".to_string(), code.clone());
    }
    if let Some(message) = error.get("message").and_then(Value::as_str) {
        data.insert(
            "rpc_error_message".to_string(),
            json!(truncate_output(message.to_string(), 256)),
        );
    }
    if let Some(details) = error.get("data") {
        data.insert(
            "rpc_error_data_preview".to_string(),
            json!(stringify_value_preview(details, 256)),
        );
    }
    Value::Object(data)
}
