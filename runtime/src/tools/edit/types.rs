const EDIT_MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const EDIT_READ_SNAPSHOT_MAX_ENTRIES: usize = 1024;
const EDIT_MUTATION_LOCK_MAX_TRACKED: usize = 2048;

#[derive(Debug, Clone)]
struct EditOperation {
    old_text: String,
    new_text: String,
}

#[derive(Debug, Clone)]
struct NormalizedEditOperation {
    old_text: String,
    new_text: String,
}

#[derive(Debug, Clone, Copy)]
struct EditReadSnapshot {
    mtime_ms: u128,
}

#[derive(Debug, Default)]
struct EditReadSnapshotStore {
    entries: HashMap<String, EditReadSnapshot>,
    order: VecDeque<String>,
}

#[derive(Debug, Default)]
struct EditMutationQueueStore {
    locks: HashMap<String, Arc<Mutex<()>>>,
}

#[derive(Debug, Clone, Copy)]
struct EditMatch {
    edit_index: usize,
    start: usize,
    end: usize,
    start_line: usize,
    used_fuzzy: bool,
}
