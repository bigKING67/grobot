    #[test]
    fn edit_v2_requires_prior_read_in_same_session() {
        let workspace = make_temp_workspace("edit-v2-read-gate");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect_err("edit without read should fail");
        assert_eq!(error.error_class, "edit_read_required");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_stale_target_after_read() {
        let workspace = make_temp_workspace("edit-v2-stale");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2-modified\n").expect("mutate file to stale snapshot");

        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect_err("stale edit should fail");
        assert_eq!(error.error_class, "edit_stale_target");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_allows_mtime_drift_when_content_unchanged() {
        let workspace = make_temp_workspace("edit-v2-mtime-drift");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2\n").expect("rewrite same content to bump mtime");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect("edit should succeed when only mtime drifted");

        assert_eq!(payload["replacements"].as_u64(), Some(1));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "line1\nLINE2\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_partial_read_snapshot_still_uses_mtime_guard() {
        let workspace = make_temp_workspace("edit-v2-partial-read-mtime-guard");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\nline3\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt",
                "offset": 1,
                "limit": 1
            }),
        )
        .expect("partial read should succeed");

        std::thread::sleep(Duration::from_millis(3));
        fs::write(&target, "line1\nline2\nline3\n").expect("rewrite same content to bump mtime");

        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect_err("edit should fail for partial-read snapshot mtime drift");
        assert_eq!(error.error_class, "edit_stale_target");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_matches_all_edits_against_original_baseline() {
        let workspace = make_temp_workspace("edit-v2-original-baseline");
        let target = workspace.join("sample.txt");
        fs::write(&target, "alpha\nfoo\nbar\nomega\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [
                    {"old_text": "foo\n", "new_text": "foo bar\n"},
                    {"old_text": "bar\n", "new_text": "BAR\n"}
                ]
            }),
        )
        .expect("edit should succeed");

        assert_eq!(payload["blocks_requested"].as_u64(), Some(2));
        assert_eq!(payload["replacements"].as_u64(), Some(2));
        assert_eq!(payload["fuzzy_fallback_used"].as_bool(), Some(false));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "alpha\nfoo bar\nBAR\nomega\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_overlapping_ranges() {
        let workspace = make_temp_workspace("edit-v2-overlap");
        fs::write(workspace.join("sample.txt"), "one\ntwo\nthree\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [
                    {"old_text": "one\ntwo\n", "new_text": "ONE\nTWO\n"},
                    {"old_text": "two\nthree\n", "new_text": "TWO\nTHREE\n"}
                ]
            }),
        )
        .expect_err("overlap should fail");
        assert_eq!(error.error_class, "edit_overlap");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_supports_safe_fuzzy_quote_matching() {
        let workspace = make_temp_workspace("edit-v2-fuzzy-quotes");
        let target = workspace.join("sample.js");
        fs::write(&target, "console.log(“hello”);\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.js"
            }),
        )
        .expect("read should succeed");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.js",
                "edits": [{"old_text": "console.log(\"hello\");\n", "new_text": "console.log(\"world\");\n"}]
            }),
        )
        .expect("fuzzy edit should succeed");

        assert_eq!(payload["fuzzy_fallback_used"].as_bool(), Some(true));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "console.log(\"world\");\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_preserves_utf8_bom_and_crlf_endings() {
        let workspace = make_temp_workspace("edit-v2-bom-crlf");
        let target = workspace.join("sample.txt");
        fs::write(&target, "\u{FEFF}first\r\nsecond\r\nthird\r\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");

        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "second\n", "new_text": "SECOND\n"}]
            }),
        )
        .expect("edit should succeed");

        assert_eq!(payload["first_changed_line"].as_u64(), Some(2));
        assert_eq!(payload["line_ending"].as_str(), Some("crlf"));
        assert_eq!(payload["bom_preserved"].as_bool(), Some(true));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "\u{FEFF}first\r\nSECOND\r\nthird\r\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_mixed_line_endings_without_rewriting_file() {
        let workspace = make_temp_workspace("edit-v2-mixed-line-endings");
        let target = workspace.join("mixed.txt");
        let original = "first\r\nsecond\nthird\r\n";
        fs::write(&target, original).expect("write mixed line ending file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;

        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "mixed.txt"
            }),
        )
        .expect("read should succeed");

        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "mixed.txt",
                "edits": [{"old_text": "second\n", "new_text": "SECOND\n"}]
            }),
        )
        .expect_err("edit should reject mixed line endings");
        assert_eq!(error.error_class, "edit_mixed_line_endings_not_supported");
        assert!(
            error.message.contains("use write with exact full file content"),
            "unexpected mixed line endings error: {}",
            error.message
        );
        let data = error.data.as_ref().expect("mixed line ending error data");
        assert_eq!(data["path"].as_str(), Some("mixed.txt"));
        assert_eq!(data["line_ending"].as_str(), Some("mixed"));
        assert_eq!(
            fs::read_to_string(&target).expect("read original file"),
            original
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_legacy_arguments() {
        let workspace = make_temp_workspace("edit-v2-legacy-args");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "old_text": "line2\n",
                "new_text": "LINE2\n",
                "replace_all": false
            }),
        )
        .expect_err("legacy arguments should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_duplicate_candidate_lines() {
        let workspace = make_temp_workspace("edit-v2-duplicate-candidates");
        fs::write(workspace.join("sample.txt"), "same\nmiddle\nsame\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "same\n", "new_text": "SAME\n"}]
            }),
        )
        .expect_err("duplicate match should fail");
        assert_eq!(error.error_class, "edit_match_not_unique");
        assert!(error.message.contains("candidates=line 1: \"same\""));
        assert!(error.message.contains("line 3: \"same\""));
        assert!(error.message.contains("retry with a unique old_text"));
        let data = error.data.as_ref().expect("duplicate match error data");
        assert_eq!(data["path"].as_str(), Some("sample.txt"));
        assert_eq!(data["edit_index"].as_u64(), Some(0));
        assert_eq!(data["match_count"].as_u64(), Some(2));
        assert_eq!(data["match_mode"].as_str(), Some("exact"));
        assert_eq!(
            data["diagnostics"]["diagnostic_kind"].as_str(),
            Some("edit_match_candidates")
        );
        assert_eq!(
            data["diagnostics"]["candidates"][0]["line"].as_u64(),
            Some(1)
        );
        assert_eq!(
            data["diagnostics"]["candidates"][0]["preview"].as_str(),
            Some("same")
        );
        assert_eq!(
            data["diagnostics"]["candidates"][1]["line"].as_u64(),
            Some(3)
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_missing_match_candidate_lines() {
        let workspace = make_temp_workspace("edit-v2-missing-candidates");
        fs::write(
            workspace.join("sample.txt"),
            "alpha_count = 1;\nbeta_count = 2;\n",
        )
        .expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "alpha_count = 99;\n", "new_text": "alpha_count = 2;\n"}]
            }),
        )
        .expect_err("missing match should fail");
        assert_eq!(error.error_class, "edit_not_found");
        assert!(error.message.contains("closest_lines=line 1: \"alpha_count = 1;\""));
        assert!(error.message.contains("retry with exact old_text"));
        let data = error.data.as_ref().expect("missing match error data");
        assert_eq!(data["path"].as_str(), Some("sample.txt"));
        assert_eq!(data["edit_index"].as_u64(), Some(0));
        assert_eq!(
            data["diagnostics"]["diagnostic_kind"].as_str(),
            Some("edit_not_found")
        );
        assert_eq!(
            data["diagnostics"]["closest_lines"][0]["line"].as_u64(),
            Some(1)
        );
        assert_eq!(
            data["diagnostics"]["closest_lines"][0]["preview"].as_str(),
            Some("alpha_count = 1;")
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_lf_metadata_without_bom() {
        let workspace = make_temp_workspace("edit-v2-lf-metadata");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "LINE2\n"}]
            }),
        )
        .expect("edit should succeed");
        assert_eq!(payload["line_ending"].as_str(), Some("lf"));
        assert_eq!(payload["bom_preserved"].as_bool(), Some(false));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_reports_none_line_ending_for_single_line() {
        let workspace = make_temp_workspace("edit-v2-none-line-ending");
        let target = workspace.join("sample.txt");
        fs::write(&target, "single").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let payload = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "single", "new_text": "single-line"}]
            }),
        )
        .expect("edit should succeed");
        assert_eq!(payload["line_ending"].as_str(), Some("none"));
        assert_eq!(
            fs::read_to_string(&target).expect("read edited file"),
            "single-line"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn edit_v2_rejects_noop_replacements() {
        let workspace = make_temp_workspace("edit-v2-noop");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_edit_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt"
            }),
        )
        .expect("read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "line2\n", "new_text": "line2\n"}]
            }),
        )
        .expect_err("noop replacement should fail");
        assert_eq!(error.error_class, "edit_no_changes");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
