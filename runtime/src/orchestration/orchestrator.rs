use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::engine::{RuntimeEventOutput, TurnExecuteInput, TurnExecuteOutput};
use crate::models::model::{EchoModelExecutor, ModelExecutor};
use crate::tools::tools::{NoopToolExecutor, ToolExecutor};

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

    pub fn execute_turn(&self, input: TurnExecuteInput) -> TurnExecuteOutput {
        let trace_id = format!("trace_{}", input.request_id);
        let turn_id = format!("turn_{}", input.request_id);
        let request_id = input.request_id.clone();
        let session_key = input.session_key.clone();

        self.tools.before_turn(&input);
        let assistant_message = self.model.generate_assistant_message(&input);
        self.tools.after_turn(&input);

        TurnExecuteOutput {
            trace_id,
            request_id,
            session_key,
            assistant_message,
            events: vec![
                RuntimeEventOutput {
                    event_type: "turn_start".to_string(),
                    turn_id: turn_id.clone(),
                    timestamp_iso: now_iso(),
                },
                RuntimeEventOutput {
                    event_type: "model_response".to_string(),
                    turn_id: turn_id.clone(),
                    timestamp_iso: now_iso(),
                },
                RuntimeEventOutput {
                    event_type: "turn_end".to_string(),
                    turn_id,
                    timestamp_iso: now_iso(),
                },
            ],
        }
    }
}

pub fn execute_turn(input: TurnExecuteInput) -> TurnExecuteOutput {
    let orchestrator = TurnOrchestrator::new(EchoModelExecutor, NoopToolExecutor);
    orchestrator.execute_turn(input)
}
