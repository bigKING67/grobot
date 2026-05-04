    #[test]
    fn tool_surface_profiles_keep_intentional_tool_sets_and_schema_budgets() {
        assert_surface_tool_names(
            "minimal",
            &[TOOL_READ, TOOL_EDIT, TOOL_WRITE, TOOL_ASK_USER],
        );
        assert_surface_tool_names(
            "coding",
            &[
                TOOL_GLOB,
                TOOL_SEARCH,
                TOOL_READ,
                TOOL_WRITE,
                TOOL_EDIT,
                TOOL_BASH,
                TOOL_ASK_USER,
            ],
        );
        assert_surface_tool_names(
            "browser",
            &[
                TOOL_WEB_SCAN,
                TOOL_WEB_EXECUTE_JS,
                TOOL_READ,
                TOOL_ASK_USER,
            ],
        );
        assert_surface_tool_names(
            "browser_advanced",
            &[
                TOOL_WEB_SCAN,
                TOOL_WEB_EXECUTE_JS,
                TOOL_READ,
                TOOL_ASK_USER,
            ],
        );
        assert_surface_tool_names(
            "context",
            &[TOOL_SEMANTIC_SEARCH, TOOL_READ, TOOL_ASK_USER],
        );
        assert_surface_tool_names(
            "mcp",
            &[TOOL_MCP_SERVERS, TOOL_MCP_CALL, TOOL_ASK_USER],
        );

        let full_debug_expected = local_tool_catalog()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect::<StdHashSet<String>>();
        assert_eq!(surface_tool_names("full_debug"), full_debug_expected);

        assert_eq!(surface_schema_property_count("minimal", false), 9);
        assert_eq!(surface_schema_property_count("coding", false), 27);
        assert_eq!(surface_schema_property_count("browser", false), 16);
        assert_eq!(surface_schema_property_count("browser_advanced", false), 39);
        assert_eq!(surface_schema_property_count("browser", true), 39);
        assert_eq!(surface_schema_property_count("context", false), 10);
        assert_eq!(surface_schema_property_count("mcp", false), 5);
        assert_eq!(surface_schema_property_count("full_debug", false), 92);
    }

    #[test]
    fn tool_surface_schema_profiles_describe_projected_schema_budgets() {
        let profiles = tool_surface_schema_profiles();
        assert_eq!(profiles.len(), 7);

        let coding = surface_schema_profile("coding");
        assert_eq!(coding["policy_version"], TOOL_SURFACE_POLICY_VERSION);
        assert_eq!(coding["projection_mode"], "slim");
        assert_eq!(coding["advanced_tool_schema"], false);
        assert!(
            coding["schema_fingerprint"]
                .as_str()
                .is_some_and(|value| value.starts_with("schema:"))
        );
        assert_eq!(coding["visible_tool_count"].as_u64(), Some(7));
        assert_eq!(coding["schema_property_count"].as_u64(), Some(27));
        assert_eq!(coding["full_schema_property_count"].as_u64(), Some(30));
        assert_eq!(coding["suppressed_schema_property_count"].as_u64(), Some(3));
        assert_eq!(
            coding["per_tool_property_count"][TOOL_SEARCH].as_u64(),
            Some(8)
        );
        assert_eq!(
            coding["per_tool_property_count"][TOOL_READ].as_u64(),
            Some(7)
        );

        let browser = surface_schema_profile("browser");
        assert_eq!(browser["projection_mode"], "slim");
        assert_eq!(browser["advanced_tool_schema"], false);
        assert_eq!(browser["schema_property_count"].as_u64(), Some(16));
        assert_eq!(browser["full_schema_property_count"].as_u64(), Some(47));
        assert_eq!(browser["suppressed_schema_property_count"].as_u64(), Some(31));
        assert_eq!(
            browser["per_tool_property_count"][TOOL_READ].as_u64(),
            Some(4)
        );
        assert_eq!(
            browser["per_tool_visible_args"][TOOL_READ]
                .as_array()
                .expect("read visible args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec!["include_metadata", "limit", "offset", "path"]
        );
        assert_eq!(
            browser["per_tool_suppressed_args"][TOOL_READ]
                .as_array()
                .expect("read suppressed args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec!["line_end", "line_start", "pages"]
        );
        assert_eq!(
            browser["per_tool_property_count"][TOOL_WEB_SCAN].as_u64(),
            Some(5)
        );
        assert_eq!(
            browser["per_tool_visible_args"][TOOL_WEB_SCAN]
                .as_array()
                .expect("web_scan visible args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec![
                "main_only",
                "max_chars",
                "session_id",
                "switch_tab_id",
                "tabs_only",
            ]
        );
        assert_eq!(
            browser["per_tool_suppressed_args"][TOOL_WEB_EXECUTE_JS]
                .as_array()
                .expect("web_execute_js suppressed args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec![
                "cdp_endpoint",
                "native_auto_execute",
                "native_auto_fallback",
                "native_auto_fallback_policy",
                "native_execute_action_scope",
                "native_fallback_action",
                "native_fallback_args",
                "native_fallback_timeout_ms",
                "no_monitor",
                "session_url_pattern",
                "target_url_contains",
                "tmwd_link_endpoint",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
            ]
        );
        assert_eq!(
            browser["per_tool_property_count"][TOOL_WEB_EXECUTE_JS].as_u64(),
            Some(6)
        );

        let browser_advanced = surface_schema_profile("browser_advanced");
        assert_eq!(browser_advanced["projection_mode"], "advanced");
        assert_eq!(browser_advanced["advanced_tool_schema"], true);
        assert_eq!(browser_advanced["schema_property_count"].as_u64(), Some(39));
        assert_eq!(browser_advanced["full_schema_property_count"].as_u64(), Some(47));
        assert_eq!(
            browser_advanced["suppressed_schema_property_count"].as_u64(),
            Some(8)
        );
        assert_eq!(
            browser_advanced["per_tool_property_count"][TOOL_WEB_EXECUTE_JS].as_u64(),
            Some(16)
        );
        assert_eq!(
            browser_advanced["per_tool_suppressed_args"][TOOL_WEB_EXECUTE_JS]
                .as_array()
                .expect("advanced web_execute_js suppressed args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec![
                "native_auto_execute",
                "native_execute_action_scope",
                "native_fallback_action",
                "native_fallback_args",
                "no_monitor",
            ]
        );

        let context = surface_schema_profile("context");
        assert_eq!(context["projection_mode"], "slim");
        assert_eq!(context["schema_property_count"].as_u64(), Some(10));
        assert_eq!(context["full_schema_property_count"].as_u64(), Some(20));
        assert_eq!(context["suppressed_schema_property_count"].as_u64(), Some(10));
        assert_eq!(
            context["per_tool_property_count"][TOOL_SEMANTIC_SEARCH].as_u64(),
            Some(5)
        );
        assert_eq!(
            context["per_tool_visible_args"][TOOL_SEMANTIC_SEARCH]
                .as_array()
                .expect("semantic_search visible args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec![
                "include_org",
                "max_segments",
                "per_source_limit",
                "query",
                "sources",
            ]
        );
        assert_eq!(
            context["per_tool_suppressed_args"][TOOL_SEMANTIC_SEARCH]
                .as_array()
                .expect("semantic_search suppressed args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec!["bridge_script", "refresh", "technical_terms", "timeout_ms"]
        );

        let mcp = surface_schema_profile("mcp");
        assert_eq!(mcp["projection_mode"], "slim");
        assert_eq!(mcp["schema_property_count"].as_u64(), Some(5));
        assert_eq!(mcp["full_schema_property_count"].as_u64(), Some(9));
        assert_eq!(mcp["suppressed_schema_property_count"].as_u64(), Some(4));
        assert_eq!(
            mcp["per_tool_property_count"][TOOL_MCP_SERVERS].as_u64(),
            Some(1)
        );
        assert_eq!(
            mcp["per_tool_visible_args"][TOOL_MCP_SERVERS]
                .as_array()
                .expect("mcp_servers visible args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec!["ready_only"]
        );
        assert_eq!(
            mcp["per_tool_suppressed_args"][TOOL_MCP_SERVERS]
                .as_array()
                .expect("mcp_servers suppressed args")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec!["include_disabled"]
        );

        let full_debug = surface_schema_profile("full_debug");
        assert_eq!(full_debug["projection_mode"], "full");
        assert_eq!(full_debug["advanced_tool_schema"], true);
        assert!(
            full_debug["schema_fingerprint"]
                .as_str()
                .is_some_and(|value| value.starts_with("schema:"))
        );
        assert_eq!(full_debug["visible_tool_count"].as_u64(), Some(14));
        assert_eq!(full_debug["schema_property_count"].as_u64(), Some(92));
        assert_eq!(full_debug["full_schema_property_count"].as_u64(), Some(92));
        assert_eq!(full_debug["suppressed_schema_property_count"].as_u64(), Some(0));
    }
