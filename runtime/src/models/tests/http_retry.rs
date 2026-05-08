    #[test]
    fn executor_roundtrip_with_mock_http_server() {
        let _env_guard = lock_env();
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"content":"MOCK_RUNTIME_OK"}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_success".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请总结本轮进展".to_string(),
            context_lines: vec!["user: hi".to_string(), "assistant: hello".to_string()],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("runtime model success");
        assert_eq!(output.assistant_message, "MOCK_RUNTIME_OK");
        assert_eq!(output.telemetry_events.len(), 0);

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        let call = &calls[0];
        assert_eq!(call.method, "POST");
        assert_eq!(call.path, "/v1/chat/completions");
        assert_eq!(
            header_value(&call.headers, "authorization"),
            Some("Bearer runtime-test-key")
        );
        let payload: serde_json::Value =
            serde_json::from_str(&call.body).expect("request body json");
        assert_eq!(payload["model"], "runtime-test-model");
        let user_content = payload["messages"][0]["content"]
            .as_str()
            .expect("user content string");
        assert!(user_content.contains("请总结本轮进展"));
        assert!(user_content.contains("[Conversation Context]"));
        assert!(user_content.contains("user: hi"));
    }

    #[test]
    fn executor_maps_non_success_status_to_upstream_http_error() {
        let _env_guard = lock_env();
        let server = start_mock_http_server("503 Service Unavailable", r#"{"error":"unavailable"}"#);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_http_error".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "ping".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected upstream_http_error");
        assert_eq!(error.error_class, "upstream_http_error");
        assert!(error.message.contains("status=503"));
        let data = error.data.as_ref().expect("upstream HTTP error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("upstream_http_error"));
        assert_eq!(data["source"].as_str(), Some("model.transport"));
        assert_eq!(data["stage"].as_str(), Some("chat_http_status"));
        assert_eq!(data["provider"].as_str(), Some("openai_compatible"));
        assert_eq!(data["http_status"].as_u64(), Some(503));
        assert_eq!(data["attempt"].as_u64(), Some(1));
        assert_eq!(data["max_attempts"].as_u64(), Some(1));
        assert!(data["body_preview"].as_str().unwrap_or_default().contains("unavailable"));
        assert!(data["recovery_hint"].as_str().unwrap_or_default().contains("provider"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn executor_kimi_retry_exhaustion_preserves_last_structured_error_data() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            ("429 Too Many Requests", r#"{"error":"busy 1"}"#),
            ("500 Internal Server Error", r#"{"error":"busy 2"}"#),
            ("503 Service Unavailable", r#"{"error":"busy 3"}"#),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_retry_exhausted".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "ping".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected retry exhaustion to keep last upstream error");
        assert_eq!(error.error_class, "upstream_http_error");
        let data = error.data.as_ref().expect("kimi retry exhaustion data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("upstream_http_error"));
        assert_eq!(data["source"].as_str(), Some("model.transport"));
        assert_eq!(data["stage"].as_str(), Some("chat_http_status"));
        assert_eq!(data["provider"].as_str(), Some("kimi"));
        assert_eq!(data["http_status"].as_u64(), Some(503));
        assert_eq!(data["attempt"].as_u64(), Some(3));
        assert_eq!(data["max_attempts"].as_u64(), Some(3));
        assert_eq!(data["retryable"].as_bool(), Some(false));
        assert!(data["body_preview"].as_str().unwrap_or_default().contains("busy 3"));

        let calls = server.finish();
        assert_eq!(calls.len(), 3, "recorded requests: {calls:?}");
    }

    #[test]
    fn executor_kimi_request_error_reports_retryable_false_after_attempts_exhausted() {
        let _env_guard = lock_env();
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind unused local port");
        let port = listener.local_addr().expect("read unused local port").port();
        drop(listener);
        let base_url = format!("http://127.0.0.1:{port}/v1");
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_request_retry_exhausted".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "ping".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(base_url),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(1_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected exhausted request error");
        assert_eq!(error.error_class, "upstream_connect_failed");
        let data = error.data.as_ref().expect("request error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("upstream_connect_failed"));
        assert_eq!(data["source"].as_str(), Some("model.transport"));
        assert_eq!(data["stage"].as_str(), Some("chat_request"));
        assert_eq!(data["provider"].as_str(), Some("kimi"));
        assert_eq!(data["attempt"].as_u64(), Some(3));
        assert_eq!(data["max_attempts"].as_u64(), Some(3));
        assert_eq!(data["retryable"].as_bool(), Some(false));
    }

    #[test]
    fn executor_retries_kimi_overload_and_succeeds() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "429 Too Many Requests",
                r#"{"error":{"message":"The engine is currently overloaded, please try again later"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"KIMI_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请总结一下当前状态".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi request should retry and succeed");
        assert_eq!(output.assistant_message, "KIMI_RETRY_OK");
        assert_eq!(output.telemetry_events.len(), 0);

        let calls = server.finish();
        assert_eq!(calls.len(), 2, "recorded requests: {calls:?}");
        assert_eq!(calls[0].path, "/v1/chat/completions");
        assert_eq!(calls[1].path, "/v1/chat/completions");
        let first_payload: serde_json::Value =
            serde_json::from_str(&calls[0].body).expect("first request body json");
        assert_eq!(first_payload["max_tokens"], 262_144);
        assert_eq!(first_payload["stream"], true);
        assert_eq!(first_payload["temperature"], 1.0);
        assert_eq!(first_payload["top_p"], 0.95);
    }

    #[test]
    fn executor_retries_kimi_reasoning_context_error_with_thinking_disabled() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "400 Bad Request",
                r#"{"error":{"message":"thinking is enabled but reasoning_content is missing in assistant tool call context"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"KIMI_REASONING_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_reasoning_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请联网搜索今天热点".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi reasoning context retry should succeed");
        assert_eq!(output.assistant_message, "KIMI_REASONING_RETRY_OK");
        assert_eq!(output.telemetry_events.len(), 0);

        let calls = server.finish();
        assert_eq!(calls.len(), 2, "recorded requests: {calls:?}");
        let first_payload: serde_json::Value =
            serde_json::from_str(&calls[0].body).expect("first request body json");
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        assert_eq!(first_payload["thinking"]["type"], "disabled");
        assert_eq!(second_payload["thinking"]["type"], "disabled");
    }

    #[test]
    fn executor_retries_kimi_invalid_temperature_without_sampling_controls() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "400 Bad Request",
                r#"{"error":{"message":"invalid temperature: only 0.6 is allowed for this model"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"KIMI_TEMP_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_temp_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请总结一下当前状态".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi invalid temperature retry should succeed");
        assert_eq!(output.assistant_message, "KIMI_TEMP_RETRY_OK");
        assert_eq!(output.telemetry_events.len(), 0);

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let first_payload: serde_json::Value =
            serde_json::from_str(&calls[0].body).expect("first request body json");
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        assert_eq!(first_payload["temperature"], 1.0);
        assert_eq!(first_payload["top_p"], 0.95);
        assert!(second_payload.get("temperature").is_none());
        assert!(second_payload.get("top_p").is_none());
    }
