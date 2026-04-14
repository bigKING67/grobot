use crate::models::engine::{RuntimeModelConfigInput, TurnExecuteInput};
use crate::tools::tools::{ToolCallInput, ToolExecutor};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::env;
use std::time::Duration;

include!("domains/contracts.rs");
include!("domains/config.rs");
include!("domains/response.rs");
include!("domains/tooling.rs");
include!("domains/executor.rs");
include!("domains/tests.rs");
