fn trim_trailing_slashes(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

fn required_env_contract_path(key: &str) -> &str {
    match key {
        ENV_BASE_URL => "model_config.base_url",
        ENV_API_KEY => "model_config.api_key",
        ENV_MODEL => "model_config.model",
        _ => key,
    }
}

fn model_config_missing_error(key: &str) -> ModelExecutionError {
    let required_config = required_env_contract_path(key);
    ModelExecutionError::new(
        "config_missing",
        format!("missing required env: {key}"),
    )
    .with_data(json!({
        "diagnostic_kind": "config_missing",
        "required_config": required_config,
        "recovery_hint": "provide model_config or the matching runtime env, then run grobot status --probe --json before retrying",
        "source": "model_config",
        "stage": "required_config_resolve",
        "env_key": key,
    }))
}

fn invalid_model_config_error(
    field: &str,
    raw_value: Value,
    stage: &str,
    message: impl Into<String>,
    recovery_hint: &str,
) -> ModelExecutionError {
    model_error_with_fields(
        model_diagnostic_error(
            "config_invalid",
            message,
            "model_config",
            stage,
            recovery_hint,
        ),
        &[
            ("field", json!(field)),
            ("raw_value", raw_value),
            ("required_config", json!(field)),
        ],
    )
}

fn invalid_required_string_error(
    field: &str,
    raw_value: impl Into<String>,
    stage: &str,
    message: impl Into<String>,
) -> ModelExecutionError {
    invalid_model_config_error(
        field,
        json!(raw_value.into()),
        stage,
        message,
        "omit the field to use the next configured source, or provide a non-empty string",
    )
}

fn read_optional_env_candidate(key: &str, stage: &str, recovery_hint: &str) -> Result<Option<String>, ModelExecutionError> {
    let invalid = |raw_value: String, message: String| {
        model_error_with_fields(
            model_diagnostic_error("config_invalid", message, "model_config", stage, recovery_hint),
            &[
                ("field", json!(key)),
                ("env_key", json!(key)),
                ("raw_value", json!(raw_value)),
            ],
        )
    };
    match env::var(key) {
        Ok(value) => {
            let normalized = value.trim();
            if normalized.is_empty() {
                return Err(invalid(
                    value,
                    format!("{key} must be a non-empty string"),
                ));
            }
            Ok(Some(normalized.to_string()))
        }
        Err(env::VarError::NotPresent) => Ok(None),
        Err(env::VarError::NotUnicode(value)) => Err(invalid(
            value.to_string_lossy().to_string(),
            format!("{key} must be valid unicode"),
        )),
    }
}

fn read_required_env_candidate(key: &str) -> Result<Option<String>, ModelExecutionError> {
    match env::var(key) {
        Ok(value) => {
            let normalized = value.trim();
            if normalized.is_empty() {
                return Err(invalid_required_string_error(
                    key,
                    value,
                    "required_env_string_validate_non_empty",
                    format!("{key} must be a non-empty string"),
                ));
            }
            Ok(Some(normalized.to_string()))
        }
        Err(env::VarError::NotPresent) => Ok(None),
        Err(env::VarError::NotUnicode(value)) => Err(invalid_required_string_error(
            key,
            value.to_string_lossy().to_string(),
            "required_env_string_validate_unicode",
            format!("{key} must be valid unicode"),
        )),
    }
}

fn normalized_required_override(
    field: &str,
    raw: Option<&str>,
) -> Result<Option<String>, ModelExecutionError> {
    match raw {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(invalid_required_string_error(
                    field,
                    value,
                    "required_model_config_string_validate_non_empty",
                    format!("{field} must be a non-empty string"),
                ));
            }
            Ok(Some(trimmed.to_string()))
        }
        None => Ok(None),
    }
}

fn read_required_env_or_override(
    key: &str,
    override_field: &str,
    override_value: Option<&str>,
) -> Result<String, ModelExecutionError> {
    let env_value = read_required_env_candidate(key)?;
    if let Some(value) = normalized_required_override(override_field, override_value)? {
        return Ok(value);
    }
    env_value.ok_or_else(|| model_config_missing_error(key))
}

fn validate_model_config_u64_range(
    field: &str,
    value: u64,
    min: u64,
    max: u64,
    stage: &str,
) -> Result<u64, ModelExecutionError> {
    if value < min || value > max {
        return Err(invalid_model_config_error(
            field,
            json!(value),
            stage,
            format!("{field} must be an integer between {min} and {max}"),
            "omit the field to use the runtime default or provide a value within the documented range",
        ));
    }
    Ok(value)
}

fn validate_model_config_u32_range(
    field: &str,
    value: u32,
    min: u32,
    max: u32,
    stage: &str,
) -> Result<u32, ModelExecutionError> {
    if value < min || value > max {
        return Err(invalid_model_config_error(
            field,
            json!(value),
            stage,
            format!("{field} must be an integer between {min} and {max}"),
            "omit the field to use the runtime default or provide a value within the documented range",
        ));
    }
    Ok(value)
}

fn validate_model_config_f64_range(
    field: &str,
    value: f64,
    min: f64,
    max: f64,
    stage: &str,
) -> Result<f64, ModelExecutionError> {
    if !value.is_finite() || value < min || value > max {
        return Err(invalid_model_config_error(
            field,
            json!(value),
            stage,
            format!("{field} must be a number between {min} and {max}"),
            "omit the field to use the runtime default or provide a value within the documented range",
        ));
    }
    Ok(value)
}

fn read_timeout_ms() -> Result<u64, ModelExecutionError> {
    let Some(trimmed) = read_optional_env_candidate(
        ENV_RUNTIME_TIMEOUT_MS,
        "runtime_timeout_validate_non_empty",
        "unset GROBOT_RUNTIME_HTTP_TIMEOUT_MS to use the runtime default, or set it to an integer number of milliseconds",
    )? else {
        return Ok(DEFAULT_RUNTIME_TIMEOUT_MS);
    };
    let parsed = trimmed.parse::<u64>().map_err(|_| {
        model_error_with_fields(
            model_diagnostic_error(
                "config_invalid",
                format!("invalid timeout ms in {ENV_RUNTIME_TIMEOUT_MS}: {trimmed}"),
                "model_config",
                "runtime_timeout_parse",
                "set GROBOT_RUNTIME_HTTP_TIMEOUT_MS to an integer number of milliseconds",
            ),
            &[("env_key", json!(ENV_RUNTIME_TIMEOUT_MS)), ("raw_value", json!(trimmed))],
        )
    })?;
    validate_model_config_u64_range(
        ENV_RUNTIME_TIMEOUT_MS,
        parsed,
        MIN_RUNTIME_TIMEOUT_MS,
        MAX_RUNTIME_TIMEOUT_MS,
        "runtime_timeout_validate_range",
    )
}

fn read_timeout_ms_with_override(
    override_value: Option<u64>,
) -> Result<u64, ModelExecutionError> {
    if let Some(parsed) = override_value {
        return validate_model_config_u64_range(
            "model_config.timeout_ms",
            parsed,
            MIN_RUNTIME_TIMEOUT_MS,
            MAX_RUNTIME_TIMEOUT_MS,
            "runtime_timeout_override_validate_range",
        );
    }
    read_timeout_ms()
}

fn parse_cache_ttl_secs() -> Result<u64, ModelExecutionError> {
    let Some(trimmed) = read_optional_env_candidate(
        ENV_MODEL_AUTO_CACHE_TTL_SECS,
        "model_auto_cache_ttl_validate_non_empty",
        "unset GROBOT_MODEL_AUTO_CACHE_TTL_SECS to use the runtime default, or set it to an integer number of seconds between 0 and 86400",
    )? else {
        return Ok(DEFAULT_MODEL_AUTO_CACHE_TTL_SECS);
    };
    let parsed = trimmed.parse::<u64>().map_err(|_| {
        model_error_with_fields(
            model_diagnostic_error(
                "config_invalid",
                format!("invalid model auto cache ttl in {ENV_MODEL_AUTO_CACHE_TTL_SECS}: {trimmed}"),
                "model_config",
                "model_auto_cache_ttl_parse",
                "set GROBOT_MODEL_AUTO_CACHE_TTL_SECS to an integer number of seconds between 0 and 86400",
            ),
            &[("env_key", json!(ENV_MODEL_AUTO_CACHE_TTL_SECS)), ("raw_value", json!(trimmed))],
        )
    })?;
    validate_model_config_u64_range(
        ENV_MODEL_AUTO_CACHE_TTL_SECS,
        parsed,
        0,
        86_400,
        "model_auto_cache_ttl_validate_range",
    )
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

fn parse_provider_kind(
    raw_kind: Option<&str>,
    base_url: &str,
    raw_model: &str,
) -> Result<ProviderKind, ModelExecutionError> {
    let Some(raw_kind) = raw_kind else {
        let model = raw_model.trim().to_ascii_lowercase();
        if base_url.to_ascii_lowercase().contains("moonshot.cn")
            || model.starts_with("kimi")
            || model.starts_with("moonshot")
        {
            return Ok(ProviderKind::Kimi);
        }
        return Ok(ProviderKind::OpenAiCompatible);
    };
    let normalized = raw_kind.trim().to_ascii_lowercase();
    if normalized == "kimi" {
        return Ok(ProviderKind::Kimi);
    }
    if normalized == "openai_compatible" || normalized == "openai-compatible" {
        return Ok(ProviderKind::OpenAiCompatible);
    }
    Err(invalid_model_config_error(
        "model_config.provider_kind",
        json!(raw_kind),
        "provider_kind_validate",
        "model_config.provider_kind must be kimi, openai_compatible, or openai-compatible",
        "omit provider_kind to derive it from base_url/model, or set it to kimi/openai_compatible",
    ))
}

fn parse_kimi_web_search_mode(raw: Option<&str>) -> Result<KimiWebSearchMode, ModelExecutionError> {
    let Some(raw) = raw else {
        return Ok(KimiWebSearchMode::BuiltinPreferred);
    };
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "builtin_preferred" => Ok(KimiWebSearchMode::BuiltinPreferred),
        "builtin_only" => Ok(KimiWebSearchMode::BuiltinOnly),
        "official_only" => Ok(KimiWebSearchMode::OfficialOnly),
        "off" => Ok(KimiWebSearchMode::Off),
        _ => Err(invalid_model_config_error(
            "provider_options.kimi.web_search_mode",
            json!(raw),
            "kimi_web_search_mode_validate",
            "provider_options.kimi.web_search_mode must be builtin_preferred, builtin_only, official_only, or off",
            "omit web_search_mode to use builtin_preferred, or set one of the supported values",
        )),
    }
}

fn parse_prompt_cache_strategy(raw: Option<&str>) -> Result<PromptCacheStrategy, ModelExecutionError> {
    let Some(raw) = raw else {
        return Ok(PromptCacheStrategy::UserLastN);
    };
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "user_last_n" => Ok(PromptCacheStrategy::UserLastN),
        _ => Err(invalid_model_config_error(
            "provider_options.kimi.prompt_cache.strategy",
            json!(raw),
            "prompt_cache_strategy_validate",
            "provider_options.kimi.prompt_cache.strategy must be user_last_n",
            "omit prompt_cache.strategy to use user_last_n, or set it to user_last_n",
        )),
    }
}

fn parse_prompt_cache_capability(
    raw: Option<&str>,
) -> Result<PromptCacheCapability, ModelExecutionError> {
    let Some(raw) = raw else {
        return Ok(PromptCacheCapability::Unsupported);
    };
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "anthropic_compatible" | "anthropic-compatible" => {
            Ok(PromptCacheCapability::AnthropicCompatible)
        }
        "unsupported" | "none" | "off" => Ok(PromptCacheCapability::Unsupported),
        _ => Err(invalid_model_config_error(
            "provider_options.kimi.prompt_cache.capability",
            json!(raw),
            "prompt_cache_capability_validate",
            "provider_options.kimi.prompt_cache.capability must be anthropic_compatible or unsupported",
            "omit prompt_cache.capability to use unsupported, or set a supported capability",
        )),
    }
}

fn normalize_kimi_max_tokens(raw: Option<u32>) -> Result<u32, ModelExecutionError> {
    const DEFAULT_KIMI_MAX_TOKENS: u32 = 262_144;
    const MIN_KIMI_MAX_TOKENS: u32 = 1_024;
    let Some(value) = raw else {
        return Ok(DEFAULT_KIMI_MAX_TOKENS);
    };
    validate_model_config_u32_range(
        "provider_options.kimi.max_tokens",
        value,
        MIN_KIMI_MAX_TOKENS,
        DEFAULT_KIMI_MAX_TOKENS,
        "kimi_max_tokens_validate_range",
    )
}

fn normalize_kimi_temperature(raw: Option<f64>) -> Result<f64, ModelExecutionError> {
    const DEFAULT_KIMI_TEMPERATURE: f64 = 1.0;
    let Some(value) = raw else {
        return Ok(DEFAULT_KIMI_TEMPERATURE);
    };
    validate_model_config_f64_range(
        "provider_options.kimi.temperature",
        value,
        0.0,
        2.0,
        "kimi_temperature_validate_range",
    )
}

fn normalize_kimi_top_p(raw: Option<f64>) -> Result<f64, ModelExecutionError> {
    const DEFAULT_KIMI_TOP_P: f64 = 0.95;
    let Some(value) = raw else {
        return Ok(DEFAULT_KIMI_TOP_P);
    };
    validate_model_config_f64_range(
        "provider_options.kimi.top_p",
        value,
        0.0,
        1.0,
        "kimi_top_p_validate_range",
    )
}

fn normalize_prompt_cache_user_last_n(raw: Option<u32>) -> Result<usize, ModelExecutionError> {
    const DEFAULT_PROMPT_CACHE_USER_LAST_N: usize = 2;
    const MIN_PROMPT_CACHE_USER_LAST_N: usize = 1;
    const MAX_PROMPT_CACHE_USER_LAST_N: usize = 12;
    let Some(value) = raw else {
        return Ok(DEFAULT_PROMPT_CACHE_USER_LAST_N);
    };
    let normalized = value as usize;
    if normalized < MIN_PROMPT_CACHE_USER_LAST_N || normalized > MAX_PROMPT_CACHE_USER_LAST_N {
        return Err(invalid_model_config_error(
            "provider_options.kimi.prompt_cache.user_last_n",
            json!(value),
            "prompt_cache_user_last_n_validate_range",
            "provider_options.kimi.prompt_cache.user_last_n must be an integer between 1 and 12",
            "omit prompt_cache.user_last_n to use the runtime default, or set a value between 1 and 12",
        ));
    }
    Ok(normalized)
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

fn normalize_kimi_official_tools_allowlist(
    raw: Option<&Vec<String>>,
) -> Result<Vec<String>, ModelExecutionError> {
    let Some(raw_values) = raw else {
        return Ok(default_kimi_official_tools_allowlist());
    };
    if raw_values.is_empty() {
        return Err(invalid_model_config_error(
            "provider_options.kimi.official_tools_allowlist",
            json!(raw_values),
            "kimi_official_tools_allowlist_validate",
            "provider_options.kimi.official_tools_allowlist must be a non-empty array of strings",
            "omit official_tools_allowlist to use the runtime default, or provide unique non-empty tool names",
        ));
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(raw_values.len());
    for item in raw_values {
        let canonical = canonical_kimi_tool_name(item);
        if canonical.is_empty() {
            return Err(invalid_model_config_error(
                "provider_options.kimi.official_tools_allowlist",
                json!(raw_values),
                "kimi_official_tools_allowlist_validate",
                "provider_options.kimi.official_tools_allowlist entries must be non-empty strings",
                "omit official_tools_allowlist to use the runtime default, or provide unique non-empty tool names",
            ));
        }
        if !seen.insert(canonical.clone()) {
            return Err(invalid_model_config_error(
                "provider_options.kimi.official_tools_allowlist",
                json!(raw_values),
                "kimi_official_tools_allowlist_validate",
                "provider_options.kimi.official_tools_allowlist values must be unique",
                "omit official_tools_allowlist to use the runtime default, or remove duplicate tool names",
            ));
        }
        normalized.push(canonical);
    }
    Ok(normalized)
}

fn resolve_kimi_options(input_config: Option<&RuntimeModelConfigInput>) -> Result<KimiProviderOptions, ModelExecutionError> {
    let input_kimi = input_config
        .and_then(|config| config.provider_options.as_ref())
        .and_then(|options| options.kimi.as_ref());
    let allowlist = normalize_kimi_official_tools_allowlist(
        input_kimi.and_then(|options| options.official_tools_allowlist.as_ref()),
    )?;
    let prompt_cache_input = input_kimi.and_then(|options| options.prompt_cache.as_ref());
    Ok(KimiProviderOptions {
        web_search_mode: parse_kimi_web_search_mode(
            input_kimi.and_then(|options| options.web_search_mode.as_deref()),
        )?,
        disable_thinking_on_builtin_web_search: input_kimi
            .and_then(|options| options.disable_thinking_on_builtin_web_search)
            .unwrap_or(true),
        official_tools_allowlist: allowlist,
        prompt_cache: PromptCacheOptions {
            enabled: prompt_cache_input
                .and_then(|options| options.enabled)
                .unwrap_or(false),
            strategy: parse_prompt_cache_strategy(
                prompt_cache_input.and_then(|options| options.strategy.as_deref()),
            )?,
            user_last_n: normalize_prompt_cache_user_last_n(
                prompt_cache_input.and_then(|options| options.user_last_n),
            )?,
            capability: parse_prompt_cache_capability(
                prompt_cache_input.and_then(|options| options.capability.as_deref()),
            )?,
        },
        max_tokens: normalize_kimi_max_tokens(input_kimi.and_then(|options| options.max_tokens))?,
        stream: input_kimi.and_then(|options| options.stream).unwrap_or(true),
        temperature: normalize_kimi_temperature(input_kimi.and_then(|options| options.temperature))?,
        top_p: normalize_kimi_top_p(input_kimi.and_then(|options| options.top_p))?,
        files_enabled: input_kimi
            .and_then(|options| options.files_enabled)
            .unwrap_or(true),
        allow_file_admin: input_kimi
            .and_then(|options| options.allow_file_admin)
            .unwrap_or(false),
    })
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
            model_client_init_error(
                format!("failed to init runtime http client for model catalog: {error}"),
                "model.catalog",
                "catalog_client_init",
            )
        })?;
    let response = client
        .get(&endpoint)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .send()
        .map_err(|error| {
            model_request_error(
                &error,
                format!("model catalog request failed: {error}"),
                "model.catalog",
                "catalog_request",
                "retry later or verify provider network connectivity and /models availability",
            )
        })?;
    let status = response.status();
    let body_text = response.text().map_err(|error| {
        model_error_with_fields(
            model_response_read_error(
                format!("failed to read model catalog response: {error}"),
                "model.catalog",
                "catalog_response_read",
            ),
            &[("http_status", json!(status.as_u16()))],
        )
    })?;
    if !status.is_success() {
        let detail = body_text.chars().take(240).collect::<String>();
        return Err(model_http_error(
            format!("model catalog upstream status={} body={detail}", status.as_u16()),
            status,
            detail.as_str(),
            "model.catalog",
            "catalog_http_status",
        ));
    }
    let payload: Value = serde_json::from_str(&body_text).map_err(|error| {
        model_invalid_json_error(
            format!("invalid model catalog response json: {error}"),
            "model.catalog",
            "catalog_parse_json",
        )
    })?;
    Ok(parse_model_ids_from_catalog(&payload))
}

fn load_model_catalog_with_cache(
    base_url: &str,
    api_key: &str,
    timeout_ms: u64,
) -> Result<Vec<String>, ModelExecutionError> {
    let cache_ttl_secs = parse_cache_ttl_secs()?;
    let cache_key = format!("{base_url}|{api_key}");
    let now_millis = now_epoch_millis();
    if cache_ttl_secs > 0 {
        if let Ok(guard) = model_catalog_cache().lock() {
            if let Some(entry) = guard.get(&cache_key) {
                let expires_at = entry.cached_at_millis + (cache_ttl_secs as u128 * 1_000);
                if now_millis <= expires_at {
                    record_model_catalog_cache_hit();
                    return Ok(entry.model_ids.clone());
                }
                record_model_catalog_cache_stale();
            }
        }
    }
    record_model_catalog_cache_miss();
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
        record_model_catalog_cache_write();
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
        model_error_with_fields(
            model_diagnostic_error(
                "config_invalid",
                "model=auto but upstream /models returned no selectable model",
                "model.catalog",
                "auto_model_select",
                "set an explicit model or verify the provider /models response includes selectable model ids",
            ),
            &[
                ("provider", json!(provider_kind_label(provider_kind))),
                ("model_count", json!(model_ids.len())),
            ],
        )
    })?;
    Ok(selected)
}

fn load_runtime_model_config(
    input_config: Option<&RuntimeModelConfigInput>,
) -> Result<RuntimeModelConfig, ModelExecutionError> {
    let base_url = trim_trailing_slashes(&read_required_env_or_override(
        ENV_BASE_URL,
        "model_config.base_url",
        input_config.and_then(|config| config.base_url.as_deref()),
    )?);
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err(model_error_with_fields(
            model_diagnostic_error(
                "config_invalid",
                format!("{ENV_BASE_URL} must start with http:// or https://"),
                "model_config",
                "base_url_validate_scheme",
                "configure model_config.base_url with an http:// or https:// provider endpoint",
            ),
            &[("required_config", json!("model_config.base_url"))],
        ));
    }
    let api_key = read_required_env_or_override(
        ENV_API_KEY,
        "model_config.api_key",
        input_config.and_then(|config| config.api_key.as_deref()),
    )?;
    let timeout_ms = read_timeout_ms_with_override(input_config.and_then(|config| config.timeout_ms))?;
    let raw_model = read_required_env_or_override(
        ENV_MODEL,
        "model_config.model",
        input_config.and_then(|config| config.model.as_deref()),
    )?;
    let provider_kind = parse_provider_kind(
        input_config.and_then(|config| config.provider_kind.as_deref()),
        &base_url,
        &raw_model,
    )?;
    let model = resolve_model_with_auto(raw_model, &base_url, &api_key, timeout_ms, provider_kind)?;
    Ok(RuntimeModelConfig {
        base_url,
        api_key,
        model,
        timeout_ms,
        provider_kind,
        provider_options: RuntimeProviderOptions {
            kimi: resolve_kimi_options(input_config)?,
        },
    })
}
