    #[test]
    fn read_v2_media_rejects_unknown_explicit_provider_kind() {
        let workspace = make_temp_workspace("read-v2-kimi-invalid-provider-kind");
        fs::write(workspace.join("invoice.pdf"), b"%PDF-1.4")
            .expect("write minimal pdf-like bytes");

        let input = TurnExecuteInput {
            request_id: "req-kimi-read-invalid-provider-kind".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(10_000),
                provider_kind: Some("moon".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: None,
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: Some(true),
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let call = ToolCallInput {
            id: "read-v2-kimi-invalid-provider-kind".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "invoice.pdf"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("explicit unknown provider_kind should fail before local fallback");
        assert_eq!(error.error_class, "config_invalid");
        let data = error.data.as_ref().expect("provider kind error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_invalid"));
        assert_eq!(
            data["field"].as_str(),
            Some("model_config.provider_kind")
        );
        assert_eq!(data["raw_value"].as_str(), Some("moon"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn kimi_official_tool_rejects_invalid_runtime_model_controls() {
        let base_model_config = RuntimeModelConfigInput {
            base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_key: Some("sk-test".to_string()),
            model: Some("kimi-k2.5".to_string()),
            timeout_ms: Some(10_000),
            provider_kind: Some("kimi".to_string()),
            provider_options: Some(RuntimeProviderOptionsInput {
                kimi: Some(RuntimeKimiOptionsInput {
                    web_search_mode: Some("official_only".to_string()),
                    disable_thinking_on_builtin_web_search: None,
                    official_tools_allowlist: Some(vec!["web_search".to_string()]),
                    official_tool_formulas: None,
                    prompt_cache: None,
                    max_tokens: None,
                    stream: None,
                    temperature: None,
                    top_p: None,
                    files_enabled: Some(true),
                    allow_file_admin: None,
                }),
            }),
        };
        let build_input = |model_config: RuntimeModelConfigInput| TurnExecuteInput {
            request_id: "req-kimi-invalid-model-controls".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "search".to_string(),
            context_lines: vec![],
            model_config: Some(model_config),
            tool_context: None,
            attachments: vec![],
        };
        let call = ToolCallInput {
            id: "kimi-invalid-controls".to_string(),
            name: "web_search".to_string(),
            arguments: json!({
                "query": "grobot"
            }),
        };

        let mut timeout_config = base_model_config.clone();
        timeout_config.timeout_ms = Some(999);
        let timeout_error = LocalToolExecutor
            .execute_tool_call(&call, &build_input(timeout_config))
            .expect_err("kimi official tool should reject timeout below minimum");
        assert_eq!(timeout_error.error_class, "config_invalid");
        let timeout_data = timeout_error
            .data
            .as_ref()
            .expect("timeout config error data");
        assert_eq!(timeout_data["diagnostic_kind"].as_str(), Some("config_invalid"));
        assert_eq!(
            timeout_data["field"].as_str(),
            Some("model_config.timeout_ms")
        );
        assert_eq!(
            timeout_data["stage"].as_str(),
            Some("runtime_timeout_validate_range")
        );

        let mut mode_config = base_model_config.clone();
        if let Some(kimi) = mode_config
            .provider_options
            .as_mut()
            .and_then(|options| options.kimi.as_mut())
        {
            kimi.web_search_mode = Some("always_on".to_string());
        }
        let mode_error = LocalToolExecutor
            .execute_tool_call(&call, &build_input(mode_config))
            .expect_err("kimi official tool should reject invalid web_search_mode");
        assert_eq!(mode_error.error_class, "config_invalid");
        let mode_data = mode_error
            .data
            .as_ref()
            .expect("web_search_mode config error data");
        assert_eq!(
            mode_data["field"].as_str(),
            Some("provider_options.kimi.web_search_mode")
        );
        assert_eq!(
            mode_data["stage"].as_str(),
            Some("kimi_web_search_mode_validate")
        );

        let mut allowlist_config = base_model_config;
        if let Some(kimi) = allowlist_config
            .provider_options
            .as_mut()
            .and_then(|options| options.kimi.as_mut())
        {
            kimi.official_tools_allowlist =
                Some(vec!["web-search".to_string(), "web_search".to_string()]);
        }
        let allowlist_error = LocalToolExecutor
            .execute_tool_call(&call, &build_input(allowlist_config))
            .expect_err("kimi official tool should reject duplicate allowlist");
        assert_eq!(allowlist_error.error_class, "config_invalid");
        let allowlist_data = allowlist_error
            .data
            .as_ref()
            .expect("allowlist config error data");
        assert_eq!(
            allowlist_data["field"].as_str(),
            Some("provider_options.kimi.official_tools_allowlist")
        );
        assert_eq!(
            allowlist_data["stage"].as_str(),
            Some("kimi_official_tools_allowlist_validate")
        );
    }

    #[test]
    fn kimi_official_tool_rejects_unknown_explicit_provider_kind() {
        let input = TurnExecuteInput {
            request_id: "req-kimi-invalid-provider-kind".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "search".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(10_000),
                provider_kind: Some("moon".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: Some("official_only".to_string()),
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: Some(vec!["web_search".to_string()]),
                        official_tool_formulas: None,
                        prompt_cache: None,
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: Some(true),
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };
        let call = ToolCallInput {
            id: "kimi-invalid-provider-kind".to_string(),
            name: "web_search".to_string(),
            arguments: json!({
                "query": "grobot"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("unknown explicit provider_kind should fail closed");
        assert_eq!(error.error_class, "config_invalid");
        let data = error
            .data
            .as_ref()
            .expect("provider kind config error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_invalid"));
        assert_eq!(
            data["field"].as_str(),
            Some("model_config.provider_kind")
        );
        assert_eq!(data["raw_value"].as_str(), Some("moon"));
        assert_eq!(data["stage"].as_str(), Some("provider_kind_validate"));
    }
