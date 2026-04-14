use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::engine::{
    RuntimeEventOutput, TurnExecuteFailure, TurnExecuteInput, TurnExecuteOutput,
};
use crate::models::model::{ModelExecutor, OpenAiCompatibleModelExecutor};
use crate::tools::tools::{LocalToolExecutor, ToolExecutor};
use serde_json::{json, Value};

include!("domains/pipeline.rs");
include!("domains/entrypoint.rs");
include!("domains/tests.rs");
