#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiCompatibleModelExecutor;

const KIMI_MODEL_REQUEST_MAX_ATTEMPTS: usize = 3;
#[cfg(test)]
const KIMI_MODEL_REQUEST_RETRY_BASE_DELAY_MS: u64 = 10;
#[cfg(not(test))]
const KIMI_MODEL_REQUEST_RETRY_BASE_DELAY_MS: u64 = 800;
#[cfg(test)]
const KIMI_MODEL_REQUEST_RETRY_MAX_DELAY_MS: u64 = 50;
#[cfg(not(test))]
const KIMI_MODEL_REQUEST_RETRY_MAX_DELAY_MS: u64 = 3_000;

fn normalize_attachment_type(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

fn normalize_attachment_source_type(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

fn map_kimi_upload_purpose(attachment_type: &str) -> Option<&'static str> {
    match attachment_type {
        "file" => Some("file-extract"),
        "image" => Some("image"),
        "video" => Some("video"),
        _ => None,
    }
}

fn upload_kimi_file_from_path(
    client: &Client,
    config: &RuntimeModelConfig,
    source_path: &str,
    purpose: &str,
) -> Result<String, ModelExecutionError> {
    let path = std::path::Path::new(source_path);
    if !path.is_file() {
        return Err(ModelExecutionError::new(
            "attachment_invalid",
            format!("attachment source is not a readable file: {}", path.display()),
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| "upload.bin".to_string());
    let file = std::fs::File::open(path).map_err(|error| {
        ModelExecutionError::new(
            "attachment_invalid",
            format!("failed to open attachment file {}: {error}", path.display()),
        )
    })?;
    let file_part = Part::reader(file).file_name(file_name);
    let form = Form::new()
        .part("file", file_part)
        .text("purpose", purpose.to_string());
    let endpoint = format!("{}/files", config.base_url);
    let response = client
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .multipart(form)
        .send()
        .map_err(|error| {
            let class = if error.is_timeout() {
                "upstream_timeout"
            } else if error.is_connect() {
                "upstream_connect_failed"
            } else {
                "upstream_request_failed"
            };
            ModelExecutionError::new(class, format!("kimi file upload failed: {error}"))
        })?;
    let status = response.status();
    let body = response.text().map_err(|error| {
        ModelExecutionError::new(
            "upstream_response_read_failed",
            format!("failed to read kimi upload response: {error}"),
        )
    })?;
    if !status.is_success() {
        let detail = body.chars().take(240).collect::<String>();
        return Err(ModelExecutionError::new(
            "upstream_http_error",
            format!("kimi file upload status={} body={detail}", status.as_u16()),
        ));
    }
    let parsed: Value = serde_json::from_str(&body).map_err(|error| {
        ModelExecutionError::new(
            "upstream_invalid_json",
            format!("invalid kimi upload response json: {error}"),
        )
    })?;
    let file_id = parsed
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ModelExecutionError::new(
                "upstream_invalid_response",
                "missing file id in kimi upload response",
            )
        })?;
    Ok(file_id.to_string())
}

fn fetch_kimi_file_content(
    client: &Client,
    config: &RuntimeModelConfig,
    file_id: &str,
) -> Result<String, ModelExecutionError> {
    let endpoint = format!("{}/files/{}/content", config.base_url, file_id);
    let response = client
        .get(&endpoint)
        .bearer_auth(&config.api_key)
        .send()
        .map_err(|error| {
            let class = if error.is_timeout() {
                "upstream_timeout"
            } else if error.is_connect() {
                "upstream_connect_failed"
            } else {
                "upstream_request_failed"
            };
            ModelExecutionError::new(class, format!("kimi file content fetch failed: {error}"))
        })?;
    let status = response.status();
    let body = response.text().map_err(|error| {
        ModelExecutionError::new(
            "upstream_response_read_failed",
            format!("failed to read kimi file content response: {error}"),
        )
    })?;
    if !status.is_success() {
        let detail = body.chars().take(240).collect::<String>();
        return Err(ModelExecutionError::new(
            "upstream_http_error",
            format!("kimi file content status={} body={detail}", status.as_u16()),
        ));
    }
    Ok(body)
}

fn classify_request_error_class(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "upstream_timeout"
    } else if error.is_connect() {
        "upstream_connect_failed"
    } else {
        "upstream_request_failed"
    }
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

#[derive(Debug, Default, Clone)]
struct KimiStreamToolCallAggregate {
    id: Option<String>,
    call_type: Option<String>,
    function_name: String,
    function_arguments: String,
}

#[derive(Debug, Default, Clone)]
struct KimiStreamChoiceAggregate {
    role: Option<String>,
    content: String,
    reasoning_content: String,
    finish_reason: Option<Value>,
    tool_calls: Vec<KimiStreamToolCallAggregate>,
}

fn append_stream_content(destination: &mut String, content: &Value) {
    if let Some(text) = content.as_str() {
        destination.push_str(text);
        return;
    }
    let Some(parts) = content.as_array() else {
        return;
    };
    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            destination.push_str(text);
            continue;
        }
        if let Some(text) = part.get("content").and_then(Value::as_str) {
            destination.push_str(text);
        }
    }
}

fn parse_kimi_stream_completion_payload(body_text: &str) -> Result<Value, ModelExecutionError> {
    let mut choices: Vec<KimiStreamChoiceAggregate> = Vec::new();
    let mut response_id: Option<String> = None;
    let mut response_model: Option<String> = None;
    let mut usage_payload: Option<Value> = None;
    let mut parsed_any_chunk = false;

    for raw_line in body_text.lines() {
        let trimmed = raw_line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            break;
        }
        let chunk: Value = serde_json::from_str(data).map_err(|error| {
            ModelExecutionError::new(
                "upstream_invalid_json",
                format!("invalid kimi stream chunk json: {error}"),
            )
        })?;
        parsed_any_chunk = true;
        if response_id.is_none() {
            response_id = chunk
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
        }
        if response_model.is_none() {
            response_model = chunk
                .get("model")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
        }
        if let Some(usage) = chunk.get("usage") {
            usage_payload = Some(usage.clone());
        }
        let Some(raw_choices) = chunk.get("choices").and_then(Value::as_array) else {
            continue;
        };
        for (fallback_index, raw_choice) in raw_choices.iter().enumerate() {
            let Some(choice_object) = raw_choice.as_object() else {
                continue;
            };
            let choice_index = choice_object
                .get("index")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(fallback_index);
            while choices.len() <= choice_index {
                choices.push(KimiStreamChoiceAggregate::default());
            }
            let choice = &mut choices[choice_index];
            if let Some(finish_reason) = choice_object.get("finish_reason") {
                if !finish_reason.is_null() {
                    choice.finish_reason = Some(finish_reason.clone());
                }
            }
            let Some(delta) = choice_object.get("delta").and_then(Value::as_object) else {
                continue;
            };
            if let Some(role) = delta.get("role").and_then(Value::as_str) {
                let normalized = role.trim();
                if !normalized.is_empty() {
                    choice.role = Some(normalized.to_string());
                }
            }
            if let Some(content) = delta.get("content") {
                append_stream_content(&mut choice.content, content);
            }
            if let Some(reasoning) = delta.get("reasoning_content").and_then(Value::as_str) {
                choice.reasoning_content.push_str(reasoning);
            }
            if let Some(raw_tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for (fallback_call_index, raw_tool_call) in raw_tool_calls.iter().enumerate() {
                    let Some(tool_call) = raw_tool_call.as_object() else {
                        continue;
                    };
                    let tool_call_index = tool_call
                        .get("index")
                        .and_then(Value::as_u64)
                        .map(|value| value as usize)
                        .unwrap_or(fallback_call_index);
                    while choice.tool_calls.len() <= tool_call_index {
                        choice
                            .tool_calls
                            .push(KimiStreamToolCallAggregate::default());
                    }
                    let aggregate = &mut choice.tool_calls[tool_call_index];
                    if let Some(id) = tool_call
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        aggregate.id = Some(id.to_string());
                    }
                    if let Some(call_type) = tool_call
                        .get("type")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        aggregate.call_type = Some(call_type.to_string());
                    }
                    if let Some(function) = tool_call.get("function").and_then(Value::as_object) {
                        if let Some(name_piece) = function.get("name").and_then(Value::as_str) {
                            aggregate.function_name.push_str(name_piece);
                        }
                        if let Some(arguments_piece) =
                            function.get("arguments").and_then(Value::as_str)
                        {
                            aggregate.function_arguments.push_str(arguments_piece);
                        }
                    }
                }
            }
        }
    }

    if !parsed_any_chunk {
        return Err(ModelExecutionError::new(
            "upstream_invalid_response",
            "kimi stream response contains no data chunks",
        ));
    }
    if choices.is_empty() {
        return Err(ModelExecutionError::new(
            "upstream_invalid_response",
            "kimi stream response has no choices",
        ));
    }

    let mut output_choices: Vec<Value> = Vec::new();
    for (index, choice) in choices.into_iter().enumerate() {
        let mut message = serde_json::Map::new();
        message.insert(
            "role".to_string(),
            Value::String(choice.role.unwrap_or_else(|| "assistant".to_string())),
        );
        if choice.content.is_empty() {
            message.insert("content".to_string(), Value::Null);
        } else {
            message.insert("content".to_string(), Value::String(choice.content));
        }
        if !choice.reasoning_content.is_empty() {
            message.insert(
                "reasoning_content".to_string(),
                Value::String(choice.reasoning_content),
            );
        }
        let mut output_tool_calls: Vec<Value> = Vec::new();
        for (tool_call_index, tool_call) in choice.tool_calls.into_iter().enumerate() {
            if tool_call.function_name.trim().is_empty() {
                continue;
            }
            let arguments = if tool_call.function_arguments.trim().is_empty() {
                "{}".to_string()
            } else {
                tool_call.function_arguments
            };
            output_tool_calls.push(json!({
                "id": tool_call.id.unwrap_or_else(|| format!("call_{}", tool_call_index + 1)),
                "type": tool_call.call_type.unwrap_or_else(|| "function".to_string()),
                "function": {
                    "name": tool_call.function_name,
                    "arguments": arguments,
                }
            }));
        }
        if !output_tool_calls.is_empty() {
            message.insert("tool_calls".to_string(), Value::Array(output_tool_calls.clone()));
        }
        let has_tool_calls = !output_tool_calls.is_empty();
        let finish_reason = choice.finish_reason.unwrap_or_else(|| {
            Value::String(if has_tool_calls {
                "tool_calls".to_string()
            } else {
                "stop".to_string()
            })
        });
        output_choices.push(json!({
            "index": index,
            "message": Value::Object(message),
            "finish_reason": finish_reason,
        }));
    }

    let mut output = serde_json::Map::new();
    output.insert("choices".to_string(), Value::Array(output_choices));
    if let Some(id) = response_id {
        output.insert("id".to_string(), Value::String(id));
    }
    if let Some(model) = response_model {
        output.insert("model".to_string(), Value::String(model));
    }
    if let Some(usage) = usage_payload {
        output.insert("usage".to_string(), usage);
    }
    Ok(Value::Object(output))
}

fn parse_model_response_payload(
    body_text: &str,
    provider_kind: ProviderKind,
) -> Result<Value, ModelExecutionError> {
    if let Ok(payload) = serde_json::from_str::<Value>(body_text) {
        return Ok(payload);
    }
    if provider_kind == ProviderKind::Kimi {
        return parse_kimi_stream_completion_payload(body_text);
    }
    Err(ModelExecutionError::new(
        "upstream_invalid_json",
        "invalid model response json",
    ))
}

#[derive(Debug, Clone)]
struct PromptCacheUsageObservation {
    cached_tokens_total: u64,
    payload: Value,
}

fn prompt_cache_capability_label(capability: PromptCacheCapability) -> &'static str {
    match capability {
        PromptCacheCapability::AnthropicCompatible => "anthropic_compatible",
        PromptCacheCapability::Unsupported => "unsupported",
    }
}

fn supports_prompt_cache_hints(config: &RuntimeModelConfig) -> bool {
    config.provider_kind == ProviderKind::OpenAiCompatible
        && config.provider_options.kimi.prompt_cache.capability
            == PromptCacheCapability::AnthropicCompatible
}

fn is_prompt_cache_hint_rejected(error: &ModelExecutionError) -> bool {
    if error.error_class != "upstream_http_error" {
        return false;
    }
    let normalized = error.message.to_ascii_lowercase();
    let status_mismatch = !normalized.contains("status=400") && !normalized.contains("status=422");
    if status_mismatch {
        return false;
    }
    let mentions_cache_control = normalized.contains("cache_control")
        || normalized.contains("cache control")
        || normalized.contains("ephemeral");
    if !mentions_cache_control {
        return false;
    }
    normalized.contains("unsupported")
        || normalized.contains("unknown")
        || normalized.contains("invalid")
        || normalized.contains("not allowed")
}

fn ensure_ephemeral_cache_control(block: &mut serde_json::Map<String, Value>) -> bool {
    if block.get("cache_control").is_some() {
        return true;
    }
    block.insert("cache_control".to_string(), json!({ "type": "ephemeral" }));
    true
}

fn stamp_user_message_prompt_cache_hint(message: &mut Value) -> bool {
    let Some(message_object) = message.as_object_mut() else {
        return false;
    };
    let role = message_object
        .get("role")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if role != "user" {
        return false;
    }
    if let Some(content) = message_object.get_mut("content") {
        if let Some(text) = content.as_str() {
            let normalized = text.trim();
            if normalized.is_empty() {
                return false;
            }
            let raw = text.to_string();
            *content = Value::Array(vec![json!({
                "type": "text",
                "text": raw,
                "cache_control": {
                    "type": "ephemeral"
                }
            })]);
            return true;
        }
        if let Some(parts) = content.as_array_mut() {
            for part in parts.iter_mut() {
                let Some(block) = part.as_object_mut() else {
                    continue;
                };
                let has_text_content = block
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .map(|value| !value.is_empty())
                    .unwrap_or(false)
                    || block
                        .get("content")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .map(|value| !value.is_empty())
                        .unwrap_or(false);
                if !has_text_content {
                    continue;
                }
                return ensure_ephemeral_cache_control(block);
            }
        }
    }
    false
}

fn apply_prompt_cache_hints(
    messages: &mut [Value],
    prompt_cache: PromptCacheOptions,
) -> usize {
    if !prompt_cache.enabled {
        return 0;
    }
    let max_user_messages = match prompt_cache.strategy {
        PromptCacheStrategy::UserLastN => prompt_cache.user_last_n,
    };
    if max_user_messages == 0 {
        return 0;
    }
    let mut applied = 0usize;
    let mut remaining = max_user_messages;
    for message in messages.iter_mut().rev() {
        if remaining == 0 {
            break;
        }
        if stamp_user_message_prompt_cache_hint(message) {
            applied += 1;
            remaining = remaining.saturating_sub(1);
        }
    }
    applied
}

fn parse_u64_value(value: Option<&Value>) -> u64 {
    value.and_then(Value::as_u64).unwrap_or(0)
}

fn extract_prompt_cache_usage_observation(response: &Value) -> Option<PromptCacheUsageObservation> {
    let usage = response.get("usage")?;
    let usage_object = usage.as_object()?;
    let cache_read_input_tokens = parse_u64_value(usage_object.get("cache_read_input_tokens"));
    let cache_creation_input_tokens = parse_u64_value(usage_object.get("cache_creation_input_tokens"));
    let cached_tokens_from_input_details = usage_object
        .get("input_tokens_details")
        .and_then(Value::as_object)
        .map(|details| parse_u64_value(details.get("cached_tokens")))
        .unwrap_or(0);
    let cached_tokens_from_prompt_details = usage_object
        .get("prompt_tokens_details")
        .and_then(Value::as_object)
        .map(|details| parse_u64_value(details.get("cached_tokens")))
        .unwrap_or(0);
    let cached_tokens_total = cache_read_input_tokens
        .max(cached_tokens_from_input_details)
        .max(cached_tokens_from_prompt_details);
    let observed = cache_read_input_tokens > 0
        || cache_creation_input_tokens > 0
        || cached_tokens_from_input_details > 0
        || cached_tokens_from_prompt_details > 0;
    if !observed {
        return None;
    }
    Some(PromptCacheUsageObservation {
        cached_tokens_total,
        payload: json!({
            "cached_tokens_total": cached_tokens_total,
            "cache_read_input_tokens": cache_read_input_tokens,
            "cache_creation_input_tokens": cache_creation_input_tokens,
            "input_details_cached_tokens": cached_tokens_from_input_details,
            "prompt_details_cached_tokens": cached_tokens_from_prompt_details,
        }),
    })
}

fn has_kimi_search_intent(user_text: &str) -> bool {
    let normalized = user_text.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    let patterns = [
        "联网",
        "搜索",
        "检索",
        "热点",
        "新闻",
        "source",
        "search",
        "latest",
        "news",
    ];
    patterns.iter().any(|pattern| normalized.contains(pattern))
}

fn split_code_fence_content(text: &str) -> (String, usize) {
    let mut outside_segments = Vec::new();
    let mut max_code_block_chars = 0usize;
    for (index, segment) in text.split("```").enumerate() {
        if index % 2 == 0 {
            outside_segments.push(segment);
            continue;
        }
        let chars = segment.chars().count();
        if chars > max_code_block_chars {
            max_code_block_chars = chars;
        }
    }
    (outside_segments.join(" "), max_code_block_chars)
}

fn is_code_heavy_without_tool_calls(content: &str) -> bool {
    if !content.contains("```") {
        return false;
    }
    let (outside, max_code_block_chars) = split_code_fence_content(content);
    if max_code_block_chars < 300 {
        return false;
    }
    let outside_non_whitespace = outside.chars().filter(|ch| !ch.is_whitespace()).count();
    outside_non_whitespace <= 40
}

fn should_trigger_no_tool_recovery(
    content: Option<&str>,
    mode: NoToolFallbackMode,
    has_tool_context: bool,
    recovery_rounds: usize,
    max_recovery_rounds: usize,
) -> bool {
    if mode == NoToolFallbackMode::Off || max_recovery_rounds == 0 || recovery_rounds >= max_recovery_rounds {
        return false;
    }
    let normalized = content.map(str::trim).unwrap_or_default();
    if normalized.is_empty() {
        return true;
    }
    if normalized.contains("未收到完整响应 !!!]") || normalized.contains("max_tokens !!!]") {
        return true;
    }
    if is_code_heavy_without_tool_calls(normalized) {
        return true;
    }
    if mode == NoToolFallbackMode::Strict && has_tool_context {
        return true;
    }
    false
}

fn detect_no_tool_recovery_reason(content: Option<&str>) -> &'static str {
    let normalized = content.map(str::trim).unwrap_or_default();
    if normalized.is_empty() {
        return "empty_response";
    }
    if normalized.contains("未收到完整响应 !!!]") || normalized.contains("max_tokens !!!]") {
        return "incomplete_response";
    }
    if is_code_heavy_without_tool_calls(normalized) {
        return "code_only_without_tool_calls";
    }
    "strict_policy_no_tool"
}

fn build_no_tool_recovery_prompt(recovery_round: usize, reason: &str) -> String {
    format!(
        "[System][no_tool fallback]\nreason={reason}\nrecovery_round={recovery_round}\n\
Model returned no actionable tool call in previous step.\n\
If filesystem, shell, or MCP interaction is needed, call the proper tool explicitly.\n\
If no tool is needed, return a concise final answer with clear completion signal."
    )
}

fn no_tool_fallback_mode_label(mode: NoToolFallbackMode) -> &'static str {
    match mode {
        NoToolFallbackMode::Off => "off",
        NoToolFallbackMode::Safe => "safe",
        NoToolFallbackMode::Strict => "strict",
    }
}

fn build_no_tool_fallback_event(event_type: &str, payload: Value) -> ModelTelemetryEvent {
    ModelTelemetryEvent {
        event_type: event_type.to_string(),
        payload: Some(payload),
    }
}

fn parse_non_empty_string_field(
    payload: &serde_json::Map<String, Value>,
    key: &str,
) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_ask_user_options(payload: &serde_json::Map<String, Value>) -> Vec<String> {
    let Some(raw_options) = payload.get("options").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut options = Vec::new();
    for raw in raw_options {
        let Some(option) = raw.as_str() else {
            continue;
        };
        let normalized = option.trim();
        if normalized.is_empty() {
            continue;
        }
        options.push(normalized.to_string());
        if options.len() >= 6 {
            break;
        }
    }
    options
}

fn parse_tool_interrupt(
    tool_call: &ToolCallInput,
    output: &ToolCallOutput,
) -> Result<Option<ModelExecutionInterrupt>, ModelExecutionError> {
    if !tool_call.name.trim().eq_ignore_ascii_case("ask_user_question") {
        return Ok(None);
    }
    let parsed: Value = serde_json::from_str(output.content.as_str()).map_err(|error| {
        ModelExecutionError::new(
            "invalid_tool_output",
            format!("ask_user_question output is not valid JSON: {error}"),
        )
    })?;
    let payload = parsed.as_object().ok_or_else(|| {
        ModelExecutionError::new(
            "invalid_tool_output",
            "ask_user_question output must be a JSON object",
        )
    })?;
    let payload_type = parse_non_empty_string_field(payload, "type").unwrap_or_default();
    if payload_type != "ask_user" {
        return Err(ModelExecutionError::new(
            "invalid_tool_output",
            "ask_user_question output type must be ask_user",
        ));
    }
    let question =
        parse_non_empty_string_field(payload, "question").ok_or_else(|| {
            ModelExecutionError::new(
                "invalid_tool_output",
                "ask_user_question output missing question",
            )
        })?;
    let question_id = parse_non_empty_string_field(payload, "question_id")
        .unwrap_or_else(|| format!("askq_{}", tool_call.id));
    let blocking_node_id = parse_non_empty_string_field(payload, "blocking_node_id")
        .unwrap_or_else(|| "node.unknown".to_string());
    let default_on_timeout = parse_non_empty_string_field(payload, "default_on_timeout")
        .unwrap_or_else(|| "continue_with_best_effort".to_string());
    let resume_token = parse_non_empty_string_field(payload, "resume_token")
        .unwrap_or_else(|| format!("resume_{}", tool_call.id));
    let created_at = parse_non_empty_string_field(payload, "created_at")
        .unwrap_or_else(|| "unix:0".to_string());
    let interrupt = ModelExecutionInterrupt::AskUser(ModelAskUserInterrupt {
        question_id,
        blocking_node_id,
        question,
        options: parse_ask_user_options(payload),
        default_on_timeout,
        resume_token,
        created_at,
    });
    Ok(Some(interrupt))
}

fn ensure_kimi_reasoning_content_for_assistant_messages(
    messages: &mut [Value],
    config: &RuntimeModelConfig,
) {
    if config.provider_kind != ProviderKind::Kimi {
        return;
    }
    for message in messages {
        let Some(message_object) = message.as_object_mut() else {
            continue;
        };
        let role = message_object
            .get("role")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let has_tool_calls = message_object
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(|items| !items.is_empty())
            .unwrap_or(false);
        if role != "assistant" && !(role.is_empty() && has_tool_calls) {
            continue;
        }
        if role.is_empty() && has_tool_calls {
            message_object.insert("role".to_string(), Value::String("assistant".to_string()));
        }
        if has_tool_calls && !message_object.contains_key("content") {
            message_object.insert("content".to_string(), Value::String(String::new()));
        }
        let has_reasoning_content = message_object
            .get("reasoning_content")
            .and_then(Value::as_str)
            .map(str::trim)
            .map(|value| !value.is_empty())
            .unwrap_or(false);
        if has_reasoning_content {
            continue;
        }
        message_object.insert(
            "reasoning_content".to_string(),
            Value::String("Reasoning kept for continuity.".to_string()),
        );
    }
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
                let class = classify_request_error_class(&error);
                let message = format!("model request failed: {error}");
                let is_retryable = retry_enabled
                    && attempt + 1 < max_attempts
                    && (error.is_timeout() || error.is_connect());
                if is_retryable {
                    last_retryable_error = Some(ModelExecutionError::new(class, message));
                    continue;
                }
                return Err(ModelExecutionError::new(class, message));
            }
        };

        let status = response.status();
        let body_text = response.text().map_err(|error| {
            ModelExecutionError::new(
                "upstream_response_read_failed",
                format!("failed to read model response body: {error}"),
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
        if is_retryable {
            if reasoning_context_error {
                force_disable_thinking_on_retry = true;
            }
            if temperature_validation_error {
                drop_sampling_controls_on_retry = true;
            }
            last_retryable_error = Some(ModelExecutionError::new(
                "upstream_http_error",
                format!(
                    "upstream status={} thinking={} body={detail}",
                    status.as_u16(),
                    request_thinking_state
                ),
            ));
            continue;
        }
        return Err(ModelExecutionError::new(
            "upstream_http_error",
            format!(
                "upstream status={} thinking={} body={detail}",
                status.as_u16(),
                request_thinking_state
            ),
        ));
    }

    Err(last_retryable_error.unwrap_or_else(|| {
        ModelExecutionError::new(
            "upstream_request_failed",
            "model request failed after retries without a terminal response",
        )
    }))
}

fn build_runtime_messages(
    input: &TurnExecuteInput,
    client: &Client,
    config: &RuntimeModelConfig,
) -> Result<Vec<Value>, ModelExecutionError> {
    let prompt = build_runtime_user_prompt(input);
    if config.provider_kind != ProviderKind::Kimi || input.attachments.is_empty() {
        return Ok(vec![json!({
            "role": "user",
            "content": prompt
        })]);
    }
    if !config.provider_options.kimi.files_enabled {
        return Ok(vec![json!({
            "role": "user",
            "content": prompt
        })]);
    }

    let mut system_messages: Vec<Value> = Vec::new();
    let mut user_parts: Vec<Value> = vec![json!({
        "type": "text",
        "text": prompt
    })];

    for attachment in &input.attachments {
        let attachment_type = normalize_attachment_type(&attachment.attachment_type);
        let source_type = normalize_attachment_source_type(&attachment.source_type);
        let source = attachment.source.trim();
        let _mime_type_hint = attachment
            .mime_type
            .as_deref()
            .map(str::trim)
            .unwrap_or("");
        if source.is_empty() {
            return Err(ModelExecutionError::new(
                "attachment_invalid",
                "attachment source is empty",
            ));
        }
        match attachment_type.as_str() {
            "file" => {
                let file_id = match source_type.as_str() {
                    "file_id" => source.to_string(),
                    "path" => upload_kimi_file_from_path(
                        client,
                        config,
                        source,
                        map_kimi_upload_purpose("file").unwrap_or("file-extract"),
                    )?,
                    "url" => {
                        return Err(ModelExecutionError::new(
                            "attachment_invalid",
                            "file attachment with source_type=url is not supported yet",
                        ))
                    }
                    _ => {
                        return Err(ModelExecutionError::new(
                            "attachment_invalid",
                            format!("unsupported attachment source_type: {}", attachment.source_type),
                        ))
                    }
                };
                let extracted = fetch_kimi_file_content(client, config, &file_id)?;
                let header = attachment
                    .filename
                    .as_ref()
                    .map(|name| format!("[Extracted file: {}]\n", name.trim()))
                    .unwrap_or_else(|| format!("[Extracted file id: {}]\n", file_id));
                system_messages.push(json!({
                    "role": "system",
                    "content": format!("{header}{extracted}")
                }));
            }
            "image" | "video" => {
                let media_url = match source_type.as_str() {
                    "file_id" => format!("ms://{}", source),
                    "path" => {
                        let purpose = map_kimi_upload_purpose(attachment_type.as_str()).ok_or_else(|| {
                            ModelExecutionError::new(
                                "attachment_invalid",
                                format!("unsupported attachment type: {}", attachment.attachment_type),
                            )
                        })?;
                        let file_id = upload_kimi_file_from_path(client, config, source, purpose)?;
                        format!("ms://{file_id}")
                    }
                    "url" => source.to_string(),
                    _ => {
                        return Err(ModelExecutionError::new(
                            "attachment_invalid",
                            format!("unsupported attachment source_type: {}", attachment.source_type),
                        ))
                    }
                };
                if attachment_type == "image" {
                    user_parts.push(json!({
                        "type": "image_url",
                        "image_url": {
                            "url": media_url
                        }
                    }));
                } else {
                    user_parts.push(json!({
                        "type": "video_url",
                        "video_url": {
                            "url": media_url
                        }
                    }));
                }
            }
            _ => {
                return Err(ModelExecutionError::new(
                    "attachment_invalid",
                    format!("unsupported attachment type: {}", attachment.attachment_type),
                ))
            }
        }
    }

    let mut messages = system_messages;
    messages.push(json!({
        "role": "user",
        "content": user_parts
    }));
    Ok(messages)
}

impl ModelExecutor for OpenAiCompatibleModelExecutor {
    fn generate_assistant_message(
        &self,
        input: &TurnExecuteInput,
        tools: &dyn ToolExecutor,
    ) -> Result<ModelExecutionOutput, ModelExecutionError> {
        let config = load_runtime_model_config(input.model_config.as_ref())?;
        let endpoint = format!("{}/chat/completions", config.base_url);

        let client = Client::builder()
            .timeout(Duration::from_millis(config.timeout_ms))
            .build()
            .map_err(|error| {
                ModelExecutionError::new(
                    "client_init_failed",
                    format!("failed to init runtime http client: {error}"),
                )
            })?;

        let mut messages = build_runtime_messages(input, &client, &config)?;
        let max_tool_rounds = resolve_max_tool_rounds(input);
        let max_recovery_rounds = resolve_max_recovery_rounds(input);
        let no_tool_fallback_mode = resolve_no_tool_fallback_mode(input);
        let mut tool_rounds = 0usize;
        let mut recovery_rounds = 0usize;
        let mut telemetry_events: Vec<ModelTelemetryEvent> = Vec::new();
        let mut last_recovery_reason: Option<String> = None;
        let kimi_search_intent = has_kimi_search_intent(&input.user_message);
        if config.provider_options.kimi.prompt_cache.enabled {
            record_prompt_cache_enabled();
        }
        loop {
            ensure_kimi_reasoning_content_for_assistant_messages(&mut messages, &config);
            let prompt_cache_enabled = config.provider_options.kimi.prompt_cache.enabled;
            let prompt_cache_supported = prompt_cache_enabled && supports_prompt_cache_hints(&config);
            let prompt_cache_capability =
                prompt_cache_capability_label(config.provider_options.kimi.prompt_cache.capability);
            let prompt_cache_strategy = match config.provider_options.kimi.prompt_cache.strategy {
                PromptCacheStrategy::UserLastN => "user_last_n",
            };
            let unhinted_messages = messages.clone();
            let prompt_cache_applied_messages = if prompt_cache_supported {
                apply_prompt_cache_hints(&mut messages, config.provider_options.kimi.prompt_cache)
            } else {
                0
            };
            if prompt_cache_enabled {
                record_prompt_cache_hint_attempt(prompt_cache_applied_messages > 0);
                telemetry_events.push(ModelTelemetryEvent {
                    event_type: "prompt_cache_hint_applied".to_string(),
                    payload: Some(json!({
                        "supported": prompt_cache_supported,
                        "capability": prompt_cache_capability,
                        "strategy": prompt_cache_strategy,
                        "user_last_n": config.provider_options.kimi.prompt_cache.user_last_n,
                        "applied_message_count": prompt_cache_applied_messages,
                    })),
                });
            }
            let mut body = json!({
                "model": config.model,
                "messages": messages.clone(),
            });
            if config.provider_kind == ProviderKind::Kimi {
                body["max_tokens"] = json!(config.provider_options.kimi.max_tokens);
                body["temperature"] = json!(config.provider_options.kimi.temperature);
                body["top_p"] = json!(config.provider_options.kimi.top_p);
            }
            if let Some(tool_definitions) = build_tool_definitions(input, &config) {
                body["tools"] = tool_definitions;
                body["tool_choice"] = json!("auto");
            }
            let has_tool_history = messages.iter().any(|message| {
                message
                    .get("role")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .map(|role| role == "tool")
                    .unwrap_or(false)
            });
            let should_disable_on_search_intent = config.provider_kind == ProviderKind::Kimi
                && kimi_search_intent
                && matches!(
                    config.provider_options.kimi.web_search_mode,
                    KimiWebSearchMode::BuiltinPreferred | KimiWebSearchMode::BuiltinOnly
                );
            let disable_on_builtin_setting =
                should_disable_thinking_for_kimi_builtin_web_search(&config)
                    && (kimi_search_intent || has_tool_history);
            let disable_thinking = disable_on_builtin_setting
                || should_disable_on_search_intent
                || (config.provider_kind == ProviderKind::Kimi && has_tool_history);
            if disable_thinking {
                body["thinking"] = json!({
                    "type": "disabled"
                });
            }
            if config.provider_kind == ProviderKind::Kimi {
                let stream_enabled = config.provider_options.kimi.stream && !disable_thinking;
                body["stream"] = json!(stream_enabled);
                if disable_thinking {
                    if let Some(object) = body.as_object_mut() {
                        object.remove("temperature");
                        object.remove("top_p");
                    }
                }
            }
            let body_text = match send_chat_completion_with_optional_kimi_retry(
                &client,
                &endpoint,
                &config.api_key,
                &body,
                config.provider_kind,
            ) {
                Ok(value) => value,
                Err(error)
                    if prompt_cache_applied_messages > 0
                        && is_prompt_cache_hint_rejected(&error) =>
                {
                    let mut fallback_body = body.clone();
                    fallback_body["messages"] = Value::Array(unhinted_messages);
                    telemetry_events.push(ModelTelemetryEvent {
                        event_type: "prompt_cache_hint_applied".to_string(),
                        payload: Some(json!({
                            "supported": false,
                            "capability": "unsupported",
                            "strategy": prompt_cache_strategy,
                            "user_last_n": config.provider_options.kimi.prompt_cache.user_last_n,
                            "applied_message_count": 0,
                            "fallback_retry": true,
                            "fallback_reason": "upstream_rejected_cache_control",
                        })),
                    });
                    send_chat_completion_with_optional_kimi_retry(
                        &client,
                        &endpoint,
                        &config.api_key,
                        &fallback_body,
                        config.provider_kind,
                    )?
                }
                Err(error) => return Err(error.with_telemetry_events(telemetry_events)),
            };
            let payload = parse_model_response_payload(&body_text, config.provider_kind)?;
            if let Some(observation) = extract_prompt_cache_usage_observation(&payload) {
                record_prompt_cache_usage(observation.cached_tokens_total);
                telemetry_events.push(ModelTelemetryEvent {
                    event_type: "prompt_cache_usage_observed".to_string(),
                    payload: Some(observation.payload),
                });
            }
            let tool_calls = extract_tool_calls(&payload)?;
            if !tool_calls.is_empty() {
                if input.tool_context.is_none() {
                    let all_supported = tool_calls.iter().all(|tool_call| {
                        is_kimi_tool_call_supported_without_local_context(tool_call, &config)
                    });
                    if !all_supported {
                        let tool_name = tool_calls
                            .first()
                            .map(|tool_call| tool_call.name.trim().to_string())
                            .filter(|value| !value.is_empty())
                            .unwrap_or_else(|| "unknown_tool".to_string());
                        return Err(ModelExecutionError::new(
                            "tool_call_not_supported",
                            format!("runtime v1 does not support tool calls yet: {tool_name}"),
                        )
                        .with_telemetry_events(telemetry_events));
                    }
                }
                if tool_rounds >= max_tool_rounds {
                    return Err(ModelExecutionError::new(
                        "tool_round_limit_exceeded",
                        format!(
                            "model exceeded tool round limit: rounds={tool_rounds} limit={max_tool_rounds}"
                        ),
                    )
                    .with_telemetry_events(telemetry_events));
                }
                let assistant_message = extract_first_assistant_message(&payload).ok_or_else(|| {
                    ModelExecutionError::new(
                        "upstream_invalid_response",
                        "missing choices[0].message in tool call response",
                    )
                })?;
                messages.push(assistant_message);
                for tool_call in tool_calls {
                    let output = tools
                        .execute_tool_call(&tool_call, input)
                        .map_err(|error| ModelExecutionError::new(&error.error_class, error.message))?;
                    if let Some(interrupt) = parse_tool_interrupt(&tool_call, &output)? {
                        return Ok(ModelExecutionOutput {
                            assistant_message: String::new(),
                            telemetry_events,
                            interrupt: Some(interrupt),
                        });
                    }
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_call.name,
                        "content": output.content,
                    }));
                }
                tool_rounds += 1;
                if recovery_rounds > 0 {
                    telemetry_events.push(build_no_tool_fallback_event(
                        "no_tool_fallback_succeeded",
                        json!({
                            "mode": no_tool_fallback_mode_label(no_tool_fallback_mode),
                            "recovery_rounds": recovery_rounds,
                            "max_recovery_rounds": max_recovery_rounds,
                            "terminal": "tool_calls",
                            "last_reason": last_recovery_reason.clone().unwrap_or_default(),
                        }),
                    ));
                    recovery_rounds = 0;
                    last_recovery_reason = None;
                }
                continue;
            }
            let content = extract_response_content(&payload);
            if should_trigger_no_tool_recovery(
                content.as_deref(),
                no_tool_fallback_mode,
                input.tool_context.is_some(),
                recovery_rounds,
                max_recovery_rounds,
            ) {
                let recovery_reason = detect_no_tool_recovery_reason(content.as_deref()).to_string();
                let assistant_message = extract_first_assistant_message(&payload).unwrap_or_else(|| {
                    json!({
                        "role": "assistant",
                        "content": content.clone().unwrap_or_default(),
                    })
                });
                messages.push(assistant_message);
                recovery_rounds += 1;
                telemetry_events.push(build_no_tool_fallback_event(
                    "no_tool_fallback_triggered",
                    json!({
                        "mode": no_tool_fallback_mode_label(no_tool_fallback_mode),
                        "reason": recovery_reason.clone(),
                        "recovery_round": recovery_rounds,
                        "max_recovery_rounds": max_recovery_rounds,
                        "has_tool_context": input.tool_context.is_some(),
                    }),
                ));
                last_recovery_reason = Some(recovery_reason.clone());
                messages.push(json!({
                    "role": "user",
                    "content": build_no_tool_recovery_prompt(
                        recovery_rounds,
                        &recovery_reason,
                    )
                }));
                continue;
            }
            if let Some(content) = content {
                if recovery_rounds > 0 {
                    telemetry_events.push(build_no_tool_fallback_event(
                        "no_tool_fallback_succeeded",
                        json!({
                            "mode": no_tool_fallback_mode_label(no_tool_fallback_mode),
                            "recovery_rounds": recovery_rounds,
                            "max_recovery_rounds": max_recovery_rounds,
                            "terminal": "assistant_content",
                            "last_reason": last_recovery_reason.clone().unwrap_or_default(),
                        }),
                    ));
                }
                return Ok(ModelExecutionOutput {
                    assistant_message: content,
                    telemetry_events,
                    interrupt: None,
                });
            }
            if recovery_rounds > 0 {
                telemetry_events.push(build_no_tool_fallback_event(
                    "no_tool_fallback_exhausted",
                    json!({
                        "mode": no_tool_fallback_mode_label(no_tool_fallback_mode),
                        "recovery_rounds": recovery_rounds,
                        "max_recovery_rounds": max_recovery_rounds,
                        "last_reason": last_recovery_reason.unwrap_or_else(|| "unknown".to_string()),
                    }),
                ));
            }
            return Err(ModelExecutionError::new(
                "upstream_invalid_response",
                "missing choices[0].message.content in model response",
            )
            .with_telemetry_events(telemetry_events));
        }
    }
}
