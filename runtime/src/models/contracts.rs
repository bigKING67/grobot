const ENV_BASE_URL: &str = "GROBOT_BASE_URL";
const ENV_API_KEY: &str = "GROBOT_API_KEY";
const ENV_MODEL: &str = "GROBOT_MODEL";
const ENV_RUNTIME_TIMEOUT_MS: &str = "GROBOT_RUNTIME_HTTP_TIMEOUT_MS";
const ENV_MODEL_AUTO_CACHE_TTL_SECS: &str = "GROBOT_MODEL_AUTO_CACHE_TTL_SECS";
const DEFAULT_RUNTIME_TIMEOUT_MS: u64 = 15_000;
const MIN_RUNTIME_TIMEOUT_MS: u64 = 1_000;
const MAX_RUNTIME_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MODEL_AUTO_CACHE_TTL_SECS: u64 = 300;

pub trait ModelExecutor {
    fn generate_assistant_message(
        &self,
        input: &TurnExecuteInput,
        tools: &dyn ToolExecutor,
    ) -> Result<ModelExecutionOutput, ModelExecutionError>;
}

#[derive(Debug, Clone)]
pub struct ModelTelemetryEvent {
    pub event_type: String,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct ModelAskUserInterrupt {
    pub question_id: String,
    pub blocking_node_id: String,
    pub question: String,
    pub options: Vec<String>,
    pub default_on_timeout: String,
    pub resume_token: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub enum ModelExecutionInterrupt {
    AskUser(ModelAskUserInterrupt),
}

#[derive(Debug, Clone)]
pub struct ModelExecutionOutput {
    pub assistant_message: String,
    pub telemetry_events: Vec<ModelTelemetryEvent>,
    pub interrupt: Option<ModelExecutionInterrupt>,
}

#[derive(Debug, Clone)]
pub struct ModelExecutionError {
    pub error_class: String,
    pub message: String,
    pub telemetry_events: Vec<ModelTelemetryEvent>,
}

impl ModelExecutionError {
    pub fn new(error_class: &str, message: impl Into<String>) -> Self {
        Self {
            error_class: error_class.to_string(),
            message: message.into(),
            telemetry_events: Vec::new(),
        }
    }

    pub fn with_telemetry_events(mut self, telemetry_events: Vec<ModelTelemetryEvent>) -> Self {
        self.telemetry_events = telemetry_events;
        self
    }
}

#[derive(Debug, Clone)]
struct RuntimeModelConfig {
    base_url: String,
    api_key: String,
    model: String,
    timeout_ms: u64,
    provider_kind: ProviderKind,
    provider_options: RuntimeProviderOptions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProviderKind {
    OpenAiCompatible,
    Kimi,
}

#[derive(Debug, Clone)]
struct RuntimeProviderOptions {
    kimi: KimiProviderOptions,
}

#[derive(Debug, Clone)]
struct KimiProviderOptions {
    web_search_mode: KimiWebSearchMode,
    disable_thinking_on_builtin_web_search: bool,
    official_tools_allowlist: Vec<String>,
    max_tokens: u32,
    stream: bool,
    temperature: f64,
    top_p: f64,
    files_enabled: bool,
    allow_file_admin: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KimiWebSearchMode {
    BuiltinPreferred,
    BuiltinOnly,
    OfficialOnly,
    Off,
}

#[derive(Debug, Clone)]
struct ModelCatalogCacheEntry {
    model_ids: Vec<String>,
    cached_at_millis: u128,
}
