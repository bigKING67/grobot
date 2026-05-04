    #[test]
    fn projected_object_schema_prunes_required_and_anyof_to_visible_properties() {
        let projected = project_object_schema_properties(
            &json!({
                "type": "object",
                "properties": {
                    "keep": { "type": "string" },
                    "alt": { "type": "string" },
                    "drop": { "type": "string" }
                },
                "required": ["keep", "drop"],
                "anyOf": [
                    { "required": ["drop"] },
                    { "required": ["alt"] }
                ],
                "additionalProperties": false
            }),
            &["keep", "alt"],
        );

        let props = schema_property_names(&projected);
        assert_schema_props_include(&props, &["keep", "alt"]);
        assert_schema_props_omit(&props, &["drop"]);
        assert_eq!(projected.get("required"), Some(&json!(["keep"])));

        let any_of = projected
            .get("anyOf")
            .and_then(Value::as_array)
            .expect("anyOf should keep branches with visible required properties");
        assert_eq!(any_of.len(), 1);
        assert_eq!(any_of[0].get("required"), Some(&json!(["alt"])));
    }

    #[test]
    fn browser_surface_projects_slim_browser_schema() {
        let scan_params = surface_parameters("browser", vec![TOOL_WEB_SCAN], TOOL_WEB_SCAN);
        let scan_props = schema_property_names(&scan_params);
        assert_schema_props_include(&scan_props, &["tabs_only", "main_only", "max_chars"]);
        assert_schema_props_omit(
            &scan_props,
            &[
                "main_only_fallback_to_full",
                "main_only_min_chars",
                "main_only_min_coverage",
                "session_url_pattern",
                "text_only",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
            ],
        );

        let exec_params =
            surface_parameters("browser", vec![TOOL_WEB_EXECUTE_JS], TOOL_WEB_EXECUTE_JS);
        let exec_props = schema_property_names(&exec_params);
        assert_schema_props_include(&exec_props, &["script", "code", "timeout_ms"]);
        assert_schema_props_omit(
            &exec_props,
            &[
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
                "session_url_pattern",
                "target_url_contains",
                "native_auto_fallback",
                "native_auto_fallback_policy",
                "native_auto_execute",
                "native_execute_action_scope",
                "native_fallback_action",
                "native_fallback_args",
                "native_fallback_timeout_ms",
            ],
        );
        assert_eq!(
            exec_params
                .get("anyOf")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn read_surface_projects_slim_schema_only_for_lightweight_profiles() {
        let minimal_params = surface_parameters("minimal", vec![TOOL_READ], TOOL_READ);
        let minimal_props = schema_property_names(&minimal_params);
        assert_schema_props_include(&minimal_props, &["path", "offset", "limit", "include_metadata"]);
        assert_schema_props_omit(&minimal_props, &["line_start", "line_end", "pages"]);

        let coding_params = surface_parameters("coding", vec![TOOL_READ], TOOL_READ);
        let coding_props = schema_property_names(&coding_params);
        assert_schema_props_include(
            &coding_props,
            &[
                "path",
                "offset",
                "limit",
                "include_metadata",
                "line_start",
                "line_end",
                "pages",
            ],
        );

        let advanced_params =
            surface_parameters("browser_advanced", vec![TOOL_READ], TOOL_READ);
        let advanced_props = schema_property_names(&advanced_params);
        assert_schema_props_include(&advanced_props, &["line_start", "line_end", "pages"]);
    }

    #[test]
    fn context_surface_projects_slim_semantic_search_schema() {
        let context_params =
            surface_parameters("context", vec![TOOL_SEMANTIC_SEARCH], TOOL_SEMANTIC_SEARCH);
        let context_props = schema_property_names(&context_params);
        assert_schema_props_include(
            &context_props,
            &[
                "query",
                "sources",
                "per_source_limit",
                "max_segments",
                "include_org",
            ],
        );
        assert_schema_props_omit(
            &context_props,
            &["technical_terms", "refresh", "timeout_ms", "bridge_script"],
        );

        let full_debug_params =
            surface_parameters("full_debug", vec![TOOL_SEMANTIC_SEARCH], TOOL_SEMANTIC_SEARCH);
        let full_debug_props = schema_property_names(&full_debug_params);
        assert_schema_props_include(
            &full_debug_props,
            &["technical_terms", "refresh", "timeout_ms", "bridge_script"],
        );
    }
