    #[test]
    fn write_v2_create_without_prior_read_succeeds() {
        let workspace = make_temp_workspace("write-v2-create");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "new-file.txt",
                "content": "hello\nworld\n"
            }),
        )
        .expect("write create should succeed");
        assert_eq!(payload["tool"].as_str(), Some("write"));
        assert_eq!(payload["operation"].as_str(), Some("create"));
        assert_eq!(payload["line_count"].as_u64(), Some(2));
        assert_eq!(payload["line_ending"].as_str(), Some("lf"));
        assert_eq!(payload["bom_written"].as_bool(), Some(false));
        assert_eq!(payload["created_parent_dirs"].as_bool(), Some(false));
        assert_eq!(payload["existed_before"].as_bool(), Some(false));
        assert_eq!(
            fs::read_to_string(workspace.join("new-file.txt")).expect("read created file"),
            "hello\nworld\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
    #[test]
    fn write_v2_reports_bom_crlf_and_created_parent_metadata() {
        let workspace = make_temp_workspace("write-v2-format-meta");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let payload = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "nested/format.txt",
                "content": "\u{FEFF}hello\r\nworld\r\n"
            }),
        )
        .expect("write create should succeed");
        assert_eq!(payload["operation"].as_str(), Some("create"));
        assert_eq!(payload["line_count"].as_u64(), Some(2));
        assert_eq!(payload["line_ending"].as_str(), Some("crlf"));
        assert_eq!(payload["bom_written"].as_bool(), Some(true));
        assert_eq!(payload["created_parent_dirs"].as_bool(), Some(true));
        assert_eq!(
            fs::read_to_string(workspace.join("nested/format.txt")).expect("read created file"),
            "\u{FEFF}hello\r\nworld\r\n"
        );
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_parent_traversal_for_missing_target() {
        let workspace = make_temp_workspace("write-v2-missing-traversal");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "nested/../escape.txt",
                "content": "blocked\n"
            }),
        )
        .expect_err("missing write targets with parent traversal should fail");
        assert_eq!(error.error_class, "path_escape_blocked");
        let data = error.data.as_ref().expect("path traversal error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("path_escape_blocked"));
        assert_eq!(
            data["reason"].as_str(),
            Some("parent_traversal_in_missing_target")
        );
        assert_eq!(data["path"].as_str(), Some("nested/../escape.txt"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_requires_prior_read_for_existing_file() {
        let workspace = make_temp_workspace("write-v2-read-required");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect_err("write without prior read should fail");
        assert_eq!(error.error_class, "write_read_required");
        let data = error.data.as_ref().expect("write read-required error data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("write_read_required")
        );
        assert_eq!(data["path"].as_str(), Some("sample.txt"));
        assert_eq!(data["required_read_scope"].as_str(), Some("full"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_partial_read_for_existing_file() {
        let workspace = make_temp_workspace("write-v2-partial-read");
        fs::write(workspace.join("sample.txt"), "line1\nline2\nline3\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        execute_tool_payload(
            &executor,
            &input,
            "read",
            json!({
                "path": "sample.txt",
                "offset": 2,
                "limit": 1
            }),
        )
        .expect("partial read should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\nline3\n"
            }),
        )
        .expect_err("write after partial read should fail");
        assert_eq!(error.error_class, "write_partial_read_not_allowed");
        let data = error.data.as_ref().expect("write partial-read error data");
        assert_eq!(
            data["diagnostic_kind"].as_str(),
            Some("write_partial_read_not_allowed")
        );
        assert_eq!(data["path"].as_str(), Some("sample.txt"));
        assert_eq!(data["snapshot_full_view"].as_bool(), Some(false));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_stale_target_after_read() {
        let workspace = make_temp_workspace("write-v2-stale");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
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
        fs::write(&target, "line1\nline2-mutated\n").expect("mutate file to stale snapshot");

        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect_err("stale write should fail");
        assert_eq!(error.error_class, "write_stale_target");
        let data = error.data.as_ref().expect("write stale error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("write_stale_target"));
        assert_eq!(data["path"].as_str(), Some("sample.txt"));
        assert!(data["expected_hash"].as_u64().is_some());
        assert!(data["actual_hash"].as_u64().is_some());
        assert_eq!(data["mtime_changed"].as_bool(), Some(true));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_legacy_append_argument() {
        let workspace = make_temp_workspace("write-v2-legacy-append");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "hello\n",
                "append": true
            }),
        )
        .expect_err("legacy append should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_extra_arguments() {
        let workspace = make_temp_workspace("write-v2-extra-args");
        let input = make_read_write_input(&workspace);
        let executor = LocalToolExecutor;
        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "hello\n",
                "unexpected": true
            }),
        )
        .expect_err("extra write arguments should fail");
        assert_eq!(error.error_class, "invalid_tool_arguments");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_rejects_noop_update() {
        let workspace = make_temp_workspace("write-v2-noop");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
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
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nline2\n"
            }),
        )
        .expect_err("noop write should fail");
        assert_eq!(error.error_class, "write_no_changes");
        let data = error.data.as_ref().expect("write noop error data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("write_no_changes"));
        assert_eq!(data["path"].as_str(), Some("sample.txt"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_allows_mtime_drift_when_content_unchanged() {
        let workspace = make_temp_workspace("write-v2-mtime-drift");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
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
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect("write should still succeed when only mtime drifted");
        assert_eq!(payload["operation"].as_str(), Some("update"));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_clears_read_snapshot_after_success() {
        let workspace = make_temp_workspace("write-v2-clear-snapshot");
        let target = workspace.join("sample.txt");
        fs::write(&target, "line1\nline2\n").expect("write sample file");
        let input = make_read_write_input(&workspace);
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
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect("first write should succeed");
        assert_eq!(payload["operation"].as_str(), Some("update"));

        let error = execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2-AGAIN\n"
            }),
        )
        .expect_err("second write without new read should fail");
        assert_eq!(error.error_class, "write_read_required");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn write_v2_clears_edit_snapshot_after_success() {
        let workspace = make_temp_workspace("write-v2-clear-edit-snapshot");
        fs::write(workspace.join("sample.txt"), "line1\nline2\n").expect("write sample file");
        let input = make_read_write_edit_input(&workspace);
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
        execute_tool_payload(
            &executor,
            &input,
            "write",
            json!({
                "path": "sample.txt",
                "content": "line1\nLINE2\n"
            }),
        )
        .expect("write should succeed");
        let error = execute_tool_payload(
            &executor,
            &input,
            "edit",
            json!({
                "path": "sample.txt",
                "edits": [{"old_text": "LINE2\n", "new_text": "line2\n"}]
            }),
        )
        .expect_err("edit should require re-read after write");
        assert_eq!(error.error_class, "edit_read_required");
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn file_snapshot_roundtrip_preserves_hash_and_flags() {
        let workspace = make_temp_workspace("file-snapshot-roundtrip");
        let target = workspace.join("roundtrip.txt");
        let session_key = "test:file-snapshot-roundtrip";
        record_file_read_snapshot(session_key, &target, 123, true, Some(789));

        let snapshot = lookup_file_read_snapshot(session_key, &target).expect("snapshot should exist");
        assert_eq!(snapshot.mtime_ms, 123);
        assert!(snapshot.full_view);
        assert_eq!(snapshot.content_hash, Some(789));

        clear_file_read_snapshot(session_key, &target);
        assert!(
            lookup_file_read_snapshot(session_key, &target).is_none(),
            "snapshot should be cleared"
        );

        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }

    #[test]
    fn file_mutation_lock_reuses_lock_for_same_path() {
        let workspace = make_temp_workspace("file-mutation-lock");
        let target = workspace.join("shared.txt");
        let lock_a = acquire_file_mutation_lock(&target).expect("acquire first lock");
        let lock_b = acquire_file_mutation_lock(&target).expect("acquire second lock");
        assert!(Arc::ptr_eq(&lock_a, &lock_b));
        fs::remove_dir_all(&workspace).expect("cleanup temp workspace");
    }
