#[derive(Debug, Clone, Copy)]
struct WriteReadSnapshot {
    mtime_ms: u128,
    full_view: bool,
    content_hash: Option<u64>,
}

#[derive(Debug, Clone)]
struct WriteRequest {
    path: String,
    content: String,
}
