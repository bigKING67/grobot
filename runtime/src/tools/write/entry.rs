fn run_write(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let request = parse_write_request(args)?;
    let target = ensure_within_workspace(&context.work_dir, &request.path, true)?;
    let relative_path = relative_to_work_dir(&context.work_dir, &target);
    let existed_before = target.exists();

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to create parent directories: {error}"),
            )
        })?;
    }

    let file_lock = acquire_file_mutation_lock(&target)?;
    let _file_guard = file_lock
        .lock()
        .map_err(|_| ToolExecutionError::new("runtime_state_unavailable", "failed to acquire write file lock"))?;

    let (operation, preserved_permissions) = if existed_before {
        let metadata = fs::metadata(&target).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to read file metadata: {error}"),
            )
        })?;
        if !metadata.is_file() {
            return Err(ToolExecutionError::new(
                "path_invalid",
                format!("write target is not a regular file: {}", target.display()),
            ));
        }
        ensure_text_read_allowed(&target)?;
        let current_mtime_ms = read_file_mtime_ms(&target)?;
        let snapshot = lookup_write_read_snapshot(context.session_key.as_str(), &target).ok_or_else(|| {
            ToolExecutionError::new(
                "write_read_required",
                format!("write requires a prior full read in the same session: {relative_path}"),
            )
        })?;
        if !snapshot.full_view {
            return Err(ToolExecutionError::new(
                "write_partial_read_not_allowed",
                format!("write requires a full read before updating existing file: {relative_path}"),
            ));
        }
        if snapshot.mtime_ms != current_mtime_ms {
            return Err(ToolExecutionError::new(
                "write_stale_target",
                format!(
                    "write target changed since last read for {} (expected mtime_ms={}, actual mtime_ms={})",
                    relative_path, snapshot.mtime_ms, current_mtime_ms
                ),
            ));
        }
        let current_bytes = fs::read(&target).map_err(|error| {
            ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}"))
        })?;
        if current_bytes.contains(&0_u8) {
            return Err(ToolExecutionError::new(
                "binary_file_not_supported",
                "binary file content is not supported by write tool",
            ));
        }
        let current_content = String::from_utf8(current_bytes).map_err(|_| {
            ToolExecutionError::new(
                "binary_file_not_supported",
                "write only supports utf-8 text files",
            )
        })?;
        if current_content == request.content {
            return Err(ToolExecutionError::new(
                "write_no_changes",
                format!("write produced no changes for {relative_path}"),
            ));
        }
        ("update", Some(metadata.permissions()))
    } else {
        ("create", None)
    };

    atomic_write_text_file_v2(&target, request.content.as_bytes(), preserved_permissions)?;
    clear_write_read_snapshot(context.session_key.as_str(), &target);
    clear_edit_read_snapshot(context.session_key.as_str(), &target);

    let payload = json!({
        "tool": TOOL_WRITE,
        "path": relative_path,
        "operation": operation,
        "bytes_written": request.content.as_bytes().len(),
    });
    Ok(ToolCallOutput::from_payload(payload))
}
