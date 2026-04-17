fn run_search(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let request = parse_search_request(args)?;
    let target = ensure_within_workspace(&context.work_dir, &request.path, false)?;

    let rg_available = command_available("rg");
    let (collect, fallback_reason): (SearchCollectResult, Option<&'static str>) = if rg_available {
        match collect_search_matches_with_rg(context, &target, &request) {
            Ok(result) => (result, None),
            Err(reason) => (
                collect_search_matches_with_builtin(context, &target, &request)?,
                Some(reason),
            ),
        }
    } else {
        (
            collect_search_matches_with_builtin(context, &target, &request)?,
            Some("rg_not_available"),
        )
    };
    let max_results_reached = collect.max_results_reached;
    let engine = collect.engine;
    let output = apply_search_output_byte_limit(collect.matches);
    let limit_reached = max_results_reached || output.output_bytes_reached;
    let fallback_used = fallback_reason.is_some();
    let payload = json!({
        "tool": TOOL_SEARCH,
        "count": output.matches.len(),
        "matches": output.matches,
        "engine": engine,
        "preferred_engine": "rg",
        "fallback": {
            "used": fallback_used,
            "from": if fallback_used { Some("rg") } else { None::<&str> },
            "to": if fallback_used { Some("builtin") } else { None::<&str> },
            "reason": fallback_reason,
        },
        "max_results": request.max_results,
        "limit_reached": limit_reached,
        "truncation": build_search_truncation_payload(&request, max_results_reached, &output),
    });
    Ok(ToolCallOutput::from_payload(payload))
}
