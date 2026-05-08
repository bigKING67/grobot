const KIMI_MODEL_REQUEST_MAX_ATTEMPTS: usize = 3;
#[cfg(test)]
const KIMI_MODEL_REQUEST_RETRY_BASE_DELAY_MS: u64 = 10;
#[cfg(not(test))]
const KIMI_MODEL_REQUEST_RETRY_BASE_DELAY_MS: u64 = 800;
#[cfg(test)]
const KIMI_MODEL_REQUEST_RETRY_MAX_DELAY_MS: u64 = 50;
#[cfg(not(test))]
const KIMI_MODEL_REQUEST_RETRY_MAX_DELAY_MS: u64 = 3_000;

fn truncate_header_value_for_diagnostics(raw: &str, max_chars: usize) -> String {
    let normalized = raw.trim().replace('\n', " ").replace('\r', " ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let truncated: String = normalized.chars().take(max_chars).collect();
    format!("{truncated}…")
}

fn summarize_response_headers_for_diagnostics(headers: &reqwest::header::HeaderMap) -> String {
    const CANDIDATE_KEYS: [&str; 8] = [
        "content-type",
        "content-encoding",
        "transfer-encoding",
        "content-length",
        "server",
        "via",
        "cf-ray",
        "x-request-id",
    ];
    let mut pairs: Vec<String> = Vec::new();
    for key in CANDIDATE_KEYS {
        let Some(raw_value) = headers.get(key) else {
            continue;
        };
        let Ok(value) = raw_value.to_str() else {
            continue;
        };
        let normalized = truncate_header_value_for_diagnostics(value, 96);
        if normalized.is_empty() {
            continue;
        }
        pairs.push(format!("{key}={normalized}"));
    }
    if pairs.is_empty() {
        return "<none>".to_string();
    }
    pairs.join(",")
}

fn should_retry_kimi_http_error(status: reqwest::StatusCode, body_text: &str) -> bool {
    if status.as_u16() == 429 || status.is_server_error() {
        return true;
    }
    if status.as_u16() == 400 {
        let normalized = body_text.to_ascii_lowercase();
        if normalized.contains("overloaded")
            || normalized.contains("too many requests")
            || normalized.contains("try again later")
        {
            return true;
        }
    }
    false
}

fn is_kimi_reasoning_context_error(status: reqwest::StatusCode, body_text: &str) -> bool {
    if status.as_u16() != 400 {
        return false;
    }
    body_text
        .to_ascii_lowercase()
        .contains("reasoning_content is missing")
}

fn is_kimi_temperature_validation_error(status: reqwest::StatusCode, body_text: &str) -> bool {
    if status.as_u16() != 400 {
        return false;
    }
    body_text
        .to_ascii_lowercase()
        .contains("invalid temperature")
}

fn kimi_retry_delay_ms(attempt_index: usize) -> u64 {
    if attempt_index == 0 {
        return 0;
    }
    let shift = (attempt_index.saturating_sub(1)).min(6) as u32;
    let multiplier = 1_u64 << shift;
    KIMI_MODEL_REQUEST_RETRY_BASE_DELAY_MS
        .saturating_mul(multiplier)
        .min(KIMI_MODEL_REQUEST_RETRY_MAX_DELAY_MS)
}

fn send_chat_completion_with_optional_kimi_retry(
    client: &Client,
    endpoint: &str,
    api_key: &str,
    body: &Value,
    provider_kind: ProviderKind,
) -> Result<String, ModelExecutionError> {
    let retry_enabled = provider_kind == ProviderKind::Kimi;
    let max_attempts = if retry_enabled {
        KIMI_MODEL_REQUEST_MAX_ATTEMPTS
    } else {
        1
    };
    let mut last_retryable_error: Option<ModelExecutionError> = None;
    let mut force_disable_thinking_on_retry = false;
    let mut drop_sampling_controls_on_retry = false;

    for attempt in 0..max_attempts {
        if retry_enabled && attempt > 0 {
            let delay_ms = kimi_retry_delay_ms(attempt);
            if delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
        }

        let mut request_body = body.clone();
        if retry_enabled && force_disable_thinking_on_retry {
            request_body["thinking"] = json!({
                "type": "disabled"
            });
        }
        if retry_enabled && drop_sampling_controls_on_retry {
            if let Some(object) = request_body.as_object_mut() {
                object.remove("temperature");
                object.remove("top_p");
            }
        }
        let request_thinking_state = request_body
            .get("thinking")
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| "enabled_or_unspecified".to_string());

        let response = match client
            .post(endpoint)
            .bearer_auth(api_key)
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
        {
            Ok(value) => value,
            Err(error) => {
                let message = format!("model request failed: {error}");
                let is_retryable = retry_enabled
                    && attempt + 1 < max_attempts
                    && (error.is_timeout() || error.is_connect());
                let model_error = model_error_with_fields(
                    model_request_error(
                        &error,
                        message,
                        "model.transport",
                        "chat_request",
                        "retry later or verify provider network connectivity",
                    ),
                    &[
                        ("provider", json!(provider_kind_label(provider_kind))),
                        ("attempt", json!(attempt + 1)),
                        ("max_attempts", json!(max_attempts)),
                        ("retryable", json!(is_retryable)),
                    ],
                );
                if is_retryable {
                    last_retryable_error = Some(model_error);
                    continue;
                }
                return Err(model_error);
            }
        };

        let status = response.status();
        let response_headers = summarize_response_headers_for_diagnostics(response.headers());
        let body_text = response.text().map_err(|error| {
            model_error_with_fields(
                model_response_read_error(
                    format!(
                        "failed to read model response body: {error}; status={}; headers={response_headers}",
                        status.as_u16()
                    ),
                    "model.transport",
                    "chat_response_read",
                ),
                &[
                    ("provider", json!(provider_kind_label(provider_kind))),
                    ("http_status", json!(status.as_u16())),
                    ("response_headers", json!(response_headers)),
                    ("attempt", json!(attempt + 1)),
                    ("max_attempts", json!(max_attempts)),
                ],
            )
        })?;
        if status.is_success() {
            return Ok(body_text);
        }
        let detail = body_text.chars().take(240).collect::<String>();
        let reasoning_context_error = retry_enabled && is_kimi_reasoning_context_error(status, &body_text);
        let temperature_validation_error =
            retry_enabled && is_kimi_temperature_validation_error(status, &body_text);
        let is_retryable = retry_enabled
            && attempt + 1 < max_attempts
            && (reasoning_context_error
                || temperature_validation_error
                || should_retry_kimi_http_error(status, &body_text));
        let model_error = model_error_with_fields(
            model_http_error(
                format!(
                    "upstream status={} thinking={} body={detail}",
                    status.as_u16(),
                    request_thinking_state
                ),
                status,
                detail.as_str(),
                "model.transport",
                "chat_http_status",
            ),
            &[
                ("provider", json!(provider_kind_label(provider_kind))),
                ("thinking", json!(request_thinking_state)),
                ("response_headers", json!(response_headers)),
                ("attempt", json!(attempt + 1)),
                ("max_attempts", json!(max_attempts)),
                ("retryable", json!(is_retryable)),
                ("kimi_reasoning_context_error", json!(reasoning_context_error)),
                ("kimi_temperature_validation_error", json!(temperature_validation_error)),
            ],
        );
        if is_retryable {
            if reasoning_context_error {
                force_disable_thinking_on_retry = true;
            }
            if temperature_validation_error {
                drop_sampling_controls_on_retry = true;
            }
            last_retryable_error = Some(model_error);
            continue;
        }
        return Err(model_error);
    }

    Err(last_retryable_error.unwrap_or_else(|| {
        model_error_with_fields(
            model_error_with_data(
                "upstream_request_failed",
                "model request failed after retries without a terminal response",
                "upstream_request_failed",
                "model.transport",
                "chat_retry_exhausted",
                "retry later or inspect provider/network stability before re-running the turn",
            ),
            &[
                ("provider", json!(provider_kind_label(provider_kind))),
                ("max_attempts", json!(max_attempts)),
            ],
        )
    }))
}
