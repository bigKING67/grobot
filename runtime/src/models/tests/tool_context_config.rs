    fn base_tool_context_config_input(server_base_url: &str) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req_rt_invalid_tool_context_config".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "ping".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server_base_url.to_string()),
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
        }
    }

    fn assert_tool_context_config_error(
        input: TurnExecuteInput,
        expected_field: &str,
        expected_stage: &str,
    ) {
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("invalid explicit tool_context config should fail closed");
        assert_eq!(error.error_class, "config_invalid");
        let data = error.data.as_ref().expect("tool context config error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_invalid"));
        assert_eq!(data["source"].as_str(), Some("tool_context"));
        assert_eq!(data["field"].as_str(), Some(expected_field));
        assert_eq!(data["stage"].as_str(), Some(expected_stage));
    }

    #[test]
    fn runtime_tool_context_rejects_explicit_out_of_range_tool_loop_controls() {
        let _env_guard = lock_env();
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let base_url = "http://127.0.0.1:9/v1";

        let mut max_tool_rounds_input = base_tool_context_config_input(base_url);
        max_tool_rounds_input
            .tool_context
            .as_mut()
            .expect("tool context")
            .max_tool_rounds = Some(33);
        assert_tool_context_config_error(
            max_tool_rounds_input,
            "tool_context.max_tool_rounds",
            "max_tool_rounds_validate_range",
        );

        let mut max_recovery_rounds_input = base_tool_context_config_input(base_url);
        max_recovery_rounds_input
            .tool_context
            .as_mut()
            .expect("tool context")
            .max_recovery_rounds = Some(9);
        assert_tool_context_config_error(
            max_recovery_rounds_input,
            "tool_context.max_recovery_rounds",
            "max_recovery_rounds_validate_range",
        );
    }

    #[test]
    fn runtime_tool_context_rejects_unknown_no_tool_fallback_mode() {
        let _env_guard = lock_env();
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let mut input = base_tool_context_config_input("http://127.0.0.1:9/v1");
        input
            .tool_context
            .as_mut()
            .expect("tool context")
            .no_tool_fallback_mode = Some("loose".to_string());
        assert_tool_context_config_error(
            input,
            "tool_context.no_tool_fallback_mode",
            "no_tool_fallback_mode_validate",
        );
    }
