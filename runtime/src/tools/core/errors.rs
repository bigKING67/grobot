#[derive(Debug, Clone)]
pub struct ToolCallInput {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone)]
pub struct ToolCallOutput {
    pub content: String,
    pub observed_error: Option<ToolExecutionError>,
}

impl ToolCallOutput {
    pub fn from_content(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            observed_error: None,
        }
    }

    fn from_payload(payload: Value) -> Self {
        let content = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
        Self::from_content(content)
    }

    pub(crate) fn with_observed_error(mut self, error: ToolExecutionError) -> Self {
        self.observed_error = Some(error);
        self
    }
}

#[derive(Debug, Clone)]
pub struct ToolExecutionError {
    pub error_class: String,
    pub message: String,
    pub data: Option<Value>,
}

impl ToolExecutionError {
    pub fn new(error_class: &str, message: impl Into<String>) -> Self {
        Self {
            error_class: error_class.to_string(),
            message: message.into(),
            data: None,
        }
    }

    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

fn redact_tool_preview_secrets(raw: &str) -> String {
    static KV_SECRET_RE: OnceLock<regex::Regex> = OnceLock::new();
    static BEARER_RE: OnceLock<regex::Regex> = OnceLock::new();
    static KEY_PREFIX_RE: OnceLock<regex::Regex> = OnceLock::new();

    let kv_re = KV_SECRET_RE.get_or_init(|| {
        RegexBuilder::new(
            r#"(?ix)
\b(api[_-]?key|token|secret|password|passwd|authorization)\b
\s*([:=])\s*
(?:
    "(?:[^"\\]|\\.)*" |
    '(?:[^'\\]|\\.)*' |
    [^\s"'`]+
)
"#,
        )
        .build()
        .expect("compile tool preview kv redaction regex")
    });
    let bearer_re = BEARER_RE.get_or_init(|| {
        RegexBuilder::new(r#"(?i)\bbearer\s+[A-Za-z0-9._\-]{8,}"#)
            .build()
            .expect("compile tool preview bearer redaction regex")
    });
    let key_prefix_re = KEY_PREFIX_RE.get_or_init(|| {
        RegexBuilder::new(r#"\b(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9\-]{10,})\b"#)
            .build()
            .expect("compile tool preview key-prefix redaction regex")
    });

    let replaced = kv_re
        .replace_all(raw, |captures: &regex::Captures| {
            format!("{}{}<redacted>", &captures[1], &captures[2])
        })
        .to_string();
    let replaced = bearer_re
        .replace_all(replaced.as_str(), "Bearer <redacted>")
        .to_string();
    key_prefix_re
        .replace_all(replaced.as_str(), "<redacted>")
        .to_string()
}

fn runtime_environment_error_data(
    diagnostic_kind: &str,
    recovery_hint: &str,
    source: &str,
    work_dir: Option<&str>,
) -> Value {
    let mut data = Map::new();
    data.insert("diagnostic_kind".to_string(), json!(diagnostic_kind));
    data.insert("recovery_hint".to_string(), json!(recovery_hint));
    data.insert("source".to_string(), json!(source));
    if let Some(value) = work_dir.map(str::trim).filter(|value| !value.is_empty()) {
        data.insert("work_dir".to_string(), json!(value));
    }
    Value::Object(data)
}

fn runtime_environment_error(
    error_class: &str,
    message: impl Into<String>,
    diagnostic_kind: &str,
    recovery_hint: &str,
    source: &str,
    work_dir: Option<&str>,
) -> ToolExecutionError {
    ToolExecutionError::new(error_class, message).with_data(runtime_environment_error_data(
        diagnostic_kind,
        recovery_hint,
        source,
        work_dir,
    ))
}

fn runtime_state_unavailable_error(
    message: impl Into<String>,
    source: &str,
    work_dir: Option<&str>,
) -> ToolExecutionError {
    runtime_environment_error(
        "runtime_state_unavailable",
        message,
        "runtime_state_unavailable",
        "inspect runtime state with grobot status --json; restart the current session if state remains unavailable",
        source,
        work_dir,
    )
}

fn config_missing_error_data(required_config: &str, recovery_hint: &str, source: &str) -> Value {
    let mut data = Map::new();
    data.insert("diagnostic_kind".to_string(), json!("config_missing"));
    data.insert("required_config".to_string(), json!(required_config));
    data.insert("recovery_hint".to_string(), json!(recovery_hint));
    data.insert("source".to_string(), json!(source));
    Value::Object(data)
}

fn config_missing_tool_error(
    message: impl Into<String>,
    required_config: &str,
    source: &str,
) -> ToolExecutionError {
    ToolExecutionError::new("config_missing", message).with_data(config_missing_error_data(
        required_config,
        "provide the missing runtime configuration or switch provider/tool path, then run grobot status --probe --json before retrying",
        source,
    ))
}

fn path_resolution_error_data(
    raw_path: &str,
    candidate: Option<&Path>,
    allow_missing_leaf: bool,
    diagnostic_kind: &str,
    reason: &str,
) -> Value {
    let mut data = Map::new();
    let recovery_hint = match diagnostic_kind {
        "path_not_found" => "use glob to locate the path before retrying",
        "path_escape_blocked" => "choose a workspace-contained relative path and retry",
        "path_invalid" => "choose an existing regular file path or a safe missing leaf",
        _ => "choose a valid workspace-contained path and retry",
    };
    data.insert("diagnostic_kind".to_string(), json!(diagnostic_kind));
    data.insert("path".to_string(), json!(raw_path));
    data.insert("allow_missing_leaf".to_string(), json!(allow_missing_leaf));
    data.insert("reason".to_string(), json!(reason));
    data.insert("recovery_hint".to_string(), json!(recovery_hint));
    if let Some(candidate_path) = candidate {
        data.insert(
            "candidate_path".to_string(),
            json!(candidate_path.to_string_lossy().to_string()),
        );
    }
    Value::Object(data)
}

fn mcp_server_gate_error_data(
    diagnostic_kind: &str,
    server: &McpServerResolved,
    server_key: &str,
    state: &McpRuntimeState,
    policy: &McpCallPolicy,
    timeout_ms: Option<u64>,
    recovery_hint: &str,
) -> Value {
    let mut data = Map::new();
    data.insert("diagnostic_kind".to_string(), json!(diagnostic_kind));
    data.insert("server".to_string(), json!(server.name.as_str()));
    data.insert("server_key".to_string(), json!(server_key));
    data.insert("in_flight".to_string(), json!(state.in_flight));
    data.insert("queue_waiting".to_string(), json!(state.queue_waiting));
    data.insert(
        "max_concurrency_per_server".to_string(),
        json!(policy.max_concurrency_per_server),
    );
    data.insert(
        "max_queue_per_server".to_string(),
        json!(policy.max_queue_per_server),
    );
    data.insert(
        "circuit_open_until_epoch_secs".to_string(),
        json!(state.circuit_open_until_epoch_secs),
    );
    data.insert("cooldown_secs".to_string(), json!(policy.cooldown_secs));
    data.insert(
        "consecutive_failures".to_string(),
        json!(state.consecutive_failures),
    );
    data.insert("recovery_hint".to_string(), json!(recovery_hint));
    if let Some(timeout_ms) = timeout_ms {
        data.insert("timeout_ms".to_string(), json!(timeout_ms));
    }
    Value::Object(data)
}
