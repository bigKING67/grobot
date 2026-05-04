    #[test]
    fn read_v2_supports_offset_limit_and_next_offset() {
        let workspace = make_temp_workspace("read-v2-offset-limit");
        fs::write(
            workspace.join("sample.txt"),
            "line1\nline2\nline3\nline4\nline5\n",
        )
        .expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-1".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "sample.txt",
                "offset": 2,
                "limit": 2
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert_eq!(payload["line_start"].as_u64(), Some(2));
        assert_eq!(payload["line_end"].as_u64(), Some(3));
        assert_eq!(payload["has_more"].as_bool(), Some(true));
        assert_eq!(payload["next_offset"].as_u64(), Some(4));
        assert!(
            payload["content"]
                .as_str()
                .unwrap_or_default()
                .contains("line2\nline3")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
    #[test]
    fn read_v2_rejects_mixed_legacy_and_offset_ranges() {
        let workspace = make_temp_workspace("read-v2-mixed-ranges");
        fs::write(workspace.join("mixed.txt"), "line1\nline2\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-2".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "mixed.txt",
                "line_start": 1,
                "offset": 1
            }),
        };
        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("read should fail with mixed ranges");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_preserves_legacy_line_start_line_end_behavior() {
        let workspace = make_temp_workspace("read-v2-legacy-range");
        fs::write(workspace.join("legacy.txt"), "l1\nl2\nl3\nl4\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-3".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "legacy.txt",
                "line_start": 2,
                "line_end": 3
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert_eq!(payload["line_start"].as_u64(), Some(2));
        assert_eq!(payload["line_end"].as_u64(), Some(3));
        assert!(
            payload["content"]
                .as_str()
                .unwrap_or_default()
                .starts_with("l2\nl3")
        );
        assert_eq!(payload["has_more"].as_bool(), Some(true));
        assert_eq!(payload["next_offset"].as_u64(), Some(4));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_truncates_by_default_line_cap() {
        let workspace = make_temp_workspace("read-v2-line-cap");
        let mut content = String::new();
        for index in 1..=2105 {
            content.push_str(format!("line-{index}\n").as_str());
        }
        fs::write(workspace.join("large.txt"), content).expect("write large text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-4".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "large.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert_eq!(payload["truncated"].as_bool(), Some(true));
        assert_eq!(payload["truncated_by"].as_str(), Some("lines"));
        assert_eq!(payload["line_end"].as_u64(), Some(2000));
        assert_eq!(payload["next_offset"].as_u64(), Some(2001));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_rejects_binary_files() {
        let workspace = make_temp_workspace("read-v2-binary");
        fs::write(workspace.join("binary.dat"), vec![0_u8, 1, 2, 3, 4]).expect("write binary file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-5".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "binary.dat"
            }),
        };
        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("binary read should fail");
        assert_eq!(error.error_class, "binary_file_not_supported");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
