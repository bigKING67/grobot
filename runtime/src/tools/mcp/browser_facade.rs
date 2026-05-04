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
