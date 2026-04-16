use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::engine::{
    RuntimeEventOutput, TurnExecuteFailure, TurnExecuteInput, TurnExecuteOutput,
    TurnInterruptAskUserOutput, TurnInterruptOutput,
};
use crate::models::model::{
    ModelExecutionInterrupt, ModelExecutor, ModelTelemetryEvent, OpenAiCompatibleModelExecutor,
};
use crate::tools::tools::{LocalToolExecutor, ToolExecutor};
use serde_json::{json, Value};

include!("pipeline.rs");
include!("entrypoint.rs");
include!("tests.rs");
