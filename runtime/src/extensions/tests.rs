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
        assert!(
            payload["result"]["runtime_tools"]["overlap_guard"]["max_turn_keys"]
                .as_u64()
                .is_some(),
            "runtime.health should expose overlap_guard metrics"
        );
    }

    #[test]
    fn tools_describe_returns_default_enabled_tools() {
        let input = r#"{"jsonrpc":"2.0","id":"tools-1","method":"runtime.tools.describe","params":{}}"#;
        let output = handle_json_line(input);
        let payload: Value = serde_json::from_str(&output).expect("valid json");
        let tools = payload["result"]["tools"]
            .as_array()
            .expect("tools should be array");
        assert!(!tools.is_empty());
        let default_enabled = payload["result"]["default_enabled_tools"]
            .as_array()
            .expect("default_enabled_tools should be array");
        let default_names = default_enabled
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<&str>>();
        assert!(default_names.contains(&"ask_user_question"));
        let has_ask_user_tool = tools.iter().any(|tool| {
            tool.get("function")
                .and_then(Value::as_object)
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                == Some("ask_user_question")
        });
        assert!(has_ask_user_tool);
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
