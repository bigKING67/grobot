use crate::models::engine::TurnExecuteInput;
use crate::orchestration::orchestrator::execute_turn;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const JSONRPC_VERSION: &str = "2.0";
pub const RUNTIME_PROTOCOL_VERSION: &str = "runtime.v1";

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcSuccessResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    pub result: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcErrorObject {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct RpcErrorResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    pub error: RpcErrorObject,
}

#[derive(Debug, Deserialize)]
pub struct TurnExecuteParams {
    pub request_id: String,
    pub session_key: String,
    pub user_message: String,
    #[serde(default)]
    pub context_lines: Vec<String>,
}

fn success(id: Value, result: Value) -> RpcSuccessResponse {
    RpcSuccessResponse {
        jsonrpc: JSONRPC_VERSION,
        id,
        result,
    }
}

fn error(id: Value, code: i64, message: &str) -> RpcErrorResponse {
    RpcErrorResponse {
        jsonrpc: JSONRPC_VERSION,
        id,
        error: RpcErrorObject {
            code,
            message: message.to_string(),
        },
    }
}

pub fn handle_request(request: RpcRequest) -> Result<RpcSuccessResponse, RpcErrorResponse> {
    if request.jsonrpc != JSONRPC_VERSION {
        return Err(error(request.id, -32600, "invalid jsonrpc version"));
    }

    match request.method.as_str() {
        "runtime.health" => Ok(success(
            request.id,
            json!({
                "protocol_version": RUNTIME_PROTOCOL_VERSION,
                "runtime": "rust",
                "status": "ok"
            }),
        )),
        "runtime.turn.execute" => {
            let params: TurnExecuteParams = serde_json::from_value(request.params)
                .map_err(|_| error(request.id.clone(), -32602, "invalid params"))?;
            if params.request_id.trim().is_empty()
                || params.session_key.trim().is_empty()
                || params.user_message.trim().is_empty()
            {
                return Err(error(request.id, -32602, "empty request fields"));
            }

            let execution = execute_turn(TurnExecuteInput {
                request_id: params.request_id,
                session_key: params.session_key,
                user_message: params.user_message,
                context_lines: params.context_lines,
            });
            Ok(success(
                request.id,
                json!({
                    "protocol_version": RUNTIME_PROTOCOL_VERSION,
                    "trace_id": execution.trace_id,
                    "request_id": execution.request_id,
                    "session_key": execution.session_key,
                    "assistant_message": execution.assistant_message,
                    "events": execution.events
                }),
            ))
        }
        _ => Err(error(request.id, -32601, "method not found")),
    }
}

pub fn handle_json_line(line: &str) -> String {
    let parsed = serde_json::from_str::<RpcRequest>(line);
    let response = match parsed {
        Ok(request) => match handle_request(request) {
            Ok(ok) => serde_json::to_value(ok).unwrap_or_else(|_| {
                json!({
                    "jsonrpc": JSONRPC_VERSION,
                    "id": null,
                    "error": { "code": -32603, "message": "internal serialization error" }
                })
            }),
            Err(err) => serde_json::to_value(err).unwrap_or_else(|_| {
                json!({
                    "jsonrpc": JSONRPC_VERSION,
                    "id": null,
                    "error": { "code": -32603, "message": "internal serialization error" }
                })
            }),
        },
        Err(_) => json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": null,
            "error": { "code": -32700, "message": "parse error" }
        }),
    };

    serde_json::to_string(&response).unwrap_or_else(|_| {
        "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32603,\"message\":\"serialization failure\"}}"
            .to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::handle_json_line;
    use serde_json::Value;

    #[test]
    fn health_returns_ok() {
        let input = r#"{"jsonrpc":"2.0","id":"1","method":"runtime.health","params":{}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["result"]["status"], "ok");
        assert_eq!(payload["result"]["protocol_version"], "runtime.v1");
    }

    #[test]
    fn turn_execute_returns_events() {
        let input = r#"{"jsonrpc":"2.0","id":"2","method":"runtime.turn.execute","params":{"request_id":"req_1","session_key":"feishu:tenant:dm:user","user_message":"hello","context_lines":["a","b"]}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["result"]["request_id"], "req_1");
        assert_eq!(
            payload["result"]["events"]
                .as_array()
                .expect("events array")
                .len(),
            3
        );
    }
}
