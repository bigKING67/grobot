fn edit_snapshot_store() -> &'static Mutex<EditReadSnapshotStore> {
    static STORE: OnceLock<Mutex<EditReadSnapshotStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(EditReadSnapshotStore::default()))
}

fn file_mutation_queue_store() -> &'static Mutex<FileMutationQueueStore> {
    static STORE: OnceLock<Mutex<FileMutationQueueStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(FileMutationQueueStore::default()))
}

fn build_edit_snapshot_key(session_key: &str, target: &Path) -> String {
    format!("{session_key}::{}", target.to_string_lossy())
}

fn record_edit_read_snapshot(session_key: &str, target: &Path, mtime_ms: u128) {
    let Ok(mut store) = edit_snapshot_store().lock() else {
        return;
    };
    let key = build_edit_snapshot_key(session_key, target);
    if store.entries.contains_key(&key) {
        store.order.retain(|item| item != &key);
    }
    store.entries.insert(key.clone(), EditReadSnapshot { mtime_ms });
    store.order.push_back(key);
    while store.entries.len() > EDIT_READ_SNAPSHOT_MAX_ENTRIES {
        let Some(stale_key) = store.order.pop_front() else {
            break;
        };
        store.entries.remove(&stale_key);
    }
}

fn lookup_edit_read_snapshot(session_key: &str, target: &Path) -> Option<EditReadSnapshot> {
    let key = build_edit_snapshot_key(session_key, target);
    let Ok(store) = edit_snapshot_store().lock() else {
        return None;
    };
    store.entries.get(&key).copied()
}

fn clear_edit_read_snapshot(session_key: &str, target: &Path) {
    let key = build_edit_snapshot_key(session_key, target);
    let Ok(mut store) = edit_snapshot_store().lock() else {
        return;
    };
    store.entries.remove(&key);
    store.order.retain(|item| item != &key);
}

fn acquire_file_mutation_lock(target: &Path) -> Result<Arc<Mutex<()>>, ToolExecutionError> {
    let key = target.to_string_lossy().to_string();
    let mut store = file_mutation_queue_store()
        .lock()
        .map_err(|_| ToolExecutionError::new("runtime_state_unavailable", "failed to lock file mutation queue store"))?;
    if store.locks.len() > FILE_MUTATION_LOCK_MAX_TRACKED {
        store.locks.retain(|_, lock| Arc::strong_count(lock) > 1);
    }
    Ok(store
        .locks
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}
