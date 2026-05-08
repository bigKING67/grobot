    #[test]
    fn bash_policy_allows_read_only_without_allowlist_rule() {
        let workspace = make_temp_workspace("bash-policy-readonly");
        fs::write(workspace.join("sample.txt"), "alpha\nbeta\n").expect("write sample file");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "sed -n '1,2p' sample.txt"
            }),
        )
        .expect("read-only sed should be allowed without allowlist");
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        assert_eq!(
            payload["audit"]["segments"][0]["risk_class"].as_str(),
            Some("read_only")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_requires_permission_for_mutating_command_without_allowlist() {
        let workspace = make_temp_workspace("bash-policy-permission");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "touch new-file.txt"
            }),
        )
        .expect_err("mutating command should require permission");
        assert_eq!(error.error_class, "bash_permission_required");
        let data = error.data.as_ref().expect("permission error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("bash_permission_required"));
        assert_eq!(data["decision"].as_str(), Some("prompt_required"));
        assert_eq!(data["segments"][0]["risk_class"].as_str(), Some("mutating"));
        assert_eq!(
            data["segments"][0]["reason"].as_str(),
            Some("mutating_command_requires_permission")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_dangerous_command_even_when_allowlisted() {
        let workspace = make_temp_workspace("bash-policy-forbidden-command");
        let input = make_bash_input(&workspace, vec!["*".to_string()]);
        let executor = LocalToolExecutor;
        for command in [
            "python3 -c 'print(123)'",
            "/usr/bin/python3 -c 'print(123)'",
            "python3.12 -c 'print(123)'",
            "node -e 'console.log(123)'",
            "./node -e 'console.log(123)'",
            "curl https://example.invalid/",
            "sudo true",
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("dangerous executable should stay forbidden even when allowlisted");
            assert_eq!(error.error_class, "bash_policy_forbidden");
            let data = error.data.as_ref().expect("forbidden command data");
            assert_eq!(data["decision"].as_str(), Some("forbidden"));
            assert_eq!(data["reason"].as_str(), Some("forbidden_command"));
            assert_eq!(
                data["segments"][0]["risk_class"].as_str(),
                Some("high_risk")
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_treats_output_redirection_as_mutation() {
        let workspace = make_temp_workspace("bash-policy-output-redirection");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok > generated.txt"
            }),
        )
        .expect_err("output redirection should require permission");
        assert_eq!(error.error_class, "bash_permission_required");
        let data = error.data.as_ref().expect("permission error data");
        assert_eq!(data["decision"].as_str(), Some("prompt_required"));
        assert_eq!(data["segments"][0]["risk_class"].as_str(), Some("mutating"));
        assert_eq!(
            data["segments"][0]["paths"][0].as_str(),
            Some("generated.txt")
        );
        assert!(
            !workspace.join("generated.txt").exists(),
            "permission-required output redirection must not execute"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_blocks_output_redirection_outside_workspace_even_when_allowlisted() {
        let workspace = make_temp_workspace("bash-policy-output-redirection-outside");
        let outside = env::temp_dir().join(format!(
            "grobot-tools-output-outside-{}",
            process::id()
        ));
        let _ = fs::remove_file(&outside);
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!("printf ok > {}", outside.to_string_lossy())
            }),
        )
        .expect_err("output redirection outside workspace should be forbidden");
        assert_eq!(error.error_class, "bash_path_outside_workspace");
        assert!(
            !outside.exists(),
            "forbidden output redirection must not create outside file"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_allows_fd_stderr_redirection_for_read_only_command() {
        let workspace = make_temp_workspace("bash-policy-fd-redirection");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok 2>&1"
            }),
        )
        .expect("fd redirection should not be treated as file mutation");
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert_eq!(payload["stdout"].as_str(), Some("ok"));
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        assert_eq!(
            payload["audit"]["segments"][0]["risk_class"].as_str(),
            Some("read_only")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_allows_null_device_output_redirection() {
        let workspace = make_temp_workspace("bash-policy-null-device-redirection");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok > /dev/null"
            }),
        )
        .expect("/dev/null output redirection should not require workspace write permission");
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert_eq!(payload["stdout"].as_str(), Some(""));
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        assert_eq!(
            payload["audit"]["segments"][0]["risk_class"].as_str(),
            Some("read_only")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_dynamic_redirection_target() {
        let workspace = make_temp_workspace("bash-policy-dynamic-redirection");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf ok > $TARGET_FILE"
            }),
        )
        .expect_err("dynamic redirection target should be forbidden");
        assert_eq!(error.error_class, "bash_security_denied");
        let data = error.data.as_ref().expect("dynamic redirection error data");
        assert_eq!(
            data["reason"].as_str(),
            Some("shell variable expansion is blocked")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_dot_git_internal_writes_even_when_allowlisted() {
        let workspace = make_temp_workspace("bash-policy-dot-git-write");
        fs::create_dir_all(workspace.join(".git/hooks")).expect("create fake .git hooks dir");
        let input = make_bash_input(&workspace, vec!["printf".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "printf malicious > .git/hooks/pre-commit"
            }),
        )
        .expect_err(".git internal writes should be forbidden even when command is allowlisted");
        assert_eq!(error.error_class, "bash_policy_forbidden");
        let data = error.data.as_ref().expect(".git write policy error data");
        assert_eq!(data["decision"].as_str(), Some("forbidden"));
        assert_eq!(
            data["reason"].as_str(),
            Some("git_internal_write_path:.git/hooks/pre-commit")
        );
        assert!(
            !workspace.join(".git/hooks/pre-commit").exists(),
            "forbidden .git write must not execute"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_bare_git_internal_creation_before_git_command() {
        let workspace = make_temp_workspace("bash-policy-bare-git-write");
        let input = make_bash_input(
            &workspace,
            vec!["mkdir".to_string(), "touch".to_string(), "git".to_string()],
        );
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "mkdir hooks && touch HEAD && git status"
            }),
        )
        .expect_err("creating bare git internals before git should be forbidden");
        assert_eq!(error.error_class, "bash_policy_forbidden");
        let data = error.data.as_ref().expect("bare git policy error data");
        assert_eq!(data["reason"].as_str(), Some("git_internal_write_path:hooks"));
        assert!(
            !workspace.join("hooks").exists(),
            "forbidden bare git internal creation must not execute"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_allows_project_hooks_dir_without_same_command_git() {
        let workspace = make_temp_workspace("bash-policy-project-hooks-dir");
        let input = make_bash_input(&workspace, vec!["mkdir".to_string()]);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "mkdir hooks"
            }),
        )
        .expect("project hooks dir creation without git command should still be allowed");
        assert_eq!(payload["exit_code"].as_i64(), Some(0));
        assert!(workspace.join("hooks").is_dir());
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_find_exec_delete_and_output_predicates() {
        let workspace = make_temp_workspace("bash-policy-find-dangerous");
        let input = make_bash_input(&workspace, vec!["find".to_string()]);
        let executor = LocalToolExecutor;
        for (command, reason) in [
            ("find . -execdir printf x \\;", "find_exec_predicate"),
            ("find . -delete", "find_delete_predicate"),
            ("find . -fprint out.txt", "find_output_predicate"),
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("dangerous find predicate should be forbidden");
            assert_eq!(error.error_class, "bash_policy_forbidden");
            let data = error.data.as_ref().expect("find policy error data");
            assert_eq!(data["reason"].as_str(), Some(reason));
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_git_execution_escape_flags() {
        let workspace = make_temp_workspace("bash-policy-git-escape-flags");
        let pager_target = workspace.join("pager-target.txt");
        let input = make_bash_input(&workspace, vec!["git".to_string()]);
        let executor = LocalToolExecutor;
        for (command, reason) in [
            (
                "git -c core.fsmonitor=touch status".to_string(),
                "git_config_flag",
            ),
            (
                format!("git -p status > {}", pager_target.to_string_lossy()),
                "git_pager_flag",
            ),
            ("git -p status".to_string(), "git_pager_flag"),
            ("git --paginate status".to_string(), "git_pager_flag"),
            ("git --exec-path=/tmp status".to_string(), "git_exec_path_flag"),
            (
                "git --config-env=core.fsmonitor=EVIL status".to_string(),
                "git_config_env_flag",
            ),
            ("git --git-dir=/tmp/.git status".to_string(), "git_dir_flag"),
            ("git --work-tree=/tmp status".to_string(), "git_work_tree_flag"),
            ("git diff --ext-diff".to_string(), "git_ext_diff_flag"),
            ("git diff --output=out.patch".to_string(), "git_output_flag"),
            (
                "git diff -S -- --output=out.patch".to_string(),
                "git_output_flag",
            ),
            ("git show --textconv HEAD:path".to_string(), "git_textconv_flag"),
            (
                "git grep -Ovim pattern".to_string(),
                "git_open_files_in_pager_flag",
            ),
            (
                "git grep --open-files-in-pager=vim pattern".to_string(),
                "git_open_files_in_pager_flag",
            ),
            (
                "git ls-remote --upload-pack=touch origin".to_string(),
                "git_upload_pack_flag",
            ),
            ("git ls-remote --up=touch origin".to_string(), "git_upload_pack_flag"),
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("dangerous git escape flag should be forbidden");
            assert_eq!(error.error_class, "bash_policy_forbidden");
            let data = error.data.as_ref().expect("git policy error data");
            assert_eq!(data["reason"].as_str(), Some(reason));
        }
        assert!(
            !pager_target.exists(),
            "forbidden git pager command must not execute or create redirected output"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_allows_git_subcommand_flags_that_overlap_global_flags() {
        let workspace = make_temp_workspace("bash-policy-git-subcommand-flags");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for command in [
            "git diff -p",
            "git grep -c pattern",
            "git rev-parse --git-dir",
        ] {
            let payload = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect("subcommand-local read-only git flags should not be confused with global escapes");
            assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
            assert_eq!(
                payload["audit"]["segments"][0]["risk_class"].as_str(),
                Some("read_only")
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_validates_git_global_c_directory() {
        let workspace = make_temp_workspace("bash-policy-git-global-c");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "git -C . status --short"
            }),
        )
        .expect("workspace-contained git -C should be allowed");
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        assert_eq!(
            payload["audit"]["segments"][0]["risk_class"].as_str(),
            Some("read_only")
        );

        let outside = env::temp_dir();
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!("git -C {} status --short", outside.to_string_lossy())
            }),
        )
        .expect_err("git -C outside workspace should be forbidden");
        assert_eq!(error.error_class, "bash_path_outside_workspace");
        let data = error.data.as_ref().expect("git -C policy error data");
        assert_eq!(data["reason"].as_str(), Some("path_outside_workspace"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_git_ls_remote_remote_specs() {
        let workspace = make_temp_workspace("bash-policy-git-ls-remote");
        let input = make_bash_input(&workspace, vec!["git".to_string()]);
        let executor = LocalToolExecutor;
        for command in [
            "git ls-remote https://example.invalid/repo.git",
            "git ls-remote git@example.invalid:owner/repo.git",
            "git ls-remote ../repo",
            "git ls-remote --server-option=secret origin",
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("remote/network-style ls-remote should be forbidden");
            assert_eq!(error.error_class, "bash_policy_forbidden");
            let data = error.data.as_ref().expect("git ls-remote policy error data");
            assert!(
                matches!(
                    data["reason"].as_str(),
                    Some("git_ls_remote_remote_spec")
                        | Some("git_ls_remote_server_option_flag")
                ),
                "unexpected reason for {command}: {:?}",
                data["reason"]
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_git_diff_no_index_outside_workspace() {
        let workspace = make_temp_workspace("bash-policy-git-no-index-outside");
        let outside = env::temp_dir().join(format!(
            "grobot-tools-git-no-index-outside-{}",
            process::id()
        ));
        fs::write(workspace.join("inside.txt"), "inside\n").expect("write inside file");
        fs::write(&outside, "outside\n").expect("write outside file");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!("git diff --no-index {} inside.txt", outside.to_string_lossy())
            }),
        )
        .expect_err("git diff --no-index outside workspace should be forbidden");
        assert_eq!(error.error_class, "bash_path_outside_workspace");
        let data = error.data.as_ref().expect("git no-index path error data");
        assert_eq!(data["reason"].as_str(), Some("path_outside_workspace"));
        let _ = fs::remove_file(outside);
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_checks_both_git_diff_no_index_paths_with_global_c() {
        let workspace = make_temp_workspace("bash-policy-git-no-index-global-c");
        let outside = env::temp_dir().join(format!(
            "grobot-tools-git-no-index-global-c-outside-{}",
            process::id()
        ));
        fs::write(workspace.join("inside.txt"), "inside\n").expect("write inside file");
        fs::write(&outside, "outside\n").expect("write outside file");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!(
                    "git -C . diff --no-index inside.txt {}",
                    outside.to_string_lossy()
                )
            }),
        )
        .expect_err("git -C diff --no-index must validate both compared paths");
        assert_eq!(error.error_class, "bash_path_outside_workspace");
        let data = error.data.as_ref().expect("git no-index global -C path error data");
        assert_eq!(data["reason"].as_str(), Some("path_outside_workspace"));
        let _ = fs::remove_file(outside);
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_allows_git_diff_no_index_inside_workspace() {
        let workspace = make_temp_workspace("bash-policy-git-no-index-inside");
        fs::write(workspace.join("left.txt"), "left\n").expect("write left file");
        fs::write(workspace.join("right.txt"), "right\n").expect("write right file");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "git diff --no-index left.txt right.txt"
            }),
        )
        .expect("workspace-contained git diff --no-index should be allowed");
        assert_eq!(payload["exit_code"].as_i64(), Some(1));
        assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_treats_git_branch_tag_and_remote_mutations_as_permission_required() {
        let workspace = make_temp_workspace("bash-policy-git-subcommand-mutating");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for command in [
            "git branch new-branch",
            "git tag v0-test",
            "git remote add origin https://example.invalid/repo.git",
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("mutating git subcommand should require permission");
            assert_eq!(error.error_class, "bash_permission_required");
            let data = error.data.as_ref().expect("git mutating policy data");
            assert_eq!(data["decision"].as_str(), Some("prompt_required"));
            assert_eq!(data["segments"][0]["risk_class"].as_str(), Some("mutating"));
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_allows_git_branch_tag_and_remote_read_only_forms() {
        let workspace = make_temp_workspace("bash-policy-git-subcommand-readonly");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for command in [
            "git branch --list main",
            "git tag --list 'v*'",
            "git remote -v",
            "git remote show -n origin",
        ] {
            let payload = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect("read-only git subcommand form should be allowed without allowlist");
            assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
            assert_eq!(
                payload["audit"]["segments"][0]["risk_class"].as_str(),
                Some("read_only")
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_pattern_file_preprocessor_and_sort_output_flags() {
        let workspace = make_temp_workspace("bash-policy-preprocessor-output");
        let executor = LocalToolExecutor;
        let grep_input = make_bash_input(&workspace, vec!["grep".to_string()]);
        let grep_error = execute_tool_payload(
            &executor,
            &grep_input,
            "bash",
            json!({
                "command": "grep -f patterns.txt input.txt"
            }),
        )
        .expect_err("grep -f reads dynamic pattern files and should be forbidden");
        assert_eq!(grep_error.error_class, "bash_policy_forbidden");
        let grep_data = grep_error.data.as_ref().expect("grep policy error data");
        assert_eq!(grep_data["reason"].as_str(), Some("pattern_file_flag"));

        let rg_input = make_bash_input(&workspace, vec!["rg".to_string()]);
        let rg_error = execute_tool_payload(
            &executor,
            &rg_input,
            "bash",
            json!({
                "command": "rg --pre bash needle ."
            }),
        )
        .expect_err("rg preprocessor can execute commands and should be forbidden");
        assert_eq!(rg_error.error_class, "bash_policy_forbidden");
        let rg_data = rg_error.data.as_ref().expect("rg policy error data");
        assert_eq!(rg_data["reason"].as_str(), Some("rg_preprocessor_flag"));

        let rg_ignore_error = execute_tool_payload(
            &executor,
            &rg_input,
            "bash",
            json!({
                "command": "rg --ignore-file custom.ignore needle ."
            }),
        )
        .expect_err("rg --ignore-file reads a policy file and should be forbidden");
        assert_eq!(rg_ignore_error.error_class, "bash_policy_forbidden");
        let rg_ignore_data = rg_ignore_error.data.as_ref().expect("rg ignore policy error data");
        assert_eq!(
            rg_ignore_data["reason"].as_str(),
            Some("rg_ignore_file_flag")
        );

        let sort_input = make_bash_input(&workspace, vec!["sort".to_string()]);
        fs::write(workspace.join("input.txt"), "b\na\n").expect("write sort input");
        let sort_error = execute_tool_payload(
            &executor,
            &sort_input,
            "bash",
            json!({
                "command": "sort -o sorted.txt input.txt"
            }),
        )
        .expect_err("sort -o writes files and should be forbidden");
        assert_eq!(sort_error.error_class, "bash_policy_forbidden");
        let sort_data = sort_error.data.as_ref().expect("sort policy error data");
        assert_eq!(sort_data["reason"].as_str(), Some("sort_output_flag"));
        assert!(
            !workspace.join("sorted.txt").exists(),
            "forbidden sort -o must not create output"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_dangerous_removal_even_when_allowlisted() {
        let workspace = make_temp_workspace("bash-policy-dangerous-rm");
        let input = make_bash_input(&workspace, vec!["rm".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "rm -rf /"
            }),
        )
        .expect_err("dangerous rm should never be allowlisted");
        assert_eq!(error.error_class, "bash_dangerous_path");
        let data = error.data.as_ref().expect("dangerous path error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("bash_dangerous_path"));
        assert_eq!(data["decision"].as_str(), Some("forbidden"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_workspace_escape_for_mutating_path() {
        let workspace = make_temp_workspace("bash-policy-path-escape");
        let outside = env::temp_dir().join(format!("grobot-tools-outside-{}", process::id()));
        let input = make_bash_input(&workspace, vec!["touch".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!("touch {}", outside.to_string_lossy())
            }),
        )
        .expect_err("mutating path outside workspace should be forbidden");
        assert_eq!(error.error_class, "bash_path_outside_workspace");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_checks_quoted_glob_like_literal_paths() {
        let workspace = make_temp_workspace("bash-policy-quoted-glob-path");
        let outside_dir = env::temp_dir().join(format!(
            "grobot-tools-quoted-glob-outside-{}",
            process::id()
        ));
        fs::create_dir_all(&outside_dir).expect("create outside dir");
        let outside = outside_dir.join("literal*.txt");
        let input = make_bash_input(&workspace, vec!["touch".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": format!("touch '{}'", outside.to_string_lossy())
            }),
        )
        .expect_err("quoted glob-like literal path outside workspace should be checked");
        assert_eq!(error.error_class, "bash_path_outside_workspace");
        let data = error.data.as_ref().expect("quoted glob path policy data");
        assert_eq!(data["reason"].as_str(), Some("path_outside_workspace"));
        assert!(
            !outside.exists(),
            "forbidden quoted glob-like path must not be created"
        );
        let _ = fs::remove_dir_all(outside_dir);
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
