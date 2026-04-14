#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiCompatibleModelExecutor;

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
    ) -> Result<String, ModelExecutionError> {
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
        let mut tool_rounds = 0usize;
        loop {
            let mut body = json!({
                "model": config.model,
                "messages": messages.clone(),
            });
            if let Some(tool_definitions) = build_tool_definitions(input, &config) {
                body["tools"] = tool_definitions;
                body["tool_choice"] = json!("auto");
            }
            if should_disable_thinking_for_kimi_builtin_web_search(&config) {
                body["thinking"] = json!({
                    "type": "disabled"
                });
            }
            let response = client
                .post(&endpoint)
                .bearer_auth(&config.api_key)
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
                        ));
                    }
                }
                if tool_rounds >= max_tool_rounds {
                    return Err(ModelExecutionError::new(
                        "tool_round_limit_exceeded",
                        format!(
                            "model exceeded tool round limit: rounds={tool_rounds} limit={max_tool_rounds}"
                        ),
                    ));
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
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_call.name,
                        "content": output.content,
                    }));
                }
                tool_rounds += 1;
                continue;
            }
            if let Some(content) = extract_response_content(&payload) {
                return Ok(content);
            }
            return Err(ModelExecutionError::new(
                "upstream_invalid_response",
                "missing choices[0].message.content in model response",
            ));
        }
    }
}
