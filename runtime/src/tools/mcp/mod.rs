include!("errors.rs");
include!("arguments.rs");
include!("protocol.rs");
include!("session.rs");

fn run_mcp_servers(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    for key in args.keys() {
        if key != "ready_only" && key != "include_disabled" {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported mcp_servers argument: {key}"),
            ));
        }
    }

    let ready_only = get_bool_arg(args, TOOL_MCP_SERVERS, "ready_only", false)?;
    let include_disabled_default = should_include_disabled_mcp_servers_by_default(context);
    let include_disabled = get_bool_arg(
        args,
        TOOL_MCP_SERVERS,
        "include_disabled",
        include_disabled_default,
    )?;
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
            "max_argument_bytes": MAX_MCP_CALL_ARGUMENT_BYTES,
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
    for key in args.keys() {
        if key != "server" && key != "tool" && key != "arguments" {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported mcp_call argument: {key}"),
            ));
        }
    }

    let server_name =
        parse_required_string_arg(args, TOOL_MCP_CALL, "server", "mcp_call.server is required")?;
    let tool_name =
        parse_required_string_arg(args, TOOL_MCP_CALL, "tool", "mcp_call.tool is required")?;
    let raw_arguments = args.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let call_arguments = parse_mcp_call_arguments(&raw_arguments, &server_name, &tool_name)?;
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
                data.insert("tool_name".to_string(), json!(tool_name.as_str()));
                data.insert("available_servers".to_string(), json!(available_servers));
                insert_mcp_unresolved_call_context(
                    &mut data,
                    &server_name,
                    &tool_name,
                    &call_arguments,
                );
                Value::Object(data)
            })
        })?;
    if !server.enabled {
        let error = ToolExecutionError::new(
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
        ));
        return Err(enrich_mcp_call_error_context(
            error,
            server,
            &tool_name,
            &call_arguments,
        ));
    }
    if !server.ready {
        let error = ToolExecutionError::new(
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
        ));
        return Err(enrich_mcp_call_error_context(
            error,
            server,
            &tool_name,
            &call_arguments,
        ));
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
        let error = ToolExecutionError::new(
            "mcp_tool_blocked",
            format!("MCP tool \"{tool_name}\" blocked by [tools.mcp].allow_tools"),
        )
        .with_data(data);
        return Err(enrich_mcp_call_error_context(
            error,
            server,
            &tool_name,
            &call_arguments,
        ));
    }

    let call_started_at = Instant::now();
    acquire_mcp_server_slot(server, &server_key, &policy).map_err(|error| {
        enrich_mcp_call_error_context(error, server, &tool_name, &call_arguments)
    })?;
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
    let call_result = call_result
        .map_err(|error| enrich_mcp_call_error_context(error, server, &tool_name, &call_arguments));

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
        Some(mcp_tool_result_error(
            server,
            &tool_name,
            &executed,
            &call_arguments,
        ))
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

include!("browser_facade_helpers.rs");
include!("browser_facade.rs");
