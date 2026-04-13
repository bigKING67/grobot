use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::engine::{
    RuntimeEventOutput, TurnExecuteFailure, TurnExecuteInput, TurnExecuteOutput,
};
use crate::models::model::{ModelExecutor, OpenAiCompatibleModelExecutor};
use crate::tools::tools::{NoopToolExecutor, ToolExecutor};
use serde_json::{json, Value};

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
                    "provider": "openai-compatible"
                })),
            ),
        ];

        self.tools.before_turn(&input);
        let model_result = self.model.generate_assistant_message(&input);
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

pub fn execute_turn(input: TurnExecuteInput) -> Result<TurnExecuteOutput, TurnExecuteFailure> {
    let orchestrator = TurnOrchestrator::new(OpenAiCompatibleModelExecutor, NoopToolExecutor);
    orchestrator.execute_turn(input)
}

#[cfg(test)]
mod tests {
    use super::{TurnOrchestrator, TurnExecuteInput};
    use crate::models::model::{ModelExecutionError, ModelExecutor};
    use crate::tools::tools::NoopToolExecutor;

    #[derive(Debug, Clone, Copy)]
    struct StubSuccessModel;

    impl ModelExecutor for StubSuccessModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
        ) -> Result<String, ModelExecutionError> {
            Ok("ok".to_string())
        }
    }

    #[derive(Debug, Clone, Copy)]
    struct StubFailModel;

    impl ModelExecutor for StubFailModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
        ) -> Result<String, ModelExecutionError> {
            Err(ModelExecutionError::new(
                "upstream_http_error",
                "status=500",
            ))
        }
    }

    fn sample_input() -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req_1".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "hello".to_string(),
            context_lines: vec!["c1".to_string()],
            model_config: None,
        }
    }

    #[test]
    fn success_path_contains_model_response_and_turn_end() {
        let orchestrator = TurnOrchestrator::new(StubSuccessModel, NoopToolExecutor);
        let output = orchestrator
            .execute_turn(sample_input())
            .expect("success output");
        let event_types: Vec<&str> = output.events.iter().map(|event| event.event_type.as_str()).collect();
        assert_eq!(
            event_types,
            vec!["turn_start", "model_request", "model_response", "turn_end"]
        );
        assert_eq!(output.assistant_message, "ok");
    }

    #[test]
    fn failure_path_contains_turn_failed_event() {
        let orchestrator = TurnOrchestrator::new(StubFailModel, NoopToolExecutor);
        let failure = orchestrator
            .execute_turn(sample_input())
            .expect_err("expected failure");
        let event_types: Vec<&str> = failure.events.iter().map(|event| event.event_type.as_str()).collect();
        assert_eq!(
            event_types,
            vec!["turn_start", "model_request", "turn_failed", "turn_end"]
        );
        assert_eq!(failure.error_class, "upstream_http_error");
    }

    #[derive(Debug, Clone, Copy)]
    struct StubToolCallNotSupportedModel;

    impl ModelExecutor for StubToolCallNotSupportedModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
        ) -> Result<String, ModelExecutionError> {
            Err(ModelExecutionError::new(
                "tool_call_not_supported",
                "runtime v1 does not support tool calls yet: lookup",
            ))
        }
    }

    #[test]
    fn tool_call_not_supported_emits_tool_events_before_turn_failed() {
        let orchestrator = TurnOrchestrator::new(StubToolCallNotSupportedModel, NoopToolExecutor);
        let failure = orchestrator
            .execute_turn(sample_input())
            .expect_err("expected tool_call_not_supported");
        let event_types: Vec<&str> = failure.events.iter().map(|event| event.event_type.as_str()).collect();
        assert_eq!(
            event_types,
            vec![
                "turn_start",
                "model_request",
                "tool_start",
                "tool_end",
                "turn_failed",
                "turn_end"
            ]
        );
        let tool_start_payload = failure.events[2]
            .payload
            .as_ref()
            .expect("tool_start payload");
        assert_eq!(tool_start_payload["tool_name"], "lookup");
        let tool_end_payload = failure.events[3]
            .payload
            .as_ref()
            .expect("tool_end payload");
        assert_eq!(tool_end_payload["status"], "failed");
        assert_eq!(tool_end_payload["error_class"], "tool_call_not_supported");
    }
}
