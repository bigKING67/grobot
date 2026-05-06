use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::engine::{
    NoopRuntimeEventSink, RuntimeEventOutput, RuntimeEventSink, TurnExecuteFailure,
    TurnExecuteInput, TurnExecuteOutput, TurnInterruptAskUserOptionOutput,
    TurnInterruptAskUserOutput, TurnInterruptAskUserQuestionOutput, TurnInterruptOutput,
};
use crate::models::model::{
    ModelExecutionInterrupt, ModelExecutor, ModelTelemetryEvent, ModelTelemetryEventSink,
    OpenAiCompatibleModelExecutor,
};
use crate::tools::tools::{classify_tool_recovery, LocalToolExecutor, ToolExecutor};
use serde_json::{json, Value};

include!("pipeline.rs");
include!("entrypoint.rs");
include!("tests.rs");
