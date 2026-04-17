const EDIT_MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

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
    content_hash: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
struct EditMatch {
    edit_index: usize,
    start: usize,
    end: usize,
    start_line: usize,
    used_fuzzy: bool,
}
