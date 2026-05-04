fn write_mcp_message(stdin: &mut ChildStdin, payload: &Value) -> Result<(), ToolExecutionError> {
    let body = serde_json::to_string(payload).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("failed to serialize MCP payload: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_protocol_error",
            "serialize_request",
            "serialize_failed",
            "inspect MCP request arguments and remove non-serializable values",
        ))
    })?;
    let header = format!("Content-Length: {}\r\n\r\n", body.as_bytes().len());
    stdin.write_all(header.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP header: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "write_header",
            "write_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    stdin.write_all(body.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP body: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "write_body",
            "write_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    stdin.flush().map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to flush MCP request: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "flush_request",
            "flush_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    Ok(())
}

fn read_mcp_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, ToolExecutionError> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(|error| {
            ToolExecutionError::new(
                "mcp_transport_error",
                format!("failed to read MCP header line: {error}"),
            )
            .with_data(mcp_error_data(
                "mcp_transport_error",
                "read_header",
                "read_failed",
                "restart the MCP session or choose an alternate server/tool",
            ))
        })?;
        if read == 0 {
            return Err(ToolExecutionError::new(
                "mcp_transport_error",
                "MCP server closed stdout before response",
            )
            .with_data(mcp_error_data(
                "mcp_transport_error",
                "read_header",
                "stdout_closed",
                "restart the MCP session or choose an alternate server/tool",
            )));
        }
        let normalized = line.trim_end_matches(['\r', '\n']);
        if normalized.is_empty() {
            break;
        }
        let mut parts = normalized.splitn(2, ':');
        let name = parts.next().unwrap_or("").trim().to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();
        if name == "content-length" {
            let parsed = value.parse::<usize>().map_err(|error| {
                ToolExecutionError::new(
                    "mcp_protocol_error",
                    format!("invalid MCP content-length header: {error}"),
                )
                .with_data(mcp_error_data(
                    "mcp_protocol_error",
                    "read_header",
                    "invalid_content_length",
                    "restart the MCP server or choose an alternate server/tool",
                ))
            })?;
            content_length = Some(parsed);
        }
    }
    let length = content_length.ok_or_else(|| {
        ToolExecutionError::new("mcp_protocol_error", "MCP response missing content-length")
            .with_data(mcp_error_data(
                "mcp_protocol_error",
                "read_header",
                "missing_content_length",
                "restart the MCP server or choose an alternate server/tool",
            ))
    })?;
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to read MCP response body: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_transport_error",
            "read_body",
            "read_failed",
            "restart the MCP session or choose an alternate server/tool",
        ))
    })?;
    serde_json::from_slice::<Value>(&body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("invalid MCP JSON payload: {error}"),
        )
        .with_data(mcp_error_data(
            "mcp_protocol_error",
            "parse_response",
            "invalid_json",
            "restart the MCP server or choose an alternate server/tool",
        ))
    })
}

fn read_mcp_result_for_id(
    reader: &mut BufReader<ChildStdout>,
    request_id: i64,
) -> Result<Value, ToolExecutionError> {
    for _ in 0..64 {
        let message = read_mcp_message(reader)?;
        let id = message.get("id");
        let matched = match id {
            Some(value) => value.as_i64() == Some(request_id),
            None => false,
        };
        if !matched {
            continue;
        }
        if let Some(error) = message.get("error") {
            let detail = serde_json::to_string(error).unwrap_or_else(|_| "{}".to_string());
            return Err(ToolExecutionError::new(
                "mcp_rpc_error",
                format!("MCP response contains error: {detail}"),
            )
            .with_data(mcp_rpc_error_data(request_id, error)));
        }
        return Ok(message.get("result").cloned().unwrap_or_else(|| json!({})));
    }
    Err(ToolExecutionError::new(
        "mcp_protocol_error",
        "MCP response id not observed within read budget",
    )
    .with_data({
        let mut data = mcp_error_data_map(
            "mcp_protocol_error",
            "read_response",
            "response_id_not_observed",
            "restart the MCP session or choose an alternate server/tool",
        );
        data.insert("request_id".to_string(), json!(request_id));
        data.insert("read_budget".to_string(), json!(64));
        Value::Object(data)
    }))
}
