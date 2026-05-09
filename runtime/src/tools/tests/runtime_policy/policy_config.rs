    #[test]
    fn load_mcp_call_policy_accepts_valid_explicit_fields() {
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
max_concurrency_per_server = 2
max_queue_per_server = 32
failure_threshold = 4
cooldown_secs = 30
latency_sample_limit = 64
call_timeout_ms = 1000
session_idle_ttl_secs = 120
allow_tools = ["echo", "search"]
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
        let policy = load_mcp_call_policy(&context).expect("valid mcp policy should load");
        assert_eq!(policy.max_concurrency_per_server, 2);
        assert_eq!(policy.max_queue_per_server, 32);
        assert_eq!(policy.failure_threshold, 4);
        assert_eq!(policy.cooldown_secs, 30);
        assert_eq!(policy.latency_sample_limit, 64);
        assert_eq!(policy.call_timeout_ms, 1000);
        assert_eq!(policy.session_idle_ttl_secs, 120);
        assert_eq!(
            policy.allow_tools,
            vec!["echo".to_string(), "search".to_string()]
        );

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn load_mcp_call_policy_rejects_out_of_range_fields() {
        let root = make_temp_workspace("policy-reject-range");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        let project_toml = grobot_dir.join("project.toml");
        fs::write(
            &project_toml,
            r#"
[tools.mcp]
failure_threshold = 0
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
        let error =
            load_mcp_call_policy(&context).expect_err("out-of-range mcp policy must fail closed");
        assert_eq!(error.error_class, "config_invalid");
        assert!(error.message.contains("tools.mcp.failure_threshold"));
        let data = error.data.as_ref().expect("config error should include data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("config_invalid"));
        assert_eq!(
            data["required_config"].as_str(),
            Some("tools.mcp.failure_threshold")
        );

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn load_mcp_call_policy_rejects_malformed_toml() {
        let root = make_temp_workspace("policy-reject-toml");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        fs::write(
            grobot_dir.join("project.toml"),
            r#"
[tools.mcp]
call_timeout_ms = "1200" trailing
"#,
        )
        .expect("write malformed project policy");

        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace,
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let error =
            load_mcp_call_policy(&context).expect_err("malformed project TOML must fail closed");
        assert_eq!(error.error_class, "config_invalid");
        assert!(error.message.contains("failed to parse TOML config"));

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn load_mcp_call_policy_rejects_allow_tools_empty_entries_and_duplicates() {
        let root = make_temp_workspace("policy-reject-allow-tools");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        let project_toml = grobot_dir.join("project.toml");
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };

        fs::write(
            &project_toml,
            r#"
[tools.mcp]
allow_tools = []
"#,
        )
        .expect("write policy with empty allow list");
        let empty_list_error =
            load_mcp_call_policy(&context).expect_err("empty allow_tools list must fail");
        assert_eq!(empty_list_error.error_class, "config_invalid");
        assert!(empty_list_error.message.contains("tools.mcp.allow_tools"));

        fs::write(
            &project_toml,
            r#"
[tools.mcp]
allow_tools = ["echo", " "]
"#,
        )
        .expect("write policy with empty allow entry");
        let empty_error =
            load_mcp_call_policy(&context).expect_err("empty allow_tools entry must fail");
        assert_eq!(empty_error.error_class, "config_invalid");
        assert!(empty_error.message.contains("tools.mcp.allow_tools"));

        fs::write(
            &project_toml,
            r#"
[tools.mcp]
allow_tools = ["echo", "echo"]
"#,
        )
        .expect("write policy with duplicate allow entries");
        let duplicate_error =
            load_mcp_call_policy(&context).expect_err("duplicate allow_tools must fail");
        assert_eq!(duplicate_error.error_class, "config_invalid");
        assert!(duplicate_error.message.contains("values must be unique"));

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn load_mcp_servers_rejects_malformed_registry_entries() {
        let root = make_temp_workspace("mcp-registry-reject");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        let registry_toml = grobot_dir.join("mcp.toml");
        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace.clone(),
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "mcp".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };

        fs::write(
            &registry_toml,
            r#"
[[servers]]
name = ""
command = "node"
enabled = true
"#,
        )
        .expect("write registry with empty name");
        let name_error = load_mcp_servers(&context).expect_err("empty server name must fail");
        assert_eq!(name_error.error_class, "config_invalid");
        assert!(name_error.message.contains("servers[].name"));

        fs::write(
            &registry_toml,
            r#"
[[servers]]
name = "bad-enabled"
command = "node"
enabled = "true"
"#,
        )
        .expect("write registry with malformed enabled");
        let enabled_error =
            load_mcp_servers(&context).expect_err("malformed server enabled must fail");
        assert_eq!(enabled_error.error_class, "config_invalid");
        assert!(enabled_error.message.contains("failed to parse TOML config"));

        fs::write(
            &registry_toml,
            r#"
[[servers]]
name = "bad-args"
command = "node"
args = ["server.mjs", " "]
enabled = true
"#,
        )
        .expect("write registry with empty arg");
        let arg_error = load_mcp_servers(&context).expect_err("empty server arg must fail");
        assert_eq!(arg_error.error_class, "config_invalid");
        assert!(arg_error.message.contains("servers[].args"));

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn load_bash_runtime_policy_accepts_valid_explicit_fields() {
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
output_ttl_secs = 120
output_max_files = 64
audit_preview_chars = 80
audit_segment_chars = 120
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
        let policy = load_bash_runtime_policy(&context).expect("valid bash policy should load");
        assert_eq!(policy.output_ttl_secs, 120);
        assert_eq!(policy.output_max_files, 64);
        assert_eq!(policy.audit_preview_chars, 80);
        assert_eq!(policy.audit_segment_chars, 120);
        assert!(!policy.audit_redact_secrets);

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }

    #[test]
    fn load_bash_runtime_policy_rejects_out_of_range_fields() {
        let root = make_temp_workspace("bash-policy-reject-range");
        let workspace = root.join("workspace");
        let grobot_dir = root.join(".grobot");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::create_dir_all(&grobot_dir).expect("create .grobot");
        fs::write(
            grobot_dir.join("project.toml"),
            r#"
[tools.bash]
audit_segment_chars = 90000
"#,
        )
        .expect("write invalid bash policy");

        let context = ToolContextResolved {
            session_key: "test-session".to_string(),
            work_dir: workspace,
            enabled_tools: HashSet::new(),
            model_visible_tools: HashSet::new(),
            tool_surface_profile: "coding".to_string(),
            advanced_tool_schema: false,
            bash_allowlist: Vec::new(),
        };
        let error =
            load_bash_runtime_policy(&context).expect_err("out-of-range bash policy must fail");
        assert_eq!(error.error_class, "config_invalid");
        assert!(error.message.contains("tools.bash.audit_segment_chars"));

        fs::remove_dir_all(&root).expect("cleanup temp workspace");
    }
