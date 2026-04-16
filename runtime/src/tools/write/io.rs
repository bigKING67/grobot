fn atomic_write_text_file_v2(
    target: &Path,
    content: &[u8],
    preserved_permissions: Option<std::fs::Permissions>,
) -> Result<(), ToolExecutionError> {
    let parent = target.parent().ok_or_else(|| {
        ToolExecutionError::new("tool_execution_failed", "write target has invalid parent directory")
    })?;
    let filename = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("write-target");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_path = parent.join(format!(".{filename}.grobot-write-{nonce}.tmp"));
    let mut temp_file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to create temporary write file: {error}"),
            )
        })?;
    temp_file.write_all(content).map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to write temporary write file: {error}"),
        )
    })?;
    temp_file.flush().map_err(|error| {
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to flush temporary write file: {error}"),
        )
    })?;
    if let Some(permissions) = preserved_permissions {
        fs::set_permissions(&temp_path, permissions).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to copy file permissions to temporary write file: {error}"),
            )
        })?;
    }
    fs::rename(&temp_path, target).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        ToolExecutionError::new(
            "tool_execution_failed",
            format!("failed to replace written file atomically: {error}"),
        )
    })?;
    Ok(())
}
