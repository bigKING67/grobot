use crate::models::engine::{RuntimeModelConfigInput, TurnExecuteInput};
use crate::tools::tools::{ToolCallInput, ToolCallOutput, ToolExecutor};
use reqwest::blocking::multipart::{Form, Part};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

include!("contracts.rs");
include!("providers/kimi/mod.rs");
include!("config.rs");
include!("response.rs");
include!("tooling.rs");
include!("executor.rs");
include!("tests.rs");
