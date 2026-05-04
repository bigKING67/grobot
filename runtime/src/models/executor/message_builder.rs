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

fn build_runtime_messages(
    input: &TurnExecuteInput,
    client: &Client,
    config: &RuntimeModelConfig,
) -> Result<Vec<Value>, ModelExecutionError> {
    let prompt = build_runtime_user_prompt(input);
    let mut system_messages: Vec<Value> = Vec::new();
    if let Some(system_prompt) = input.system_prompt.as_deref().map(str::trim) {
        if !system_prompt.is_empty() {
            system_messages.push(json!({
                "role": "system",
                "content": system_prompt
            }));
        }
    }
    if config.provider_kind != ProviderKind::Kimi || input.attachments.is_empty() {
        let mut messages = system_messages;
        messages.push(json!({
            "role": "user",
            "content": prompt
        }));
        return Ok(messages);
    }
    if !config.provider_options.kimi.files_enabled {
        let mut messages = system_messages;
        messages.push(json!({
            "role": "user",
            "content": prompt
        }));
        return Ok(messages);
    }

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
