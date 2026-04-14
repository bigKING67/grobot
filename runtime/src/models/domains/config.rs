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
    Ok(RuntimeModelConfig {
        base_url,
        api_key: read_required_env_or_override(
            ENV_API_KEY,
            input_config.and_then(|config| config.api_key.as_deref()),
        )?,
        model: read_required_env_or_override(
            ENV_MODEL,
            input_config.and_then(|config| config.model.as_deref()),
        )?,
        timeout_ms: read_timeout_ms_with_override(
            input_config.and_then(|config| config.timeout_ms),
        )?,
    })
}
