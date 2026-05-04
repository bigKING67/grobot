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
