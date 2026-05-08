fn lookup_edit_read_snapshot(session_key: &str, target: &Path) -> Option<EditReadSnapshot> {
    lookup_file_read_snapshot(session_key, target).map(|snapshot| EditReadSnapshot {
        mtime_ms: snapshot.mtime_ms,
        content_hash: snapshot.content_hash,
        full_view: snapshot.full_view,
        line_start: snapshot.line_start,
        line_end: snapshot.line_end,
        visible_text_hash: snapshot.visible_text_hash,
        visible_text: snapshot.visible_text,
        line_ending: snapshot.line_ending,
        bom_detected: snapshot.bom_detected,
    })
}
