fn collect_search_matches_with_rg(
    context: &ToolContextResolved,
    target: &Path,
    request: &SearchRequest,
) -> Result<SearchCollectResult, &'static str> {
    let using_rg_json_context = request.context_before > 0 || request.context_after > 0;
    let mut command = Command::new("rg");
    command
        .arg("--line-number")
        .arg("--no-heading")
        .arg("--with-filename")
        .arg("--json")
        .arg("--color")
        .arg("never");
    if request.context_before > 0 {
        command
            .arg("--before-context")
            .arg(request.context_before.to_string());
    }
    if request.context_after > 0 {
        command
            .arg("--after-context")
            .arg(request.context_after.to_string());
    }
    if request.fixed_mode {
        command.arg("--fixed-strings");
    }
    if !request.case_sensitive {
        command.arg("--ignore-case");
    }
    command.arg("--");
    command.arg(&request.query);
    if target.is_file() {
        command.arg(target);
    } else {
        command.arg(".");
        command.current_dir(target);
    }
    let output = command.output().map_err(|_| "rg_execution_failed")?;
    if !(output.status.success() || output.status.code() == Some(1)) {
        return Err("rg_execution_failed");
    }

    let root_rel = if target.is_file() {
        target
            .parent()
            .map(|value| relative_to_work_dir(&context.work_dir, value))
    } else {
        Some(relative_to_work_dir(&context.work_dir, target))
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    if using_rg_json_context {
        let collect = collect_search_rg_json_with_context(
            context,
            target,
            root_rel.as_deref(),
            request,
            stdout.as_ref(),
        );
        if output.status.success() && collect.matches.is_empty() {
            // rg reported matches but JSON parsing generated no records, fallback to builtin.
            return Err("rg_parse_empty_on_success");
        }
        return Ok(collect);
    }

    let collect = collect_search_rg_json_plain(
        context,
        target,
        root_rel.as_deref(),
        request,
        stdout.as_ref(),
    );
    if output.status.success() && collect.matches.is_empty() {
        // rg reported matches but JSON parsing generated no records, fallback to builtin.
        return Err("rg_parse_empty_on_success");
    }
    Ok(collect)
}

fn collect_search_rg_json_plain(
    context: &ToolContextResolved,
    target: &Path,
    root_rel: Option<&str>,
    request: &SearchRequest,
    stdout: &str,
) -> SearchCollectResult {
    let mut matches: Vec<Value> = Vec::new();
    let mut max_results_reached = false;
    for raw in stdout.lines() {
        let Some((path_text, line_number, text, is_match)) = parse_rg_json_event(raw) else {
            continue;
        };
        if !is_match {
            continue;
        }
        if matches.len() >= request.max_results {
            max_results_reached = true;
            break;
        }
        let normalized_path =
            normalize_search_match_path(context, target, root_rel, &path_text);
        matches.push(build_search_plain_match(
            normalized_path.as_str(),
            line_number,
            text.as_str(),
        ));
    }

    SearchCollectResult {
        matches,
        max_results_reached,
        engine: "rg",
    }
}

fn collect_search_rg_json_with_context(
    context: &ToolContextResolved,
    target: &Path,
    root_rel: Option<&str>,
    request: &SearchRequest,
    stdout: &str,
) -> SearchCollectResult {
    let mut match_entries: Vec<(String, usize)> = Vec::new();
    let mut line_index_by_path: HashMap<String, HashMap<usize, String>> = HashMap::new();
    let mut windows_by_path: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
    let mut recent_by_path: HashMap<String, VecDeque<(usize, String)>> = HashMap::new();
    let mut max_results_reached = false;

    for raw in stdout.lines() {
        let Some((path_text, line_number, text, is_match)) = parse_rg_json_event(raw) else {
            continue;
        };
        let normalized_path = normalize_search_match_path(context, target, root_rel, &path_text);
        let recent_limit = request
            .context_before
            .saturating_add(request.context_after)
            .saturating_add(8)
            .max(4);
        let recent = recent_by_path.entry(normalized_path.clone()).or_default();
        recent.push_back((line_number, text.clone()));
        while recent.len() > recent_limit {
            recent.pop_front();
        }

        let mut should_capture_line = windows_by_path
            .get(&normalized_path)
            .map(|windows| line_in_context_windows(windows, line_number))
            .unwrap_or(false);

        if is_match {
            if match_entries.len() >= request.max_results {
                max_results_reached = true;
                continue;
            }
            match_entries.push((normalized_path.clone(), line_number));
            let window_start = line_number.saturating_sub(request.context_before).max(1);
            let window_end = line_number.saturating_add(request.context_after);
            windows_by_path
                .entry(normalized_path.clone())
                .or_default()
                .push((window_start, window_end));
            should_capture_line = true;
            if let Some(windowed_recent) = recent_by_path.get(&normalized_path) {
                for (recent_line, recent_text) in windowed_recent {
                    if *recent_line >= window_start && *recent_line <= window_end {
                        line_index_by_path
                            .entry(normalized_path.clone())
                            .or_default()
                            .entry(*recent_line)
                            .or_insert(recent_text.clone());
                    }
                }
            }
        }

        if should_capture_line {
            line_index_by_path
                .entry(normalized_path)
                .or_default()
                .entry(line_number)
                .or_insert(text);
        }
    }

    let mut matches: Vec<Value> = Vec::new();
    for (path_value, line_number) in match_entries {
        let records_from_index = line_index_by_path
            .get(&path_value)
            .map(|line_index| {
                build_context_records_from_rg_index(
                    line_index,
                    line_number,
                    request.context_before,
                    request.context_after,
                )
            })
            .unwrap_or_default();
        let records = if records_from_index.is_empty() {
            let Some(records) = read_context_records_for_match(
                context,
                path_value.as_str(),
                line_number,
                request.context_before,
                request.context_after,
            ) else {
                continue;
            };
            records
        } else {
            records_from_index
        };
        if records.is_empty() {
            continue;
        }
        matches.push(build_search_context_match(
            path_value.as_str(),
            line_number,
            records,
        ));
    }

    SearchCollectResult {
        matches,
        max_results_reached,
        engine: "rg",
    }
}
