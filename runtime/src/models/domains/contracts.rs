const ENV_BASE_URL: &str = "GROBOT_BASE_URL";
const ENV_API_KEY: &str = "GROBOT_API_KEY";
const ENV_MODEL: &str = "GROBOT_MODEL";
const ENV_RUNTIME_TIMEOUT_MS: &str = "GROBOT_RUNTIME_HTTP_TIMEOUT_MS";
const DEFAULT_RUNTIME_TIMEOUT_MS: u64 = 15_000;
const MIN_RUNTIME_TIMEOUT_MS: u64 = 1_000;
const MAX_RUNTIME_TIMEOUT_MS: u64 = 120_000;

pub trait ModelExecutor {
    fn generate_assistant_message(
        &self,
        input: &TurnExecuteInput,
        tools: &dyn ToolExecutor,
    ) -> Result<String, ModelExecutionError>;
}

#[derive(Debug, Clone)]
pub struct ModelExecutionError {
    pub error_class: String,
    pub message: String,
}

impl ModelExecutionError {
    pub fn new(error_class: &str, message: impl Into<String>) -> Self {
        Self {
            error_class: error_class.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
struct RuntimeModelConfig {
    base_url: String,
    api_key: String,
    model: String,
    timeout_ms: u64,
}
