    fn kimi_error_test_input(base_url: String, allow_file_admin: bool) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-kimi-error-data".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run kimi tool".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(base_url),
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
                        allow_file_admin: Some(allow_file_admin),
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        }
    }

    fn assert_kimi_error_common<'a>(
        error: &'a ToolExecutionError,
        error_class: &str,
        diagnostic_kind: &str,
        source: &str,
        stage: &str,
    ) -> &'a Value {
        assert_eq!(error.error_class, error_class);
        let data = error.data.as_ref().expect("kimi error should include data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some(diagnostic_kind));
        assert_eq!(data["provider"].as_str(), Some("kimi"));
        assert_eq!(data["source"].as_str(), Some(source));
        assert_eq!(data["stage"].as_str(), Some(stage));
        assert!(
            data["recovery_hint"].as_str().unwrap_or_default().len() > 12,
            "kimi error should include actionable recovery_hint"
        );
        data
    }

    #[test]
    fn read_v2_kimi_upload_read_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-kimi-upload-read-error");
        let missing = workspace.join("missing.pdf");
        let client = Client::builder()
            .timeout(Duration::from_millis(100))
            .build()
            .expect("build reqwest client");

        let error = upload_kimi_file_for_read(
            &client,
            "https://api.moonshot.cn/v1",
            "sk-test",
            &missing,
            "file-extract",
            "application/pdf",
        )
        .expect_err("missing kimi upload source should fail before network");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("kimi upload read error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(data["source"].as_str(), Some("read.kimi_media"));
        assert_eq!(data["stage"].as_str(), Some("read_upload_file"));
        assert!(data["path"].as_str().unwrap_or_default().ends_with("missing.pdf"));

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_kimi_upload_http_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-kimi-upload-http-error");
        let target = workspace.join("invoice.pdf");
        fs::write(&target, b"%PDF-1.4").expect("write upload fixture");
        let server = start_mock_http_server("500 Internal Server Error", r#"{"error":"provider down"}"#);
        let client = Client::builder()
            .timeout(Duration::from_millis(1_000))
            .build()
            .expect("build reqwest client");

        let error = upload_kimi_file_for_read(
            &client,
            &server.base_url,
            "sk-test",
            &target,
            "file-extract",
            "application/pdf",
        )
        .expect_err("kimi upload HTTP error should include structured data");
        let data = assert_kimi_error_common(
            &error,
            "upstream_http_error",
            "upstream_http_error",
            "read.kimi_media",
            "upload_file_http_status",
        );
        assert_eq!(data["http_status"].as_u64(), Some(500));
        assert!(
            data["body_preview"]
                .as_str()
                .unwrap_or_default()
                .contains("provider down")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].path, "/v1/files");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_kimi_upload_invalid_json_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-kimi-upload-invalid-json");
        let target = workspace.join("invoice.pdf");
        fs::write(&target, b"%PDF-1.4").expect("write upload fixture");
        let server = start_mock_http_server("200 OK", "not-json");
        let client = Client::builder()
            .timeout(Duration::from_millis(1_000))
            .build()
            .expect("build reqwest client");

        let error = upload_kimi_file_for_read(
            &client,
            &server.base_url,
            "sk-test",
            &target,
            "file-extract",
            "application/pdf",
        )
        .expect_err("invalid kimi upload JSON should include structured data");
        assert_kimi_error_common(
            &error,
            "upstream_invalid_json",
            "upstream_invalid_json",
            "read.kimi_media",
            "upload_file_parse_json",
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_kimi_upload_missing_file_id_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-kimi-upload-missing-id");
        let target = workspace.join("invoice.pdf");
        fs::write(&target, b"%PDF-1.4").expect("write upload fixture");
        let server = start_mock_http_server("200 OK", r#"{"object":"file"}"#);
        let client = Client::builder()
            .timeout(Duration::from_millis(1_000))
            .build()
            .expect("build reqwest client");

        let error = upload_kimi_file_for_read(
            &client,
            &server.base_url,
            "sk-test",
            &target,
            "file-extract",
            "application/pdf",
        )
        .expect_err("missing kimi upload id should include structured data");
        assert_kimi_error_common(
            &error,
            "upstream_invalid_response",
            "upstream_invalid_response",
            "read.kimi_media",
            "upload_file_parse_id",
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_kimi_file_content_http_error_reports_file_id_data() {
        let server = start_mock_http_server("502 Bad Gateway", r#"{"error":"bad gateway"}"#);
        let client = Client::builder()
            .timeout(Duration::from_millis(1_000))
            .build()
            .expect("build reqwest client");

        let error = fetch_kimi_file_content_for_read(&client, &server.base_url, "sk-test", "file-123")
            .expect_err("kimi file content HTTP error should include file id");
        let data = assert_kimi_error_common(
            &error,
            "upstream_http_error",
            "upstream_http_error",
            "read.kimi_media",
            "fetch_file_content_http_status",
        );
        assert_eq!(data["http_status"].as_u64(), Some(502));
        assert_eq!(data["file_id"].as_str(), Some("file-123"));
        assert!(
            data["body_preview"]
                .as_str()
                .unwrap_or_default()
                .contains("bad gateway")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].path, "/v1/files/file-123/content");
    }

    #[test]
    fn read_v2_kimi_chat_http_error_reports_context_data() {
        let server = start_mock_http_server("503 Service Unavailable", r#"{"error":"busy"}"#);
        let client = Client::builder()
            .timeout(Duration::from_millis(1_000))
            .build()
            .expect("build reqwest client");

        let error = run_kimi_multimodal_extract_for_read(
            &client,
            &server.base_url,
            "sk-test",
            "kimi-k2.5",
            ReadKind::Image,
            "ms://file-image",
        )
        .expect_err("kimi chat HTTP error should include route context");
        let data = assert_kimi_error_common(
            &error,
            "upstream_http_error",
            "upstream_http_error",
            "read.kimi_media",
            "chat_http_status",
        );
        assert_eq!(data["http_status"].as_u64(), Some(503));
        assert_eq!(data["kind"].as_str(), Some("image"));
        assert_eq!(data["model"].as_str(), Some("kimi-k2.5"));
        assert_eq!(data["media_url"].as_str(), Some("ms://file-image"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].path, "/v1/chat/completions");
    }

    #[test]
    fn read_v2_kimi_multimodal_internal_kind_error_reports_data() {
        let client = Client::builder()
            .timeout(Duration::from_millis(100))
            .build()
            .expect("build reqwest client");

        let error = run_kimi_multimodal_extract_for_read(
            &client,
            "https://api.moonshot.cn/v1",
            "sk-test",
            "kimi-k2.5",
            ReadKind::Pdf,
            "ms://file-id",
        )
        .expect_err("unsupported multimodal kind should fail before network");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("kimi internal kind error data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("read_internal_state_error")
        );
        assert_eq!(data["source"].as_str(), Some("read.kimi_media"));
        assert_eq!(data["stage"].as_str(), Some("multimodal_kind_dispatch"));
        assert_eq!(data["kind"].as_str(), Some("pdf"));
    }

    #[test]
    fn kimi_formula_http_error_reports_context_data() {
        let server = start_mock_http_server("429 Too Many Requests", r#"{"error":"rate limited"}"#);
        let input = kimi_error_test_input(server.base_url.clone(), false);
        let call = ToolCallInput {
            id: "kimi-formula-http-error-data".to_string(),
            name: "web_search".to_string(),
            arguments: json!({
                "query": "grobot"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("kimi formula HTTP error should include context data");
        let data = assert_kimi_error_common(
            &error,
            "upstream_http_error",
            "upstream_http_error",
            "providers.kimi",
            "formula_http_status",
        );
        assert_eq!(data["http_status"].as_u64(), Some(429));
        assert_eq!(data["tool"].as_str(), Some("web_search"));
        assert_eq!(
            data["formula_uri"].as_str(),
            Some("moonshot/web-search:latest")
        );
        assert!(
            data["body_preview"]
                .as_str()
                .unwrap_or_default()
                .contains("rate limited")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].path.contains("/formulas/moonshot/web-search:latest/fibers"));
    }

    #[test]
    fn kimi_formula_tool_failed_reports_recovery_data() {
        let server = start_mock_http_server(
            "200 OK",
            r#"{"status":"failed","context":{"error":"quota exhausted"}}"#,
        );
        let input = kimi_error_test_input(server.base_url.clone(), false);
        let call = ToolCallInput {
            id: "kimi-formula-failed-data".to_string(),
            name: "web_search".to_string(),
            arguments: json!({
                "query": "grobot"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("failed kimi formula status should include recovery data");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("kimi formula failed error data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("kimi_formula_tool_failed")
        );
        assert_eq!(data["source"].as_str(), Some("providers.kimi"));
        assert_eq!(data["stage"].as_str(), Some("formula_tool_status"));
        assert_eq!(data["provider"].as_str(), Some("kimi"));
        assert_eq!(data["tool"].as_str(), Some("web_search"));
        assert_eq!(
            data["formula_uri"].as_str(),
            Some("moonshot/web-search:latest")
        );
        assert_eq!(data["provider_status"].as_str(), Some("failed"));
        assert_eq!(data["error_text"].as_str(), Some("quota exhausted"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].path.contains("/formulas/moonshot/web-search:latest/fibers"));
    }

    #[test]
    fn kimi_files_list_http_error_reports_recovery_data() {
        let server = start_mock_http_server("500 Internal Server Error", r#"{"error":"files down"}"#);
        let input = kimi_error_test_input(server.base_url.clone(), true);

        let error = run_kimi_files_list(&input)
            .expect_err("kimi files list HTTP error should include structured data");
        let data = assert_kimi_error_common(
            &error,
            "upstream_http_error",
            "upstream_http_error",
            "providers.kimi",
            "files_list_http_status",
        );
        assert_eq!(data["http_status"].as_u64(), Some(500));
        assert!(
            data["body_preview"]
                .as_str()
                .unwrap_or_default()
                .contains("files down")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].path, "/v1/files");
    }

    #[test]
    fn kimi_files_delete_http_error_reports_file_id_data() {
        let server = start_mock_http_server("404 Not Found", r#"{"error":"missing file"}"#);
        let input = kimi_error_test_input(server.base_url.clone(), true);
        let call = ToolCallInput {
            id: "kimi-files-delete-http-error-data".to_string(),
            name: "kimi_files_delete".to_string(),
            arguments: json!({
                "file_id": "file-delete-123"
            }),
        };

        let error = run_kimi_files_delete(&call, &input)
            .expect_err("kimi files delete HTTP error should include file id");
        let data = assert_kimi_error_common(
            &error,
            "upstream_http_error",
            "upstream_http_error",
            "providers.kimi",
            "files_delete_http_status",
        );
        assert_eq!(data["http_status"].as_u64(), Some(404));
        assert_eq!(data["file_id"].as_str(), Some("file-delete-123"));
        assert!(
            data["body_preview"]
                .as_str()
                .unwrap_or_default()
                .contains("missing file")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].path, "/v1/files/file-delete-123");
    }
