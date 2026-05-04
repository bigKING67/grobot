fn runtime_store() -> &'static Mutex<McpRuntimeStore> {
    static STORE: OnceLock<Mutex<McpRuntimeStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(McpRuntimeStore::default()))
}

fn lock_runtime_store(
) -> Result<std::sync::MutexGuard<'static, McpRuntimeStore>, ToolExecutionError> {
    runtime_store()
        .lock()
        .map_err(|_| runtime_state_unavailable_error(
            "failed to lock MCP runtime state",
            "mcp_runtime_store",
            None,
        ))
}

fn current_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn normalize_server_key(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn default_mcp_call_policy() -> McpCallPolicy {
    McpCallPolicy {
        max_concurrency_per_server: DEFAULT_MCP_MAX_CONCURRENCY_PER_SERVER,
        max_queue_per_server: DEFAULT_MCP_MAX_QUEUE_PER_SERVER,
        failure_threshold: DEFAULT_MCP_FAILURE_THRESHOLD,
        cooldown_secs: DEFAULT_MCP_COOLDOWN_SECS,
        latency_sample_limit: DEFAULT_MCP_LATENCY_SAMPLE_LIMIT,
        call_timeout_ms: DEFAULT_MCP_CALL_TIMEOUT_MS,
        session_idle_ttl_secs: DEFAULT_MCP_SESSION_IDLE_TTL_SECS,
        allow_tools: Vec::new(),
    }
}

fn close_mcp_session(session: &mut McpSessionHandle) {
    let _ = session.child.kill();
    let _ = session.child.wait();
}

fn kill_process_by_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .arg("-9")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn run_with_process_timeout<T, F>(
    pid: u32,
    timeout_ms: u64,
    operation_name: &str,
    operation: F,
) -> Result<T, ToolExecutionError>
where
    F: FnOnce() -> Result<T, ToolExecutionError>,
{
    if timeout_ms == 0 {
        return operation();
    }

    let finished = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    let watcher_finished = Arc::clone(&finished);
    let watcher_timed_out = Arc::clone(&timed_out);
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(timeout_ms));
        if !watcher_finished.load(Ordering::SeqCst) {
            watcher_timed_out.store(true, Ordering::SeqCst);
            kill_process_by_pid(pid);
        }
    });

    let result = operation();
    finished.store(true, Ordering::SeqCst);
    if timed_out.load(Ordering::SeqCst) {
        return Err(ToolExecutionError::new(
            "mcp_timeout",
            format!("MCP {operation_name} timed out after {timeout_ms} ms"),
        )
        .with_data(json!({
            "diagnostic_kind": "mcp_timeout",
            "operation": operation_name,
            "timeout_ms": timeout_ms,
            "pid": pid,
            "recovery_hint": "retry with smaller scope, wait for queue pressure to clear, or choose an alternate MCP tool"
        })));
    }
    result
}

fn reap_expired_mcp_sessions(
    store: &mut McpRuntimeStore,
    idle_ttl_secs: u64,
    now_epoch_secs: u64,
) -> usize {
    let ttl = idle_ttl_secs.clamp(MIN_MCP_SESSION_IDLE_TTL_SECS, MAX_MCP_SESSION_IDLE_TTL_SECS);
    let mut stale_keys: Vec<String> = Vec::new();
    for (key, session) in &store.sessions {
        if now_epoch_secs.saturating_sub(session.last_used_epoch_secs) >= ttl {
            stale_keys.push(key.clone());
        }
    }
    let mut reaped = 0_usize;
    for key in stale_keys {
        if let Some(mut session) = store.sessions.remove(&key) {
            close_mcp_session(&mut session);
            reaped = reaped.saturating_add(1);
        }
    }
    reaped
}

fn record_latency_sample(state: &mut McpRuntimeState, sample_ms: f64, sample_limit: usize) {
    let normalized_limit =
        sample_limit.clamp(MIN_MCP_LATENCY_SAMPLE_LIMIT, MAX_MCP_LATENCY_SAMPLE_LIMIT);
    let normalized_sample = normalize_latency_ms(sample_ms);
    state.last_latency_ms = normalized_sample;
    state.latency_samples.push_back(normalized_sample);
    while state.latency_samples.len() > normalized_limit {
        state.latency_samples.pop_front();
    }
}

fn normalize_latency_ms(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return 0.0;
    }
    (value * 1_000.0).round() / 1_000.0
}

fn latency_percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut values = values
        .iter()
        .copied()
        .filter(|sample| sample.is_finite() && *sample >= 0.0)
        .collect::<Vec<f64>>();
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((values.len() as f64) * (percentile / 100.0)).ceil() as usize;
    let index = rank.saturating_sub(1).min(values.len().saturating_sub(1));
    normalize_latency_ms(values[index])
}

fn compute_p95_latency_ms(state: &McpRuntimeState) -> f64 {
    let values = state.latency_samples.iter().copied().collect::<Vec<f64>>();
    latency_percentile(&values, 95.0)
}

fn top_errors_payload(top_errors: &HashMap<String, u64>, limit: usize) -> Vec<Value> {
    let mut entries = top_errors
        .iter()
        .map(|(error, count)| (error.clone(), *count))
        .collect::<Vec<(String, u64)>>();
    entries.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    entries
        .into_iter()
        .take(limit)
        .map(|(error, count)| json!({ "error": error, "count": count }))
        .collect()
}

fn merge_error_buckets(target: &mut HashMap<String, u64>, source: &HashMap<String, u64>) {
    for (error, count) in source {
        let entry = target.entry(error.clone()).or_insert(0);
        *entry = entry.saturating_add(*count);
    }
}

fn mark_runtime_success(state: &mut McpRuntimeState) {
    state.success_calls = state.success_calls.saturating_add(1);
    state.consecutive_failures = 0;
    state.circuit_open_until_epoch_secs = 0;
}

fn mark_runtime_failure_bucket(
    state: &mut McpRuntimeState,
    bucket: &str,
    error_key: &str,
    policy: &McpCallPolicy,
    now_epoch_secs: u64,
) {
    state.failure_calls = state.failure_calls.saturating_add(1);
    match bucket {
        "timeout" => {
            state.timeout_failures = state.timeout_failures.saturating_add(1);
        }
        "transport" => {
            state.transport_failures = state.transport_failures.saturating_add(1);
        }
        "tool" => {
            state.tool_failures = state.tool_failures.saturating_add(1);
        }
        _ => {
            state.unknown_failures = state.unknown_failures.saturating_add(1);
        }
    }
    state.consecutive_failures = state.consecutive_failures.saturating_add(1);
    let error_entry = state.top_errors.entry(error_key.to_string()).or_insert(0);
    *error_entry = error_entry.saturating_add(1);

    let threshold = policy.failure_threshold.max(1) as u64;
    if state.consecutive_failures >= threshold {
        state.circuit_open_until_epoch_secs = now_epoch_secs.saturating_add(policy.cooldown_secs);
    }
}

fn classify_error_bucket(error: &ToolExecutionError) -> &'static str {
    let message = error.message.to_ascii_lowercase();
    if message.contains("timeout") {
        return "timeout";
    }
    match error.error_class.as_str() {
        "mcp_timeout" => "timeout",
        "mcp_tool_not_found" => "tool",
        "mcp_transport_error" | "mcp_protocol_error" | "mcp_rpc_error" | "mcp_spawn_failed" => {
            "transport"
        }
        _ => "unknown",
    }
}

fn is_recoverable_mcp_error(error: &ToolExecutionError) -> bool {
    matches!(
        error.error_class.as_str(),
        "mcp_transport_error" | "mcp_protocol_error" | "mcp_rpc_error" | "mcp_timeout"
    )
}

fn acquire_mcp_server_slot(
    server: &McpServerResolved,
    server_key: &str,
    policy: &McpCallPolicy,
) -> Result<(), ToolExecutionError> {
    let wait_deadline = Instant::now()
        .checked_add(Duration::from_millis(policy.call_timeout_ms))
        .unwrap_or_else(Instant::now);
    let mut queued = false;

    loop {
        let mut store = lock_runtime_store()?;
        let state = store.states.entry(server_key.to_string()).or_default();
        let now_epoch_secs = current_epoch_secs();

        if state.circuit_open_until_epoch_secs > now_epoch_secs {
            if queued {
                state.queue_waiting = state.queue_waiting.saturating_sub(1);
            }
            state.gate_rejected_calls = state.gate_rejected_calls.saturating_add(1);
            return Err(ToolExecutionError::new(
                "mcp_circuit_open",
                format!(
                    "MCP server `{}` circuit open until {}",
                    server.name, state.circuit_open_until_epoch_secs
                ),
            )
            .with_data(mcp_server_gate_error_data(
                "mcp_circuit_open",
                server,
                server_key,
                state,
                policy,
                None,
                "wait for circuit cooldown or choose an alternate server/tool",
            )));
        }

        if state.in_flight < policy.max_concurrency_per_server.max(1) {
            if queued {
                state.queue_waiting = state.queue_waiting.saturating_sub(1);
                state.queued_calls = state.queued_calls.saturating_add(1);
            }
            state.in_flight = state.in_flight.saturating_add(1);
            state.total_calls = state.total_calls.saturating_add(1);
            return Ok(());
        }

        if !queued {
            if policy.max_queue_per_server == 0
                || state.queue_waiting >= policy.max_queue_per_server
            {
                state.gate_rejected_calls = state.gate_rejected_calls.saturating_add(1);
                return Err(ToolExecutionError::new(
                    "mcp_server_busy",
                    format!(
                        "MCP server `{}` queue full (in_flight={}, queue_waiting={}, max_queue={})",
                        server.name, state.in_flight, state.queue_waiting, policy.max_queue_per_server
                    ),
                )
                .with_data(mcp_server_gate_error_data(
                    "mcp_server_busy",
                    server,
                    server_key,
                    state,
                    policy,
                    None,
                    "wait for queue pressure to clear or choose an alternate server/tool",
                )));
            }
            state.queue_waiting = state.queue_waiting.saturating_add(1);
            queued = true;
        }
        drop(store);

        if Instant::now() >= wait_deadline {
            let mut store = lock_runtime_store()?;
            let state = store.states.entry(server_key.to_string()).or_default();
            if queued {
                state.queue_waiting = state.queue_waiting.saturating_sub(1);
                state.queue_timeout_calls = state.queue_timeout_calls.saturating_add(1);
            }
            state.gate_rejected_calls = state.gate_rejected_calls.saturating_add(1);
            return Err(ToolExecutionError::new(
                "mcp_queue_timeout",
                format!(
                    "MCP server `{}` queue wait timed out after {} ms",
                    server.name, policy.call_timeout_ms
                ),
            )
            .with_data(mcp_server_gate_error_data(
                "mcp_queue_timeout",
                server,
                server_key,
                state,
                policy,
                Some(policy.call_timeout_ms),
                "retry later, reduce concurrency, or choose an alternate server/tool",
            )));
        }
        thread::sleep(Duration::from_millis(3));
    }
}

fn aggregate_runtime_summary(
    server_keys: &[String],
    state_snapshots: &HashMap<String, McpRuntimeState>,
) -> Value {
    let mut total_calls = 0_u64;
    let mut success_calls = 0_u64;
    let mut failure_calls = 0_u64;
    let mut retry_calls = 0_u64;
    let mut recovered_calls = 0_u64;
    let mut queued_calls = 0_u64;
    let mut queue_timeout_calls = 0_u64;
    let mut policy_denied_calls = 0_u64;
    let mut gate_rejected_calls = 0_u64;
    let mut timeout_failures = 0_u64;
    let mut transport_failures = 0_u64;
    let mut tool_failures = 0_u64;
    let mut unknown_failures = 0_u64;
    let mut servers_with_circuit_open = 0_u64;
    let mut queue_waiting = 0_u64;
    let mut total_latency_ms = 0.0_f64;
    let mut max_latency_ms = 0.0_f64;
    let mut latency_samples: Vec<f64> = Vec::new();
    let mut merged_errors: HashMap<String, u64> = HashMap::new();
    let now_epoch_secs = current_epoch_secs();

    for key in server_keys {
        if let Some(state) = state_snapshots.get(key) {
            total_calls = total_calls.saturating_add(state.total_calls);
            success_calls = success_calls.saturating_add(state.success_calls);
            failure_calls = failure_calls.saturating_add(state.failure_calls);
            retry_calls = retry_calls.saturating_add(state.retry_calls);
            recovered_calls = recovered_calls.saturating_add(state.recovered_calls);
            queued_calls = queued_calls.saturating_add(state.queued_calls);
            queue_timeout_calls = queue_timeout_calls.saturating_add(state.queue_timeout_calls);
            policy_denied_calls = policy_denied_calls.saturating_add(state.policy_denied_calls);
            gate_rejected_calls = gate_rejected_calls.saturating_add(state.gate_rejected_calls);
            timeout_failures = timeout_failures.saturating_add(state.timeout_failures);
            transport_failures = transport_failures.saturating_add(state.transport_failures);
            tool_failures = tool_failures.saturating_add(state.tool_failures);
            unknown_failures = unknown_failures.saturating_add(state.unknown_failures);
            for sample in &state.latency_samples {
                total_latency_ms += *sample;
                max_latency_ms = max_latency_ms.max(*sample);
                latency_samples.push(*sample);
            }
            merge_error_buckets(&mut merged_errors, &state.top_errors);
            if state.circuit_open_until_epoch_secs > now_epoch_secs {
                servers_with_circuit_open = servers_with_circuit_open.saturating_add(1);
            }
            queue_waiting = queue_waiting.saturating_add(state.queue_waiting as u64);
        }
    }

    let avg_latency_ms = if !latency_samples.is_empty() {
        normalize_latency_ms(total_latency_ms / (latency_samples.len() as f64))
    } else {
        0.0
    };
    let success_rate = if total_calls > 0 {
        ((success_calls as f64) / (total_calls as f64) * 10_000.0).round() / 10_000.0
    } else {
        0.0
    };

    json!({
        "servers_considered": server_keys.len(),
        "servers_with_circuit_open": servers_with_circuit_open,
        "total_calls": total_calls,
        "success_calls": success_calls,
        "failure_calls": failure_calls,
        "retry_calls": retry_calls,
        "recovered_calls": recovered_calls,
        "queued_calls": queued_calls,
        "queue_timeout_calls": queue_timeout_calls,
        "policy_denied_calls": policy_denied_calls,
        "gate_rejected_calls": gate_rejected_calls,
        "timeout_failures": timeout_failures,
        "transport_failures": transport_failures,
        "tool_failures": tool_failures,
        "unknown_failures": unknown_failures,
        "queue_waiting": queue_waiting,
        "success_rate": success_rate,
        "avg_latency_ms": avg_latency_ms,
        "p50_latency_ms": latency_percentile(&latency_samples, 50.0),
        "p95_latency_ms": latency_percentile(&latency_samples, 95.0),
        "max_latency_ms": normalize_latency_ms(max_latency_ms),
        "latency_sample_count": latency_samples.len(),
        "top_errors": top_errors_payload(&merged_errors, 5),
    })
}

fn server_runtime_state_payload(state: &McpRuntimeState) -> Value {
    let now_epoch_secs = current_epoch_secs();
    json!({
        "total_calls": state.total_calls,
        "success_calls": state.success_calls,
        "failure_calls": state.failure_calls,
        "retry_calls": state.retry_calls,
        "recovered_calls": state.recovered_calls,
        "queued_calls": state.queued_calls,
        "queue_timeout_calls": state.queue_timeout_calls,
        "policy_denied_calls": state.policy_denied_calls,
        "gate_rejected_calls": state.gate_rejected_calls,
        "timeout_failures": state.timeout_failures,
        "transport_failures": state.transport_failures,
        "tool_failures": state.tool_failures,
        "unknown_failures": state.unknown_failures,
        "last_latency_ms": state.last_latency_ms,
        "p95_latency_ms": compute_p95_latency_ms(state),
        "latency_sample_count": state.latency_samples.len(),
        "consecutive_failures": state.consecutive_failures,
        "circuit_open_until_epoch_secs": state.circuit_open_until_epoch_secs,
        "circuit_open": state.circuit_open_until_epoch_secs > now_epoch_secs,
        "in_flight": state.in_flight,
        "queue_waiting": state.queue_waiting,
        "top_errors": top_errors_payload(&state.top_errors, 5),
    })
}
