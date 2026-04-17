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
    prompt_cache: PromptCacheOptions,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromptCacheStrategy {
    UserLastN,
}

#[derive(Debug, Clone, Copy)]
struct PromptCacheOptions {
    enabled: bool,
    strategy: PromptCacheStrategy,
    user_last_n: usize,
}

#[derive(Debug, Clone)]
struct ModelCatalogCacheEntry {
    model_ids: Vec<String>,
    cached_at_millis: u128,
}

#[derive(Debug, Clone, Copy, Default)]
struct ModelCatalogCacheMetrics {
    hit_total: u64,
    miss_total: u64,
    stale_total: u64,
    write_total: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct PromptCacheMetrics {
    enabled_total: u64,
    hint_attempted_total: u64,
    hint_applied_total: u64,
    usage_observed_total: u64,
    cached_tokens_total: u64,
}

fn model_catalog_cache_metrics() -> &'static Mutex<ModelCatalogCacheMetrics> {
    static METRICS: OnceLock<Mutex<ModelCatalogCacheMetrics>> = OnceLock::new();
    METRICS.get_or_init(|| Mutex::new(ModelCatalogCacheMetrics::default()))
}

fn prompt_cache_metrics() -> &'static Mutex<PromptCacheMetrics> {
    static METRICS: OnceLock<Mutex<PromptCacheMetrics>> = OnceLock::new();
    METRICS.get_or_init(|| Mutex::new(PromptCacheMetrics::default()))
}

pub(crate) fn record_model_catalog_cache_hit() {
    if let Ok(mut guard) = model_catalog_cache_metrics().lock() {
        guard.hit_total = guard.hit_total.saturating_add(1);
    }
}

pub(crate) fn record_model_catalog_cache_miss() {
    if let Ok(mut guard) = model_catalog_cache_metrics().lock() {
        guard.miss_total = guard.miss_total.saturating_add(1);
    }
}

pub(crate) fn record_model_catalog_cache_stale() {
    if let Ok(mut guard) = model_catalog_cache_metrics().lock() {
        guard.stale_total = guard.stale_total.saturating_add(1);
    }
}

pub(crate) fn record_model_catalog_cache_write() {
    if let Ok(mut guard) = model_catalog_cache_metrics().lock() {
        guard.write_total = guard.write_total.saturating_add(1);
    }
}

pub(crate) fn record_prompt_cache_enabled() {
    if let Ok(mut guard) = prompt_cache_metrics().lock() {
        guard.enabled_total = guard.enabled_total.saturating_add(1);
    }
}

pub(crate) fn record_prompt_cache_hint_attempt(applied: bool) {
    if let Ok(mut guard) = prompt_cache_metrics().lock() {
        guard.hint_attempted_total = guard.hint_attempted_total.saturating_add(1);
        if applied {
            guard.hint_applied_total = guard.hint_applied_total.saturating_add(1);
        }
    }
}

pub(crate) fn record_prompt_cache_usage(cached_tokens: u64) {
    if let Ok(mut guard) = prompt_cache_metrics().lock() {
        guard.usage_observed_total = guard.usage_observed_total.saturating_add(1);
        guard.cached_tokens_total = guard.cached_tokens_total.saturating_add(cached_tokens);
    }
}

pub(crate) fn runtime_cache_stats_snapshot() -> Value {
    let model_metrics = model_catalog_cache_metrics()
        .lock()
        .map(|guard| *guard)
        .unwrap_or_default();
    let prompt_metrics = prompt_cache_metrics()
        .lock()
        .map(|guard| *guard)
        .unwrap_or_default();
    let model_catalog_entries = model_catalog_cache()
        .lock()
        .map(|guard| guard.len() as u64)
        .unwrap_or(0);
    json!({
        "model_catalog": {
            "cache_entries": model_catalog_entries,
            "hit_total": model_metrics.hit_total,
            "miss_total": model_metrics.miss_total,
            "stale_total": model_metrics.stale_total,
            "write_total": model_metrics.write_total,
        },
        "prompt_cache": {
            "enabled_total": prompt_metrics.enabled_total,
            "hint_attempted_total": prompt_metrics.hint_attempted_total,
            "hint_applied_total": prompt_metrics.hint_applied_total,
            "usage_observed_total": prompt_metrics.usage_observed_total,
            "cached_tokens_total": prompt_metrics.cached_tokens_total,
        }
    })
}
