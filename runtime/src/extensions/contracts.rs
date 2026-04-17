pub const JSONRPC_VERSION: &str = "2.0";
pub const RUNTIME_PROTOCOL_VERSION: &str = "runtime.v1";

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcSuccessResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    pub result: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct RpcErrorResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    pub error: RpcErrorObject,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecuteModelConfigParams {
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub provider_kind: Option<String>,
    #[serde(default)]
    pub provider_options: Option<TurnExecuteProviderOptionsParams>,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecuteProviderOptionsParams {
    #[serde(default)]
    pub kimi: Option<TurnExecuteKimiOptionsParams>,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecuteKimiOptionsParams {
    #[serde(default)]
    pub web_search_mode: Option<String>,
    #[serde(default)]
    pub disable_thinking_on_builtin_web_search: Option<bool>,
    #[serde(default)]
    pub official_tools_allowlist: Option<Vec<String>>,
    #[serde(default)]
    pub official_tool_formulas: Option<Value>,
    #[serde(default)]
    pub prompt_cache: Option<TurnExecutePromptCacheOptionsParams>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub stream: Option<bool>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default)]
    pub files_enabled: Option<bool>,
    #[serde(default)]
    pub allow_file_admin: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecutePromptCacheOptionsParams {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub strategy: Option<String>,
    #[serde(default)]
    pub user_last_n: Option<u32>,
    #[serde(default)]
    pub capability: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct RuntimeHealthParams {
    #[serde(default)]
    pub cache_stats_window_ms: Option<u64>,
    #[serde(default)]
    pub cache_stats_reset_window: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecuteAttachmentParams {
    #[serde(rename = "type")]
    pub attachment_type: String,
    #[serde(default)]
    pub source_type: String,
    pub source: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecuteParams {
    pub request_id: String,
    pub session_key: String,
    pub user_message: String,
    #[serde(default)]
    pub context_lines: Vec<String>,
    #[serde(default)]
    pub model_config: Option<TurnExecuteModelConfigParams>,
    #[serde(default)]
    pub tool_context: Option<TurnExecuteToolContextParams>,
    #[serde(default)]
    pub attachments: Vec<TurnExecuteAttachmentParams>,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecuteToolContextParams {
    #[serde(default)]
    pub work_dir: Option<String>,
    #[serde(default)]
    pub enabled_tools: Option<Vec<String>>,
    #[serde(default)]
    pub bash_allowlist: Option<Vec<String>>,
    #[serde(default)]
    pub max_tool_rounds: Option<u32>,
    #[serde(default)]
    pub no_tool_fallback_mode: Option<String>,
    #[serde(default)]
    pub max_recovery_rounds: Option<u32>,
}
