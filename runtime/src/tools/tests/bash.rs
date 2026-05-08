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
        assert_eq!(error.error_class, "bash_policy_forbidden");
        let data = error.data.as_ref().expect("bash allowlist error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("bash_policy_forbidden"));
        assert_eq!(data["decision"].as_str(), Some("forbidden"));
        assert_eq!(data["reason"].as_str(), Some("unknown_command_forbidden"));
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
        assert_eq!(error.error_class, "bash_policy_forbidden");
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
        let data = error.data.as_ref().expect("bash security error data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("bash_security_denied")
        );
        assert_eq!(
            data["reason"].as_str(),
            Some("command substitution using $(...) is blocked")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_ansi_c_shell_quoting() {
        let workspace = make_temp_workspace("bash-v2-ansi-c-quoting");
        let input = make_bash_input(&workspace, vec!["find".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "find . $'-exec' printf x \\;"
            }),
        )
        .expect_err("ANSI-C quoting can hide dangerous flags and should be blocked");
        assert_eq!(error.error_class, "bash_security_denied");
        let data = error.data.as_ref().expect("ANSI-C quoting error data");
        assert_eq!(data["reason"].as_str(), Some("ANSI-C shell quoting is blocked"));
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
        let data = error.data.as_ref().expect("bash control char error data");
        assert_eq!(data["reason"].as_str(), Some("disallowed_control_character"));
        assert!(data["char_index"].as_u64().is_some());
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_shell_variable_expansion() {
        let workspace = make_temp_workspace("bash-v2-variable-expansion");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf $HOME"
            }),
        )
        .expect_err("shell variable expansion should be blocked before execution");
        assert_eq!(error.error_class, "bash_security_denied");
        let data = error.data.as_ref().expect("variable expansion error data");
        assert_eq!(
            data["reason"].as_str(),
            Some("shell variable expansion is blocked")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_unquoted_glob_expansion() {
        let workspace = make_temp_workspace("bash-v2-glob-expansion");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf *"
            }),
        )
        .expect_err("unquoted glob expansion should be blocked before execution");
        assert_eq!(error.error_class, "bash_security_denied");
        let data = error.data.as_ref().expect("glob expansion error data");
        assert_eq!(
            data["reason"].as_str(),
            Some("unquoted shell glob expansion is blocked")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_unquoted_brace_expansion() {
        let workspace = make_temp_workspace("bash-v2-brace-expansion");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf %s {1..3}"
            }),
        )
        .expect_err("unquoted brace expansion should be blocked before execution");
        assert_eq!(error.error_class, "bash_security_denied");
        let data = error.data.as_ref().expect("brace expansion error data");
        assert_eq!(
            data["reason"].as_str(),
            Some("unquoted shell brace expansion is blocked")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    include!("bash/security_guards.rs");
    include!("bash/policy_guards.rs");

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
        let data = error.data.as_ref().expect("bash timeout error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("bash_timeout"));
        assert_eq!(data["timeout_ms"].as_u64(), Some(100));
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
                "command": "printf 'line-%s\\n' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40",
                "max_output_lines": 5
            }),
        )
        .expect("bash should succeed with truncation");

        assert_eq!(payload["tool"].as_str(), Some("bash"));
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert_eq!(payload["timed_out"].as_bool(), Some(false));
        assert_eq!(payload["audit"]["policy"].as_str(), Some("bash_v2_strict"));
        assert_eq!(
            payload["audit"]["segments"]
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
    fn bash_v2_output_persist_errors_include_recovery_data() {
        let workspace = make_temp_workspace("bash-v2-persist-error-data");
        let output_root = workspace.join("missing-output-root");
        let mut capture = BashStreamCapture::new(1, output_root.as_path());
        let error = capture
            .ingest(b"this output must spill", "stdout")
            .expect_err("missing output root should fail when creating stream buffer");
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("bash IO error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("bash_io_error"));
        assert_eq!(data["source"].as_str(), Some("bash"));
        assert_eq!(data["stage"].as_str(), Some("create_stream_buffer"));
        assert_eq!(data["stream"].as_str(), Some("stdout"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_capture_pipe_error_includes_recovery_data() {
        let error = bash_io_error(
            "failed to capture bash stdout",
            "capture_stdout_pipe",
            Some("stdout"),
            "retry the command; if it repeats, inspect runtime pipe setup",
        );
        assert_eq!(error.error_class, "tool_execution_failed");
        let data = error.data.as_ref().expect("bash pipe error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("bash_io_error"));
        assert_eq!(data["source"].as_str(), Some("bash"));
        assert_eq!(data["stage"].as_str(), Some("capture_stdout_pipe"));
        assert_eq!(data["stream"].as_str(), Some("stdout"));
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

    include!("bash/policy_sed_guards.rs");
