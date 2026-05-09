#[derive(Debug, Default, Clone)]
struct KimiStreamToolCallAggregate {
    seen: bool,
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

fn kimi_stream_invalid_response_error(
    message: impl Into<String>,
    stage: &str,
    fields: &[(&str, Value)],
) -> ModelExecutionError {
    model_error_with_fields(
        model_invalid_response_error(message, "model.kimi_stream", stage),
        &[fields, &[("provider", json!("kimi"))]].concat(),
    )
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
            model_error_with_fields(
                model_invalid_json_error(
                    format!("invalid kimi stream chunk json: {error}"),
                    "model.kimi_stream",
                    "stream_chunk_parse_json",
                ),
                &[("provider", json!("kimi"))],
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
        let Some(raw_choices_value) = chunk.get("choices") else {
            continue;
        };
        let raw_choices = raw_choices_value.as_array().ok_or_else(|| {
            kimi_stream_invalid_response_error(
                "kimi stream chunk choices must be an array when present",
                "stream_choices_validate_array",
                &[("raw_value", raw_choices_value.clone())],
            )
        })?;
        for (fallback_index, raw_choice) in raw_choices.iter().enumerate() {
            let choice_object = raw_choice.as_object().ok_or_else(|| {
                kimi_stream_invalid_response_error(
                    "kimi stream choices entries must be objects",
                    "stream_choice_validate_object",
                    &[
                        ("choice_index", json!(fallback_index)),
                        ("raw_value", raw_choice.clone()),
                    ],
                )
            })?;
            let choice_index = choice_object
                .get("index")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .ok_or_else(|| {
                    kimi_stream_invalid_response_error(
                        "kimi stream choice.index is missing",
                        "stream_choice_index_parse",
                        &[("choice_index", json!(fallback_index))],
                    )
                })?;
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
            if let Some(raw_tool_calls_value) = delta.get("tool_calls") {
                let raw_tool_calls = raw_tool_calls_value.as_array().ok_or_else(|| {
                    kimi_stream_invalid_response_error(
                        "kimi stream delta.tool_calls must be an array when present",
                        "stream_tool_calls_validate_array",
                        &[
                            ("choice_index", json!(choice_index)),
                            ("raw_value", raw_tool_calls_value.clone()),
                        ],
                    )
                })?;
                for (fallback_call_index, raw_tool_call) in raw_tool_calls.iter().enumerate() {
                    let tool_call = raw_tool_call.as_object().ok_or_else(|| {
                        kimi_stream_invalid_response_error(
                            "kimi stream tool_calls entries must be objects",
                            "stream_tool_call_validate_object",
                            &[
                                ("choice_index", json!(choice_index)),
                                ("tool_call_index", json!(fallback_call_index)),
                                ("raw_value", raw_tool_call.clone()),
                            ],
                        )
                    })?;
                    let tool_call_index = tool_call
                        .get("index")
                        .and_then(Value::as_u64)
                        .map(|value| value as usize)
                        .ok_or_else(|| {
                            kimi_stream_invalid_response_error(
                                "kimi stream tool_call.index is missing",
                                "stream_tool_call_index_parse",
                                &[
                                    ("choice_index", json!(choice_index)),
                                    ("tool_call_index", json!(fallback_call_index)),
                                ],
                            )
                        })?;
                    while choice.tool_calls.len() <= tool_call_index {
                        choice
                            .tool_calls
                            .push(KimiStreamToolCallAggregate::default());
                    }
                    let aggregate = &mut choice.tool_calls[tool_call_index];
                    aggregate.seen = true;
                    if let Some(id_value) = tool_call.get("id") {
                        let id = id_value
                            .as_str()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .ok_or_else(|| {
                                kimi_stream_invalid_response_error(
                                    "kimi stream tool_call.id must be a non-empty string",
                                    "stream_tool_call_id_parse",
                                    &[
                                        ("choice_index", json!(choice_index)),
                                        ("tool_call_index", json!(tool_call_index)),
                                        ("raw_value", id_value.clone()),
                                    ],
                                )
                            })?;
                        aggregate.id = Some(id.to_string());
                    }
                    if let Some(call_type_value) = tool_call.get("type") {
                        let call_type = call_type_value
                            .as_str()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .ok_or_else(|| {
                                kimi_stream_invalid_response_error(
                                    "kimi stream tool_call.type must be a non-empty string",
                                    "stream_tool_call_type_parse",
                                    &[
                                        ("choice_index", json!(choice_index)),
                                        ("tool_call_index", json!(tool_call_index)),
                                        ("raw_value", call_type_value.clone()),
                                    ],
                                )
                            })?;
                        aggregate.call_type = Some(call_type.to_string());
                    }
                    if let Some(function_value) = tool_call.get("function") {
                        let function = function_value.as_object().ok_or_else(|| {
                            kimi_stream_invalid_response_error(
                                "kimi stream tool_call.function must be an object when present",
                                "stream_tool_call_function_parse",
                                &[
                                    ("choice_index", json!(choice_index)),
                                    ("tool_call_index", json!(tool_call_index)),
                                    ("raw_value", function_value.clone()),
                                ],
                            )
                        })?;
                        if let Some(name_value) = function.get("name") {
                            let name_piece = name_value.as_str().ok_or_else(|| {
                                kimi_stream_invalid_response_error(
                                    "kimi stream tool_call.function.name must be a string",
                                    "stream_tool_call_name_parse",
                                    &[
                                        ("choice_index", json!(choice_index)),
                                        ("tool_call_index", json!(tool_call_index)),
                                        ("raw_value", name_value.clone()),
                                    ],
                                )
                            })?;
                            aggregate.function_name.push_str(name_piece);
                        }
                        if let Some(arguments_value) = function.get("arguments") {
                            let arguments_piece = arguments_value.as_str().ok_or_else(|| {
                                kimi_stream_invalid_response_error(
                                    "kimi stream tool_call.function.arguments must be a string",
                                    "stream_tool_call_arguments_parse",
                                    &[
                                        ("choice_index", json!(choice_index)),
                                        ("tool_call_index", json!(tool_call_index)),
                                        ("raw_value", arguments_value.clone()),
                                    ],
                                )
                            })?;
                            aggregate.function_arguments.push_str(arguments_piece);
                        }
                    }
                }
            }
        }
    }

    if !parsed_any_chunk {
        return Err(model_error_with_fields(
            model_invalid_response_error(
                "kimi stream response contains no data chunks",
                "model.kimi_stream",
                "stream_no_data_chunks",
            ),
            &[("provider", json!("kimi"))],
        ));
    }
    if choices.is_empty() {
        return Err(model_error_with_fields(
            model_invalid_response_error(
                "kimi stream response has no choices",
                "model.kimi_stream",
                "stream_no_choices",
            ),
            &[("provider", json!("kimi"))],
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
            if !tool_call.seen {
                continue;
            }
            if tool_call.function_name.trim().is_empty() {
                return Err(kimi_stream_invalid_response_error(
                    "kimi stream tool_call.function.name is missing",
                    "stream_tool_call_name_parse",
                    &[
                        ("choice_index", json!(index)),
                        ("tool_call_index", json!(tool_call_index)),
                    ],
                ));
            }
            let id = tool_call.id.ok_or_else(|| {
                kimi_stream_invalid_response_error(
                    "kimi stream tool_call.id is missing",
                    "stream_tool_call_id_parse",
                    &[
                        ("choice_index", json!(index)),
                        ("tool_call_index", json!(tool_call_index)),
                        ("tool_name", json!(tool_call.function_name.clone())),
                    ],
                )
            })?;
            let call_type = tool_call.call_type.ok_or_else(|| {
                kimi_stream_invalid_response_error(
                    "kimi stream tool_call.type is missing",
                    "stream_tool_call_type_parse",
                    &[
                        ("choice_index", json!(index)),
                        ("tool_call_index", json!(tool_call_index)),
                        ("tool_name", json!(tool_call.function_name.clone())),
                    ],
                )
            })?;
            if call_type != "function" {
                return Err(kimi_stream_invalid_response_error(
                    "kimi stream tool_call.type must be function",
                    "stream_tool_call_type_validate",
                    &[
                        ("choice_index", json!(index)),
                        ("tool_call_index", json!(tool_call_index)),
                        ("tool_name", json!(tool_call.function_name.clone())),
                        ("raw_value", json!(call_type)),
                    ],
                ));
            }
            if tool_call.function_arguments.trim().is_empty() {
                return Err(kimi_stream_invalid_response_error(
                    "kimi stream tool_call.function.arguments is missing",
                    "stream_tool_call_arguments_parse",
                    &[
                        ("choice_index", json!(index)),
                        ("tool_call_index", json!(tool_call_index)),
                        ("tool_name", json!(tool_call.function_name)),
                    ],
                ));
            }
            output_tool_calls.push(json!({
                "id": id,
                "type": call_type,
                "function": {
                    "name": tool_call.function_name,
                    "arguments": tool_call.function_arguments,
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
    Err(model_error_with_fields(
        model_invalid_json_error(
            "invalid model response json",
            "model.response",
            "response_parse_json",
        ),
        &[("provider", json!(provider_kind_label(provider_kind)))],
    ))
}
