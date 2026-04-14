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
    fn turn_execute_validates_empty_fields() {
        let input = r#"{"jsonrpc":"2.0","id":"2","method":"runtime.turn.execute","params":{"request_id":"req_1","session_key":"feishu:tenant:dm:user","user_message":"   ","context_lines":["a","b"]}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        assert_eq!(payload["error"]["code"], -32602);
        assert_eq!(payload["error"]["message"], "empty request fields");
    }
}
