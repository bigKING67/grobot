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
