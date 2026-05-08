const READ_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const READ_VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "avi", "mkv", "webm", "m4v"];
const READ_BLOCKED_DEVICE_PATHS: &[&str] = &[
    "/dev/random",
    "/dev/urandom",
    "/dev/zero",
    "/dev/full",
    "/dev/tty",
    "/dev/stdin",
    "/dev/stdout",
    "/dev/stderr",
    "/dev/console",
    "/dev/fd/0",
    "/dev/fd/1",
    "/dev/fd/2",
];

fn normalize_read_input_path(raw_path: &str) -> String {
    let without_at = raw_path.strip_prefix('@').unwrap_or(raw_path);
    without_at
        .chars()
        .map(|ch| match ch {
            '\u{00A0}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => ' ',
            _ => ch,
        })
        .collect::<String>()
}

fn is_blocked_device_path(path: &Path) -> bool {
    let value = path.to_string_lossy();
    if READ_BLOCKED_DEVICE_PATHS.iter().any(|item| *item == value) {
        return true;
    }
    if value.starts_with("/proc/")
        && (value.ends_with("/fd/0") || value.ends_with("/fd/1") || value.ends_with("/fd/2"))
    {
        return true;
    }
    false
}

fn try_macos_ampm_variant(file_path: &str) -> String {
    file_path
        .replace(" AM.", "\u{202F}AM.")
        .replace(" PM.", "\u{202F}PM.")
        .replace(" am.", "\u{202F}am.")
        .replace(" pm.", "\u{202F}pm.")
        .replace(" AM", "\u{202F}AM")
        .replace(" PM", "\u{202F}PM")
        .replace(" am", "\u{202F}am")
        .replace(" pm", "\u{202F}pm")
}

fn try_curly_quote_variant(file_path: &str) -> String {
    file_path.replace('\'', "\u{2019}")
}

fn try_nfd_variant(file_path: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    file_path.nfd().collect::<String>()
}

fn push_unique_candidate(candidates: &mut Vec<String>, candidate: String) {
    if candidate.is_empty() {
        return;
    }
    if candidates.iter().any(|item| item == &candidate) {
        return;
    }
    candidates.push(candidate);
}

fn build_read_path_candidates(normalized_path: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    push_unique_candidate(&mut candidates, normalized_path.to_string());
    push_unique_candidate(&mut candidates, try_macos_ampm_variant(normalized_path));
    let nfd_variant = try_nfd_variant(normalized_path);
    push_unique_candidate(&mut candidates, nfd_variant.clone());
    push_unique_candidate(&mut candidates, try_curly_quote_variant(normalized_path));
    push_unique_candidate(&mut candidates, try_curly_quote_variant(nfd_variant.as_str()));
    candidates
}

fn validate_resolved_read_target(target: PathBuf) -> Result<PathBuf, ToolExecutionError> {
    if !target.is_file() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("read target is not a file: {}", target.display()),
        )
        .with_data(json!({
            "diagnostic_kind": "read_path_invalid",
            "path": target.to_string_lossy().to_string(),
            "reason": "not_file",
            "recovery_hint": "choose an existing regular file path"
        })));
    }
    if is_blocked_device_path(&target) {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("read target is blocked device file: {}", target.display()),
        )
        .with_data(json!({
            "diagnostic_kind": "read_path_invalid",
            "path": target.to_string_lossy().to_string(),
            "reason": "blocked_device_file",
            "recovery_hint": "choose an existing regular file path inside the workspace"
        })));
    }
    let metadata = read_resolved_read_target_metadata(&target)?;
    if !metadata.is_file() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("read target is not a regular file: {}", target.display()),
        )
        .with_data(json!({
            "diagnostic_kind": "read_path_invalid",
            "path": target.to_string_lossy().to_string(),
            "reason": "not_regular_file",
            "recovery_hint": "choose an existing regular file path"
        })));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        let file_type = metadata.file_type();
        if file_type.is_block_device()
            || file_type.is_char_device()
            || file_type.is_fifo()
            || file_type.is_socket()
        {
            return Err(ToolExecutionError::new(
                "path_invalid",
                format!("read target is unsupported special file: {}", target.display()),
            )
            .with_data(json!({
                "diagnostic_kind": "read_path_invalid",
                "path": target.to_string_lossy().to_string(),
                "reason": "unsupported_special_file",
                "recovery_hint": "choose an existing regular file path"
            })));
        }
    }
    Ok(target)
}

fn read_resolved_read_target_metadata(target: &Path) -> Result<fs::Metadata, ToolExecutionError> {
    fs::metadata(target).map_err(|error| {
        file_io_error(
            format!("failed to read file metadata: {error}"),
            target,
            None,
            "read.path_guard",
            "read_target_metadata",
            "confirm the read target still exists and is a readable regular file, then retry",
        )
    })
}

fn resolve_read_target(
    context: &ToolContextResolved,
    raw_path: &str,
) -> Result<PathBuf, ToolExecutionError> {
    let normalized = normalize_read_input_path(raw_path);
    let candidates = build_read_path_candidates(normalized.as_str());
    let mut last_not_found: Option<ToolExecutionError> = None;
    for candidate in candidates {
        match ensure_within_workspace(&context.work_dir, candidate.as_str(), false) {
            Ok(target) => return validate_resolved_read_target(target),
            Err(error) if error.error_class == "path_not_found" => {
                last_not_found = Some(error);
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_not_found.unwrap_or_else(|| {
        ToolExecutionError::new("path_not_found", format!("path not found: {normalized}"))
            .with_data(json!({
                "diagnostic_kind": "path_not_found",
                "path": normalized,
                "reason": "target_does_not_exist",
                "recovery_hint": "use glob to locate the path before retrying read"
            }))
    }))
}

fn classify_read_kind(target: &Path) -> ReadKind {
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "ipynb" => ReadKind::Notebook,
        "pdf" => ReadKind::Pdf,
        value if READ_IMAGE_EXTENSIONS.iter().any(|item| *item == value) => ReadKind::Image,
        value if READ_VIDEO_EXTENSIONS.iter().any(|item| *item == value) => ReadKind::Video,
        _ => ReadKind::Text,
    }
}

fn has_binary_extension(extension: &str) -> bool {
    matches!(
        extension,
        "7z"
            | "a"
            | "bin"
            | "class"
            | "dat"
            | "db"
            | "dmg"
            | "doc"
            | "docx"
            | "dll"
            | "dylib"
            | "exe"
            | "gz"
            | "ico"
            | "jar"
            | "lock"
            | "mp3"
            | "mp4"
            | "o"
            | "obj"
            | "otf"
            | "p12"
            | "pfx"
            | "png"
            | "so"
            | "tar"
            | "ttf"
            | "wasm"
            | "webm"
            | "woff"
            | "woff2"
            | "xls"
            | "xlsx"
            | "zip"
    )
}

fn file_has_nul_byte(target: &Path) -> Result<bool, ToolExecutionError> {
    let mut file = fs::File::open(target).map_err(|error| {
        file_io_error(
            format!("failed to read file: {error}"),
            target,
            None,
            "file_text_guard",
            "open_for_binary_scan",
            "verify the file still exists and is readable, then retry",
        )
    })?;
    let mut buffer = [0_u8; 8192];
    let read_bytes = file.read(&mut buffer).map_err(|error| {
        file_io_error(
            format!("failed to read file: {error}"),
            target,
            None,
            "file_text_guard",
            "read_for_binary_scan",
            "verify the file is readable and stable, then retry",
        )
    })?;
    Ok(buffer[..read_bytes].contains(&0))
}

fn ensure_text_read_allowed(
    target: &Path,
    relative_path: Option<&str>,
    source: &str,
) -> Result<(), ToolExecutionError> {
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if has_binary_extension(extension.as_str()) {
        return Err(binary_file_not_supported_error(
            target,
            relative_path,
            "binary_extension",
            source,
            Some(extension.as_str()),
        ));
    }
    if file_has_nul_byte(target)? {
        return Err(binary_file_not_supported_error(
            target,
            relative_path,
            "nul_byte_in_existing_file",
            source,
            None,
        ));
    }
    Ok(())
}

fn read_file_mtime_ms(target: &Path) -> Result<u128, ToolExecutionError> {
    let metadata = fs::metadata(target).map_err(|error| {
        file_io_error(
            format!("failed to read file metadata: {error}"),
            target,
            None,
            "file_snapshot_guard",
            "read_metadata_for_mtime",
            "confirm the target still exists and is readable, then retry",
        )
    })?;
    let modified = metadata.modified().map_err(|error| {
        file_io_error(
            format!("failed to read file mtime: {error}"),
            target,
            None,
            "file_snapshot_guard",
            "read_modified_time",
            "confirm the filesystem exposes modification time for this regular file",
        )
    })?;
    let duration = modified.duration_since(UNIX_EPOCH).map_err(|error| {
        file_io_error(
            format!("failed to normalize file mtime: {error}"),
            target,
            None,
            "file_snapshot_guard",
            "normalize_modified_time",
            "touch or rewrite the file to restore a valid modification timestamp, then reread",
        )
    })?;
    Ok(duration.as_millis())
}
