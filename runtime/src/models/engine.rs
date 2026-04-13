use serde::Serialize;

#[derive(Debug, Clone)]
pub struct TurnExecuteInput {
    pub request_id: String,
    pub session_key: String,
    pub user_message: String,
    pub context_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeEventOutput {
    pub event_type: String,
    pub turn_id: String,
    pub timestamp_iso: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnExecuteOutput {
    pub trace_id: String,
    pub request_id: String,
    pub session_key: String,
    pub assistant_message: String,
    pub events: Vec<RuntimeEventOutput>,
}
