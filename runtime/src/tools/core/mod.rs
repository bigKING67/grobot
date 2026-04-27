const TOOL_LIST: &str = "list";
const TOOL_GLOB: &str = "glob";
const TOOL_SEARCH: &str = "search";
const TOOL_READ: &str = "read";
const TOOL_WRITE: &str = "write";
const TOOL_EDIT: &str = "edit";
const TOOL_BASH: &str = "bash";
const TOOL_MCP_SERVERS: &str = "mcp_servers";
const TOOL_MCP_CALL: &str = "mcp_call";
const TOOL_WEB_SCAN: &str = "web_scan";
const TOOL_WEB_EXECUTE_JS: &str = "web_execute_js";
const TOOL_SEMANTIC_SEARCH: &str = "semantic_search";
const TOOL_PROMPT_ENHANCER: &str = "prompt_enhancer";
const TOOL_ASK_USER: &str = "ask_user";
const TOOL_ASK_USER_LEGACY: &str = "ask_user_question";

const TOOL_SURFACE_POLICY_VERSION: &str = "v1";
const TOOL_SURFACE_MINIMAL: &str = "minimal";
const TOOL_SURFACE_CODING: &str = "coding";
const TOOL_SURFACE_BROWSER: &str = "browser";
const TOOL_SURFACE_BROWSER_ADVANCED: &str = "browser_advanced";
const TOOL_SURFACE_CONTEXT: &str = "context";
const TOOL_SURFACE_MCP: &str = "mcp";
const TOOL_SURFACE_FULL_DEBUG: &str = "full_debug";

const DEFAULT_MAX_RESULTS: usize = 50;
const MAX_RESULTS_LIMIT: usize = 1_000;
const DEFAULT_MAX_ENTRIES: usize = 200;
const MAX_ENTRIES_LIMIT: usize = 5_000;
const MAX_SEARCH_CONTEXT_LINES: usize = 16;

const DEFAULT_MCP_MAX_CONCURRENCY_PER_SERVER: usize = 1;
const MIN_MCP_MAX_CONCURRENCY_PER_SERVER: usize = 1;
const MAX_MCP_MAX_CONCURRENCY_PER_SERVER: usize = 64;
const DEFAULT_MCP_MAX_QUEUE_PER_SERVER: usize = 16;
const MIN_MCP_MAX_QUEUE_PER_SERVER: usize = 0;
const MAX_MCP_MAX_QUEUE_PER_SERVER: usize = 4_096;
const DEFAULT_MCP_FAILURE_THRESHOLD: usize = 3;
const MIN_MCP_FAILURE_THRESHOLD: usize = 1;
const MAX_MCP_FAILURE_THRESHOLD: usize = 64;
const DEFAULT_MCP_COOLDOWN_SECS: u64 = 20;
const MIN_MCP_COOLDOWN_SECS: u64 = 1;
const MAX_MCP_COOLDOWN_SECS: u64 = 3_600;
const DEFAULT_MCP_LATENCY_SAMPLE_LIMIT: usize = 256;
const MIN_MCP_LATENCY_SAMPLE_LIMIT: usize = 16;
const MAX_MCP_LATENCY_SAMPLE_LIMIT: usize = 1024;
const DEFAULT_MCP_CALL_TIMEOUT_MS: u64 = 8_000;
const MIN_MCP_CALL_TIMEOUT_MS: u64 = 100;
const MAX_MCP_CALL_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MCP_SESSION_IDLE_TTL_SECS: u64 = 300;
const MIN_MCP_SESSION_IDLE_TTL_SECS: u64 = 10;
const MAX_MCP_SESSION_IDLE_TTL_SECS: u64 = 86_400;

#[derive(Debug, Clone)]
pub(crate) struct LocalToolCatalogEntry {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
    pub default_enabled: bool,
}

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
    ToolExecutionError::new(error_class, message)
        .with_data(runtime_environment_error_data(
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

pub trait ToolExecutor {
    fn before_turn(&self, _input: &TurnExecuteInput) {}

    fn after_turn(&self, _input: &TurnExecuteInput) {}

    fn execute_tool_call(
        &self,
        call: &ToolCallInput,
        _input: &TurnExecuteInput,
    ) -> Result<ToolCallOutput, ToolExecutionError> {
        Err(ToolExecutionError::new(
            "tool_call_not_supported",
            format!("runtime v1 does not support tool calls yet: {}", call.name),
        ))
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct LocalToolExecutor;

fn command_available(name: &str) -> bool {
    let normalized = name.trim();
    if normalized.is_empty() {
        return false;
    }
    static COMMAND_CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = COMMAND_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(normalized).copied() {
            return value;
        }
    }
    let available = Command::new(normalized)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(normalized.to_string(), available);
    }
    available
}

fn normalize_tool_name(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

pub(crate) fn local_tool_catalog() -> Vec<LocalToolCatalogEntry> {
    vec![
        LocalToolCatalogEntry {
            name: TOOL_LIST,
            description: "List files/directories under workspace",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "minLength": 1 },
                    "recursive": { "type": "boolean" },
                    "max_entries": { "type": "integer", "minimum": 1, "maximum": MAX_ENTRIES_LIMIT }
                },
                "additionalProperties": false
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_GLOB,
            description: "Find workspace paths by glob pattern. Prefer this for filename/path lookup questions.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "minLength": 1 },
                    "path": { "type": "string", "minLength": 1 },
                    "max_entries": { "type": "integer", "minimum": 1, "maximum": MAX_ENTRIES_LIMIT }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_SEARCH,
            description: "Literal lexical content search in workspace files (grep/rg style). Prefer for exact strings, symbols, errors, or scoped paths; this is not a filename finder.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "minLength": 1 },
                    "path": { "type": "string", "minLength": 1 },
                    "fixed": { "type": "boolean" },
                    "regex": { "type": "boolean" },
                    "case_sensitive": { "type": "boolean" },
                    "context_before": { "type": "integer", "minimum": 0, "maximum": MAX_SEARCH_CONTEXT_LINES },
                    "context_after": { "type": "integer", "minimum": 0, "maximum": MAX_SEARCH_CONTEXT_LINES },
                    "max_results": { "type": "integer", "minimum": 1, "maximum": MAX_RESULTS_LIMIT }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_READ,
            description: "Read file content",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "line_start": { "type": "integer" },
                    "line_end": { "type": "integer" },
                    "offset": { "type": "integer" },
                    "limit": { "type": "integer" },
                    "pages": { "type": "string" },
                    "include_metadata": { "type": "boolean" }
                },
                "required": ["path"]
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_WRITE,
            description: "Create or fully rewrite a text file. Existing files require a prior full read in the same session and stale targets are rejected.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_EDIT,
            description: "Apply one or more targeted text replacements in a text file. Requires a prior read in the same session and rejects stale targets.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_text": { "type": "string" },
                                "new_text": { "type": "string" }
                            },
                            "required": ["old_text", "new_text"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["path", "edits"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_BASH,
            description: "Run an allowlisted shell command with timeout and output truncation safeguards",
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_BASH_COMMAND_CHARS
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "minimum": MIN_BASH_TIMEOUT_MS,
                        "maximum": MAX_BASH_TIMEOUT_MS
                    },
                    "max_output_bytes": {
                        "type": "integer",
                        "minimum": MIN_BASH_MAX_OUTPUT_BYTES,
                        "maximum": MAX_BASH_MAX_OUTPUT_BYTES
                    },
                    "max_output_lines": {
                        "type": "integer",
                        "minimum": MIN_BASH_MAX_OUTPUT_LINES,
                        "maximum": MAX_BASH_MAX_OUTPUT_LINES
                    }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_MCP_SERVERS,
            description: "List MCP servers merged from global/project registry",
            parameters: json!({
                "type": "object",
                "properties": {
                    "ready_only": { "type": "boolean" },
                    "include_disabled": { "type": "boolean" }
                }
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_MCP_CALL,
            description: "Call one MCP tool via stdio",
            parameters: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "tool": { "type": "string" },
                    "arguments": { "type": "object" }
                },
                "required": ["server", "tool"]
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_WEB_SCAN,
            description: "Scan the user's real browser via TMWD by default. Use this as the primary browser reading tool for tabs, current page text, logged-in pages, and session-aware page inspection. Use tmwd_mode=remote_cdp only for explicit debug Chrome/CI contexts.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "tabs_only": { "type": "boolean", "default": false },
                    "text_only": { "type": "boolean", "default": false },
                    "main_only": { "type": "boolean", "default": false },
                    "main_only_fallback_to_full": { "type": "boolean", "default": true },
                    "main_only_min_chars": { "type": "number", "minimum": 100, "maximum": 10_000 },
                    "main_only_min_coverage": { "type": "number", "minimum": 0.05, "maximum": 0.95 },
                    "switch_tab_id": { "type": "string" },
                    "session_id": { "type": "string" },
                    "session_url_pattern": { "type": "string" },
                    "max_chars": { "type": "number", "minimum": 1_000, "maximum": 300_000 },
                    "tmwd_mode": { "type": "string", "enum": ["auto", "tmwd", "remote_cdp", "cdp"], "default": "tmwd" },
                    "tmwd_transport": { "type": "string", "enum": ["auto", "ws", "link"], "default": "auto" },
                    "tmwd_ws_endpoint": { "type": "string" },
                    "tmwd_link_endpoint": { "type": "string" },
                    "cdp_endpoint": { "type": "string" }
                },
                "additionalProperties": false
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_WEB_EXECUTE_JS,
            description: "Execute JavaScript or a GA-style browser bridge command in the user's real browser via TMWD by default. Use this as the primary browser action tool for navigation, DOM operations, DevTools bridge commands, cookies, tabs, and batch browser actions. Use tmwd_mode=remote_cdp only for explicit debug Chrome/CI contexts.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "script": { "type": "string" },
                    "code": { "type": "string" },
                    "tab_id": { "type": "string" },
                    "switch_tab_id": { "type": "string" },
                    "session_id": { "type": "string" },
                    "session_url_pattern": { "type": "string" },
                    "no_monitor": { "type": "boolean", "default": false },
                    "timeout_ms": { "type": "number", "minimum": 100, "maximum": 120_000 },
                    "tmwd_mode": { "type": "string", "enum": ["auto", "tmwd", "remote_cdp", "cdp"], "default": "tmwd" },
                    "tmwd_transport": { "type": "string", "enum": ["auto", "ws", "link"], "default": "auto" },
                    "tmwd_ws_endpoint": { "type": "string" },
                    "tmwd_link_endpoint": { "type": "string" },
                    "cdp_endpoint": { "type": "string" },
                    "target_url_contains": { "type": "string" },
                    "native_auto_fallback": { "type": "boolean", "default": false },
                    "native_auto_fallback_policy": {
                        "type": "string",
                        "enum": ["strict", "balanced", "aggressive"],
                        "default": "balanced"
                    },
                    "native_auto_execute": { "type": "boolean", "default": false },
                    "native_execute_action_scope": {
                        "type": "string",
                        "enum": ["non_pointer", "all"],
                        "default": "non_pointer"
                    },
                    "native_fallback_action": {
                        "type": "string",
                        "enum": [
                            "activate_window",
                            "move",
                            "click",
                            "double_click",
                            "press",
                            "type",
                            "paste",
                            "scroll",
                            "get_window_rect"
                        ]
                    },
                    "native_fallback_args": { "type": "object" },
                    "native_fallback_timeout_ms": { "type": "number", "minimum": 500, "maximum": 30_000 }
                },
                "anyOf": [
                    { "required": ["script"] },
                    { "required": ["code"] }
                ],
                "additionalProperties": false
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_SEMANTIC_SEARCH,
            description: "Conceptual semantic retrieval across code, memory, and wiki sources. Prefer for intent/topic questions over literal text matching; not intended for direct filename/path lookup.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "sources": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["code", "memory", "wiki"] }
                    },
                    "technical_terms": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "per_source_limit": { "type": "integer" },
                    "max_segments": { "type": "integer" },
                    "include_org": { "type": "boolean" },
                    "refresh": { "type": "string", "enum": ["auto", "force", "skip"] },
                    "timeout_ms": { "type": "integer" },
                    "bridge_script": { "type": "string" }
                },
                "required": ["query"]
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_PROMPT_ENHANCER,
            description: "Enhance prompt with semantic evidence and extracted technical terms",
            parameters: json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "sources": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["code", "memory", "wiki"] }
                    },
                    "explicit_paths": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "explicit_symbols": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "max_evidence": { "type": "integer" },
                    "include_org": { "type": "boolean" },
                    "refresh": { "type": "string", "enum": ["auto", "force", "skip"] },
                    "timeout_ms": { "type": "integer" },
                    "bridge_script": { "type": "string" }
                },
                "required": ["prompt"]
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_ASK_USER,
            description: "Interrupt current turn and ask user one or more structured clarification questions",
            parameters: json!({
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "header": { "type": "string" },
                                "question": { "type": "string" },
                                "options": {
                                    "type": "array",
                                    "items": {
                                        "oneOf": [
                                            { "type": "string" },
                                            {
                                                "type": "object",
                                                "properties": {
                                                    "label": { "type": "string" },
                                                    "description": { "type": "string" },
                                                    "value": { "type": "string" }
                                                },
                                                "required": ["label"]
                                            }
                                        ]
                                    }
                                }
                            },
                            "required": ["id", "header", "question"]
                        }
                    },
                    "blocking_node_id": { "type": "string" },
                    "default_on_timeout": { "type": "string" },
                    "resume_token": { "type": "string" }
                },
                "required": ["questions"]
            }),
            default_enabled: true,
        },
    ]
}

pub(crate) fn local_tool_definitions() -> Vec<Value> {
    local_tool_catalog()
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
            })
        })
        .collect()
}

fn canonical_tool_surface_profile(raw: Option<&str>) -> &'static str {
    match raw
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| TOOL_SURFACE_CODING.to_string())
        .replace('-', "_")
        .as_str()
    {
        TOOL_SURFACE_MINIMAL => TOOL_SURFACE_MINIMAL,
        TOOL_SURFACE_BROWSER => TOOL_SURFACE_BROWSER,
        TOOL_SURFACE_BROWSER_ADVANCED => TOOL_SURFACE_BROWSER_ADVANCED,
        TOOL_SURFACE_CONTEXT => TOOL_SURFACE_CONTEXT,
        TOOL_SURFACE_MCP => TOOL_SURFACE_MCP,
        TOOL_SURFACE_FULL_DEBUG => TOOL_SURFACE_FULL_DEBUG,
        _ => TOOL_SURFACE_CODING,
    }
}

fn tool_surface_profile_names(profile: &str) -> Vec<&'static str> {
    match canonical_tool_surface_profile(Some(profile)) {
        TOOL_SURFACE_MINIMAL => vec![TOOL_READ, TOOL_EDIT, TOOL_WRITE, TOOL_ASK_USER],
        TOOL_SURFACE_BROWSER => vec![TOOL_WEB_SCAN, TOOL_WEB_EXECUTE_JS, TOOL_READ, TOOL_ASK_USER],
        TOOL_SURFACE_BROWSER_ADVANCED => vec![TOOL_WEB_SCAN, TOOL_WEB_EXECUTE_JS, TOOL_READ, TOOL_ASK_USER],
        TOOL_SURFACE_CONTEXT => vec![TOOL_SEMANTIC_SEARCH, TOOL_READ, TOOL_ASK_USER],
        TOOL_SURFACE_MCP => vec![TOOL_MCP_SERVERS, TOOL_MCP_CALL, TOOL_ASK_USER],
        TOOL_SURFACE_FULL_DEBUG => local_tool_catalog().into_iter().map(|tool| tool.name).collect(),
        _ => default_enabled_local_tool_names(),
    }
}

fn schema_projection_mode(profile: &str, advanced_tool_schema: bool) -> &'static str {
    if canonical_tool_surface_profile(Some(profile)) == TOOL_SURFACE_FULL_DEBUG {
        return "full";
    }
    if advanced_tool_schema || canonical_tool_surface_profile(Some(profile)) == TOOL_SURFACE_BROWSER_ADVANCED {
        return "advanced";
    }
    "slim"
}

fn project_object_schema_properties(parameters: &Value, allowed_properties: &[&str]) -> Value {
    let mut projected = parameters.clone();
    let allowed: HashSet<&str> = allowed_properties.iter().copied().collect();
    if let Some(properties) = projected
        .get_mut("properties")
        .and_then(Value::as_object_mut)
    {
        properties.retain(|key, _| allowed.contains(key.as_str()));
    }
    prune_required_schema_array(projected.get_mut("required"), &allowed);
    if projected
        .get("required")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        if let Some(object) = projected.as_object_mut() {
            object.remove("required");
        }
    }
    if let Some(any_of) = projected.get_mut("anyOf").and_then(Value::as_array_mut) {
        for branch in any_of.iter_mut() {
            prune_required_schema_array(branch.get_mut("required"), &allowed);
        }
        any_of.retain(|branch| {
            branch
                .get("required")
                .and_then(Value::as_array)
                .is_none_or(|required| !required.is_empty())
        });
    }
    if projected
        .get("anyOf")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        if let Some(object) = projected.as_object_mut() {
            object.remove("anyOf");
        }
    }
    projected
}

fn prune_required_schema_array(required: Option<&mut Value>, allowed: &HashSet<&str>) {
    if let Some(required) = required.and_then(Value::as_array_mut) {
        required.retain(|item| item.as_str().is_some_and(|name| allowed.contains(name)));
    }
}

fn project_tool_parameters(name: &str, parameters: &Value, profile: &str, advanced_tool_schema: bool) -> Value {
    let mode = schema_projection_mode(profile, advanced_tool_schema);
    if mode == "full" {
        return parameters.clone();
    }
    match (name, mode) {
        (TOOL_WEB_SCAN, "slim") => project_object_schema_properties(
            parameters,
            &[
                "tabs_only",
                "main_only",
                "switch_tab_id",
                "session_id",
                "max_chars",
            ],
        ),
        (TOOL_WEB_EXECUTE_JS, "slim") => project_object_schema_properties(
            parameters,
            &[
                "script",
                "code",
                "tab_id",
                "switch_tab_id",
                "session_id",
                "timeout_ms",
            ],
        ),
        (TOOL_WEB_SCAN, "advanced") => project_object_schema_properties(
            parameters,
            &[
                "tabs_only",
                "text_only",
                "main_only",
                "main_only_fallback_to_full",
                "main_only_min_chars",
                "main_only_min_coverage",
                "switch_tab_id",
                "session_id",
                "session_url_pattern",
                "max_chars",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
            ],
        ),
        (TOOL_WEB_EXECUTE_JS, "advanced") => project_object_schema_properties(
            parameters,
            &[
                "script",
                "code",
                "tab_id",
                "switch_tab_id",
                "session_id",
                "session_url_pattern",
                "timeout_ms",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
                "target_url_contains",
                "native_auto_fallback",
                "native_auto_fallback_policy",
                "native_fallback_timeout_ms",
            ],
        ),
        _ => parameters.clone(),
    }
}

fn schema_property_names(parameters: &Value) -> Vec<String> {
    let mut names = parameters
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| properties.keys().cloned().collect::<Vec<String>>())
        .unwrap_or_default();
    names.sort();
    names
}

fn stable_json_fingerprint(prefix: &str, payload: &Value) -> String {
    let text = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    let mut hash: u32 = 0x811c9dc5;
    for byte in text.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{prefix}:{hash:08x}")
}

fn tool_surface_schema_profile(profile: &str, advanced_tool_schema: bool) -> Value {
    let profile = canonical_tool_surface_profile(Some(profile));
    let mode = schema_projection_mode(profile, advanced_tool_schema);
    let tool_names = tool_surface_profile_names(profile);
    let visible_tool_count = tool_names.len();
    let catalog = local_tool_catalog();
    let mut per_tool_property_count = Map::new();
    let mut per_tool_visible_args = Map::new();
    let mut per_tool_suppressed_args = Map::new();
    let mut projected_tool_schemas = Vec::new();
    let mut schema_property_total = 0usize;
    let mut full_schema_property_total = 0usize;

    for tool_name in &tool_names {
        if let Some(tool) = catalog.iter().find(|entry| entry.name == *tool_name) {
            let projected_parameters =
                project_tool_parameters(tool.name, &tool.parameters, profile, advanced_tool_schema);
            let visible_args = schema_property_names(&projected_parameters);
            let full_args = schema_property_names(&tool.parameters);
            let visible_arg_set = visible_args.iter().cloned().collect::<HashSet<String>>();
            let suppressed_args = full_args
                .iter()
                .filter(|name| !visible_arg_set.contains(*name))
                .cloned()
                .collect::<Vec<String>>();
            let projected_count = visible_args.len();
            let full_count = full_args.len();
            schema_property_total += projected_count;
            full_schema_property_total += full_count;
            per_tool_property_count.insert(tool.name.to_string(), json!(projected_count));
            per_tool_visible_args.insert(tool.name.to_string(), json!(visible_args));
            per_tool_suppressed_args.insert(tool.name.to_string(), json!(suppressed_args));
            projected_tool_schemas.push(json!({
                "name": tool.name,
                "full_property_names": full_args,
                "parameters": projected_parameters,
            }));
        }
    }
    let advanced_schema_effective =
        advanced_tool_schema || profile == TOOL_SURFACE_BROWSER_ADVANCED || profile == TOOL_SURFACE_FULL_DEBUG;
    let schema_fingerprint = stable_json_fingerprint(
        "schema",
        &json!({
            "policy_version": TOOL_SURFACE_POLICY_VERSION,
            "profile": profile,
            "projection_mode": mode,
            "advanced_tool_schema": advanced_schema_effective,
            "tools": projected_tool_schemas,
        }),
    );

    json!({
        "policy_version": TOOL_SURFACE_POLICY_VERSION,
        "profile": profile,
        "projection_mode": mode,
        "advanced_tool_schema": advanced_schema_effective,
        "schema_fingerprint": schema_fingerprint,
        "tool_names": tool_names,
        "visible_tool_count": visible_tool_count,
        "schema_property_count": schema_property_total,
        "full_schema_property_count": full_schema_property_total,
        "suppressed_schema_property_count": full_schema_property_total.saturating_sub(schema_property_total),
        "per_tool_property_count": per_tool_property_count,
        "per_tool_visible_args": per_tool_visible_args,
        "per_tool_suppressed_args": per_tool_suppressed_args,
    })
}

pub(crate) fn tool_surface_schema_profiles() -> Vec<Value> {
    [
        (TOOL_SURFACE_MINIMAL, false),
        (TOOL_SURFACE_CODING, false),
        (TOOL_SURFACE_BROWSER, false),
        (TOOL_SURFACE_BROWSER_ADVANCED, true),
        (TOOL_SURFACE_CONTEXT, false),
        (TOOL_SURFACE_MCP, false),
        (TOOL_SURFACE_FULL_DEBUG, true),
    ]
    .into_iter()
    .map(|(profile, advanced_tool_schema)| {
        tool_surface_schema_profile(profile, advanced_tool_schema)
    })
    .collect()
}

pub(crate) fn tool_surface_schema_profiles_fingerprint(profiles: &[Value]) -> String {
    stable_json_fingerprint(
        "schema_profiles",
        &json!({
            "policy_version": TOOL_SURFACE_POLICY_VERSION,
            "profiles": profiles,
        }),
    )
}

pub(crate) fn local_tool_definitions_for_surface(
    visible_tools: &[String],
    profile: Option<&str>,
    advanced_tool_schema: bool,
) -> Vec<Value> {
    let profile = canonical_tool_surface_profile(profile);
    let visible: HashSet<String> = if visible_tools.is_empty() {
        tool_surface_profile_names(profile)
            .into_iter()
            .map(str::to_string)
            .collect()
    } else {
        visible_tools
            .iter()
            .map(|item| item.trim().to_ascii_lowercase())
            .filter(|item| !item.is_empty())
            .collect()
    };
    local_tool_catalog()
        .into_iter()
        .filter(|tool| visible.contains(tool.name))
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": project_tool_parameters(tool.name, &tool.parameters, profile, advanced_tool_schema),
                }
            })
        })
        .collect()
}

pub(crate) fn default_enabled_local_tool_names() -> Vec<&'static str> {
    local_tool_catalog()
        .into_iter()
        .filter(|tool| tool.default_enabled)
        .map(|tool| tool.name)
        .collect()
}

fn default_enabled_tools() -> HashSet<String> {
    default_enabled_local_tool_names()
        .into_iter()
        .map(|item| item.to_string())
        .collect()
}

pub(crate) fn tool_surface_policy_version() -> &'static str {
    TOOL_SURFACE_POLICY_VERSION
}

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

fn clamp_policy_usize(value: Option<usize>, default_value: usize, min: usize, max: usize) -> usize {
    value.unwrap_or(default_value).clamp(min, max)
}

fn clamp_policy_u64(value: Option<u64>, default_value: u64, min: u64, max: u64) -> u64 {
    value.unwrap_or(default_value).clamp(min, max)
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
    let normalized_limit = sample_limit.clamp(MIN_MCP_LATENCY_SAMPLE_LIMIT, MAX_MCP_LATENCY_SAMPLE_LIMIT);
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
        "mcp_transport_error" | "mcp_protocol_error" | "mcp_rpc_error" | "mcp_spawn_failed" => "transport",
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
            if policy.max_queue_per_server == 0 || state.queue_waiting >= policy.max_queue_per_server {
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

fn parse_toml_file<T>(path: &Path) -> Option<T>
where
    T: DeserializeOwned,
{
    let raw = fs::read_to_string(path).ok()?;
    toml::from_str::<T>(&raw).ok()
}

fn find_project_grobot_dir(work_dir: &Path) -> Option<PathBuf> {
    let mut cursor = Some(work_dir);
    while let Some(path) = cursor {
        let candidate = path.join(".grobot");
        if candidate.is_dir() {
            return Some(candidate);
        }
        cursor = path.parent();
    }
    None
}

fn shell_escape_single(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn command_resolvable(command: &str, cwd: &Path) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains('/') {
        return Path::new(trimmed).exists();
    }
    let script = format!("command -v {} >/dev/null 2>&1", shell_escape_single(trimmed));
    Command::new("sh")
        .arg("-lc")
        .arg(script)
        .current_dir(cwd)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn normalize_name(value: &str) -> String {
    value.trim().to_string()
}

fn merge_mcp_servers_from_file(
    path: &Path,
    source: &str,
    merged: &mut Vec<McpServerResolved>,
    index_by_name: &mut HashMap<String, usize>,
) {
    let parsed = match parse_toml_file::<McpServerRegistryFile>(path) {
        Some(parsed) => parsed,
        None => return,
    };
    for raw in parsed.servers {
        let name = normalize_name(&raw.name);
        let command = normalize_name(&raw.command);
        if name.is_empty() || command.is_empty() {
            continue;
        }
        let args = raw
            .args
            .iter()
            .map(|item| item.trim())
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect::<Vec<String>>();
        let resolved = McpServerResolved {
            name: name.clone(),
            command,
            args,
            env: raw.env,
            enabled: raw.enabled.unwrap_or(true),
            source: source.to_string(),
            ready: false,
            ready_reason: "not_checked".to_string(),
        };
        if let Some(index) = index_by_name.get(&name).copied() {
            merged[index] = resolved;
        } else {
            let index = merged.len();
            merged.push(resolved);
            index_by_name.insert(name, index);
        }
    }
}

fn load_mcp_servers(context: &ToolContextResolved) -> Vec<McpServerResolved> {
    let mut merged: Vec<McpServerResolved> = Vec::new();
    let mut index_by_name: HashMap<String, usize> = HashMap::new();
    if let Some(home) = env::var_os("HOME") {
        let global_registry = PathBuf::from(home).join(".grobot").join("mcp").join("servers.toml");
        merge_mcp_servers_from_file(
            &global_registry,
            "global",
            &mut merged,
            &mut index_by_name,
        );
    }
    if let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) {
        let project_registry = project_grobot_dir.join("mcp.toml");
        merge_mcp_servers_from_file(
            &project_registry,
            "project",
            &mut merged,
            &mut index_by_name,
        );
    }
    for server in &mut merged {
        if !server.enabled {
            server.ready = false;
            server.ready_reason = "disabled".to_string();
            continue;
        }
        if command_resolvable(&server.command, &context.work_dir) {
            server.ready = true;
            server.ready_reason = "ok".to_string();
        } else {
            server.ready = false;
            server.ready_reason = "command_not_found".to_string();
        }
    }
    merged
}

fn load_mcp_call_policy(context: &ToolContextResolved) -> McpCallPolicy {
    let mut policy = default_mcp_call_policy();
    let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) else {
        return policy;
    };
    let project_toml = project_grobot_dir.join("project.toml");
    let parsed = match parse_toml_file::<ProjectPolicyConfigFile>(&project_toml) {
        Some(parsed) => parsed,
        None => return policy,
    };
    let project_policy = parsed.tools.mcp;
    let allow_tools = project_policy
        .allow_tools
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect::<Vec<String>>();
    policy.max_concurrency_per_server = clamp_policy_usize(
        project_policy.max_concurrency_per_server,
        DEFAULT_MCP_MAX_CONCURRENCY_PER_SERVER,
        MIN_MCP_MAX_CONCURRENCY_PER_SERVER,
        MAX_MCP_MAX_CONCURRENCY_PER_SERVER,
    );
    policy.max_queue_per_server = clamp_policy_usize(
        project_policy.max_queue_per_server,
        DEFAULT_MCP_MAX_QUEUE_PER_SERVER,
        MIN_MCP_MAX_QUEUE_PER_SERVER,
        MAX_MCP_MAX_QUEUE_PER_SERVER,
    );
    policy.failure_threshold = clamp_policy_usize(
        project_policy.failure_threshold,
        DEFAULT_MCP_FAILURE_THRESHOLD,
        MIN_MCP_FAILURE_THRESHOLD,
        MAX_MCP_FAILURE_THRESHOLD,
    );
    policy.cooldown_secs = clamp_policy_u64(
        project_policy.cooldown_secs,
        DEFAULT_MCP_COOLDOWN_SECS,
        MIN_MCP_COOLDOWN_SECS,
        MAX_MCP_COOLDOWN_SECS,
    );
    policy.latency_sample_limit = clamp_policy_usize(
        project_policy.latency_sample_limit,
        DEFAULT_MCP_LATENCY_SAMPLE_LIMIT,
        MIN_MCP_LATENCY_SAMPLE_LIMIT,
        MAX_MCP_LATENCY_SAMPLE_LIMIT,
    );
    policy.call_timeout_ms = clamp_policy_u64(
        project_policy.call_timeout_ms,
        DEFAULT_MCP_CALL_TIMEOUT_MS,
        MIN_MCP_CALL_TIMEOUT_MS,
        MAX_MCP_CALL_TIMEOUT_MS,
    );
    policy.session_idle_ttl_secs = clamp_policy_u64(
        project_policy.session_idle_ttl_secs,
        DEFAULT_MCP_SESSION_IDLE_TTL_SECS,
        MIN_MCP_SESSION_IDLE_TTL_SECS,
        MAX_MCP_SESSION_IDLE_TTL_SECS,
    );
    policy.allow_tools = allow_tools;
    policy
}

fn mcp_tool_allowed(policy: &McpCallPolicy, tool_name: &str) -> bool {
    if policy.allow_tools.is_empty() {
        return true;
    }
    for rule in &policy.allow_tools {
        if rule == "*" || rule == tool_name {
            return true;
        }
    }
    false
}

fn parse_tool_context(input: &TurnExecuteInput) -> Result<ToolContextResolved, ToolExecutionError> {
    let tool_context = input
        .tool_context
        .as_ref()
        .ok_or_else(|| {
            runtime_environment_error(
                "tool_context_missing",
                "runtime tool context is required",
                "tool_context_missing",
                "fix the runtime tool context/work_dir, then run grobot status --json before retrying",
                "tool_context",
                None,
            )
        })?;
    let raw_work_dir = tool_context
        .work_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            runtime_environment_error(
                "tool_context_missing",
                "tool_context.work_dir is required",
                "tool_context_missing",
                "fix the runtime tool context/work_dir, then run grobot status --json before retrying",
                "tool_context.work_dir",
                None,
            )
        })?;
    let canonical_work_dir = fs::canonicalize(raw_work_dir).map_err(|error| {
        runtime_environment_error(
            "tool_context_invalid",
            format!("failed to resolve work_dir: {error}"),
            "tool_context_invalid",
            "choose a valid workspace directory, then run grobot status --json before retrying",
            "tool_context.work_dir",
            Some(raw_work_dir),
        )
    })?;
    if !canonical_work_dir.is_dir() {
        return Err(runtime_environment_error(
            "tool_context_invalid",
            "tool_context.work_dir is not a directory",
            "tool_context_invalid",
            "choose a valid workspace directory, then run grobot status --json before retrying",
            "tool_context.work_dir",
            Some(raw_work_dir),
        ));
    }
    let enabled_tools = normalize_tool_name_set(tool_context.enabled_tools.as_ref())
        .unwrap_or_else(default_enabled_tools);
    let profile = canonical_tool_surface_profile(tool_context.tool_surface_profile.as_deref()).to_string();
    let model_visible_tools = normalize_tool_name_set(tool_context.model_visible_tools.as_ref())
        .unwrap_or_else(|| enabled_tools.clone());
    let advanced_tool_schema = tool_context.advanced_tool_schema.unwrap_or(false);
    let bash_allowlist = tool_context
        .bash_allowlist
        .as_ref()
        .map(|values| {
            values
                .iter()
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
                .map(|item| item.to_string())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    let session_key = input
        .session_key
        .trim()
        .to_string();
    Ok(ToolContextResolved {
        session_key,
        work_dir: canonical_work_dir,
        enabled_tools,
        model_visible_tools,
        tool_surface_profile: profile,
        advanced_tool_schema,
        bash_allowlist,
    })
}

fn normalize_tool_name_set(values: Option<&Vec<String>>) -> Option<HashSet<String>> {
    values.map(|rows| {
        let mut set = HashSet::new();
        for item in rows {
            let normalized = normalize_tool_name(item);
            if normalized.is_empty() {
                continue;
            }
            set.insert(normalized);
        }
        set
    })
}

fn value_object<'a>(
    arguments: &'a Value,
    tool_name: &str,
) -> Result<&'a Map<String, Value>, ToolExecutionError> {
    arguments.as_object().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("tool {tool_name} expects a JSON object argument"),
        )
    })
}

fn get_string_arg(args: &Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn get_bool_arg(args: &Map<String, Value>, key: &str, fallback: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn get_usize_arg(args: &Map<String, Value>, key: &str, fallback: usize, max: usize) -> usize {
    let parsed = args
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(fallback);
    parsed.clamp(1, max)
}

fn parse_ask_user_options_arg(raw: &Value) -> Vec<Value> {
    let Some(items) = raw.as_array() else {
        return Vec::new();
    };
    let mut normalized = Vec::new();
    for item in items {
        if let Some(text) = item.as_str() {
            let compact = truncate_output(text.trim().to_string(), 120);
            if compact.is_empty() {
                continue;
            }
            normalized.push(json!({
                "label": compact,
                "value": compact,
            }));
        } else if let Some(option_obj) = item.as_object() {
            let label = option_obj
                .get("label")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| truncate_output(value.to_string(), 120));
            let Some(label) = label else {
                continue;
            };
            let description = option_obj
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| truncate_output(value.to_string(), 180));
            let value = option_obj
                .get("value")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|raw| !raw.is_empty())
                .map(|raw| truncate_output(raw.to_string(), 120))
                .unwrap_or_else(|| label.clone());
            let mut row = serde_json::Map::new();
            row.insert("label".to_string(), Value::String(label));
            if let Some(description) = description {
                if !description.is_empty() {
                    row.insert("description".to_string(), Value::String(description));
                }
            }
            row.insert("value".to_string(), Value::String(value));
            normalized.push(Value::Object(row));
        }
        if normalized.len() >= 6 {
            break;
        }
    }
    normalized
}

fn parse_ask_user_arg_questions(args: &Map<String, Value>) -> Vec<Value> {
    let Some(raw_questions) = args.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut questions: Vec<Value> = Vec::new();
    for (index, raw_question) in raw_questions.iter().enumerate() {
        let Some(question_obj) = raw_question.as_object() else {
            continue;
        };
        let id = question_obj
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_output(value.to_string(), 80))
            .unwrap_or_else(|| format!("q{}", index + 1));
        let header = question_obj
            .get("header")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_output(value.to_string(), 120))
            .unwrap_or_else(|| format!("Question {}", index + 1));
        let question = question_obj
            .get("question")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_output(value.to_string(), 600));
        let Some(question) = question else {
            continue;
        };
        let options = question_obj
            .get("options")
            .map(parse_ask_user_options_arg)
            .unwrap_or_default();
        questions.push(json!({
            "id": id,
            "header": header,
            "question": question,
            "options": options,
        }));
        if questions.len() >= 3 {
            break;
        }
    }
    questions
}

fn build_runtime_generated_id(prefix: &str) -> String {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{prefix}_{:x}", now_nanos)
}

fn now_unix_label() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}

fn run_ask_user(
    _context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let questions = parse_ask_user_arg_questions(args);
    if questions.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "ask_user.questions must include at least one valid item",
        ));
    }
    let blocking_node_id =
        get_string_arg(args, "blocking_node_id").unwrap_or_else(|| "node.unknown".to_string());
    let default_on_timeout = get_string_arg(args, "default_on_timeout")
        .unwrap_or_else(|| "continue_with_best_effort".to_string());
    let resume_token =
        get_string_arg(args, "resume_token").unwrap_or_else(|| build_runtime_generated_id("resume"));
    let payload = json!({
        "tool": TOOL_ASK_USER,
        "type": "ask_user",
        "blocking_node_id": blocking_node_id,
        "questions": questions,
        "default_on_timeout": default_on_timeout,
        "resume_token": resume_token,
        "created_at": now_unix_label(),
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn ensure_within_workspace(
    work_dir: &Path,
    raw_path: &str,
    allow_missing_leaf: bool,
) -> Result<PathBuf, ToolExecutionError> {
    let candidate = if Path::new(raw_path).is_absolute() {
        PathBuf::from(raw_path)
    } else {
        work_dir.join(raw_path)
    };
    let resolved = if candidate.exists() {
        fs::canonicalize(&candidate).map_err(|error| {
            ToolExecutionError::new("path_invalid", format!("failed to resolve path: {error}"))
                .with_data(path_resolution_error_data(
                    raw_path,
                    Some(candidate.as_path()),
                    allow_missing_leaf,
                    "path_invalid",
                    "failed_to_resolve_path",
                ))
        })?
    } else if allow_missing_leaf {
        if candidate
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(ToolExecutionError::new(
                "path_escape_blocked",
                "missing write targets must not contain parent traversal",
            )
            .with_data(path_resolution_error_data(
                raw_path,
                Some(candidate.as_path()),
                allow_missing_leaf,
                "path_escape_blocked",
                "parent_traversal_in_missing_target",
            )));
        }

        let mut cursor = candidate.as_path();
        let mut missing_components = Vec::new();
        while !cursor.exists() {
            let component = cursor.file_name().ok_or_else(|| {
                ToolExecutionError::new("path_invalid", "path parent is invalid")
                    .with_data(path_resolution_error_data(
                        raw_path,
                        Some(candidate.as_path()),
                        allow_missing_leaf,
                        "path_invalid",
                        "missing_parent_component",
                    ))
            })?;
            missing_components.push(component.to_os_string());
            cursor = cursor.parent().ok_or_else(|| {
                ToolExecutionError::new("path_invalid", "path parent is invalid")
                    .with_data(path_resolution_error_data(
                        raw_path,
                        Some(candidate.as_path()),
                        allow_missing_leaf,
                        "path_invalid",
                        "missing_parent_path",
                    ))
            })?;
        }

        let mut resolved_parent = fs::canonicalize(cursor).map_err(|error| {
            ToolExecutionError::new("path_invalid", format!("failed to resolve parent: {error}"))
                .with_data(path_resolution_error_data(
                    raw_path,
                    Some(cursor),
                    allow_missing_leaf,
                    "path_invalid",
                    "failed_to_resolve_parent",
                ))
        })?;
        for component in missing_components.iter().rev() {
            resolved_parent.push(component);
        }
        resolved_parent
    } else {
        return Err(ToolExecutionError::new(
            "path_not_found",
            format!("path not found: {}", candidate.display()),
        )
        .with_data(path_resolution_error_data(
            raw_path,
            Some(candidate.as_path()),
            allow_missing_leaf,
            "path_not_found",
            "target_does_not_exist",
        )));
    };
    if !resolved.starts_with(work_dir) {
        return Err(ToolExecutionError::new(
            "path_escape_blocked",
            "path escapes workspace",
        )
        .with_data(path_resolution_error_data(
            raw_path,
            Some(resolved.as_path()),
            allow_missing_leaf,
            "path_escape_blocked",
            "resolved_path_outside_workspace",
        )));
    }
    Ok(resolved)
}

fn relative_to_work_dir(work_dir: &Path, value: &Path) -> String {
    value
        .strip_prefix(work_dir)
        .unwrap_or(value)
        .to_string_lossy()
        .replace('\\', "/")
}

fn truncate_output(raw: String, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        return raw;
    }
    raw.chars().take(max_chars).collect::<String>()
}
