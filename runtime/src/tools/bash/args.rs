fn parse_bash_request(args: &Map<String, Value>) -> Result<BashRequest, ToolExecutionError> {
    for key in args.keys() {
        if key != "command"
            && key != "timeout_ms"
            && key != "max_output_bytes"
            && key != "max_output_lines"
        {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported bash argument: {key}"),
            ));
        }
    }

    let command = get_string_arg(args, "command")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "bash.command is required"))?;
    if command.chars().count() > MAX_BASH_COMMAND_CHARS {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.command exceeds max length ({MAX_BASH_COMMAND_CHARS} chars)"),
        ));
    }

    let timeout_ms = parse_bash_u64_arg(
        args,
        "timeout_ms",
        MIN_BASH_TIMEOUT_MS,
        MAX_BASH_TIMEOUT_MS,
    )?
    .unwrap_or(DEFAULT_BASH_TIMEOUT_MS);

    let max_output_bytes = parse_bash_usize_arg(
        args,
        "max_output_bytes",
        MIN_BASH_MAX_OUTPUT_BYTES,
        MAX_BASH_MAX_OUTPUT_BYTES,
    )?
    .unwrap_or(DEFAULT_BASH_MAX_OUTPUT_BYTES);

    let max_output_lines = parse_bash_usize_arg(
        args,
        "max_output_lines",
        MIN_BASH_MAX_OUTPUT_LINES,
        MAX_BASH_MAX_OUTPUT_LINES,
    )?
    .unwrap_or(DEFAULT_BASH_MAX_OUTPUT_LINES);

    Ok(BashRequest {
        command,
        timeout_ms,
        max_output_bytes,
        max_output_lines,
    })
}

fn parse_bash_u64_arg(
    args: &Map<String, Value>,
    key: &str,
    min: u64,
    max: u64,
) -> Result<Option<u64>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let raw = value.as_u64().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.{key} must be an integer"),
        )
    })?;
    if raw < min {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.{key} must be >= {min}"),
        ));
    }
    if raw > max {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.{key} must be <= {max}"),
        ));
    }
    Ok(Some(raw))
}

fn parse_bash_usize_arg(
    args: &Map<String, Value>,
    key: &str,
    min: usize,
    max: usize,
) -> Result<Option<usize>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let raw_u64 = value.as_u64().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.{key} must be an integer"),
        )
    })?;
    let raw = usize::try_from(raw_u64).map_err(|_| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.{key} is too large"),
        )
    })?;
    if raw < min {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.{key} must be >= {min}"),
        ));
    }
    if raw > max {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("bash.{key} must be <= {max}"),
        ));
    }
    Ok(Some(raw))
}
