fn write_mcp_message(stdin: &mut ChildStdin, payload: &Value) -> Result<(), ToolExecutionError> {
    let body = serde_json::to_string(payload).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("failed to serialize MCP payload: {error}"),
        )
    })?;
    let header = format!("Content-Length: {}\r\n\r\n", body.as_bytes().len());
    stdin.write_all(header.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP header: {error}"),
        )
    })?;
    stdin.write_all(body.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP body: {error}"),
        )
    })?;
    stdin.flush().map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to flush MCP request: {error}"),
        )
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
        })?;
        if read == 0 {
            return Err(ToolExecutionError::new(
                "mcp_transport_error",
                "MCP server closed stdout before response",
            ));
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
            })?;
            content_length = Some(parsed);
        }
    }
    let length = content_length.ok_or_else(|| {
        ToolExecutionError::new("mcp_protocol_error", "MCP response missing content-length")
    })?;
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to read MCP response body: {error}"),
        )
    })?;
    serde_json::from_slice::<Value>(&body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("invalid MCP JSON payload: {error}"),
        )
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
            ));
        }
        return Ok(message.get("result").cloned().unwrap_or_else(|| json!({})));
    }
    Err(ToolExecutionError::new(
        "mcp_protocol_error",
        "MCP response id not observed within read budget",
    ))
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
        ToolExecutionError::new(
            "mcp_spawn_failed",
            format!("failed to spawn MCP server `{}`: {error}", server.command),
        )
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| ToolExecutionError::new("mcp_transport_error", "missing MCP stdin pipe"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ToolExecutionError::new("mcp_transport_error", "missing MCP stdout pipe"))?;
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
        return Err(ToolExecutionError::new(
            "mcp_tool_not_found",
            format!("MCP tool `{tool_name}` not found on server `{}`", server.name),
        ));
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
    let include_disabled = get_bool_arg(args, "include_disabled", true);
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
            ToolExecutionError::new(
                "mcp_server_not_found",
                format!("MCP server not found: {server_name}"),
            )
        })?;
    if !server.enabled {
        return Err(ToolExecutionError::new(
            "mcp_server_unready",
            format!("MCP server `{}` is disabled", server.name),
        ));
    }
    if !server.ready {
        return Err(ToolExecutionError::new(
            "mcp_server_unready",
            format!(
                "MCP server `{}` is unready: {}",
                server.name, server.ready_reason
            ),
        ));
    }
    let server_key = normalize_server_key(&server.name);

    if !mcp_tool_allowed(&policy, &tool_name) {
        let mut store = lock_runtime_store()?;
        let state = store.states.entry(server_key.clone()).or_default();
        state.policy_denied_calls = state.policy_denied_calls.saturating_add(1);
        return Err(ToolExecutionError::new(
            "mcp_tool_blocked",
            format!("MCP tool \"{tool_name}\" blocked by [tools.mcp].allow_tools"),
        ));
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
                    .ok_or_else(|| ToolExecutionError::new("mcp_runtime_error", "missing MCP session"))?,
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
    Ok(ToolCallOutput::from_payload(payload))
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

fn run_browser_structured_tool(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    browser_tool_name: &str,
    public_tool_name: &str,
) -> Result<ToolCallOutput, ToolExecutionError> {
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
        ToolExecutionError::new(
            &error.error_class,
            format!(
                "{public_tool_name} backend `browser-structured` unavailable: {}. Run `grobot browser setup`, `grobot browser hub start`, then `grobot browser doctor`.",
                error.message
            ),
        )
    })?;
    let mcp_payload = serde_json::from_str::<Value>(&output.content).map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("{public_tool_name} failed to parse browser backend envelope: {error}"),
        )
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
    Ok(ToolCallOutput::from_payload(payload))
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
