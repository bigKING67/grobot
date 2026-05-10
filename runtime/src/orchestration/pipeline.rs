fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("unix:{now}")
}

pub struct TurnOrchestrator<M: ModelExecutor, T: ToolExecutor> {
    model: M,
    tools: T,
}

struct OrchestratorTelemetrySink<'a> {
    turn_id: &'a str,
    event_sink: &'a mut dyn RuntimeEventSink,
}

impl ModelTelemetryEventSink for OrchestratorTelemetrySink<'_> {
    fn emit(&mut self, event: &ModelTelemetryEvent) {
        let event_type = event.event_type.trim();
        if event_type.is_empty() {
            return;
        }
        self.event_sink.emit(&RuntimeEventOutput {
            event_type: event_type.to_string(),
            turn_id: self.turn_id.to_string(),
            timestamp_iso: now_iso(),
            payload: event.payload.clone(),
        });
    }
}

struct RecordingRuntimeEventSink<'a> {
    events: &'a mut Vec<RuntimeEventOutput>,
    event_sink: &'a mut dyn RuntimeEventSink,
}

impl RuntimeEventSink for RecordingRuntimeEventSink<'_> {
    fn emit(&mut self, event: &RuntimeEventOutput) {
        self.event_sink.emit(event);
        self.events.push(event.clone());
    }
}

impl<M: ModelExecutor, T: ToolExecutor> TurnOrchestrator<M, T> {
    pub fn new(model: M, tools: T) -> Self {
        Self { model, tools }
    }

    fn build_event(
        event_type: &str,
        turn_id: &str,
        payload: Option<Value>,
    ) -> RuntimeEventOutput {
        RuntimeEventOutput {
            event_type: event_type.to_string(),
            turn_id: turn_id.to_string(),
            timestamp_iso: now_iso(),
            payload,
        }
    }

    fn append_model_telemetry_events(
        events: &mut Vec<RuntimeEventOutput>,
        turn_id: &str,
        telemetry_events: Vec<ModelTelemetryEvent>,
        realtime_events: &[RuntimeEventOutput],
        realtime_event_index: &mut usize,
    ) {
        for telemetry in telemetry_events {
            let event_type = telemetry.event_type.trim();
            if event_type.is_empty() {
                continue;
            }
            let event = realtime_events
                .get(*realtime_event_index)
                .filter(|event| event.event_type == event_type)
                .cloned()
                .unwrap_or_else(|| Self::build_event(event_type, turn_id, telemetry.payload));
            *realtime_event_index = realtime_event_index.saturating_add(1);
            events.push(event);
        }
    }

    fn push_event(
        events: &mut Vec<RuntimeEventOutput>,
        event_sink: &mut dyn RuntimeEventSink,
        event: RuntimeEventOutput,
    ) {
        event_sink.emit(&event);
        events.push(event);
    }

    fn extract_tool_name_from_synthetic_failure(
        error_message: &str,
        error_data: Option<&Value>,
    ) -> String {
        if let Some(tool_name) = error_data
            .and_then(Value::as_object)
            .and_then(|data| data.get("tool_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return tool_name.to_string();
        }
        let prefix = "runtime v1 does not support tool calls yet:";
        if let Some(raw) = error_message.strip_prefix(prefix) {
            let normalized = raw.trim();
            if !normalized.is_empty() {
                return normalized.to_string();
            }
        }
        "unknown_tool".to_string()
    }

    fn should_emit_synthetic_tool_failure(error_class: &str, error_data: Option<&Value>) -> bool {
        if error_class == "tool_call_not_supported" {
            return true;
        }
        if error_class != "invalid_tool_arguments" {
            return false;
        }
        error_data
            .and_then(Value::as_object)
            .and_then(|data| data.get("tool_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .map(|value| !value.is_empty())
            .unwrap_or(false)
    }

    fn invalid_turn_input_failure(
        input: &TurnExecuteInput,
        field: &str,
        raw_value: &str,
        event_sink: &mut dyn RuntimeEventSink,
    ) -> TurnExecuteFailure {
        let request_id = input.request_id.trim();
        let request_id = if request_id.is_empty() {
            "invalid_request".to_string()
        } else {
            request_id.to_string()
        };
        let session_key = input.session_key.trim();
        let session_key = if session_key.is_empty() {
            "invalid_session".to_string()
        } else {
            session_key.to_string()
        };
        let trace_id = format!("trace_{request_id}");
        let turn_id = format!("turn_{request_id}");
        let error_class = "turn_input_invalid".to_string();
        let error_message = format!("{field} must be non-empty");
        let error_data = json!({
            "diagnostic_kind": "turn_input_invalid",
            "field": field,
            "source": field,
            "raw_value": raw_value,
            "recovery_hint": "fix the runtime turn input before retrying",
        });
        let mut events = Vec::new();
        Self::push_event(
            &mut events,
            event_sink,
            Self::build_event(
                "turn_failed",
                &turn_id,
                Some(json!({
                    "error_class": error_class.clone(),
                    "error_message": error_message.clone(),
                    "error_data": error_data.clone()
                })),
            ),
        );
        Self::push_event(
            &mut events,
            event_sink,
            Self::build_event("turn_end", &turn_id, Some(json!({ "status": "failed" }))),
        );

        TurnExecuteFailure {
            trace_id,
            request_id,
            session_key,
            error_class,
            error_message,
            error_data: Some(error_data),
            events,
        }
    }

    fn map_model_interrupt(interrupt: ModelExecutionInterrupt) -> TurnInterruptOutput {
        match interrupt {
            ModelExecutionInterrupt::AskUser(ask_user) => TurnInterruptOutput {
                kind: "ask_user".to_string(),
                ask_user: Some(TurnInterruptAskUserOutput {
                    blocking_node_id: ask_user.blocking_node_id,
                    questions: ask_user
                        .questions
                        .into_iter()
                        .map(|question| TurnInterruptAskUserQuestionOutput {
                            id: question.id,
                            header: question.header,
                            question: question.question,
                            options: question
                                .options
                                .into_iter()
                                .map(|option| TurnInterruptAskUserOptionOutput {
                                    label: option.label,
                                    description: option.description,
                                    value: option.value,
                                })
                                .collect(),
                        })
                        .collect(),
                    default_on_timeout: ask_user.default_on_timeout,
                    resume_token: ask_user.resume_token,
                    created_at: ask_user.created_at,
                }),
            },
        }
    }

    fn build_interrupt_event_payload(interrupt: &TurnInterruptOutput) -> Value {
        match interrupt.kind.as_str() {
            "ask_user" => {
                let ask_user = interrupt.ask_user.as_ref();
                json!({
                    "kind": interrupt.kind,
                    "blocking_node_id": ask_user.map(|value| value.blocking_node_id.clone()).unwrap_or_default(),
                    "question_total": ask_user.map(|value| value.questions.len()).unwrap_or(0)
                })
            }
            _ => json!({
                "kind": interrupt.kind
            }),
        }
    }

    fn resolve_provider_label(input: &TurnExecuteInput) -> &'static str {
        let explicit = input
            .model_config
            .as_ref()
            .and_then(|config| config.provider_kind.as_ref())
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if explicit == "kimi" {
            return "kimi";
        }
        if explicit == "openai_compatible" || explicit == "openai-compatible" {
            return "openai-compatible";
        }
        let base_url = input
            .model_config
            .as_ref()
            .and_then(|config| config.base_url.as_ref())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default();
        if base_url.contains("moonshot.cn") {
            return "kimi";
        }
        "openai-compatible"
    }

    pub fn execute_turn(
        &self,
        input: TurnExecuteInput,
    ) -> Result<TurnExecuteOutput, TurnExecuteFailure> {
        let mut event_sink = NoopRuntimeEventSink;
        self.execute_turn_with_event_sink(input, &mut event_sink)
    }

    pub fn execute_turn_with_event_sink(
        &self,
        mut input: TurnExecuteInput,
        event_sink: &mut dyn RuntimeEventSink,
    ) -> Result<TurnExecuteOutput, TurnExecuteFailure> {
        if input.request_id.trim().is_empty() {
            return Err(Self::invalid_turn_input_failure(
                &input,
                "request_id",
                input.request_id.as_str(),
                event_sink,
            ));
        }
        if input.session_key.trim().is_empty() {
            return Err(Self::invalid_turn_input_failure(
                &input,
                "session_key",
                input.session_key.as_str(),
                event_sink,
            ));
        }
        if input.user_message.trim().is_empty() {
            return Err(Self::invalid_turn_input_failure(
                &input,
                "user_message",
                input.user_message.as_str(),
                event_sink,
            ));
        }
        input.request_id = input.request_id.trim().to_string();
        input.session_key = input.session_key.trim().to_string();

        let trace_id = format!("trace_{}", input.request_id);
        let turn_id = format!("turn_{}", input.request_id);
        let request_id = input.request_id.clone();
        let session_key = input.session_key.clone();
        let mut events = Vec::new();
        Self::push_event(
            &mut events,
            event_sink,
            Self::build_event(
                "turn_start",
                &turn_id,
                Some(json!({
                    "request_id": input.request_id,
                    "context_line_count": input.context_lines.len()
                })),
            ),
        );
        Self::push_event(
            &mut events,
            event_sink,
            Self::build_event(
                "model_request",
                &turn_id,
                Some(json!({
                    "provider": Self::resolve_provider_label(&input)
                })),
            ),
        );

        self.tools.before_turn(&input);
        let mut realtime_telemetry_events = Vec::new();
        let mut recording_event_sink = RecordingRuntimeEventSink {
            events: &mut realtime_telemetry_events,
            event_sink,
        };
        let mut telemetry_sink = OrchestratorTelemetrySink {
            turn_id: turn_id.as_str(),
            event_sink: &mut recording_event_sink,
        };
        let model_result = self.model.generate_assistant_message_with_telemetry(
            &input,
            &self.tools,
            &mut telemetry_sink,
        );
        drop(telemetry_sink);
        drop(recording_event_sink);
        self.tools.after_turn(&input);
        let mut realtime_event_index = 0usize;

        match model_result {
            Ok(model_output) => {
                let assistant_message = model_output.assistant_message;
                let interrupt = model_output.interrupt.map(Self::map_model_interrupt);
                let interrupt_kind = interrupt
                    .as_ref()
                    .map(|value| value.kind.clone())
                    .unwrap_or_default();
                Self::append_model_telemetry_events(
                    &mut events,
                    &turn_id,
                    model_output.telemetry_events,
                    &realtime_telemetry_events,
                    &mut realtime_event_index,
                );
                Self::push_event(
                    &mut events,
                    event_sink,
                    Self::build_event(
                        "model_response",
                        &turn_id,
                        Some(json!({
                            "assistant_chars": assistant_message.chars().count(),
                            "interrupt_kind": interrupt_kind
                        })),
                    ),
                );
                if let Some(interrupt_payload) = interrupt.as_ref() {
                    Self::push_event(
                        &mut events,
                        event_sink,
                        Self::build_event(
                            "turn_interrupted",
                            &turn_id,
                            Some(Self::build_interrupt_event_payload(interrupt_payload)),
                        ),
                    );
                    Self::push_event(
                        &mut events,
                        event_sink,
                        Self::build_event(
                            "turn_end",
                            &turn_id,
                            Some(json!({
                                "status": "interrupted"
                            })),
                        ),
                    );
                    return Ok(TurnExecuteOutput {
                        trace_id,
                        request_id,
                        session_key,
                        assistant_message,
                        interrupt,
                        events,
                    });
                }
                Self::push_event(
                    &mut events,
                    event_sink,
                    Self::build_event(
                        "turn_end",
                        &turn_id,
                        Some(json!({
                            "status": "ok"
                        })),
                    ),
                );

                Ok(TurnExecuteOutput {
                    trace_id,
                    request_id,
                    session_key,
                    assistant_message,
                    interrupt: None,
                    events,
                })
            }
            Err(error) => {
                let error_class = error.error_class;
                let error_message = error.message;
                let error_data = error.data;
                Self::append_model_telemetry_events(
                    &mut events,
                    &turn_id,
                    error.telemetry_events,
                    &realtime_telemetry_events,
                    &mut realtime_event_index,
                );
                if Self::should_emit_synthetic_tool_failure(&error_class, error_data.as_ref()) {
                    let tool_name =
                        Self::extract_tool_name_from_synthetic_failure(&error_message, error_data.as_ref());
                    let recovery_policy = classify_tool_recovery(&error_class, "unknown");
                    Self::push_event(
                        &mut events,
                        event_sink,
                        Self::build_event(
                            "tool_start",
                            &turn_id,
                            Some(json!({
                                "tool_name": tool_name
                            })),
                        ),
                    );
                    Self::push_event(
                        &mut events,
                        event_sink,
                        Self::build_event(
                            "tool_end",
                            &turn_id,
                            Some(json!({
                                "tool_name": tool_name,
                                "status": "failed",
                                "error_class": error_class.clone(),
                                "error_message": error_message.clone(),
                                "error_data": error_data.clone()
                            })),
                        ),
                    );
                    Self::push_event(
                        &mut events,
                        event_sink,
                        Self::build_event(
                            "tool_recovery",
                            &turn_id,
                            Some(json!({
                                "tool_name": tool_name,
                                "risk_class": "unknown",
                                "error_class": error_class.clone(),
                                "error_message": error_message.clone(),
                                "error_data": error_data.clone(),
                                "recovery_stage": recovery_policy.stage,
                                "recovery_reason": error_class.clone(),
                                "recommended_next_action": recovery_policy.recommended_next_action,
                                "recoverable": recovery_policy.recoverable
                            })),
                        ),
                    );
                }
                Self::push_event(
                    &mut events,
                    event_sink,
                    Self::build_event(
                        "turn_failed",
                        &turn_id,
                        Some(json!({
                            "error_class": error_class.clone(),
                            "error_message": error_message.clone(),
                            "error_data": error_data.clone()
                        })),
                    ),
                );
                Self::push_event(
                    &mut events,
                    event_sink,
                    Self::build_event(
                        "turn_end",
                        &turn_id,
                        Some(json!({
                            "status": "failed"
                        })),
                    ),
                );

                Err(TurnExecuteFailure {
                    trace_id,
                    request_id,
                    session_key,
                    error_class,
                    error_message,
                    error_data,
                    events,
                })
            }
        }
    }
}
