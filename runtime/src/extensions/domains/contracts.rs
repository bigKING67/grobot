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
}
