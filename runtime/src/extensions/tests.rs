#[cfg(test)]
mod tests {
    use super::handle_json_line;
    use serde_json::Value;

    #[test]
    fn health_returns_ok() {
        let input = r#"{"jsonrpc":"2.0","id":"1","method":"runtime.health","params":{}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["result"]["status"], "ok");
        assert_eq!(payload["result"]["protocol_version"], "runtime.v1");
        assert!(
            payload["result"]["runtime_tools"]["overlap_guard"]["max_turn_keys"]
                .as_u64()
                .is_some(),
            "runtime.health should expose overlap_guard metrics"
        );
        assert!(
            payload["result"]["cache_stats"]["model_catalog"]["hit_total"]
                .as_u64()
                .is_some(),
            "runtime.health should expose model catalog cache metrics"
        );
        assert!(
            payload["result"]["cache_stats"]["prompt_cache"]["hint_attempted_total"]
                .as_u64()
                .is_some(),
            "runtime.health should expose prompt cache metrics"
        );
        assert!(
            payload["result"]["cache_stats"]["window_since_unix_ms"]
                .as_u64()
                .is_some(),
            "runtime.health should expose cache stats window start"
        );
        assert!(
            payload["result"]["cache_stats"]["model_catalog"]["window"]["hit_total"]
                .as_u64()
                .is_some(),
            "runtime.health should expose model catalog window metrics"
        );
    }

    #[test]
    fn health_accepts_window_and_reset_params() {
        let input = r#"{"jsonrpc":"2.0","id":"health-window","method":"runtime.health","params":{"cache_stats_window_ms":1000,"cache_stats_reset_window":true}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["result"]["status"], "ok");
        assert_eq!(
            payload["result"]["cache_stats"]["window_policy_ms"].as_u64(),
            Some(1000)
        );
    }

    #[test]
    fn health_rejects_zero_cache_stats_window() {
        let input = r#"{
            "jsonrpc":"2.0",
            "id":"health-window-invalid",
            "method":"runtime.health",
            "params":{"cache_stats_window_ms":0}
        }"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602);
        assert_eq!(
            payload["error"]["message"],
            "invalid_cache_stats_window_ms"
        );
        assert_eq!(
            payload["error"]["data"]["diagnostic_kind"].as_str(),
            Some("invalid_cache_stats_window_ms")
        );
        assert_eq!(
            payload["error"]["data"]["field"].as_str(),
            Some("cache_stats_window_ms")
        );
        assert_eq!(payload["error"]["data"]["raw_value"].as_u64(), Some(0));
    }

    #[test]
    fn health_rejects_null_cache_stats_window() {
        let input = r#"{
            "jsonrpc":"2.0",
            "id":"health-window-null",
            "method":"runtime.health",
            "params":{"cache_stats_window_ms":null}
        }"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602);
        assert_eq!(
            payload["error"]["message"],
            "invalid_cache_stats_window_ms"
        );
        assert_eq!(
            payload["error"]["data"]["diagnostic_kind"].as_str(),
            Some("invalid_cache_stats_window_ms")
        );
        assert_eq!(
            payload["error"]["data"]["field"].as_str(),
            Some("cache_stats_window_ms")
        );
        assert!(payload["error"]["data"]["raw_value"].is_null());
    }

    #[test]
    fn health_rejects_invalid_cache_stats_reset_window() {
        let input = r#"{
            "jsonrpc":"2.0",
            "id":"health-reset-invalid",
            "method":"runtime.health",
            "params":{"cache_stats_reset_window":"yes"}
        }"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602);
        assert_eq!(
            payload["error"]["message"],
            "invalid_cache_stats_reset_window"
        );
        assert_eq!(
            payload["error"]["data"]["diagnostic_kind"].as_str(),
            Some("invalid_cache_stats_reset_window")
        );
        assert_eq!(
            payload["error"]["data"]["field"].as_str(),
            Some("cache_stats_reset_window")
        );
        assert_eq!(
            payload["error"]["data"]["raw_value"].as_str(),
            Some("yes")
        );
    }

    #[test]
    fn tools_describe_returns_default_enabled_tools() {
        let input = r#"{"jsonrpc":"2.0","id":"tools-1","method":"runtime.tools.describe","params":{}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        let tools = payload["result"]["tools"]
            .as_array()
            .expect("tools should be array");
        assert!(!tools.is_empty());
        let default_enabled = payload["result"]["default_enabled_tools"]
            .as_array()
            .expect("default_enabled_tools should be array");
        let default_names = default_enabled
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<&str>>();
        assert!(default_names.contains(&"ask_user"));
        let recovery_actions = payload["result"]["tool_recovery_actions"]
            .as_array()
            .expect("tool_recovery_actions should be array")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<&str>>();
        assert!(recovery_actions.contains(&"ask_user_for_config_or_switch_provider"));
        assert!(recovery_actions.contains(&"inspect_error_and_switch_strategy"));
        assert!(!recovery_actions.contains(&"observe_and_continue"));
        assert_eq!(
            payload["result"]["tool_recovery_policy_version"].as_str(),
            Some("v1")
        );
        assert_eq!(
            payload["result"]["tool_message_budget_policy_version"].as_str(),
            Some("v1")
        );
        let message_budget_profiles = payload["result"]["tool_message_budget_profiles"]
            .as_array()
            .expect("tool_message_budget_profiles should be array");
        assert!(message_budget_profiles.iter().any(|row| {
            row["tool_name"] == "web_scan"
                && row["applies_to"] == "model_tool_message_content"
                && row["max_chars"].as_u64().is_some()
        }));
        let recovery_catalog = payload["result"]["tool_recovery_catalog"]
            .as_array()
            .expect("tool_recovery_catalog should be array");
        assert!(
            payload["result"]["tool_recovery_catalog_fingerprint"]
                .as_str()
                .is_some_and(|value| value.starts_with("recovery_catalog:")),
            "tools.describe should expose a stable recovery catalog fingerprint"
        );
        assert!(recovery_catalog.iter().any(|row| {
            row["recommended_next_action"] == "ask_user_for_config_or_switch_provider"
                && row["stage"] == "ask_user"
                && row["recoverable"] == false
        }));
        let schema_profiles = payload["result"]["tool_surface_schema_profiles"]
            .as_array()
            .expect("tool_surface_schema_profiles should be array");
        assert!(
            payload["result"]["tool_surface_schema_profiles_fingerprint"]
                .as_str()
                .is_some_and(|value| value.starts_with("schema_profiles:")),
            "tools.describe should expose a stable schema profiles fingerprint"
        );
        let browser_schema_profile = schema_profiles
            .iter()
            .find(|row| row["profile"].as_str() == Some("browser"))
            .expect("browser schema profile should be described");
        assert_eq!(browser_schema_profile["projection_mode"], "slim");
        assert!(
            browser_schema_profile["schema_fingerprint"]
                .as_str()
                .is_some_and(|value| value.starts_with("schema:")),
            "schema profile should expose a stable schema fingerprint"
        );
        assert!(
            browser_schema_profile["per_tool_suppressed_args"]["web_execute_js"]
                .as_array()
                .is_some_and(|items| items.iter().any(|value| value == "native_fallback_action")),
            "browser schema profile should expose suppressed browser args"
        );
        assert!(
            browser_schema_profile["per_tool_suppressed_args"]["web_scan"]
                .as_array()
                .is_some_and(|items| items.iter().any(|value| value == "text_only")),
            "browser schema profile should keep advanced scan args suppressed"
        );
        assert!(
            browser_schema_profile["per_tool_suppressed_args"]["read"]
                .as_array()
                .is_some_and(|items| items.iter().any(|value| value == "pages")),
            "browser schema profile should keep media read args suppressed"
        );
        assert_eq!(
            browser_schema_profile["schema_property_count"].as_u64(),
            Some(16)
        );
        assert_eq!(
            browser_schema_profile["suppressed_schema_property_count"].as_u64(),
            Some(31)
        );
        let mcp_schema_profile = schema_profiles
            .iter()
            .find(|row| row["profile"].as_str() == Some("mcp"))
            .expect("mcp schema profile should be described");
        assert_eq!(mcp_schema_profile["projection_mode"], "slim");
        assert_eq!(
            mcp_schema_profile["schema_property_count"].as_u64(),
            Some(5)
        );
        assert!(
            mcp_schema_profile["per_tool_suppressed_args"]["mcp_servers"]
                .as_array()
                .is_some_and(|items| items.iter().any(|value| value == "include_disabled")),
            "mcp schema profile should keep disabled-server inventory suppressed"
        );
        let full_debug_schema_profile = schema_profiles
            .iter()
            .find(|row| row["profile"].as_str() == Some("full_debug"))
            .expect("full_debug schema profile should be described");
        assert_eq!(full_debug_schema_profile["projection_mode"], "full");
        assert_eq!(
            full_debug_schema_profile["schema_property_count"].as_u64(),
            Some(92)
        );
        let has_ask_user_tool = tools.iter().any(|tool| {
            tool.get("function")
                .and_then(Value::as_object)
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                == Some("ask_user")
        });
        assert!(has_ask_user_tool);
    }

    #[test]
    fn turn_execute_validates_empty_fields() {
        let input = r#"{"jsonrpc":"2.0","id":"2","method":"runtime.turn.execute","params":{"request_id":"req_1","session_key":"feishu:tenant:dm:user","user_message":"   ","context_lines":["a","b"]}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602);
        assert_eq!(payload["error"]["message"], "empty request fields");
    }

    #[test]
    fn turn_execute_rejects_invalid_event_stream() {
        let input = r#"{
            "jsonrpc":"2.0",
            "id":"event-stream",
            "method":"runtime.turn.execute",
            "params":{
                "request_id":"req_1",
                "session_key":"feishu:tenant:dm:user",
                "user_message":"hello",
                "event_stream":"stdout_jsonl"
            }
        }"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602);
        assert_eq!(payload["error"]["message"], "invalid event_stream");
        assert_eq!(
            payload["error"]["data"]["diagnostic_kind"].as_str(),
            Some("invalid_event_stream")
        );
        assert_eq!(
            payload["error"]["data"]["field"].as_str(),
            Some("event_stream")
        );
        assert_eq!(
            payload["error"]["data"]["raw_value"].as_str(),
            Some("stdout_jsonl")
        );
    }
}
