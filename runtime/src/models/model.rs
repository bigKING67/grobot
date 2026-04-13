use crate::models::engine::TurnExecuteInput;
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::env;
use std::time::Duration;

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

fn load_runtime_model_config() -> Result<RuntimeModelConfig, ModelExecutionError> {
    let base_url = trim_trailing_slashes(&read_required_env(ENV_BASE_URL)?);
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err(ModelExecutionError::new(
            "config_invalid",
            format!("{ENV_BASE_URL} must start with http:// or https://"),
        ));
    }
    Ok(RuntimeModelConfig {
        base_url,
        api_key: read_required_env(ENV_API_KEY)?,
        model: read_required_env(ENV_MODEL)?,
        timeout_ms: read_timeout_ms()?,
    })
}

fn build_runtime_user_prompt(input: &TurnExecuteInput) -> String {
    if input.context_lines.is_empty() {
        return input.user_message.clone();
    }

    format!(
        "{}\n\n[Conversation Context]\n{}",
        input.user_message,
        input.context_lines.join("\n")
    )
}

fn extract_array_content(parts: &[Value]) -> String {
    let mut collected = Vec::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                collected.push(normalized.to_string());
            }
            continue;
        }
        if let Some(text) = part.get("content").and_then(Value::as_str) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                collected.push(normalized.to_string());
            }
        }
    }
    collected.join("\n")
}

fn extract_response_content(response: &Value) -> Option<String> {
    let choices = response.get("choices")?.as_array()?;
    let first = choices.first()?;
    let message = first.get("message")?;
    let content = message.get("content")?;

    if let Some(text) = content.as_str() {
        let normalized = text.trim();
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized.to_string());
    }

    if let Some(parts) = content.as_array() {
        let joined = extract_array_content(parts);
        let normalized = joined.trim();
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized.to_string());
    }

    None
}

#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiCompatibleModelExecutor;

impl ModelExecutor for OpenAiCompatibleModelExecutor {
    fn generate_assistant_message(
        &self,
        input: &TurnExecuteInput,
    ) -> Result<String, ModelExecutionError> {
        let config = load_runtime_model_config()?;
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

        let body = json!({
            "model": config.model,
            "messages": [
                {
                    "role": "user",
                    "content": build_runtime_user_prompt(input)
                }
            ]
        });

        let response = client
            .post(&endpoint)
            .bearer_auth(config.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|error| {
                let class = if error.is_timeout() {
                    "upstream_timeout"
                } else if error.is_connect() {
                    "upstream_connect_failed"
                } else {
                    "upstream_request_failed"
                };
                ModelExecutionError::new(class, format!("model request failed: {error}"))
            })?;

        let status = response.status();
        let body_text = response.text().map_err(|error| {
            ModelExecutionError::new(
                "upstream_response_read_failed",
                format!("failed to read model response body: {error}"),
            )
        })?;

        if !status.is_success() {
            let detail = body_text.chars().take(240).collect::<String>();
            return Err(ModelExecutionError::new(
                "upstream_http_error",
                format!("upstream status={} body={detail}", status.as_u16()),
            ));
        }

        let payload: Value = serde_json::from_str(&body_text).map_err(|error| {
            ModelExecutionError::new(
                "upstream_invalid_json",
                format!("invalid model response json: {error}"),
            )
        })?;

        extract_response_content(&payload).ok_or_else(|| {
            ModelExecutionError::new(
                "upstream_invalid_response",
                "missing choices[0].message.content in model response",
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{build_runtime_user_prompt, extract_response_content};
    use serde_json::json;

    #[test]
    fn extracts_plain_string_content() {
        let payload = json!({
            "choices": [
                {
                    "message": {
                        "content": "hello from model"
                    }
                }
            ]
        });
        let result = extract_response_content(&payload);
        assert_eq!(result.as_deref(), Some("hello from model"));
    }

    #[test]
    fn extracts_array_content_parts() {
        let payload = json!({
            "choices": [
                {
                    "message": {
                        "content": [
                            { "type": "text", "text": "line-1" },
                            { "type": "text", "text": "line-2" }
                        ]
                    }
                }
            ]
        });
        let result = extract_response_content(&payload);
        assert_eq!(result.as_deref(), Some("line-1\nline-2"));
    }

    #[test]
    fn builds_prompt_with_context() {
        let input = crate::models::engine::TurnExecuteInput {
            request_id: "req_1".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "请总结一下".to_string(),
            context_lines: vec!["A".to_string(), "B".to_string()],
        };
        let prompt = build_runtime_user_prompt(&input);
        assert!(prompt.contains("请总结一下"));
        assert!(prompt.contains("[Conversation Context]"));
        assert!(prompt.contains("A"));
        assert!(prompt.contains("B"));
    }
}
