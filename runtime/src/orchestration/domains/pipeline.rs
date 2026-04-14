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

    fn extract_tool_name_from_not_supported(error_message: &str) -> String {
        let prefix = "runtime v1 does not support tool calls yet:";
        if let Some(raw) = error_message.strip_prefix(prefix) {
            let normalized = raw.trim();
            if !normalized.is_empty() {
                return normalized.to_string();
            }
        }
        "unknown_tool".to_string()
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
        let trace_id = format!("trace_{}", input.request_id);
        let turn_id = format!("turn_{}", input.request_id);
        let request_id = input.request_id.clone();
        let session_key = input.session_key.clone();
        let mut events = vec![
            Self::build_event(
                "turn_start",
                &turn_id,
                Some(json!({
                    "request_id": input.request_id,
                    "context_line_count": input.context_lines.len()
                })),
            ),
            Self::build_event(
                "model_request",
                &turn_id,
                Some(json!({
                    "provider": Self::resolve_provider_label(&input)
                })),
            ),
        ];

        self.tools.before_turn(&input);
        let model_result = self.model.generate_assistant_message(&input, &self.tools);
        self.tools.after_turn(&input);

        match model_result {
            Ok(assistant_message) => {
                events.push(Self::build_event(
                    "model_response",
                    &turn_id,
                    Some(json!({
                        "assistant_chars": assistant_message.chars().count()
                    })),
                ));
                events.push(Self::build_event(
                    "turn_end",
                    &turn_id,
                    Some(json!({
                        "status": "ok"
                    })),
                ));

                Ok(TurnExecuteOutput {
                    trace_id,
                    request_id,
                    session_key,
                    assistant_message,
                    events,
                })
            }
            Err(error) => {
                let error_class = error.error_class;
                let error_message = error.message;
                if error_class == "tool_call_not_supported" {
                    let tool_name = Self::extract_tool_name_from_not_supported(&error_message);
                    events.push(Self::build_event(
                        "tool_start",
                        &turn_id,
                        Some(json!({
                            "tool_name": tool_name
                        })),
                    ));
                    events.push(Self::build_event(
                        "tool_end",
                        &turn_id,
                        Some(json!({
                            "tool_name": tool_name,
                            "status": "failed",
                            "error_class": error_class.clone(),
                            "error_message": error_message.clone()
                        })),
                    ));
                }
                events.push(Self::build_event(
                    "turn_failed",
                    &turn_id,
                    Some(json!({
                        "error_class": error_class.clone(),
                        "error_message": error_message.clone()
                    })),
                ));
                events.push(Self::build_event(
                    "turn_end",
                    &turn_id,
                    Some(json!({
                        "status": "failed"
                    })),
                ));

                Err(TurnExecuteFailure {
                    trace_id,
                    request_id,
                    session_key,
                    error_class,
                    error_message,
                    events,
                })
            }
        }
    }
}
