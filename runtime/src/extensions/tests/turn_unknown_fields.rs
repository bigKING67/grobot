fn parse_error_payload(input: &str) -> Value {
    let output = handle_json_line(input);
    serde_json::from_str(&output).expect("valid json")
}

fn assert_turn_unknown_field(
    case_id: &str,
    input: &str,
    message: &str,
    diagnostic_kind: &str,
    field: &str,
) {
    let payload = parse_error_payload(input);
    assert_eq!(payload["error"]["code"], -32602, "{case_id}");
    assert_eq!(payload["error"]["message"], message, "{case_id}");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some(diagnostic_kind),
        "{case_id}"
    );
    assert_eq!(
        payload["error"]["data"]["field"].as_str(),
        Some(field),
        "{case_id}"
    );
    assert_eq!(
        payload["error"]["data"]["source"].as_str(),
        Some(format!("runtime.turn.execute.params.{field}").as_str()),
        "{case_id}"
    );
}

#[test]
fn health_rejects_unknown_param_field() {
    let input = r#"{
        "jsonrpc":"2.0",
        "id":"health-unknown",
        "method":"runtime.health",
        "params":{"cache_stats_windows_ms":1000}
    }"#;
    let payload = parse_error_payload(input);
    assert_eq!(payload["id"].as_str(), Some("health-unknown"));
    assert_eq!(payload["error"]["code"], -32602);
    assert_eq!(
        payload["error"]["message"],
        "invalid_runtime_health_params"
    );
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_runtime_health_param_field")
    );
    assert_eq!(
        payload["error"]["data"]["field"].as_str(),
        Some("cache_stats_windows_ms")
    );
    assert_eq!(
        payload["error"]["data"]["source"].as_str(),
        Some("runtime.health.params.cache_stats_windows_ms")
    );
    assert_eq!(payload["error"]["data"]["raw_value"].as_u64(), Some(1000));
}

#[test]
fn tools_describe_rejects_unknown_param_field() {
    let input = r#"{
        "jsonrpc":"2.0",
        "id":"tools-unknown",
        "method":"runtime.tools.describe",
        "params":{"include_disabled":true}
    }"#;
    let payload = parse_error_payload(input);
    assert_eq!(payload["id"].as_str(), Some("tools-unknown"));
    assert_eq!(payload["error"]["code"], -32602);
    assert_eq!(
        payload["error"]["message"],
        "invalid_runtime_tools_describe_params"
    );
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_runtime_tools_describe_param_field")
    );
    assert_eq!(
        payload["error"]["data"]["field"].as_str(),
        Some("include_disabled")
    );
    assert_eq!(
        payload["error"]["data"]["source"].as_str(),
        Some("runtime.tools.describe.params.include_disabled")
    );
    assert_eq!(
        payload["error"]["data"]["raw_value"].as_bool(),
        Some(true)
    );
}

#[test]
fn turn_execute_rejects_unknown_param_fields() {
    let cases = [
        (
            "unknown-top-level",
            r#"{
                "jsonrpc":"2.0",
                "id":"unknown-top-level",
                "method":"runtime.turn.execute",
                "params":{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "user_messages":"typo"
                }
            }"#,
            "invalid params",
            "invalid_turn_execute_param_field",
            "user_messages",
        ),
        (
            "unknown-model-config",
            r#"{
                "jsonrpc":"2.0",
                "id":"unknown-model-config",
                "method":"runtime.turn.execute",
                "params":{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{"model_name":"kimi-k2.5"}
                }
            }"#,
            "invalid_model_config",
            "invalid_model_config_field",
            "model_config.model_name",
        ),
        (
            "unknown-provider-options",
            r#"{
                "jsonrpc":"2.0",
                "id":"unknown-provider-options",
                "method":"runtime.turn.execute",
                "params":{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{"provider_options":{"openai":{}}}
                }
            }"#,
            "invalid_provider_options",
            "invalid_model_config_provider_options_field",
            "model_config.provider_options.openai",
        ),
        (
            "unknown-kimi-option",
            r#"{
                "jsonrpc":"2.0",
                "id":"unknown-kimi-option",
                "method":"runtime.turn.execute",
                "params":{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{"provider_options":{"kimi":{"thinking":false}}}
                }
            }"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_field",
            "model_config.provider_options.kimi.thinking",
        ),
        (
            "unknown-prompt-cache",
            r#"{
                "jsonrpc":"2.0",
                "id":"unknown-prompt-cache",
                "method":"runtime.turn.execute",
                "params":{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{"provider_options":{"kimi":{"prompt_cache":{"ttl_ms":1000}}}}
                }
            }"#,
            "invalid_prompt_cache",
            "invalid_model_config_provider_options_kimi_prompt_cache_field",
            "model_config.provider_options.kimi.prompt_cache.ttl_ms",
        ),
        (
            "unknown-tool-context",
            r#"{
                "jsonrpc":"2.0",
                "id":"unknown-tool-context",
                "method":"runtime.turn.execute",
                "params":{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "tool_context":{"enabled_tool":["read"]}
                }
            }"#,
            "invalid_tool_context",
            "invalid_tool_context_field",
            "tool_context.enabled_tool",
        ),
        (
            "unknown-attachment",
            r#"{
                "jsonrpc":"2.0",
                "id":"unknown-attachment",
                "method":"runtime.turn.execute",
                "params":{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "attachments":[{"type":"image","source":"ms://file_1","size":42}]
                }
            }"#,
            "invalid_attachments",
            "invalid_attachments_field",
            "attachments[0].size",
        ),
    ];

    for (case_id, input, message, diagnostic_kind, field) in cases {
        assert_turn_unknown_field(case_id, input, message, diagnostic_kind, field);
    }
}
