fn parse_write_request(args: &Map<String, Value>) -> Result<WriteRequest, ToolExecutionError> {
    if args.contains_key("append") {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "legacy write.append has been removed in write v2",
        ));
    }
    for key in args.keys() {
        if key != "path" && key != "content" {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported write argument: {key}"),
            ));
        }
    }
    let path = parse_required_string_arg(args, TOOL_WRITE, "path", "write.path is required")?;
    let Some(content_value) = args.get("content") else {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "write.content is required",
        ));
    };
    let content = content_value.as_str().ok_or_else(|| {
        ToolExecutionError::new("invalid_tool_arguments", "write.content must be a string")
    })?;
    Ok(WriteRequest {
        path,
        content: content.to_string(),
    })
}
