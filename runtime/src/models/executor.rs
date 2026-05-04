#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiCompatibleModelExecutor;

include!("executor/kimi_transport.rs");
include!("executor/kimi_attachments.rs");
include!("executor/kimi_stream.rs");
include!("executor/prompt_cache.rs");

include!("executor/tool_telemetry.rs");
include!("executor/ask_user_interrupt.rs");
include!("executor/message_builder.rs");

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
                let current_tool_round = tool_rounds.saturating_add(1);
                let mut observation_boundary_consumed = false;
                for (batch_index, tool_call) in tool_calls.into_iter().enumerate() {
                    let risk_class = classify_tool_execution_risk(&tool_call.name);
                    telemetry_events.push(build_tool_start_event(
                        &tool_call,
                        current_tool_round,
                        batch_index,
                        risk_class,
                    ));
                    let mut deferred_tool_call = false;
                    let (output, budgeted_output) = if observation_boundary_consumed {
                        deferred_tool_call = true;
                        let output = build_deferred_tool_output(
                            &tool_call,
                            current_tool_round,
                            batch_index,
                            risk_class,
                        );
                        let budgeted_output =
                            budget_tool_message_content(&tool_call.name, &output.content);
                        telemetry_events.push(build_tool_end_deferred_event(
                            &tool_call,
                            current_tool_round,
                            batch_index,
                            risk_class,
                            &output,
                            &budgeted_output,
                        ));
                        telemetry_events.push(build_tool_recovery_event(
                            &tool_call,
                            current_tool_round,
                            batch_index,
                            risk_class,
                            "tool_execution_deferred",
                            None,
                            None,
                        ));
                        (output, budgeted_output)
                    } else {
                        let started_at = std::time::Instant::now();
                        match tools.execute_tool_call(&tool_call, input) {
                            Ok(output) => {
                                let duration_ms = tool_duration_ms(started_at);
                                let budgeted_output =
                                    budget_tool_message_content(&tool_call.name, &output.content);
                                if let Some(observed_error) = output.observed_error.as_ref() {
                                    telemetry_events.push(build_tool_end_observed_failure_event(
                                        &tool_call,
                                        current_tool_round,
                                        batch_index,
                                        risk_class,
                                        duration_ms,
                                        &output,
                                        &budgeted_output,
                                        observed_error,
                                    ));
                                    telemetry_events.push(build_tool_recovery_event(
                                        &tool_call,
                                        current_tool_round,
                                        batch_index,
                                        risk_class,
                                        &observed_error.error_class,
                                        Some(observed_error.message.as_str()),
                                        observed_error.data.as_ref(),
                                    ));
                                } else {
                                    telemetry_events.push(build_tool_end_success_event(
                                        &tool_call,
                                        current_tool_round,
                                        batch_index,
                                        risk_class,
                                        duration_ms,
                                        &output,
                                        &budgeted_output,
                                    ));
                                }
                                if tool_requires_observation_boundary(risk_class) {
                                    observation_boundary_consumed = true;
                                }
                                (output, budgeted_output)
                            }
                            Err(error) => {
                                let duration_ms = tool_duration_ms(started_at);
                                telemetry_events.push(build_tool_end_failure_event(
                                    &tool_call,
                                    current_tool_round,
                                    batch_index,
                                    risk_class,
                                    duration_ms,
                                    &error,
                                ));
                                telemetry_events.push(build_tool_recovery_event(
                                    &tool_call,
                                    current_tool_round,
                                    batch_index,
                                    risk_class,
                                    &error.error_class,
                                    Some(error.message.as_str()),
                                    error.data.as_ref(),
                                ));
                                let mut model_error = ModelExecutionError::new(
                                    &error.error_class,
                                    error.message.clone(),
                                );
                                if let Some(data) = error.data.clone() {
                                    model_error = model_error.with_data(data);
                                }
                                return Err(
                                    model_error.with_telemetry_events(telemetry_events),
                                );
                            }
                        }
                    };
                    if !deferred_tool_call {
                        match parse_tool_interrupt(&tool_call, &output) {
                            Ok(Some(interrupt)) => {
                                return Ok(ModelExecutionOutput {
                                    assistant_message: String::new(),
                                    telemetry_events,
                                    interrupt: Some(interrupt),
                                });
                            }
                            Ok(None) => {}
                            Err(error) => {
                                return Err(error.with_telemetry_events(telemetry_events));
                            }
                        }
                    }
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_call.name,
                        "content": budgeted_output.content,
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
