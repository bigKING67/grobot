fn hash_write_guard_text(content: &str) -> u64 {
    hash_text_for_file_guard(content)
}

fn compute_write_guard_hash_for_file(target: &Path) -> Result<u64, ToolExecutionError> {
    compute_file_text_hash(target)
}

fn record_write_read_snapshot(
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
    record_file_read_snapshot(
        session_key,
        target,
        mtime_ms,
        full_view,
        content_hash,
        line_start,
        line_end,
        visible_text_hash,
        visible_text,
        line_ending,
        bom_detected,
    );
}

fn lookup_write_read_snapshot(session_key: &str, target: &Path) -> Option<WriteReadSnapshot> {
    lookup_file_read_snapshot(session_key, target).map(|snapshot| WriteReadSnapshot {
        mtime_ms: snapshot.mtime_ms,
        full_view: snapshot.full_view,
        content_hash: snapshot.content_hash,
    })
}

fn clear_write_read_snapshot(session_key: &str, target: &Path) {
    clear_file_read_snapshot(session_key, target);
}
