    #[test]
    fn ask_user_surface_hides_internal_resume_fields_except_full_debug() {
        let coding_params = surface_parameters("coding", vec![TOOL_ASK_USER], TOOL_ASK_USER);
        let coding_props = schema_property_names(&coding_params);
        assert_schema_props_include(&coding_props, &["questions"]);
        assert_schema_props_omit(
            &coding_props,
            &["blocking_node_id", "default_on_timeout", "resume_token"],
        );

        let full_debug_params =
            surface_parameters("full_debug", vec![TOOL_ASK_USER], TOOL_ASK_USER);
        let full_debug_props = schema_property_names(&full_debug_params);
        assert_schema_props_include(
            &full_debug_props,
            &["blocking_node_id", "default_on_timeout", "resume_token"],
        );
    }

    #[test]
    fn mcp_servers_surface_hides_disabled_inventory_except_full_debug() {
        let mcp_params = surface_parameters("mcp", vec![TOOL_MCP_SERVERS], TOOL_MCP_SERVERS);
        let mcp_props = schema_property_names(&mcp_params);
        assert_schema_props_include(&mcp_props, &["ready_only"]);
        assert_schema_props_omit(&mcp_props, &["include_disabled"]);

        let full_debug_params =
            surface_parameters("full_debug", vec![TOOL_MCP_SERVERS], TOOL_MCP_SERVERS);
        let full_debug_props = schema_property_names(&full_debug_params);
        assert_schema_props_include(&full_debug_props, &["ready_only", "include_disabled"]);
    }

    #[test]
    fn mcp_servers_default_disabled_inventory_matches_surface_profile() {
        let mcp_context = ToolContextResolved {
            session_key: "mcp-test-session".to_string(),
            work_dir: env::temp_dir(),
            enabled_tools: HashSet::from([TOOL_MCP_SERVERS.to_string()]),
            model_visible_tools: HashSet::from([TOOL_MCP_SERVERS.to_string()]),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        assert!(!should_include_disabled_mcp_servers_by_default(&mcp_context));

        let full_debug_context = ToolContextResolved {
            tool_surface_profile: "full_debug".to_string(),
            advanced_tool_schema: true,
            ..mcp_context
        };
        assert!(should_include_disabled_mcp_servers_by_default(&full_debug_context));
    }

    #[test]
    fn browser_advanced_surface_exposes_debug_schema_without_full_native_actions() {
        let scan_params =
            surface_parameters("browser_advanced", vec![TOOL_WEB_SCAN], TOOL_WEB_SCAN);
        let scan_props = schema_property_names(&scan_params);
        assert_schema_props_include(
            &scan_props,
            &[
                "main_only_fallback_to_full",
                "main_only_min_chars",
                "main_only_min_coverage",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
            ],
        );

        let exec_params = surface_parameters(
            "browser_advanced",
            vec![TOOL_WEB_EXECUTE_JS],
            TOOL_WEB_EXECUTE_JS,
        );
        let exec_props = schema_property_names(&exec_params);
        assert_schema_props_include(
            &exec_props,
            &[
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
                "target_url_contains",
                "native_auto_fallback",
                "native_auto_fallback_policy",
                "native_fallback_timeout_ms",
            ],
        );
        assert_schema_props_omit(
            &exec_props,
            &[
                "native_auto_execute",
                "native_execute_action_scope",
                "native_fallback_action",
                "native_fallback_args",
            ],
        );
    }

    #[test]
    fn advanced_tool_schema_flag_promotes_browser_schema_without_full_native_actions() {
        let exec_params = surface_parameters_with_advanced(
            "browser",
            vec![TOOL_WEB_EXECUTE_JS],
            TOOL_WEB_EXECUTE_JS,
            true,
        );
        let exec_props = schema_property_names(&exec_params);
        assert_schema_props_include(
            &exec_props,
            &[
                "tmwd_mode",
                "target_url_contains",
                "native_auto_fallback",
                "native_auto_fallback_policy",
                "native_fallback_timeout_ms",
            ],
        );
        assert_schema_props_omit(
            &exec_props,
            &[
                "native_auto_execute",
                "native_execute_action_scope",
                "native_fallback_action",
                "native_fallback_args",
            ],
        );
    }
