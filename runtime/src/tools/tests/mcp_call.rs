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
        let data = error.data.as_ref().expect("queue full should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_server_busy"));
        assert_eq!(data["server"].as_str(), Some("mock"));
        assert_eq!(data["server_key"].as_str(), Some(server_key));
        assert_eq!(data["in_flight"].as_u64(), Some(1));
        assert_eq!(data["queue_waiting"].as_u64(), Some(1));
        assert_eq!(data["max_concurrency_per_server"].as_u64(), Some(1));
        assert_eq!(data["max_queue_per_server"].as_u64(), Some(1));

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
        let data = error.data.as_ref().expect("queue timeout should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_queue_timeout"));
        assert_eq!(data["server"].as_str(), Some("mock"));
        assert_eq!(data["timeout_ms"].as_u64(), Some(10));
        assert_eq!(data["queue_waiting"].as_u64(), Some(0));

        let mut store = lock_runtime_store().expect("lock runtime store");
        let state = store.states.get(server_key).expect("state should exist");
        assert_eq!(state.gate_rejected_calls, 1);
        assert_eq!(state.queue_timeout_calls, 1);
        assert_eq!(state.queue_waiting, 0);
        store.states.remove(server_key);
    }

    #[test]
    fn acquire_mcp_server_slot_reports_circuit_open_data() {
        let server_key = "test-circuit-open";
        let open_until = current_epoch_secs().saturating_add(30);
        {
            let mut store = lock_runtime_store().expect("lock runtime store");
            store.states.remove(server_key);
            let state = store.states.entry(server_key.to_string()).or_default();
            state.circuit_open_until_epoch_secs = open_until;
            state.consecutive_failures = 3;
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
        let error = acquire_mcp_server_slot(&server, server_key, &policy).expect_err("expected circuit open");
        assert_eq!(error.error_class, "mcp_circuit_open");
        let data = error.data.as_ref().expect("circuit open should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_circuit_open"));
        assert_eq!(data["server"].as_str(), Some("mock"));
        assert_eq!(data["server_key"].as_str(), Some(server_key));
        assert_eq!(
            data["circuit_open_until_epoch_secs"].as_u64(),
            Some(open_until)
        );
        assert_eq!(data["cooldown_secs"].as_u64(), Some(10));
        assert_eq!(data["consecutive_failures"].as_u64(), Some(3));

        let mut store = lock_runtime_store().expect("lock runtime store");
        store.states.remove(server_key);
    }

    #[test]
    fn run_mcp_call_rejects_blocked_tool_with_structured_data() {
        let root = make_temp_workspace("mcp-tool-blocked-data");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        fs::write(
            grobot_dir.join("mcp.toml"),
            r#"
[[servers]]
name = "mock-blocked"
command = "sh"
enabled = true
"#,
        )
        .expect("write mcp registry");
        fs::write(
            grobot_dir.join("project.toml"),
            r#"
[tools.mcp]
allow_tools = ["allowed_tool"]
"#,
        )
        .expect("write mcp policy");

        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace,
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let args = json_object_args(json!({
            "server": "mock-blocked",
            "tool": "blocked_tool",
            "arguments": {
                "query": "blocked",
                "token": "sk-abcdefgh1234567890"
            }
        }));
        let error = run_mcp_call(&context, &args).expect_err("blocked MCP tool should fail before spawn");
        assert_eq!(error.error_class, "mcp_tool_blocked");
        let data = error.data.as_ref().expect("blocked tool should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_tool_blocked"));
        assert_eq!(data["server"].as_str(), Some("mock-blocked"));
        assert_eq!(data["tool_name"].as_str(), Some("blocked_tool"));
        assert_eq!(data["operation"].as_str(), Some("policy_check"));
        assert_eq!(data["allow_tools"].as_array().map(|items| items.len()), Some(1));
        assert_eq!(
            data["argument_keys"]
                .as_array()
                .map(|items| items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<&str>>()),
            Some(vec!["query", "token"])
        );
        assert!(
            data["argument_preview"]
                .as_str()
                .is_some_and(|preview| preview.contains("<redacted>"))
        );

        let mut store = lock_runtime_store().expect("lock runtime store");
        store.states.remove("mock-blocked");
        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn run_mcp_call_missing_server_keeps_argument_metadata() {
        let workspace = make_temp_workspace("mcp-call-missing-server-arguments");
        let missing_server = format!("missing-server-{}", process::id());
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let args = json_object_args(json!({
            "server": missing_server,
            "tool": "echo",
            "arguments": {
                "payload": "hello"
            }
        }));
        let error = run_mcp_call(&context, &args).expect_err("missing MCP server should fail");
        assert_eq!(error.error_class, "mcp_server_not_found");
        let data = error
            .data
            .as_ref()
            .expect("missing server should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_server_not_found"));
        assert_eq!(data["server"].as_str(), Some(missing_server.as_str()));
        assert_eq!(data["tool_name"].as_str(), Some("echo"));
        assert_eq!(
            data["argument_keys"]
                .as_array()
                .map(|items| items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<&str>>()),
            Some(vec!["payload"])
        );
        assert!(
            data["argument_bytes"]
                .as_u64()
                .is_some_and(|value| value > 0)
        );
        assert!(
            data["argument_preview"]
                .as_str()
                .is_some_and(|preview| preview.contains("hello"))
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn run_mcp_call_server_busy_keeps_argument_metadata() {
        let root = make_temp_workspace("mcp-call-busy-arguments");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        fs::write(
            grobot_dir.join("mcp.toml"),
            r#"
[[servers]]
name = "mock-busy"
command = "sh"
enabled = true
"#,
        )
        .expect("write mcp registry");
        fs::write(
            grobot_dir.join("project.toml"),
            r#"
[tools.mcp]
max_concurrency_per_server = 1
max_queue_per_server = 0
"#,
        )
        .expect("write mcp policy");

        let server_key = "mock-busy";
        {
            let mut store = lock_runtime_store().expect("lock runtime store");
            store.states.remove(server_key);
            let state = store.states.entry(server_key.to_string()).or_default();
            state.in_flight = 1;
        }

        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let args = json_object_args(json!({
            "server": "mock-busy",
            "tool": "echo",
            "arguments": {
                "payload": "wait"
            }
        }));
        let error = run_mcp_call(&context, &args).expect_err("busy MCP server should fail before spawn");
        assert_eq!(error.error_class, "mcp_server_busy");
        let data = error
            .data
            .as_ref()
            .expect("busy server should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_server_busy"));
        assert_eq!(data["server"].as_str(), Some("mock-busy"));
        assert_eq!(data["tool_name"].as_str(), Some("echo"));
        assert_eq!(
            data["argument_keys"]
                .as_array()
                .map(|items| items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<&str>>()),
            Some(vec!["payload"])
        );
        assert_eq!(data["max_queue_per_server"].as_u64(), Some(0));

        let mut store = lock_runtime_store().expect("lock runtime store");
        store.states.remove(server_key);
        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn run_mcp_call_rejects_non_object_arguments_with_structured_data() {
        let workspace = make_temp_workspace("mcp-call-non-object-arguments");
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let args = json_object_args(json!({
            "server": "mock",
            "tool": "echo",
            "arguments": ["not", "an", "object"]
        }));
        let error = run_mcp_call(&context, &args)
            .expect_err("mcp_call should reject non-object arguments before server lookup");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        let data = error
            .data
            .as_ref()
            .expect("invalid arguments should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("invalid_tool_arguments"));
        assert_eq!(data["operation"].as_str(), Some("parse_arguments"));
        assert_eq!(data["reason"].as_str(), Some("arguments_not_object"));
        assert_eq!(data["argument_type"].as_str(), Some("array"));
        assert_eq!(data["server"].as_str(), Some("mock"));
        assert_eq!(data["tool_name"].as_str(), Some("echo"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn run_mcp_call_rejects_oversized_arguments_before_server_lookup() {
        let workspace = make_temp_workspace("mcp-call-oversized-arguments");
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let args = json_object_args(json!({
            "server": "missing-server",
            "tool": "echo",
            "arguments": {
                "payload": "x".repeat(MAX_MCP_CALL_ARGUMENT_BYTES)
            }
        }));
        let error = run_mcp_call(&context, &args)
            .expect_err("mcp_call should reject oversized arguments before server lookup");
        assert_eq!(error.error_class, "mcp_arguments_too_large");
        let data = error
            .data
            .as_ref()
            .expect("oversized arguments should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_arguments_too_large"));
        assert_eq!(data["operation"].as_str(), Some("parse_arguments"));
        assert_eq!(data["reason"].as_str(), Some("arguments_exceed_byte_budget"));
        assert_eq!(data["server"].as_str(), Some("missing-server"));
        assert_eq!(data["tool_name"].as_str(), Some("echo"));
        assert_eq!(
            data["max_argument_bytes"].as_u64(),
            Some(MAX_MCP_CALL_ARGUMENT_BYTES as u64)
        );
        assert!(
            data["argument_bytes"]
                .as_u64()
                .is_some_and(|value| value > MAX_MCP_CALL_ARGUMENT_BYTES as u64)
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn run_mcp_call_observed_is_error_includes_bounded_argument_metadata() {
        let _browser_mcp_guard = BROWSER_MCP_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock browser MCP fixture");
        let root = make_temp_workspace("mcp-call-observed-argument-metadata");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        write_fake_browser_mcp_registry(
            &grobot_dir,
            &json!({ "reason": "bad args", "retryable": false }),
            true,
            false,
        );

        clear_mcp_runtime_state("browser-structured");
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let args = json_object_args(json!({
            "server": "browser-structured",
            "tool": "browser_execute_js",
            "arguments": {
                "script": "return document.title",
                "token": "sk-abcdefgh1234567890"
            }
        }));
        let output = run_mcp_call(&context, &args).expect("MCP isError should return observable output");
        let observed = output
            .observed_error
            .as_ref()
            .expect("MCP isError should produce observed recovery error");
        assert_eq!(observed.error_class, "mcp_tool_result_error");
        let data = observed
            .data
            .as_ref()
            .expect("observed error should include structured data");
        assert_eq!(data["server"].as_str(), Some("browser-structured"));
        assert_eq!(data["tool_name"].as_str(), Some("browser_execute_js"));
        assert_eq!(
            data["argument_keys"]
                .as_array()
                .map(|items| items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<&str>>()),
            Some(vec!["script", "token"])
        );
        assert!(
            data["argument_bytes"]
                .as_u64()
                .is_some_and(|value| value > 0)
        );
        let argument_preview = data["argument_preview"]
            .as_str()
            .expect("argument preview should be included");
        assert!(argument_preview.contains("return document.title"));
        assert!(argument_preview.contains("<redacted>"));
        assert!(
            !argument_preview.contains("sk-abcdefgh1234567890"),
            "argument preview must not expose secret-like values, got: {argument_preview}"
        );

        clear_mcp_runtime_state("browser-structured");
        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn run_mcp_call_rpc_error_includes_bounded_argument_metadata() {
        let _browser_mcp_guard = BROWSER_MCP_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock browser MCP fixture");
        let root = make_temp_workspace("mcp-call-rpc-error-argument-metadata");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        write_fake_browser_mcp_registry(&grobot_dir, &json!({ "status": "ok" }), false, true);

        clear_mcp_runtime_state("browser-structured");
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let args = json_object_args(json!({
            "server": "browser-structured",
            "tool": "browser_execute_js",
            "arguments": {
                "script": "return location.href",
                "token": "sk-abcdefgh1234567890"
            }
        }));
        let error = run_mcp_call(&context, &args).expect_err("MCP RPC error should fail");
        assert_eq!(error.error_class, "mcp_rpc_error");
        let data = error
            .data
            .as_ref()
            .expect("rpc error should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_rpc_error"));
        assert_eq!(data["operation"].as_str(), Some("read_response"));
        assert_eq!(data["reason"].as_str(), Some("json_rpc_error"));
        assert_eq!(data["rpc_error_code"].as_i64(), Some(-32602));
        assert_eq!(data["server"].as_str(), Some("browser-structured"));
        assert_eq!(data["tool_name"].as_str(), Some("browser_execute_js"));
        assert_eq!(
            data["argument_keys"]
                .as_array()
                .map(|items| items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<&str>>()),
            Some(vec!["script", "token"])
        );
        let argument_preview = data["argument_preview"]
            .as_str()
            .expect("argument preview should be included");
        assert!(argument_preview.contains("return location.href"));
        assert!(argument_preview.contains("<redacted>"));
        assert!(
            !argument_preview.contains("sk-abcdefgh1234567890"),
            "argument preview must not expose secret-like values, got: {argument_preview}"
        );

        clear_mcp_runtime_state("browser-structured");
        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn mcp_tool_result_error_reports_observable_failure_data() {
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
        let execution = McpCallExecution {
            available_tools: vec!["echo".to_string(), "fail".to_string()],
            is_error: true,
            content: json!([{ "type": "text", "text": "bad args" }]),
            raw_preview: "bad args".to_string(),
            structured_content_preview: "{\"reason\":\"bad args\"}".to_string(),
        };
        let arguments = json!({
            "query": "hello",
            "token": "sk-abcdefgh1234567890"
        })
        .as_object()
        .cloned()
        .expect("arguments object");
        let error = mcp_tool_result_error(&server, "fail", &execution, &arguments);
        assert_eq!(error.error_class, "mcp_tool_result_error");
        assert!(error.message.contains("isError=true"));
        let data = error.data.as_ref().expect("tool result error should include data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_tool_result_error"));
        assert_eq!(data["server"].as_str(), Some("mock"));
        assert_eq!(data["tool_name"].as_str(), Some("fail"));
        assert_eq!(data["operation"].as_str(), Some("tools/call"));
        assert_eq!(data["is_error"].as_bool(), Some(true));
        assert_eq!(data["result_preview"].as_str(), Some("bad args"));
        assert_eq!(data["available_tools"].as_array().map(|items| items.len()), Some(2));
        assert_eq!(
            data["max_argument_bytes"].as_u64(),
            Some(MAX_MCP_CALL_ARGUMENT_BYTES as u64)
        );
        assert_eq!(
            data["argument_keys"]
                .as_array()
                .map(|items| items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<&str>>()),
            Some(vec!["query", "token"])
        );
        assert!(
            data["argument_bytes"]
                .as_u64()
                .is_some_and(|value| value > 0)
        );
        let argument_preview = data["argument_preview"]
            .as_str()
            .expect("argument_preview should be included");
        assert!(argument_preview.contains("hello"));
        assert!(argument_preview.contains("<redacted>"));
        assert!(
            !argument_preview.contains("sk-abcdefgh1234567890"),
            "argument preview must be redacted, got: {argument_preview}"
        );
    }
    #[test]
    fn mcp_call_error_context_enriches_rpc_failures_with_argument_metadata() {
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
        let arguments = json!({
            "limit": 2,
            "query": "bad args"
        })
        .as_object()
        .cloned()
        .expect("arguments object");
        let error = ToolExecutionError::new("mcp_rpc_error", "rpc failed").with_data(json!({
            "diagnostic_kind": "mcp_rpc_error",
            "operation": "read_response",
            "reason": "json_rpc_error",
            "rpc_error_code": -32602
        }));
        let enriched = enrich_mcp_call_error_context(error, &server, "web_search", &arguments);
        let data = enriched
            .data
            .as_ref()
            .expect("enriched rpc error should include data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_rpc_error"));
        assert_eq!(data["operation"].as_str(), Some("read_response"));
        assert_eq!(data["server"].as_str(), Some("mock"));
        assert_eq!(data["tool_name"].as_str(), Some("web_search"));
        assert_eq!(data["rpc_error_code"].as_i64(), Some(-32602));
        assert_eq!(
            data["argument_keys"]
                .as_array()
                .map(|items| items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<&str>>()),
            Some(vec!["limit", "query"])
        );
        assert!(
            data["argument_preview"]
                .as_str()
                .is_some_and(|preview| preview.contains("bad args"))
        );
    }
