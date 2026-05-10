#[test]
fn rpc_envelope_keeps_malformed_json_as_parse_error() {
    let output = handle_json_line(r#"{"jsonrpc":"2.0","id":"bad-json","method":"runtime.health""#);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"], Value::Null);
    assert_eq!(payload["error"]["code"], -32700);
    assert_eq!(payload["error"]["message"], "parse error");
    assert!(payload["error"].get("data").is_none());
}

#[test]
fn rpc_envelope_rejects_non_object_request() {
    let output = handle_json_line("[]");
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"], Value::Null);
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid request");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_rpc_request_shape")
    );
    assert_eq!(payload["error"]["data"]["field"].as_str(), Some("request"));
    assert_eq!(
        payload["error"]["data"]["source"].as_str(),
        Some("jsonrpc.request")
    );
    assert!(payload["error"]["data"]["raw_value"].is_array());
}

#[test]
fn rpc_envelope_rejects_missing_jsonrpc_version() {
    let input = r#"{"id":"missing-version","method":"runtime.health","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("missing-version"));
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid jsonrpc version");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_jsonrpc_version")
    );
    assert_eq!(payload["error"]["data"]["field"].as_str(), Some("jsonrpc"));
    assert!(payload["error"]["data"]["raw_value"].is_null());
}

#[test]
fn rpc_envelope_rejects_non_string_jsonrpc_version() {
    let input = r#"{"jsonrpc":2,"id":"numeric-version","method":"runtime.health","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("numeric-version"));
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid jsonrpc version");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_jsonrpc_version")
    );
    assert_eq!(payload["error"]["data"]["raw_value"].as_u64(), Some(2));
}

#[test]
fn rpc_envelope_rejects_wrong_jsonrpc_version() {
    let input = r#"{"jsonrpc":"1.0","id":"wrong-version","method":"runtime.health","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("wrong-version"));
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid jsonrpc version");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_jsonrpc_version")
    );
    assert_eq!(
        payload["error"]["data"]["raw_value"].as_str(),
        Some("1.0")
    );
}

#[test]
fn rpc_envelope_rejects_missing_id() {
    let input = r#"{"jsonrpc":"2.0","method":"runtime.health","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"], Value::Null);
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid request");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_rpc_id_shape")
    );
    assert_eq!(payload["error"]["data"]["field"].as_str(), Some("id"));
    assert!(payload["error"]["data"]["raw_value"].is_null());
}

#[test]
fn rpc_envelope_rejects_object_id_with_null_response_id() {
    let input = r#"{"jsonrpc":"2.0","id":{"nested":true},"method":"runtime.health","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"], Value::Null);
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid request");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_rpc_id_shape")
    );
    assert_eq!(payload["error"]["data"]["field"].as_str(), Some("id"));
    assert!(payload["error"]["data"]["raw_value"].is_object());
}

#[test]
fn rpc_envelope_rejects_missing_method() {
    let input = r#"{"jsonrpc":"2.0","id":"missing-method","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("missing-method"));
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid request");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_rpc_method_shape")
    );
    assert_eq!(payload["error"]["data"]["field"].as_str(), Some("method"));
    assert!(payload["error"]["data"]["raw_value"].is_null());
}

#[test]
fn rpc_envelope_rejects_null_method() {
    let input = r#"{"jsonrpc":"2.0","id":"null-method","method":null,"params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("null-method"));
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid request");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_rpc_method_shape")
    );
    assert_eq!(payload["error"]["data"]["field"].as_str(), Some("method"));
    assert!(payload["error"]["data"]["raw_value"].is_null());
}

#[test]
fn rpc_envelope_rejects_empty_method() {
    let input = r#"{"jsonrpc":"2.0","id":"empty-method","method":"   ","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("empty-method"));
    assert_eq!(payload["error"]["code"], -32600);
    assert_eq!(payload["error"]["message"], "invalid request");
    assert_eq!(
        payload["error"]["data"]["diagnostic_kind"].as_str(),
        Some("invalid_rpc_method_shape")
    );
    assert_eq!(
        payload["error"]["data"]["raw_value"].as_str(),
        Some("   ")
    );
}

#[test]
fn rpc_envelope_allows_missing_params() {
    let input = r#"{"jsonrpc":"2.0","id":"tools-without-params","method":"runtime.tools.describe"}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("tools-without-params"));
    assert_eq!(payload["result"]["protocol_version"].as_str(), Some("runtime.v1"));
    assert!(payload["result"]["tools"].as_array().is_some());
}

#[test]
fn rpc_envelope_preserves_id_for_unknown_method() {
    let input = r#"{"jsonrpc":"2.0","id":"unknown-method","method":"runtime.unknown","params":{}}"#;
    let output = handle_json_line(input);
    let payload: Value = serde_json::from_str(&output).expect("valid json");
    assert_eq!(payload["id"].as_str(), Some("unknown-method"));
    assert_eq!(payload["error"]["code"], -32601);
    assert_eq!(payload["error"]["message"], "method not found");
}
