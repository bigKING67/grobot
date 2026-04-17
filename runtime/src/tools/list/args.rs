fn parse_list_request(args: &Map<String, Value>) -> Result<ListRequest, ToolExecutionError> {
    for key in args.keys() {
        if key != "path" && key != "recursive" && key != "max_entries" {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported list argument: {key}"),
            ));
        }
    }

    let path = parse_list_string_arg(args, "path")?.unwrap_or_else(|| ".".to_string());
    let recursive = parse_list_bool_arg(args, "recursive")?.unwrap_or(false);
    let max_entries = parse_list_usize_arg(args, "max_entries", 1, MAX_ENTRIES_LIMIT)?
        .unwrap_or(DEFAULT_MAX_ENTRIES);

    Ok(ListRequest {
        path,
        recursive,
        max_entries,
    })
}

fn parse_list_string_arg(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let parsed = value.as_str().map(str::trim).ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("list.{key} must be a string"),
        )
    })?;
    if parsed.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("list.{key} cannot be empty"),
        ));
    }
    Ok(Some(parsed.to_string()))
}

fn parse_list_bool_arg(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<bool>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    value.as_bool().map(Some).ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("list.{key} must be a boolean"),
        )
    })
}

fn parse_list_usize_arg(
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
            format!("list.{key} must be an integer"),
        )
    })?;
    let raw = usize::try_from(raw_u64).map_err(|_| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("list.{key} is too large"),
        )
    })?;
    if raw < min {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("list.{key} must be >= {min}"),
        ));
    }
    if raw > max {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("list.{key} must be <= {max}"),
        ));
    }
    Ok(Some(raw))
}
