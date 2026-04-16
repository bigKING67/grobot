const WRITE_READ_SNAPSHOT_MAX_ENTRIES: usize = 1024;

#[derive(Debug, Clone, Copy)]
struct WriteReadSnapshot {
    mtime_ms: u128,
    full_view: bool,
}

#[derive(Debug, Default)]
struct WriteReadSnapshotStore {
    entries: HashMap<String, WriteReadSnapshot>,
    order: VecDeque<String>,
}

#[derive(Debug, Clone)]
struct WriteRequest {
    path: String,
    content: String,
}
