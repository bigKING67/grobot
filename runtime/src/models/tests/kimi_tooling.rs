    #[test]
    fn parse_kimi_stream_payload_keeps_reasoning_and_tool_calls() {
        let stream_body = concat!(
            "data: {\"id\":\"stream_1\",\"model\":\"kimi-k2.5\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"先\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"$web_search\",\"arguments\":\"{\\\"query\\\":\\\"今天\"}}]}}]}\n",
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"查新闻\",\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"热点\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n",
            "data: [DONE]\n",
        );
        let payload = parse_model_response_payload(stream_body, ProviderKind::Kimi)
            .expect("parse kimi stream payload");
        let message = payload["choices"][0]["message"].clone();
        assert_eq!(message["reasoning_content"], "先查新闻");
        assert_eq!(message["tool_calls"][0]["function"]["name"], "$web_search");
        assert_eq!(
            message["tool_calls"][0]["function"]["arguments"],
            "{\"query\":\"今天热点\"}"
        );
    }
    #[test]
    fn executor_injects_reasoning_content_for_kimi_tool_call_message() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list","arguments":"{\"path\":\".\"}"}}]}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"DONE"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_reasoning_context".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请列出当前目录文件".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
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
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi tool turn should succeed");
        assert_eq!(output.assistant_message, "DONE");
        assert_eq!(
            output
                .telemetry_events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<&str>>(),
            vec!["tool_start", "tool_end"]
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        assert_eq!(
            second_payload["messages"][1]["reasoning_content"],
            "Reasoning kept for continuity."
        );
        assert_eq!(second_payload["messages"][1]["content"], "");
        assert_eq!(second_payload["thinking"]["type"], "disabled");
    }

    #[test]
    fn executor_defers_followup_tools_after_high_risk_tool_in_same_batch() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"bash_1","type":"function","function":{"name":"bash","arguments":"{\"command\":\"printf first\"}"}},{"id":"list_1","type":"function","function":{"name":"list","arguments":"{\"path\":\".\"}"}}]}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"DONE_AFTER_DEFER"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_high_risk_defer".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "run bash then list".to_string(),
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
                enabled_tools: Some(vec!["bash".to_string(), "list".to_string()]),
                model_visible_tools: Some(vec!["bash".to_string(), "list".to_string()]),
                tool_surface_profile: Some("full_debug".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(true),
                bash_allowlist: Some(vec!["printf".to_string()]),
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("high-risk batch should finish after deferred observation");
        assert_eq!(output.assistant_message, "DONE_AFTER_DEFER");
        assert_eq!(
            output
                .telemetry_events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<&str>>(),
            vec![
                "tool_start",
                "tool_end",
                "tool_start",
                "tool_end",
                "tool_recovery"
            ]
        );
        assert_eq!(
            output.telemetry_events[0]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("input_summary"))
                .and_then(|summary| summary.get("command_preview"))
                .and_then(Value::as_str),
            Some("printf first")
        );
        assert_eq!(
            output.telemetry_events[1]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("risk_class"))
                .and_then(Value::as_str),
            Some("high_risk")
        );
        let bash_summary = output.telemetry_events[1]
            .payload
            .as_ref()
            .and_then(|payload| payload.get("output_summary"))
            .expect("bash tool_end should expose output summary");
        assert_eq!(bash_summary["stdout"].as_str(), Some("first"));
        assert_eq!(
            bash_summary["command_preview"].as_str(),
            Some("printf first")
        );
        assert_eq!(
            bash_summary["truncation"]["stdout"]["total_lines"].as_u64(),
            Some(1)
        );
        assert_eq!(
            output.telemetry_events[3]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("status"))
                .and_then(Value::as_str),
            Some("deferred")
        );
        assert_eq!(
            output.telemetry_events[3]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("error_class"))
                .and_then(Value::as_str),
            Some("tool_execution_deferred")
        );
        assert_eq!(
            output.telemetry_events[4]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("recovery_stage"))
                .and_then(Value::as_str),
            Some("observe_first")
        );
        assert_eq!(
            output.telemetry_events[4]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("recommended_next_action"))
                .and_then(Value::as_str),
            Some("observe_prior_tool_result")
        );
        assert_eq!(
            output.telemetry_events[4]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("recoverable"))
                .and_then(Value::as_bool),
            Some(true)
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let second_payload: Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        let tool_messages = second_payload["messages"]
            .as_array()
            .expect("messages should be array")
            .iter()
            .filter(|message| message.get("role").and_then(Value::as_str) == Some("tool"))
            .collect::<Vec<&Value>>();
        assert_eq!(tool_messages.len(), 2);
        let deferred_payload: Value = serde_json::from_str(
            tool_messages[1]
                .get("content")
                .and_then(Value::as_str)
                .expect("deferred tool content should be string"),
        )
        .expect("deferred tool payload should be json");
        assert_eq!(
            deferred_payload["error_class"].as_str(),
            Some("tool_execution_deferred")
        );
    }
