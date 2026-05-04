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
