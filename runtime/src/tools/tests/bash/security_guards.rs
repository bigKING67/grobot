    #[test]
    fn bash_v2_blocks_proc_environ_access() {
        let workspace = make_temp_workspace("bash-v2-proc-environ");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for command in ["cat /proc/self/environ", "cat < /proc/self/\\environ"] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("/proc/*/environ can expose process secrets and should be blocked");
            assert_eq!(error.error_class, "bash_security_denied");
            let data = error.data.as_ref().expect("proc environ error data");
            assert_eq!(data["reason"].as_str(), Some("proc_environ_access"));
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_parser_differential_characters() {
        let workspace = make_temp_workspace("bash-v2-parser-differential");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for (command, reason) in [
            (format!("TZ=UTC{}printf ok", '\r'), "carriage_return_misparse"),
            ("printf ok\u{00a0}done".to_string(), "unicode_whitespace"),
            ("echo \"safe\" # ' quote".to_string(), "comment_quote_desync"),
            ("echo safe#comment".to_string(), "mid_word_hash"),
            ("mv './decoy\n#hidden' target".to_string(), "quoted_newline_hash_line"),
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("parser differential command should be blocked before execution");
            assert_eq!(error.error_class, "bash_security_denied");
            let data = error.data.as_ref().expect("parser differential error data");
            assert_eq!(data["reason"].as_str(), Some(reason));
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_quote_and_zsh_expansion_obfuscation() {
        let workspace = make_temp_workspace("bash-v2-quote-zsh-obfuscation");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for (command, reason) in [
            ("printf $\"--help\"", "locale shell quoting is blocked"),
            ("find . \"\"-exec printf x \\;", "empty quote dash obfuscation is blocked"),
            ("printf \"\"\"-x\"", "consecutive quote obfuscation is blocked"),
            ("printf =(whoami)", "process substitution =(...) is blocked"),
            ("printf =curl", "zsh equals expansion is blocked"),
            ("printf ~[whoami]", "zsh-style parameter expansion is blocked"),
            ("printf $[1+2]", "legacy arithmetic expansion is blocked"),
            ("printf *(e:whoami:)", "zsh glob qualifier execution is blocked"),
            ("printf <# comment", "PowerShell comment syntax is blocked"),
            ("echo ok } always { echo cleanup", "zsh always block is blocked"),
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("obfuscated shell construct should be blocked before execution");
            assert_eq!(error.error_class, "bash_security_denied");
            let data = error.data.as_ref().expect("obfuscation error data");
            assert_eq!(data["reason"].as_str(), Some(reason));
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_zsh_dangerous_commands_and_fc_editor() {
        let workspace = make_temp_workspace("bash-v2-zsh-dangerous-command");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for (command, reason) in [
            ("zmodload zsh/system", "zsh dangerous command is blocked"),
            (
                "FOO=bar command builtin ztcp example.invalid 443",
                "zsh dangerous command is blocked",
            ),
            ("emulate -c 'print hi'", "zsh dangerous command is blocked"),
            ("fc -e vim", "fc -e editor execution is blocked"),
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("zsh dangerous command surface should be blocked before execution");
            assert_eq!(error.error_class, "bash_security_denied");
            let data = error.data.as_ref().expect("zsh dangerous error data");
            assert_eq!(data["reason"].as_str(), Some(reason));
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_backslash_escaped_whitespace_parser_differential() {
        let workspace = make_temp_workspace("bash-v2-backslash-whitespace");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "echo\\ test/../../../usr/bin/touch generated.txt"
            }),
        )
        .expect_err("backslash-escaped whitespace should not desync argv parsing");
        assert_eq!(error.error_class, "bash_security_denied");
        let data = error.data.as_ref().expect("backslash whitespace error data");
        assert_eq!(data["reason"].as_str(), Some("backslash_escaped_whitespace"));
        assert!(
            !workspace.join("generated.txt").exists(),
            "blocked parser-differential command must not execute"
        );

        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf '%s' 'echo\\ test'"
            }),
        )
        .expect("literal backslash-space inside single quotes should be allowed");
        assert_eq!(payload["stdout"].as_str(), Some("echo\\ test"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_allows_single_quoted_backslash_literals() {
        let workspace = make_temp_workspace("bash-v2-single-quoted-backslash");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": r"printf '%s' '\'"
            }),
        )
        .expect("single-quoted backslash should not desync the security scanner");
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_does_not_let_single_quoted_backslash_hide_segment_breaks() {
        let workspace = make_temp_workspace("bash-v2-single-quote-segment-break");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": r"printf '%s' '\'; touch generated.txt"
            }),
        )
        .expect_err("single-quoted backslash must not hide a later mutating segment");
        assert_eq!(error.error_class, "bash_permission_required");
        let data = error.data.as_ref().expect("segment split policy data");
        assert_eq!(
            data["segments"][1]["command_name"].as_str(),
            Some("touch")
        );
        assert_eq!(
            data["segments"][1]["reason"].as_str(),
            Some("mutating_command_requires_permission")
        );
        assert!(
            !workspace.join("generated.txt").exists(),
            "permission-required hidden segment must not execute"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_classifies_safe_env_prefixes_without_bypassing_unsafe_env() {
        let workspace = make_temp_workspace("bash-v2-safe-env-prefix");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "NO_COLOR=1 git status --short"
            }),
        )
        .expect("safe env prefix should not hide a read-only command");
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        assert_eq!(
            payload["audit"]["segments"][0]["command_name"].as_str(),
            Some("git")
        );
        assert_eq!(
            payload["audit"]["segments"][0]["risk_class"].as_str(),
            Some("read_only")
        );

        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "PATH=/tmp git status --short"
            }),
        )
        .expect_err("unsafe env prefix should not be stripped for policy matching");
        assert_eq!(error.error_class, "bash_policy_forbidden");
        let data = error.data.as_ref().expect("unsafe env prefix policy data");
        assert_eq!(data["reason"].as_str(), Some("unknown_command_forbidden"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_classifies_safe_wrapper_prefixes_without_bypassing_mutations() {
        let workspace = make_temp_workspace("bash-v2-safe-wrapper-prefix");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for command in [
            "time git status --short",
            "timeout --foreground 5s git status --short",
            "nice -n 5 git status --short",
            "nohup -- git status --short",
            "stdbuf -o0 -eL git status --short",
            "env NO_COLOR=1 -u FOO git status --short",
        ] {
            let payload = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect("safe wrapper prefix should expose read-only command to policy");
            assert_eq!(
                payload["audit"]["segments"][0]["command_name"].as_str(),
                Some("git"),
                "wrapper command should normalize to git: {command}"
            );
            assert_eq!(
                payload["audit"]["segments"][0]["risk_class"].as_str(),
                Some("read_only"),
                "wrapper command should remain read-only: {command}"
            );
        }

        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "nice rm generated.txt"
            }),
        )
        .expect_err("safe wrapper must not hide mutating commands from policy");
        assert_eq!(error.error_class, "bash_permission_required");
        let data = error.data.as_ref().expect("wrapper mutation policy data");
        assert_eq!(
            data["reason"].as_str(),
            Some("mutating_command_requires_permission")
        );
        assert_eq!(data["segments"][0]["command_name"].as_str(), Some("rm"));

        let outside = env::temp_dir().join(format!("grobot-wrapper-outside-{}", process::id()));
        let path_error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!("nice touch {}", outside.to_string_lossy())
            }),
        )
        .expect_err("wrapper must not hide mutating path outside workspace");
        assert_eq!(path_error.error_class, "bash_path_outside_workspace");
        assert!(
            !outside.exists(),
            "forbidden wrapper-hidden mutation must not create outside file"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_keeps_unparseable_wrappers_fail_closed() {
        let workspace = make_temp_workspace("bash-v2-wrapper-fail-closed");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for command in ["timeout --bogus 5s git status", "env -S 'git status'"] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("unparseable wrapper should stay visible and fail closed");
            assert!(
                matches!(
                    error.error_class.as_str(),
                    "bash_policy_forbidden" | "bash_permission_required"
                ),
                "unexpected fail-closed class for {command}: {}",
                error.error_class
            );
            let data = error.data.as_ref().expect("wrapper fail-closed policy data");
            assert!(
                matches!(
                    data["reason"].as_str(),
                    Some("forbidden_command")
                        | Some("unknown_command_forbidden")
                        | Some("high_risk_command_requires_permission")
                ),
                "unexpected fail-closed reason for {command}: {:?}",
                data["reason"]
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_matches_allowlist_after_safe_wrapper_normalization() {
        let workspace = make_temp_workspace("bash-v2-wrapper-allowlist");
        let input = make_bash_input(&workspace, vec!["touch".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "nice touch generated.txt"
            }),
        )
        .expect("safe wrapper should not defeat an explicit allowlist rule");
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        assert_eq!(
            payload["audit"]["segments"][0]["command_name"].as_str(),
            Some("touch")
        );
        assert_eq!(
            payload["audit"]["segments"][0]["matched_rule"].as_str(),
            Some("touch")
        );
        assert!(workspace.join("generated.txt").exists());
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_evaluates_nested_shell_c_scripts_with_same_policy() {
        let workspace = make_temp_workspace("bash-v2-nested-shell-policy");
        let executor = LocalToolExecutor;
        let input_without_inner_permission = make_bash_input(&workspace, vec!["bash".to_string()]);
        let permission_error = execute_tool_payload(
            &executor,
            &input_without_inner_permission,
            "bash",
            json!({
                "command": "bash -lc 'touch generated.txt'"
            }),
        )
        .expect_err("allowlisting bash must not auto-approve the nested mutating script");
        assert_eq!(permission_error.error_class, "bash_permission_required");
        let permission_data = permission_error
            .data
            .as_ref()
            .expect("nested shell permission error data");
        assert_eq!(
            permission_data["reason"].as_str(),
            Some("nested_shell:mutating_command_requires_permission")
        );
        assert!(
            !workspace.join("generated.txt").exists(),
            "permission-required nested shell mutation must not execute"
        );

        let input_with_inner_permission = make_bash_input(&workspace, vec!["touch".to_string()]);
        let payload = execute_tool_payload(
            &executor,
            &input_with_inner_permission,
            "bash",
            json!({
                "command": "bash -lc 'touch generated.txt'"
            }),
        )
        .expect("nested shell should be allowed when the inner command is allowlisted");
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        assert_eq!(
            payload["audit"]["segments"][0]["reason"].as_str(),
            Some("nested_shell:mutating_command_allowlisted")
        );
        assert!(workspace.join("generated.txt").exists());
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_forbidden_commands_inside_nested_shells() {
        let workspace = make_temp_workspace("bash-v2-nested-shell-forbidden");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        for command in [
            "bash -lc 'python3 -c true'",
            "sh -c '/usr/bin/python3 -c true'",
            "timeout 5s bash -lc './node -e true'",
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("nested forbidden executable should stay forbidden");
            assert_eq!(error.error_class, "bash_policy_forbidden");
            let data = error.data.as_ref().expect("nested shell forbidden data");
            assert_eq!(
                data["reason"].as_str(),
                Some("nested_shell:forbidden_command")
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_v2_blocks_workspace_escapes_inside_nested_shells() {
        let workspace = make_temp_workspace("bash-v2-nested-shell-path");
        let outside = env::temp_dir().join(format!(
            "grobot-nested-shell-outside-{}",
            process::id()
        ));
        let input = make_bash_input(&workspace, vec!["touch".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!("bash -lc 'touch {}'", outside.to_string_lossy())
            }),
        )
        .expect_err("nested shell mutating path outside workspace should be forbidden");
        assert_eq!(error.error_class, "bash_path_outside_workspace");
        assert!(
            !outside.exists(),
            "forbidden nested shell path escape must not create outside file"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
