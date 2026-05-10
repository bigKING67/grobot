    #[test]
    fn dispatcher_rejects_tool_hidden_from_current_surface() {
        let workspace = make_temp_workspace("tool-not-visible");
        fs::write(workspace.join("notes.txt"), "secret").expect("write notes");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.model_visible_tools = Some(vec!["glob".to_string()]);
        }
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "notes.txt"
            }),
        )
        .expect_err("read should be hidden from this surface");
        assert_eq!(error.error_class, "tool_not_visible");
        assert!(
            error.message.contains("profile=coding"),
            "surface profile should be present in error: {}",
            error.message
        );
        let data = error
            .data
            .as_ref()
            .expect("tool_not_visible should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("tool_not_visible"));
        assert_eq!(data["tool"].as_str(), Some(TOOL_READ));
        assert_eq!(data["operation"].as_str(), Some("validate_tool_visible"));
        assert_eq!(data["tool_surface_profile"].as_str(), Some("coding"));
        assert_eq!(data["advanced_tool_schema"].as_bool(), Some(false));
        assert_eq!(
            data["recovery_stage"].as_str(),
            Some(TOOL_RECOVERY_STAGE_STRATEGY_SWITCH)
        );
        assert_eq!(
            data["recommended_next_action"].as_str(),
            Some(TOOL_RECOVERY_ACTION_SWITCH_TOOL_STRATEGY)
        );
        assert_eq!(data["recoverable"].as_bool(), Some(true));
        assert_eq!(
            data["recovery_policy_version"].as_str(),
            Some(tool_recovery_policy_version())
        );
        assert!(data["visible_tools"]
            .as_array()
            .expect("visible_tools array")
            .iter()
            .any(|value| value.as_str() == Some("glob")));
        assert!(!data["visible_tools"]
            .as_array()
            .expect("visible_tools array")
            .iter()
            .any(|value| value.as_str() == Some(TOOL_READ)));
        assert!(data["enabled_tools"]
            .as_array()
            .expect("enabled_tools array")
            .iter()
            .any(|value| value.as_str() == Some(TOOL_READ)));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn dispatcher_rejects_invalid_tool_surface_profile_context() {
        let workspace = make_temp_workspace("tool-surface-profile-invalid");
        fs::write(workspace.join("notes.txt"), "secret").expect("write notes");
        let executor = LocalToolExecutor;

        let mut invalid_input = make_read_only_input(&workspace);
        if let Some(context) = invalid_input.tool_context.as_mut() {
            context.tool_surface_profile = Some("chaos".to_string());
        }
        let invalid_error = execute_tool_payload(
            &executor,
            &invalid_input,
            TOOL_READ,
            json!({
                "path": "notes.txt"
            }),
        )
        .expect_err("invalid runtime tool surface profile must fail closed");
        assert_eq!(invalid_error.error_class, "tool_context_invalid");
        assert!(invalid_error
            .message
            .contains("tool_context.tool_surface_profile must be one of"));
        let invalid_data = invalid_error
            .data
            .as_ref()
            .expect("invalid profile error should include structured data");
        assert_eq!(invalid_data["diagnostic_kind"].as_str(), Some("tool_context_invalid"));
        assert_eq!(invalid_data["field"].as_str(), Some("tool_context.tool_surface_profile"));
        assert_eq!(invalid_data["raw_value"].as_str(), Some("chaos"));

        let mut empty_input = make_read_only_input(&workspace);
        if let Some(context) = empty_input.tool_context.as_mut() {
            context.tool_surface_profile = Some("   ".to_string());
        }
        let empty_error = execute_tool_payload(
            &executor,
            &empty_input,
            TOOL_READ,
            json!({
                "path": "notes.txt"
            }),
        )
        .expect_err("empty runtime tool surface profile must fail closed");
        assert_eq!(empty_error.error_class, "tool_context_invalid");
        let empty_data = empty_error
            .data
            .as_ref()
            .expect("empty profile error should include structured data");
        assert_eq!(empty_data["raw_value"].as_str(), Some("   "));

        assert_eq!(
            resolve_tool_context_surface_profile(Some("browser-advanced"))
                .expect("hyphenated profile should normalize"),
            TOOL_SURFACE_BROWSER_ADVANCED
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_slim_surface_rejects_hidden_range_and_media_args() {
        let workspace = make_temp_workspace("read-slim-hidden-args");
        fs::write(workspace.join("notes.txt"), "line 1\nline 2\n").expect("write notes");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.tool_surface_profile = Some("context".to_string());
            context.model_visible_tools = Some(vec![TOOL_READ.to_string()]);
        }
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            TOOL_READ,
            json!({
                "path": "notes.txt",
                "line_start": 1,
                "pages": "1-2"
            }),
        )
        .expect_err("slim read surface should reject hidden legacy/media args");
        assert_eq!(error.error_class, "tool_argument_not_visible");
        assert!(error.message.contains("line_start"));
        assert!(error.message.contains("pages"));
        let data = error.data.as_ref().expect("read hidden args should include data");
        assert_eq!(
            data["operation"].as_str(),
            Some("validate_read_args_visible")
        );
        let hidden_args = data["hidden_args"]
            .as_array()
            .expect("hidden_args should be an array");
        assert!(hidden_args
            .iter()
            .any(|value| value.as_str() == Some("line_start")));
        assert!(hidden_args.iter().any(|value| value.as_str() == Some("pages")));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn semantic_search_context_surface_rejects_hidden_debug_args() {
        let workspace = make_temp_workspace("semantic-search-slim-hidden-args");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.tool_surface_profile = Some("context".to_string());
            context.enabled_tools = Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]);
        }
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context engine drift",
                "technical_terms": ["ContextWeaver"],
                "refresh": "force",
                "timeout_ms": 30_000,
                "bridge_script": "/tmp/custom-contextweaver.mjs"
            }),
        )
        .expect_err("context semantic_search surface should reject hidden debug/cache args");
        assert_eq!(error.error_class, "tool_argument_not_visible");
        assert!(error.message.contains("technical_terms"));
        assert!(error.message.contains("bridge_script"));
        let data = error
            .data
            .as_ref()
            .expect("semantic hidden args should include data");
        assert_eq!(
            data["operation"].as_str(),
            Some("validate_semantic_search_args_visible")
        );
        let hidden_args = data["hidden_args"]
            .as_array()
            .expect("hidden_args should be an array");
        assert!(hidden_args
            .iter()
            .any(|value| value.as_str() == Some("technical_terms")));
        assert!(hidden_args
            .iter()
            .any(|value| value.as_str() == Some("bridge_script")));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn ask_user_slim_surface_rejects_internal_resume_args() {
        let workspace = make_temp_workspace("ask-user-slim-hidden-args");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.tool_surface_profile = Some("coding".to_string());
            context.enabled_tools = Some(vec![TOOL_ASK_USER.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_ASK_USER.to_string()]);
        }
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            TOOL_ASK_USER,
            json!({
                "questions": [
                    {
                        "id": "scope",
                        "header": "Scope",
                        "question": "Continue?"
                    }
                ],
                "blocking_node_id": "node-1",
                "resume_token": "resume-1"
            }),
        )
        .expect_err("normal ask_user surface should reject internal resume args");
        assert_eq!(error.error_class, "tool_argument_not_visible");
        let data = error
            .data
            .as_ref()
            .expect("ask_user hidden args should include data");
        assert_eq!(data["operation"].as_str(), Some("validate_ask_user_args_visible"));
        let hidden_args = data["hidden_args"]
            .as_array()
            .expect("hidden_args should be an array");
        assert!(hidden_args
            .iter()
            .any(|value| value.as_str() == Some("blocking_node_id")));
        assert!(hidden_args
            .iter()
            .any(|value| value.as_str() == Some("resume_token")));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn mcp_servers_slim_surface_rejects_include_disabled() {
        let workspace = make_temp_workspace("mcp-servers-slim-hidden-args");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.tool_surface_profile = Some("mcp".to_string());
            context.enabled_tools = Some(vec![TOOL_MCP_SERVERS.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_MCP_SERVERS.to_string()]);
        }
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            TOOL_MCP_SERVERS,
            json!({
                "ready_only": true,
                "include_disabled": true
            }),
        )
        .expect_err("normal mcp_servers surface should reject disabled-server inventory args");
        assert_eq!(error.error_class, "tool_argument_not_visible");
        let data = error
            .data
            .as_ref()
            .expect("mcp_servers hidden args should include data");
        assert_eq!(
            data["operation"].as_str(),
            Some("validate_mcp_servers_args_visible")
        );
        let hidden_args = data["hidden_args"]
            .as_array()
            .expect("hidden_args should be an array");
        assert!(hidden_args
            .iter()
            .any(|value| value.as_str() == Some("include_disabled")));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn dispatcher_reports_structured_missing_tool_context_recovery_data() {
        let workspace = make_temp_workspace("tool-context-missing");
        let mut input = make_read_only_input(&workspace);
        input.tool_context = None;
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "notes.txt"
            }),
        )
        .expect_err("missing tool context should fail before dispatch");
        assert_eq!(error.error_class, "tool_context_missing");
        let data = error.data.as_ref().expect("missing tool context should include error_data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("tool_context_missing"));
        assert_eq!(data["source"].as_str(), Some("tool_context"));
        assert_eq!(
            data["recovery_hint"].as_str(),
            Some("fix the runtime tool context/work_dir, then run grobot status --json before retrying")
        );
        assert!(data.get("work_dir").is_none());
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn dispatcher_reports_structured_invalid_work_dir_recovery_data() {
        let workspace = make_temp_workspace("tool-context-invalid");
        let missing_work_dir = workspace.join("missing-work-dir");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.work_dir = Some(missing_work_dir.to_string_lossy().to_string());
        }
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "notes.txt"
            }),
        )
        .expect_err("invalid work_dir should fail before dispatch");
        assert_eq!(error.error_class, "tool_context_invalid");
        let data = error.data.as_ref().expect("invalid work_dir should include error_data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("tool_context_invalid"));
        assert_eq!(data["source"].as_str(), Some("tool_context.work_dir"));
        assert_eq!(
            data["work_dir"].as_str(),
            Some(missing_work_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            data["recovery_hint"].as_str(),
            Some("choose a valid workspace directory, then run grobot status --json before retrying")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
