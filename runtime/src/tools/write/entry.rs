fn count_visible_lines(content: &str) -> usize {
    let parts_count = content.split('\n').count();
    if content.ends_with('\n') {
        parts_count.saturating_sub(1)
    } else {
        parts_count
    }
}

fn build_write_diff(old_content: Option<&str>, new_content: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let old_count = old_content.map(line_count_for_diff).unwrap_or(0);
    let new_count = line_count_for_diff(new_content);
    lines.push(format!("@@ -1,{old_count} +1,{new_count} @@"));
    if let Some(old) = old_content {
        for line in lines_for_diff(old) {
            lines.push(format!("-{line}"));
        }
    }
    for line in lines_for_diff(new_content) {
        lines.push(format!("+{line}"));
    }
    lines.join("\n")
}

fn write_binary_file_error(
    target: &Path,
    relative_path: &str,
    reason: &str,
) -> ToolExecutionError {
    binary_file_not_supported_error(
        target,
        Some(relative_path),
        reason,
        TOOL_WRITE,
        None,
    )
}

fn ensure_write_text_update_allowed(
    target: &Path,
    relative_path: &str,
) -> Result<(), ToolExecutionError> {
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if has_binary_extension(extension.as_str()) {
        return Err(binary_file_not_supported_error(
            target,
            Some(relative_path),
            "binary_extension",
            TOOL_WRITE,
            Some(extension.as_str()),
        ));
    }
    if file_has_nul_byte(target)? {
        return Err(write_binary_file_error(
            target,
            relative_path,
            "nul_byte_in_existing_file",
        ));
    }
    Ok(())
}

fn read_write_target_metadata(
    target: &Path,
    relative_path: &str,
) -> Result<fs::Metadata, ToolExecutionError> {
    fs::metadata(target).map_err(|error| {
        file_io_error(
            format!("failed to read file metadata: {error}"),
            target,
            Some(relative_path),
            TOOL_WRITE,
            "read_target_metadata",
            "confirm the target still exists and is readable, then reread before retrying write",
        )
    })
}

fn read_write_target_content(
    target: &Path,
    relative_path: &str,
) -> Result<String, ToolExecutionError> {
    let current_bytes = fs::read(target).map_err(|error| {
        file_io_error(
            format!("failed to read file: {error}"),
            target,
            Some(relative_path),
            TOOL_WRITE,
            "read_target_content",
            "confirm the target still exists and is readable, then reread before retrying write",
        )
    })?;
    if current_bytes.contains(&0_u8) {
        return Err(write_binary_file_error(
            target,
            relative_path,
            "nul_byte_in_existing_file",
        ));
    }
    String::from_utf8(current_bytes).map_err(|_| {
        write_binary_file_error(target, relative_path, "non_utf8_existing_file")
    })
}

fn run_write(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let request = parse_write_request(args)?;
    let target = ensure_within_workspace(&context.work_dir, &request.path, true)?;
    let relative_path = relative_to_work_dir(&context.work_dir, &target);
    if request.content.as_bytes().contains(&0_u8) {
        return Err(ToolExecutionError::new(
            "binary_file_not_supported",
            "write only supports utf-8 text content without NUL bytes",
        )
        .with_data(json!({
            "diagnostic_kind": "binary_file_not_supported",
            "path": relative_path,
            "reason": "nul_byte_in_content",
            "recovery_hint": "use a text-safe representation or a dedicated binary/file-asset path"
        })));
    }
    let text_format = inspect_text_content_format(request.content.as_str());

    let mut created_parent_dirs = false;

    let file_lock = acquire_file_mutation_lock(&target)?;
    let _file_guard = file_lock
        .lock()
        .map_err(|_| {
            runtime_state_unavailable_error(
                "failed to acquire write file lock",
                "write_file_lock",
                Some(context.work_dir.to_string_lossy().as_ref()),
            )
        })?;

    let existed_before = target.exists();
    let mut original_content_for_diff: Option<String> = None;
    let (operation, preserved_permissions) = if existed_before {
        let metadata = read_write_target_metadata(&target, relative_path.as_str())?;
        if !metadata.is_file() {
            return Err(ToolExecutionError::new(
                "path_invalid",
                format!("write target is not a regular file: {}", target.display()),
            )
            .with_data(json!({
                "diagnostic_kind": "write_path_invalid",
                "path": relative_path,
                "target_path": target.to_string_lossy().to_string(),
                "reason": "not_regular_file",
                "recovery_hint": "choose an existing regular file path or a safe missing leaf"
            })));
        }
        ensure_write_text_update_allowed(&target, relative_path.as_str())?;
        let current_mtime_ms = read_file_mtime_ms(&target)?;
        let snapshot = lookup_write_read_snapshot(context.session_key.as_str(), &target).ok_or_else(|| {
            ToolExecutionError::new(
                "write_read_required",
                format!("write requires a prior full read in the same session: {relative_path}"),
            ).with_data(json!({
                "diagnostic_kind": "write_read_required",
                "path": relative_path,
                "required_read_scope": "full",
                "recovery_hint": "read the full target file before retrying write"
            }))
        })?;
        if !snapshot.full_view {
            return Err(ToolExecutionError::new(
                "write_partial_read_not_allowed",
                format!("write requires a full read before updating existing file: {relative_path}"),
            )
            .with_data(json!({
                "diagnostic_kind": "write_partial_read_not_allowed",
                "path": relative_path,
                "snapshot_full_view": snapshot.full_view,
                "required_read_scope": "full",
                "snapshot_mtime_ms": snapshot.mtime_ms.to_string(),
                "recovery_hint": "read the full target file before retrying write"
            })));
        }
        let current_content = read_write_target_content(&target, relative_path.as_str())?;
        let current_hash = hash_write_guard_text(current_content.as_str());
        let snapshot_hash = snapshot.content_hash.ok_or_else(|| {
            ToolExecutionError::new(
                "write_stale_target",
                format!("write read snapshot missing content hash for {relative_path}"),
            ).with_data(json!({
                "diagnostic_kind": "write_stale_target",
                "path": relative_path,
                "reason": "snapshot_content_hash_missing",
                "snapshot_mtime_ms": snapshot.mtime_ms.to_string(),
                "current_mtime_ms": current_mtime_ms.to_string(),
                "recovery_hint": "reread target then rebuild the write from current content"
            }))
        })?;
        let mtime_changed = snapshot.mtime_ms != current_mtime_ms;
        if snapshot_hash != current_hash {
            return Err(ToolExecutionError::new(
                "write_stale_target",
                format!(
                    "write target content changed since last read for {} (expected hash={}, actual hash={}, expected mtime_ms={}, actual mtime_ms={}, mtime_changed={})",
                    relative_path, snapshot_hash, current_hash, snapshot.mtime_ms, current_mtime_ms, mtime_changed
                ),
            )
            .with_data(json!({
                "diagnostic_kind": "write_stale_target",
                "path": relative_path,
                "expected_hash": snapshot_hash,
                "actual_hash": current_hash,
                "expected_mtime_ms": snapshot.mtime_ms.to_string(),
                "actual_mtime_ms": current_mtime_ms.to_string(),
                "mtime_changed": mtime_changed,
                "recovery_hint": "reread target then rebuild the write from current content"
            })));
        }
        if current_content == request.content {
            return Err(ToolExecutionError::new(
                "write_no_changes",
                format!("write produced no changes for {relative_path}"),
            )
            .with_data(json!({
                "diagnostic_kind": "write_no_changes",
                "path": relative_path,
                "recovery_hint": "stop retrying or change content intentionally"
            })));
        }
        original_content_for_diff = Some(current_content);
        ("update", Some(metadata.permissions()))
    } else {
        if let Some(parent) = target.parent() {
            created_parent_dirs = !parent.exists();
            fs::create_dir_all(parent).map_err(|error| {
                file_io_error(
                    format!("failed to create parent directories: {error}"),
                    &target,
                    Some(relative_path.as_str()),
                    TOOL_WRITE,
                    "create_parent_dirs",
                    "check parent directory permissions and choose a writable workspace path",
                )
            })?;
        }
        ("create", None)
    };

    atomic_write_text_file_v2(&target, request.content.as_bytes(), preserved_permissions)?;
    clear_write_read_snapshot(context.session_key.as_str(), &target);

    let payload = json!({
        "tool": TOOL_WRITE,
        "path": relative_path,
        "operation": operation,
        "bytes_written": request.content.as_bytes().len(),
        "line_count": count_visible_lines(request.content.as_str()),
        "line_ending": text_format.line_ending,
        "bom_written": text_format.bom_detected,
        "created_parent_dirs": created_parent_dirs,
        "existed_before": existed_before,
        "diff": build_write_diff(
            original_content_for_diff.as_deref(),
            request.content.as_str()
        ),
    });
    Ok(ToolCallOutput::from_payload(payload))
}
