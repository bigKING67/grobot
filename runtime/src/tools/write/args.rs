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
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "write.path is required"))?;
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "write.content is required"))?;
    Ok(WriteRequest { path, content })
}
