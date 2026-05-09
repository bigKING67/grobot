    #[test]
    fn executor_reports_missing_config_when_required_env_absent() {
        let _env_guard = lock_env();
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_cfg_missing".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "ping".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: None,
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected config_missing");
        assert_eq!(error.error_class, "config_missing");
        assert!(error.message.contains(ENV_BASE_URL));
        let data = error.data.as_ref().expect("config_missing should include error_data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_missing"));
        assert_eq!(data["required_config"].as_str(), Some("model_config.base_url"));
        assert_eq!(data["source"].as_str(), Some("model_config"));
        assert_eq!(data["env_key"].as_str(), Some(ENV_BASE_URL));
    }

    #[test]
    fn executor_no_tool_fallback_recovers_from_empty_content_when_safe_mode_enabled() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"RECOVERED_WITH_FALLBACK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_no_tool_fallback".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请处理这个任务".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: Some("safe".to_string()),
                max_recovery_rounds: Some(2),
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected fallback recovery");
        assert_eq!(output.assistant_message, "RECOVERED_WITH_FALLBACK");
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_triggered")
        );
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_succeeded")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        let second_messages = second_payload["messages"]
            .as_array()
            .expect("messages should be an array");
        assert!(
            second_messages.iter().any(|message| {
                message
                    .get("content")
                    .and_then(serde_json::Value::as_str)
                    .map(|content| content.contains("[System][no_tool fallback]"))
                    .unwrap_or(false)
            }),
            "expected no_tool fallback prompt in retried request"
        );
    }

    #[test]
    fn executor_no_tool_fallback_off_keeps_original_invalid_response_error() {
        let _env_guard = lock_env();
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_no_tool_off".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请处理这个任务".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: Some("off".to_string()),
                max_recovery_rounds: Some(2),
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected upstream_invalid_response without fallback");
        assert_eq!(error.error_class, "upstream_invalid_response");

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn executor_no_tool_fallback_emits_exhausted_telemetry_after_recovery_budget_spent() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_no_tool_exhausted".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请处理这个任务".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: Some("safe".to_string()),
                max_recovery_rounds: Some(1),
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected upstream_invalid_response after recovery budget is exhausted");
        assert_eq!(error.error_class, "upstream_invalid_response");
        assert!(
            error
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_triggered")
        );
        assert!(
            error
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_exhausted")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
    }

    #[test]
    fn executor_rejects_tool_calls_with_explicit_error_class() {
        let _env_guard = lock_env();
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{}"}}]}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_tool_call".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请调用工具".to_string(),
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
            .expect_err("expected tool_call_not_supported");
        assert_eq!(error.error_class, "tool_call_not_supported");
        assert!(error.message.contains("lookup"));
        let data = error.data.as_ref().expect("tool route diagnostic data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("tool_call_not_supported")
        );
        assert_eq!(data["source"].as_str(), Some("model.executor"));
        assert_eq!(data["stage"].as_str(), Some("tool_call_context_validate"));
        assert_eq!(data["tool_name"].as_str(), Some("lookup"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn executor_invalid_tool_arguments_reports_structured_data() {
        let _env_guard = lock_env();
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list","arguments":"not-json"}}]}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_bad_tool_args".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "list files".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("invalid tool arguments should fail before tool execution");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        let data = error.data.as_ref().expect("tool arguments diagnostic data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("invalid_tool_arguments")
        );
        assert_eq!(data["source"].as_str(), Some("model.tooling"));
        assert_eq!(data["stage"].as_str(), Some("tool_arguments_parse_json"));
        assert_eq!(data["tool_name"].as_str(), Some("list"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn executor_rejects_malformed_tool_call_shapes_before_tool_execution() {
        let _env_guard = lock_env();
        let malformed_payloads = [
            (
                "tool_calls_not_array",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":{"id":"call_1"}}}]}"#,
                "upstream_invalid_response",
                "tool_calls_validate_array",
                None,
            ),
            (
                "tool_call_not_object",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":["not-object"]}}]}"#,
                "upstream_invalid_response",
                "tool_call_validate_object",
                Some(0),
            ),
            (
                "missing_tool_call_id",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"type":"function","function":{"name":"list","arguments":"{}"}}]}}]}"#,
                "upstream_invalid_response",
                "tool_call_id_parse",
                Some(0),
            ),
            (
                "missing_tool_call_type",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","function":{"name":"list","arguments":"{}"}}]}}]}"#,
                "upstream_invalid_response",
                "tool_call_type_parse",
                Some(0),
            ),
            (
                "missing_tool_call_arguments",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list"}}]}}]}"#,
                "upstream_invalid_response",
                "tool_call_arguments_parse",
                Some(0),
            ),
            (
                "non_string_tool_call_arguments",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list","arguments":{}}}]}}]}"#,
                "upstream_invalid_response",
                "tool_call_arguments_parse",
                Some(0),
            ),
            (
                "empty_tool_call_arguments",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list","arguments":"   "}}]}}]}"#,
                "invalid_tool_arguments",
                "tool_arguments_validate_non_empty",
                None,
            ),
        ];

        for (case_name, response_body, expected_error_class, expected_stage, expected_index) in
            malformed_payloads
        {
            let server = start_mock_http_server("200 OK", response_body);
            let _restore = apply_env(&[
                (ENV_BASE_URL, None),
                (ENV_API_KEY, None),
                (ENV_MODEL, None),
                (ENV_RUNTIME_TIMEOUT_MS, None),
            ]);

            let input = TurnExecuteInput {
                request_id: format!("req_rt_bad_tool_call_shape_{case_name}"),
                session_key: "feishu:tenant:dm:user".to_string(),
                system_prompt: None,
                user_message: "list files".to_string(),
                context_lines: vec![],
                model_config: Some(RuntimeModelConfigInput {
                    base_url: Some(server.base_url.clone()),
                    api_key: Some("runtime-test-key".to_string()),
                    model: Some("runtime-test-model".to_string()),
                    timeout_ms: Some(5_000),
                    provider_kind: None,
                    provider_options: None,
                }),
                tool_context: Some(RuntimeToolContextInput {
                    work_dir: Some(".".to_string()),
                    enabled_tools: Some(vec!["list".to_string()]),
                    model_visible_tools: Some(vec!["list".to_string()]),
                    tool_surface_profile: Some("coding".to_string()),
                    tool_surface_source: Some("test".to_string()),
                    tool_surface_reason: Some("test".to_string()),
                    tool_policy_version: Some("v1".to_string()),
                    advanced_tool_schema: Some(false),
                    bash_allowlist: None,
                    max_tool_rounds: Some(4),
                    no_tool_fallback_mode: None,
                    max_recovery_rounds: None,
                }),
                attachments: vec![],
            };
            let executor = OpenAiCompatibleModelExecutor;
            let error = executor
                .generate_assistant_message(&input, &LocalToolExecutor)
                .unwrap_err();
            assert_eq!(error.error_class, expected_error_class, "{case_name}");
            let data = error.data.as_ref().expect("tool call shape diagnostic data");
            assert_eq!(
                data["diagnostic_kind"].as_str(),
                Some(expected_error_class),
                "{case_name}"
            );
            assert_eq!(data["source"].as_str(), Some("model.tooling"), "{case_name}");
            assert_eq!(data["stage"].as_str(), Some(expected_stage), "{case_name}");
            if let Some(index) = expected_index {
                assert_eq!(
                    data["tool_call_index"].as_u64(),
                    Some(index),
                    "{case_name}"
                );
            }

            let calls = server.finish();
            assert_eq!(calls.len(), 1, "{case_name}");
        }
    }

    #[test]
    fn parse_ask_user_interrupt_invalid_json_reports_structured_data() {
        let tool_call = ToolCallInput {
            id: "ask_1".to_string(),
            name: "ask_user".to_string(),
            arguments: json!({}),
        };
        let output = ToolCallOutput::from_content("not-json".to_string());
        let error = parse_tool_interrupt(&tool_call, &output)
            .expect_err("invalid ask_user output should fail");
        assert_eq!(error.error_class, "invalid_tool_output");
        let data = error.data.as_ref().expect("ask-user diagnostic data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("invalid_tool_output"));
        assert_eq!(data["source"].as_str(), Some("model.ask_user_interrupt"));
        assert_eq!(data["stage"].as_str(), Some("ask_user_output_parse_json"));
        assert_eq!(data["tool_name"].as_str(), Some("ask_user"));
        assert_eq!(data["tool_call_id"].as_str(), Some("ask_1"));
    }

    #[test]
    fn executor_emits_structured_tool_error_data_in_tool_events() {
        let _env_guard = lock_env();
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"edit","arguments":"{\"path\":\"sample.txt\",\"edits\":[{\"old_text\":\"alpha\",\"new_text\":\"beta\"}]}"} }]}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_tool_error_data".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "edit file".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["edit".to_string()]),
                model_visible_tools: Some(vec!["edit".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let tool_error = ToolExecutionError::new(
            "edit_not_found",
            "edit.edits[0] not found in sample.txt; closest_lines=line 1: \"alpha\"",
        )
        .with_data(json!({
            "path": "sample.txt",
            "edit_index": 0,
            "diagnostics": {
                "diagnostic_kind": "edit_not_found",
                "closest_lines": [
                    {
                        "line": 1,
                        "preview": "alpha"
                    }
                ]
            }
        }));
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(
                &input,
                &FailingToolExecutor { error: tool_error },
            )
            .expect_err("expected structured tool failure");
        assert_eq!(error.error_class, "edit_not_found");
        let tool_end_payload = error.telemetry_events[1]
            .payload
            .as_ref()
            .expect("tool_end payload");
        assert_eq!(
            tool_end_payload["error_data"]["path"].as_str(),
            Some("sample.txt")
        );
        assert_eq!(
            tool_end_payload["error_data"]["diagnostics"]["closest_lines"][0]["line"].as_u64(),
            Some(1)
        );
        let recovery_payload = error.telemetry_events[2]
            .payload
            .as_ref()
            .expect("tool_recovery payload");
        assert_eq!(
            recovery_payload["error_data"]["path"].as_str(),
            Some("sample.txt")
        );
        assert_eq!(
            recovery_payload["error_data"]["diagnostics"]["closest_lines"][0]["preview"].as_str(),
            Some("alpha")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn executor_emits_recovery_for_observed_tool_result_error_without_aborting_turn() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"mcp_1","type":"function","function":{"name":"mcp_call","arguments":"{\"server\":\"mock\",\"tool\":\"fail\",\"arguments\":{}}"}}]}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"DONE_AFTER_OBSERVED_TOOL_ERROR"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_observed_tool_error".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "run mcp tool".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["mcp_call".to_string()]),
                model_visible_tools: Some(vec!["mcp_call".to_string()]),
                tool_surface_profile: Some("mcp".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let observed_error = ToolExecutionError::new(
            "mcp_tool_result_error",
            "MCP tool `fail` on server `mock` returned isError=true: bad args",
        )
        .with_data(json!({
            "diagnostic_kind": "mcp_tool_result_error",
            "server": "mock",
            "tool_name": "fail",
            "operation": "tools/call",
            "is_error": true,
            "result_preview": "bad args"
        }));
        let tool_output = r#"{"tool":"mcp_call","status":"ok","server":"mock","tool_name":"fail","result":{"is_error":true,"raw_preview":"bad args"}}"#;
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(
                &input,
                &ObservedErrorToolExecutor {
                    content: tool_output.to_string(),
                    error: observed_error,
                },
            )
            .expect("observed MCP tool result error should be fed back to model");
        assert_eq!(output.assistant_message, "DONE_AFTER_OBSERVED_TOOL_ERROR");
        assert_eq!(
            output
                .telemetry_events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<&str>>(),
            vec!["tool_start", "tool_end", "tool_recovery"]
        );
        let tool_end_payload = output.telemetry_events[1]
            .payload
            .as_ref()
            .expect("tool_end payload");
        assert_eq!(tool_end_payload["status"].as_str(), Some("failed"));
        assert_eq!(tool_end_payload["observed_by_model"].as_bool(), Some(true));
        assert_eq!(
            tool_end_payload["error_class"].as_str(),
            Some("mcp_tool_result_error")
        );
        assert_eq!(
            tool_end_payload["error_data"]["result_preview"].as_str(),
            Some("bad args")
        );
        let recovery_payload = output.telemetry_events[2]
            .payload
            .as_ref()
            .expect("tool_recovery payload");
        assert_eq!(
            recovery_payload["recommended_next_action"].as_str(),
            Some("inspect_mcp_tool_result_and_change_arguments")
        );
        assert_eq!(
            recovery_payload["error_data"]["diagnostic_kind"].as_str(),
            Some("mcp_tool_result_error")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        assert!(
            calls[1].body.contains("bad args"),
            "second model request should observe the failed MCP tool output"
        );
    }
