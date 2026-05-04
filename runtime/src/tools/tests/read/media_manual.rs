    #[test]
    #[ignore = "manual smoke: set READ_V2_MANUAL_FILE to an external PDF path"]
    fn read_v2_manual_external_pdf_smoke_from_env() {
        let pdf_path = env::var("READ_V2_MANUAL_FILE")
            .expect("READ_V2_MANUAL_FILE is required for manual external pdf smoke");
        let work_dir = env::var("READ_V2_MANUAL_WORKDIR").unwrap_or_else(|_| {
            env::current_dir()
                .ok()
                .and_then(|path| path.to_str().map(|text| text.to_string()))
                .unwrap_or_else(|| ".".to_string())
        });
        let pages = env::var("READ_V2_MANUAL_PAGES").ok();
        let use_kimi = env::var("READ_V2_MANUAL_USE_KIMI")
            .ok()
            .map(|raw| matches!(raw.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false);

        let mut arguments = json!({
            "path": pdf_path,
        });
        if let Some(pages_value) = pages {
            arguments["pages"] = Value::String(pages_value);
        }

        let model_config = if use_kimi {
            let kimi_api_key = env::var("READ_V2_MANUAL_KIMI_API_KEY")
                .expect("READ_V2_MANUAL_KIMI_API_KEY is required when READ_V2_MANUAL_USE_KIMI=1");
            let kimi_base_url = env::var("READ_V2_MANUAL_KIMI_BASE_URL")
                .unwrap_or_else(|_| "https://api.moonshot.cn/v1".to_string());
            let kimi_model = env::var("READ_V2_MANUAL_KIMI_MODEL")
                .unwrap_or_else(|_| "kimi-k2.5".to_string());
            Some(RuntimeModelConfigInput {
                base_url: Some(kimi_base_url),
                api_key: Some(kimi_api_key),
                model: Some(kimi_model),
                timeout_ms: Some(30_000),
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
            })
        } else {
            None
        };

        let input = TurnExecuteInput {
            request_id: "req-read-v2-manual-external-pdf".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read pdf".to_string(),
            context_lines: vec![],
            model_config,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(work_dir),
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
            id: "read-v2-manual-external-pdf".to_string(),
            name: "read".to_string(),
            arguments,
        };

        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("manual external pdf read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["tool"].as_str(), Some("read"));
        assert_eq!(payload["kind"].as_str(), Some("pdf"));

        let extract_status = payload["meta"]["extra"]["extract_status"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(
            matches!(
                extract_status.as_str(),
                "extracted"
                    | "extracted_ocr"
                    | "extracted_no_text"
                    | "fallback"
                    | "extracted_remote_kimi_file_extract"
                    | "extracted_remote_kimi_multimodal"
                    | "extracted_no_text_remote"
            ),
            "unexpected extract_status: {extract_status}"
        );

        eprintln!(
            "[read_v2_manual_external_pdf_smoke_from_env] extract_status={} text_detected={:?} selected_page_range={:?}",
            extract_status,
            payload["meta"]["extra"]["text_detected"],
            payload["meta"]["extra"]["selected_page_range"],
        );
        if let Some(content) = payload["content"].as_str() {
            let preview = content
                .lines()
                .take(8)
                .collect::<Vec<&str>>()
                .join("\\n");
            eprintln!("[read_v2_manual_external_pdf_smoke_from_env] preview={preview}");
        }
    }
