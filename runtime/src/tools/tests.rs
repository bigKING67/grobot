#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::engine::{RuntimeModelConfigInput, RuntimeToolContextInput, TurnExecuteInput};
    use serde_json::Value;
    use std::collections::HashMap as StdHashMap;
    use std::collections::HashSet as StdHashSet;
    use std::fs;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("grobot-tools-{prefix}-{}-{nonce}", process::id()));
        fs::create_dir_all(&root).expect("create temp workspace root");
        root
    }

    #[test]
    fn local_tool_catalog_keeps_schema_defaults_and_dispatch_aligned() {
        let definitions = local_tool_definitions();
        let mut schema_names = StdHashSet::new();
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
        assert!(default_enabled_names.contains(TOOL_ASK_USER_QUESTION));

        for tool_name in &catalog_names {
            assert!(
                is_local_tool_dispatch_supported(tool_name),
                "dispatcher missing handler for {}",
                tool_name
            );
        }
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
            work_dir: workspace,
            enabled_tools: HashSet::new(),
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
            work_dir: canonical_workspace,
            enabled_tools: HashSet::new(),
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
            work_dir: canonical_workspace,
            enabled_tools: HashSet::new(),
            bash_allowlist: Vec::new(),
        };
        let mut matches: Vec<Value> = Vec::new();
        let reached_limit = collect_builtin_search_matches_for_file(
            &context,
            &file_path,
            true,
            false,
            "keyword",
            None,
            Some("keyword"),
            None,
            1,
            1,
            &mut matches,
            4,
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
    fn semantic_search_returns_bridge_unavailable_when_override_missing() {
        let workspace = make_temp_workspace("semantic-search-missing-bridge");
        let input = TurnExecuteInput {
            request_id: "req-semantic-search".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            user_message: "semantic search".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![TOOL_SEMANTIC_SEARCH.to_string()]),
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
            user_message: "enhance prompt".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![TOOL_PROMPT_ENHANCER.to_string()]),
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
