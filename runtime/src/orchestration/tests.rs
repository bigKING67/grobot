#[cfg(test)]
mod tests {
    use super::{TurnOrchestrator, TurnExecuteInput};
    use crate::models::model::{
        ModelAskUserInterrupt, ModelExecutionError, ModelExecutionInterrupt, ModelExecutionOutput,
        ModelExecutor, ModelTelemetryEvent,
    };
    use crate::tools::tools::{LocalToolExecutor, ToolExecutor};

    #[derive(Debug, Clone, Copy)]
    struct StubSuccessModel;

    impl ModelExecutor for StubSuccessModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
            _tools: &dyn ToolExecutor,
        ) -> Result<ModelExecutionOutput, ModelExecutionError> {
            Ok(ModelExecutionOutput {
                assistant_message: "ok".to_string(),
                telemetry_events: Vec::new(),
                interrupt: None,
            })
        }
    }

    #[derive(Debug, Clone, Copy)]
    struct StubFailModel;

    impl ModelExecutor for StubFailModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
            _tools: &dyn ToolExecutor,
        ) -> Result<ModelExecutionOutput, ModelExecutionError> {
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
            tool_context: None,
            attachments: vec![],
        }
    }

    #[test]
    fn success_path_contains_model_response_and_turn_end() {
        let orchestrator = TurnOrchestrator::new(StubSuccessModel, LocalToolExecutor);
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
        let orchestrator = TurnOrchestrator::new(StubFailModel, LocalToolExecutor);
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
    struct StubAskUserInterruptModel;

    impl ModelExecutor for StubAskUserInterruptModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
            _tools: &dyn ToolExecutor,
        ) -> Result<ModelExecutionOutput, ModelExecutionError> {
            Ok(ModelExecutionOutput {
                assistant_message: String::new(),
                telemetry_events: Vec::new(),
                interrupt: Some(ModelExecutionInterrupt::AskUser(ModelAskUserInterrupt {
                    question_id: "ask_q_001".to_string(),
                    blocking_node_id: "node.confirm.scope".to_string(),
                    question: "Need project scope?".to_string(),
                    options: vec!["core".to_string(), "all".to_string()],
                    default_on_timeout: "core".to_string(),
                    resume_token: "resume_001".to_string(),
                    created_at: "unix:1".to_string(),
                })),
            })
        }
    }

    #[test]
    fn interrupt_path_emits_turn_interrupted_event_and_output_payload() {
        let orchestrator = TurnOrchestrator::new(StubAskUserInterruptModel, LocalToolExecutor);
        let output = orchestrator
            .execute_turn(sample_input())
            .expect("interrupt output");
        let event_types: Vec<&str> = output.events.iter().map(|event| event.event_type.as_str()).collect();
        assert_eq!(
            event_types,
            vec!["turn_start", "model_request", "model_response", "turn_interrupted", "turn_end"]
        );
        let interrupt = output.interrupt.expect("interrupt payload");
        assert_eq!(interrupt.kind, "ask_user");
        let ask_user = interrupt.ask_user.expect("ask_user payload");
        assert_eq!(ask_user.question_id, "ask_q_001");
        assert_eq!(ask_user.blocking_node_id, "node.confirm.scope");
    }

    #[derive(Debug, Clone, Copy)]
    struct StubToolCallNotSupportedModel;

    impl ModelExecutor for StubToolCallNotSupportedModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
            _tools: &dyn ToolExecutor,
        ) -> Result<ModelExecutionOutput, ModelExecutionError> {
            Err(ModelExecutionError::new(
                "tool_call_not_supported",
                "runtime v1 does not support tool calls yet: lookup",
            ))
        }
    }

    #[test]
    fn tool_call_not_supported_emits_tool_events_before_turn_failed() {
        let orchestrator = TurnOrchestrator::new(StubToolCallNotSupportedModel, LocalToolExecutor);
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

    #[derive(Debug, Clone, Copy)]
    struct StubTelemetrySuccessModel;

    impl ModelExecutor for StubTelemetrySuccessModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
            _tools: &dyn ToolExecutor,
        ) -> Result<ModelExecutionOutput, ModelExecutionError> {
            Ok(ModelExecutionOutput {
                assistant_message: "ok-telemetry".to_string(),
                telemetry_events: vec![
                    ModelTelemetryEvent {
                        event_type: "no_tool_fallback_triggered".to_string(),
                        payload: None,
                    },
                    ModelTelemetryEvent {
                        event_type: "no_tool_fallback_succeeded".to_string(),
                        payload: None,
                    },
                ],
                interrupt: None,
            })
        }
    }

    #[test]
    fn success_path_forwards_model_telemetry_events() {
        let orchestrator = TurnOrchestrator::new(StubTelemetrySuccessModel, LocalToolExecutor);
        let output = orchestrator
            .execute_turn(sample_input())
            .expect("success output");
        let event_types: Vec<&str> = output.events.iter().map(|event| event.event_type.as_str()).collect();
        assert_eq!(
            event_types,
            vec![
                "turn_start",
                "model_request",
                "no_tool_fallback_triggered",
                "no_tool_fallback_succeeded",
                "model_response",
                "turn_end"
            ]
        );
        assert_eq!(output.assistant_message, "ok-telemetry");
    }

    #[derive(Debug, Clone, Copy)]
    struct StubTelemetryFailureModel;

    impl ModelExecutor for StubTelemetryFailureModel {
        fn generate_assistant_message(
            &self,
            _input: &TurnExecuteInput,
            _tools: &dyn ToolExecutor,
        ) -> Result<ModelExecutionOutput, ModelExecutionError> {
            Err(
                ModelExecutionError::new(
                    "upstream_invalid_response",
                    "missing choices[0].message.content in model response",
                )
                .with_telemetry_events(vec![ModelTelemetryEvent {
                    event_type: "no_tool_fallback_exhausted".to_string(),
                    payload: None,
                }]),
            )
        }
    }

    #[test]
    fn failure_path_forwards_model_telemetry_events_before_turn_failed() {
        let orchestrator = TurnOrchestrator::new(StubTelemetryFailureModel, LocalToolExecutor);
        let failure = orchestrator
            .execute_turn(sample_input())
            .expect_err("expected failure");
        let event_types: Vec<&str> = failure.events.iter().map(|event| event.event_type.as_str()).collect();
        assert_eq!(
            event_types,
            vec![
                "turn_start",
                "model_request",
                "no_tool_fallback_exhausted",
                "turn_failed",
                "turn_end"
            ]
        );
    }
}
