fn atomic_write_text_file(target: &Path, content: &[u8]) -> Result<(), ToolExecutionError> {
    let parent = target.parent().ok_or_else(|| {
        ToolExecutionError::new("tool_execution_failed", "edit target has invalid parent directory")
    })?;
    let permissions = fs::metadata(target).map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to read file metadata: {error}"),
        )
    })?;
    let filename = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("edit-target");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_path = parent.join(format!(".{filename}.grobot-edit-{nonce}.tmp"));
    let mut temp_file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to create temporary edit file: {error}"),
            )
        })?;
    temp_file.write_all(content).map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to write temporary edit file: {error}"),
        )
    })?;
    temp_file.flush().map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to flush temporary edit file: {error}"),
        )
    })?;
    fs::set_permissions(&temp_path, permissions.permissions()).map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to copy file permissions to temporary edit file: {error}"),
        )
    })?;
    fs::rename(&temp_path, target).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to replace edited file atomically: {error}"),
        )
    })?;
    Ok(())
}
