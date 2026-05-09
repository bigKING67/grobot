    #[test]
    fn tool_recovery_policy_uses_precise_next_actions_and_recoverability() {
        let overlap = classify_tool_recovery("tool_overlap_blocked", "low_risk");
        assert_eq!(overlap.stage, "strategy_switch");
        assert_eq!(overlap.recommended_next_action, "use_suggested_distinct_tool");
        assert!(overlap.recoverable);

        let unsupported = classify_tool_recovery("tool_call_not_supported", "unknown");
        assert_eq!(unsupported.stage, "strategy_switch");
        assert_eq!(unsupported.recommended_next_action, "switch_tool_strategy");
        assert!(unsupported.recoverable);

        let stale_edit = classify_tool_recovery("edit_stale_target", "medium_risk");
        assert_eq!(stale_edit.stage, "local_fix");
        assert_eq!(stale_edit.recommended_next_action, "reread_target_then_retry");
        assert!(stale_edit.recoverable);

        let duplicate_edit = classify_tool_recovery("edit_match_not_unique", "medium_risk");
        assert_eq!(duplicate_edit.stage, "local_fix");
        assert_eq!(
            duplicate_edit.recommended_next_action,
            "narrow_edit_old_text_to_unique_match"
        );
        assert!(duplicate_edit.recoverable);

        let missing_edit = classify_tool_recovery("edit_not_found", "medium_risk");
        assert_eq!(missing_edit.stage, "local_fix");
        assert_eq!(
            missing_edit.recommended_next_action,
            "reread_target_then_retry_exact_old_text"
        );
        assert!(missing_edit.recoverable);

        let mixed_line_edit = classify_tool_recovery("edit_mixed_line_endings_not_supported", "medium_risk");
        assert_eq!(mixed_line_edit.stage, "strategy_switch");
        assert_eq!(
            mixed_line_edit.recommended_next_action,
            "use_write_or_normalize_line_endings"
        );
        assert!(mixed_line_edit.recoverable);

        let escaped_path = classify_tool_recovery("path_escape_blocked", "low_risk");
        assert_eq!(escaped_path.stage, "local_fix");
        assert_eq!(
            escaped_path.recommended_next_action,
            "choose_workspace_relative_path"
        );
        assert!(escaped_path.recoverable);

        let invalid_path = classify_tool_recovery("path_invalid", "low_risk");
        assert_eq!(invalid_path.stage, "local_fix");
        assert_eq!(
            invalid_path.recommended_next_action,
            "choose_regular_file_path"
        );
        assert!(invalid_path.recoverable);

        let schema_drift = classify_tool_recovery("tool_argument_not_visible", "low_risk");
        assert_eq!(schema_drift.stage, "strategy_switch");
        assert_eq!(
            schema_drift.recommended_next_action,
            "inspect_visible_tool_schema_then_retry"
        );
        assert!(schema_drift.recoverable);

        let mcp_tool_result = classify_tool_recovery("mcp_tool_result_error", "high_risk");
        assert_eq!(mcp_tool_result.stage, "strategy_switch");
        assert_eq!(
            mcp_tool_result.recommended_next_action,
            "inspect_mcp_tool_result_and_change_arguments"
        );
        assert!(mcp_tool_result.recoverable);

        let mcp_blocked = classify_tool_recovery("mcp_tool_blocked", "high_risk");
        assert_eq!(mcp_blocked.stage, "strategy_switch");
        assert_eq!(
            mcp_blocked.recommended_next_action,
            "use_allowed_mcp_tool_or_request_policy_change"
        );
        assert!(mcp_blocked.recoverable);

        let mcp_arguments_too_large =
            classify_tool_recovery("mcp_arguments_too_large", "high_risk");
        assert_eq!(mcp_arguments_too_large.stage, "local_fix");
        assert_eq!(
            mcp_arguments_too_large.recommended_next_action,
            "reduce_mcp_argument_payload"
        );
        assert!(mcp_arguments_too_large.recoverable);

        let mcp_rpc_error = classify_tool_recovery("mcp_rpc_error", "high_risk");
        assert_eq!(mcp_rpc_error.stage, "strategy_switch");
        assert_eq!(
            mcp_rpc_error.recommended_next_action,
            "inspect_mcp_rpc_error_and_switch_strategy"
        );
        assert!(mcp_rpc_error.recoverable);

        let browser_backend =
            classify_tool_recovery("browser_backend_result_error", "medium_risk");
        assert_eq!(browser_backend.stage, "strategy_switch");
        assert_eq!(
            browser_backend.recommended_next_action,
            "inspect_error_and_switch_strategy"
        );
        assert!(browser_backend.recoverable);

        let semantic_index = classify_tool_recovery("semantic_index_config_invalid", "medium_risk");
        assert_eq!(semantic_index.stage, "strategy_switch");
        assert_eq!(
            semantic_index.recommended_next_action,
            "use_search_or_glob_fallback"
        );
        assert!(semantic_index.recoverable);

        let mcp_server_unready = classify_tool_recovery("mcp_server_unready", "unknown");
        assert_eq!(mcp_server_unready.stage, "ask_user");
        assert_eq!(
            mcp_server_unready.recommended_next_action,
            "request_environment_fix"
        );
        assert!(!mcp_server_unready.recoverable);

        let tool_context_missing = classify_tool_recovery("tool_context_missing", "unknown");
        assert_eq!(tool_context_missing.stage, "ask_user");
        assert_eq!(
            tool_context_missing.recommended_next_action,
            "request_environment_fix"
        );
        assert!(!tool_context_missing.recoverable);

        let missing_config = classify_tool_recovery("config_missing", "unknown");
        assert_eq!(missing_config.stage, "ask_user");
        assert_eq!(
            missing_config.recommended_next_action,
            "ask_user_for_config_or_switch_provider"
        );
        assert!(!missing_config.recoverable);

        let unknown_risk = classify_tool_recovery("mystery_error", "unknown");
        assert_eq!(unknown_risk.stage, "strategy_switch");
        assert_eq!(unknown_risk.recommended_next_action, "avoid_unknown_tool");
        assert!(unknown_risk.recoverable);

        let fallback = classify_tool_recovery("mystery_error", "medium_risk");
        assert_eq!(fallback.stage, "strategy_switch");
        assert_eq!(
            fallback.recommended_next_action,
            "inspect_error_and_switch_strategy"
        );
        assert!(fallback.recoverable);
    }

    #[test]
    fn tool_recovery_catalog_describes_runtime_policy_contract() {
        let catalog = tool_recovery_catalog();
        assert_eq!(tool_recovery_policy_version(), "v1");
        assert!(!catalog.is_empty());

        let actions = tool_recovery_action_names();
        assert!(actions.contains(&"ask_user_for_config_or_switch_provider"));
        assert!(actions.contains(&"choose_regular_file_path"));
        assert!(actions.contains(&"choose_workspace_relative_path"));
        assert!(actions.contains(&"narrow_edit_old_text_to_unique_match"));
        assert!(actions.contains(&"reread_target_then_retry_exact_old_text"));
        assert!(actions.contains(&"use_write_or_normalize_line_endings"));
        assert!(actions.contains(&"inspect_error_and_switch_strategy"));
        assert!(actions.contains(&"inspect_mcp_tool_result_and_change_arguments"));
        assert!(actions.contains(&"inspect_mcp_rpc_error_and_switch_strategy"));
        assert!(actions.contains(&"reduce_mcp_argument_payload"));
        assert!(actions.contains(&"use_allowed_mcp_tool_or_request_policy_change"));
        assert!(!actions.contains(&"observe_and_continue"));

        let fingerprint = tool_recovery_catalog_fingerprint(&catalog);
        assert!(fingerprint.starts_with("recovery_catalog:"));

        let config_missing = catalog
            .iter()
            .find(|row| {
                row["recommended_next_action"]
                    .as_str()
                    .is_some_and(|value| value == "ask_user_for_config_or_switch_provider")
            })
            .expect("config_missing recovery row should exist");
        assert_eq!(config_missing["stage"].as_str(), Some("ask_user"));
        assert_eq!(config_missing["recoverable"].as_bool(), Some(false));
        assert_eq!(
            config_missing["error_classes"]
                .as_array()
                .expect("error_classes array")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<&str>>(),
            vec!["config_missing", "config_invalid"]
        );

        let environment_fix = catalog
            .iter()
            .find(|row| {
                row["recommended_next_action"]
                    .as_str()
                    .is_some_and(|value| value == "request_environment_fix")
                    && row["stage"].as_str() == Some("ask_user")
            })
            .expect("environment fix recovery row should exist");
        let environment_error_classes = environment_fix["error_classes"]
            .as_array()
            .expect("error_classes array")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<&str>>();
        assert!(environment_error_classes.contains(&"tool_context_missing"));

        let unknown_risk = catalog
            .iter()
            .find(|row| {
                row["risk_class"].as_str() == Some("unknown")
                    && row["recommended_next_action"].as_str()
                        == Some("avoid_unknown_tool")
            })
            .expect("unknown risk recovery row should exist");
        assert_eq!(unknown_risk["recoverable"].as_bool(), Some(true));
    }
