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
