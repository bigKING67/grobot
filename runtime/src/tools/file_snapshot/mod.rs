const FILE_READ_SNAPSHOT_MAX_ENTRIES: usize = 1024;

#[derive(Debug, Clone, Copy)]
struct FileReadSnapshot {
    mtime_ms: u128,
    full_view: bool,
    content_hash: Option<u64>,
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

fn compute_file_text_hash(target: &Path) -> Result<u64, ToolExecutionError> {
    let file_bytes = fs::read(target)
        .map_err(|error| ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}")))?;
    if file_bytes.contains(&0_u8) {
        return Err(ToolExecutionError::new(
            "binary_file_not_supported",
            "binary file content is not supported by file snapshot guard",
        ));
    }
    let file_content = String::from_utf8(file_bytes).map_err(|_| {
        ToolExecutionError::new(
            "binary_file_not_supported",
            "file snapshot guard only supports utf-8 text files",
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
    store.entries.get(&key).copied()
}

fn clear_file_read_snapshot(session_key: &str, target: &Path) {
    let key = build_file_read_snapshot_key(session_key, target);
    let Ok(mut store) = file_read_snapshot_store().lock() else {
        return;
    };
    store.entries.remove(&key);
    store.order.retain(|item| item != &key);
}
