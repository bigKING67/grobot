#[test]
fn turn_execute_rejects_null_model_config() {
    let input = r#"{
        "jsonrpc":"2.0",
        "id":"model-config-null",
        "method":"runtime.turn.execute",
        "params":{
            "request_id":"req_1",
            "session_key":"feishu:tenant:dm:user",
            "user_message":"hello",
            "model_config":null
        }
    }"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["error"]["code"], -32602);
    assert_eq!(payload["error"]["message"], "invalid_model_config");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_model_config_shape")
    );
    assert_eq!(
        payload["error"]["data"]["field"].as_str(),
        Some("model_config")
    );
    assert!(payload["error"]["data"]["raw_value"].is_null());
}

#[test]
fn turn_execute_rejects_required_field_shapes() {
    let cases = [
        (
            "missing-request-id",
            r#""session_key":"feishu:tenant:dm:user","user_message":"hello""#,
            "invalid_request_id",
            "invalid_request_id_shape",
            "request_id",
            true,
        ),
        (
            "null-request-id",
            r#""request_id":null,"session_key":"feishu:tenant:dm:user","user_message":"hello""#,
            "invalid_request_id",
            "invalid_request_id_shape",
            "request_id",
            true,
        ),
        (
            "number-session-key",
            r#""request_id":"req_1","session_key":42,"user_message":"hello""#,
            "invalid_session_key",
            "invalid_session_key_shape",
            "session_key",
            false,
        ),
        (
            "empty-session-key",
            r#""request_id":"req_1","session_key":"   ","user_message":"hello""#,
            "invalid_session_key",
            "invalid_session_key_shape",
            "session_key",
            false,
        ),
        (
            "missing-user-message",
            r#""request_id":"req_1","session_key":"feishu:tenant:dm:user""#,
            "invalid_user_message",
            "invalid_user_message_shape",
            "user_message",
            true,
        ),
        (
            "array-user-message",
            r#""request_id":"req_1","session_key":"feishu:tenant:dm:user","user_message":["hello"]"#,
            "invalid_user_message",
            "invalid_user_message_shape",
            "user_message",
            false,
        ),
    ];

    for (case_id, params_payload, message, diagnostic_kind, field, raw_is_null) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{{params_payload}}}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
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
        if raw_is_null {
            assert!(
                payload["error"]["data"]["raw_value"].is_null(),
                "{case_id}"
            );
        }
    }
}

#[test]
fn turn_execute_rejects_malformed_top_level_optional_shapes() {
    let cases = [
        (
            "system-prompt-null",
            r#""system_prompt":null"#,
            "invalid_system_prompt",
            "invalid_system_prompt_shape",
            "system_prompt",
        ),
        (
            "context-lines-null",
            r#""context_lines":null"#,
            "invalid_context_lines",
            "invalid_context_lines_shape",
            "context_lines",
        ),
        (
            "context-lines-entry-object",
            r#""context_lines":["ok",{}]"#,
            "invalid_context_lines",
            "invalid_context_lines_shape",
            "context_lines[1]",
        ),
        (
            "attachments-null",
            r#""attachments":null"#,
            "invalid_attachments",
            "invalid_attachments_shape",
            "attachments",
        ),
        (
            "attachments-entry-string",
            r#""attachments":["file"]"#,
            "invalid_attachments",
            "invalid_attachments_entry_shape",
            "attachments[0]",
        ),
    ];

    for (case_id, optional_payload, message, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    {optional_payload}
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
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
    }
}

#[test]
fn turn_execute_rejects_malformed_attachment_field_shapes() {
    let cases = [
        (
            "attachment-type-null",
            r#""type":null,"source":"ms://file_1""#,
            "invalid_attachments_type_shape",
            "attachments[0].type",
        ),
        (
            "attachment-source-type-null",
            r#""type":"image","source_type":null,"source":"ms://file_1""#,
            "invalid_attachments_source_type_shape",
            "attachments[0].source_type",
        ),
        (
            "attachment-source-null",
            r#""type":"image","source":null"#,
            "invalid_attachments_source_shape",
            "attachments[0].source",
        ),
        (
            "attachment-mime-type-array",
            r#""type":"image","source":"ms://file_1","mime_type":[]"#,
            "invalid_attachments_mime_type_shape",
            "attachments[0].mime_type",
        ),
        (
            "attachment-filename-null",
            r#""type":"image","source":"ms://file_1","filename":null"#,
            "invalid_attachments_filename_shape",
            "attachments[0].filename",
        ),
    ];

    for (case_id, attachment_payload, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "attachments":[{{{attachment_payload}}}]
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602, "{case_id}");
        assert_eq!(payload["error"]["message"], "invalid_attachments", "{case_id}");
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
    }
}

#[test]
fn turn_execute_rejects_null_model_config_scalars() {
    let cases = [
        (
            "base-url-null",
            r#""base_url":null"#,
            "invalid_model_config",
            "invalid_model_config_base_url_shape",
            "model_config.base_url",
        ),
        (
            "timeout-ms-null",
            r#""timeout_ms":null"#,
            "invalid_model_config",
            "invalid_model_config_timeout_ms_shape",
            "model_config.timeout_ms",
        ),
        (
            "provider-kind-null",
            r#""provider_kind":null"#,
            "invalid_model_config",
            "invalid_model_config_provider_kind_shape",
            "model_config.provider_kind",
        ),
    ];

    for (case_id, model_config_payload, message, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{{{model_config_payload}}}
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
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
        assert!(
            payload["error"]["data"]["raw_value"].is_null(),
            "{case_id}"
        );
    }
}

#[test]
fn turn_execute_rejects_non_object_tool_context() {
    let input = r#"{
        "jsonrpc":"2.0",
        "id":"tool-context-array",
        "method":"runtime.turn.execute",
        "params":{
            "request_id":"req_1",
            "session_key":"feishu:tenant:dm:user",
            "user_message":"hello",
            "tool_context":[]
        }
    }"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["error"]["code"], -32602);
    assert_eq!(payload["error"]["message"], "invalid_tool_context");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_tool_context_shape")
    );
    assert_eq!(
        payload["error"]["data"]["field"].as_str(),
        Some("tool_context")
    );
    assert!(payload["error"]["data"]["raw_value"].is_array());
}

#[test]
fn turn_execute_rejects_null_tool_context_scalars() {
    let cases = [
        (
            "work-dir-null",
            r#""work_dir":null"#,
            "invalid_tool_context_work_dir_shape",
            "tool_context.work_dir",
        ),
        (
            "advanced-schema-null",
            r#""advanced_tool_schema":null"#,
            "invalid_tool_context_advanced_tool_schema_shape",
            "tool_context.advanced_tool_schema",
        ),
        (
            "max-tool-rounds-null",
            r#""max_tool_rounds":null"#,
            "invalid_tool_context_max_tool_rounds_shape",
            "tool_context.max_tool_rounds",
        ),
        (
            "fallback-mode-null",
            r#""no_tool_fallback_mode":null"#,
            "invalid_tool_context_no_tool_fallback_mode_shape",
            "tool_context.no_tool_fallback_mode",
        ),
    ];

    for (case_id, tool_context_payload, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "tool_context":{{{tool_context_payload}}}
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602, "{case_id}");
        assert_eq!(payload["error"]["message"], "invalid_tool_context", "{case_id}");
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
        assert!(
            payload["error"]["data"]["raw_value"].is_null(),
            "{case_id}"
        );
    }
}

#[test]
fn turn_execute_rejects_malformed_tool_context_list_shapes() {
    let cases = [
        (
            "enabled-tools-null",
            r#""enabled_tools":null"#,
            "invalid_tool_context_enabled_tools_shape",
            "tool_context.enabled_tools",
        ),
        (
            "model-visible-tools-entry-null",
            r#""model_visible_tools":["read",null]"#,
            "invalid_tool_context_model_visible_tools_shape",
            "tool_context.model_visible_tools[1]",
        ),
        (
            "bash-allowlist-entry-number",
            r#""bash_allowlist":["git status",42]"#,
            "invalid_tool_context_bash_allowlist_shape",
            "tool_context.bash_allowlist[1]",
        ),
    ];

    for (case_id, tool_context_payload, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "tool_context":{{{tool_context_payload}}}
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602, "{case_id}");
        assert_eq!(payload["error"]["message"], "invalid_tool_context", "{case_id}");
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
    }
}

#[test]
fn turn_execute_rejects_null_prompt_cache_options() {
    let input = r#"{
        "jsonrpc":"2.0",
        "id":"prompt-cache-null",
        "method":"runtime.turn.execute",
        "params":{
            "request_id":"req_1",
            "session_key":"feishu:tenant:dm:user",
            "user_message":"hello",
            "model_config":{
                "provider_options":{
                    "kimi":{
                        "prompt_cache":null
                    }
                }
            }
        }
    }"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["error"]["code"], -32602);
    assert_eq!(payload["error"]["message"], "invalid_prompt_cache");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_model_config_provider_options_kimi_prompt_cache_shape")
    );
    assert_eq!(
        payload["error"]["data"]["field"].as_str(),
        Some("model_config.provider_options.kimi.prompt_cache")
    );
    assert!(payload["error"]["data"]["raw_value"].is_null());
}

#[test]
fn turn_execute_rejects_malformed_kimi_option_shapes() {
    let cases = [
        (
            "web-search-null",
            r#""web_search_mode":null"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_web_search_mode_shape",
            "model_config.provider_options.kimi.web_search_mode",
        ),
        (
            "allowlist-entry-null",
            r#""official_tools_allowlist":["web_search",null]"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_official_tools_allowlist_shape",
            "model_config.provider_options.kimi.official_tools_allowlist[1]",
        ),
        (
            "formula-array",
            r#""official_tool_formulas":[]"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_official_tool_formulas_shape",
            "model_config.provider_options.kimi.official_tool_formulas",
        ),
        (
            "max-tokens-null",
            r#""max_tokens":null"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_max_tokens_shape",
            "model_config.provider_options.kimi.max_tokens",
        ),
        (
            "stream-null",
            r#""stream":null"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_stream_shape",
            "model_config.provider_options.kimi.stream",
        ),
        (
            "temperature-string",
            r#""temperature":"0.8""#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_temperature_shape",
            "model_config.provider_options.kimi.temperature",
        ),
        (
            "files-enabled-null",
            r#""files_enabled":null"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_files_enabled_shape",
            "model_config.provider_options.kimi.files_enabled",
        ),
    ];

    for (case_id, kimi_payload, message, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{{
                        "provider_options":{{
                            "kimi":{{{kimi_payload}}}
                        }}
                    }}
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
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
    }
}

#[test]
fn turn_execute_rejects_malformed_prompt_cache_field_shapes() {
    let cases = [
        (
            "enabled-null",
            r#""enabled":null"#,
            "invalid_model_config_provider_options_kimi_prompt_cache_enabled_shape",
            "model_config.provider_options.kimi.prompt_cache.enabled",
        ),
        (
            "strategy-null",
            r#""strategy":null"#,
            "invalid_model_config_provider_options_kimi_prompt_cache_strategy_shape",
            "model_config.provider_options.kimi.prompt_cache.strategy",
        ),
        (
            "user-last-n-string",
            r#""user_last_n":"2""#,
            "invalid_model_config_provider_options_kimi_prompt_cache_user_last_n_shape",
            "model_config.provider_options.kimi.prompt_cache.user_last_n",
        ),
        (
            "capability-null",
            r#""capability":null"#,
            "invalid_model_config_provider_options_kimi_prompt_cache_capability_shape",
            "model_config.provider_options.kimi.prompt_cache.capability",
        ),
    ];

    for (case_id, prompt_cache_payload, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{{
                        "provider_options":{{
                            "kimi":{{
                                "prompt_cache":{{{prompt_cache_payload}}}
                            }}
                        }}
                    }}
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602, "{case_id}");
        assert_eq!(payload["error"]["message"], "invalid_prompt_cache", "{case_id}");
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
    }
}

#[test]
fn turn_execute_rejects_nested_non_object_model_option_shapes() {
    let cases = [
        (
            "provider-options-null",
            r#""provider_options":null"#,
            "invalid_provider_options",
            "invalid_model_config_provider_options_shape",
            "model_config.provider_options",
        ),
        (
            "kimi-options-array",
            r#""provider_options":{"kimi":[]}"#,
            "invalid_provider_options_kimi",
            "invalid_model_config_provider_options_kimi_shape",
            "model_config.provider_options.kimi",
        ),
    ];

    for (case_id, options_payload, message, diagnostic_kind, field) in cases {
        let input = format!(
            r#"{{
                "jsonrpc":"2.0",
                "id":"{case_id}",
                "method":"runtime.turn.execute",
                "params":{{
                    "request_id":"req_1",
                    "session_key":"feishu:tenant:dm:user",
                    "user_message":"hello",
                    "model_config":{{{options_payload}}}
                }}
            }}"#
        );
        let output = handle_json_line(input.as_str());
        let payload: Value = serde_json::from_str(&output).expect("valid json");
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
    }
}
