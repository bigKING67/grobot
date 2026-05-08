fn run_semantic_search(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    input: &TurnExecuteInput,
) -> Result<ToolCallOutput, ToolExecutionError> {
    validate_semantic_search_args(args)?;
    let query = parse_required_string_arg(
        args,
        TOOL_SEMANTIC_SEARCH,
        "query",
        "semantic_search.query is required",
    )?;
    let technical_terms =
        get_string_array_arg(args, TOOL_SEMANTIC_SEARCH, "technical_terms", MAX_TERM_ITEMS)?;
    let include_org = get_bool_arg(args, TOOL_SEMANTIC_SEARCH, "include_org", false)?;
    let requested_sources = resolve_requested_sources(args, TOOL_SEMANTIC_SEARCH)?;
    let source_roots = resolve_source_roots(context, input, &requested_sources, include_org);
    let timeout_ms = get_timeout_ms_arg(args, TOOL_SEMANTIC_SEARCH, "timeout_ms")?;
    let bridge_script_override =
        parse_optional_string_arg(args, TOOL_SEMANTIC_SEARCH, "bridge_script")?;
    let bridge_meta = SemanticBridgeRequestMeta {
        tool_name: TOOL_SEMANTIC_SEARCH,
        bridge_command: "semantic-search",
        requested_sources: &requested_sources,
        source_roots: &source_roots,
        timeout_ms,
        bridge_script_override: bridge_script_override.as_deref(),
    };
    if source_roots.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_no_source_available",
            "semantic_search has no available source roots",
        )
        .with_data(semantic_error_data(
            "semantic_no_source_available",
            &bridge_meta,
            "resolve_source_roots",
            None,
        )));
    }
    let per_source_limit = get_usize_arg(
        args,
        TOOL_SEMANTIC_SEARCH,
        "per_source_limit",
        DEFAULT_SEMANTIC_PER_SOURCE_LIMIT,
        MAX_SEMANTIC_PER_SOURCE_LIMIT,
    )?;
    let max_segments = get_usize_arg(
        args,
        TOOL_SEMANTIC_SEARCH,
        "max_segments",
        DEFAULT_SEMANTIC_MAX_SEGMENTS,
        MAX_SEMANTIC_MAX_SEGMENTS,
    )?;
    let refresh = normalize_refresh_mode(args, TOOL_SEMANTIC_SEARCH)?;

    let payload = json!({
        "query": query,
        "technicalTerms": technical_terms,
        "sourceRoots": source_roots.clone(),
        "perSourceLimit": per_source_limit,
        "maxSegments": max_segments,
        "refresh": refresh,
    });
    let result = run_contextweaver_bridge(context, &payload, &bridge_meta)?;
    Ok(ToolCallOutput::from_payload(result))
}

fn run_prompt_enhancer(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    input: &TurnExecuteInput,
) -> Result<ToolCallOutput, ToolExecutionError> {
    validate_prompt_enhancer_args(args)?;
    let prompt = parse_required_string_arg(
        args,
        TOOL_PROMPT_ENHANCER,
        "prompt",
        "prompt_enhancer.prompt is required",
    )?;
    let explicit_paths =
        get_string_array_arg(args, TOOL_PROMPT_ENHANCER, "explicit_paths", MAX_TERM_ITEMS)?;
    let explicit_symbols =
        get_string_array_arg(args, TOOL_PROMPT_ENHANCER, "explicit_symbols", MAX_TERM_ITEMS)?;
    let include_org = get_bool_arg(args, TOOL_PROMPT_ENHANCER, "include_org", false)?;
    let requested_sources = resolve_requested_sources(args, TOOL_PROMPT_ENHANCER)?;
    let source_roots = resolve_source_roots(context, input, &requested_sources, include_org);
    let timeout_ms = get_timeout_ms_arg(args, TOOL_PROMPT_ENHANCER, "timeout_ms")?;
    let bridge_script_override =
        parse_optional_string_arg(args, TOOL_PROMPT_ENHANCER, "bridge_script")?;
    let bridge_meta = SemanticBridgeRequestMeta {
        tool_name: TOOL_PROMPT_ENHANCER,
        bridge_command: "prompt-enhancer",
        requested_sources: &requested_sources,
        source_roots: &source_roots,
        timeout_ms,
        bridge_script_override: bridge_script_override.as_deref(),
    };
    if source_roots.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_no_source_available",
            "prompt_enhancer has no available source roots",
        )
        .with_data(semantic_error_data(
            "semantic_no_source_available",
            &bridge_meta,
            "resolve_source_roots",
            None,
        )));
    }
    let max_evidence = get_usize_arg(
        args,
        TOOL_PROMPT_ENHANCER,
        "max_evidence",
        DEFAULT_PROMPT_MAX_EVIDENCE,
        MAX_PROMPT_MAX_EVIDENCE,
    )?;
    let refresh = normalize_refresh_mode(args, TOOL_PROMPT_ENHANCER)?;

    let payload = json!({
        "prompt": prompt,
        "explicitPaths": explicit_paths,
        "explicitSymbols": explicit_symbols,
        "sourceRoots": source_roots.clone(),
        "maxEvidence": max_evidence,
        "refresh": refresh,
    });
    let result = run_contextweaver_bridge(context, &payload, &bridge_meta)?;
    Ok(ToolCallOutput::from_payload(result))
}
