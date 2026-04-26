fn file_size_for_meta(target: &Path) -> u64 {
    fs::metadata(target).map(|meta| meta.len()).unwrap_or(0)
}

fn build_text_payload(
    relative_path: &str,
    request: &ReadRequest,
    result: &ReadTextResult,
    target: &Path,
    text_format: TextFormatMetadata,
    full_view: bool,
) -> Value {
    let mut payload = json!({
        "tool": TOOL_READ,
        "kind": "text",
        "path": relative_path,
        "line_start": result.line_start,
        "line_end": result.line_end,
        "has_more": result.has_more,
        "next_offset": result.next_offset,
        "truncated": result.truncated_by.is_some(),
        "truncated_by": result.truncated_by,
        "content": result.content,
    });
    if request.include_metadata {
        payload["meta"] = json!({
            "kind": "text",
            "range_mode": request.range_mode,
            "start_line": request.start_line,
            "line_limit": request.line_limit,
            "size_bytes": file_size_for_meta(target),
            "read_bytes": result.read_bytes,
            "line_ending": text_format.line_ending,
            "bom_detected": text_format.bom_detected,
            "encoding": "utf-8",
            "snapshot_full_view": full_view,
        });
    }
    payload
}

fn build_file_unchanged_payload(
    relative_path: &str,
    request: &ReadRequest,
    cached: &ReadCacheEntry,
    mtime_ms: u128,
) -> Value {
    let mut payload = json!({
        "tool": TOOL_READ,
        "kind": "file_unchanged",
        "path": relative_path,
        "line_start": cached.line_start,
        "line_end": cached.line_end,
        "has_more": cached.has_more,
        "next_offset": cached.next_offset,
        "truncated": false,
        "truncated_by": Value::Null,
        "content": "File unchanged for the same range since last read.",
    });
    if request.include_metadata {
        payload["meta"] = json!({
            "kind": cached.kind,
            "range_mode": request.range_mode,
            "start_line": request.start_line,
            "line_limit": cached.line_limit,
            "size_bytes": cached.size_bytes,
            "read_bytes": cached.read_bytes,
            "line_ending": cached.line_ending,
            "bom_detected": cached.bom_detected,
            "encoding": "utf-8",
            "snapshot_full_view": cached.full_view,
            "mtime_ms": mtime_ms.min(u128::from(u64::MAX)) as u64,
            "cache": "hit",
        });
    }
    payload
}

fn build_media_payload(
    relative_path: &str,
    request: &ReadRequest,
    target: &Path,
    kind: ReadKind,
    content: String,
    line_start: usize,
    line_end: usize,
    has_more: bool,
    next_offset: Option<usize>,
    truncated: bool,
    truncated_by: Option<&'static str>,
    extra_meta: Value,
) -> Value {
    let mut payload = json!({
        "tool": TOOL_READ,
        "kind": kind.as_str(),
        "path": relative_path,
        "line_start": line_start,
        "line_end": line_end,
        "has_more": has_more,
        "next_offset": next_offset,
        "truncated": truncated,
        "truncated_by": truncated_by,
        "content": content,
    });
    if request.include_metadata {
        payload["meta"] = json!({
            "kind": kind.as_str(),
            "range_mode": request.range_mode,
            "size_bytes": file_size_for_meta(target),
            "extra": extra_meta,
        });
    }
    payload
}
