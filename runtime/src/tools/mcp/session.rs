fn extract_mcp_tool_names(payload: &Value) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let Some(tools) = payload.get("tools").and_then(Value::as_array) else {
        return names;
    };
    for item in tools {
        let Some(name) = item.get("name").and_then(Value::as_str) else {
            continue;
        };
        let normalized = name.trim();
        if normalized.is_empty() {
            continue;
        }
        names.push(normalized.to_string());
    }
    names.sort();
    names.dedup();
    names
}

fn stringify_value_preview(value: &Value, max_chars: usize) -> String {
    let text = if let Some(raw) = value.as_str() {
        raw.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
    };
    truncate_output(text, max_chars)
}

fn extract_raw_preview(content: &Value) -> String {
    if let Some(parts) = content.as_array() {
        for item in parts {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                let normalized = text.trim();
                if !normalized.is_empty() {
                    return truncate_output(normalized.to_string(), 512);
                }
            }
        }
    }
    stringify_value_preview(content, 512)
}

fn spawn_mcp_session(
    context: &ToolContextResolved,
    server: &McpServerResolved,
    call_timeout_ms: u64,
) -> Result<McpSessionHandle, ToolExecutionError> {
    let mut command = Command::new(&server.command);
    command.args(&server.args);
    command.current_dir(&context.work_dir);
    for (key, value) in &server.env {
        command.env(key, value);
    }
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| {
        let mut data = mcp_server_error_data(
            "mcp_spawn_failed",
            server,
            None,
            "spawn_server",
            "spawn_failed",
            "fix MCP server command/configuration before retrying",
        );
        if let Value::Object(ref mut row) = data {
            row.insert("command".to_string(), json!(server.command.as_str()));
            row.insert("arg_count".to_string(), json!(server.args.len()));
        }
        ToolExecutionError::new(
            "mcp_spawn_failed",
            format!("failed to spawn MCP server `{}`: {error}", server.command),
        )
        .with_data(data)
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| {
            ToolExecutionError::new("mcp_transport_error", "missing MCP stdin pipe")
                .with_data(mcp_server_error_data(
                    "mcp_transport_error",
                    server,
                    None,
                    "take_stdin_pipe",
                    "missing_stdin_pipe",
                    "fix MCP server stdio configuration before retrying",
                ))
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| {
            ToolExecutionError::new("mcp_transport_error", "missing MCP stdout pipe")
                .with_data(mcp_server_error_data(
                    "mcp_transport_error",
                    server,
                    None,
                    "take_stdout_pipe",
                    "missing_stdout_pipe",
                    "fix MCP server stdio configuration before retrying",
                ))
        })?;
    let mut session = McpSessionHandle {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        available_tools: Vec::new(),
        last_used_epoch_secs: current_epoch_secs(),
    };
    let session_pid = session.child.id();
    let initialized = (|| -> Result<(), ToolExecutionError> {
        write_mcp_message(
            &mut session.stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "grobot-runtime",
                        "version": "0.1.0"
                    }
                }
            }),
        )?;
        let _initialize_result = run_with_process_timeout(
            session_pid,
            call_timeout_ms,
            "initialize",
            || read_mcp_result_for_id(&mut session.stdout, 1),
        )?;
        write_mcp_message(
            &mut session.stdin,
            &json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {}
            }),
        )?;
        write_mcp_message(
            &mut session.stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {}
            }),
        )?;
        let listed_tools = run_with_process_timeout(
            session_pid,
            call_timeout_ms,
            "tools/list",
            || read_mcp_result_for_id(&mut session.stdout, 2),
        )?;
        session.available_tools = extract_mcp_tool_names(&listed_tools);
        Ok(())
    })();
    if let Err(error) = initialized {
        close_mcp_session(&mut session);
        return Err(error);
    }
    Ok(session)
}

fn run_mcp_call_on_session(
    session: &mut McpSessionHandle,
    server: &McpServerResolved,
    tool_name: &str,
    arguments: &Map<String, Value>,
    call_timeout_ms: u64,
) -> Result<McpCallExecution, ToolExecutionError> {
    if !session
        .available_tools
        .iter()
        .any(|candidate| candidate == tool_name)
    {
        let mut data = mcp_server_error_data(
            "mcp_tool_not_found",
            server,
            Some(tool_name),
            "tools/call",
            "tool_not_advertised",
            "inspect available_tools and choose an existing MCP tool",
        );
        if let Value::Object(ref mut row) = data {
            row.insert(
                "available_tools".to_string(),
                json!(session.available_tools.clone()),
            );
        }
        return Err(ToolExecutionError::new(
            "mcp_tool_not_found",
            format!("MCP tool `{tool_name}` not found on server `{}`", server.name),
        )
        .with_data(data));
    }
    write_mcp_message(
        &mut session.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": Value::Object(arguments.clone())
            }
        }),
    )?;
    let session_pid = session.child.id();
    let call_result = run_with_process_timeout(
        session_pid,
        call_timeout_ms,
        "tools/call",
        || read_mcp_result_for_id(&mut session.stdout, 3),
    )?;
    let is_error = call_result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = call_result
        .get("content")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let raw_preview = extract_raw_preview(&content);
    let structured_content_preview = call_result
        .get("structuredContent")
        .map(|value| stringify_value_preview(value, 512))
        .unwrap_or_default();
    Ok(McpCallExecution {
        available_tools: session.available_tools.clone(),
        is_error,
        content,
        raw_preview,
        structured_content_preview,
    })
}
