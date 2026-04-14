#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiCompatibleModelExecutor;

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

        let mut messages: Vec<Value> = vec![json!({
            "role": "user",
            "content": build_runtime_user_prompt(input)
        })];
        let max_tool_rounds = resolve_max_tool_rounds(input);
        let mut tool_rounds = 0usize;
        loop {
            let mut body = json!({
                "model": config.model,
                "messages": messages.clone(),
            });
            if input.tool_context.is_some() {
                body["tools"] = build_tool_definitions();
                body["tool_choice"] = json!("auto");
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
                    if let Some(tool_name) = extract_first_tool_call_name(&payload) {
                        return Err(ModelExecutionError::new(
                            "tool_call_not_supported",
                            format!("runtime v1 does not support tool calls yet: {tool_name}"),
                        ));
                    }
                    return Err(ModelExecutionError::new(
                        "tool_call_not_supported",
                        "runtime v1 does not support tool calls yet: unknown_tool",
                    ));
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
