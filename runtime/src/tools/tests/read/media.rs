    #[test]
    fn read_v2_routes_image_file_to_image_kind() {
        let workspace = make_temp_workspace("read-v2-image-kind");
        fs::write(
            workspace.join("img.png"),
            vec![137_u8, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0],
        )
        .expect("write image-like file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "img.png"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("image"));
        assert!(
            payload["content"]
                .as_str()
                .unwrap_or_default()
                .contains("Image file detected")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_routes_video_file_to_video_kind() {
        let workspace = make_temp_workspace("read-v2-video-kind");
        fs::write(workspace.join("clip.mp4"), vec![0_u8; 32]).expect("write video-like file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-video-1".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "clip.mp4"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("video read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("video"));
        assert!(
            payload["content"]
                .as_str()
                .unwrap_or_default()
                .contains("Video file detected")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_notebook_respects_offset_limit_window() {
        let workspace = make_temp_workspace("read-v2-notebook-window");
        let notebook = json!({
            "cells": [
                { "cell_type": "markdown", "source": ["cell1"] },
                { "cell_type": "code", "source": ["cell2"] },
                { "cell_type": "markdown", "source": ["cell3"] },
                { "cell_type": "code", "source": ["cell4"] }
            ]
        });
        fs::write(
            workspace.join("nb.ipynb"),
            serde_json::to_string(&notebook).expect("serialize notebook"),
        )
        .expect("write notebook file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6b".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "nb.ipynb",
                "offset": 2,
                "limit": 2
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("notebook read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("notebook"));
        assert_eq!(payload["line_start"].as_u64(), Some(2));
        assert_eq!(payload["line_end"].as_u64(), Some(3));
        assert_eq!(payload["has_more"].as_bool(), Some(true));
        assert_eq!(payload["next_offset"].as_u64(), Some(4));
        assert_eq!(
            payload["meta"]["extra"]["selected_count"].as_u64(),
            Some(2)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_cells"]
                .as_array()
                .map(|cells| cells.len()),
            Some(2)
        );
        let content = payload["content"].as_str().unwrap_or_default();
        assert!(content.contains("[2] code cell2"));
        assert!(content.contains("[3] markdown cell3"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_notebook_empty_file_returns_empty_window() {
        let workspace = make_temp_workspace("read-v2-notebook-empty");
        let notebook = json!({
            "cells": []
        });
        fs::write(
            workspace.join("empty.ipynb"),
            serde_json::to_string(&notebook).expect("serialize notebook"),
        )
        .expect("write notebook file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6c-empty".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "empty.ipynb"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("empty notebook read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("notebook"));
        assert_eq!(payload["line_start"].as_u64(), Some(1));
        assert_eq!(payload["line_end"].as_u64(), Some(0));
        assert_eq!(payload["has_more"].as_bool(), Some(false));
        assert_eq!(
            payload["meta"]["extra"]["selected_count"].as_u64(),
            Some(0)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_cells"]
                .as_array()
                .map(|cells| cells.len()),
            Some(0)
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_pdf_pages_is_reflected_in_meta() {
        let workspace = make_temp_workspace("read-v2-pdf-pages");
        fs::write(workspace.join("report.pdf"), "%PDF-1.4\nplaceholder\n").expect("write pdf placeholder");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6c".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "report.pdf",
                "pages": "2-3"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("pdf read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("pdf"));
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["first_page"].as_u64(),
            Some(2)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["last_page"].as_u64(),
            Some(3)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_pages"].as_str(),
            Some("2-3")
        );
        assert!(payload["meta"]["extra"]["total_pages_known"].is_boolean());
        let extract_status = payload["meta"]["extra"]["extract_status"].as_str().unwrap_or_default();
        assert!(
            extract_status == "extracted"
                || extract_status == "extracted_ocr"
                || extract_status == "extracted_no_text"
                || extract_status == "fallback"
        );
        if extract_status == "fallback" {
            assert!(
                payload["content"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("install poppler")
            );
        }
        if extract_status == "extracted_no_text" {
            assert_eq!(
                payload["meta"]["extra"]["text_detected"].as_bool(),
                Some(false)
            );
        }
        if extract_status == "extracted_ocr" {
            assert_eq!(
                payload["meta"]["extra"]["ocr_applied"].as_bool(),
                Some(true)
            );
            assert_eq!(
                payload["meta"]["extra"]["text_detected"].as_bool(),
                Some(true)
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_pdf_default_window_is_reflected_when_pages_not_provided() {
        let workspace = make_temp_workspace("read-v2-pdf-default-window");
        fs::write(workspace.join("default.pdf"), "%PDF-1.4\nplaceholder\n").expect("write pdf placeholder");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6c-default".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "default.pdf"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("pdf read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("pdf"));
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["first_page"].as_u64(),
            Some(1)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["last_page"].as_u64(),
            Some(20)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_pages"].as_str(),
            Some("1-20")
        );
        let extract_status = payload["meta"]["extra"]["extract_status"].as_str().unwrap_or_default();
        if extract_status == "fallback" {
            assert!(
                payload["content"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("requested_pages=default(1-20)")
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_parse_pdf_page_range_accepts_valid_patterns() {
        assert_eq!(parse_pdf_page_range(Some("3")), Some((3, 3)));
        assert_eq!(parse_pdf_page_range(Some("2-5")), Some((2, 5)));
        assert_eq!(parse_pdf_page_range(Some(" 7 - 9 ")), Some((7, 9)));
        assert_eq!(parse_pdf_page_range(Some("0")), None);
        assert_eq!(parse_pdf_page_range(Some("9-2")), None);
        assert_eq!(parse_pdf_page_range(Some("abc")), None);
    }

    #[test]
    fn read_v2_parse_pdf_total_pages_extracts_value() {
        let raw = "Title: sample\nPages: 12\nEncrypted: no\n";
        assert_eq!(parse_pdf_total_pages(raw), Some(12));
        assert_eq!(parse_pdf_total_pages("Pages: 0"), None);
        assert_eq!(parse_pdf_total_pages("No page metadata"), None);
    }

    #[test]
    fn read_v2_parse_pdfimages_list_count_extracts_rows() {
        let raw = "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n\
---------------------\n\
1      0    image   1600  2300  rgb     3   8  image  no         8  0    300   300  121K 0.8%\n\
2      1    image   1600  2300  rgb     3   8  image  no         9  0    300   300  119K 0.8%\n";
        assert_eq!(parse_pdfimages_list_count(raw), Some(2));
        assert_eq!(
            parse_pdfimages_list_count(
                "page num type\n---------------------\n",
            ),
            Some(0)
        );
        assert_eq!(parse_pdfimages_list_count("not a pdfimages output"), None);
    }

    #[test]
    fn read_v2_build_pdf_extract_guidance_mentions_missing_tools() {
        let guidance = build_pdf_extract_guidance(&["pdftotext", "pdftoppm"]);
        assert!(guidance.contains("pdftotext"));
        assert!(guidance.contains("pdftoppm"));
        assert!(guidance.contains("poppler"));
        assert!(guidance.contains("tesseract"));
    }

    #[test]
    fn read_v2_parse_kimi_file_extract_response_prefers_content_field() {
        let parsed = parse_kimi_file_extract_response(
            r#"{"content":"hello\nworld","file_type":"application/pdf","filename":"invoice.pdf","title":"invoice"}"#,
        );
        assert_eq!(parsed.text, "hello\nworld");
        assert_eq!(parsed.content_source, "json.content");
        assert_eq!(parsed.file_type.as_deref(), Some("application/pdf"));
        assert_eq!(parsed.filename.as_deref(), Some("invoice.pdf"));
        assert_eq!(parsed.title.as_deref(), Some("invoice"));
        assert!(parsed.was_json_payload);
    }

    #[test]
    fn read_v2_parse_kimi_file_extract_response_falls_back_to_plain_text() {
        let parsed = parse_kimi_file_extract_response("plain text payload");
        assert_eq!(parsed.text, "plain text payload");
        assert_eq!(parsed.content_source, "plain_text");
        assert!(!parsed.was_json_payload);
    }

    #[test]
    fn read_v2_pdf_has_visible_text_detects_non_whitespace() {
        assert!(!pdf_has_visible_text("   \n\t\r  "));
        assert!(pdf_has_visible_text(" \nA "));
    }

    #[test]
    fn read_v2_should_attempt_pdf_ocr_respects_window_limit() {
        assert!(should_attempt_pdf_ocr(true, READ_PDF_OCR_MAX_PAGES));
        assert!(!should_attempt_pdf_ocr(
            true,
            READ_PDF_OCR_MAX_PAGES.saturating_add(1)
        ));
        assert!(!should_attempt_pdf_ocr(false, 1));
    }

    #[test]
    fn read_v2_should_use_kimi_multimodal_read_respects_provider_model_and_pages() {
        let input = TurnExecuteInput {
            request_id: "req-kimi-route".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(10_000),
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
            }),
            tool_context: None,
            attachments: vec![],
        };

        let request_pdf = ReadRequest {
            path: "invoice.pdf".to_string(),
            start_line: 1,
            line_limit: None,
            include_metadata: true,
            pages: None,
            range_mode: "full",
        };
        let request_pdf_with_pages = ReadRequest {
            pages: Some("1-2".to_string()),
            ..request_pdf.clone()
        };
        let request_image = ReadRequest {
            path: "snap.png".to_string(),
            ..request_pdf.clone()
        };
        assert!(should_use_kimi_multimodal_read(
            ReadKind::Pdf,
            &request_pdf,
            &input
        ));
        assert!(should_use_kimi_multimodal_read(
            ReadKind::Pdf,
            &request_pdf_with_pages,
            &input
        ));
        assert!(should_use_kimi_multimodal_read(
            ReadKind::Image,
            &request_image,
            &input
        ));

        let non_k25 = TurnExecuteInput {
            model_config: Some(RuntimeModelConfigInput {
                model: Some("kimi-k2".to_string()),
                ..input.model_config.clone().expect("model config")
            }),
            ..input.clone()
        };
        assert!(!should_use_kimi_multimodal_read(
            ReadKind::Pdf,
            &request_pdf,
            &non_k25
        ));
    }

    #[test]
    fn read_v2_kimi_remote_pdf_rejects_pages_argument() {
        let workspace = make_temp_workspace("read-v2-kimi-pdf-pages-reject");
        fs::write(workspace.join("invoice.pdf"), b"%PDF-1.4").expect("write minimal pdf-like bytes");

        let input = TurnExecuteInput {
            request_id: "req-kimi-pdf-pages-reject".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(10_000),
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
            id: "read-v2-kimi-pdf-pages-reject".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "invoice.pdf",
                "pages": "1-2"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("kimi remote pdf mode should reject read.pages");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        assert!(error.message.contains("read.pages is not supported in kimi remote pdf mode"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_kimi_media_requires_k25_model() {
        let workspace = make_temp_workspace("read-v2-kimi-model-gate");
        fs::write(workspace.join("invoice.pdf"), b"%PDF-1.4").expect("write minimal pdf-like bytes");

        let input = TurnExecuteInput {
            request_id: "req-kimi-model-gate".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2".to_string()),
                timeout_ms: Some(10_000),
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
            id: "read-v2-kimi-model-gate".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "invoice.pdf"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("kimi media read should require kimi-k2.5");
        assert_eq!(error.error_class, "config_missing");
        assert!(error.message.contains("model kimi-k2.5"));
        let data = error.data.as_ref().expect("kimi model gate should include error_data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_missing"));
        assert_eq!(data["required_config"].as_str(), Some("kimi-k2.5"));
        assert_eq!(data["source"].as_str(), Some("read.media"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn kimi_official_tool_config_missing_reports_required_config_data() {
        let input = TurnExecuteInput {
            request_id: "req-kimi-official-missing-config".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "search".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: None,
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
            }),
            tool_context: None,
            attachments: vec![],
        };
        let call = ToolCallInput {
            id: "kimi-official-missing-api-key".to_string(),
            name: "web_search".to_string(),
            arguments: json!({
                "query": "grobot"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("kimi official tool should require api key before upstream request");
        assert_eq!(error.error_class, "config_missing");
        let data = error.data.as_ref().expect("kimi official config error should include error_data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_missing"));
        assert_eq!(data["required_config"].as_str(), Some("model_config.api_key"));
        assert_eq!(data["source"].as_str(), Some("provider_options.kimi.official_tools"));
    }

    #[test]
    fn read_v2_compute_pdf_extract_plan_defaults_to_first_window() {
        let plan = compute_pdf_extract_plan(None, Some(57)).expect("plan should succeed");
        assert_eq!(plan.first_page, 1);
        assert_eq!(plan.last_page, 20);
        assert!(plan.has_more_pages);
        assert_eq!(plan.next_pages.as_deref(), Some("21-40"));
    }

    #[test]
    fn read_v2_compute_pdf_extract_plan_handles_requested_range() {
        let plan = compute_pdf_extract_plan(Some((12, 25)), Some(18)).expect("plan should succeed");
        assert_eq!(plan.first_page, 12);
        assert_eq!(plan.last_page, 18);
        assert!(!plan.has_more_pages);
        assert_eq!(plan.next_pages, None);

        let error = compute_pdf_extract_plan(Some((30, 35)), Some(18))
            .expect_err("out of range should fail");
        assert_eq!(error.error_class, "range_out_of_bounds");
    }
