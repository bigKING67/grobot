fn parse_search_request(args: &Map<String, Value>) -> Result<SearchRequest, ToolExecutionError> {
    for key in args.keys() {
        if key != "query"
            && key != "path"
            && key != "fixed"
            && key != "regex"
            && key != "case_sensitive"
            && key != "context_before"
            && key != "context_after"
            && key != "max_results"
        {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported search argument: {key}"),
            ));
        }
    }

    let query = parse_search_required_string_arg(args, "query", "search.query is required")?;
    let path = parse_search_optional_string_arg(args, "path")?.unwrap_or_else(|| ".".to_string());
    let max_results = parse_search_usize_arg(args, "max_results", 1, MAX_RESULTS_LIMIT)?
        .unwrap_or(DEFAULT_MAX_RESULTS);
    let context_before = parse_search_i64_arg(
        args,
        "context_before",
        0,
        MAX_SEARCH_CONTEXT_LINES as i64,
    )?
    .unwrap_or(0) as usize;
    let context_after = parse_search_i64_arg(
        args,
        "context_after",
        0,
        MAX_SEARCH_CONTEXT_LINES as i64,
    )?
    .unwrap_or(0) as usize;
    let regex_mode = parse_search_bool_arg(args, "regex")?.unwrap_or(false);
    let fixed_requested = parse_search_bool_arg(args, "fixed")?.unwrap_or(true);
    let fixed_mode = if regex_mode { false } else { fixed_requested };
    let case_sensitive = parse_search_bool_arg(args, "case_sensitive")?.unwrap_or(false);

    Ok(SearchRequest {
        query,
        path,
        max_results,
        context_before,
        context_after,
        fixed_mode,
        case_sensitive,
    })
}

fn parse_search_required_string_arg(
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
            format!("search.{key} must be a string"),
        )
    })?;
    if parsed.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} cannot be empty"),
        ));
    }
    Ok(parsed.to_string())
}

fn parse_search_optional_string_arg(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let parsed = value.as_str().map(str::trim).ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} must be a string"),
        )
    })?;
    if parsed.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} cannot be empty"),
        ));
    }
    Ok(Some(parsed.to_string()))
}

fn parse_search_bool_arg(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<bool>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    value.as_bool().map(Some).ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} must be a boolean"),
        )
    })
}

fn parse_search_usize_arg(
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
            format!("search.{key} must be an integer"),
        )
    })?;
    let raw = usize::try_from(raw_u64).map_err(|_| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} is too large"),
        )
    })?;
    if raw < min {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} must be >= {min}"),
        ));
    }
    if raw > max {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} must be <= {max}"),
        ));
    }
    Ok(Some(raw))
}

fn parse_search_i64_arg(
    args: &Map<String, Value>,
    key: &str,
    min: i64,
    max: i64,
) -> Result<Option<i64>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let raw = value.as_i64().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} must be an integer"),
        )
    })?;
    if raw < min {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} must be >= {min}"),
        ));
    }
    if raw > max {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("search.{key} must be <= {max}"),
        ));
    }
    Ok(Some(raw))
}
