    #[test]
    fn aggregate_runtime_summary_reports_expected_fields() {
        let now_epoch_secs = current_epoch_secs();
        let mut state_a = McpRuntimeState::default();
        state_a.total_calls = 2;
        state_a.success_calls = 1;
        state_a.failure_calls = 1;
        state_a.timeout_failures = 1;
        state_a.retry_calls = 1;
        state_a.latency_samples = VecDeque::from(vec![10.0, 20.0]);
        state_a
            .top_errors
            .insert("json-rpc read timeout".to_string(), 1);
        state_a.circuit_open_until_epoch_secs = now_epoch_secs.saturating_add(20);

        let mut state_b = McpRuntimeState::default();
        state_b.total_calls = 1;
        state_b.success_calls = 1;
        state_b.failure_calls = 0;
        state_b.policy_denied_calls = 1;
        state_b.latency_samples = VecDeque::from(vec![15.0]);
        state_b
            .top_errors
            .insert("json-rpc read timeout".to_string(), 2);

        let mut snapshots: HashMap<String, McpRuntimeState> = HashMap::new();
        snapshots.insert("a".to_string(), state_a);
        snapshots.insert("b".to_string(), state_b);

        let server_keys = vec!["a".to_string(), "b".to_string()];
        let summary = aggregate_runtime_summary(&server_keys, &snapshots);
        assert_eq!(summary["servers_considered"].as_u64(), Some(2));
        assert_eq!(summary["servers_with_circuit_open"].as_u64(), Some(1));
        assert_eq!(summary["total_calls"].as_u64(), Some(3));
        assert_eq!(summary["success_calls"].as_u64(), Some(2));
        assert_eq!(summary["failure_calls"].as_u64(), Some(1));
        assert_eq!(summary["retry_calls"].as_u64(), Some(1));
        assert_eq!(summary["policy_denied_calls"].as_u64(), Some(1));
        assert_eq!(summary["timeout_failures"].as_u64(), Some(1));
        assert_eq!(summary["latency_sample_count"].as_u64(), Some(3));
        assert_eq!(summary["success_rate"].as_f64(), Some(0.6667));
        let top_errors = summary["top_errors"]
            .as_array()
            .expect("top_errors should be an array");
        assert!(!top_errors.is_empty());
        assert_eq!(
            top_errors[0]["error"].as_str(),
            Some("json-rpc read timeout")
        );
        assert_eq!(top_errors[0]["count"].as_u64(), Some(3));
    }

    #[test]
    fn mcp_timeout_is_recoverable_and_bucketed_as_timeout() {
        let error = ToolExecutionError::new("mcp_timeout", "MCP tools/call timed out after 100 ms");
        assert_eq!(classify_error_bucket(&error), "timeout");
        assert!(is_recoverable_mcp_error(&error));

        let timeout_error = run_with_process_timeout(0, 5, "tools/call", || {
            thread::sleep(Duration::from_millis(20));
            Ok::<(), ToolExecutionError>(())
        })
        .expect_err("timeout wrapper should surface mcp_timeout");
        assert_eq!(timeout_error.error_class, "mcp_timeout");
        let data = timeout_error.data.expect("timeout should include structured data");
        assert_eq!(data["diagnostic_kind"].as_str(), Some("mcp_timeout"));
        assert_eq!(data["operation"].as_str(), Some("tools/call"));
        assert_eq!(data["timeout_ms"].as_u64(), Some(5));
        assert_eq!(data["pid"].as_u64(), Some(0));
    }
