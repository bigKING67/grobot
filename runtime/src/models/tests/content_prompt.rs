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
