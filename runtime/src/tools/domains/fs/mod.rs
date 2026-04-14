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

    if command_available("rg") && context_before == 0 && context_after == 0 {
        let mut command = Command::new("rg");
        command
            .arg("--line-number")
            .arg("--no-heading")
            .arg("--color")
            .arg("never");
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
                let mut matches: Vec<Value> = Vec::new();
                let root_rel = if target.is_file() {
                    target.parent().map(|value| relative_to_work_dir(&context.work_dir, value))
                } else {
                    Some(relative_to_work_dir(&context.work_dir, &target))
                };
                for raw in String::from_utf8_lossy(&output.stdout).lines() {
                    if let Some((path_text, line_number, text)) = parse_search_match_line(raw) {
                        let normalized_path = match &root_rel {
                            Some(prefix) if prefix != "." && !target.is_file() => {
                                format!("{prefix}/{path_text}")
                            }
                            _ if target.is_file() => relative_to_work_dir(&context.work_dir, &target),
                            _ => path_text,
                        };
                        matches.push(json!({
                            "path": normalized_path,
                            "line": line_number,
                            "text": text,
                        }));
                        if matches.len() >= max_results {
                            break;
                        }
                    }
                }
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

    let mut files: Vec<PathBuf> = Vec::new();
    if target.is_file() {
        files.push(target.clone());
    } else if target.is_dir() {
        for item in WalkDir::new(&target).into_iter() {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            files.push(entry.path().to_path_buf());
        }
    } else {
        return Err(ToolExecutionError::new(
            "path_invalid",
            "search target must be file or directory",
        ));
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
    let needle_lower = if fixed_mode && !case_sensitive {
        Some(query.to_lowercase())
    } else {
        None
    };
    let mut matches: Vec<Value> = Vec::new();
    'file_loop: for file in files {
        let bytes = match fs::read(&file) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.iter().take(1024).any(|byte| *byte == 0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = content.lines().collect();
        for (index, line) in lines.iter().enumerate() {
            let matched = if fixed_mode {
                if case_sensitive {
                    line.contains(&query)
                } else if let Some(needle) = needle_lower.as_ref() {
                    line.to_lowercase().contains(needle)
                } else {
                    false
                }
            } else if let Some(compiled) = regex.as_ref() {
                compiled.is_match(line)
            } else {
                false
            };
            if !matched {
                continue;
            }
            let line_number = index + 1;
            if context_before == 0 && context_after == 0 {
                matches.push(json!({
                    "path": relative_to_work_dir(&context.work_dir, &file),
                    "line": line_number,
                    "text": *line,
                }));
            } else {
                let start = index.saturating_sub(context_before);
                let end = std::cmp::min(lines.len().saturating_sub(1), index + context_after);
                let mut records: Vec<Value> = Vec::new();
                for row in start..=end {
                    records.push(json!({
                        "line": row + 1,
                        "match": row == index,
                        "text": lines[row],
                    }));
                }
                matches.push(json!({
                    "path": relative_to_work_dir(&context.work_dir, &file),
                    "line": line_number,
                    "records": records,
                }));
            }
            if matches.len() >= max_results {
                break 'file_loop;
            }
        }
    }
    let payload = json!({
        "tool": TOOL_SEARCH,
        "count": matches.len(),
        "matches": matches,
        "engine": "builtin",
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_read(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "read.path is required"))?;
    let line_start = get_usize_arg(args, "line_start", 1, usize::MAX);
    let line_end_raw = args.get("line_end").and_then(Value::as_u64).map(|value| value as usize);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_file() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("read target is not a file: {}", target.display()),
        ));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}"))
    })?;
    let lines: Vec<&str> = content.lines().collect();
    if line_start == 0 {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "line_start must be >= 1",
        ));
    }
    let start = line_start.saturating_sub(1);
    let end = line_end_raw.unwrap_or(lines.len()).max(line_start);
    let mut selected: Vec<&str> = Vec::new();
    for index in start..std::cmp::min(end, lines.len()) {
        selected.push(lines[index]);
    }
    let selected_text = selected.join("\n");
    let payload = json!({
        "tool": TOOL_READ,
        "path": relative_to_work_dir(&context.work_dir, &target),
        "line_start": line_start,
        "line_end": if selected.is_empty() { line_start.saturating_sub(1) } else { line_start + selected.len() - 1 },
        "content": selected_text,
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
    let occurrences = content.matches(&old_text).count();
    if occurrences == 0 {
        return Err(ToolExecutionError::new(
            "edit_not_found",
            "old_text not found in file",
        ));
    }
    let replacements = if replace_all { occurrences } else { 1 };
    let updated = if replace_all {
        content.replace(&old_text, &new_text)
    } else {
        content.replacen(&old_text, &new_text, 1)
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
