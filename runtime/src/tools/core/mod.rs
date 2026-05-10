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
const MIN_MCP_SESSION_IDLE_TTL_SECS: u64 = 1;
const MAX_MCP_SESSION_IDLE_TTL_SECS: u64 = 86_400;

#[derive(Debug, Clone)]
pub(crate) struct LocalToolCatalogEntry {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
    pub default_enabled: bool,
}

include!("errors.rs");

include!("types.rs");

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

include!("catalog.rs");
include!("surface.rs");

include!("mcp_runtime.rs");

include!("config.rs");

include!("context.rs");
