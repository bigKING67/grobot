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

fn mcp_tool_result_error(
    server: &McpServerResolved,
    tool_name: &str,
    execution: &McpCallExecution,
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

fn write_mcp_message(stdin: &mut ChildStdin, payload: &Value) -> Result<(), ToolExecutionError> {
    let body = serde_json::to_string(payload).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("failed to serialize MCP payload: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_protocol_error",
            "serialize_request",
            "serialize_failed",
            "inspect MCP request arguments and remove non-serializable values",
        ))
    })?;
    let header = format!("Content-Length: {}\r\n\r\n", body.as_bytes().len());
    stdin.write_all(header.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP header: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "write_header",
            "write_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    stdin.write_all(body.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP body: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "write_body",
            "write_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    stdin.flush().map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to flush MCP request: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "flush_request",
            "flush_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    Ok(())
}

fn read_mcp_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, ToolExecutionError> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(|error| {
            ToolExecutionError::new(
                "mcp_transport_error",
                format!("failed to read MCP header line: {error}"),
            )
            .with_data(mcp_error_data(
                "mcp_transport_error",
                "read_header",
                "read_failed",
                "restart the MCP session or choose an alternate server/tool",
            ))
        })?;
        if read == 0 {
            return Err(ToolExecutionError::new(
                "mcp_transport_error",
                "MCP server closed stdout before response",
            )
            .with_data(mcp_error_data(
                "mcp_transport_error",
                "read_header",
                "stdout_closed",
                "restart the MCP session or choose an alternate server/tool",
            )));
        }
        let normalized = line.trim_end_matches(['\r', '\n']);
        if normalized.is_empty() {
            break;
        }
        let mut parts = normalized.splitn(2, ':');
        let name = parts.next().unwrap_or("").trim().to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();
        if name == "content-length" {
            let parsed = value.parse::<usize>().map_err(|error| {
                ToolExecutionError::new(
                    "mcp_protocol_error",
                    format!("invalid MCP content-length header: {error}"),
                )
                .with_data(mcp_error_data(
                    "mcp_protocol_error",
                    "read_header",
                    "invalid_content_length",
                    "restart the MCP server or choose an alternate server/tool",
                ))
            })?;
            content_length = Some(parsed);
        }
    }
    let length = content_length.ok_or_else(|| {
        ToolExecutionError::new("mcp_protocol_error", "MCP response missing content-length")
            .with_data(mcp_error_data(
                "mcp_protocol_error",
                "read_header",
                "missing_content_length",
                "restart the MCP server or choose an alternate server/tool",
            ))
    })?;
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to read MCP response body: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "read_body",
            "read_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    serde_json::from_slice::<Value>(&body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("invalid MCP JSON payload: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_protocol_error",
            "parse_response",
            "invalid_json",
            "restart the MCP server or choose an alternate server/tool",
        ))
    })
}

fn read_mcp_result_for_id(
    reader: &mut BufReader<ChildStdout>,
    request_id: i64,
) -> Result<Value, ToolExecutionError> {
    for _ in 0..64 {
        let message = read_mcp_message(reader)?;
        let id = message.get("id");
        let matched = match id {
            Some(value) => value.as_i64() == Some(request_id),
            None => false,
        };
        if !matched {
            continue;
        }
        if let Some(error) = message.get("error") {
            let detail = serde_json::to_string(error).unwrap_or_else(|_| "{}".to_string());
            return Err(ToolExecutionError::new(
                "mcp_rpc_error",
                format!("MCP response contains error: {detail}"),
            )
            .with_data(mcp_rpc_error_data(request_id, error)));
        }
        return Ok(message.get("result").cloned().unwrap_or_else(|| json!({})));
    }
    Err(ToolExecutionError::new(
        "mcp_protocol_error",
        "MCP response id not observed within read budget",
    )
    .with_data({
        let mut data = mcp_error_data_map(
            "mcp_protocol_error",
            "read_response",
            "response_id_not_observed",
            "restart the MCP session or choose an alternate server/tool",
        );
        data.insert("request_id".to_string(), json!(request_id));
        data.insert("read_budget".to_string(), json!(64));
        Value::Object(data)
    }))
}

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

fn run_mcp_servers(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let ready_only = get_bool_arg(args, "ready_only", false);
    let include_disabled_default = should_include_disabled_mcp_servers_by_default(context);
    let include_disabled = get_bool_arg(args, "include_disabled", include_disabled_default);
    let policy = load_mcp_call_policy(context);
    let state_snapshots = {
        let mut store = lock_runtime_store()?;
        let now_epoch_secs = current_epoch_secs();
        let _ = reap_expired_mcp_sessions(
            &mut store,
            policy.session_idle_ttl_secs,
            now_epoch_secs,
        );
        store.states.clone()
    };
    let mut servers_payload: Vec<Value> = Vec::new();
    let mut server_keys: Vec<String> = Vec::new();
    let servers = load_mcp_servers(context);
    let mut total = 0usize;
    let mut enabled_count = 0usize;
    let mut ready_count = 0usize;
    for server in servers {
        if !include_disabled && !server.enabled {
            continue;
        }
        if ready_only && !server.ready {
            continue;
        }
        total += 1;
        if server.enabled {
            enabled_count += 1;
        }
        if server.ready {
            ready_count += 1;
        }
        let server_key = normalize_server_key(&server.name);
        let runtime_state = state_snapshots
            .get(&server_key)
            .cloned()
            .unwrap_or_default();
        server_keys.push(server_key);
        servers_payload.push(json!({
            "name": server.name,
            "enabled": server.enabled,
            "ready": server.ready,
            "ready_reason": server.ready_reason,
            "source": server.source,
            "command": server.command,
            "args": server.args,
            "runtime_state": server_runtime_state_payload(&runtime_state),
        }));
    }
    let runtime_summary = aggregate_runtime_summary(&server_keys, &state_snapshots);
    let payload = json!({
        "tool": TOOL_MCP_SERVERS,
        "total": total,
        "enabled_count": enabled_count,
        "ready_count": ready_count,
        "servers": servers_payload,
        "policy": {
            "max_concurrency_per_server": policy.max_concurrency_per_server,
            "max_queue_per_server": policy.max_queue_per_server,
            "failure_threshold": policy.failure_threshold,
            "cooldown_secs": policy.cooldown_secs,
            "latency_sample_limit": policy.latency_sample_limit,
            "call_timeout_ms": policy.call_timeout_ms,
            "session_idle_ttl_secs": policy.session_idle_ttl_secs,
            "allow_tools": policy.allow_tools,
        },
        "runtime_summary": runtime_summary,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn should_include_disabled_mcp_servers_by_default(context: &ToolContextResolved) -> bool {
    context.tool_surface_profile == "full_debug"
}

fn run_mcp_call(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let server_name = get_string_arg(args, "server")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "mcp_call.server is required"))?;
    let tool_name = get_string_arg(args, "tool")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "mcp_call.tool is required"))?;
    let raw_arguments = args.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let call_arguments = raw_arguments.as_object().cloned().ok_or_else(|| {
        ToolExecutionError::new("invalid_tool_arguments", "mcp_call.arguments must be an object")
    })?;
    let policy = load_mcp_call_policy(context);
    let servers = load_mcp_servers(context);
    let server = servers
        .iter()
        .find(|candidate| candidate.name == server_name)
        .ok_or_else(|| {
            let available_servers = servers
                .iter()
                .map(|candidate| candidate.name.clone())
                .collect::<Vec<String>>();
            ToolExecutionError::new(
                "mcp_server_not_found",
                format!("MCP server not found: {server_name}"),
            )
            .with_data({
                let mut data = mcp_error_data_map(
                    "mcp_server_not_found",
                    "resolve_server",
                    "server_not_configured",
                    "inspect mcp_servers and choose a configured server",
                );
                data.insert("server".to_string(), json!(server_name));
                data.insert("available_servers".to_string(), json!(available_servers));
                Value::Object(data)
            })
        })?;
    if !server.enabled {
        return Err(ToolExecutionError::new(
            "mcp_server_unready",
            format!("MCP server `{}` is disabled", server.name),
        )
        .with_data(mcp_server_error_data(
            "mcp_server_unready",
            server,
            Some(&tool_name),
            "resolve_server",
            "server_disabled",
            "enable the MCP server or choose a different configured server/tool",
        )));
    }
    if !server.ready {
        return Err(ToolExecutionError::new(
            "mcp_server_unready",
            format!(
                "MCP server `{}` is unready: {}",
                server.name, server.ready_reason
            ),
        )
        .with_data(mcp_server_error_data(
            "mcp_server_unready",
            server,
            Some(&tool_name),
            "resolve_server",
            "server_unready",
            "fix MCP server command/readiness before retrying",
        )));
    }
    let server_key = normalize_server_key(&server.name);

    if !mcp_tool_allowed(&policy, &tool_name) {
        let mut store = lock_runtime_store()?;
        let state = store.states.entry(server_key.clone()).or_default();
        state.policy_denied_calls = state.policy_denied_calls.saturating_add(1);
        let mut data = mcp_server_error_data(
            "mcp_tool_blocked",
            server,
            Some(&tool_name),
            "policy_check",
            "tool_not_allowed",
            "use an allowed MCP tool or request policy change",
        );
        if let Value::Object(ref mut row) = data {
            row.insert("allow_tools".to_string(), json!(policy.allow_tools.clone()));
        }
        return Err(ToolExecutionError::new(
            "mcp_tool_blocked",
            format!("MCP tool \"{tool_name}\" blocked by [tools.mcp].allow_tools"),
        )
        .with_data(data));
    }

    let call_started_at = Instant::now();
    acquire_mcp_server_slot(server, &server_key, &policy)?;
    let mut retry_attempted = false;
    let mut session_reused = false;
    let mut session_recovered = false;

    let mut session = {
        let mut store = lock_runtime_store()?;
        let now_epoch_secs = current_epoch_secs();
        let _ = reap_expired_mcp_sessions(
            &mut store,
            policy.session_idle_ttl_secs,
            now_epoch_secs,
        );
        store.sessions.remove(&server_key)
    };
    if session.is_some() {
        session_reused = true;
    }

    let mut bootstrap_error: Option<ToolExecutionError> = None;
    if session.is_none() {
        match spawn_mcp_session(context, server, policy.call_timeout_ms) {
            Ok(created) => {
                session = Some(created);
            }
            Err(error) => {
                bootstrap_error = Some(error);
            }
        }
    }

    let call_result = if let Some(error) = bootstrap_error {
        Err(error)
    } else {
        (|| -> Result<McpCallExecution, ToolExecutionError> {
            let primary = run_mcp_call_on_session(
                session
                    .as_mut()
                    .ok_or_else(|| {
                        ToolExecutionError::new("mcp_runtime_error", "missing MCP session")
                            .with_data(mcp_server_error_data(
                                "mcp_runtime_error",
                                server,
                                Some(&tool_name),
                                "tools/call",
                                "missing_session",
                                "retry with a fresh MCP session or choose an alternate server/tool",
                            ))
                    })?,
                server,
                &tool_name,
                &call_arguments,
                policy.call_timeout_ms,
            );
            match primary {
                Ok(executed) => Ok(executed),
                Err(error) if is_recoverable_mcp_error(&error) => {
                    retry_attempted = true;
                    if let Some(mut stale) = session.take() {
                        close_mcp_session(&mut stale);
                    }
                    let mut rebuilt = spawn_mcp_session(context, server, policy.call_timeout_ms)?;
                    let retried = run_mcp_call_on_session(
                        &mut rebuilt,
                        server,
                        &tool_name,
                        &call_arguments,
                        policy.call_timeout_ms,
                    );
                    match retried {
                        Ok(executed) => {
                            session_recovered = true;
                            session = Some(rebuilt);
                            Ok(executed)
                        }
                        Err(retry_error) => {
                            close_mcp_session(&mut rebuilt);
                            Err(retry_error)
                        }
                    }
                }
                Err(error) => Err(error),
            }
        })()
    };

    let session_pid = session
        .as_ref()
        .map(|active| i64::from(active.child.id()))
        .unwrap_or(0_i64);
    if let Some(active) = session.take() {
        let mut store = lock_runtime_store()?;
        let mut active = active;
        active.last_used_epoch_secs = current_epoch_secs();
        if let Some(mut replaced) = store.sessions.insert(server_key.clone(), active) {
            close_mcp_session(&mut replaced);
        }
    }

    let elapsed_ms = call_started_at.elapsed().as_secs_f64() * 1_000.0;
    let mut runtime_state = json!({});
    let mut call_error: Option<ToolExecutionError> = None;
    {
        let mut store = lock_runtime_store()?;
        let state = store.states.entry(server_key).or_default();
        state.in_flight = state.in_flight.saturating_sub(1);
        record_latency_sample(state, elapsed_ms, policy.latency_sample_limit);
        if retry_attempted {
            state.retry_calls = state.retry_calls.saturating_add(1);
        }
        if session_recovered {
            state.recovered_calls = state.recovered_calls.saturating_add(1);
        }

        let now_epoch_secs = current_epoch_secs();
        match &call_result {
            Ok(executed) => {
                if executed.is_error {
                    mark_runtime_failure_bucket(
                        state,
                        "tool",
                        "tool_result_error",
                        &policy,
                        now_epoch_secs,
                    );
                } else {
                    mark_runtime_success(state);
                }
            }
            Err(error) => {
                let bucket = classify_error_bucket(error);
                mark_runtime_failure_bucket(
                    state,
                    bucket,
                    &error.error_class,
                    &policy,
                    now_epoch_secs,
                );
                call_error = Some(error.clone());
            }
        }

        runtime_state = server_runtime_state_payload(state);
    }

    if let Some(error) = call_error {
        return Err(error);
    }

    let executed = call_result?;
    let observed_error = if executed.is_error {
        Some(mcp_tool_result_error(server, &tool_name, &executed))
    } else {
        None
    };
    let payload = json!({
        "tool": TOOL_MCP_CALL,
        "status": "ok",
        "server": server.name,
        "tool_name": tool_name,
        "available_tools": executed.available_tools,
        "session_reused": session_reused,
        "session_recovered": session_recovered,
        "session_pid": session_pid,
        "runtime_state": runtime_state,
        "result": {
            "is_error": executed.is_error,
            "content": executed.content,
            "raw_preview": executed.raw_preview,
            "structured_content_preview": executed.structured_content_preview,
        }
    });
    let output = ToolCallOutput::from_payload(payload);
    if let Some(error) = observed_error {
        Ok(output.with_observed_error(error))
    } else {
        Ok(output)
    }
}

fn extract_mcp_json_content_payload(content: &Value) -> Value {
    let Some(items) = content.as_array() else {
        return content.clone();
    };
    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        if object.get("type").and_then(Value::as_str) == Some("json") {
            if let Some(payload) = object.get("json") {
                return payload.clone();
            }
        }
        if object.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = object.get("text").and_then(Value::as_str) {
                if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                    return parsed;
                }
            }
        }
    }
    content.clone()
}

fn browser_tool_status(backend_payload: &Value, mcp_is_error: bool) -> &'static str {
    if mcp_is_error {
        return "error";
    }
    let status = backend_payload
        .get("status")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if status == "failed" || status == "error" {
        "error"
    } else {
        "ok"
    }
}

fn browser_tool_diagnostic_hint(backend_payload: &Value, mcp_is_error: bool) -> String {
    let error_code = backend_payload
        .get("error_code")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !error_code.is_empty() {
        match error_code {
            "NO_EXTENSION" => {
                return "Browser extension is not connected. Run `grobot browser setup`, load the generated extension directory, then run `grobot browser doctor`.".to_string();
            }
            "NO_SESSION" => {
                return "No browser session/tab is available. Open a normal web page and retry `grobot browser doctor`.".to_string();
            }
            "TRANSPORT_UNAVAILABLE" => {
                return "Browser transport is unavailable. Run `grobot browser hub start` and retry `grobot browser doctor`.".to_string();
            }
            "CDP_DENIED" | "CSP_BLOCKED" => {
                return "Browser policy blocked the JS/DevTools path. Retry with a narrower script or use explicit native fallback after dry-run.".to_string();
            }
            "TIMEOUT" => {
                return "Browser action timed out. Narrow the target tab/session or increase timeout_ms.".to_string();
            }
            _ => {
                return format!("Browser backend returned error_code={error_code}; inspect transport_attempts and backend result.");
            }
        }
    }
    if mcp_is_error {
        return "Browser backend returned an MCP tool error; inspect result.content for details.".to_string();
    }
    "Browser backend completed; inspect result.transport and result.transport_attempts for the active route.".to_string()
}

fn browser_context_kind_from_transport(backend_payload: &Value) -> &'static str {
    match backend_payload
        .get("transport")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("tmwd_ws") | Some("tmwd_link") => "tmwd_user_browser",
        Some("cdp") => "remote_cdp_debug_browser",
        _ => "unknown",
    }
}

fn browser_context_note_for_kind(context_kind: &str) -> &'static str {
    match context_kind {
        "tmwd_user_browser" => {
            "Using the user's real browser through TMWD; tabs, cookies, and login state are expected to match the open browser."
        }
        "remote_cdp_debug_browser" => {
            "Using an external remote-debugging CDP browser; it may be a separate window/profile without the user's current tabs or login state."
        }
        _ => "Browser context could not be identified from backend transport; inspect result.transport_attempts.",
    }
}

fn browser_facade_error_data_map(
    diagnostic_kind: &str,
    context: &ToolContextResolved,
    public_tool_name: &str,
    browser_tool_name: &str,
    operation: &str,
    applied_tmwd_default: Option<bool>,
) -> Map<String, Value> {
    let mut data = Map::new();
    data.insert("diagnostic_kind".to_string(), json!(diagnostic_kind));
    data.insert("tool".to_string(), json!(public_tool_name));
    data.insert("backend".to_string(), json!("browser-structured"));
    data.insert("backend_server".to_string(), json!("browser-structured"));
    data.insert("mapped_tool".to_string(), json!(browser_tool_name));
    data.insert("operation".to_string(), json!(operation));
    data.insert(
        "tool_surface_profile".to_string(),
        json!(context.tool_surface_profile.as_str()),
    );
    data.insert(
        "advanced_tool_schema".to_string(),
        json!(context.advanced_tool_schema),
    );
    data.insert(
        "recovery_hint".to_string(),
        json!(match diagnostic_kind {
            "tool_argument_not_visible" => {
                "remove hidden browser arguments, switch to browser_advanced/full_debug, or enable advanced_tool_schema"
            }
            "browser_backend_unavailable" => {
                "run `grobot browser setup`, start the browser hub, then run `grobot browser doctor`"
            }
            "browser_backend_invalid_response" => {
                "inspect the browser-structured MCP envelope and fix backend response format"
            }
            "browser_backend_result_error" => {
                "inspect error_code, transport_attempts, and retry with a narrower browser target or fix browser setup"
            }
            _ => "inspect browser facade diagnostics and change strategy before retrying",
        }),
    );
    if let Some(applied) = applied_tmwd_default {
        data.insert("facade_default_tmwd_mode_applied".to_string(), json!(applied));
    }
    data
}

fn insert_browser_cause_error_data(data: &mut Map<String, Value>, error: &ToolExecutionError) {
    data.insert("cause_error_class".to_string(), json!(error.error_class.as_str()));
    data.insert(
        "cause_error_message".to_string(),
        json!(truncate_output(error.message.clone(), 512)),
    );
    if let Some(cause_data) = &error.data {
        data.insert("cause_error_data".to_string(), cause_data.clone());
        if let Some(server) = cause_data.get("server").and_then(Value::as_str) {
            data.insert("server".to_string(), json!(server));
        }
        if let Some(server_key) = cause_data.get("server_key").and_then(Value::as_str) {
            data.insert("server_key".to_string(), json!(server_key));
        }
        if let Some(available_servers) = cause_data.get("available_servers") {
            data.insert("available_servers".to_string(), available_servers.clone());
        }
        if let Some(available_tools) = cause_data.get("available_tools") {
            data.insert("available_tools".to_string(), available_tools.clone());
        }
        if let Some(ready) = cause_data.get("ready").and_then(Value::as_bool) {
            data.insert("ready".to_string(), json!(ready));
        }
        if let Some(ready_reason) = cause_data.get("ready_reason").and_then(Value::as_str) {
            data.insert("ready_reason".to_string(), json!(ready_reason));
        }
    }
}

fn insert_browser_backend_result_data(
    data: &mut Map<String, Value>,
    backend_payload: &Value,
    mcp_is_error: bool,
) {
    data.insert("is_error".to_string(), json!(mcp_is_error));
    if let Some(status) = backend_payload.get("status").and_then(Value::as_str) {
        data.insert("backend_status".to_string(), json!(status));
    }
    if let Some(error_code) = backend_payload.get("error_code").and_then(Value::as_str) {
        data.insert("error_code".to_string(), json!(error_code));
    }
    if let Some(retryable) = backend_payload.get("retryable").and_then(Value::as_bool) {
        data.insert("retryable".to_string(), json!(retryable));
    }
    if let Some(transport) = backend_payload.get("transport").and_then(Value::as_str) {
        data.insert("transport".to_string(), json!(transport));
    }
    if let Some(attempts) = backend_payload
        .get("transport_attempts")
        .and_then(Value::as_array)
    {
        data.insert("transport_attempts_count".to_string(), json!(attempts.len()));
    }
    let context_kind = browser_context_kind_from_transport(backend_payload);
    data.insert("browser_context_kind".to_string(), json!(context_kind));
    data.insert(
        "diagnostic_hint".to_string(),
        json!(browser_tool_diagnostic_hint(backend_payload, mcp_is_error)),
    );
    data.insert(
        "result_preview".to_string(),
        json!(stringify_value_preview(backend_payload, 512)),
    );
}

fn browser_backend_result_error(
    context: &ToolContextResolved,
    public_tool_name: &str,
    browser_tool_name: &str,
    backend_payload: &Value,
    mcp_is_error: bool,
    applied_tmwd_default: bool,
) -> ToolExecutionError {
    let mut data = browser_facade_error_data_map(
        "browser_backend_result_error",
        context,
        public_tool_name,
        browser_tool_name,
        "backend_result",
        Some(applied_tmwd_default),
    );
    insert_browser_backend_result_data(&mut data, backend_payload, mcp_is_error);
    let error_code = backend_payload
        .get("error_code")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown");
    let diagnostic_hint = data
        .get("diagnostic_hint")
        .and_then(Value::as_str)
        .unwrap_or("inspect browser backend result");
    ToolExecutionError::new(
        "browser_backend_result_error",
        format!("{public_tool_name} backend returned error_code={error_code}: {diagnostic_hint}"),
    )
    .with_data(Value::Object(data))
}

fn browser_facade_args_with_current_browser_default(
    args: &Map<String, Value>,
) -> (Map<String, Value>, bool) {
    let mut browser_args = args.clone();
    let applied_tmwd_default = !browser_args.contains_key("tmwd_mode");
    if applied_tmwd_default {
        browser_args.insert("tmwd_mode".to_string(), Value::String("tmwd".to_string()));
    }
    (browser_args, applied_tmwd_default)
}

fn validate_browser_facade_args_visible(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    public_tool_name: &str,
) -> Result<(), ToolExecutionError> {
    let visible_properties = projected_tool_property_names_for_context(context, public_tool_name)?;
    let mut hidden_args = args
        .keys()
        .filter(|key| !visible_properties.contains(key.as_str()))
        .cloned()
        .collect::<Vec<String>>();
    if hidden_args.is_empty() {
        return Ok(());
    }
    hidden_args.sort();
    let mut visible_args = visible_properties.into_iter().collect::<Vec<String>>();
    visible_args.sort();
    let hidden_args_text = hidden_args.join(", ");
    Err(ToolExecutionError::new(
        "tool_argument_not_visible",
        format!(
            "{public_tool_name} argument(s) [{hidden_args_text}] are not visible in current tool surface profile={} advanced_tool_schema={}. Use browser_advanced for transport/debug tuning, full_debug for explicit native browser actions, or remove hidden arguments.",
            context.tool_surface_profile,
            context.advanced_tool_schema,
        ),
    )
    .with_data({
        let mut data = browser_facade_error_data_map(
            "tool_argument_not_visible",
            context,
            public_tool_name,
            public_tool_name,
            "validate_browser_facade_args_visible",
            None,
        );
        data.insert("hidden_args".to_string(), json!(hidden_args));
        data.insert("visible_args".to_string(), json!(visible_args));
        Value::Object(data)
    }))
}

fn run_browser_structured_tool(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    browser_tool_name: &str,
    public_tool_name: &str,
) -> Result<ToolCallOutput, ToolExecutionError> {
    validate_browser_facade_args_visible(context, args, public_tool_name)?;
    let (browser_args, applied_tmwd_default) = browser_facade_args_with_current_browser_default(args);
    let mut wrapped_args = Map::new();
    wrapped_args.insert(
        "server".to_string(),
        Value::String("browser-structured".to_string()),
    );
    wrapped_args.insert(
        "tool".to_string(),
        Value::String(browser_tool_name.to_string()),
    );
    wrapped_args.insert("arguments".to_string(), Value::Object(browser_args));

    let output = run_mcp_call(context, &wrapped_args).map_err(|error| {
        let mut data = browser_facade_error_data_map(
            "browser_backend_unavailable",
            context,
            public_tool_name,
            browser_tool_name,
            "mcp_backend_call",
            Some(applied_tmwd_default),
        );
        insert_browser_cause_error_data(&mut data, &error);
        ToolExecutionError::new(
            &error.error_class,
            format!(
                "{public_tool_name} backend `browser-structured` unavailable: {}. Run `grobot browser setup`, `grobot browser hub start`, then `grobot browser doctor`.",
                error.message
            ),
        )
        .with_data(Value::Object(data))
    })?;
    let mcp_payload = serde_json::from_str::<Value>(&output.content).map_err(|error| {
        let mut data = browser_facade_error_data_map(
            "browser_backend_invalid_response",
            context,
            public_tool_name,
            browser_tool_name,
            "parse_mcp_backend_envelope",
            Some(applied_tmwd_default),
        );
        data.insert("parse_error".to_string(), json!(error.to_string()));
        data.insert(
            "backend_envelope_preview".to_string(),
            json!(truncate_output(output.content.clone(), 512)),
        );
        ToolExecutionError::new(
            "browser_backend_invalid_response",
            format!("{public_tool_name} failed to parse browser backend envelope: {error}"),
        )
        .with_data(Value::Object(data))
    })?;
    let result = mcp_payload.get("result").cloned().unwrap_or_else(|| json!({}));
    let mcp_is_error = result
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = result.get("content").cloned().unwrap_or_else(|| json!([]));
    let backend_payload = extract_mcp_json_content_payload(&content);
    let status = browser_tool_status(&backend_payload, mcp_is_error);
    let diagnostic_hint = browser_tool_diagnostic_hint(&backend_payload, mcp_is_error);
    let browser_context_kind = browser_context_kind_from_transport(&backend_payload);
    let browser_context_note = browser_context_note_for_kind(browser_context_kind);
    let payload = json!({
        "tool": public_tool_name,
        "status": status,
        "backend": "browser-structured",
        "backend_server": "browser-structured",
        "mapped_tool": browser_tool_name,
        "facade_default_tmwd_mode_applied": applied_tmwd_default,
        "browser_context_kind": browser_context_kind,
        "browser_context_note": browser_context_note,
        "error_code": backend_payload.get("error_code").cloned().unwrap_or(Value::Null),
        "retryable": backend_payload.get("retryable").cloned().unwrap_or(Value::Null),
        "transport": backend_payload.get("transport").cloned().unwrap_or(Value::Null),
        "transport_attempts": backend_payload.get("transport_attempts").cloned().unwrap_or_else(|| json!([])),
        "diagnostic_hint": diagnostic_hint,
        "result": backend_payload,
        "mcp": {
            "available_tools": mcp_payload.get("available_tools").cloned().unwrap_or_else(|| json!([])),
            "session_reused": mcp_payload.get("session_reused").cloned().unwrap_or(Value::Bool(false)),
            "session_recovered": mcp_payload.get("session_recovered").cloned().unwrap_or(Value::Bool(false)),
            "session_pid": mcp_payload.get("session_pid").cloned().unwrap_or(Value::Null),
            "runtime_state": mcp_payload.get("runtime_state").cloned().unwrap_or_else(|| json!({})),
            "raw_preview": result.get("raw_preview").cloned().unwrap_or(Value::String(String::new())),
            "structured_content_preview": result.get("structured_content_preview").cloned().unwrap_or(Value::String(String::new()))
        }
    });
    let output = ToolCallOutput::from_payload(payload);
    if status == "error" {
        Ok(output.with_observed_error(browser_backend_result_error(
            context,
            public_tool_name,
            browser_tool_name,
            &backend_payload,
            mcp_is_error,
            applied_tmwd_default,
        )))
    } else {
        Ok(output)
    }
}

fn run_web_scan(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    run_browser_structured_tool(context, args, "browser_scan", TOOL_WEB_SCAN)
}

fn run_web_execute_js(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    run_browser_structured_tool(context, args, "browser_execute_js", TOOL_WEB_EXECUTE_JS)
}
