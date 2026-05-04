    #[test]
    fn executor_emits_prompt_cache_telemetry_for_anthropic_compatible_requests() {
        let _env_guard = lock_env();
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","usage":{"cache_read_input_tokens":9},"choices":[{"message":{"content":"PROMPT_CACHE_OK"}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_prompt_cache_telemetry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "please summarize".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("claude-3.7-sonnet".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("openai_compatible".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: Some(RuntimePromptCacheOptionsInput {
                            enabled: Some(true),
                            strategy: Some("user_last_n".to_string()),
                            user_last_n: Some(1),
                            capability: Some("anthropic_compatible".to_string()),
                        }),
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: None,
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected prompt cache request success");
        assert_eq!(output.assistant_message, "PROMPT_CACHE_OK");
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "prompt_cache_hint_applied")
        );
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "prompt_cache_usage_observed")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        let body_payload: Value =
            serde_json::from_str(&calls[0].body).expect("request body should be json");
        let first_message = body_payload["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("first message should exist");
        let content_part = first_message
            .get("content")
            .and_then(Value::as_array)
            .and_then(|parts| parts.first())
            .and_then(Value::as_object)
            .expect("first message content should be structured");
        assert_eq!(
            content_part
                .get("cache_control")
                .and_then(Value::as_object)
                .and_then(|cache| cache.get("type"))
                .and_then(Value::as_str),
            Some("ephemeral")
        );
    }
    #[test]
    fn executor_skips_prompt_cache_hints_without_explicit_capability() {
        let _env_guard = lock_env();
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"content":"PROMPT_CACHE_CAP_OFF"}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_prompt_cache_capability_missing".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "please summarize".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("claude-3.7-sonnet".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("openai_compatible".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: Some(RuntimePromptCacheOptionsInput {
                            enabled: Some(true),
                            strategy: Some("user_last_n".to_string()),
                            user_last_n: Some(1),
                            capability: None,
                        }),
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: None,
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected prompt cache request success");
        assert_eq!(output.assistant_message, "PROMPT_CACHE_CAP_OFF");
        let hint_event = output
            .telemetry_events
            .iter()
            .find(|event| event.event_type == "prompt_cache_hint_applied")
            .expect("prompt_cache_hint_applied event expected");
        assert_eq!(
            hint_event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("supported"))
                .and_then(Value::as_bool),
            Some(false)
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        let body_payload: Value =
            serde_json::from_str(&calls[0].body).expect("request body should be json");
        let first_message = body_payload["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("first message should exist");
        assert!(
            first_message
                .get("content")
                .and_then(Value::as_str)
                .is_some(),
            "without explicit capability, prompt cache hints should not mutate message content"
        );
    }

    #[test]
    fn executor_retries_without_prompt_cache_hint_when_upstream_rejects_cache_control() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "400 Bad Request",
                r#"{"error":{"message":"cache_control is unsupported for this model"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"PROMPT_CACHE_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_prompt_cache_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "please summarize".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("claude-3.7-sonnet".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("openai_compatible".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: Some(RuntimePromptCacheOptionsInput {
                            enabled: Some(true),
                            strategy: Some("user_last_n".to_string()),
                            user_last_n: Some(1),
                            capability: Some("anthropic_compatible".to_string()),
                        }),
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: None,
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected fallback retry success");
        assert_eq!(output.assistant_message, "PROMPT_CACHE_RETRY_OK");
        assert!(
            output.telemetry_events.iter().any(|event| {
                event.event_type == "prompt_cache_hint_applied"
                    && event
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("fallback_retry"))
                        .and_then(Value::as_bool)
                        == Some(true)
            }),
            "fallback retry telemetry expected"
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2, "recorded requests: {calls:?}");
        let first_body: Value =
            serde_json::from_str(&calls[0].body).expect("first request body should be json");
        let second_body: Value =
            serde_json::from_str(&calls[1].body).expect("second request body should be json");
        let first_message_first = first_body["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("first request should contain message");
        let second_message_first = second_body["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("second request should contain message");
        assert!(
            first_message_first
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_object)
                .and_then(|part| part.get("cache_control"))
                .is_some(),
            "first request should carry prompt cache hint"
        );
        assert!(
            second_message_first
                .get("content")
                .and_then(Value::as_str)
                .is_some(),
            "fallback retry should remove prompt cache hint payload"
        );
    }
