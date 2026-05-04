    #[test]
    fn browser_facade_rejects_hidden_args_at_execution_boundary() {
        let slim_context = browser_test_context("browser", false);
        let slim_args = json_object_args(json!({
            "script": "return document.title",
            "tmwd_mode": "remote_cdp"
        }));
        let error =
            validate_browser_facade_args_visible(&slim_context, &slim_args, TOOL_WEB_EXECUTE_JS)
                .expect_err("slim browser surface should reject hidden transport args");
        assert_eq!(error.error_class, "tool_argument_not_visible");
        assert!(error.message.contains("tmwd_mode"));
        assert!(error.message.contains("profile=browser"));
        let data = error
            .data
            .as_ref()
            .expect("hidden browser args should include structured data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("tool_argument_not_visible")
        );
        assert_eq!(data["tool"].as_str(), Some(TOOL_WEB_EXECUTE_JS));
        assert_eq!(data["backend"].as_str(), Some("browser-structured"));
        assert_eq!(
            data["operation"].as_str(),
            Some("validate_browser_facade_args_visible")
        );
        assert_eq!(data["tool_surface_profile"].as_str(), Some("browser"));
        assert_eq!(data["advanced_tool_schema"].as_bool(), Some(false));
        assert_eq!(
            data["recovery_stage"].as_str(),
            Some(TOOL_RECOVERY_STAGE_STRATEGY_SWITCH)
        );
        assert_eq!(
            data["recommended_next_action"].as_str(),
            Some(TOOL_RECOVERY_ACTION_INSPECT_VISIBLE_TOOL_SCHEMA_THEN_RETRY)
        );
        assert_eq!(data["recoverable"].as_bool(), Some(true));
        assert_eq!(
            data["recovery_policy_version"].as_str(),
            Some(tool_recovery_policy_version())
        );
        assert!(data["hidden_args"]
            .as_array()
            .expect("hidden_args should be an array")
            .iter()
            .any(|value| value.as_str() == Some("tmwd_mode")));

        let slim_scan_args = json_object_args(json!({
            "tabs_only": true,
            "text_only": true,
            "session_url_pattern": "example.com"
        }));
        let error =
            validate_browser_facade_args_visible(&slim_context, &slim_scan_args, TOOL_WEB_SCAN)
                .expect_err("slim browser surface should reject advanced scan selection args");
        let hidden_args = error
            .data
            .as_ref()
            .and_then(|data| data.get("hidden_args"))
            .and_then(Value::as_array)
            .expect("hidden_args should be an array");
        assert!(hidden_args.iter().any(|value| value.as_str() == Some("text_only")));
        assert!(hidden_args
            .iter()
            .any(|value| value.as_str() == Some("session_url_pattern")));

        let advanced_context = browser_test_context("browser_advanced", false);
        let advanced_args = json_object_args(json!({
            "script": "return document.title",
            "native_fallback_action": "click",
            "native_fallback_args": { "x": 1, "y": 2 }
        }));
        let error = validate_browser_facade_args_visible(
            &advanced_context,
            &advanced_args,
            TOOL_WEB_EXECUTE_JS,
        )
        .expect_err("browser_advanced should reject explicit native action args");
        assert_eq!(error.error_class, "tool_argument_not_visible");
        assert!(error.message.contains("native_fallback_action"));
        assert!(error.message.contains("native_fallback_args"));

        let auto_fallback_args = json_object_args(json!({
            "script": "return document.title",
            "tmwd_mode": "tmwd",
            "native_auto_fallback": true,
            "native_auto_fallback_policy": "balanced",
            "native_fallback_timeout_ms": 1000
        }));
        validate_browser_facade_args_visible(
            &advanced_context,
            &auto_fallback_args,
            TOOL_WEB_EXECUTE_JS,
        )
        .expect("browser_advanced should allow bounded auto fallback tuning");

        let full_debug_context = browser_test_context("full_debug", false);
        validate_browser_facade_args_visible(
            &full_debug_context,
            &advanced_args,
            TOOL_WEB_EXECUTE_JS,
        )
        .expect("full_debug should allow explicit native browser actions");
    }

    #[test]
    fn web_execute_js_dispatch_blocks_hidden_native_args_before_mcp_backend() {
        let workspace = make_temp_workspace("browser-native-gate");
        let input = make_browser_input(&workspace, "browser_advanced", false);
        let call = ToolCallInput {
            id: "browser-native-gate-1".to_string(),
            name: TOOL_WEB_EXECUTE_JS.to_string(),
            arguments: json!({
                "script": "return document.title",
                "native_fallback_action": "click",
                "native_fallback_args": { "x": 1, "y": 2 }
            }),
        };
        let executor = LocalToolExecutor;
        let error = executor
            .execute_tool_call(&call, &input)
            .expect_err("hidden native action args should be blocked before MCP dispatch");
        assert_eq!(error.error_class, "tool_argument_not_visible");
        assert!(error.message.contains("native_fallback_action"));
        assert!(!error.message.contains("browser-structured"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn full_debug_surface_exposes_full_native_browser_schema() {
        let scan_params = surface_parameters("full_debug", vec![TOOL_WEB_SCAN], TOOL_WEB_SCAN);
        let scan_props = schema_property_names(&scan_params);
        assert_schema_props_include(
            &scan_props,
            &[
                "main_only_fallback_to_full",
                "main_only_min_chars",
                "main_only_min_coverage",
                "tmwd_mode",
                "cdp_endpoint",
            ],
        );

        let exec_params =
            surface_parameters("full_debug", vec![TOOL_WEB_EXECUTE_JS], TOOL_WEB_EXECUTE_JS);
        let exec_props = schema_property_names(&exec_params);
        assert_schema_props_include(
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
    fn browser_facade_defaults_to_tmwd_without_overriding_explicit_mode() {
        let args = Map::new();
        let (defaulted, applied) = browser_facade_args_with_current_browser_default(&args);
        assert!(applied);
        assert_eq!(
            defaulted.get("tmwd_mode").and_then(Value::as_str),
            Some("tmwd")
        );

        let mut explicit = Map::new();
        explicit.insert(
            "tmwd_mode".to_string(),
            Value::String("remote_cdp".to_string()),
        );
        let (kept, applied) = browser_facade_args_with_current_browser_default(&explicit);
        assert!(!applied);
        assert_eq!(
            kept.get("tmwd_mode").and_then(Value::as_str),
            Some("remote_cdp")
        );

        let mut legacy = Map::new();
        legacy.insert("tmwd_mode".to_string(), Value::String("cdp".to_string()));
        let (kept, applied) = browser_facade_args_with_current_browser_default(&legacy);
        assert!(!applied);
        assert_eq!(kept.get("tmwd_mode").and_then(Value::as_str), Some("cdp"));
    }

    #[test]
    fn browser_backend_result_error_reports_structured_data() {
        let context = browser_test_context("browser", false);
        let backend_payload = json!({
            "status": "error",
            "error_code": "NO_EXTENSION",
            "retryable": true,
            "transport_attempts": [
                {
                    "transport": "tmwd_ws",
                    "status": "failed"
                }
            ]
        });
        let error = browser_backend_result_error(
            &context,
            TOOL_WEB_SCAN,
            "browser_scan",
            &backend_payload,
            false,
            true,
        );
        assert_eq!(error.error_class, "browser_backend_result_error");
        let data = error
            .data
            .as_ref()
            .expect("browser backend result error should include structured data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("browser_backend_result_error")
        );
        assert_eq!(data["tool"].as_str(), Some(TOOL_WEB_SCAN));
        assert_eq!(data["backend"].as_str(), Some("browser-structured"));
        assert_eq!(data["mapped_tool"].as_str(), Some("browser_scan"));
        assert_eq!(data["operation"].as_str(), Some("backend_result"));
        assert_eq!(data["error_code"].as_str(), Some("NO_EXTENSION"));
        assert_eq!(data["retryable"].as_bool(), Some(true));
        assert_eq!(data["transport_attempts_count"].as_u64(), Some(1));
        assert_eq!(data["browser_context_kind"].as_str(), Some("unknown"));
        assert!(data["diagnostic_hint"]
            .as_str()
            .expect("diagnostic hint should be present")
            .contains("Browser extension"));
        assert_eq!(
            data["facade_default_tmwd_mode_applied"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn web_scan_reports_browser_backend_error_as_observed_error_from_mcp() {
        let _browser_mcp_guard = BROWSER_MCP_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock browser MCP fixture");
        let root = make_temp_workspace("browser-backend-error-flow");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        let backend_payload = json!({
            "status": "error",
            "error_code": "NO_EXTENSION",
            "retryable": true,
            "transport_attempts": [
                {
                    "transport": "tmwd_ws",
                    "status": "failed",
                    "error_code": "NO_EXTENSION"
                }
            ]
        });
        write_fake_browser_mcp_registry(&grobot_dir, &backend_payload, false, false);

        clear_mcp_runtime_state("browser-structured");
        let mut context = browser_test_context("browser", false);
        context.work_dir = workspace.clone();
        let output = run_web_scan(&context, &Map::new())
            .expect("browser backend status=error should stay observable");
        let payload: Value =
            serde_json::from_str(&output.content).expect("web_scan output should be json");
        assert_eq!(payload["tool"].as_str(), Some(TOOL_WEB_SCAN));
        assert_eq!(payload["status"].as_str(), Some("error"));
        assert_eq!(payload["backend"].as_str(), Some("browser-structured"));
        assert_eq!(payload["mapped_tool"].as_str(), Some("browser_scan"));
        assert_eq!(payload["error_code"].as_str(), Some("NO_EXTENSION"));
        assert_eq!(
            payload["facade_default_tmwd_mode_applied"].as_bool(),
            Some(true)
        );

        let observed = output
            .observed_error
            .as_ref()
            .expect("browser backend result error should be observed by the model");
        assert_eq!(observed.error_class, "browser_backend_result_error");
        let data = observed
            .data
            .as_ref()
            .expect("observed browser error should include structured data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("browser_backend_result_error")
        );
        assert_eq!(data["tool"].as_str(), Some(TOOL_WEB_SCAN));
        assert_eq!(data["mapped_tool"].as_str(), Some("browser_scan"));
        assert_eq!(data["error_code"].as_str(), Some("NO_EXTENSION"));
        assert_eq!(data["retryable"].as_bool(), Some(true));
        assert_eq!(data["transport_attempts_count"].as_u64(), Some(1));
        assert!(data["diagnostic_hint"]
            .as_str()
            .expect("diagnostic hint should be present")
            .contains("Browser extension"));

        clear_mcp_runtime_state("browser-structured");
        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn web_execute_js_reports_mcp_is_error_as_observed_browser_error() {
        let _browser_mcp_guard = BROWSER_MCP_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock browser MCP fixture");
        let root = make_temp_workspace("browser-mcp-is-error-flow");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        let backend_payload = json!({
            "status": "ok",
            "transport": "tmwd_ws",
            "title": "fixture"
        });
        write_fake_browser_mcp_registry(&grobot_dir, &backend_payload, true, false);

        clear_mcp_runtime_state("browser-structured");
        let mut context = browser_test_context("browser", false);
        context.work_dir = workspace.clone();
        let output = run_web_execute_js(
            &context,
            &json_object_args(json!({ "script": "return document.title" })),
        )
        .expect("browser MCP isError=true should stay observable");
        let payload: Value =
            serde_json::from_str(&output.content).expect("web_execute_js output should be json");
        assert_eq!(payload["tool"].as_str(), Some(TOOL_WEB_EXECUTE_JS));
        assert_eq!(payload["status"].as_str(), Some("error"));
        assert_eq!(payload["mapped_tool"].as_str(), Some("browser_execute_js"));
        assert_eq!(
            payload["browser_context_kind"].as_str(),
            Some("tmwd_user_browser")
        );

        let observed = output
            .observed_error
            .as_ref()
            .expect("MCP isError=true should produce an observed browser error");
        assert_eq!(observed.error_class, "browser_backend_result_error");
        let data = observed
            .data
            .as_ref()
            .expect("observed browser MCP error should include structured data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("browser_backend_result_error")
        );
        assert_eq!(data["tool"].as_str(), Some(TOOL_WEB_EXECUTE_JS));
        assert_eq!(data["mapped_tool"].as_str(), Some("browser_execute_js"));
        assert_eq!(data["is_error"].as_bool(), Some(true));
        assert_eq!(
            data["browser_context_kind"].as_str(),
            Some("tmwd_user_browser")
        );
        assert!(data["diagnostic_hint"]
            .as_str()
            .expect("diagnostic hint should be present")
            .contains("MCP tool error"));

        clear_mcp_runtime_state("browser-structured");
        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn browser_context_kind_makes_remote_cdp_explicit() {
        assert_eq!(
            browser_context_kind_from_transport(&json!({ "transport": "tmwd_ws" })),
            "tmwd_user_browser"
        );
        assert_eq!(
            browser_context_kind_from_transport(&json!({ "transport": "tmwd_link" })),
            "tmwd_user_browser"
        );
        assert_eq!(
            browser_context_kind_from_transport(&json!({ "transport": "cdp" })),
            "remote_cdp_debug_browser"
        );
        assert_eq!(
            browser_context_kind_from_transport(&json!({ "transport": null })),
            "unknown"
        );
    }
