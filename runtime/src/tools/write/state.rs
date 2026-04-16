fn write_snapshot_store() -> &'static Mutex<WriteReadSnapshotStore> {
    static STORE: OnceLock<Mutex<WriteReadSnapshotStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(WriteReadSnapshotStore::default()))
}

fn build_write_snapshot_key(session_key: &str, target: &Path) -> String {
    format!("{session_key}::{}", target.to_string_lossy())
}

fn record_write_read_snapshot(session_key: &str, target: &Path, mtime_ms: u128, full_view: bool) {
    let Ok(mut store) = write_snapshot_store().lock() else {
        return;
    };
    let key = build_write_snapshot_key(session_key, target);
    if store.entries.contains_key(&key) {
        store.order.retain(|item| item != &key);
    }
    store
        .entries
        .insert(key.clone(), WriteReadSnapshot { mtime_ms, full_view });
    store.order.push_back(key);
    while store.entries.len() > WRITE_READ_SNAPSHOT_MAX_ENTRIES {
        let Some(stale_key) = store.order.pop_front() else {
            break;
        };
        store.entries.remove(&stale_key);
    }
}

fn lookup_write_read_snapshot(session_key: &str, target: &Path) -> Option<WriteReadSnapshot> {
    let key = build_write_snapshot_key(session_key, target);
    let Ok(store) = write_snapshot_store().lock() else {
        return None;
    };
    store.entries.get(&key).copied()
}

fn clear_write_read_snapshot(session_key: &str, target: &Path) {
    let key = build_write_snapshot_key(session_key, target);
    let Ok(mut store) = write_snapshot_store().lock() else {
        return;
    };
    store.entries.remove(&key);
    store.order.retain(|item| item != &key);
}
