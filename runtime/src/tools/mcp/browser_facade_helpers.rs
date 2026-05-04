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
    if diagnostic_kind == "tool_argument_not_visible" {
        data.insert(
            "recovery_stage".to_string(),
            json!(TOOL_RECOVERY_STAGE_STRATEGY_SWITCH),
        );
        data.insert(
            "recommended_next_action".to_string(),
            json!(TOOL_RECOVERY_ACTION_INSPECT_VISIBLE_TOOL_SCHEMA_THEN_RETRY),
        );
        data.insert("recoverable".to_string(), json!(true));
        data.insert(
            "recovery_policy_version".to_string(),
            json!(tool_recovery_policy_version()),
        );
    }
    if let Some(applied) = applied_tmwd_default {
        data.insert("facade_default_tmwd_mode_applied".to_string(), json!(applied));
    }
    data
}
