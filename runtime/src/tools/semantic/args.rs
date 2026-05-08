fn validate_semantic_search_args(args: &Map<String, Value>) -> Result<(), ToolExecutionError> {
    for key in args.keys() {
        if key != "query"
            && key != "sources"
            && key != "technical_terms"
            && key != "per_source_limit"
            && key != "max_segments"
            && key != "include_org"
            && key != "refresh"
            && key != "timeout_ms"
            && key != "bridge_script"
        {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported semantic_search argument: {key}"),
            ));
        }
    }
    Ok(())
}

fn validate_prompt_enhancer_args(args: &Map<String, Value>) -> Result<(), ToolExecutionError> {
    for key in args.keys() {
        if key != "prompt"
            && key != "sources"
            && key != "explicit_paths"
            && key != "explicit_symbols"
            && key != "max_evidence"
            && key != "include_org"
            && key != "refresh"
            && key != "timeout_ms"
            && key != "bridge_script"
        {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported prompt_enhancer argument: {key}"),
            ));
        }
    }
    Ok(())
}

fn get_string_array_arg(
    args: &Map<String, Value>,
    tool_name: &str,
    key: &str,
    max_items: usize,
) -> Result<Vec<String>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };
    let raw_items = value.as_array().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} must be an array"),
        )
    })?;
    if raw_items.len() > max_items {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} must contain <= {max_items} items"),
        ));
    }
    let mut values = Vec::new();
    for (index, raw_item) in raw_items.iter().enumerate() {
        let raw_text = raw_item.as_str().ok_or_else(|| {
            ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.{key}[{index}] must be a string"),
            )
        })?;
        let normalized = raw_text.trim();
        if normalized.is_empty() {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.{key}[{index}] cannot be empty"),
            ));
        }
        values.push(normalized.to_string());
    }
    Ok(values)
}

fn resolve_requested_sources(
    args: &Map<String, Value>,
    tool_name: &str,
) -> Result<Vec<String>, ToolExecutionError> {
    let mut normalized: Vec<String> = Vec::new();
    let raw_sources = get_string_array_arg(args, tool_name, "sources", 3)?;
    if raw_sources.is_empty() {
        if args.contains_key("sources") {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.sources must not be empty"),
            ));
        }
        return Ok(vec![
            "code".to_string(),
            "memory".to_string(),
            "wiki".to_string(),
        ]);
    }
    for item in raw_sources {
        let canonical = item.to_ascii_lowercase();
        if canonical != "code" && canonical != "memory" && canonical != "wiki" {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.sources must contain only code, memory, or wiki"),
            ));
        }
        if normalized.iter().any(|entry| entry == &canonical) {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.sources must not contain duplicate entries"),
            ));
        }
        normalized.push(canonical);
    }
    Ok(normalized)
}

fn get_timeout_ms_arg(
    args: &Map<String, Value>,
    tool_name: &str,
    key: &str,
) -> Result<u64, ToolExecutionError> {
    if let Some(value) = args.get(key) {
        let raw = value.as_u64().ok_or_else(|| {
            ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.{key} must be an integer"),
            )
        })?;
        if raw < MIN_SEMANTIC_TIMEOUT_MS {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.{key} must be >= {MIN_SEMANTIC_TIMEOUT_MS}"),
            ));
        }
        if raw > MAX_SEMANTIC_TIMEOUT_MS {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.{key} must be <= {MAX_SEMANTIC_TIMEOUT_MS}"),
            ));
        }
        return Ok(raw);
    }
    if let Ok(raw_env) = env::var("GROBOT_CONTEXTWEAVER_TIMEOUT_MS") {
        let parsed = raw_env.trim().parse::<u64>().map_err(|_| {
            ToolExecutionError::new(
                "invalid_tool_arguments",
                "GROBOT_CONTEXTWEAVER_TIMEOUT_MS must be an integer",
            )
        })?;
        if parsed < MIN_SEMANTIC_TIMEOUT_MS {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!(
                    "GROBOT_CONTEXTWEAVER_TIMEOUT_MS must be >= {MIN_SEMANTIC_TIMEOUT_MS}"
                ),
            ));
        }
        if parsed > MAX_SEMANTIC_TIMEOUT_MS {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!(
                    "GROBOT_CONTEXTWEAVER_TIMEOUT_MS must be <= {MAX_SEMANTIC_TIMEOUT_MS}"
                ),
            ));
        }
        return Ok(parsed);
    }
    Ok(DEFAULT_SEMANTIC_TIMEOUT_MS)
}

fn normalize_refresh_mode(
    args: &Map<String, Value>,
    tool_name: &str,
) -> Result<String, ToolExecutionError> {
    let Some(value) = args.get("refresh") else {
        return Ok("auto".to_string());
    };
    let normalized = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.refresh must be a string"),
            )
        })?
        .to_ascii_lowercase();
    let refresh = match normalized.as_str() {
        "force" | "always" => "force",
        "skip" | "never" => "skip",
        "auto" => "auto",
        _ => {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("{tool_name}.refresh must be one of auto, force, or skip"),
            ))
        }
    };
    Ok(refresh.to_string())
}
