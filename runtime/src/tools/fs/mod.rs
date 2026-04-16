fn run_list(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path").unwrap_or_else(|| ".".to_string());
    let recursive = get_bool_arg(args, "recursive", false);
    let max_entries = get_usize_arg(args, "max_entries", DEFAULT_MAX_ENTRIES, MAX_ENTRIES_LIMIT);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_dir() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("list target is not a directory: {}", target.display()),
        ));
    }
    let mut entries: Vec<String> = Vec::new();
    if recursive {
        for item in WalkDir::new(&target).min_depth(1) {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            entries.push(relative_to_work_dir(&context.work_dir, entry.path()));
            if entries.len() >= max_entries {
                break;
            }
        }
    } else {
        let read_dir = fs::read_dir(&target).map_err(|error| {
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
            entries.push(relative_to_work_dir(&context.work_dir, &entry.path()));
            if entries.len() >= max_entries {
                break;
            }
        }
    }
    entries.sort();
    let payload = json!({
        "tool": TOOL_LIST,
        "count": entries.len(),
        "entries": entries,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_glob(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let pattern = get_string_arg(args, "pattern")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "glob.pattern is required"))?;
    let path = get_string_arg(args, "path").unwrap_or_else(|| ".".to_string());
    let max_entries = get_usize_arg(args, "max_entries", DEFAULT_MAX_ENTRIES, MAX_ENTRIES_LIMIT);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_dir() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("glob target is not a directory: {}", target.display()),
        ));
    }
    let mut matches: Vec<String> = Vec::new();
    if command_available("fd") {
        let output = Command::new("fd")
            .arg("--hidden")
            .arg("--strip-cwd-prefix")
            .arg("--glob")
            .arg(&pattern)
            .arg(".")
            .current_dir(&target)
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                let root_rel = relative_to_work_dir(&context.work_dir, &target);
                for raw in String::from_utf8_lossy(&output.stdout).lines() {
                    let line = raw.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let composed = if root_rel == "." {
                        line.to_string()
                    } else {
                        format!("{root_rel}/{line}")
                    };
                    matches.push(composed);
                    if matches.len() >= max_entries {
                        break;
                    }
                }
                matches.sort();
                matches.dedup();
                let payload = json!({
                    "tool": TOOL_GLOB,
                    "count": matches.len(),
                    "matches": matches,
                    "engine": "fd",
                });
                return Ok(ToolCallOutput::from_payload(payload));
            }
        }
    }

    let mut builder = GlobSetBuilder::new();
    let glob = Glob::new(&pattern).map_err(|error| {
        ToolExecutionError::new("invalid_tool_arguments", format!("invalid glob pattern: {error}"))
    })?;
    builder.add(glob);
    let matcher = builder.build().map_err(|error| {
        ToolExecutionError::new("invalid_tool_arguments", format!("invalid glob matcher: {error}"))
    })?;
    for item in WalkDir::new(&target).min_depth(1) {
        let entry = match item {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let relative = entry.path().strip_prefix(&target).unwrap_or(entry.path());
        if !matcher.is_match(relative) {
            continue;
        }
        matches.push(relative_to_work_dir(&context.work_dir, entry.path()));
        if matches.len() >= max_entries {
            break;
        }
    }
    matches.sort();
    matches.dedup();
    let payload = json!({
        "tool": TOOL_GLOB,
        "count": matches.len(),
        "matches": matches,
        "engine": "builtin",
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn parse_search_match_line(raw: &str) -> Option<(String, usize, String)> {
    let mut parts = raw.splitn(3, ':');
    let path = parts.next()?.trim();
    let line = parts.next()?.trim();
    let text = parts.next()?.to_string();
    let line_number = line.parse::<usize>().ok()?;
    if path.is_empty() || line_number == 0 {
        return None;
    }
    Some((path.to_string(), line_number, text))
}

fn normalize_search_match_path(
    context: &ToolContextResolved,
    target: &Path,
    root_rel: Option<&str>,
    path_text: &str,
) -> String {
    match root_rel {
        Some(prefix) if prefix != "." && !target.is_file() => {
            format!("{prefix}/{path_text}")
        }
        _ if target.is_file() => relative_to_work_dir(&context.work_dir, target),
        _ => path_text.to_string(),
    }
}

fn read_context_records_for_match(
    context: &ToolContextResolved,
    relative_path: &str,
    line_number: usize,
    context_before: usize,
    context_after: usize,
) -> Option<Vec<Value>> {
    if line_number == 0 {
        return None;
    }
    let target = ensure_within_workspace(&context.work_dir, relative_path, false).ok()?;
    if !target.is_file() {
        return None;
    }
    let file = fs::File::open(&target).ok()?;
    let reader = BufReader::new(file);
    let start = line_number.saturating_sub(context_before).max(1);
    let end = line_number.saturating_add(context_after);
    let mut records: Vec<Value> = Vec::new();
    let mut has_match_line = false;
    for (index, line_result) in reader.lines().enumerate() {
        let row = index + 1;
        if row < start {
            continue;
        }
        if row > end {
            break;
        }
        let line = line_result.ok()?;
        let is_match = row == line_number;
        if is_match {
            has_match_line = true;
        }
        records.push(json!({
            "line": row,
            "match": is_match,
            "text": line,
        }));
    }
    if !has_match_line || records.is_empty() {
        return None;
    }
    Some(records)
}

fn parse_rg_json_event(raw: &str) -> Option<(String, usize, String, bool)> {
    let payload: Value = serde_json::from_str(raw).ok()?;
    let event_type = payload.get("type")?.as_str()?;
    let is_match = match event_type {
        "match" => true,
        "context" => false,
        _ => return None,
    };
    let data = payload.get("data")?;
    let path = data
        .get("path")
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)?;
    let line_number = data.get("line_number").and_then(Value::as_u64)? as usize;
    if line_number == 0 {
        return None;
    }
    let text_raw = data
        .get("lines")
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let text = text_raw.trim_end_matches('\n').trim_end_matches('\r').to_string();
    Some((path.to_string(), line_number, text, is_match))
}

fn build_context_records_from_rg_index(
    line_index: &HashMap<usize, String>,
    line_number: usize,
    context_before: usize,
    context_after: usize,
) -> Vec<Value> {
    if line_number == 0 {
        return Vec::new();
    }
    let start = line_number.saturating_sub(context_before).max(1);
    let end = line_number.saturating_add(context_after);
    let mut records: Vec<Value> = Vec::new();
    let mut has_match_line = false;
    for row in start..=end {
        let Some(text) = line_index.get(&row) else {
            continue;
        };
        let is_match = row == line_number;
        if is_match {
            has_match_line = true;
        }
        records.push(json!({
            "line": row,
            "match": is_match,
            "text": text,
        }));
    }
    if !has_match_line {
        return Vec::new();
    }
    records
}

fn line_in_context_windows(windows: &[(usize, usize)], line_number: usize) -> bool {
    for (start, end) in windows {
        if line_number >= *start && line_number <= *end {
            return true;
        }
    }
    false
}

fn search_line_matches(
    line: &str,
    fixed_mode: bool,
    case_sensitive: bool,
    query: &str,
    fixed_casefold_regex: Option<&regex::Regex>,
    needle_lower: Option<&str>,
    regex: Option<&regex::Regex>,
) -> bool {
    if fixed_mode {
        if case_sensitive {
            return line.contains(query);
        }
        if let Some(compiled) = fixed_casefold_regex {
            return compiled.is_match(line);
        }
        if let Some(needle) = needle_lower {
            return line.to_lowercase().contains(needle);
        }
        return false;
    }
    if let Some(compiled) = regex {
        return compiled.is_match(line);
    }
    false
}

struct PendingContextMatch {
    line_number: usize,
    end_line: usize,
    records: Vec<Value>,
}

fn collect_builtin_search_matches_for_file(
    context: &ToolContextResolved,
    file: &Path,
    fixed_mode: bool,
    case_sensitive: bool,
    query: &str,
    fixed_casefold_regex: Option<&regex::Regex>,
    needle_lower: Option<&str>,
    regex: Option<&regex::Regex>,
    context_before: usize,
    context_after: usize,
    matches: &mut Vec<Value>,
    max_results: usize,
) -> bool {
    let file_path = file;
    let file_handle = match fs::File::open(file_path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut reader = BufReader::new(file_handle);
    let probe = match reader.fill_buf() {
        Ok(probe) => probe,
        Err(_) => return false,
    };
    if probe.iter().take(1024).any(|byte| *byte == 0) {
        return false;
    }
    let relative_path = relative_to_work_dir(&context.work_dir, file_path);
    if context_before == 0 && context_after == 0 {
        for (index, line_result) in reader.lines().enumerate() {
            let line = match line_result {
                Ok(line) => line,
                Err(_) => return false,
            };
            let matched = search_line_matches(
                &line,
                fixed_mode,
                case_sensitive,
                query,
                fixed_casefold_regex,
                needle_lower,
                regex,
            );
            if !matched {
                continue;
            }
            matches.push(json!({
                "path": relative_path.clone(),
                "line": index + 1,
                "text": line,
            }));
            if matches.len() >= max_results {
                return true;
            }
        }
        return false;
    }

    let mut previous_lines: VecDeque<(usize, String)> = VecDeque::new();
    let mut pending_matches: Vec<PendingContextMatch> = Vec::new();
    let mut stop_new_matches = false;
    for (index, line_result) in reader.lines().enumerate() {
        let line = match line_result {
            Ok(line) => line,
            Err(_) => return false,
        };
        let line_number = index + 1;
        for pending in &mut pending_matches {
            if line_number > pending.line_number && line_number <= pending.end_line {
                pending.records.push(json!({
                    "line": line_number,
                    "match": false,
                    "text": line.clone(),
                }));
            }
        }
        let mut pending_index = 0_usize;
        while pending_index < pending_matches.len() {
            if line_number >= pending_matches[pending_index].end_line {
                let completed = pending_matches.remove(pending_index);
                matches.push(json!({
                    "path": relative_path.clone(),
                    "line": completed.line_number,
                    "records": completed.records,
                }));
                continue;
            }
            pending_index += 1;
        }
        if !stop_new_matches {
        let matched = search_line_matches(
                &line,
            fixed_mode,
            case_sensitive,
            query,
            fixed_casefold_regex,
            needle_lower,
            regex,
        );
            if matched {
                let mut records: Vec<Value> = previous_lines
                    .iter()
                    .map(|(row, text)| {
                        json!({
                            "line": *row,
                            "match": false,
                            "text": text,
                        })
                    })
                    .collect();
                records.push(json!({
                    "line": line_number,
                    "match": true,
                    "text": line.clone(),
                }));
                if context_after == 0 {
                    matches.push(json!({
                        "path": relative_path.clone(),
                        "line": line_number,
                        "records": records,
                    }));
                } else {
                    pending_matches.push(PendingContextMatch {
                        line_number,
                        end_line: line_number.saturating_add(context_after),
                        records,
                    });
                }
                let selected_count = matches.len().saturating_add(pending_matches.len());
                if selected_count >= max_results {
                    stop_new_matches = true;
                    if context_after == 0 && pending_matches.is_empty() {
                        return true;
                    }
                }
            }
        }
        previous_lines.push_back((line_number, line));
        while previous_lines.len() > context_before {
            previous_lines.pop_front();
        }
    }
    for pending in pending_matches {
        matches.push(json!({
            "path": relative_path.clone(),
            "line": pending.line_number,
            "records": pending.records,
        }));
        if matches.len() >= max_results {
            break;
        }
    }
    false
}

fn run_search(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let query = get_string_arg(args, "query")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "search.query is required"))?;
    let path = get_string_arg(args, "path").unwrap_or_else(|| ".".to_string());
    let max_results = get_usize_arg(args, "max_results", DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT);
    let context_before = get_i64_arg(args, "context_before", 0, 0, 16) as usize;
    let context_after = get_i64_arg(args, "context_after", 0, 0, 16) as usize;
    let regex_mode = get_bool_arg(args, "regex", false);
    let fixed_mode = if regex_mode {
        false
    } else {
        get_bool_arg(args, "fixed", true)
    };
    let case_sensitive = get_bool_arg(args, "case_sensitive", false);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;

    if command_available("rg") {
        let using_rg_json_context = context_before > 0 || context_after > 0;
        let mut command = Command::new("rg");
        command
            .arg("--line-number")
            .arg("--no-heading")
            .arg("--color")
            .arg("never");
        if using_rg_json_context {
            command.arg("--json");
            if context_before > 0 {
                command
                    .arg("--before-context")
                    .arg(context_before.to_string());
            }
            if context_after > 0 {
                command
                    .arg("--after-context")
                    .arg(context_after.to_string());
            }
        }
        if fixed_mode {
            command.arg("--fixed-strings");
        }
        if !case_sensitive {
            command.arg("--ignore-case");
        }
        command.arg(&query);
        if target.is_file() {
            command.arg(&target);
        } else {
            command.arg(".");
            command.current_dir(&target);
        }
        if let Ok(output) = command.output() {
            if output.status.success() || output.status.code() == Some(1) {
                let mut rg_matches: Vec<(String, usize, String)> = Vec::new();
                let root_rel = if target.is_file() {
                    target.parent().map(|value| relative_to_work_dir(&context.work_dir, value))
                } else {
                    Some(relative_to_work_dir(&context.work_dir, &target))
                };
                let matches = if using_rg_json_context {
                    let mut match_entries: Vec<(String, usize)> = Vec::new();
                    let mut line_index_by_path: HashMap<String, HashMap<usize, String>> =
                        HashMap::new();
                    let mut windows_by_path: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
                    let mut recent_by_path: HashMap<String, VecDeque<(usize, String)>> = HashMap::new();
                    for raw in String::from_utf8_lossy(&output.stdout).lines() {
                        let Some((path_text, line_number, text, is_match)) =
                            parse_rg_json_event(raw)
                        else {
                            continue;
                        };
                        let normalized_path = normalize_search_match_path(
                            context,
                            &target,
                            root_rel.as_deref(),
                            &path_text,
                        );
                        let recent_limit = context_before.saturating_add(context_after).saturating_add(8);
                        let recent_limit = recent_limit.max(4);
                        let recent = recent_by_path
                            .entry(normalized_path.clone())
                            .or_default();
                        recent.push_back((line_number, text.clone()));
                        while recent.len() > recent_limit {
                            recent.pop_front();
                        }
                        let mut should_capture_line = windows_by_path
                            .get(&normalized_path)
                            .map(|windows| line_in_context_windows(windows, line_number))
                            .unwrap_or(false);
                        if is_match {
                            if match_entries.len() < max_results {
                                match_entries.push((normalized_path.clone(), line_number));
                                let window_start = line_number.saturating_sub(context_before).max(1);
                                let window_end = line_number.saturating_add(context_after);
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
                    for (path_value, line_number) in match_entries.into_iter().take(max_results) {
                        let records_from_index = line_index_by_path
                            .get(&path_value)
                            .map(|line_index| {
                                build_context_records_from_rg_index(
                                    line_index,
                                    line_number,
                                    context_before,
                                    context_after,
                                )
                            })
                            .unwrap_or_default();
                        let records = if records_from_index.is_empty() {
                            let Some(records) = read_context_records_for_match(
                                context,
                                &path_value,
                                line_number,
                                context_before,
                                context_after,
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
                        matches.push(json!({
                            "path": path_value,
                            "line": line_number,
                            "records": records,
                        }));
                    }
                    matches
                } else {
                    for raw in String::from_utf8_lossy(&output.stdout).lines() {
                        if let Some((path_text, line_number, text)) = parse_search_match_line(raw) {
                            let normalized_path = normalize_search_match_path(
                                context,
                                &target,
                                root_rel.as_deref(),
                                &path_text,
                            );
                            rg_matches.push((normalized_path, line_number, text));
                            if rg_matches.len() >= max_results {
                                break;
                            }
                        }
                    }
                    rg_matches
                        .into_iter()
                        .map(|(path_value, line_number, text)| {
                            json!({
                                "path": path_value,
                                "line": line_number,
                                "text": text,
                            })
                        })
                        .collect::<Vec<Value>>()
                };
                if using_rg_json_context && output.status.success() && matches.is_empty() {
                    // If rg reported matches but JSON parsing produced none, fall back to builtin search.
                } else {
                    let payload = json!({
                        "tool": TOOL_SEARCH,
                        "count": matches.len(),
                        "matches": matches,
                        "engine": "rg",
                    });
                    return Ok(ToolCallOutput::from_payload(payload));
                }
            }
        }
    }

    let regex = if fixed_mode {
        None
    } else {
        Some(
            RegexBuilder::new(&query)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|error| {
                    ToolExecutionError::new(
                        "invalid_tool_arguments",
                        format!("invalid regex query: {error}"),
                    )
                })?,
        )
    };
    let fixed_casefold_regex = if fixed_mode && !case_sensitive {
        Some(
            RegexBuilder::new(&regex::escape(&query))
                .case_insensitive(true)
                .build()
                .map_err(|error| {
                    ToolExecutionError::new(
                        "invalid_tool_arguments",
                        format!("invalid fixed query regex: {error}"),
                    )
                })?,
        )
    } else {
        None
    };
    let needle_lower = if fixed_mode && !case_sensitive && fixed_casefold_regex.is_none() {
        Some(query.to_lowercase())
    } else {
        None
    };
    let mut matches: Vec<Value> = Vec::new();
    if target.is_file() {
        let _ = collect_builtin_search_matches_for_file(
            context,
            &target,
            fixed_mode,
            case_sensitive,
            &query,
            fixed_casefold_regex.as_ref(),
            needle_lower.as_deref(),
            regex.as_ref(),
            context_before,
            context_after,
            &mut matches,
            max_results,
        );
    } else if target.is_dir() {
        for item in WalkDir::new(&target).into_iter() {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let reached_limit = collect_builtin_search_matches_for_file(
                context,
                entry.path(),
                fixed_mode,
                case_sensitive,
                &query,
                fixed_casefold_regex.as_ref(),
                needle_lower.as_deref(),
                regex.as_ref(),
                context_before,
                context_after,
                &mut matches,
                max_results,
            );
            if reached_limit {
                break;
            }
        }
    } else {
        return Err(ToolExecutionError::new(
            "path_invalid",
            "search target must be file or directory",
        ));
    }
    let payload = json!({
        "tool": TOOL_SEARCH,
        "count": matches.len(),
        "matches": matches,
        "engine": "builtin",
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_write(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "write.path is required"))?;
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "write.content is required"))?;
    let append = get_bool_arg(args, "append", false);
    let target = ensure_within_workspace(&context.work_dir, &path, true)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to create parent directories: {error}"),
            )
        })?;
    }
    if append {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target)
            .map_err(|error| {
                ToolExecutionError::new(
                    "tool_execution_failed",
                    format!("failed to open file for append: {error}"),
                )
            })?;
        file.write_all(content.as_bytes()).map_err(|error| {
            ToolExecutionError::new("tool_execution_failed", format!("failed to append file: {error}"))
        })?;
    } else {
        fs::write(&target, content.as_bytes()).map_err(|error| {
            ToolExecutionError::new("tool_execution_failed", format!("failed to write file: {error}"))
        })?;
    }
    let payload = json!({
        "tool": TOOL_WRITE,
        "path": relative_to_work_dir(&context.work_dir, &target),
        "bytes_written": content.as_bytes().len(),
        "append": append,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_edit(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "edit.path is required"))?;
    let old_text = args
        .get("old_text")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "edit.old_text is required"))?;
    if old_text.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "edit.old_text cannot be empty",
        ));
    }
    let new_text = args
        .get("new_text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let replace_all = get_bool_arg(args, "replace_all", false);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_file() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("edit target is not a file: {}", target.display()),
        ));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}"))
    })?;
    let (occurrences, replacements, updated) = if replace_all {
        let occurrences = content.matches(&old_text).count();
        if occurrences == 0 {
            return Err(ToolExecutionError::new(
                "edit_not_found",
                "old_text not found in file",
            ));
        }
        (occurrences, occurrences, content.replace(&old_text, &new_text))
    } else {
        let Some(first_index) = content.find(&old_text) else {
            return Err(ToolExecutionError::new(
                "edit_not_found",
                "old_text not found in file",
            ));
        };
        let remainder_start = first_index + old_text.len();
        let trailing_occurrences = content[remainder_start..].matches(&old_text).count();
        let occurrences = 1 + trailing_occurrences;
        let mut updated = String::with_capacity(
            content
                .len()
                .saturating_sub(old_text.len())
                .saturating_add(new_text.len()),
        );
        updated.push_str(&content[..first_index]);
        updated.push_str(&new_text);
        updated.push_str(&content[remainder_start..]);
        (occurrences, 1, updated)
    };
    fs::write(&target, updated.as_bytes()).map_err(|error| {
        ToolExecutionError::new("tool_execution_failed", format!("failed to write file: {error}"))
    })?;
    let payload = json!({
        "tool": TOOL_EDIT,
        "path": relative_to_work_dir(&context.work_dir, &target),
        "occurrences_found": occurrences,
        "replacements": replacements,
    });
    Ok(ToolCallOutput::from_payload(payload))
}
