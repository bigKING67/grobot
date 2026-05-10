fn rpc_request_error_data(
    diagnostic_kind: &str,
    field: &str,
    source: &str,
    raw_value: Value,
    recovery_hint: &str,
) -> Value {
    json!({
        "diagnostic_kind": diagnostic_kind,
        "field": field,
        "source": source,
        "raw_value": raw_value,
        "recovery_hint": recovery_hint,
    })
}

fn is_valid_rpc_id(value: &Value) -> bool {
    value.is_null() || value.is_string() || value.is_number()
}

fn response_id_from_raw_request(raw: &Value) -> Value {
    raw.as_object()
        .and_then(|object| object.get("id"))
        .filter(|value| is_valid_rpc_id(value))
        .cloned()
        .unwrap_or(Value::Null)
}

fn invalid_rpc_request(
    raw: &Value,
    code: i64,
    message: &str,
    diagnostic_kind: &str,
    field: &str,
    source: &str,
    raw_value: Value,
    recovery_hint: &str,
) -> RpcErrorResponse {
    error_with_data(
        response_id_from_raw_request(raw),
        code,
        message,
        rpc_request_error_data(diagnostic_kind, field, source, raw_value, recovery_hint),
    )
}

fn parse_rpc_request_envelope(line: &str) -> Result<RpcRequest, RpcErrorResponse> {
    let raw: Value =
        serde_json::from_str(line).map_err(|_| error(Value::Null, -32700, "parse error"))?;

    let Some(object) = raw.as_object() else {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid request",
            "invalid_rpc_request_shape",
            "request",
            "jsonrpc.request",
            raw.clone(),
            "pass each JSON-RPC request as a single object line",
        ));
    };

    let Some(jsonrpc_value) = object.get("jsonrpc") else {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid jsonrpc version",
            "invalid_jsonrpc_version",
            "jsonrpc",
            "jsonrpc.jsonrpc",
            Value::Null,
            "set jsonrpc to the string \"2.0\"",
        ));
    };
    let Some(jsonrpc) = jsonrpc_value.as_str() else {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid jsonrpc version",
            "invalid_jsonrpc_version",
            "jsonrpc",
            "jsonrpc.jsonrpc",
            jsonrpc_value.clone(),
            "set jsonrpc to the string \"2.0\"",
        ));
    };
    if jsonrpc != JSONRPC_VERSION {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid jsonrpc version",
            "invalid_jsonrpc_version",
            "jsonrpc",
            "jsonrpc.jsonrpc",
            jsonrpc_value.clone(),
            "set jsonrpc to the string \"2.0\"",
        ));
    }

    let Some(id_value) = object.get("id") else {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid request",
            "invalid_rpc_id_shape",
            "id",
            "jsonrpc.id",
            Value::Null,
            "set id to a string, number, or null so the runtime can correlate the response",
        ));
    };
    if !is_valid_rpc_id(id_value) {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid request",
            "invalid_rpc_id_shape",
            "id",
            "jsonrpc.id",
            id_value.clone(),
            "set id to a string, number, or null so the runtime can correlate the response",
        ));
    }

    let Some(method_value) = object.get("method") else {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid request",
            "invalid_rpc_method_shape",
            "method",
            "jsonrpc.method",
            Value::Null,
            "set method to a supported runtime method string",
        ));
    };
    let Some(method) = method_value.as_str() else {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid request",
            "invalid_rpc_method_shape",
            "method",
            "jsonrpc.method",
            method_value.clone(),
            "set method to a supported runtime method string",
        ));
    };
    if method.trim().is_empty() {
        return Err(invalid_rpc_request(
            &raw,
            -32600,
            "invalid request",
            "invalid_rpc_method_shape",
            "method",
            "jsonrpc.method",
            method_value.clone(),
            "set method to a non-empty supported runtime method string",
        ));
    }

    Ok(RpcRequest {
        id: id_value.clone(),
        method: method.to_string(),
        params: object.get("params").cloned().unwrap_or(Value::Null),
    })
}
