fn read_edit_target_metadata(
    target: &Path,
    relative_path: &str,
) -> Result<fs::Metadata, ToolExecutionError> {
    fs::metadata(target).map_err(|error| {
        file_io_error(
            format!("failed to read file metadata: {error}"),
            target,
            Some(relative_path),
            TOOL_EDIT,
            "read_target_metadata",
            "confirm the target still exists and is readable, then reread before retrying edit",
        )
    })
}

fn read_edit_target_content(
    target: &Path,
    relative_path: &str,
) -> Result<String, ToolExecutionError> {
    let file_bytes = fs::read(target).map_err(|error| {
        file_io_error(
            format!("failed to read file: {error}"),
            target,
            Some(relative_path),
            TOOL_EDIT,
            "read_target_content",
            "confirm the target still exists and is readable, then reread before retrying edit",
        )
    })?;
    if file_bytes.contains(&0_u8) {
        return Err(binary_file_not_supported_error(
            target,
            Some(relative_path),
            "nul_byte_in_existing_file",
            TOOL_EDIT,
            None,
        ));
    }
    String::from_utf8(file_bytes).map_err(|_| {
        binary_file_not_supported_error(
            target,
            Some(relative_path),
            "non_utf8_existing_file",
            TOOL_EDIT,
            None,
        )
    })
}

fn run_edit(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = parse_required_string_arg(args, TOOL_EDIT, "path", "edit.path is required")?;
    let edits = parse_edit_operations(args)?;
    let normalized_edits = normalize_edit_operations(&edits);

    let target = resolve_read_target(context, &path)?;
    let relative_path = relative_to_work_dir(&context.work_dir, &target);
    ensure_text_read_allowed(&target, Some(relative_path.as_str()), TOOL_EDIT)?;
    let file_lock = acquire_file_mutation_lock(&target)?;
    let _file_guard = file_lock
        .lock()
        .map_err(|_| {
            runtime_state_unavailable_error(
                "failed to acquire edit file lock",
                "edit_file_lock",
                Some(context.work_dir.to_string_lossy().as_ref()),
            )
        })?;

    let metadata = read_edit_target_metadata(&target, relative_path.as_str())?;
    if metadata.len() > EDIT_MAX_FILE_BYTES {
        return Err(ToolExecutionError::new(
            "edit_file_too_large",
            format!(
                "edit target exceeds max size ({} > {} bytes)",
                metadata.len(),
                EDIT_MAX_FILE_BYTES
            ),
        )
        .with_data(json!({
            "diagnostic_kind": "edit_file_too_large",
            "path": relative_path,
            "file_size_bytes": metadata.len(),
            "max_file_size_bytes": EDIT_MAX_FILE_BYTES,
            "recovery_hint": "read a smaller targeted range or use a purpose-built large-file rewrite workflow"
        })));
    }
    let current_mtime_ms = read_file_mtime_ms(&target)?;
    let snapshot = lookup_edit_read_snapshot(context.session_key.as_str(), &target).ok_or_else(|| {
        ToolExecutionError::new(
            "edit_read_required",
            format!("edit requires a prior read in the same session: {relative_path}"),
        )
        .with_data(json!({
            "diagnostic_kind": "edit_read_required",
            "path": relative_path,
            "required_read_scope": "full_or_visible_range",
            "recovery_hint": "read the target file or exact target range before retrying edit"
        }))
    })?;

    let file_content = read_edit_target_content(&target, relative_path.as_str())?;
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
            )
            .with_data(json!({
                "diagnostic_kind": "edit_stale_target",
                "path": relative_path,
                "reason": "content_hash_mismatch",
                "expected_hash": expected_hash,
                "actual_hash": current_hash,
                "expected_mtime_ms": snapshot.mtime_ms.to_string(),
                "actual_mtime_ms": current_mtime_ms.to_string(),
                "mtime_changed": mtime_changed,
                "snapshot_full_view": snapshot.full_view,
                "recovery_hint": "reread target then rebuild the edit from current content"
            })));
        }
    } else if mtime_changed && snapshot.visible_text.is_none() {
        return Err(ToolExecutionError::new(
            "edit_stale_target",
            format!(
                "edit target changed since last read for {} (expected mtime_ms={}, actual mtime_ms={})",
                relative_path, snapshot.mtime_ms, current_mtime_ms
            ),
        )
        .with_data(json!({
            "diagnostic_kind": "edit_stale_target",
            "path": relative_path,
            "reason": "mtime_changed_without_visible_snapshot",
            "expected_mtime_ms": snapshot.mtime_ms.to_string(),
            "actual_mtime_ms": current_mtime_ms.to_string(),
            "snapshot_full_view": snapshot.full_view,
            "recovery_hint": "reread target then retry the edit"
        })));
    }
    let (bom, raw_without_bom) = split_utf8_bom(&file_content);
    let text_format = inspect_text_content_format(raw_without_bom);
    if text_format.line_ending == "mixed" {
        return Err(
            ToolExecutionError::new(
                "edit_mixed_line_endings_not_supported",
                format!(
                    "edit cannot safely preserve mixed line endings for {relative_path}; use write with exact full file content or normalize line endings first"
                ),
            )
            .with_data(json!({
                "path": relative_path,
                "line_ending": "mixed",
                "recovery_hint": "use write with exact full file content or normalize line endings first"
            })),
        );
    }
    let original_line_ending = detect_line_ending(raw_without_bom);
    let original_line_ending_label = line_ending_label(raw_without_bom, original_line_ending);
    let base_content = normalize_to_lf(raw_without_bom);
    if !snapshot.full_view {
        let normalized_visible_text = snapshot
            .visible_text
            .as_deref()
            .map(normalize_visible_text_for_file_guard)
            .ok_or_else(|| {
                ToolExecutionError::new(
                    "edit_read_scope_insufficient",
                    format!(
                        "edit requires a bounded visible read snapshot for partial-read edits: {relative_path}"
                    ),
                )
                .with_data(json!({
                    "diagnostic_kind": "edit_read_scope_insufficient",
                    "path": relative_path,
                    "snapshot_full_view": snapshot.full_view,
                    "snapshot_line_start": snapshot.line_start,
                    "snapshot_line_end": snapshot.line_end,
                    "reason": "visible_text_not_recorded",
                    "recovery_hint": "reread the exact target range or read the full target before retrying edit"
                }))
            })?;
        let current_visible_text = visible_text_for_file_snapshot_range(
            &base_content,
            snapshot.line_start,
            snapshot.line_end,
        );
        let current_visible_hash =
            hash_visible_text_for_file_guard(current_visible_text.as_str());
        if current_visible_hash != snapshot.visible_text_hash {
            return Err(ToolExecutionError::new(
                "edit_stale_target",
                format!("edit partial-read visible text changed for {relative_path}"),
            )
            .with_data(json!({
                "diagnostic_kind": "edit_stale_target",
                "path": relative_path,
                "reason": "partial_visible_text_hash_mismatch",
                "expected_visible_text_hash": snapshot.visible_text_hash,
                "actual_visible_text_hash": current_visible_hash,
                "snapshot_mtime_ms": snapshot.mtime_ms.to_string(),
                "current_mtime_ms": current_mtime_ms.to_string(),
                "recovery_hint": "reread target then retry the edit"
            })));
        }
        if current_visible_text != normalized_visible_text {
            return Err(ToolExecutionError::new(
                "edit_stale_target",
                format!("edit partial-read visible text no longer matches prior read for {relative_path}"),
            )
            .with_data(json!({
                "diagnostic_kind": "edit_stale_target",
                "path": relative_path,
                "reason": "partial_visible_text_mismatch",
                "snapshot_mtime_ms": snapshot.mtime_ms.to_string(),
                "current_mtime_ms": current_mtime_ms.to_string(),
                "recovery_hint": "reread target then retry the edit"
            })));
        }
    }

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
            let detail = build_edit_match_candidates_detail(&base_content, &exact_ranges);
            return Err(
                ToolExecutionError::new(
                    "edit_match_not_unique",
                    append_edit_diagnostics(
                        format!(
                            "edit.edits[{edit_index}].old_text matched {} times in {}",
                            exact_ranges.len(),
                            relative_path
                        ),
                        detail.message,
                    ),
                )
                .with_data(json!({
                    "path": relative_path,
                    "edit_index": edit_index,
                    "match_count": exact_ranges.len(),
                    "match_mode": "exact",
                    "diagnostics": detail.data,
                })),
            );
        } else {
            let fuzzy_ranges = find_all_safe_fuzzy_match_ranges(&base_content, &edit.old_text);
            if fuzzy_ranges.len() == 1 {
                let (start, end) = fuzzy_ranges[0];
                (start, end, true)
            } else if fuzzy_ranges.is_empty() {
                let detail = build_edit_not_found_detail(&base_content, &edit.old_text);
                return Err(
                    ToolExecutionError::new(
                        "edit_not_found",
                        append_edit_diagnostics(
                            format!("edit.edits[{edit_index}] not found in {relative_path}"),
                            detail.message,
                        ),
                    )
                    .with_data(json!({
                        "path": relative_path,
                        "edit_index": edit_index,
                        "diagnostics": detail.data,
                    })),
                );
            } else {
                let detail = build_edit_match_candidates_detail(&base_content, &fuzzy_ranges);
                return Err(
                    ToolExecutionError::new(
                        "edit_match_not_unique",
                        append_edit_diagnostics(
                            format!(
                                "edit.edits[{edit_index}] fuzzy matched {} times in {}",
                                fuzzy_ranges.len(),
                                relative_path
                            ),
                            detail.message,
                        ),
                    )
                    .with_data(json!({
                        "path": relative_path,
                        "edit_index": edit_index,
                        "match_count": fuzzy_ranges.len(),
                        "match_mode": "fuzzy",
                        "diagnostics": detail.data,
                    })),
                );
            }
        };
        let start_line = line_number_for_offset(&base_content, start);
        let end_line = end_line_number_for_range(&base_content, start, end);
        if !snapshot.full_view && (start_line < snapshot.line_start || end_line > snapshot.line_end)
        {
            return Err(ToolExecutionError::new(
                "edit_read_scope_insufficient",
                format!(
                    "edit.edits[{edit_index}] targets lines {start_line}-{end_line}, outside prior read scope {}-{} for {relative_path}",
                    snapshot.line_start, snapshot.line_end
                ),
            )
            .with_data(json!({
                "diagnostic_kind": "edit_read_scope_insufficient",
                "path": relative_path,
                "edit_index": edit_index,
                "match_start_line": start_line,
                "match_end_line": end_line,
                "snapshot_full_view": snapshot.full_view,
                "snapshot_line_start": snapshot.line_start,
                "snapshot_line_end": snapshot.line_end,
                "snapshot_line_ending": snapshot.line_ending,
                "snapshot_bom_detected": snapshot.bom_detected,
                "recovery_hint": "read the exact lines to be edited or read the full file before retrying edit"
            })));
        }
        let actual_old_text = base_content[start..end].to_string();
        let actual_new_text = preserve_quote_style(
            edit.old_text.as_str(),
            actual_old_text.as_str(),
            edit.new_text.as_str(),
        );
        matches.push(EditMatch {
            edit_index,
            start,
            end,
            start_line,
            used_fuzzy,
            actual_old_text,
            actual_new_text,
        });
    }

    matches.sort_by_key(|item| item.start);
    for index in 1..matches.len() {
        let previous = &matches[index - 1];
        let current = &matches[index];
        if previous.end > current.start {
            return Err(ToolExecutionError::new(
                "edit_overlap",
                format!(
                    "edit.edits[{}] overlaps edit.edits[{}] in {}",
                    previous.edit_index, current.edit_index, relative_path
                ),
            )
            .with_data(json!({
                "diagnostic_kind": "edit_overlap",
                "path": relative_path,
                "previous_edit_index": previous.edit_index,
                "current_edit_index": current.edit_index,
                "previous_start_line": previous.start_line,
                "current_start_line": current.start_line,
                "recovery_hint": "combine overlapping changes into one replacement block or split them into non-overlapping ranges"
            })));
        }
    }

    let mut updated_content = base_content.clone();
    for item in matches.iter().rev() {
        updated_content.replace_range(item.start..item.end, item.actual_new_text.as_str());
    }
    if updated_content == base_content {
        return Err(ToolExecutionError::new(
            "edit_no_changes",
            format!("edit produced no changes for {relative_path}"),
        )
        .with_data(json!({
            "diagnostic_kind": "edit_no_changes",
            "path": relative_path,
            "blocks_requested": normalized_edits.len(),
            "replacements": matches.len(),
            "recovery_hint": "stop retrying or change new_text intentionally"
        })));
    }

    let restored = restore_line_endings(&updated_content, original_line_ending);
    let final_content = format!("{bom}{restored}");
    atomic_write_text_file(&target, final_content.as_bytes())?;
    clear_write_read_snapshot(context.session_key.as_str(), &target);

    let diff = build_edit_diff(&matches);
    let first_changed_line = matches.first().map(|item| item.start_line).unwrap_or(1);
    let fuzzy_fallback_used = matches.iter().any(|item| item.used_fuzzy);
    let payload = json!({
        "tool": TOOL_EDIT,
        "path": relative_path,
        "blocks_requested": normalized_edits.len(),
        "replacements": matches.len(),
        "fuzzy_fallback_used": fuzzy_fallback_used,
        "first_changed_line": first_changed_line,
        "line_ending": original_line_ending_label,
        "bom_preserved": !bom.is_empty(),
        "diff": diff,
    });
    Ok(ToolCallOutput::from_payload(payload))
}
