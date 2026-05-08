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

#[derive(Debug, Clone)]
struct EditReadSnapshot {
    mtime_ms: u128,
    content_hash: Option<u64>,
    full_view: bool,
    line_start: usize,
    line_end: usize,
    visible_text_hash: u64,
    visible_text: Option<String>,
    line_ending: &'static str,
    bom_detected: bool,
}

#[derive(Debug, Clone)]
struct EditMatch {
    edit_index: usize,
    start: usize,
    end: usize,
    start_line: usize,
    used_fuzzy: bool,
    actual_old_text: String,
    actual_new_text: String,
}
