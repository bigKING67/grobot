use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct RuntimeModelConfigInput {
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub timeout_ms: Option<u64>,
    pub provider_kind: Option<String>,
    pub provider_options: Option<RuntimeProviderOptionsInput>,
}

#[derive(Debug, Clone)]
pub struct RuntimeProviderOptionsInput {
    pub kimi: Option<RuntimeKimiOptionsInput>,
}

#[derive(Debug, Clone)]
pub struct RuntimeKimiOptionsInput {
    pub web_search_mode: Option<String>,
    pub disable_thinking_on_builtin_web_search: Option<bool>,
    pub official_tools_allowlist: Option<Vec<String>>,
    pub official_tool_formulas: Option<Value>,
    pub prompt_cache: Option<RuntimePromptCacheOptionsInput>,
    pub max_tokens: Option<u32>,
    pub stream: Option<bool>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub files_enabled: Option<bool>,
    pub allow_file_admin: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct RuntimePromptCacheOptionsInput {
    pub enabled: Option<bool>,
    pub strategy: Option<String>,
    pub user_last_n: Option<u32>,
    pub capability: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeToolContextInput {
    pub work_dir: Option<String>,
    pub enabled_tools: Option<Vec<String>>,
    pub model_visible_tools: Option<Vec<String>>,
    pub tool_surface_profile: Option<String>,
    pub tool_surface_source: Option<String>,
    pub tool_surface_reason: Option<String>,
    pub tool_policy_version: Option<String>,
    pub advanced_tool_schema: Option<bool>,
    pub bash_allowlist: Option<Vec<String>>,
    pub max_tool_rounds: Option<u32>,
    pub no_tool_fallback_mode: Option<String>,
    pub max_recovery_rounds: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct RuntimeAttachmentInput {
    pub attachment_type: String,
    pub source_type: String,
    pub source: String,
    pub mime_type: Option<String>,
    pub filename: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TurnExecuteInput {
    pub request_id: String,
    pub session_key: String,
    pub system_prompt: Option<String>,
    pub user_message: String,
    pub context_lines: Vec<String>,
    pub model_config: Option<RuntimeModelConfigInput>,
    pub tool_context: Option<RuntimeToolContextInput>,
    pub attachments: Vec<RuntimeAttachmentInput>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeEventOutput {
    pub event_type: String,
    pub turn_id: String,
    pub timestamp_iso: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

pub trait RuntimeEventSink {
    fn emit(&mut self, event: &RuntimeEventOutput);
}

#[derive(Debug, Clone, Copy)]
pub struct NoopRuntimeEventSink;

impl RuntimeEventSink for NoopRuntimeEventSink {
    fn emit(&mut self, _event: &RuntimeEventOutput) {}
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnInterruptAskUserOptionOutput {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnInterruptAskUserQuestionOutput {
    pub id: String,
    pub header: String,
    pub question: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<TurnInterruptAskUserOptionOutput>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnInterruptAskUserOutput {
    pub blocking_node_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub questions: Vec<TurnInterruptAskUserQuestionOutput>,
    pub default_on_timeout: String,
    pub resume_token: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnInterruptOutput {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ask_user: Option<TurnInterruptAskUserOutput>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnExecuteOutput {
    pub trace_id: String,
    pub request_id: String,
    pub session_key: String,
    pub assistant_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupt: Option<TurnInterruptOutput>,
    pub events: Vec<RuntimeEventOutput>,
}

#[derive(Debug, Clone)]
pub struct TurnExecuteFailure {
    pub trace_id: String,
    pub request_id: String,
    pub session_key: String,
    pub error_class: String,
    pub error_message: String,
    pub error_data: Option<Value>,
    pub events: Vec<RuntimeEventOutput>,
}
