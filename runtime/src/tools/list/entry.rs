fn run_list(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let request = parse_list_request(args)?;
    let target = ensure_within_workspace(&context.work_dir, &request.path, false)?;
    if !target.is_dir() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("list target is not a directory: {}", target.display()),
        ));
    }

    let result = collect_list_entries(context, &target, &request)?;
    let payload = json!({
        "tool": TOOL_LIST,
        "count": result.entries.len(),
        "entries": result.entries,
        "max_entries": request.max_entries,
        "limit_reached": result.limit_reached,
        "truncation": build_list_truncation_payload(&result, request.max_entries),
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn collect_list_entries(
    context: &ToolContextResolved,
    target: &Path,
    request: &ListRequest,
) -> Result<ListEntriesResult, ToolExecutionError> {
    let mut entries: BTreeSet<String> = BTreeSet::new();
    let mut limit_reached = false;

    if request.recursive {
        for item in WalkDir::new(target).min_depth(1) {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            insert_list_entry_with_limit(
                &mut entries,
                relative_to_work_dir(&context.work_dir, entry.path()),
                request.max_entries,
                &mut limit_reached,
            );
        }
    } else {
        let read_dir = fs::read_dir(target).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to read directory: {error}"),
            )
        })?;
        for item in read_dir {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            insert_list_entry_with_limit(
                &mut entries,
                relative_to_work_dir(&context.work_dir, &entry.path()),
                request.max_entries,
                &mut limit_reached,
            );
        }
    }

    let entries = entries.into_iter().collect::<Vec<String>>();

    Ok(ListEntriesResult {
        entries,
        limit_reached,
    })
}

fn insert_list_entry_with_limit(
    entries: &mut BTreeSet<String>,
    candidate: String,
    max_entries: usize,
    limit_reached: &mut bool,
) {
    if !entries.insert(candidate) {
        return;
    }
    if entries.len() <= max_entries {
        return;
    }
    *limit_reached = true;
    if let Some(largest) = entries.iter().next_back().cloned() {
        entries.remove(largest.as_str());
    }
}
