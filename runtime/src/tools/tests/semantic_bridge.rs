    #[test]
    fn semantic_search_returns_bridge_unavailable_when_override_missing() {
        let workspace = make_temp_workspace("semantic-search-missing-bridge");
        let input = TurnExecuteInput {
            request_id: "req-semantic-search".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "semantic search".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("full_debug".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(true),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let call = ToolCallInput {
            id: "semantic-search-1".to_string(),
            name: TOOL_SEMANTIC_SEARCH.to_string(),
            arguments: json!({
                "query": "session isolation",
                "bridge_script": "/definitely/not/exist/contextweaver-bridge.mjs"
            }),
        };
        let executor = LocalToolExecutor;
        let error = executor
            .execute_tool_call(&call, &input)
            .expect_err("expected semantic tool unavailable");
        assert_eq!(error.error_class, "semantic_tool_unavailable");
        let data = error.data.as_ref().expect("semantic error should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("semantic_tool_unavailable"));
        assert_eq!(data["tool"].as_str(), Some(TOOL_SEMANTIC_SEARCH));
        assert_eq!(data["bridge_command"].as_str(), Some("semantic-search"));
        assert_eq!(data["operation"].as_str(), Some("resolve_bridge_script"));
        assert_eq!(
            data["bridge_script_override"].as_str(),
            Some("/definitely/not/exist/contextweaver-bridge.mjs")
        );
        assert_eq!(data["source_roots_count"].as_u64(), Some(1));
        assert_eq!(data["requested_sources"].as_array().map(Vec::len), Some(3));
        assert!(
            data["recovery_hint"]
                .as_str()
                .is_some_and(|value| value.contains("ContextWeaver bridge path")),
            "recovery hint should name bridge configuration"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn prompt_enhancer_returns_bridge_unavailable_when_override_missing() {
        let workspace = make_temp_workspace("prompt-enhancer-missing-bridge");
        let input = TurnExecuteInput {
            request_id: "req-prompt-enhancer".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "enhance prompt".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![TOOL_PROMPT_ENHANCER.to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("full_debug".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(true),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let call = ToolCallInput {
            id: "prompt-enhancer-1".to_string(),
            name: TOOL_PROMPT_ENHANCER.to_string(),
            arguments: json!({
                "prompt": "optimize session routing policy",
                "bridge_script": "/definitely/not/exist/contextweaver-bridge.mjs"
            }),
        };
        let executor = LocalToolExecutor;
        let error = executor
            .execute_tool_call(&call, &input)
            .expect_err("expected prompt enhancer unavailable");
        assert_eq!(error.error_class, "semantic_tool_unavailable");
        let data = error.data.as_ref().expect("prompt enhancer error should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("semantic_tool_unavailable"));
        assert_eq!(data["tool"].as_str(), Some(TOOL_PROMPT_ENHANCER));
        assert_eq!(data["bridge_command"].as_str(), Some("prompt-enhancer"));
        assert_eq!(data["operation"].as_str(), Some("resolve_bridge_script"));
        assert_eq!(
            data["bridge_script_override"].as_str(),
            Some("/definitely/not/exist/contextweaver-bridge.mjs")
        );
        assert_eq!(data["source_roots_count"].as_u64(), Some(1));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn semantic_search_preserves_bridge_stderr_json_details() {
        let workspace = make_temp_workspace("semantic-search-bridge-json-error");
        let bridge_script = workspace.join("fake-contextweaver-bridge.mjs");
        fs::write(
            &bridge_script,
            r#"process.stderr.write(`${JSON.stringify({
  error_class: "semantic_index_config_invalid",
  message: "ContextWeaver index config matches no files",
  details: {
    index_config_path: "/tmp/cwconfig.json",
    matched_files: 0
  }
})}\n`);
process.exitCode = 1;
"#,
        )
        .expect("write fake bridge");
        let input = TurnExecuteInput {
            request_id: "req-semantic-search-bridge-error".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "semantic search".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("full_debug".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(true),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let call = ToolCallInput {
            id: "semantic-search-bridge-error-1".to_string(),
            name: TOOL_SEMANTIC_SEARCH.to_string(),
            arguments: json!({
                "query": "session isolation",
                "bridge_script": bridge_script.to_string_lossy().to_string()
            }),
        };
        let executor = LocalToolExecutor;
        let error = executor
            .execute_tool_call(&call, &input)
            .expect_err("expected bridge JSON error");
        assert_eq!(error.error_class, "semantic_index_config_invalid");
        assert_eq!(error.message, "ContextWeaver index config matches no files");
        let data = error.data.as_ref().expect("bridge error should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("semantic_index_config_invalid"));
        assert_eq!(data["tool"].as_str(), Some(TOOL_SEMANTIC_SEARCH));
        assert_eq!(data["bridge_command"].as_str(), Some("semantic-search"));
        assert_eq!(data["operation"].as_str(), Some("bridge_exit"));
        assert_eq!(data["bridge_exit_status"].as_i64(), Some(1));
        assert_eq!(data["index_config_path"].as_str(), Some("/tmp/cwconfig.json"));
        assert_eq!(data["matched_files"].as_u64(), Some(0));
        assert_eq!(
            data["bridge_error_details"]["matched_files"].as_u64(),
            Some(0)
        );
        assert!(
            data["stderr_preview"]
                .as_str()
                .is_some_and(|value| value.contains("semantic_index_config_invalid")),
            "stderr preview should preserve bridge JSON error class"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
