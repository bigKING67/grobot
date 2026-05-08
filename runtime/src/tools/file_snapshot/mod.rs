const FILE_READ_SNAPSHOT_MAX_ENTRIES: usize = 1024;
const FILE_READ_SNAPSHOT_VISIBLE_TEXT_MAX_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
struct FileReadSnapshot {
    mtime_ms: u128,
    full_view: bool,
    content_hash: Option<u64>,
    line_start: usize,
    line_end: usize,
    visible_text_hash: u64,
    visible_text: Option<String>,
    line_ending: &'static str,
    bom_detected: bool,
}

#[derive(Debug, Default)]
struct FileReadSnapshotStore {
    entries: HashMap<String, FileReadSnapshot>,
    order: VecDeque<String>,
}

fn hash_text_for_file_guard(content: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    hasher.finish()
}

fn normalize_visible_text_for_file_guard(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn hash_visible_text_for_file_guard(content: &str) -> u64 {
    hash_text_for_file_guard(content)
}

fn visible_text_for_file_snapshot_range(content: &str, line_start: usize, line_end: usize) -> String {
    if line_start == 0 || line_end < line_start {
        return String::new();
    }
    content
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let line_number = index.saturating_add(1);
            if line_number >= line_start && line_number <= line_end {
                Some(line)
            } else {
                None
            }
        })
        .collect::<Vec<&str>>()
        .join("\n")
}

fn bounded_file_snapshot_visible_text(content: &str) -> Option<String> {
    if content.as_bytes().len() <= FILE_READ_SNAPSHOT_VISIBLE_TEXT_MAX_BYTES {
        Some(content.to_string())
    } else {
        None
    }
}

fn binary_file_not_supported_error(
    target: &Path,
    relative_path: Option<&str>,
    reason: &str,
    source: &str,
    extension: Option<&str>,
) -> ToolExecutionError {
    let mut data = json!({
        "diagnostic_kind": "binary_file_not_supported",
        "path": relative_path
            .map(str::to_string)
            .unwrap_or_else(|| target.to_string_lossy().to_string()),
        "reason": reason,
        "source": source,
        "recovery_hint": "use a text-safe representation or a dedicated binary/file-asset path"
    });
    if let Some(extension) = extension {
        if let Some(data_object) = data.as_object_mut() {
            data_object.insert("extension".to_string(), json!(extension));
        }
    }
    ToolExecutionError::new(
        "binary_file_not_supported",
        format!("{source} only supports utf-8 text files without NUL bytes"),
    )
    .with_data(data)
}

fn file_io_error(
    message: impl Into<String>,
    target: &Path,
    relative_path: Option<&str>,
    source: &str,
    stage: &str,
    recovery_hint: &str,
) -> ToolExecutionError {
    ToolExecutionError::new("tool_execution_failed", message).with_data(json!({
        "diagnostic_kind": "file_io_error",
        "path": relative_path
            .map(str::to_string)
            .unwrap_or_else(|| target.to_string_lossy().to_string()),
        "source": source,
        "stage": stage,
        "recovery_hint": recovery_hint
    }))
}

fn compute_file_text_hash(target: &Path) -> Result<u64, ToolExecutionError> {
    let file_bytes = fs::read(target).map_err(|error| {
        file_io_error(
            format!("failed to read file: {error}"),
            target,
            None,
            "file_snapshot_guard",
            "read_for_hash",
            "reread the target after confirming the file still exists and is readable",
        )
    })?;
    if file_bytes.contains(&0_u8) {
        return Err(binary_file_not_supported_error(
            target,
            None,
            "nul_byte_in_existing_file",
            "file_snapshot_guard",
            None,
        ));
    }
    let file_content = String::from_utf8(file_bytes).map_err(|_| {
        binary_file_not_supported_error(
            target,
            None,
            "non_utf8_existing_file",
            "file_snapshot_guard",
            None,
        )
    })?;
    Ok(hash_text_for_file_guard(file_content.as_str()))
}

fn file_read_snapshot_store() -> &'static Mutex<FileReadSnapshotStore> {
    static STORE: OnceLock<Mutex<FileReadSnapshotStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(FileReadSnapshotStore::default()))
}

fn build_file_read_snapshot_key(session_key: &str, target: &Path) -> String {
    format!("{session_key}::{}", target.to_string_lossy())
}

fn record_file_read_snapshot(
    session_key: &str,
    target: &Path,
    mtime_ms: u128,
    full_view: bool,
    content_hash: Option<u64>,
    line_start: usize,
    line_end: usize,
    visible_text_hash: u64,
    visible_text: Option<String>,
    line_ending: &'static str,
    bom_detected: bool,
) {
    let Ok(mut store) = file_read_snapshot_store().lock() else {
        return;
    };
    let key = build_file_read_snapshot_key(session_key, target);
    if store.entries.contains_key(&key) {
        store.order.retain(|item| item != &key);
    }
    store.entries.insert(
        key.clone(),
        FileReadSnapshot {
            mtime_ms,
            full_view,
            content_hash,
            line_start,
            line_end,
            visible_text_hash,
            visible_text,
            line_ending,
            bom_detected,
        },
    );
    store.order.push_back(key);
    while store.entries.len() > FILE_READ_SNAPSHOT_MAX_ENTRIES {
        let Some(stale_key) = store.order.pop_front() else {
            break;
        };
        store.entries.remove(&stale_key);
    }
}

fn lookup_file_read_snapshot(session_key: &str, target: &Path) -> Option<FileReadSnapshot> {
    let key = build_file_read_snapshot_key(session_key, target);
    let Ok(store) = file_read_snapshot_store().lock() else {
        return None;
    };
    store.entries.get(&key).cloned()
}

fn clear_file_read_snapshot(session_key: &str, target: &Path) {
    let key = build_file_read_snapshot_key(session_key, target);
    let Ok(mut store) = file_read_snapshot_store().lock() else {
        return;
    };
    store.entries.remove(&key);
    store.order.retain(|item| item != &key);
}
