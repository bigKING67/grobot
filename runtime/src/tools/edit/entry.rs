fn run_edit(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "edit.path is required"))?;
    let edits = parse_edit_operations(args)?;
    let normalized_edits = normalize_edit_operations(&edits);

    let target = resolve_read_target(context, &path)?;
    ensure_text_read_allowed(&target)?;
    let relative_path = relative_to_work_dir(&context.work_dir, &target);
    let file_lock = acquire_file_mutation_lock(&target)?;
    let _file_guard = file_lock
        .lock()
        .map_err(|_| ToolExecutionError::new("runtime_state_unavailable", "failed to acquire edit file lock"))?;

    let metadata = fs::metadata(&target).map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to read file metadata: {error}"),
        )
    })?;
    if metadata.len() > EDIT_MAX_FILE_BYTES {
        return Err(ToolExecutionError::new(
            "edit_file_too_large",
            format!(
                "edit target exceeds max size ({} > {} bytes)",
                metadata.len(),
                EDIT_MAX_FILE_BYTES
            ),
        ));
    }
    let current_mtime_ms = read_file_mtime_ms(&target)?;
    let snapshot = lookup_edit_read_snapshot(context.session_key.as_str(), &target).ok_or_else(|| {
        ToolExecutionError::new(
            "edit_read_required",
            format!("edit requires a prior read in the same session: {relative_path}"),
        )
    })?;

    let file_bytes = fs::read(&target)
        .map_err(|error| ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}")))?;
    if file_bytes.contains(&0_u8) {
        return Err(ToolExecutionError::new(
            "binary_file_not_supported",
            "binary file content is not supported by edit tool",
        ));
    }
    let file_content = String::from_utf8(file_bytes).map_err(|_| {
        ToolExecutionError::new(
            "binary_file_not_supported",
            "edit only supports utf-8 text files",
        )
    })?;
    let current_hash = hash_write_guard_text(file_content.as_str());
    let mtime_changed = snapshot.mtime_ms != current_mtime_ms;
    if let Some(expected_hash) = snapshot.content_hash {
        if expected_hash != current_hash {
            return Err(ToolExecutionError::new(
                "edit_stale_target",
                format!(
                    "edit target content changed since last read for {} (expected hash={}, actual hash={}, expected mtime_ms={}, actual mtime_ms={}, mtime_changed={})",
                    relative_path, expected_hash, current_hash, snapshot.mtime_ms, current_mtime_ms, mtime_changed
                ),
            ));
        }
    } else if mtime_changed {
        return Err(ToolExecutionError::new(
            "edit_stale_target",
            format!(
                "edit target changed since last read for {} (expected mtime_ms={}, actual mtime_ms={})",
                relative_path, snapshot.mtime_ms, current_mtime_ms
            ),
        ));
    }
    let (bom, raw_without_bom) = split_utf8_bom(&file_content);
    let original_line_ending = detect_line_ending(raw_without_bom);
    let base_content = normalize_to_lf(raw_without_bom);

    let mut matches: Vec<EditMatch> = Vec::new();
    for (edit_index, edit) in normalized_edits.iter().enumerate() {
        if edit.old_text.is_empty() {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("edit.edits[{edit_index}].old_text cannot be empty"),
            ));
        }
        let exact_ranges = find_all_exact_match_ranges(&base_content, &edit.old_text);
        let (start, end, used_fuzzy) = if exact_ranges.len() == 1 {
            let (start, end) = exact_ranges[0];
            (start, end, false)
        } else if exact_ranges.len() > 1 {
            return Err(ToolExecutionError::new(
                "edit_match_not_unique",
                format!(
                    "edit.edits[{edit_index}].old_text matched {} times in {}",
                    exact_ranges.len(),
                    relative_path
                ),
            ));
        } else {
            let fuzzy_ranges = find_all_safe_fuzzy_match_ranges(&base_content, &edit.old_text);
            if fuzzy_ranges.len() == 1 {
                let (start, end) = fuzzy_ranges[0];
                (start, end, true)
            } else if fuzzy_ranges.is_empty() {
                return Err(ToolExecutionError::new(
                    "edit_not_found",
                    format!("edit.edits[{edit_index}] not found in {relative_path}"),
                ));
            } else {
                return Err(ToolExecutionError::new(
                    "edit_match_not_unique",
                    format!(
                        "edit.edits[{edit_index}] fuzzy matched {} times in {}",
                        fuzzy_ranges.len(),
                        relative_path
                    ),
                ));
            }
        };
        matches.push(EditMatch {
            edit_index,
            start,
            end,
            start_line: line_number_for_offset(&base_content, start),
            used_fuzzy,
        });
    }

    matches.sort_by_key(|item| item.start);
    for index in 1..matches.len() {
        let previous = matches[index - 1];
        let current = matches[index];
        if previous.end > current.start {
            return Err(ToolExecutionError::new(
                "edit_overlap",
                format!(
                    "edit.edits[{}] overlaps edit.edits[{}] in {}",
                    previous.edit_index, current.edit_index, relative_path
                ),
            ));
        }
    }

    let mut updated_content = base_content.clone();
    for item in matches.iter().rev() {
        let replacement = normalized_edits[item.edit_index].new_text.as_str();
        updated_content.replace_range(item.start..item.end, replacement);
    }
    if updated_content == base_content {
        return Err(ToolExecutionError::new(
            "edit_no_changes",
            format!("edit produced no changes for {relative_path}"),
        ));
    }

    let restored = restore_line_endings(&updated_content, original_line_ending);
    let final_content = format!("{bom}{restored}");
    atomic_write_text_file(&target, final_content.as_bytes())?;
    clear_write_read_snapshot(context.session_key.as_str(), &target);

    let diff = build_edit_diff(&matches, &normalized_edits);
    let first_changed_line = matches.first().map(|item| item.start_line).unwrap_or(1);
    let fuzzy_fallback_used = matches.iter().any(|item| item.used_fuzzy);
    let payload = json!({
        "tool": TOOL_EDIT,
        "path": relative_path,
        "blocks_requested": normalized_edits.len(),
        "replacements": matches.len(),
        "fuzzy_fallback_used": fuzzy_fallback_used,
        "first_changed_line": first_changed_line,
        "diff": diff,
    });
    Ok(ToolCallOutput::from_payload(payload))
}
