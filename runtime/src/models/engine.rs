use serde::Serialize;
use serde_json::Value;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnExecuteOutput {
    pub trace_id: String,
    pub request_id: String,
    pub session_key: String,
    pub assistant_message: String,
    pub events: Vec<RuntimeEventOutput>,
}

#[derive(Debug, Clone)]
pub struct TurnExecuteFailure {
    pub trace_id: String,
    pub request_id: String,
    pub session_key: String,
    pub error_class: String,
    pub error_message: String,
    pub events: Vec<RuntimeEventOutput>,
}
