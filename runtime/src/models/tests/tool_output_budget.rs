    #[test]
    fn executor_budgets_large_tool_output_before_next_model_request() {
        let _env_guard = lock_env();
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"web_scan_1","type":"function","function":{"name":"web_scan","arguments":"{\"max_chars\":300000}"}}]}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"DONE_AFTER_BUDGET"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_tool_output_budget".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "scan current page".to_string(),
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
                enabled_tools: Some(vec!["web_scan".to_string()]),
                model_visible_tools: Some(vec!["web_scan".to_string()]),
                tool_surface_profile: Some("browser".to_string()),
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
        let raw_page_text = "x".repeat(TOOL_MESSAGE_BROWSER_MAX_CHARS.saturating_add(20_000));
        let tool_output = serde_json::to_string(&json!({
            "tool": "web_scan",
            "status": "ok",
            "result": {
                "title": "large page",
                "text": raw_page_text
            }
        }))
        .expect("large tool output json");
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(
                &input,
                &StaticToolExecutor {
                    content: tool_output.clone(),
                },
            )
            .expect("large tool output should be budgeted");
        assert_eq!(output.assistant_message, "DONE_AFTER_BUDGET");

        let tool_end = output
            .telemetry_events
            .iter()
            .find(|event| event.event_type == "tool_end")
            .expect("tool_end event should be emitted");
        let output_budget = tool_end
            .payload
            .as_ref()
            .and_then(|payload| payload.get("output_budget"))
            .expect("tool_end should expose output budget");
        assert_eq!(output_budget["truncated"].as_bool(), Some(true));
        assert_eq!(
            output_budget["reason"].as_str(),
            Some("tool_message_budget")
        );
        assert_eq!(
            output_budget["max_chars"].as_u64(),
            Some(TOOL_MESSAGE_BROWSER_MAX_CHARS as u64)
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let second_payload: Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        let tool_content = second_payload["messages"]
            .as_array()
            .expect("messages should be array")
            .iter()
            .find(|message| message.get("role").and_then(Value::as_str) == Some("tool"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .expect("budgeted tool content should be string");
        assert!(
            tool_content.chars().count() <= TOOL_MESSAGE_BROWSER_MAX_CHARS,
            "budgeted tool content exceeded browser budget"
        );
        assert!(
            tool_content.len() < tool_output.len(),
            "tool content sent back to the model should be smaller than raw output"
        );
        let budgeted_payload: Value =
            serde_json::from_str(tool_content).expect("budgeted tool content should stay JSON");
        assert_eq!(
            budgeted_payload["output_budget"]["truncated"].as_bool(),
            Some(true)
        );
        assert_eq!(
            budgeted_payload["summary"]["tool"].as_str(),
            Some("web_scan")
        );
        assert!(
            budgeted_payload["preview"]
                .as_str()
                .is_some_and(|preview| preview.contains("tool output truncated by message budget")),
            "budgeted payload should carry a bounded preview"
        );
    }
