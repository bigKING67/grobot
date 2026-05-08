    #[test]
    fn bash_policy_forbids_sed_in_place() {
        let workspace = make_temp_workspace("bash-policy-sed-i");
        fs::write(workspace.join("sample.txt"), "alpha\n").expect("write sample file");
        let input = make_bash_input(&workspace, vec!["sed".to_string()]);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "bash",
            json!({
                "command": "sed -i 's/alpha/beta/' sample.txt"
            }),
        )
        .expect_err("sed -i should be forbidden");
        assert_eq!(error.error_class, "bash_policy_forbidden");
        let data = error.data.as_ref().expect("sed policy error data");
        assert_eq!(data["reason"].as_str(), Some("sed_operation_not_read_only"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_allows_sed_stdout_substitution_without_file_args() {
        let workspace = make_temp_workspace("bash-policy-sed-stdout-substitution");
        let input = make_bash_input(&workspace, Vec::new());
        let executor = LocalToolExecutor;
        for (command, expect_portable_success) in [
            ("printf alpha | sed 's/alpha/beta/g'", true),
            ("printf alpha | sed -e 's/alpha/beta/g'", true),
            ("printf alpha | sed --expression='s/alpha/beta/g'", false),
        ] {
            let payload = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect("stdout-only safe sed substitution should be treated as read-only");
            if expect_portable_success {
                assert_eq!(payload["exit_code"].as_i64(), Some(0));
                assert_eq!(payload["stdout"].as_str(), Some("beta"));
            }
            assert_eq!(payload["audit"]["decision"].as_str(), Some("allow"));
            assert_eq!(
                payload["audit"]["segments"][1]["command_name"].as_str(),
                Some("sed")
            );
            assert_eq!(
                payload["audit"]["segments"][1]["risk_class"].as_str(),
                Some("read_only")
            );
        }
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn bash_policy_forbids_sed_substitution_with_file_args_or_write_exec_flags() {
        let workspace = make_temp_workspace("bash-policy-sed-dangerous-substitution");
        fs::write(workspace.join("sample.txt"), "alpha\n").expect("write sample file");
        let input = make_bash_input(&workspace, vec!["sed".to_string()]);
        let executor = LocalToolExecutor;
        for command in [
            "sed 's/alpha/beta/g' sample.txt",
            "sed 's/alpha/beta/w out.txt'",
            "sed 's/alpha/beta/e'",
            "sed '1w out.txt'",
        ] {
            let error = execute_tool_payload(
                &executor,
                &input,
                "bash",
                json!({
                    "command": command
                }),
            )
            .expect_err("sed writes/exec/file-arg substitutions should require a safer tool path");
            assert_eq!(error.error_class, "bash_policy_forbidden");
            let data = error.data.as_ref().expect("sed dangerous policy data");
            assert_eq!(data["reason"].as_str(), Some("sed_operation_not_read_only"));
        }
        assert!(
            !workspace.join("out.txt").exists(),
            "forbidden sed write command must not create output"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
