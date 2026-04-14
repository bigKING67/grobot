fn trim_trailing_slashes(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

fn read_required_env(key: &str) -> Result<String, ModelExecutionError> {
    let value = env::var(key).unwrap_or_default();
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(ModelExecutionError::new(
            "config_missing",
            format!("missing required env: {key}"),
        ));
    }
    Ok(normalized.to_string())
}

fn normalized_optional(raw: Option<&str>) -> Option<String> {
    match raw {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        None => None,
    }
}

fn read_required_env_or_override(
    key: &str,
    override_value: Option<&str>,
) -> Result<String, ModelExecutionError> {
    if let Some(value) = normalized_optional(override_value) {
        return Ok(value);
    }
    read_required_env(key)
}

fn read_timeout_ms() -> Result<u64, ModelExecutionError> {
    let raw = env::var(ENV_RUNTIME_TIMEOUT_MS).unwrap_or_default();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_RUNTIME_TIMEOUT_MS);
    }
    let parsed = trimmed.parse::<u64>().map_err(|_| {
        ModelExecutionError::new(
            "config_invalid",
            format!("invalid timeout ms in {ENV_RUNTIME_TIMEOUT_MS}: {trimmed}"),
        )
    })?;
    let clamped = parsed.clamp(MIN_RUNTIME_TIMEOUT_MS, MAX_RUNTIME_TIMEOUT_MS);
    Ok(clamped)
}

fn read_timeout_ms_with_override(
    override_value: Option<u64>,
) -> Result<u64, ModelExecutionError> {
    if let Some(parsed) = override_value {
        return Ok(parsed.clamp(MIN_RUNTIME_TIMEOUT_MS, MAX_RUNTIME_TIMEOUT_MS));
    }
    read_timeout_ms()
}

fn parse_cache_ttl_secs() -> u64 {
    let raw = env::var(ENV_MODEL_AUTO_CACHE_TTL_SECS).unwrap_or_default();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_MODEL_AUTO_CACHE_TTL_SECS;
    }
    let parsed = trimmed.parse::<u64>().unwrap_or(DEFAULT_MODEL_AUTO_CACHE_TTL_SECS);
    parsed.min(86_400)
}

fn now_epoch_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn model_catalog_cache() -> &'static Mutex<HashMap<String, ModelCatalogCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ModelCatalogCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_provider_kind(raw_kind: Option<&str>, base_url: &str, raw_model: &str) -> ProviderKind {
    let normalized = raw_kind
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if normalized == "kimi" {
        return ProviderKind::Kimi;
    }
    if normalized == "openai_compatible" || normalized == "openai-compatible" {
        return ProviderKind::OpenAiCompatible;
    }
    let model = raw_model.trim().to_ascii_lowercase();
    if base_url.to_ascii_lowercase().contains("moonshot.cn")
        || model.starts_with("kimi")
        || model.starts_with("moonshot")
    {
        return ProviderKind::Kimi;
    }
    ProviderKind::OpenAiCompatible
}

fn parse_kimi_web_search_mode(raw: Option<&str>) -> KimiWebSearchMode {
    let normalized = raw
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match normalized.as_str() {
        "builtin_only" => KimiWebSearchMode::BuiltinOnly,
        "official_only" => KimiWebSearchMode::OfficialOnly,
        "off" => KimiWebSearchMode::Off,
        "builtin_preferred" => KimiWebSearchMode::BuiltinPreferred,
        _ => KimiWebSearchMode::BuiltinPreferred,
    }
}

fn normalize_kimi_max_tokens(raw: Option<u32>) -> u32 {
    const DEFAULT_KIMI_MAX_TOKENS: u32 = 262_144;
    const MIN_KIMI_MAX_TOKENS: u32 = 1_024;
    let value = raw.unwrap_or(DEFAULT_KIMI_MAX_TOKENS);
    value.clamp(MIN_KIMI_MAX_TOKENS, DEFAULT_KIMI_MAX_TOKENS)
}

fn normalize_kimi_temperature(raw: Option<f64>) -> f64 {
    const DEFAULT_KIMI_TEMPERATURE: f64 = 1.0;
    let Some(value) = raw else {
        return DEFAULT_KIMI_TEMPERATURE;
    };
    if !value.is_finite() {
        return DEFAULT_KIMI_TEMPERATURE;
    }
    value.clamp(0.0, 2.0)
}

fn normalize_kimi_top_p(raw: Option<f64>) -> f64 {
    const DEFAULT_KIMI_TOP_P: f64 = 0.95;
    let Some(value) = raw else {
        return DEFAULT_KIMI_TOP_P;
    };
    if !value.is_finite() {
        return DEFAULT_KIMI_TOP_P;
    }
    value.clamp(0.0, 1.0)
}

fn default_kimi_official_tools_allowlist() -> Vec<String> {
    vec![
        "web_search".to_string(),
        "date".to_string(),
        "fetch".to_string(),
        "rethink".to_string(),
        "code_runner".to_string(),
    ]
}

fn resolve_kimi_options(input_config: Option<&RuntimeModelConfigInput>) -> KimiProviderOptions {
    let input_kimi = input_config
        .and_then(|config| config.provider_options.as_ref())
        .and_then(|options| options.kimi.as_ref());
    let allowlist = input_kimi
        .and_then(|options| options.official_tools_allowlist.clone())
        .unwrap_or_else(default_kimi_official_tools_allowlist);
    KimiProviderOptions {
        web_search_mode: parse_kimi_web_search_mode(
            input_kimi.and_then(|options| options.web_search_mode.as_deref()),
        ),
        disable_thinking_on_builtin_web_search: input_kimi
            .and_then(|options| options.disable_thinking_on_builtin_web_search)
            .unwrap_or(true),
        official_tools_allowlist: allowlist
            .into_iter()
            .map(|item| canonical_kimi_tool_name(&item))
            .filter(|item| !item.is_empty())
            .collect(),
        max_tokens: normalize_kimi_max_tokens(input_kimi.and_then(|options| options.max_tokens)),
        stream: input_kimi.and_then(|options| options.stream).unwrap_or(true),
        temperature: normalize_kimi_temperature(input_kimi.and_then(|options| options.temperature)),
        top_p: normalize_kimi_top_p(input_kimi.and_then(|options| options.top_p)),
        files_enabled: input_kimi
            .and_then(|options| options.files_enabled)
            .unwrap_or(true),
        allow_file_admin: input_kimi
            .and_then(|options| options.allow_file_admin)
            .unwrap_or(false),
    }
}

fn parse_model_ids_from_catalog(payload: &Value) -> Vec<String> {
    let Some(object) = payload.as_object() else {
        return Vec::new();
    };
    if let Some(data) = object.get("data").and_then(Value::as_array) {
        return data
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str))
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect();
    }
    if let Some(models) = object.get("models").and_then(Value::as_array) {
        return models
            .iter()
            .filter_map(|item| {
                if let Some(value) = item.as_str() {
                    return Some(value.trim().to_string());
                }
                item.get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .map(ToString::to_string)
            })
            .filter(|item| !item.is_empty())
            .collect();
    }
    Vec::new()
}

fn fetch_model_catalog(
    base_url: &str,
    api_key: &str,
    timeout_ms: u64,
) -> Result<Vec<String>, ModelExecutionError> {
    let endpoint = format!("{base_url}/models");
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            ModelExecutionError::new(
                "client_init_failed",
                format!("failed to init runtime http client for model catalog: {error}"),
            )
        })?;
    let response = client
        .get(&endpoint)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .send()
        .map_err(|error| {
            let class = if error.is_timeout() {
                "upstream_timeout"
            } else if error.is_connect() {
                "upstream_connect_failed"
            } else {
                "upstream_request_failed"
            };
            ModelExecutionError::new(class, format!("model catalog request failed: {error}"))
        })?;
    let status = response.status();
    let body_text = response.text().map_err(|error| {
        ModelExecutionError::new(
            "upstream_response_read_failed",
            format!("failed to read model catalog response: {error}"),
        )
    })?;
    if !status.is_success() {
        let detail = body_text.chars().take(240).collect::<String>();
        return Err(ModelExecutionError::new(
            "upstream_http_error",
            format!("model catalog upstream status={} body={detail}", status.as_u16()),
        ));
    }
    let payload: Value = serde_json::from_str(&body_text).map_err(|error| {
        ModelExecutionError::new(
            "upstream_invalid_json",
            format!("invalid model catalog response json: {error}"),
        )
    })?;
    Ok(parse_model_ids_from_catalog(&payload))
}

fn load_model_catalog_with_cache(
    base_url: &str,
    api_key: &str,
    timeout_ms: u64,
) -> Result<Vec<String>, ModelExecutionError> {
    let cache_ttl_secs = parse_cache_ttl_secs();
    let cache_key = format!("{base_url}|{api_key}");
    let now_millis = now_epoch_millis();
    if cache_ttl_secs > 0 {
        if let Ok(guard) = model_catalog_cache().lock() {
            if let Some(entry) = guard.get(&cache_key) {
                let expires_at = entry.cached_at_millis + (cache_ttl_secs as u128 * 1_000);
                if now_millis <= expires_at {
                    return Ok(entry.model_ids.clone());
                }
            }
        }
    }
    let model_ids = fetch_model_catalog(base_url, api_key, timeout_ms)?;
    if cache_ttl_secs > 0 {
        if let Ok(mut guard) = model_catalog_cache().lock() {
            guard.insert(
                cache_key,
                ModelCatalogCacheEntry {
                    model_ids: model_ids.clone(),
                    cached_at_millis: now_millis,
                },
            );
        }
    }
    Ok(model_ids)
}

fn pick_auto_model(model_ids: &[String], provider_kind: ProviderKind) -> Option<String> {
    if model_ids.is_empty() {
        return None;
    }
    if provider_kind == ProviderKind::Kimi {
        let priority_prefixes = [
            "kimi-k2.5",
            "kimi_k2.5",
            "kimi-k2",
            "kimi_k2",
            "kimi",
            "moonshot",
        ];
        for prefix in priority_prefixes {
            if let Some(preferred) = model_ids.iter().find(|item| {
                item.trim()
                    .to_ascii_lowercase()
                    .starts_with(prefix)
            }) {
                return Some(preferred.clone());
            }
        }
    }
    model_ids.first().cloned()
}

fn resolve_model_with_auto(
    raw_model: String,
    base_url: &str,
    api_key: &str,
    timeout_ms: u64,
    provider_kind: ProviderKind,
) -> Result<String, ModelExecutionError> {
    let normalized = raw_model.trim();
    if normalized.to_ascii_lowercase() != "auto" {
        return Ok(normalized.to_string());
    }
    let model_ids = load_model_catalog_with_cache(base_url, api_key, timeout_ms)?;
    let selected = pick_auto_model(&model_ids, provider_kind).ok_or_else(|| {
        ModelExecutionError::new(
            "config_invalid",
            "model=auto but upstream /models returned no selectable model",
        )
    })?;
    Ok(selected)
}

fn load_runtime_model_config(
    input_config: Option<&RuntimeModelConfigInput>,
) -> Result<RuntimeModelConfig, ModelExecutionError> {
    let base_url = trim_trailing_slashes(&read_required_env_or_override(
        ENV_BASE_URL,
        input_config.and_then(|config| config.base_url.as_deref()),
    )?);
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err(ModelExecutionError::new(
            "config_invalid",
            format!("{ENV_BASE_URL} must start with http:// or https://"),
        ));
    }
    let api_key = read_required_env_or_override(
        ENV_API_KEY,
        input_config.and_then(|config| config.api_key.as_deref()),
    )?;
    let timeout_ms = read_timeout_ms_with_override(input_config.and_then(|config| config.timeout_ms))?;
    let raw_model = read_required_env_or_override(
        ENV_MODEL,
        input_config.and_then(|config| config.model.as_deref()),
    )?;
    let provider_kind = parse_provider_kind(
        input_config.and_then(|config| config.provider_kind.as_deref()),
        &base_url,
        &raw_model,
    );
    let model = resolve_model_with_auto(raw_model, &base_url, &api_key, timeout_ms, provider_kind)?;
    Ok(RuntimeModelConfig {
        base_url,
        api_key,
        model,
        timeout_ms,
        provider_kind,
        provider_options: RuntimeProviderOptions {
            kimi: resolve_kimi_options(input_config),
        },
    })
}
