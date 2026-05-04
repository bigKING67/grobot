#[derive(Debug, Clone)]
struct ToolContextResolved {
    session_key: String,
    work_dir: PathBuf,
    enabled_tools: HashSet<String>,
    model_visible_tools: HashSet<String>,
    tool_surface_profile: String,
    advanced_tool_schema: bool,
    bash_allowlist: Vec<String>,
}

#[derive(Debug, Clone)]
struct McpServerResolved {
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    enabled: bool,
    source: String,
    ready: bool,
    ready_reason: String,
}

#[derive(Debug, Clone, Default)]
struct McpCallPolicy {
    max_concurrency_per_server: usize,
    max_queue_per_server: usize,
    failure_threshold: usize,
    cooldown_secs: u64,
    latency_sample_limit: usize,
    call_timeout_ms: u64,
    session_idle_ttl_secs: u64,
    allow_tools: Vec<String>,
}

#[derive(Debug, Clone)]
struct McpCallExecution {
    available_tools: Vec<String>,
    is_error: bool,
    content: Value,
    raw_preview: String,
    structured_content_preview: String,
}

#[derive(Debug)]
struct McpSessionHandle {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    available_tools: Vec<String>,
    last_used_epoch_secs: u64,
}

#[derive(Debug, Clone)]
struct McpRuntimeState {
    total_calls: u64,
    success_calls: u64,
    failure_calls: u64,
    retry_calls: u64,
    recovered_calls: u64,
    queued_calls: u64,
    queue_timeout_calls: u64,
    policy_denied_calls: u64,
    gate_rejected_calls: u64,
    timeout_failures: u64,
    transport_failures: u64,
    tool_failures: u64,
    unknown_failures: u64,
    last_latency_ms: f64,
    latency_samples: VecDeque<f64>,
    top_errors: HashMap<String, u64>,
    consecutive_failures: u64,
    circuit_open_until_epoch_secs: u64,
    in_flight: usize,
    queue_waiting: usize,
}

impl Default for McpRuntimeState {
    fn default() -> Self {
        Self {
            total_calls: 0,
            success_calls: 0,
            failure_calls: 0,
            retry_calls: 0,
            recovered_calls: 0,
            queued_calls: 0,
            queue_timeout_calls: 0,
            policy_denied_calls: 0,
            gate_rejected_calls: 0,
            timeout_failures: 0,
            transport_failures: 0,
            tool_failures: 0,
            unknown_failures: 0,
            last_latency_ms: 0.0,
            latency_samples: VecDeque::new(),
            top_errors: HashMap::new(),
            consecutive_failures: 0,
            circuit_open_until_epoch_secs: 0,
            in_flight: 0,
            queue_waiting: 0,
        }
    }
}

#[derive(Debug, Default)]
struct McpRuntimeStore {
    sessions: HashMap<String, McpSessionHandle>,
    states: HashMap<String, McpRuntimeState>,
}

#[derive(Debug, Deserialize, Default)]
struct McpServerRegistryFile {
    #[serde(default)]
    servers: Vec<McpServerFileEntry>,
}

#[derive(Debug, Deserialize, Default)]
struct McpServerFileEntry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    env: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
struct ProjectPolicyConfigFile {
    #[serde(default)]
    tools: ProjectToolsPolicy,
}

#[derive(Debug, Deserialize, Default)]
struct ProjectToolsPolicy {
    #[serde(default)]
    mcp: ProjectMcpPolicy,
    #[serde(default)]
    bash: ProjectBashPolicy,
}

#[derive(Debug, Deserialize, Default)]
struct ProjectMcpPolicy {
    #[serde(default)]
    max_concurrency_per_server: Option<usize>,
    #[serde(default)]
    max_queue_per_server: Option<usize>,
    #[serde(default)]
    failure_threshold: Option<usize>,
    #[serde(default)]
    cooldown_secs: Option<u64>,
    #[serde(default)]
    latency_sample_limit: Option<usize>,
    #[serde(default)]
    call_timeout_ms: Option<u64>,
    #[serde(default)]
    session_idle_ttl_secs: Option<u64>,
    #[serde(default)]
    allow_tools: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ProjectBashPolicy {
    #[serde(default)]
    output_ttl_secs: Option<u64>,
    #[serde(default)]
    output_max_files: Option<usize>,
    #[serde(default)]
    audit_preview_chars: Option<usize>,
    #[serde(default)]
    audit_segment_chars: Option<usize>,
    #[serde(default)]
    audit_redact_secrets: Option<bool>,
}
