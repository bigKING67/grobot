fn atomic_write_text_file_v2(
    target: &Path,
    content: &[u8],
    preserved_permissions: Option<std::fs::Permissions>,
) -> Result<(), ToolExecutionError> {
    let parent = target.parent().ok_or_else(|| {
        file_io_error(
            "write target has invalid parent directory",
            target,
            None,
            TOOL_WRITE,
            "resolve_parent",
            "choose a valid file path with a parent directory inside the workspace",
        )
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
            file_io_error(
                format!("failed to create temporary write file: {error}"),
                target,
                None,
                TOOL_WRITE,
                "create_temp_file",
                "check directory permissions and retry after removing stale grobot temp files if needed",
            )
        })?;
    temp_file.write_all(content).map_err(|error| {
        file_io_error(
            format!("failed to write temporary write file: {error}"),
            target,
            None,
            TOOL_WRITE,
            "write_temp_file",
            "check available disk space and directory permissions, then retry",
        )
    })?;
    temp_file.flush().map_err(|error| {
        file_io_error(
            format!("failed to flush temporary write file: {error}"),
            target,
            None,
            TOOL_WRITE,
            "flush_temp_file",
            "check filesystem health and retry after confirming the target directory is writable",
        )
    })?;
    if let Some(permissions) = preserved_permissions {
        fs::set_permissions(&temp_path, permissions).map_err(|error| {
            file_io_error(
                format!("failed to copy file permissions to temporary write file: {error}"),
                target,
                None,
                TOOL_WRITE,
                "copy_permissions",
                "check file ownership and permissions, then retry",
            )
        })?;
    }
    fs::rename(&temp_path, target).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        file_io_error(
            format!("failed to replace written file atomically: {error}"),
            target,
            None,
            TOOL_WRITE,
            "atomic_replace",
            "check target permissions and filesystem constraints, then retry",
        )
    })?;
    Ok(())
}
