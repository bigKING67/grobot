fn parse_glob_request(args: &Map<String, Value>) -> Result<GlobRequest, ToolExecutionError> {
    for key in args.keys() {
        if key != "pattern" && key != "path" && key != "max_entries" {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported glob argument: {key}"),
            ));
        }
    }

    let pattern = parse_glob_required_string_arg(args, "pattern", "glob.pattern is required")?;
    let path = parse_glob_optional_string_arg(args, "path")?.unwrap_or_else(|| ".".to_string());
    let max_entries = parse_glob_usize_arg(args, "max_entries", 1, MAX_ENTRIES_LIMIT)?
        .unwrap_or(DEFAULT_MAX_ENTRIES);

    Ok(GlobRequest {
        pattern,
        path,
        max_entries,
    })
}

fn parse_glob_required_string_arg(
    args: &Map<String, Value>,
    key: &str,
    required_message: &str,
) -> Result<String, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            required_message.to_string(),
        ));
    };
    let parsed = value.as_str().map(str::trim).ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("glob.{key} must be a string"),
        )
    })?;
    if parsed.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("glob.{key} cannot be empty"),
        ));
    }
    Ok(parsed.to_string())
}

fn parse_glob_optional_string_arg(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let parsed = value.as_str().map(str::trim).ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("glob.{key} must be a string"),
        )
    })?;
    if parsed.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("glob.{key} cannot be empty"),
        ));
    }
    Ok(Some(parsed.to_string()))
}

fn parse_glob_usize_arg(
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
            format!("glob.{key} must be an integer"),
        )
    })?;
    let raw = usize::try_from(raw_u64).map_err(|_| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("glob.{key} is too large"),
        )
    })?;
    if raw < min {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("glob.{key} must be >= {min}"),
        ));
    }
    if raw > max {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("glob.{key} must be <= {max}"),
        ));
    }
    Ok(Some(raw))
}
