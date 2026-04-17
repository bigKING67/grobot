fn lookup_edit_read_snapshot(session_key: &str, target: &Path) -> Option<EditReadSnapshot> {
    lookup_file_read_snapshot(session_key, target).map(|snapshot| EditReadSnapshot {
        mtime_ms: snapshot.mtime_ms,
        content_hash: snapshot.content_hash,
    })
}
