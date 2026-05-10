    #[test]
    fn runtime_tools_reject_malformed_bool_arguments() {
        let workspace = make_temp_workspace("tool-arg-bool-validation");
        fs::write(workspace.join("notes.txt"), "alpha\n").expect("write notes");
        let mut read_input = make_read_only_input(&workspace);
        if let Some(context) = read_input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
        }
        let executor = LocalToolExecutor;

        let read_error = execute_tool_payload(
            &executor,
            &read_input,
            TOOL_READ,
            json!({
                "path": "notes.txt",
                "include_metadata": "false"
            }),
        )
        .expect_err("read.include_metadata must reject explicit string booleans");
        assert_eq!(read_error.error_class, "invalid_tool_arguments");
        assert_eq!(read_error.message, "read.include_metadata must be a boolean");

        let mut mcp_input = make_read_only_input(&workspace);
        if let Some(context) = mcp_input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
            context.enabled_tools = Some(vec![TOOL_MCP_SERVERS.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_MCP_SERVERS.to_string()]);
        }
        let mcp_error = execute_tool_payload(
            &executor,
            &mcp_input,
            TOOL_MCP_SERVERS,
            json!({
                "ready_only": "true"
            }),
        )
        .expect_err("mcp_servers.ready_only must reject explicit string booleans");
        assert_eq!(mcp_error.error_class, "invalid_tool_arguments");
        assert_eq!(
            mcp_error.message,
            "mcp_servers.ready_only must be a boolean"
        );

        let mut semantic_input = make_read_only_input(&workspace);
        if let Some(context) = semantic_input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
            context.enabled_tools = Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]);
        }
        let semantic_error = execute_tool_payload(
            &executor,
            &semantic_input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "alpha",
                "include_org": "true"
            }),
        )
        .expect_err("semantic_search.include_org must reject explicit string booleans");
        assert_eq!(semantic_error.error_class, "invalid_tool_arguments");
        assert_eq!(
            semantic_error.message,
            "semantic_search.include_org must be a boolean"
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn runtime_tools_reject_unknown_arguments_at_boundaries() {
        let workspace = make_temp_workspace("tool-arg-unknown-validation");
        fs::write(workspace.join("notes.txt"), "alpha\n").expect("write notes");
        let executor = LocalToolExecutor;

        let read_error = execute_tool_payload(
            &executor,
            &make_read_only_input(&workspace),
            TOOL_READ,
            json!({
                "path": "notes.txt",
                "surprise": true
            }),
        )
        .expect_err("read must reject unknown arguments");
        assert_eq!(read_error.error_class, "tool_argument_not_visible");
        assert!(
            read_error.message.contains("surprise"),
            "unexpected read unknown-arg error: {}",
            read_error.message
        );

        let mut mcp_input = make_read_only_input(&workspace);
        if let Some(context) = mcp_input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
            context.enabled_tools = Some(vec![TOOL_MCP_CALL.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_MCP_CALL.to_string()]);
        }
        let mcp_error = execute_tool_payload(
            &executor,
            &mcp_input,
            TOOL_MCP_CALL,
            json!({
                "server": "mock",
                "tool": "echo",
                "surprise": true
            }),
        )
        .expect_err("mcp_call must reject unknown arguments");
        assert_eq!(mcp_error.error_class, "invalid_tool_arguments");
        assert_eq!(mcp_error.message, "unsupported mcp_call argument: surprise");

        let mut semantic_input = make_read_only_input(&workspace);
        if let Some(context) = semantic_input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
            context.enabled_tools = Some(vec![TOOL_PROMPT_ENHANCER.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_PROMPT_ENHANCER.to_string()]);
        }
        let semantic_error = execute_tool_payload(
            &executor,
            &semantic_input,
            TOOL_PROMPT_ENHANCER,
            json!({
                "prompt": "alpha",
                "surprise": true
            }),
        )
        .expect_err("prompt_enhancer must reject unknown arguments");
        assert_eq!(semantic_error.error_class, "invalid_tool_arguments");
        assert_eq!(
            semantic_error.message,
            "unsupported prompt_enhancer argument: surprise"
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn semantic_tools_reject_malformed_array_and_source_arguments() {
        let workspace = make_temp_workspace("semantic-tool-array-validation");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
            context.enabled_tools = Some(vec![
                TOOL_SEMANTIC_SEARCH.to_string(),
                TOOL_PROMPT_ENHANCER.to_string(),
            ]);
            context.model_visible_tools = Some(vec![
                TOOL_SEMANTIC_SEARCH.to_string(),
                TOOL_PROMPT_ENHANCER.to_string(),
            ]);
        }
        let executor = LocalToolExecutor;

        let sources_not_array = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "session state",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "sources": "code"
            }),
        )
        .expect_err("semantic_search.sources must reject non-array values");
        assert_eq!(sources_not_array.error_class, "invalid_tool_arguments");
        assert_eq!(
            sources_not_array.message,
            "semantic_search.sources must be an array"
        );

        let invalid_source = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "session state",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "sources": ["code", "unknown"]
            }),
        )
        .expect_err("semantic_search.sources must reject unsupported source names");
        assert_eq!(invalid_source.error_class, "invalid_tool_arguments");
        assert_eq!(
            invalid_source.message,
            "semantic_search.sources must contain only code, memory, or wiki"
        );

        let duplicate_source = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "session state",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "sources": ["code", "code"]
            }),
        )
        .expect_err("semantic_search.sources must reject duplicates");
        assert_eq!(duplicate_source.error_class, "invalid_tool_arguments");
        assert_eq!(
            duplicate_source.message,
            "semantic_search.sources must not contain duplicate entries"
        );

        let non_string_term = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "session state",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "technical_terms": ["ContextWeaver", 7]
            }),
        )
        .expect_err("semantic_search.technical_terms must reject non-string array items");
        assert_eq!(non_string_term.error_class, "invalid_tool_arguments");
        assert_eq!(
            non_string_term.message,
            "semantic_search.technical_terms[1] must be a string"
        );

        let empty_explicit_path = execute_tool_payload(
            &executor,
            &input,
            TOOL_PROMPT_ENHANCER,
            json!({
                "prompt": "improve context",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "explicit_paths": ["src/main.rs", " "]
            }),
        )
        .expect_err("prompt_enhancer.explicit_paths must reject empty strings");
        assert_eq!(empty_explicit_path.error_class, "invalid_tool_arguments");
        assert_eq!(
            empty_explicit_path.message,
            "prompt_enhancer.explicit_paths[1] cannot be empty"
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn semantic_tools_reject_out_of_range_controls_without_clamping() {
        let workspace = make_temp_workspace("semantic-tool-control-validation");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
            context.enabled_tools = Some(vec![
                TOOL_SEMANTIC_SEARCH.to_string(),
                TOOL_PROMPT_ENHANCER.to_string(),
            ]);
            context.model_visible_tools = Some(vec![
                TOOL_SEMANTIC_SEARCH.to_string(),
                TOOL_PROMPT_ENHANCER.to_string(),
            ]);
        }
        let executor = LocalToolExecutor;

        let per_source_limit = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "per_source_limit": MAX_SEMANTIC_PER_SOURCE_LIMIT + 1
            }),
        )
        .expect_err("semantic_search.per_source_limit above max must fail");
        assert_eq!(per_source_limit.error_class, "invalid_tool_arguments");
        assert_eq!(
            per_source_limit.message,
            format!(
                "semantic_search.per_source_limit must be <= {MAX_SEMANTIC_PER_SOURCE_LIMIT}"
            )
        );

        let max_segments = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "max_segments": 0
            }),
        )
        .expect_err("semantic_search.max_segments zero must fail");
        assert_eq!(max_segments.error_class, "invalid_tool_arguments");
        assert_eq!(max_segments.message, "semantic_search.max_segments must be >= 1");

        let timeout_low = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget",
                "timeout_ms": MIN_SEMANTIC_TIMEOUT_MS - 1
            }),
        )
        .expect_err("semantic_search.timeout_ms below min must fail");
        assert_eq!(timeout_low.error_class, "invalid_tool_arguments");
        assert_eq!(
            timeout_low.message,
            format!("semantic_search.timeout_ms must be >= {MIN_SEMANTIC_TIMEOUT_MS}")
        );

        let timeout_high = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget",
                "timeout_ms": MAX_SEMANTIC_TIMEOUT_MS + 1
            }),
        )
        .expect_err("semantic_search.timeout_ms above max must fail");
        assert_eq!(timeout_high.error_class, "invalid_tool_arguments");
        assert_eq!(
            timeout_high.message,
            format!("semantic_search.timeout_ms must be <= {MAX_SEMANTIC_TIMEOUT_MS}")
        );

        let max_evidence = execute_tool_payload(
            &executor,
            &input,
            TOOL_PROMPT_ENHANCER,
            json!({
                "prompt": "improve context",
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS,
                "max_evidence": MAX_PROMPT_MAX_EVIDENCE + 1
            }),
        )
        .expect_err("prompt_enhancer.max_evidence above max must fail");
        assert_eq!(max_evidence.error_class, "invalid_tool_arguments");
        assert_eq!(
            max_evidence.message,
            format!("prompt_enhancer.max_evidence must be <= {MAX_PROMPT_MAX_EVIDENCE}")
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn semantic_tools_reject_invalid_refresh_and_timeout_env() {
        let workspace = make_temp_workspace("semantic-tool-env-validation");
        let mut input = make_read_only_input(&workspace);
        if let Some(context) = input.tool_context.as_mut() {
            context.tool_surface_profile = Some("full_debug".to_string());
            context.advanced_tool_schema = Some(true);
            context.enabled_tools = Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]);
            context.model_visible_tools = Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]);
        }
        let executor = LocalToolExecutor;

        let invalid_refresh = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget",
                "refresh": "sometimes"
            }),
        )
        .expect_err("semantic_search.refresh must reject unsupported values");
        assert_eq!(invalid_refresh.error_class, "invalid_tool_arguments");
        assert_eq!(
            invalid_refresh.message,
            "semantic_search.refresh must be one of auto, force, or skip"
        );

        let invalid_timeout_type = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget",
                "timeout_ms": "1000"
            }),
        )
        .expect_err("semantic_search.timeout_ms must reject strings");
        assert_eq!(invalid_timeout_type.error_class, "invalid_tool_arguments");
        assert_eq!(
            invalid_timeout_type.message,
            "semantic_search.timeout_ms must be an integer"
        );

        let env_lock = BROWSER_MCP_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock env validation test");
        env::set_var("GROBOT_CONTEXTWEAVER_TIMEOUT_MS", "not-a-number");
        let invalid_env = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget"
            }),
        )
        .expect_err("malformed contextweaver timeout env must fail closed");
        assert_eq!(invalid_env.error_class, "invalid_tool_arguments");
        assert_eq!(
            invalid_env.message,
            "GROBOT_CONTEXTWEAVER_TIMEOUT_MS must be an integer"
        );
        env::remove_var("GROBOT_CONTEXTWEAVER_TIMEOUT_MS");

        env::set_var(
            "GROBOT_CONTEXTWEAVER_TIMEOUT_MS",
            (MAX_SEMANTIC_TIMEOUT_MS + 1).to_string(),
        );
        let out_of_range_env = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget"
            }),
        )
        .expect_err("out-of-range contextweaver timeout env must fail closed");
        assert_eq!(out_of_range_env.error_class, "invalid_tool_arguments");
        assert_eq!(
            out_of_range_env.message,
            format!("GROBOT_CONTEXTWEAVER_TIMEOUT_MS must be <= {MAX_SEMANTIC_TIMEOUT_MS}")
        );
        env::remove_var("GROBOT_CONTEXTWEAVER_TIMEOUT_MS");

        env::set_var("GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT", "");
        let empty_bridge_script_env = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget"
            }),
        )
        .expect_err("empty contextweaver bridge script env must fail closed");
        assert_eq!(empty_bridge_script_env.error_class, "invalid_tool_arguments");
        assert_eq!(
            empty_bridge_script_env.message,
            "GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT must be a non-empty file path"
        );
        env::remove_var("GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT");

        let bridge_script = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("runtime crate should have repo parent")
            .join("adapters/contextweaver/bridge/cli.mjs");
        env::set_var("GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT", bridge_script);
        env::set_var("GROBOT_NODE_BIN", "");
        let empty_node_bin_env = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "context budget"
            }),
        )
        .expect_err("empty contextweaver node bin env must fail closed");
        assert_eq!(empty_node_bin_env.error_class, "invalid_tool_arguments");
        assert_eq!(
            empty_node_bin_env.message,
            "GROBOT_NODE_BIN must be a non-empty executable path"
        );
        env::remove_var("GROBOT_NODE_BIN");
        env::remove_var("GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT");
        drop(env_lock);

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn overlap_guard_lets_strict_parsers_reject_malformed_controls() {
        let workspace = make_temp_workspace("overlap-guard-malformed-controls");
        fs::write(workspace.join("notes.txt"), "alpha\n").expect("write notes");
        let executor = LocalToolExecutor;

        let input = make_search_semantic_input(&workspace, "malformed-semantic-controls");
        execute_tool_payload(
            &executor,
            &input,
            TOOL_SEARCH,
            json!({
                "query": "alpha"
            }),
        )
        .expect("first broad search should record overlap candidate");
        let semantic_error = execute_tool_payload(
            &executor,
            &input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "alpha",
                "include_org": "true"
            }),
        )
        .expect_err("malformed semantic arg should reach semantic parser");
        assert_eq!(semantic_error.error_class, "invalid_tool_arguments");
        assert_eq!(
            semantic_error.message,
            "semantic_search.include_org must be a boolean"
        );

        let search_input = make_search_semantic_input(&workspace, "malformed-search-controls");
        let _ = execute_tool_payload(
            &executor,
            &search_input,
            TOOL_SEMANTIC_SEARCH,
            json!({
                "query": "alpha",
                "include_org": true,
                "timeout_ms": DEFAULT_SEMANTIC_TIMEOUT_MS
            }),
        );
        let search_error = execute_tool_payload(
            &executor,
            &search_input,
            TOOL_SEARCH,
            json!({
                "query": "alpha",
                "regex": "false"
            }),
        )
        .expect_err("malformed search arg should reach search parser");
        assert_eq!(search_error.error_class, "invalid_tool_arguments");
        assert_eq!(search_error.message, "search.regex must be a boolean");

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
