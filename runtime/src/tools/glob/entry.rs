fn run_glob(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let request = parse_glob_request(args)?;
    let target = ensure_within_workspace(&context.work_dir, &request.path, false)?;
    if !target.is_dir() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("glob target is not a directory: {}", target.display()),
        ));
    }

    let result = collect_glob_matches_with_fd(context, &target, &request)
        .unwrap_or_else(|| collect_glob_matches_with_builtin(context, &target, &request))
        ?;
    let payload = json!({
        "tool": TOOL_GLOB,
        "count": result.matches.len(),
        "matches": result.matches,
        "engine": result.engine,
        "max_entries": request.max_entries,
        "limit_reached": result.limit_reached,
        "truncation": build_glob_truncation_payload(&result, request.max_entries),
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn collect_glob_matches_with_fd(
    context: &ToolContextResolved,
    target: &Path,
    request: &GlobRequest,
) -> Option<Result<GlobMatchesResult, ToolExecutionError>> {
    if !command_available("fd") {
        return None;
    }
    let output = Command::new("fd")
        .arg("--hidden")
        .arg("--strip-cwd-prefix")
        .arg("--glob")
        .arg(&request.pattern)
        .arg(".")
        .current_dir(target)
        .output();
    let Ok(output) = output else {
        return None;
    };
    if !output.status.success() {
        return None;
    }

    let mut matches: BTreeSet<String> = BTreeSet::new();
    let mut limit_reached = false;
    let root_rel = relative_to_work_dir(&context.work_dir, target);

    for raw in String::from_utf8_lossy(&output.stdout).lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let normalized = if root_rel == "." {
            line.to_string()
        } else {
            format!("{root_rel}/{line}")
        };
        insert_glob_match_with_limit(
            &mut matches,
            normalized,
            request.max_entries,
            &mut limit_reached,
        );
    }

    let matches = matches.into_iter().collect::<Vec<String>>();

    Some(Ok(GlobMatchesResult {
        matches,
        limit_reached,
        engine: "fd",
    }))
}

fn collect_glob_matches_with_builtin(
    context: &ToolContextResolved,
    target: &Path,
    request: &GlobRequest,
) -> Result<GlobMatchesResult, ToolExecutionError> {
    let mut builder = GlobSetBuilder::new();
    let glob = Glob::new(&request.pattern).map_err(|error| {
        ToolExecutionError::new("invalid_tool_arguments", format!("invalid glob pattern: {error}"))
    })?;
    builder.add(glob);
    let matcher = builder.build().map_err(|error| {
        ToolExecutionError::new("invalid_tool_arguments", format!("invalid glob matcher: {error}"))
    })?;

    let mut matches: BTreeSet<String> = BTreeSet::new();
    let mut limit_reached = false;

    for item in WalkDir::new(target).min_depth(1) {
        let entry = match item {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let relative = entry.path().strip_prefix(target).unwrap_or(entry.path());
        if !matcher.is_match(relative) {
            continue;
        }
        let normalized = relative_to_work_dir(&context.work_dir, entry.path());
        insert_glob_match_with_limit(
            &mut matches,
            normalized,
            request.max_entries,
            &mut limit_reached,
        );
    }

    let matches = matches.into_iter().collect::<Vec<String>>();

    Ok(GlobMatchesResult {
        matches,
        limit_reached,
        engine: "builtin",
    })
}

fn insert_glob_match_with_limit(
    matches: &mut BTreeSet<String>,
    candidate: String,
    max_entries: usize,
    limit_reached: &mut bool,
) {
    if !matches.insert(candidate) {
        return;
    }
    if matches.len() <= max_entries {
        return;
    }
    *limit_reached = true;
    if let Some(largest) = matches.iter().next_back().cloned() {
        matches.remove(largest.as_str());
    }
}
