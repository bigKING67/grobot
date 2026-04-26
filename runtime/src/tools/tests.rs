#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::engine::{
        RuntimeKimiOptionsInput, RuntimeModelConfigInput, RuntimeProviderOptionsInput,
        RuntimeToolContextInput, TurnExecuteInput,
    };
    use serde_json::Value;
    use std::collections::HashMap as StdHashMap;
    use std::collections::HashSet as StdHashSet;
    use std::fs;
    use std::process;
    use std::sync::Arc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn make_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("grobot-tools-{prefix}-{}-{nonce}", process::id()));
        fs::create_dir_all(&root).expect("create temp workspace root");
        root
    }

    fn make_read_only_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_read_edit_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-edit-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read and edit".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string(), "edit".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_read_write_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-write-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read and write".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string(), "write".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_read_write_edit_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-write-edit-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read, write and edit".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string(), "write".to_string(), "edit".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_bash_input(workspace: &PathBuf, bash_allowlist: Vec<String>) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-bash-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run bash".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["bash".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: Some(bash_allowlist),
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_fs_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-fs-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run list/glob/search".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![
                    "list".to_string(),
                    "glob".to_string(),
                    "search".to_string(),
                ]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_search_semantic_input(workspace: &PathBuf, request_suffix: &str) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: format!("req-search-semantic-{request_suffix}"),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run search and semantic_search".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["search".to_string(), "semantic_search".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("context".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_browser_input(
        workspace: &PathBuf,
        profile: &str,
        advanced_tool_schema: bool,
    ) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: format!("req-browser-{profile}"),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run browser tool".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![TOOL_WEB_EXECUTE_JS.to_string()]),
                model_visible_tools: Some(vec![TOOL_WEB_EXECUTE_JS.to_string()]),
                tool_surface_profile: Some(profile.to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(advanced_tool_schema),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn execute_tool_payload(
        executor: &LocalToolExecutor,
        input: &TurnExecuteInput,
        name: &str,
        arguments: Value,
    ) -> Result<Value, ToolExecutionError> {
        let call = ToolCallInput {
            id: format!("tool-{name}"),
            name: name.to_string(),
            arguments,
        };
        let output = executor.execute_tool_call(&call, input)?;
        serde_json::from_str(&output.content).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to decode tool output json: {error}"),
            )
        })
    }

    fn surface_parameters(profile: &str, tools: Vec<&str>, tool_name: &str) -> Value {
        surface_parameters_with_advanced(profile, tools, tool_name, false)
    }

    fn surface_definitions(profile: &str, advanced_tool_schema: bool) -> Vec<Value> {
        local_tool_definitions_for_surface(&Vec::new(), Some(profile), advanced_tool_schema)
    }

    fn surface_parameters_with_advanced(
        profile: &str,
        tools: Vec<&str>,
        tool_name: &str,
        advanced_tool_schema: bool,
    ) -> Value {
        let visible_tools = tools.into_iter().map(str::to_string).collect::<Vec<String>>();
        let definitions =
            local_tool_definitions_for_surface(&visible_tools, Some(profile), advanced_tool_schema);
        definitions
            .into_iter()
            .find_map(|definition| {
                let function = definition.get("function")?.as_object()?;
                if function.get("name").and_then(Value::as_str) != Some(tool_name) {
                    return None;
                }
                function.get("parameters").cloned()
            })
            .unwrap_or_else(|| panic!("missing projected tool schema for {tool_name}"))
    }

    fn surface_tool_names(profile: &str) -> StdHashSet<String> {
        surface_definitions(profile, false)
            .iter()
            .filter_map(|definition| {
                definition
                    .get("function")
                    .and_then(Value::as_object)
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect()
    }

    fn surface_schema_property_count(profile: &str, advanced_tool_schema: bool) -> usize {
        surface_definitions(profile, advanced_tool_schema)
            .iter()
            .map(|definition| {
                definition
                    .get("function")
                    .and_then(Value::as_object)
                    .and_then(|function| function.get("parameters"))
                    .and_then(|parameters| parameters.get("properties"))
                    .and_then(Value::as_object)
                    .map_or(0, |properties| properties.len())
            })
            .sum()
    }

    fn surface_schema_profile(profile: &str) -> Value {
        tool_surface_schema_profiles()
            .into_iter()
            .find(|row| row.get("profile").and_then(Value::as_str) == Some(profile))
            .unwrap_or_else(|| panic!("missing schema profile metadata for {profile}"))
    }

    fn schema_property_names(parameters: &Value) -> StdHashSet<String> {
        parameters
            .get("properties")
            .and_then(Value::as_object)
            .map(|properties| properties.keys().cloned().collect::<StdHashSet<String>>())
            .unwrap_or_default()
    }

    fn assert_schema_props_include(props: &StdHashSet<String>, names: &[&str]) {
        for name in names {
            assert!(props.contains(*name), "projected schema should expose {name}");
        }
    }

    fn assert_schema_props_omit(props: &StdHashSet<String>, names: &[&str]) {
        for name in names {
            assert!(!props.contains(*name), "projected schema should hide {name}");
        }
    }

    fn assert_surface_tool_names(profile: &str, names: &[&str]) {
        let actual = surface_tool_names(profile);
        let expected = names
            .iter()
            .map(|name| name.to_string())
            .collect::<StdHashSet<String>>();
        assert_eq!(actual, expected, "{profile} surface tool set drifted");
    }

    fn browser_test_context(profile: &str, advanced_tool_schema: bool) -> ToolContextResolved {
        let visible_tools = HashSet::from([
            TOOL_WEB_SCAN.to_string(),
            TOOL_WEB_EXECUTE_JS.to_string(),
        ]);
        ToolContextResolved {
            session_key: "browser-test-session".to_string(),
            work_dir: env::temp_dir(),
            enabled_tools: visible_tools.clone(),
            model_visible_tools: visible_tools,
            tool_surface_profile: profile.to_string(),
            advanced_tool_schema,
            bash_allowlist: Vec::new(),
        }
    }

    fn json_object_args(value: Value) -> Map<String, Value> {
        value.as_object().expect("test args must be object").clone()
    }

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

        assert_eq!(surface_schema_property_count("minimal", false), 15);
        assert_eq!(surface_schema_property_count("coding", false), 30);
        assert_eq!(surface_schema_property_count("browser", false), 25);
        assert_eq!(surface_schema_property_count("browser_advanced", false), 42);
        assert_eq!(surface_schema_property_count("browser", true), 42);
        assert_eq!(surface_schema_property_count("context", false), 20);
        assert_eq!(surface_schema_property_count("mcp", false), 9);
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
        assert_eq!(coding["schema_property_count"].as_u64(), Some(30));
        assert_eq!(coding["full_schema_property_count"].as_u64(), Some(30));
        assert_eq!(coding["suppressed_schema_property_count"].as_u64(), Some(0));
        assert_eq!(
            coding["per_tool_property_count"][TOOL_SEARCH].as_u64(),
            Some(8)
        );

        let browser = surface_schema_profile("browser");
        assert_eq!(browser["projection_mode"], "slim");
        assert_eq!(browser["advanced_tool_schema"], false);
        assert_eq!(browser["schema_property_count"].as_u64(), Some(25));
        assert_eq!(browser["full_schema_property_count"].as_u64(), Some(47));
        assert_eq!(browser["suppressed_schema_property_count"].as_u64(), Some(22));
        assert_eq!(
            browser["per_tool_property_count"][TOOL_WEB_SCAN].as_u64(),
            Some(7)
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
                "session_url_pattern",
                "switch_tab_id",
                "tabs_only",
                "text_only",
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
                "target_url_contains",
                "tmwd_link_endpoint",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
            ]
        );
        assert_eq!(
            browser["per_tool_property_count"][TOOL_WEB_EXECUTE_JS].as_u64(),
            Some(7)
        );

        let browser_advanced = surface_schema_profile("browser_advanced");
        assert_eq!(browser_advanced["projection_mode"], "advanced");
        assert_eq!(browser_advanced["advanced_tool_schema"], true);
        assert_eq!(browser_advanced["schema_property_count"].as_u64(), Some(42));
        assert_eq!(browser_advanced["full_schema_property_count"].as_u64(), Some(47));
        assert_eq!(
            browser_advanced["suppressed_schema_property_count"].as_u64(),
            Some(5)
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

    #[test]
    fn load_mcp_call_policy_clamps_fields() {
        let root = make_temp_workspace("policy");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        let project_toml = grobot_dir.join("project.toml");
        fs::write(
            &project_toml,
            r#"
[tools.mcp]
max_concurrency_per_server = 999
max_queue_per_server = 999999
failure_threshold = 0
cooldown_secs = 999999
latency_sample_limit = 1
call_timeout_ms = 1
session_idle_ttl_secs = 1
allow_tools = ["echo"]
"#,
        )
        .expect("write project policy");

        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace,
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let policy = load_mcp_call_policy(&context);
        assert_eq!(
            policy.max_concurrency_per_server,
            MAX_MCP_MAX_CONCURRENCY_PER_SERVER
        );
        assert_eq!(policy.max_queue_per_server, MAX_MCP_MAX_QUEUE_PER_SERVER);
        assert_eq!(policy.failure_threshold, MIN_MCP_FAILURE_THRESHOLD);
        assert_eq!(policy.cooldown_secs, MAX_MCP_COOLDOWN_SECS);
        assert_eq!(policy.latency_sample_limit, MIN_MCP_LATENCY_SAMPLE_LIMIT);
        assert_eq!(policy.call_timeout_ms, MIN_MCP_CALL_TIMEOUT_MS);
        assert_eq!(policy.session_idle_ttl_secs, MIN_MCP_SESSION_IDLE_TTL_SECS);
        assert_eq!(policy.allow_tools, vec!["echo".to_string()]);

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn load_bash_runtime_policy_clamps_fields() {
        let root = make_temp_workspace("bash-policy");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        let project_toml = grobot_dir.join("project.toml");
        fs::write(
            &project_toml,
            r#"
[tools.bash]
output_ttl_secs = 999999999
output_max_files = 1
audit_preview_chars = 1
audit_segment_chars = 90000
audit_redact_secrets = false
"#,
        )
        .expect("write bash policy");

        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace,
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let policy = load_bash_runtime_policy(&context);
        assert_eq!(policy.output_ttl_secs, MAX_BASH_OUTPUT_TTL_SECS);
        assert_eq!(policy.output_max_files, MIN_BASH_OUTPUT_MAX_FILES);
        assert_eq!(policy.audit_preview_chars, MIN_BASH_AUDIT_PREVIEW_CHARS);
        assert_eq!(policy.audit_segment_chars, MAX_BASH_AUDIT_SEGMENT_CHARS);
        assert!(!policy.audit_redact_secrets);

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn parse_rg_json_event_supports_match_and_context() {
        let match_line = r#"{"type":"match","data":{"path":{"text":"src/main.rs"},"lines":{"text":"fn main() {\n"},"line_number":12}}"#;
        let context_line = r#"{"type":"context","data":{"path":{"text":"src/main.rs"},"lines":{"text":"use std::env;\n"},"line_number":10}}"#;
        let parsed_match = parse_rg_json_event(match_line).expect("parse match event");
        assert_eq!(parsed_match.0, "src/main.rs");
        assert_eq!(parsed_match.1, 12);
        assert_eq!(parsed_match.2, "fn main() {");
        assert!(parsed_match.3);

        let parsed_context = parse_rg_json_event(context_line).expect("parse context event");
        assert_eq!(parsed_context.0, "src/main.rs");
        assert_eq!(parsed_context.1, 10);
        assert_eq!(parsed_context.2, "use std::env;");
        assert!(!parsed_context.3);
    }

    #[test]
    fn build_context_records_from_rg_index_marks_match_line() {
        let mut line_index: HashMap<usize, String> = HashMap::new();
        line_index.insert(8, "line8".to_string());
        line_index.insert(9, "line9".to_string());
        line_index.insert(10, "line10".to_string());
        line_index.insert(11, "line11".to_string());
        line_index.insert(12, "line12".to_string());

        let records = build_context_records_from_rg_index(&line_index, 10, 1, 2);
        assert_eq!(records.len(), 4);
        assert_eq!(records[0]["line"].as_u64(), Some(9));
        assert_eq!(records[1]["line"].as_u64(), Some(10));
        assert_eq!(records[1]["match"].as_bool(), Some(true));
        assert_eq!(records[2]["line"].as_u64(), Some(11));
        assert_eq!(records[3]["line"].as_u64(), Some(12));
    }

    #[test]
    fn read_context_records_for_match_reads_target_window() {
        let workspace = make_temp_workspace("context-window");
        let file_path = workspace.join("sample.txt");
        fs::write(
            &file_path,
            "line1\nline2\nline3\nline4\nline5\nline6\nline7\n",
        )
        .expect("write sample file");
        let canonical_workspace = fs::canonicalize(&workspace).expect("canonicalize workspace");

        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: canonical_workspace,
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let records = read_context_records_for_match(&context, "sample.txt", 4, 2, 1)
            .expect("records should be available");
        assert_eq!(records.len(), 4);
        assert_eq!(records[0]["line"].as_u64(), Some(2));
        assert_eq!(records[0]["match"].as_bool(), Some(false));
        assert_eq!(records[1]["line"].as_u64(), Some(3));
        assert_eq!(records[2]["line"].as_u64(), Some(4));
        assert_eq!(records[2]["match"].as_bool(), Some(true));
        assert_eq!(records[3]["line"].as_u64(), Some(5));

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn collect_builtin_search_matches_for_file_streams_context_records() {
        let workspace = make_temp_workspace("builtin-search-context");
        let file_path = workspace.join("context.txt");
        fs::write(
            &file_path,
            "line1\nline2 keyword\nline3\nline4 keyword\nline5\n",
        )
        .expect("write sample file");
        let canonical_workspace = fs::canonicalize(&workspace).expect("canonicalize workspace");
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: canonical_workspace,
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let request = SearchRequest {
            query: "keyword".to_string(),
            path: "context.txt".to_string(),
            max_results: 4,
            context_before: 1,
            context_after: 1,
            fixed_mode: true,
            case_sensitive: false,
        };
        let mut matches: Vec<Value> = Vec::new();
        let reached_limit = collect_builtin_search_matches_for_file(
            &context,
            &file_path,
            &request,
            None,
            Some("keyword"),
            None,
            &mut matches,
        );
        assert!(!reached_limit);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0]["line"].as_u64(), Some(2));
        assert_eq!(
            matches[0]["records"].as_array().map(|rows| rows.len()),
            Some(3)
        );
        assert_eq!(matches[1]["line"].as_u64(), Some(4));
        assert_eq!(
            matches[1]["records"].as_array().map(|rows| rows.len()),
            Some(3)
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn list_v2_rejects_unknown_arguments() {
        let workspace = make_temp_workspace("list-v2-unknown-arg");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "list",
            json!({
                "unexpected": true
            }),
        )
        .expect_err("unknown list argument should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

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
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn list_v2_reports_limit_reached_metadata() {
        let workspace = make_temp_workspace("list-v2-limit");
        fs::write(workspace.join("z.txt"), "z").expect("write z");
        fs::write(workspace.join("a.txt"), "a").expect("write a");
        fs::write(workspace.join("m.txt"), "m").expect("write m");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "list",
            json!({
                "max_entries": 2
            }),
        )
        .expect("list should succeed");
        assert_eq!(payload["tool"].as_str(), Some("list"));
        assert_eq!(payload["count"].as_u64(), Some(2));
        assert_eq!(payload["entries"].as_array().map(|items| items.len()), Some(2));
        assert_eq!(
            payload["entries"]
                .as_array()
                .expect("list entries should be array")
                .iter()
                .map(|item| item.as_str().unwrap_or_default().to_string())
                .collect::<Vec<String>>(),
            vec!["a.txt".to_string(), "m.txt".to_string()]
        );
        assert_eq!(payload["limit_reached"].as_bool(), Some(true));
        assert_eq!(
            payload["truncation"]["truncated"].as_bool(),
            Some(true)
        );
        assert_eq!(payload["truncation"]["max_entries"].as_u64(), Some(2));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn glob_v2_rejects_unknown_arguments() {
        let workspace = make_temp_workspace("glob-v2-unknown-arg");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "glob",
            json!({
                "pattern": "*.rs",
                "unexpected": true
            }),
        )
        .expect_err("unknown glob argument should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn glob_v2_reports_limit_reached_metadata() {
        let workspace = make_temp_workspace("glob-v2-limit");
        fs::write(workspace.join("zeta.txt"), "zeta").expect("write zeta");
        fs::write(workspace.join("alpha.txt"), "alpha").expect("write alpha");
        fs::write(workspace.join("beta.txt"), "beta").expect("write beta");
        fs::write(workspace.join("skip.md"), "skip").expect("write skip");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "glob",
            json!({
                "pattern": "*.txt",
                "max_entries": 2
            }),
        )
        .expect("glob should succeed");
        assert_eq!(payload["tool"].as_str(), Some("glob"));
        assert_eq!(payload["count"].as_u64(), Some(2));
        assert_eq!(payload["matches"].as_array().map(|items| items.len()), Some(2));
        assert_eq!(
            payload["matches"]
                .as_array()
                .expect("glob matches should be array")
                .iter()
                .map(|item| item.as_str().unwrap_or_default().to_string())
                .collect::<Vec<String>>(),
            vec!["alpha.txt".to_string(), "beta.txt".to_string()]
        );
        assert_eq!(payload["limit_reached"].as_bool(), Some(true));
        assert_eq!(
            payload["truncation"]["truncated"].as_bool(),
            Some(true)
        );
        assert!(
            matches!(payload["engine"].as_str(), Some("fd") | Some("builtin")),
            "unexpected glob engine: {}",
            payload["engine"]
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn search_v2_rejects_unknown_arguments() {
        let workspace = make_temp_workspace("search-v2-unknown-arg");
        fs::write(workspace.join("notes.txt"), "keyword").expect("write notes");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "query": "keyword",
                "unexpected": true
            }),
        )
        .expect_err("unknown search argument should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn search_v2_rejects_context_above_max() {
        let workspace = make_temp_workspace("search-v2-context-upper-bound");
        fs::write(workspace.join("notes.txt"), "keyword").expect("write notes");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "query": "keyword",
                "context_before": (MAX_SEARCH_CONTEXT_LINES as u64).saturating_add(1)
            }),
        )
        .expect_err("context_before above max should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        assert!(
            error.message.contains("must be <="),
            "unexpected context upper-bound error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn search_v2_honors_fixed_and_regex_modes() {
        let workspace = make_temp_workspace("search-v2-fixed-regex");
        fs::write(
            workspace.join("sample.txt"),
            "alpha.*beta\nalphaZZbeta\n",
        )
        .expect("write sample file");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;

        let fixed_payload = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "path": "sample.txt",
                "query": "alpha.*beta",
                "fixed": true,
                "max_results": 10
            }),
        )
        .expect("fixed search should succeed");
        assert_eq!(fixed_payload["count"].as_u64(), Some(1));
        assert_eq!(fixed_payload["preferred_engine"].as_str(), Some("rg"));
        assert!(
            fixed_payload["fallback"]["used"].as_bool().is_some(),
            "search fallback.used should be bool"
        );
        if fixed_payload["fallback"]["used"].as_bool() == Some(true) {
            assert_eq!(fixed_payload["fallback"]["to"].as_str(), Some("builtin"));
            assert!(fixed_payload["fallback"]["reason"].as_str().is_some());
        }

        let regex_payload = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "path": "sample.txt",
                "query": "alpha.*beta",
                "regex": true,
                "max_results": 10
            }),
        )
        .expect("regex search should succeed");
        assert_eq!(regex_payload["count"].as_u64(), Some(2));
        assert_eq!(regex_payload["preferred_engine"].as_str(), Some("rg"));
        assert!(
            regex_payload["fallback"]["used"].as_bool().is_some(),
            "search fallback.used should be bool"
        );
        if regex_payload["fallback"]["used"].as_bool() == Some(true) {
            assert_eq!(regex_payload["fallback"]["to"].as_str(), Some("builtin"));
            assert!(regex_payload["fallback"]["reason"].as_str().is_some());
        }

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn search_v2_reports_truncation_metadata_and_text_truncation() {
        let workspace = make_temp_workspace("search-v2-truncation");
        let long_segment = "k".repeat(SEARCH_MAX_MATCH_TEXT_CHARS.saturating_add(64));
        fs::write(
            workspace.join("sample.txt"),
            format!("{long_segment} keyword\nkeyword short\n"),
        )
        .expect("write sample file");
        let input = make_fs_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "path": "sample.txt",
                "query": "keyword",
                "max_results": 1
            }),
        )
        .expect("search should succeed");
        assert_eq!(payload["count"].as_u64(), Some(1));
        assert_eq!(payload["limit_reached"].as_bool(), Some(true));
        assert_eq!(
            payload["truncation"]["max_results_reached"].as_bool(),
            Some(true)
        );
        assert_eq!(payload["preferred_engine"].as_str(), Some("rg"));
        assert!(
            payload["fallback"]["used"].as_bool().is_some(),
            "search fallback.used should be bool"
        );
        let first = payload["matches"]
            .as_array()
            .and_then(|items| items.first())
            .expect("at least one search match");
        assert_eq!(first["text_truncated"].as_bool(), Some(true));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn search_semantic_overlap_guard_blocks_broad_duplicate_query() {
        let workspace = make_temp_workspace("search-semantic-overlap-guard");
        fs::write(workspace.join("notes.txt"), "team growth and retention\n").expect("write notes");
        let input = make_search_semantic_input(&workspace, "broad-guard");
        let executor = LocalToolExecutor;

        let search_payload = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "query": "team growth and retention"
            }),
        )
        .expect("broad search should succeed");
        assert_eq!(search_payload["tool"].as_str(), Some("search"));

        let overlap_error = execute_tool_payload(
            &executor,
            &input,
            "semantic_search",
            json!({
                "query": "team growth and retention"
            }),
        )
        .expect_err("broad semantic duplicate should be blocked");
        assert_eq!(overlap_error.error_class, "tool_overlap_blocked");
        assert!(
            overlap_error.message.contains("overlapping broad query"),
            "unexpected overlap error message: {}",
            overlap_error.message
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn search_semantic_overlap_guard_allows_refined_semantic_query() {
        let workspace = make_temp_workspace("search-semantic-overlap-refined");
        fs::write(workspace.join("notes.txt"), "retention uplift in q4\n").expect("write notes");
        let input = make_search_semantic_input(&workspace, "refined-allow");
        let executor = LocalToolExecutor;

        let _search_payload = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "query": "retention uplift in q4"
            }),
        )
        .expect("broad search should succeed");

        let refined_semantic_result = execute_tool_payload(
            &executor,
            &input,
            "semantic_search",
            json!({
                "query": "retention uplift in q4",
                "technical_terms": ["retention"],
                "sources": ["code"]
            }),
        );
        match refined_semantic_result {
            Ok(payload) => {
                assert_eq!(payload["tool"].as_str(), Some("semantic_search"));
            }
            Err(error) => {
                assert_ne!(error.error_class, "tool_overlap_blocked");
            }
        }

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn search_semantic_overlap_guard_file_lookup_query_suggests_glob_and_updates_metrics() {
        let workspace = make_temp_workspace("search-semantic-overlap-file-lookup");
        fs::write(workspace.join("notes.txt"), "billing and invoice note\n").expect("write notes");
        let input = make_search_semantic_input(&workspace, "file-lookup-guard");
        let executor = LocalToolExecutor;
        let query = "500元API充值发票在哪个文件夹，地址是啥";
        let blocked_before = overlap_guard_metrics_snapshot()["blocked_total"]
            .as_u64()
            .unwrap_or(0);

        let _search_payload = execute_tool_payload(
            &executor,
            &input,
            "search",
            json!({
                "query": query
            }),
        )
        .expect("broad search should succeed");

        let overlap_error = execute_tool_payload(
            &executor,
            &input,
            "semantic_search",
            json!({
                "query": query
            }),
        )
        .expect_err("broad semantic duplicate should be blocked");
        assert_eq!(overlap_error.error_class, "tool_overlap_blocked");
        assert!(
            overlap_error.message.contains("prefer glob"),
            "expected file lookup guard hint in overlap error: {}",
            overlap_error.message
        );
        let blocked_after = overlap_guard_metrics_snapshot()["blocked_total"]
            .as_u64()
            .unwrap_or(blocked_before);
        assert!(
            blocked_after >= blocked_before.saturating_add(1),
            "expected blocked_total to increase, before={blocked_before}, after={blocked_after}"
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn aggregate_runtime_summary_reports_expected_fields() {
        let now_epoch_secs = current_epoch_secs();
        let mut state_a = McpRuntimeState::default();
        state_a.total_calls = 2;
        state_a.success_calls = 1;
        state_a.failure_calls = 1;
        state_a.timeout_failures = 1;
        state_a.retry_calls = 1;
        state_a.latency_samples = VecDeque::from(vec![10.0, 20.0]);
        state_a
            .top_errors
            .insert("json-rpc read timeout".to_string(), 1);
        state_a.circuit_open_until_epoch_secs = now_epoch_secs.saturating_add(20);

        let mut state_b = McpRuntimeState::default();
        state_b.total_calls = 1;
        state_b.success_calls = 1;
        state_b.failure_calls = 0;
        state_b.policy_denied_calls = 1;
        state_b.latency_samples = VecDeque::from(vec![15.0]);
        state_b
            .top_errors
            .insert("json-rpc read timeout".to_string(), 2);

        let mut snapshots: HashMap<String, McpRuntimeState> = HashMap::new();
        snapshots.insert("a".to_string(), state_a);
        snapshots.insert("b".to_string(), state_b);

        let server_keys = vec!["a".to_string(), "b".to_string()];
        let summary = aggregate_runtime_summary(&server_keys, &snapshots);
        assert_eq!(summary["servers_considered"].as_u64(), Some(2));
        assert_eq!(summary["servers_with_circuit_open"].as_u64(), Some(1));
        assert_eq!(summary["total_calls"].as_u64(), Some(3));
        assert_eq!(summary["success_calls"].as_u64(), Some(2));
        assert_eq!(summary["failure_calls"].as_u64(), Some(1));
        assert_eq!(summary["retry_calls"].as_u64(), Some(1));
        assert_eq!(summary["policy_denied_calls"].as_u64(), Some(1));
        assert_eq!(summary["timeout_failures"].as_u64(), Some(1));
        assert_eq!(summary["latency_sample_count"].as_u64(), Some(3));
        assert_eq!(summary["success_rate"].as_f64(), Some(0.6667));
        let top_errors = summary["top_errors"]
            .as_array()
            .expect("top_errors should be an array");
        assert!(!top_errors.is_empty());
        assert_eq!(
            top_errors[0]["error"].as_str(),
            Some("json-rpc read timeout")
        );
        assert_eq!(top_errors[0]["count"].as_u64(), Some(3));
    }

    #[test]
    fn mcp_timeout_is_recoverable_and_bucketed_as_timeout() {
        let error = ToolExecutionError::new("mcp_timeout", "MCP tools/call timed out after 100 ms");
        assert_eq!(classify_error_bucket(&error), "timeout");
        assert!(is_recoverable_mcp_error(&error));
    }

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

        let schema_drift = classify_tool_recovery("tool_argument_not_visible", "low_risk");
        assert_eq!(schema_drift.stage, "strategy_switch");
        assert_eq!(
            schema_drift.recommended_next_action,
            "inspect_visible_tool_schema_then_retry"
        );
        assert!(schema_drift.recoverable);

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
        assert!(actions.contains(&"narrow_edit_old_text_to_unique_match"));
        assert!(actions.contains(&"reread_target_then_retry_exact_old_text"));
        assert!(actions.contains(&"inspect_error_and_switch_strategy"));
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
            vec!["config_missing"]
        );

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

    #[test]
    fn acquire_mcp_server_slot_rejects_when_queue_full() {
        let server_key = "test-queue-full";
        {
            let mut store = lock_runtime_store().expect("lock runtime store");
            store.states.remove(server_key);
            let state = store.states.entry(server_key.to_string()).or_default();
            state.in_flight = 1;
            state.queue_waiting = 1;
        }

        let server = McpServerResolved {
            name: "mock".to_string(),
            command: "node".to_string(),
            args: vec![],
            env: StdHashMap::new(),
            enabled: true,
            source: "test".to_string(),
            ready: true,
            ready_reason: "ok".to_string(),
        };
        let policy = McpCallPolicy {
            max_concurrency_per_server: 1,
            max_queue_per_server: 1,
            failure_threshold: 3,
            cooldown_secs: 10,
            latency_sample_limit: 64,
            call_timeout_ms: 20,
            session_idle_ttl_secs: 60,
            allow_tools: vec![],
        };
        let error = acquire_mcp_server_slot(&server, server_key, &policy).expect_err("expected queue full");
        assert_eq!(error.error_class, "mcp_server_busy");

        let mut store = lock_runtime_store().expect("lock runtime store");
        let state = store.states.get(server_key).expect("state should exist");
        assert_eq!(state.gate_rejected_calls, 1);
        assert_eq!(state.queue_waiting, 1);
        store.states.remove(server_key);
    }

    #[test]
    fn acquire_mcp_server_slot_times_out_when_wait_exceeds_budget() {
        let server_key = "test-queue-timeout";
        {
            let mut store = lock_runtime_store().expect("lock runtime store");
            store.states.remove(server_key);
            let state = store.states.entry(server_key.to_string()).or_default();
            state.in_flight = 1;
            state.queue_waiting = 0;
        }

        let server = McpServerResolved {
            name: "mock".to_string(),
            command: "node".to_string(),
            args: vec![],
            env: StdHashMap::new(),
            enabled: true,
            source: "test".to_string(),
            ready: true,
            ready_reason: "ok".to_string(),
        };
        let policy = McpCallPolicy {
            max_concurrency_per_server: 1,
            max_queue_per_server: 1,
            failure_threshold: 3,
            cooldown_secs: 10,
            latency_sample_limit: 64,
            call_timeout_ms: 10,
            session_idle_ttl_secs: 60,
            allow_tools: vec![],
        };
        let error = acquire_mcp_server_slot(&server, server_key, &policy).expect_err("expected queue timeout");
        assert_eq!(error.error_class, "mcp_queue_timeout");

        let mut store = lock_runtime_store().expect("lock runtime store");
        let state = store.states.get(server_key).expect("state should exist");
        assert_eq!(state.gate_rejected_calls, 1);
        assert_eq!(state.queue_timeout_calls, 1);
        assert_eq!(state.queue_waiting, 0);
        store.states.remove(server_key);
    }

    #[test]
    fn kimi_provider_still_supports_local_read_write_and_bash_tools() {
        let workspace = make_temp_workspace("kimi-local-tools");
        let input = TurnExecuteInput {
            request_id: "req-kimi-local-tools".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run local tools".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("test-api-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(10_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![
                    "read".to_string(),
                    "write".to_string(),
                    "bash".to_string(),
                ]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: Some(vec!["printf".to_string()]),
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let executor = LocalToolExecutor;

        let write_call = ToolCallInput {
            id: "write-1".to_string(),
            name: "write".to_string(),
            arguments: json!({
                "path": "kimi.txt",
                "content": "hello kimi"
            }),
        };
        let write_output = executor
            .execute_tool_call(&write_call, &input)
            .expect("write should succeed");
        let write_payload: Value =
            serde_json::from_str(&write_output.content).expect("write output should be json");
        assert_eq!(write_payload["tool"].as_str(), Some("write"));
        assert_eq!(
            fs::read_to_string(workspace.join("kimi.txt")).expect("read written file"),
            "hello kimi"
        );

        let read_call = ToolCallInput {
            id: "read-1".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "kimi.txt"
            }),
        };
        let read_output = executor
            .execute_tool_call(&read_call, &input)
            .expect("read should succeed");
        let read_payload: Value =
            serde_json::from_str(&read_output.content).expect("read output should be json");
        assert_eq!(read_payload["tool"].as_str(), Some("read"));
        assert_eq!(read_payload["content"].as_str(), Some("hello kimi"));

        let bash_call = ToolCallInput {
            id: "bash-1".to_string(),
            name: "bash".to_string(),
            arguments: json!({
                "command": "printf kimi_ok"
            }),
        };
        let bash_output = executor
            .execute_tool_call(&bash_call, &input)
            .expect("bash should succeed");
        let bash_payload: Value =
            serde_json::from_str(&bash_output.content).expect("bash output should be json");
        assert_eq!(bash_payload["tool"].as_str(), Some("bash"));
        assert_eq!(bash_payload["exit_code"].as_i64(), Some(0));
        assert_eq!(bash_payload["stdout"].as_str(), Some("kimi_ok"));

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_rejects_unknown_arguments() {
        let workspace = make_temp_workspace("bash-v2-unknown-arg");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok",
                "unexpected": true
            }),
        )
        .expect_err("unknown argument should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_rejects_oversized_command() {
        let workspace = make_temp_workspace("bash-v2-oversized-command");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let oversized = "x".repeat(MAX_BASH_COMMAND_CHARS.saturating_add(1));
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": oversized
            }),
        )
        .expect_err("oversized command should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        assert!(
            error.message.contains("exceeds max length"),
            "unexpected oversized command error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_rejects_timeout_above_max() {
        let workspace = make_temp_workspace("bash-v2-timeout-above-max");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok",
                "timeout_ms": MAX_BASH_TIMEOUT_MS.saturating_add(1)
            }),
        )
        .expect_err("timeout above max should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        assert!(
            error.message.contains("must be <="),
            "unexpected timeout upper-bound error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_rejects_max_output_bytes_above_max() {
        let workspace = make_temp_workspace("bash-v2-output-bytes-above-max");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok",
                "max_output_bytes": (MAX_BASH_MAX_OUTPUT_BYTES as u64).saturating_add(1)
            }),
        )
        .expect_err("max_output_bytes above max should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        assert!(
            error.message.contains("must be <="),
            "unexpected max_output_bytes upper-bound error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_rejects_max_output_lines_above_max() {
        let workspace = make_temp_workspace("bash-v2-output-lines-above-max");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok",
                "max_output_lines": (MAX_BASH_MAX_OUTPUT_LINES as u64).saturating_add(1)
            }),
        )
        .expect_err("max_output_lines above max should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        assert!(
            error.message.contains("must be <="),
            "unexpected max_output_lines upper-bound error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_allowlist_blocks_non_allowlisted_segments() {
        let workspace = make_temp_workspace("bash-v2-segment-allowlist");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok && uname"
            }),
        )
        .expect_err("compound command should fail when any segment is not allowlisted");
        assert_eq!(error.error_class, "bash_not_allowed");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_allowlist_blocks_background_separator_segments() {
        let workspace = make_temp_workspace("bash-v2-bg-segment-allowlist");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok & uname"
            }),
        )
        .expect_err("background-separated commands should be checked per segment");
        assert_eq!(error.error_class, "bash_not_allowed");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_command_substitution() {
        let workspace = make_temp_workspace("bash-v2-security");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf $(whoami)"
            }),
        )
        .expect_err("command substitution should be blocked");
        assert_eq!(error.error_class, "bash_security_denied");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_unbalanced_single_quote() {
        let workspace = make_temp_workspace("bash-v2-unbalanced-single-quote");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf 'oops"
            }),
        )
        .expect_err("unbalanced single quote should be blocked");
        assert_eq!(error.error_class, "bash_security_denied");
        assert!(
            error.message.contains("single quote"),
            "unexpected unbalanced single quote error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_unbalanced_double_quote() {
        let workspace = make_temp_workspace("bash-v2-unbalanced-double-quote");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf \"oops"
            }),
        )
        .expect_err("unbalanced double quote should be blocked");
        assert_eq!(error.error_class, "bash_security_denied");
        assert!(
            error.message.contains("double quote"),
            "unexpected unbalanced double quote error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_trailing_escape() {
        let workspace = make_temp_workspace("bash-v2-trailing-escape");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok\\"
            }),
        )
        .expect_err("trailing escape should be blocked");
        assert_eq!(error.error_class, "bash_security_denied");
        assert!(
            error.message.contains("trailing escape"),
            "unexpected trailing escape error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_disallowed_control_characters() {
        let workspace = make_temp_workspace("bash-v2-control-char");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        let command = format!("printf ok{}", '\u{0007}');
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": command
            }),
        )
        .expect_err("control characters should be blocked");
        assert_eq!(error.error_class, "bash_security_denied");
        assert!(
            error.message.contains("control character"),
            "unexpected control char error: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_returns_timeout_error_for_long_running_command() {
        let workspace = make_temp_workspace("bash-v2-timeout");
        let input = make_bash_input(&workspace, vec!["sleep".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "sleep 1",
                "timeout_ms": 100
            }),
        )
        .expect_err("sleep command should time out");
        assert_eq!(error.error_class, "bash_timeout");
        assert!(
            error.message.contains("timed out"),
            "timeout error message should mention timeout, got: {}",
            error.message
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_reports_truncation_and_persists_full_output() {
        let workspace = make_temp_workspace("bash-v2-truncation");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf 'line-%s\\n' {1..40}",
                "max_output_lines": 5
            }),
        )
        .expect("bash should succeed with truncation");

        assert_eq!(payload["tool"].as_str(), Some("bash"));
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert_eq!(payload["timed_out"].as_bool(), Some(false));
        assert_eq!(payload["audit"]["policy"].as_str(), Some("bash_v2_strict"));
        assert_eq!(
            payload["audit"]["allowlist_matches"]
                .as_array()
                .map(|rows| rows.len()),
            Some(1)
        );
        assert_eq!(
            payload["truncation"]["stdout"]["truncated"].as_bool(),
            Some(true),
            "stdout should be truncated when max_output_lines is small"
        );

        let full_output_path = payload["full_output_path"]
            .as_str()
            .expect("full_output_path should exist when output is truncated");
        assert!(
            fs::metadata(full_output_path).is_ok(),
            "persisted full output path should exist: {full_output_path}"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(full_output_path)
                .expect("read full output metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(
                mode, 0o600,
                "persisted full output file should be owner-only readable/writable"
            );
        }
        let full_output = fs::read_to_string(full_output_path).expect("read persisted full output");
        assert!(
            full_output.contains("line-40"),
            "full output should contain tail lines from command output"
        );

        let _ = fs::remove_file(full_output_path);
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_audit_redacts_secret_like_values() {
        let workspace = make_temp_workspace("bash-v2-audit-redaction");
        fs::create_dir_all(workspace.join(".grobot")).expect("create project .grobot");
        fs::write(
            workspace.join(".grobot/project.toml"),
            r#"
[tools.bash]
audit_redact_secrets = true
"#,
        )
        .expect("write project bash policy");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf 'token=%s' 'sk-abcdefgh1234567890'"
            }),
        )
        .expect("bash should succeed");
        let preview = payload["audit"]["command_preview"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        assert!(preview.contains("token"));
        assert!(
            preview.contains("<redacted>"),
            "audit preview should redact secret-like token values, got: {preview}"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_audit_redacts_quoted_password_values() {
        let workspace = make_temp_workspace("bash-v2-audit-quoted-redaction");
        fs::create_dir_all(workspace.join(".grobot")).expect("create project .grobot");
        fs::write(
            workspace.join(".grobot/project.toml"),
            r#"
[tools.bash]
audit_redact_secrets = true
"#,
        )
        .expect("write project bash policy");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf '%s' \"password='UltraSecretValue987'\""
            }),
        )
        .expect("bash should succeed");
        let preview = payload["audit"]["command_preview"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        assert!(
            preview.contains("password=<redacted>"),
            "quoted password value should be redacted in audit preview, got: {preview}"
        );
        assert!(
            !preview.contains("ultrasecretvalue987"),
            "audit preview must not expose quoted password value, got: {preview}"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_audit_can_disable_redaction() {
        let workspace = make_temp_workspace("bash-v2-audit-no-redaction");
        fs::create_dir_all(workspace.join(".grobot")).expect("create project .grobot");
        fs::write(
            workspace.join(".grobot/project.toml"),
            r#"
[tools.bash]
audit_redact_secrets = false
"#,
        )
        .expect("write project bash policy");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf 'token=%s' 'sk-abcdefgh1234567890'"
            }),
        )
        .expect("bash should succeed");
        let preview = payload["audit"]["command_preview"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        assert!(
            !preview.contains("<redacted>"),
            "audit preview should keep original value when redaction is disabled, got: {preview}"
        );
        assert!(
            preview.contains("sk-abcdefgh1234567890"),
            "audit preview should retain token when redaction is disabled, got: {preview}"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_keeps_operators_inside_quotes_single_segment() {
        let workspace = make_temp_workspace("bash-v2-quoted-segment");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf '%s' 'a && b; c | d'"
            }),
        )
        .expect("quoted operators should not split command segments");
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert_eq!(payload["stdout"].as_str(), Some("a && b; c | d"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_keeps_escaped_separator_single_segment() {
        let workspace = make_temp_workspace("bash-v2-escaped-separator");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf '%s' a\\;b"
            }),
        )
        .expect("escaped separators should stay in same command segment");
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert_eq!(payload["stdout"].as_str(), Some("a;b"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_create_without_prior_read_succeeds() {
        let workspace = make_temp_workspace("write-v2-create");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "new-file.txt",
                "content": "hello\nworld\n"
            }),
        )
        .expect("write create should succeed");
        assert_eq!(payload["tool"].as_str(), Some("write"));
        assert_eq!(payload["operation"].as_str(), Some("create"));
        assert_eq!(payload["line_ending"].as_str(), Some("lf"));
        assert_eq!(payload["bom_written"].as_bool(), Some(false));
        assert_eq!(payload["created_parent_dirs"].as_bool(), Some(false));
        assert_eq!(payload["existed_before"].as_bool(), Some(false));
        assert_eq!(
            fs::read_to_string(workspace.join("new-file.txt")).expect("read created file"),
            "hello\nworld\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_reports_bom_crlf_and_created_parent_metadata() {
        let workspace = make_temp_workspace("write-v2-format-meta");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "nested/format.txt",
                "content": "\u{FEFF}hello\r\nworld\r\n"
            }),
        )
        .expect("write create should succeed");
        assert_eq!(payload["operation"].as_str(), Some("create"));
        assert_eq!(payload["line_ending"].as_str(), Some("crlf"));
        assert_eq!(payload["bom_written"].as_bool(), Some(true));
        assert_eq!(payload["created_parent_dirs"].as_bool(), Some(true));
        assert_eq!(
            fs::read_to_string(workspace.join("nested/format.txt")).expect("read created file"),
            "\u{FEFF}hello\r\nworld\r\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_parent_traversal_for_missing_target() {
        let workspace = make_temp_workspace("write-v2-missing-traversal");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "nested/../escape.txt",
                "content": "blocked\n"
            }),
        )
        .expect_err("missing write targets with parent traversal should fail");
        assert_eq!(error.error_class, "path_escape_blocked");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_requires_prior_read_for_existing_file() {
        let workspace = make_temp_workspace("write-v2-read-required");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect_err("write without prior read should fail");
        assert_eq!(error.error_class, "write_read_required");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_partial_read_for_existing_file() {
        let workspace = make_temp_workspace("write-v2-partial-read");
        fs::write(workspace.join("sample.txt"), "line1\nline2\nline3\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt",
                "offset": 2,
                "limit": 1
            }),
        )
        .expect("partial read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\nline3\n"
            }),
        )
        .expect_err("write after partial read should fail");
        assert_eq!(error.error_class, "write_partial_read_not_allowed");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_stale_target_after_read() {
        let workspace = make_temp_workspace("write-v2-stale");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2-mutated\n").expect("mutate file to stale snapshot");

        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect_err("stale write should fail");
        assert_eq!(error.error_class, "write_stale_target");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_legacy_append_argument() {
        let workspace = make_temp_workspace("write-v2-legacy-append");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "hello\n",
                "append": true
            }),
        )
        .expect_err("legacy append should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_extra_arguments() {
        let workspace = make_temp_workspace("write-v2-extra-args");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "hello\n",
                "unexpected": true
            }),
        )
        .expect_err("extra write arguments should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_noop_update() {
        let workspace = make_temp_workspace("write-v2-noop");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nline2\n"
            }),
        )
        .expect_err("noop write should fail");
        assert_eq!(error.error_class, "write_no_changes");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_allows_mtime_drift_when_content_unchanged() {
        let workspace = make_temp_workspace("write-v2-mtime-drift");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2\n").expect("rewrite same content to bump mtime");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect("write should still succeed when only mtime drifted");
        assert_eq!(payload["operation"].as_str(), Some("update"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_clears_read_snapshot_after_success() {
        let workspace = make_temp_workspace("write-v2-clear-snapshot");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect("first write should succeed");
        assert_eq!(payload["operation"].as_str(), Some("update"));

        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2-AGAIN\n"
            }),
        )
        .expect_err("second write without new read should fail");
        assert_eq!(error.error_class, "write_read_required");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_clears_edit_snapshot_after_success() {
        let workspace = make_temp_workspace("write-v2-clear-edit-snapshot");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_write_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect("write should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "LINE2\n", "new_text": "line2\n"}]
            }),
        )
        .expect_err("edit should require re-read after write");
        assert_eq!(error.error_class, "edit_read_required");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn file_snapshot_roundtrip_preserves_hash_and_flags() {
        let workspace = make_temp_workspace("file-snapshot-roundtrip");
        let target = workspace.join("roundtrip.txt");
        let session_key = "test:file-snapshot-roundtrip";
        record_file_read_snapshot(session_key, &target, 123, true, Some(789));

        let snapshot = lookup_file_read_snapshot(session_key, &target).expect("snapshot should exist");
        assert_eq!(snapshot.mtime_ms, 123);
        assert!(snapshot.full_view);
        assert_eq!(snapshot.content_hash, Some(789));

        clear_file_read_snapshot(session_key, &target);
        assert!(
            lookup_file_read_snapshot(session_key, &target).is_none(),
            "snapshot should be cleared"
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn file_mutation_lock_reuses_lock_for_same_path() {
        let workspace = make_temp_workspace("file-mutation-lock");
        let target = workspace.join("shared.txt");
        let lock_a = acquire_file_mutation_lock(&target).expect("acquire first lock");
        let lock_b = acquire_file_mutation_lock(&target).expect("acquire second lock");
        assert!(Arc::ptr_eq(&lock_a, &lock_b));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

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

    #[test]
    fn read_v2_routes_image_file_to_image_kind() {
        let workspace = make_temp_workspace("read-v2-image-kind");
        fs::write(
            workspace.join("img.png"),
            vec![137_u8, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0],
        )
        .expect("write image-like file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "img.png"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("image"));
        assert!(
            payload["content"]
                .as_str()
                .unwrap_or_default()
                .contains("Image file detected")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_routes_video_file_to_video_kind() {
        let workspace = make_temp_workspace("read-v2-video-kind");
        fs::write(workspace.join("clip.mp4"), vec![0_u8; 32]).expect("write video-like file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-video-1".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "clip.mp4"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("video read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("video"));
        assert!(
            payload["content"]
                .as_str()
                .unwrap_or_default()
                .contains("Video file detected")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_notebook_respects_offset_limit_window() {
        let workspace = make_temp_workspace("read-v2-notebook-window");
        let notebook = json!({
            "cells": [
                { "cell_type": "markdown", "source": ["cell1"] },
                { "cell_type": "code", "source": ["cell2"] },
                { "cell_type": "markdown", "source": ["cell3"] },
                { "cell_type": "code", "source": ["cell4"] }
            ]
        });
        fs::write(
            workspace.join("nb.ipynb"),
            serde_json::to_string(&notebook).expect("serialize notebook"),
        )
        .expect("write notebook file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6b".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "nb.ipynb",
                "offset": 2,
                "limit": 2
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("notebook read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("notebook"));
        assert_eq!(payload["line_start"].as_u64(), Some(2));
        assert_eq!(payload["line_end"].as_u64(), Some(3));
        assert_eq!(payload["has_more"].as_bool(), Some(true));
        assert_eq!(payload["next_offset"].as_u64(), Some(4));
        assert_eq!(
            payload["meta"]["extra"]["selected_count"].as_u64(),
            Some(2)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_cells"]
                .as_array()
                .map(|cells| cells.len()),
            Some(2)
        );
        let content = payload["content"].as_str().unwrap_or_default();
        assert!(content.contains("[2] code cell2"));
        assert!(content.contains("[3] markdown cell3"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_notebook_empty_file_returns_empty_window() {
        let workspace = make_temp_workspace("read-v2-notebook-empty");
        let notebook = json!({
            "cells": []
        });
        fs::write(
            workspace.join("empty.ipynb"),
            serde_json::to_string(&notebook).expect("serialize notebook"),
        )
        .expect("write notebook file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6c-empty".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "empty.ipynb"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("empty notebook read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("notebook"));
        assert_eq!(payload["line_start"].as_u64(), Some(1));
        assert_eq!(payload["line_end"].as_u64(), Some(0));
        assert_eq!(payload["has_more"].as_bool(), Some(false));
        assert_eq!(
            payload["meta"]["extra"]["selected_count"].as_u64(),
            Some(0)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_cells"]
                .as_array()
                .map(|cells| cells.len()),
            Some(0)
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_pdf_pages_is_reflected_in_meta() {
        let workspace = make_temp_workspace("read-v2-pdf-pages");
        fs::write(workspace.join("report.pdf"), "%PDF-1.4\nplaceholder\n").expect("write pdf placeholder");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6c".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "report.pdf",
                "pages": "2-3"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("pdf read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("pdf"));
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["first_page"].as_u64(),
            Some(2)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["last_page"].as_u64(),
            Some(3)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_pages"].as_str(),
            Some("2-3")
        );
        assert!(payload["meta"]["extra"]["total_pages_known"].is_boolean());
        let extract_status = payload["meta"]["extra"]["extract_status"].as_str().unwrap_or_default();
        assert!(
            extract_status == "extracted"
                || extract_status == "extracted_ocr"
                || extract_status == "extracted_no_text"
                || extract_status == "fallback"
        );
        if extract_status == "fallback" {
            assert!(
                payload["content"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("install poppler")
            );
        }
        if extract_status == "extracted_no_text" {
            assert_eq!(
                payload["meta"]["extra"]["text_detected"].as_bool(),
                Some(false)
            );
        }
        if extract_status == "extracted_ocr" {
            assert_eq!(
                payload["meta"]["extra"]["ocr_applied"].as_bool(),
                Some(true)
            );
            assert_eq!(
                payload["meta"]["extra"]["text_detected"].as_bool(),
                Some(true)
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_pdf_default_window_is_reflected_when_pages_not_provided() {
        let workspace = make_temp_workspace("read-v2-pdf-default-window");
        fs::write(workspace.join("default.pdf"), "%PDF-1.4\nplaceholder\n").expect("write pdf placeholder");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-6c-default".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "default.pdf"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("pdf read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("pdf"));
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["first_page"].as_u64(),
            Some(1)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_page_range"]["last_page"].as_u64(),
            Some(20)
        );
        assert_eq!(
            payload["meta"]["extra"]["selected_pages"].as_str(),
            Some("1-20")
        );
        let extract_status = payload["meta"]["extra"]["extract_status"].as_str().unwrap_or_default();
        if extract_status == "fallback" {
            assert!(
                payload["content"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("requested_pages=default(1-20)")
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_parse_pdf_page_range_accepts_valid_patterns() {
        assert_eq!(parse_pdf_page_range(Some("3")), Some((3, 3)));
        assert_eq!(parse_pdf_page_range(Some("2-5")), Some((2, 5)));
        assert_eq!(parse_pdf_page_range(Some(" 7 - 9 ")), Some((7, 9)));
        assert_eq!(parse_pdf_page_range(Some("0")), None);
        assert_eq!(parse_pdf_page_range(Some("9-2")), None);
        assert_eq!(parse_pdf_page_range(Some("abc")), None);
    }

    #[test]
    fn read_v2_parse_pdf_total_pages_extracts_value() {
        let raw = "Title: sample\nPages: 12\nEncrypted: no\n";
        assert_eq!(parse_pdf_total_pages(raw), Some(12));
        assert_eq!(parse_pdf_total_pages("Pages: 0"), None);
        assert_eq!(parse_pdf_total_pages("No page metadata"), None);
    }

    #[test]
    fn read_v2_parse_pdfimages_list_count_extracts_rows() {
        let raw = "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n\
---------------------\n\
1      0    image   1600  2300  rgb     3   8  image  no         8  0    300   300  121K 0.8%\n\
2      1    image   1600  2300  rgb     3   8  image  no         9  0    300   300  119K 0.8%\n";
        assert_eq!(parse_pdfimages_list_count(raw), Some(2));
        assert_eq!(
            parse_pdfimages_list_count(
                "page num type\n---------------------\n",
            ),
            Some(0)
        );
        assert_eq!(parse_pdfimages_list_count("not a pdfimages output"), None);
    }

    #[test]
    fn read_v2_build_pdf_extract_guidance_mentions_missing_tools() {
        let guidance = build_pdf_extract_guidance(&["pdftotext", "pdftoppm"]);
        assert!(guidance.contains("pdftotext"));
        assert!(guidance.contains("pdftoppm"));
        assert!(guidance.contains("poppler"));
        assert!(guidance.contains("tesseract"));
    }

    #[test]
    fn read_v2_parse_kimi_file_extract_response_prefers_content_field() {
        let parsed = parse_kimi_file_extract_response(
            r#"{"content":"hello\nworld","file_type":"application/pdf","filename":"invoice.pdf","title":"invoice"}"#,
        );
        assert_eq!(parsed.text, "hello\nworld");
        assert_eq!(parsed.content_source, "json.content");
        assert_eq!(parsed.file_type.as_deref(), Some("application/pdf"));
        assert_eq!(parsed.filename.as_deref(), Some("invoice.pdf"));
        assert_eq!(parsed.title.as_deref(), Some("invoice"));
        assert!(parsed.was_json_payload);
    }

    #[test]
    fn read_v2_parse_kimi_file_extract_response_falls_back_to_plain_text() {
        let parsed = parse_kimi_file_extract_response("plain text payload");
        assert_eq!(parsed.text, "plain text payload");
        assert_eq!(parsed.content_source, "plain_text");
        assert!(!parsed.was_json_payload);
    }

    #[test]
    fn read_v2_pdf_has_visible_text_detects_non_whitespace() {
        assert!(!pdf_has_visible_text("   \n\t\r  "));
        assert!(pdf_has_visible_text(" \nA "));
    }

    #[test]
    fn read_v2_should_attempt_pdf_ocr_respects_window_limit() {
        assert!(should_attempt_pdf_ocr(true, READ_PDF_OCR_MAX_PAGES));
        assert!(!should_attempt_pdf_ocr(
            true,
            READ_PDF_OCR_MAX_PAGES.saturating_add(1)
        ));
        assert!(!should_attempt_pdf_ocr(false, 1));
    }

    #[test]
    fn read_v2_should_use_kimi_multimodal_read_respects_provider_model_and_pages() {
        let input = TurnExecuteInput {
            request_id: "req-kimi-route".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(10_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: None,
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: Some(true),
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };

        let request_pdf = ReadRequest {
            path: "invoice.pdf".to_string(),
            start_line: 1,
            line_limit: None,
            include_metadata: true,
            pages: None,
            range_mode: "full",
        };
        let request_pdf_with_pages = ReadRequest {
            pages: Some("1-2".to_string()),
            ..request_pdf.clone()
        };
        let request_image = ReadRequest {
            path: "snap.png".to_string(),
            ..request_pdf.clone()
        };
        assert!(should_use_kimi_multimodal_read(
            ReadKind::Pdf,
            &request_pdf,
            &input
        ));
        assert!(should_use_kimi_multimodal_read(
            ReadKind::Pdf,
            &request_pdf_with_pages,
            &input
        ));
        assert!(should_use_kimi_multimodal_read(
            ReadKind::Image,
            &request_image,
            &input
        ));

        let non_k25 = TurnExecuteInput {
            model_config: Some(RuntimeModelConfigInput {
                model: Some("kimi-k2".to_string()),
                ..input.model_config.clone().expect("model config")
            }),
            ..input.clone()
        };
        assert!(!should_use_kimi_multimodal_read(
            ReadKind::Pdf,
            &request_pdf,
            &non_k25
        ));
    }

    #[test]
    fn read_v2_kimi_remote_pdf_rejects_pages_argument() {
        let workspace = make_temp_workspace("read-v2-kimi-pdf-pages-reject");
        fs::write(workspace.join("invoice.pdf"), b"%PDF-1.4").expect("write minimal pdf-like bytes");

        let input = TurnExecuteInput {
            request_id: "req-kimi-pdf-pages-reject".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(10_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: None,
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: Some(true),
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };

        let call = ToolCallInput {
            id: "read-v2-kimi-pdf-pages-reject".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "invoice.pdf",
                "pages": "1-2"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("kimi remote pdf mode should reject read.pages");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        assert!(error.message.contains("read.pages is not supported in kimi remote pdf mode"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_kimi_media_requires_k25_model() {
        let workspace = make_temp_workspace("read-v2-kimi-model-gate");
        fs::write(workspace.join("invoice.pdf"), b"%PDF-1.4").expect("write minimal pdf-like bytes");

        let input = TurnExecuteInput {
            request_id: "req-kimi-model-gate".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                model: Some("kimi-k2".to_string()),
                timeout_ms: Some(10_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: None,
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: Some(true),
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };

        let call = ToolCallInput {
            id: "read-v2-kimi-model-gate".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "invoice.pdf"
            }),
        };

        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("kimi media read should require kimi-k2.5");
        assert_eq!(error.error_class, "config_missing");
        assert!(error.message.contains("model kimi-k2.5"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    #[ignore = "manual smoke: set READ_V2_MANUAL_FILE to an external PDF path"]
    fn read_v2_manual_external_pdf_smoke_from_env() {
        let pdf_path = env::var("READ_V2_MANUAL_FILE")
            .expect("READ_V2_MANUAL_FILE is required for manual external pdf smoke");
        let work_dir = env::var("READ_V2_MANUAL_WORKDIR").unwrap_or_else(|_| {
            env::current_dir()
                .ok()
                .and_then(|path| path.to_str().map(|text| text.to_string()))
                .unwrap_or_else(|| ".".to_string())
        });
        let pages = env::var("READ_V2_MANUAL_PAGES").ok();
        let use_kimi = env::var("READ_V2_MANUAL_USE_KIMI")
            .ok()
            .map(|raw| matches!(raw.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false);

        let mut arguments = json!({
            "path": pdf_path,
        });
        if let Some(pages_value) = pages {
            arguments["pages"] = Value::String(pages_value);
        }

        let model_config = if use_kimi {
            let kimi_api_key = env::var("READ_V2_MANUAL_KIMI_API_KEY")
                .expect("READ_V2_MANUAL_KIMI_API_KEY is required when READ_V2_MANUAL_USE_KIMI=1");
            let kimi_base_url = env::var("READ_V2_MANUAL_KIMI_BASE_URL")
                .unwrap_or_else(|_| "https://api.moonshot.cn/v1".to_string());
            let kimi_model = env::var("READ_V2_MANUAL_KIMI_MODEL")
                .unwrap_or_else(|_| "kimi-k2.5".to_string());
            Some(RuntimeModelConfigInput {
                base_url: Some(kimi_base_url),
                api_key: Some(kimi_api_key),
                model: Some(kimi_model),
                timeout_ms: Some(30_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: None,
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: Some(true),
                        allow_file_admin: None,
                    }),
                }),
            })
        } else {
            None
        };

        let input = TurnExecuteInput {
            request_id: "req-read-v2-manual-external-pdf".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "read pdf".to_string(),
            context_lines: vec![],
            model_config,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(work_dir),
                enabled_tools: Some(vec!["read".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };

        let call = ToolCallInput {
            id: "read-v2-manual-external-pdf".to_string(),
            name: "read".to_string(),
            arguments,
        };

        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("manual external pdf read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["tool"].as_str(), Some("read"));
        assert_eq!(payload["kind"].as_str(), Some("pdf"));

        let extract_status = payload["meta"]["extra"]["extract_status"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(
            matches!(
                extract_status.as_str(),
                "extracted"
                    | "extracted_ocr"
                    | "extracted_no_text"
                    | "fallback"
                    | "extracted_remote_kimi_file_extract"
                    | "extracted_remote_kimi_multimodal"
                    | "extracted_no_text_remote"
            ),
            "unexpected extract_status: {extract_status}"
        );

        eprintln!(
            "[read_v2_manual_external_pdf_smoke_from_env] extract_status={} text_detected={:?} selected_page_range={:?}",
            extract_status,
            payload["meta"]["extra"]["text_detected"],
            payload["meta"]["extra"]["selected_page_range"],
        );
        if let Some(content) = payload["content"].as_str() {
            let preview = content
                .lines()
                .take(8)
                .collect::<Vec<&str>>()
                .join("\\n");
            eprintln!("[read_v2_manual_external_pdf_smoke_from_env] preview={preview}");
        }
    }

    #[test]
    fn read_v2_compute_pdf_extract_plan_defaults_to_first_window() {
        let plan = compute_pdf_extract_plan(None, Some(57)).expect("plan should succeed");
        assert_eq!(plan.first_page, 1);
        assert_eq!(plan.last_page, 20);
        assert!(plan.has_more_pages);
        assert_eq!(plan.next_pages.as_deref(), Some("21-40"));
    }

    #[test]
    fn read_v2_compute_pdf_extract_plan_handles_requested_range() {
        let plan = compute_pdf_extract_plan(Some((12, 25)), Some(18)).expect("plan should succeed");
        assert_eq!(plan.first_page, 12);
        assert_eq!(plan.last_page, 18);
        assert!(!plan.has_more_pages);
        assert_eq!(plan.next_pages, None);

        let error = compute_pdf_extract_plan(Some((30, 35)), Some(18))
            .expect_err("out of range should fail");
        assert_eq!(error.error_class, "range_out_of_bounds");
    }

    #[test]
    fn read_v2_blocks_device_and_proc_stdio_alias_paths() {
        assert!(is_blocked_device_path(std::path::Path::new("/dev/stdout")));
        assert!(is_blocked_device_path(std::path::Path::new("/dev/fd/1")));
        assert!(is_blocked_device_path(std::path::Path::new("/proc/self/fd/2")));
        assert!(!is_blocked_device_path(std::path::Path::new("/tmp/read-ok.txt")));
    }

    #[test]
    fn read_v2_include_metadata_false_omits_meta_field() {
        let workspace = make_temp_workspace("read-v2-no-meta");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-no-meta-1".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "sample.txt",
                "include_metadata": false
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload.get("meta").is_none());
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_metadata_reports_text_format_and_snapshot_scope() {
        let workspace = make_temp_workspace("read-v2-format-meta");
        fs::write(
            workspace.join("format.txt"),
            "\u{FEFF}line1\r\nline2\r\n",
        )
        .expect("write text with bom and crlf");
        let input = make_read_only_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "format.txt"
            }),
        )
        .expect("read should succeed");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert_eq!(payload["meta"]["line_ending"].as_str(), Some("crlf"));
        assert_eq!(payload["meta"]["bom_detected"].as_bool(), Some(true));
        assert_eq!(payload["meta"]["encoding"].as_str(), Some("utf-8"));
        assert_eq!(payload["meta"]["snapshot_full_view"].as_bool(), Some(true));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn text_format_detects_mixed_line_endings_and_bom() {
        let mixed = inspect_text_content_format("line1\r\nline2\nline3");
        assert_eq!(mixed.line_ending, "mixed");
        assert!(!mixed.bom_detected);

        let bom_single_line = inspect_text_content_format("\u{FEFF}single-line");
        assert_eq!(bom_single_line.line_ending, "none");
        assert!(bom_single_line.bom_detected);
    }

    #[test]
    fn read_v2_returns_empty_content_for_empty_text_file() {
        let workspace = make_temp_workspace("read-v2-empty-file");
        fs::write(workspace.join("empty.txt"), "").expect("write empty file");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-empty".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "empty.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed for empty file");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert_eq!(payload["line_start"].as_u64(), Some(1));
        assert_eq!(payload["line_end"].as_u64(), Some(0));
        assert_eq!(payload["content"].as_str(), Some(""));
        assert_eq!(payload["has_more"].as_bool(), Some(false));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_returns_file_unchanged_for_same_range_and_mtime() {
        let workspace = make_temp_workspace("read-v2-dedup");
        fs::write(workspace.join("dedup.txt"), "line1\nline2\nline3\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "dedup.txt",
                "offset": 1,
                "limit": 2
            }),
        };
        let first = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("first read should succeed");
        let first_payload: Value = serde_json::from_str(&first.content).expect("first read output should be json");
        assert_eq!(first_payload["kind"].as_str(), Some("text"));

        let second = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("second read should succeed");
        let second_payload: Value = serde_json::from_str(&second.content).expect("second read output should be json");
        assert_eq!(second_payload["kind"].as_str(), Some("file_unchanged"));
        assert_eq!(second_payload["meta"]["cache"].as_str(), Some("hit"));
        assert_eq!(second_payload["meta"]["line_ending"].as_str(), Some("lf"));
        assert_eq!(second_payload["meta"]["bom_detected"].as_bool(), Some(false));
        assert_eq!(
            second_payload["meta"]["snapshot_full_view"].as_bool(),
            Some(false)
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_dedup_is_session_scoped() {
        let workspace = make_temp_workspace("read-v2-dedup-session");
        fs::write(workspace.join("session.txt"), "line1\nline2\nline3\n").expect("write sample text");
        let input_a = make_read_only_input(&workspace);
        let mut input_b = make_read_only_input(&workspace);
        input_b.session_key = "feishu:grobot:dm:tester-b".to_string();
        let call = ToolCallInput {
            id: "read-v2-7b".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "session.txt",
                "offset": 1,
                "limit": 2
            }),
        };
        let _first = LocalToolExecutor
            .execute_tool_call(&call, &input_a)
            .expect("first read should succeed");
        let second_same_session = LocalToolExecutor
            .execute_tool_call(&call, &input_a)
            .expect("second read should succeed");
        let payload_same: Value =
            serde_json::from_str(&second_same_session.content).expect("same-session payload should be json");
        assert_eq!(payload_same["kind"].as_str(), Some("file_unchanged"));

        let cross_session = LocalToolExecutor
            .execute_tool_call(&call, &input_b)
            .expect("cross-session first read should succeed");
        let payload_cross: Value =
            serde_json::from_str(&cross_session.content).expect("cross-session payload should be json");
        assert_eq!(payload_cross["kind"].as_str(), Some("text"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_supports_at_prefixed_path() {
        let workspace = make_temp_workspace("read-v2-at-path");
        fs::write(workspace.join("at.txt"), "hello\nworld\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7c".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "@at.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload["content"].as_str().unwrap_or_default().starts_with("hello\nworld"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_supports_curly_quote_filename_variant() {
        let workspace = make_temp_workspace("read-v2-curly-quote");
        let actual_name = "Capture d\u{2019}ecran.txt";
        fs::write(workspace.join(actual_name), "variant\nok\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7d".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "Capture d'ecran.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed via curly quote variant");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload["content"].as_str().unwrap_or_default().starts_with("variant\nok"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_supports_macos_ampm_filename_variant() {
        let workspace = make_temp_workspace("read-v2-ampm");
        let actual_name = "Screenshot\u{202F}AM.txt";
        fs::write(workspace.join(actual_name), "variant\nok\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-7e".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "Screenshot AM.txt"
            }),
        };
        let output = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect("read should succeed via AM/PM variant");
        let payload: Value = serde_json::from_str(&output.content).expect("read output should be json");
        assert_eq!(payload["kind"].as_str(), Some("text"));
        assert!(payload["content"].as_str().unwrap_or_default().starts_with("variant\nok"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn read_v2_reports_offset_out_of_bounds() {
        let workspace = make_temp_workspace("read-v2-oob");
        fs::write(workspace.join("oob.txt"), "line1\nline2\n").expect("write sample text");
        let input = make_read_only_input(&workspace);
        let call = ToolCallInput {
            id: "read-v2-8".to_string(),
            name: "read".to_string(),
            arguments: json!({
                "path": "oob.txt",
                "offset": 9
            }),
        };
        let error = LocalToolExecutor
            .execute_tool_call(&call, &input)
            .expect_err("out of bounds read should fail");
        assert_eq!(error.error_class, "range_out_of_bounds");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_requires_prior_read_in_same_session() {
        let workspace = make_temp_workspace("edit-v2-read-gate");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect_err("edit without read should fail");
        assert_eq!(error.error_class, "edit_read_required");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_stale_target_after_read() {
        let workspace = make_temp_workspace("edit-v2-stale");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2-modified\n").expect("mutate file to stale snapshot");

        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect_err("stale edit should fail");
        assert_eq!(error.error_class, "edit_stale_target");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_allows_mtime_drift_when_content_unchanged() {
        let workspace = make_temp_workspace("edit-v2-mtime-drift");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2\n").expect("rewrite same content to bump mtime");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect("edit should succeed when only mtime drifted");

        assert_eq!(payload["replacements"].as_u64(), Some(1));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "line1\nLINE2\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_partial_read_snapshot_still_uses_mtime_guard() {
        let workspace = make_temp_workspace("edit-v2-partial-read-mtime-guard");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\nline3\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt",
                "offset": 1,
                "limit": 1
            }),
        )
        .expect("partial read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2\nline3\n").expect("rewrite same content to bump mtime");

        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect_err("edit should fail for partial-read snapshot mtime drift");
        assert_eq!(error.error_class, "edit_stale_target");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_matches_all_edits_against_original_baseline() {
        let workspace = make_temp_workspace("edit-v2-original-baseline");
        let target = workspace.join("sample.txt");
        fs::write(&target, "alpha\nfoo\nbar\nomega\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [
                    {"old_text": "foo\n", "new_text": "foo bar\n"},
                    {"old_text": "bar\n", "new_text": "BAR\n"}
                ]
            }),
        )
        .expect("edit should succeed");

        assert_eq!(payload["blocks_requested"].as_u64(), Some(2));
        assert_eq!(payload["replacements"].as_u64(), Some(2));
        assert_eq!(payload["fuzzy_fallback_used"].as_bool(), Some(false));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "alpha\nfoo bar\nBAR\nomega\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_overlapping_ranges() {
        let workspace = make_temp_workspace("edit-v2-overlap");
        fs::write(workspace.join("sample.txt"), "one\ntwo\nthree\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [
                    {"old_text": "one\ntwo\n", "new_text": "ONE\nTWO\n"},
                    {"old_text": "two\nthree\n", "new_text": "TWO\nTHREE\n"}
                ]
            }),
        )
        .expect_err("overlap should fail");
        assert_eq!(error.error_class, "edit_overlap");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_supports_safe_fuzzy_quote_matching() {
        let workspace = make_temp_workspace("edit-v2-fuzzy-quotes");
        let target = workspace.join("sample.js");
        fs::write(&target, "console.log(“hello”);\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.js"
            }),
        )
        .expect("read should succeed");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.js",
                "edits": [{"old_text": "console.log(\"hello\");\n", "new_text": "console.log(\"world\");\n"}]
            }),
        )
        .expect("fuzzy edit should succeed");

        assert_eq!(payload["fuzzy_fallback_used"].as_bool(), Some(true));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "console.log(\"world\");\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_preserves_utf8_bom_and_crlf_endings() {
        let workspace = make_temp_workspace("edit-v2-bom-crlf");
        let target = workspace.join("sample.txt");
        fs::write(&target, "\u{FEFF}first\r\nsecond\r\nthird\r\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "second\n", "new_text": "SECOND\n"}]
            }),
        )
        .expect("edit should succeed");

        assert_eq!(payload["first_changed_line"].as_u64(), Some(2));
        assert_eq!(payload["line_ending"].as_str(), Some("crlf"));
        assert_eq!(payload["bom_preserved"].as_bool(), Some(true));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "\u{FEFF}first\r\nSECOND\r\nthird\r\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_legacy_arguments() {
        let workspace = make_temp_workspace("edit-v2-legacy-args");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "old_text": "line2\n",
                "new_text": "LINE2\n",
                "replace_all": false
            }),
        )
        .expect_err("legacy arguments should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_duplicate_candidate_lines() {
        let workspace = make_temp_workspace("edit-v2-duplicate-candidates");
        fs::write(workspace.join("sample.txt"), "same\nmiddle\nsame\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "same\n", "new_text": "SAME\n"}]
            }),
        )
        .expect_err("duplicate match should fail");
        assert_eq!(error.error_class, "edit_match_not_unique");
        assert!(error.message.contains("candidates=line 1: \"same\""));
        assert!(error.message.contains("line 3: \"same\""));
        assert!(error.message.contains("retry with a unique old_text"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_missing_match_candidate_lines() {
        let workspace = make_temp_workspace("edit-v2-missing-candidates");
        fs::write(
            workspace.join("sample.txt"),
            "alpha_count = 1;\nbeta_count = 2;\n",
        )
        .expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "alpha_count = 99;\n", "new_text": "alpha_count = 2;\n"}]
            }),
        )
        .expect_err("missing match should fail");
        assert_eq!(error.error_class, "edit_not_found");
        assert!(error.message.contains("closest_lines=line 1: \"alpha_count = 1;\""));
        assert!(error.message.contains("retry with exact old_text"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_lf_metadata_without_bom() {
        let workspace = make_temp_workspace("edit-v2-lf-metadata");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect("edit should succeed");
        assert_eq!(payload["line_ending"].as_str(), Some("lf"));
        assert_eq!(payload["bom_preserved"].as_bool(), Some(false));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_none_line_ending_for_single_line() {
        let workspace = make_temp_workspace("edit-v2-none-line-ending");
        let target = workspace.join("sample.txt");
        fs::write(&target, "single").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "single", "new_text": "single-line"}]
            }),
        )
        .expect("edit should succeed");
        assert_eq!(payload["line_ending"].as_str(), Some("none"));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "single-line"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_noop_replacements() {
        let workspace = make_temp_workspace("edit-v2-noop");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "line2\n"}]
            }),
        )
        .expect_err("noop replacement should fail");
        assert_eq!(error.error_class, "edit_no_changes");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

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
                tool_surface_profile: Some("context".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
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
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
}
