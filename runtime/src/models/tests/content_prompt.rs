    #[test]
    fn extracts_plain_string_content() {
        let payload = json!({
            "choices": [
                {
                    "message": {
                        "content": "hello from model"
                    }
                }
            ]
        });
        let result = extract_response_content(&payload);
        assert_eq!(result.as_deref(), Some("hello from model"));
    }

    #[test]
    fn extracts_array_content_parts() {
        let payload = json!({
            "choices": [
                {
                    "message": {
                        "content": [
                            { "type": "text", "text": "line-1" },
                            { "type": "text", "text": "line-2" }
                        ]
                    }
                }
            ]
        });
        let result = extract_response_content(&payload);
        assert_eq!(result.as_deref(), Some("line-1\nline-2"));
    }

    #[test]
    fn builds_prompt_with_context() {
        let input = TurnExecuteInput {
            request_id: "req_1".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请总结一下".to_string(),
            context_lines: vec!["A".to_string(), "B".to_string()],
            model_config: None,
            tool_context: None,
            attachments: vec![],
        };
        let prompt = build_runtime_user_prompt(&input);
        assert!(prompt.contains("请总结一下"));
        assert!(prompt.contains("[Conversation Context]"));
        assert!(prompt.contains("A"));
        assert!(prompt.contains("B"));
    }

    #[test]
    fn build_runtime_messages_prepends_system_prompt() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("test-model".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let config = load_runtime_model_config(Some(&model_config_input))
            .expect("resolve openai-compatible config");
        let client = Client::new();
        let input = TurnExecuteInput {
            request_id: "req_system_prompt".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: Some("SYSTEM built-in system prompt".to_string()),
            user_message: "hello".to_string(),
            context_lines: vec![],
            model_config: Some(model_config_input),
            tool_context: None,
            attachments: vec![],
        };
        let messages = build_runtime_messages(&input, &client, &config)
            .expect("runtime messages");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].get("role").and_then(Value::as_str), Some("system"));
        assert_eq!(
            messages[0].get("content").and_then(Value::as_str),
            Some("SYSTEM built-in system prompt")
        );
        assert_eq!(messages[1].get("role").and_then(Value::as_str), Some("user"));
    }

    #[test]
    fn build_runtime_messages_keeps_system_prompt_before_kimi_image_parts() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("kimi-k2.5".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("kimi".to_string()),
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
        };
        let config = load_runtime_model_config(Some(&model_config_input))
            .expect("resolve kimi config");
        let client = Client::new();
        let input = TurnExecuteInput {
            request_id: "req_kimi_system_prompt".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: Some("SYSTEM built-in system prompt".to_string()),
            user_message: "describe this image".to_string(),
            context_lines: vec![],
            model_config: Some(model_config_input),
            tool_context: None,
            attachments: vec![crate::models::engine::RuntimeAttachmentInput {
                attachment_type: "image".to_string(),
                source_type: "url".to_string(),
                source: "https://example.test/image.png".to_string(),
                mime_type: Some("image/png".to_string()),
                filename: Some("image.png".to_string()),
            }],
        };
        let messages = build_runtime_messages(&input, &client, &config)
            .expect("runtime messages");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].get("role").and_then(Value::as_str), Some("system"));
        assert_eq!(messages[1].get("role").and_then(Value::as_str), Some("user"));
        let user_parts = messages[1]
            .get("content")
            .and_then(Value::as_array)
            .expect("kimi content parts");
        assert!(user_parts.iter().any(|part| part.get("image_url").is_some()));
    }

    #[test]
    fn build_runtime_messages_reports_structured_attachment_path_error() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("kimi-k2.5".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("kimi".to_string()),
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
        };
        let config = load_runtime_model_config(Some(&model_config_input))
            .expect("resolve kimi config");
        let client = Client::new();
        let input = TurnExecuteInput {
            request_id: "req_kimi_missing_attachment".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "describe this file".to_string(),
            context_lines: vec![],
            model_config: Some(model_config_input),
            tool_context: None,
            attachments: vec![crate::models::engine::RuntimeAttachmentInput {
                attachment_type: "image".to_string(),
                source_type: "path".to_string(),
                source: "__missing_kimi_attachment__.png".to_string(),
                mime_type: Some("image/png".to_string()),
                filename: Some("missing.png".to_string()),
            }],
        };
        let error = build_runtime_messages(&input, &client, &config)
            .expect_err("missing attachment path should fail");
        assert_eq!(error.error_class, "attachment_invalid");
        let data = error.data.as_ref().expect("attachment diagnostic data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("attachment_invalid"));
        assert_eq!(data["source"].as_str(), Some("model.kimi_attachments"));
        assert_eq!(data["stage"].as_str(), Some("upload_file_path_validate"));
        assert_eq!(
            data["path"].as_str(),
            Some("__missing_kimi_attachment__.png")
        );
        assert_eq!(data["purpose"].as_str(), Some("image"));
        assert!(data["recovery_hint"]
            .as_str()
            .unwrap_or_default()
            .contains("local file paths"));
    }

    #[test]
    fn kimi_defaults_declare_builtin_web_search_and_disable_thinking() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("kimi-k2.5".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("kimi".to_string()),
            provider_options: None,
        };
        let resolved = load_runtime_model_config(Some(&model_config_input))
            .expect("resolve kimi config");
        let input = TurnExecuteInput {
            request_id: "req_kimi_defaults".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请搜索今天的科技新闻".to_string(),
            context_lines: vec![],
            model_config: Some(model_config_input),
            tool_context: None,
            attachments: vec![],
        };
        let definitions = build_tool_definitions(&input, &resolved).expect("tool definitions");
        let tool_entries = definitions.as_array().expect("tool array");
        assert!(
            tool_entries.iter().any(|entry| {
                entry
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .map(|value| value == "builtin_function")
                    .unwrap_or(false)
                    && entry
                        .get("function")
                        .and_then(serde_json::Value::as_object)
                        .and_then(|function| function.get("name"))
                        .and_then(serde_json::Value::as_str)
                        .map(|name| name == "$web_search")
                        .unwrap_or(false)
            }),
            "expected builtin $web_search in tool definitions"
        );
        assert!(should_disable_thinking_for_kimi_builtin_web_search(&resolved));
        assert_eq!(resolved.provider_options.kimi.max_tokens, 262_144);
        assert!(resolved.provider_options.kimi.stream);
        assert_eq!(resolved.provider_options.kimi.temperature, 1.0);
        assert_eq!(resolved.provider_options.kimi.top_p, 0.95);
    }

    #[test]
    fn runtime_model_config_rejects_explicit_out_of_range_timeout_controls() {
        let _guard = lock_env();
        let _restore = apply_env(&[
            (ENV_BASE_URL, Some("https://api.example.test/v1")),
            (ENV_API_KEY, Some("runtime-test-key")),
            (ENV_MODEL, Some("test-model")),
            (ENV_RUNTIME_TIMEOUT_MS, Some("999")),
        ]);
        let env_error =
            load_runtime_model_config(None).expect_err("env timeout below minimum should fail");
        assert_eq!(env_error.error_class, "config_invalid");
        let env_data = env_error.data.as_ref().expect("env timeout diagnostic data");
        assert_eq!(
            env_data["field"].as_str(),
            Some(ENV_RUNTIME_TIMEOUT_MS)
        );
        assert_eq!(
            env_data["stage"].as_str(),
            Some("runtime_timeout_validate_range")
        );

        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("test-model".to_string()),
            timeout_ms: Some(999),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let override_error = load_runtime_model_config(Some(&model_config_input))
            .expect_err("explicit model_config.timeout_ms below minimum should fail");
        assert_eq!(override_error.error_class, "config_invalid");
        let override_data = override_error
            .data
            .as_ref()
            .expect("override timeout diagnostic data");
        assert_eq!(
            override_data["field"].as_str(),
            Some("model_config.timeout_ms")
        );
        assert_eq!(
            override_data["stage"].as_str(),
            Some("runtime_timeout_override_validate_range")
        );
    }

    #[test]
    fn runtime_model_config_rejects_empty_timeout_env() {
        let _guard = lock_env();
        let _restore = apply_env(&[
            (ENV_BASE_URL, Some("https://api.example.test/v1")),
            (ENV_API_KEY, Some("runtime-test-key")),
            (ENV_MODEL, Some("test-model")),
            (ENV_RUNTIME_TIMEOUT_MS, Some("   ")),
        ]);
        let error =
            load_runtime_model_config(None).expect_err("empty timeout env should fail closed");
        assert_eq!(error.error_class, "config_invalid");
        let data = error.data.as_ref().expect("empty timeout diagnostic data");
        assert_eq!(
            data["field"].as_str(),
            Some(ENV_RUNTIME_TIMEOUT_MS)
        );
        assert_eq!(
            data["env_key"].as_str(),
            Some(ENV_RUNTIME_TIMEOUT_MS)
        );
        assert_eq!(
            data["stage"].as_str(),
            Some("runtime_timeout_validate_non_empty")
        );
    }

    #[test]
    fn runtime_model_config_rejects_explicit_empty_required_strings() {
        let _guard = lock_env();
        let _restore = apply_env(&[
            (ENV_BASE_URL, Some("https://api.example.test/v1")),
            (ENV_API_KEY, Some("runtime-test-key")),
            (ENV_MODEL, Some("test-model")),
        ]);
        let empty_override_config = RuntimeModelConfigInput {
            base_url: Some("   ".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("test-model".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let override_error = load_runtime_model_config(Some(&empty_override_config))
            .expect_err("explicit empty model_config.base_url should fail closed");
        assert_eq!(override_error.error_class, "config_invalid");
        let override_data = override_error
            .data
            .as_ref()
            .expect("empty override diagnostic data");
        assert_eq!(override_data["field"].as_str(), Some("model_config.base_url"));
        assert_eq!(
            override_data["stage"].as_str(),
            Some("required_model_config_string_validate_non_empty")
        );

        let _empty_env_restore = apply_env(&[(ENV_MODEL, Some(""))]);
        let valid_override_config = RuntimeModelConfigInput {
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("test-model".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let env_error = load_runtime_model_config(Some(&valid_override_config))
            .expect_err("explicit empty env should fail even with model_config override");
        assert_eq!(env_error.error_class, "config_invalid");
        let env_data = env_error.data.as_ref().expect("empty env diagnostic data");
        assert_eq!(env_data["field"].as_str(), Some(ENV_MODEL));
        assert_eq!(
            env_data["stage"].as_str(),
            Some("required_env_string_validate_non_empty")
        );
    }

    #[test]
    fn runtime_model_config_rejects_unknown_explicit_provider_kind() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("test-model".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("moon".to_string()),
            provider_options: None,
        };
        let error = load_runtime_model_config(Some(&model_config_input))
            .expect_err("unknown provider_kind should fail closed");
        assert_eq!(error.error_class, "config_invalid");
        let data = error.data.as_ref().expect("provider kind diagnostic data");
        assert_eq!(
            data["field"].as_str(),
            Some("model_config.provider_kind")
        );
        assert_eq!(data["raw_value"].as_str(), Some("moon"));
        assert_eq!(data["stage"].as_str(), Some("provider_kind_validate"));

        let empty_kind_config_input = RuntimeModelConfigInput {
            provider_kind: Some(" ".to_string()),
            ..model_config_input
        };
        let empty_error = load_runtime_model_config(Some(&empty_kind_config_input))
            .expect_err("empty provider_kind should fail closed");
        assert_eq!(empty_error.error_class, "config_invalid");
        let empty_data = empty_error
            .data
            .as_ref()
            .expect("empty provider kind diagnostic data");
        assert_eq!(
            empty_data["field"].as_str(),
            Some("model_config.provider_kind")
        );
        assert_eq!(
            empty_data["stage"].as_str(),
            Some("provider_kind_validate")
        );
    }

    #[test]
    fn runtime_kimi_options_reject_explicit_malformed_controls() {
        fn expect_invalid_kimi_field(
            kimi: RuntimeKimiOptionsInput,
            expected_field: &str,
            expected_stage: &str,
        ) {
            let model_config_input = RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(kimi),
                }),
            };
            let error = load_runtime_model_config(Some(&model_config_input))
                .expect_err("invalid kimi option should fail closed");
            assert_eq!(error.error_class, "config_invalid");
            let data = error.data.as_ref().expect("kimi option diagnostic data");
            assert_eq!(data["field"].as_str(), Some(expected_field));
            assert_eq!(data["stage"].as_str(), Some(expected_stage));
        }

        let base = RuntimeKimiOptionsInput {
            web_search_mode: None,
            disable_thinking_on_builtin_web_search: None,
            official_tools_allowlist: None,
            official_tool_formulas: None,
            prompt_cache: None,
            max_tokens: None,
            stream: None,
            temperature: None,
            top_p: None,
            files_enabled: None,
            allow_file_admin: None,
        };

        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                web_search_mode: Some("always_on".to_string()),
                ..base.clone()
            },
            "provider_options.kimi.web_search_mode",
            "kimi_web_search_mode_validate",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                web_search_mode: Some(" ".to_string()),
                ..base.clone()
            },
            "provider_options.kimi.web_search_mode",
            "kimi_web_search_mode_validate",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                official_tools_allowlist: Some(vec![]),
                ..base.clone()
            },
            "provider_options.kimi.official_tools_allowlist",
            "kimi_official_tools_allowlist_validate",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                official_tools_allowlist: Some(vec![
                    "web-search".to_string(),
                    "web_search".to_string(),
                ]),
                ..base.clone()
            },
            "provider_options.kimi.official_tools_allowlist",
            "kimi_official_tools_allowlist_validate",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                max_tokens: Some(100),
                ..base.clone()
            },
            "provider_options.kimi.max_tokens",
            "kimi_max_tokens_validate_range",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                temperature: Some(3.0),
                ..base.clone()
            },
            "provider_options.kimi.temperature",
            "kimi_temperature_validate_range",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                top_p: Some(1.5),
                ..base.clone()
            },
            "provider_options.kimi.top_p",
            "kimi_top_p_validate_range",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                prompt_cache: Some(RuntimePromptCacheOptionsInput {
                    enabled: Some(true),
                    strategy: Some("all_messages".to_string()),
                    user_last_n: None,
                    capability: None,
                }),
                ..base.clone()
            },
            "provider_options.kimi.prompt_cache.strategy",
            "prompt_cache_strategy_validate",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                prompt_cache: Some(RuntimePromptCacheOptionsInput {
                    enabled: Some(true),
                    strategy: Some("".to_string()),
                    user_last_n: None,
                    capability: None,
                }),
                ..base.clone()
            },
            "provider_options.kimi.prompt_cache.strategy",
            "prompt_cache_strategy_validate",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                prompt_cache: Some(RuntimePromptCacheOptionsInput {
                    enabled: Some(true),
                    strategy: None,
                    user_last_n: Some(13),
                    capability: None,
                }),
                ..base.clone()
            },
            "provider_options.kimi.prompt_cache.user_last_n",
            "prompt_cache_user_last_n_validate_range",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                prompt_cache: Some(RuntimePromptCacheOptionsInput {
                    enabled: Some(true),
                    strategy: None,
                    user_last_n: None,
                    capability: Some("openai_compatible".to_string()),
                }),
                ..base.clone()
            },
            "provider_options.kimi.prompt_cache.capability",
            "prompt_cache_capability_validate",
        );
        expect_invalid_kimi_field(
            RuntimeKimiOptionsInput {
                prompt_cache: Some(RuntimePromptCacheOptionsInput {
                    enabled: Some(true),
                    strategy: None,
                    user_last_n: None,
                    capability: Some(" ".to_string()),
                }),
                ..base
            },
            "provider_options.kimi.prompt_cache.capability",
            "prompt_cache_capability_validate",
        );
    }

    #[test]
    fn runtime_model_auto_cache_ttl_rejects_malformed_env() {
        let _guard = lock_env();
        let server = start_mock_http_server_without_responses();
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some(server.base_url.clone()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("auto".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let _restore = apply_env(&[(ENV_MODEL_AUTO_CACHE_TTL_SECS, Some("bad"))]);
        let error = load_runtime_model_config(Some(&model_config_input))
            .expect_err("malformed auto cache ttl should fail closed");
        assert_eq!(error.error_class, "config_invalid");
        let data = error.data.as_ref().expect("cache ttl diagnostic data");
        assert_eq!(
            data["env_key"].as_str(),
            Some(ENV_MODEL_AUTO_CACHE_TTL_SECS)
        );
        assert_eq!(
            data["stage"].as_str(),
            Some("model_auto_cache_ttl_parse")
        );
        let calls = server.finish();
        assert!(
            calls.is_empty(),
            "invalid cache TTL must fail before fetching /models"
        );
    }

    #[test]
    fn runtime_model_auto_cache_ttl_rejects_empty_env() {
        let _guard = lock_env();
        let server = start_mock_http_server_without_responses();
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some(server.base_url.clone()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("auto".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let _restore = apply_env(&[(ENV_MODEL_AUTO_CACHE_TTL_SECS, Some(""))]);
        let error = load_runtime_model_config(Some(&model_config_input))
            .expect_err("empty auto cache ttl should fail closed");
        assert_eq!(error.error_class, "config_invalid");
        let data = error.data.as_ref().expect("empty cache ttl diagnostic data");
        assert_eq!(
            data["field"].as_str(),
            Some(ENV_MODEL_AUTO_CACHE_TTL_SECS)
        );
        assert_eq!(
            data["env_key"].as_str(),
            Some(ENV_MODEL_AUTO_CACHE_TTL_SECS)
        );
        assert_eq!(
            data["stage"].as_str(),
            Some("model_auto_cache_ttl_validate_non_empty")
        );
        let calls = server.finish();
        assert!(
            calls.is_empty(),
            "empty cache TTL must fail before fetching /models"
        );
    }

    #[test]
    fn pick_auto_model_prioritizes_kimi_k25_family() {
        let models = vec![
            "moonshot-v1-128k-vision-preview".to_string(),
            "kimi-k2-thinking".to_string(),
            "kimi-k2.5".to_string(),
        ];
        let selected = pick_auto_model(&models, ProviderKind::Kimi).expect("selected model");
        assert_eq!(selected, "kimi-k2.5");
    }

    #[test]
    fn pick_auto_model_uses_first_for_non_kimi_provider() {
        let models = vec![
            "model-a".to_string(),
            "kimi-k2.5".to_string(),
            "model-c".to_string(),
        ];
        let selected =
            pick_auto_model(&models, ProviderKind::OpenAiCompatible).expect("selected model");
        assert_eq!(selected, "model-a");
    }

    #[test]
    fn model_auto_empty_catalog_reports_structured_config_error() {
        let server = start_mock_http_server("200 OK", r#"{"data":[]}"#);
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some(server.base_url.clone()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("auto".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let error = load_runtime_model_config(Some(&model_config_input))
            .expect_err("empty /models catalog should fail auto model selection");
        assert_eq!(error.error_class, "config_invalid");
        let data = error.data.as_ref().expect("auto model diagnostic data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_invalid"));
        assert_eq!(data["source"].as_str(), Some("model.catalog"));
        assert_eq!(data["stage"].as_str(), Some("auto_model_select"));
        assert_eq!(data["provider"].as_str(), Some("openai_compatible"));
        assert_eq!(data["model_count"].as_u64(), Some(0));
        assert!(data["recovery_hint"]
            .as_str()
            .unwrap_or_default()
            .contains("explicit model"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].path, "/v1/models");
    }

    #[test]
    fn prompt_cache_hints_target_latest_user_messages_only() {
        let mut messages = vec![
            json!({ "role": "system", "content": "system prompt" }),
            json!({ "role": "user", "content": "first user" }),
            json!({ "role": "assistant", "content": "assistant reply" }),
            json!({ "role": "user", "content": "second user" }),
            json!({ "role": "user", "content": [ { "type": "text", "text": "third user" } ] }),
        ];

        let applied = apply_prompt_cache_hints(
            &mut messages,
            PromptCacheOptions {
                enabled: true,
                strategy: PromptCacheStrategy::UserLastN,
                user_last_n: 2,
                capability: super::PromptCacheCapability::AnthropicCompatible,
            },
        );
        assert_eq!(applied, 2);

        let first_user = &messages[1];
        let second_user = &messages[3];
        let third_user = &messages[4];

        assert_eq!(
            first_user
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or(""),
            "first user"
        );
        assert_eq!(
            second_user
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_object)
                .and_then(|part| part.get("cache_control"))
                .and_then(Value::as_object)
                .and_then(|cache| cache.get("type"))
                .and_then(Value::as_str),
            Some("ephemeral")
        );
        assert_eq!(
            third_user
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_object)
                .and_then(|part| part.get("cache_control"))
                .and_then(Value::as_object)
                .and_then(|cache| cache.get("type"))
                .and_then(Value::as_str),
            Some("ephemeral")
        );
    }
    #[test]
    fn prompt_cache_usage_observation_parses_cached_token_signals() {
        let payload = json!({
            "usage": {
                "cache_read_input_tokens": 24,
                "cache_creation_input_tokens": 8,
                "input_tokens_details": {
                    "cached_tokens": 20
                }
            }
        });
        let observation = extract_prompt_cache_usage_observation(&payload)
            .expect("expected prompt cache observation");
        assert_eq!(observation.cached_tokens_total, 24);
        assert_eq!(
            observation
                .payload
                .get("cache_creation_input_tokens")
                .and_then(Value::as_u64),
            Some(8)
        );
    }
