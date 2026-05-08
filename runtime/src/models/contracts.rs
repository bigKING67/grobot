const ENV_BASE_URL: &str = "GROBOT_BASE_URL";
const ENV_API_KEY: &str = "GROBOT_API_KEY";
const ENV_MODEL: &str = "GROBOT_MODEL";
const ENV_RUNTIME_TIMEOUT_MS: &str = "GROBOT_RUNTIME_HTTP_TIMEOUT_MS";
const ENV_MODEL_AUTO_CACHE_TTL_SECS: &str = "GROBOT_MODEL_AUTO_CACHE_TTL_SECS";
const DEFAULT_RUNTIME_TIMEOUT_MS: u64 = 15_000;
const MIN_RUNTIME_TIMEOUT_MS: u64 = 1_000;
const MAX_RUNTIME_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MODEL_AUTO_CACHE_TTL_SECS: u64 = 300;

#[derive(Debug, Clone)]
pub struct ModelTelemetryEvent {
    pub event_type: String,
    pub payload: Option<Value>,
}

pub trait ModelTelemetryEventSink {
    fn emit(&mut self, event: &ModelTelemetryEvent);
}

#[cfg(test)]
#[derive(Debug, Clone, Copy)]
pub struct NoopModelTelemetryEventSink;

#[cfg(test)]
impl ModelTelemetryEventSink for NoopModelTelemetryEventSink {
    fn emit(&mut self, _event: &ModelTelemetryEvent) {}
}

pub trait ModelExecutor {
    fn generate_assistant_message_with_telemetry(
        &self,
        input: &TurnExecuteInput,
        tools: &dyn ToolExecutor,
        telemetry_sink: &mut dyn ModelTelemetryEventSink,
    ) -> Result<ModelExecutionOutput, ModelExecutionError>;

    #[cfg(test)]
    fn generate_assistant_message(
        &self,
        input: &TurnExecuteInput,
        tools: &dyn ToolExecutor,
    ) -> Result<ModelExecutionOutput, ModelExecutionError> {
        let mut telemetry_sink = NoopModelTelemetryEventSink;
        self.generate_assistant_message_with_telemetry(input, tools, &mut telemetry_sink)
    }
}

#[derive(Debug, Clone)]
pub struct ModelAskUserOption {
    pub label: String,
    pub description: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ModelAskUserQuestion {
    pub id: String,
    pub header: String,
    pub question: String,
    pub options: Vec<ModelAskUserOption>,
}

#[derive(Debug, Clone)]
pub struct ModelAskUserInterrupt {
    pub blocking_node_id: String,
    pub questions: Vec<ModelAskUserQuestion>,
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
    pub data: Option<Value>,
    pub telemetry_events: Vec<ModelTelemetryEvent>,
}

impl ModelExecutionError {
    pub fn new(error_class: &str, message: impl Into<String>) -> Self {
        Self {
            error_class: error_class.to_string(),
            message: message.into(),
            data: None,
            telemetry_events: Vec::new(),
        }
    }

    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }

    pub fn with_telemetry_events(mut self, telemetry_events: Vec<ModelTelemetryEvent>) -> Self {
        self.telemetry_events = telemetry_events;
        self
    }
}

fn provider_kind_label(provider_kind: ProviderKind) -> &'static str {
    match provider_kind {
        ProviderKind::OpenAiCompatible => "openai_compatible",
        ProviderKind::Kimi => "kimi",
    }
}

fn model_error_data(
    diagnostic_kind: &str,
    source: &str,
    stage: &str,
    recovery_hint: &str,
) -> Value {
    json!({
        "diagnostic_kind": diagnostic_kind,
        "source": source,
        "stage": stage,
        "recovery_hint": recovery_hint
    })
}

fn model_error_with_data(
    error_class: &str,
    message: impl Into<String>,
    diagnostic_kind: &str,
    source: &str,
    stage: &str,
    recovery_hint: &str,
) -> ModelExecutionError {
    ModelExecutionError::new(error_class, message)
        .with_data(model_error_data(diagnostic_kind, source, stage, recovery_hint))
}

fn model_error_with_fields(
    mut error: ModelExecutionError,
    fields: &[(&str, Value)],
) -> ModelExecutionError {
    if let Some(data) = error.data.as_mut().and_then(Value::as_object_mut) {
        for (key, value) in fields {
            data.insert((*key).to_string(), value.clone());
        }
    }
    error
}

fn model_diagnostic_error(
    error_class: &str,
    message: impl Into<String>,
    source: &str,
    stage: &str,
    recovery_hint: &str,
) -> ModelExecutionError {
    model_error_with_data(
        error_class,
        message,
        error_class,
        source,
        stage,
        recovery_hint,
    )
}

fn model_request_error(
    error: &reqwest::Error,
    message: impl Into<String>,
    source: &str,
    stage: &str,
    recovery_hint: &str,
) -> ModelExecutionError {
    let (class, kind) = if error.is_timeout() {
        ("upstream_timeout", "timeout")
    } else if error.is_connect() {
        ("upstream_connect_failed", "connect")
    } else {
        ("upstream_request_failed", "request")
    };
    model_error_with_fields(
        model_error_with_data(class, message, class, source, stage, recovery_hint),
        &[("upstream_error_kind", json!(kind))],
    )
}

fn model_response_read_error(
    message: impl Into<String>,
    source: &str,
    stage: &str,
) -> ModelExecutionError {
    model_error_with_data(
        "upstream_response_read_failed",
        message,
        "upstream_response_read_failed",
        source,
        stage,
        "retry the request; if this repeats, inspect provider connectivity and response truncation",
    )
}

fn model_http_error(
    message: impl Into<String>,
    status: reqwest::StatusCode,
    body_preview: &str,
    source: &str,
    stage: &str,
) -> ModelExecutionError {
    model_error_with_fields(
        model_error_with_data(
            "upstream_http_error",
            message,
            "upstream_http_error",
            source,
            stage,
            "inspect provider status/body, adjust request or retry after provider-side recovery",
        ),
        &[
            ("http_status", json!(status.as_u16())),
            ("body_preview", json!(body_preview)),
        ],
    )
}

fn model_invalid_json_error(
    message: impl Into<String>,
    source: &str,
    stage: &str,
) -> ModelExecutionError {
    model_error_with_data(
        "upstream_invalid_json",
        message,
        "upstream_invalid_json",
        source,
        stage,
        "capture the provider response body and verify the expected JSON response contract",
    )
}

fn model_invalid_response_error(
    message: impl Into<String>,
    source: &str,
    stage: &str,
) -> ModelExecutionError {
    model_error_with_data(
        "upstream_invalid_response",
        message,
        "upstream_invalid_response",
        source,
        stage,
        "inspect the provider response shape and update the parser or retry with a supported route",
    )
}

fn model_client_init_error(
    message: impl Into<String>,
    source: &str,
    stage: &str,
) -> ModelExecutionError {
    model_error_with_data(
        "client_init_failed",
        message,
        "client_init_failed",
        source,
        stage,
        "inspect local TLS/HTTP client configuration and retry",
    )
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromptCacheCapability {
    AnthropicCompatible,
    Unsupported,
}

#[derive(Debug, Clone, Copy)]
struct PromptCacheOptions {
    enabled: bool,
    strategy: PromptCacheStrategy,
    user_last_n: usize,
    capability: PromptCacheCapability,
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

#[derive(Debug, Clone, Copy)]
struct RuntimeCacheWindowState {
    since_unix_ms: u128,
    model_baseline: ModelCatalogCacheMetrics,
    prompt_baseline: PromptCacheMetrics,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RuntimeCacheStatsSnapshotOptions {
    pub window_ms: Option<u64>,
    pub reset_window: bool,
}

fn runtime_cache_window_state() -> &'static Mutex<RuntimeCacheWindowState> {
    static WINDOW: OnceLock<Mutex<RuntimeCacheWindowState>> = OnceLock::new();
    WINDOW.get_or_init(|| {
        Mutex::new(RuntimeCacheWindowState {
            since_unix_ms: now_epoch_millis(),
            model_baseline: ModelCatalogCacheMetrics::default(),
            prompt_baseline: PromptCacheMetrics::default(),
        })
    })
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

fn subtract_model_catalog_metrics(
    current: ModelCatalogCacheMetrics,
    baseline: ModelCatalogCacheMetrics,
) -> ModelCatalogCacheMetrics {
    ModelCatalogCacheMetrics {
        hit_total: current.hit_total.saturating_sub(baseline.hit_total),
        miss_total: current.miss_total.saturating_sub(baseline.miss_total),
        stale_total: current.stale_total.saturating_sub(baseline.stale_total),
        write_total: current.write_total.saturating_sub(baseline.write_total),
    }
}

fn subtract_prompt_cache_metrics(
    current: PromptCacheMetrics,
    baseline: PromptCacheMetrics,
) -> PromptCacheMetrics {
    PromptCacheMetrics {
        enabled_total: current
            .enabled_total
            .saturating_sub(baseline.enabled_total),
        hint_attempted_total: current
            .hint_attempted_total
            .saturating_sub(baseline.hint_attempted_total),
        hint_applied_total: current
            .hint_applied_total
            .saturating_sub(baseline.hint_applied_total),
        usage_observed_total: current
            .usage_observed_total
            .saturating_sub(baseline.usage_observed_total),
        cached_tokens_total: current
            .cached_tokens_total
            .saturating_sub(baseline.cached_tokens_total),
    }
}

pub(crate) fn runtime_cache_stats_snapshot_with_options(
    options: RuntimeCacheStatsSnapshotOptions,
) -> Value {
    let now_ms = now_epoch_millis();
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
    let (window_since_unix_ms, model_window_metrics, prompt_window_metrics) =
        if let Ok(mut window_guard) = runtime_cache_window_state().lock() {
            let should_rotate_by_window = options
                .window_ms
                .map(|window_ms| {
                    window_ms > 0
                        && now_ms
                            .saturating_sub(window_guard.since_unix_ms)
                            >= u128::from(window_ms)
                })
                .unwrap_or(false);
            if options.reset_window || should_rotate_by_window {
                window_guard.since_unix_ms = now_ms;
                window_guard.model_baseline = model_metrics;
                window_guard.prompt_baseline = prompt_metrics;
            }
            (
                window_guard.since_unix_ms,
                subtract_model_catalog_metrics(model_metrics, window_guard.model_baseline),
                subtract_prompt_cache_metrics(prompt_metrics, window_guard.prompt_baseline),
            )
        } else {
            (
                now_ms,
                ModelCatalogCacheMetrics::default(),
                PromptCacheMetrics::default(),
            )
        };
    let window_duration_ms = now_ms.saturating_sub(window_since_unix_ms) as u64;
    json!({
        "process_since_unix_ms": now_ms,
        "window_since_unix_ms": window_since_unix_ms,
        "window_duration_ms": window_duration_ms,
        "window_policy_ms": options.window_ms,
        "model_catalog": {
            "cache_entries": model_catalog_entries,
            "hit_total": model_metrics.hit_total,
            "miss_total": model_metrics.miss_total,
            "stale_total": model_metrics.stale_total,
            "write_total": model_metrics.write_total,
            "window": {
                "hit_total": model_window_metrics.hit_total,
                "miss_total": model_window_metrics.miss_total,
                "stale_total": model_window_metrics.stale_total,
                "write_total": model_window_metrics.write_total,
            }
        },
        "prompt_cache": {
            "enabled_total": prompt_metrics.enabled_total,
            "hint_attempted_total": prompt_metrics.hint_attempted_total,
            "hint_applied_total": prompt_metrics.hint_applied_total,
            "usage_observed_total": prompt_metrics.usage_observed_total,
            "cached_tokens_total": prompt_metrics.cached_tokens_total,
            "window": {
                "enabled_total": prompt_window_metrics.enabled_total,
                "hint_attempted_total": prompt_window_metrics.hint_attempted_total,
                "hint_applied_total": prompt_window_metrics.hint_applied_total,
                "usage_observed_total": prompt_window_metrics.usage_observed_total,
                "cached_tokens_total": prompt_window_metrics.cached_tokens_total,
            }
        }
    })
}
