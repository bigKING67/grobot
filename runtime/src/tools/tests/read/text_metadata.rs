    #[test]
    fn read_v2_blocks_device_and_proc_stdio_alias_paths() {
        assert!(is_blocked_device_path(std::path::Path::new("/dev/stdout")));
        assert!(is_blocked_device_path(std::path::Path::new("/dev/fd/1")));
        assert!(is_blocked_device_path(std::path::Path::new("/proc/self/fd/2")));
        assert!(!is_blocked_device_path(std::path::Path::new("/tmp/read-ok.txt")));
    }

    #[test]
    fn read_v2_path_not_found_reports_structured_error_data() {
        let workspace = make_temp_workspace("read-v2-path-not-found-data");
        let input = make_read_only_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "missing.txt"
            }),
        )
        .expect_err("missing read target should fail");
        assert_eq!(error.error_class, "path_not_found");
        let data = error.data.as_ref().expect("path not found error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("path_not_found"));
        assert_eq!(data["path"].as_str(), Some("missing.txt"));
        assert_eq!(data["reason"].as_str(), Some("target_does_not_exist"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_path_guard_metadata_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-path-guard-metadata-error");
        let missing = workspace.join("missing.txt");
        let error = read_resolved_read_target_metadata(&missing)
            .expect_err("direct path guard metadata read failure should include recovery data");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("path guard metadata error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(
            data["source"].as_str(),
            Some("read.path_guard")
        );
        assert_eq!(data["stage"].as_str(), Some("read_target_metadata"));
        assert!(data["path"].as_str().unwrap_or_default().ends_with("missing.txt"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_include_metadata_false_omits_meta_field() {
        let workspace = make_temp_workspace("read-v2-no-meta");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-no-meta-1".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "sample.txt",
                "include_metadata": false
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload.get("meta").is_none());
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_metadata_reports_text_format_and_snapshot_scope() {
        let workspace = make_temp_workspace("read-v2-format-meta");
        fs::write(
            workspace.join("format.txt"),
            "\u{FEFF}line1\r\nline2\r\n",
        )
        .expect("write text with bom and crlf");
        let input = make_read_only_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "format.txt"
            }),
        )
        .expect("read should succeed");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert_eq!(payload["meta"]["line_ending"].as_str(), Some("crlf"));
        assert_eq!(payload["meta"]["bom_detected"].as_bool(), Some(true));
        assert_eq!(payload["meta"]["encoding"].as_str(), Some("utf-8"));
        assert_eq!(payload["meta"]["snapshot_full_view"].as_bool(), Some(true));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn text_format_detects_mixed_line_endings_and_bom() {
        let mixed = inspect_text_content_format("line1\r\nline2\nline3");
        assert_eq!(mixed.line_ending, "mixed");
        assert!(!mixed.bom_detected);

        let bom_single_line = inspect_text_content_format("\u{FEFF}single-line");
        assert_eq!(bom_single_line.line_ending, "none");
        assert!(bom_single_line.bom_detected);
    }

    #[test]
    fn read_v2_mtime_guard_reports_structured_metadata_errors() {
        let workspace = make_temp_workspace("read-v2-mtime-error");
        let missing = workspace.join("missing.txt");
        let error = read_file_mtime_ms(&missing).expect_err("missing mtime target should fail");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("mtime metadata error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(
            data["source"].as_str(),
            Some("file_snapshot_guard")
        );
        assert_eq!(data["stage"].as_str(), Some("read_metadata_for_mtime"));
        assert!(data["path"].as_str().unwrap_or_default().ends_with("missing.txt"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_text_window_open_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-text-window-open-error");
        let missing = workspace.join("missing.txt");
        let request = ReadRequest {
            path: "missing.txt".to_string(),
            start_line: 1,
            line_limit: None,
            include_metadata: true,
            pages: None,
            range_mode: "full",
        };
        let error = read_text_window(&missing, Some("missing.txt"), &request)
            .expect_err("missing text window target should fail");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("text window IO error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(data["path"].as_str(), Some("missing.txt"));
        assert_eq!(data["source"].as_str(), Some("read.text"));
        assert_eq!(data["stage"].as_str(), Some("open_text_window"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_text_format_open_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-text-format-open-error");
        let missing = workspace.join("missing.txt");
        let error = inspect_text_file_format(&missing, Some("missing.txt"))
            .expect_err("missing text format target should fail");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("text format IO error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(data["path"].as_str(), Some("missing.txt"));
        assert_eq!(data["source"].as_str(), Some("read.text_format"));
        assert_eq!(data["stage"].as_str(), Some("open_format_scan"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[cfg(unix)]
    #[test]
    fn read_v2_text_window_line_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-text-window-line-error");
        let request = ReadRequest {
            path: ".".to_string(),
            start_line: 1,
            line_limit: None,
            include_metadata: true,
            pages: None,
            range_mode: "full",
        };
        let error = read_text_window(&workspace, Some("."), &request)
            .expect_err("reading a directory as text should fail on line read");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("text line IO error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(data["path"].as_str(), Some("."));
        assert_eq!(data["source"].as_str(), Some("read.text"));
        assert_eq!(data["stage"].as_str(), Some("read_text_line"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[cfg(unix)]
    #[test]
    fn read_v2_text_format_read_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-text-format-read-error");
        let error = inspect_text_file_format(&workspace, Some("."))
            .expect_err("reading a directory for text format should fail");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("text format read IO error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(data["path"].as_str(), Some("."));
        assert_eq!(data["source"].as_str(), Some("read.text_format"));
        assert_eq!(data["stage"].as_str(), Some("read_format_scan"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[cfg(unix)]
    #[test]
    fn read_v2_full_hash_read_error_reports_recovery_data() {
        let workspace = make_temp_workspace("read-v2-full-hash-read-error");
        let request = ReadRequest {
            path: ".".to_string(),
            start_line: 1,
            line_limit: None,
            include_metadata: true,
            pages: None,
            range_mode: "full",
        };
        let error = read_text_window_with_guard_hash(&workspace, ".", &request)
            .expect_err("reading a directory for full hash should fail");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("full hash read IO error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("file_io_error"));
        assert_eq!(data["path"].as_str(), Some("."));
        assert_eq!(data["source"].as_str(), Some("read.text"));
        assert_eq!(data["stage"].as_str(), Some("read_full_for_hash"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_returns_empty_content_for_empty_text_file() {
        let workspace = make_temp_workspace("read-v2-empty-file");
        fs::write(workspace.join("empty.txt"), "").expect("write empty file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-empty".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "empty.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed for empty file");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert_eq!(payload["line_start"].as_u64(), Some(1));
        assert_eq!(payload["line_end"].as_u64(), Some(0));
        assert_eq!(payload["content"].as_str(), Some(""));
        assert_eq!(payload["has_more"].as_bool(), Some(false));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_returns_file_unchanged_for_same_range_and_mtime() {
        let workspace = make_temp_workspace("read-v2-dedup");
        fs::write(workspace.join("dedup.txt"), "line1\nline2\nline3\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "dedup.txt",
                "offset": 1,
                "limit": 2
            }),
        };
        let first = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("first read should succeed");
        let first_payload: Value = serde_json::from_str(&first.content).expect("first read output should be json");
        assert_eq!(first_payload["kind"].as_str(), Some("text"));

        let second = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("second read should succeed");
        let second_payload: Value = serde_json::from_str(&second.content).expect("second read output should be json");
        assert_eq!(second_payload["kind"].as_str(), Some("file_unchanged"));
        assert_eq!(second_payload["meta"]["cache"].as_str(), Some("hit"));
        assert_eq!(second_payload["meta"]["line_ending"].as_str(), Some("lf"));
        assert_eq!(second_payload["meta"]["bom_detected"].as_bool(), Some(false));
        assert_eq!(
            second_payload["meta"]["snapshot_full_view"].as_bool(),
            Some(false)
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_dedup_is_session_scoped() {
        let workspace = make_temp_workspace("read-v2-dedup-session");
        fs::write(workspace.join("session.txt"), "line1\nline2\nline3\n").expect("write sample text");
        let input_a = make_read_only_input(&workspace);
        let mut input_b = make_read_only_input(&workspace);
        input_b.session_key = "feishu:grobot:dm:tester-b".to_string();
        let call = ToolCallInput {
            id: "read-v2-7b".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "session.txt",
                "offset": 1,
                "limit": 2
            }),
        };
        let _first = LocalToolExecutor
            .execute_tool_call(&call, &input_a)
            .expect("first read should succeed");
        let second_same_session = LocalToolExecutor
            .execute_tool_call(&call, &input_a)
            .expect("second read should succeed");
        let payload_same: Value =
            serde_json::from_str(&second_same_session.content).expect("same-session payload should be json");
        assert_eq!(payload_same["kind"].as_str(), Some("file_unchanged"));

        let cross_session = LocalToolExecutor
            .execute_tool_call(&call, &input_b)
            .expect("cross-session first read should succeed");
        let payload_cross: Value =
            serde_json::from_str(&cross_session.content).expect("cross-session payload should be json");
        assert_eq!(payload_cross["kind"].as_str(), Some("text"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_supports_at_prefixed_path() {
        let workspace = make_temp_workspace("read-v2-at-path");
        fs::write(workspace.join("at.txt"), "hello\nworld\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7c".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "@at.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload["content"].as_str().unwrap_or_default().starts_with("hello\nworld"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_supports_curly_quote_filename_variant() {
        let workspace = make_temp_workspace("read-v2-curly-quote");
        let actual_name = "Capture d\u{2019}ecran.txt";
        fs::write(workspace.join(actual_name), "variant\nok\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7d".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "Capture d'ecran.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed via curly quote variant");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload["content"].as_str().unwrap_or_default().starts_with("variant\nok"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_supports_macos_ampm_filename_variant() {
        let workspace = make_temp_workspace("read-v2-ampm");
        let actual_name = "Screenshot\u{202F}AM.txt";
        fs::write(workspace.join(actual_name), "variant\nok\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7e".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "Screenshot AM.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed via AM/PM variant");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload["content"].as_str().unwrap_or_default().starts_with("variant\nok"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_reports_offset_out_of_bounds() {
        let workspace = make_temp_workspace("read-v2-oob");
        fs::write(workspace.join("oob.txt"), "line1\nline2\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-8".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "oob.txt",
                "offset": 9
            }),
        };
        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("out of bounds read should fail");
        assert_eq!(error.error_class, "range_out_of_bounds");
        let data = error.data.as_ref().expect("range error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("range_out_of_bounds"));
        assert_eq!(data["range_kind"].as_str(), Some("line"));
        assert_eq!(data["requested_offset"].as_u64(), Some(9));
        assert_eq!(data["available_count"].as_u64(), Some(2));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
