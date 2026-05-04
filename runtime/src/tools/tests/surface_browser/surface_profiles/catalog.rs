    #[test]
    fn local_tool_catalog_keeps_schema_defaults_and_dispatch_aligned() {
        let definitions = local_tool_definitions();
        let mut schema_names = StdHashSet::new();
        let mut schema_by_name = StdHashMap::new();
        for definition in definitions {
            let function = definition
                .get("function")
                .and_then(Value::as_object)
                .expect("tool definition must contain function object");
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .expect("tool definition function.name must be string");
            schema_names.insert(name.to_string());
            schema_by_name.insert(name.to_string(), function.clone());
        }

        let catalog_names: StdHashSet<String> = local_tool_catalog()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect();
        assert_eq!(schema_names, catalog_names);

        let default_enabled_names: StdHashSet<String> = default_enabled_local_tool_names()
            .into_iter()
            .map(ToString::to_string)
            .collect();
        assert!(default_enabled_names.is_subset(&catalog_names));
        assert!(default_enabled_names.contains(TOOL_GLOB));
        assert!(default_enabled_names.contains(TOOL_SEARCH));
        assert!(default_enabled_names.contains(TOOL_READ));
        assert!(default_enabled_names.contains(TOOL_WRITE));
        assert!(default_enabled_names.contains(TOOL_EDIT));
        assert!(default_enabled_names.contains(TOOL_BASH));
        assert!(default_enabled_names.contains(TOOL_ASK_USER));
        assert!(!default_enabled_names.contains(TOOL_LIST));
        assert!(!default_enabled_names.contains(TOOL_WEB_SCAN));
        assert!(!default_enabled_names.contains(TOOL_WEB_EXECUTE_JS));
        assert!(!default_enabled_names.contains(TOOL_MCP_CALL));
        assert!(!default_enabled_names.contains(TOOL_PROMPT_ENHANCER));

        let web_scan_schema = schema_by_name
            .get(TOOL_WEB_SCAN)
            .and_then(|function| function.get("parameters"))
            .and_then(Value::as_object)
            .expect("web_scan schema must expose parameters");
        assert_eq!(
            web_scan_schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("tmwd_mode"))
                .and_then(Value::as_object)
                .and_then(|schema| schema.get("default"))
                .and_then(Value::as_str),
            Some("tmwd"),
            "core browser facade must default to the user's current TMWD browser"
        );
        assert!(
            web_scan_schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("tmwd_mode"))
                .and_then(Value::as_object)
                .and_then(|schema| schema.get("enum"))
                .and_then(Value::as_array)
                .is_some_and(|values| values.iter().any(|value| value == "remote_cdp")),
            "core browser facade should expose remote_cdp alias for external debug Chrome"
        );

        let web_execute_js_schema = schema_by_name
            .get(TOOL_WEB_EXECUTE_JS)
            .and_then(|function| function.get("parameters"))
            .and_then(Value::as_object)
            .expect("web_execute_js schema must expose parameters");
        assert_eq!(
            web_execute_js_schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("tmwd_mode"))
                .and_then(Value::as_object)
                .and_then(|schema| schema.get("default"))
                .and_then(Value::as_str),
            Some("tmwd"),
            "core browser facade must default to the user's current TMWD browser"
        );
        assert_eq!(
            web_execute_js_schema
                .get("anyOf")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2),
            "web_execute_js must require script or code"
        );
        assert!(
            web_execute_js_schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("native_fallback_action"))
                .and_then(Value::as_object)
                .and_then(|schema| schema.get("enum"))
                .and_then(Value::as_array)
                .is_some_and(|values| values.iter().any(|value| value == "click")),
            "web_execute_js native fallback actions must match browser backend schema"
        );

        for tool_name in &catalog_names {
            assert!(
                is_local_tool_dispatch_supported(tool_name),
                "dispatcher missing handler for {}",
                tool_name
            );
        }
    }

    #[test]
    fn coding_surface_hides_browser_mcp_and_prompt_enhancer_tools() {
        let definitions = local_tool_definitions_for_surface(&Vec::new(), Some("coding"), false);
        let names = definitions
            .iter()
            .filter_map(|definition| {
                definition
                    .get("function")
                    .and_then(Value::as_object)
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<StdHashSet<String>>();
        assert_eq!(
            names,
            StdHashSet::from([
                TOOL_GLOB.to_string(),
                TOOL_SEARCH.to_string(),
                TOOL_READ.to_string(),
                TOOL_WRITE.to_string(),
                TOOL_EDIT.to_string(),
                TOOL_BASH.to_string(),
                TOOL_ASK_USER.to_string(),
            ])
        );
        assert!(!names.contains(TOOL_PROMPT_ENHANCER));
        assert!(!names.contains(TOOL_WEB_SCAN));
        assert!(!names.contains(TOOL_WEB_EXECUTE_JS));
    }
