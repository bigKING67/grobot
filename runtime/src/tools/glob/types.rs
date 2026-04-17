#[derive(Debug, Clone)]
struct GlobRequest {
    pattern: String,
    path: String,
    max_entries: usize,
}

#[derive(Debug, Clone)]
struct GlobMatchesResult {
    matches: Vec<String>,
    limit_reached: bool,
    engine: &'static str,
}

fn build_glob_truncation_payload(result: &GlobMatchesResult, max_entries: usize) -> Value {
    json!({
        "truncated": result.limit_reached,
        "reason": if result.limit_reached { Some("max_entries") } else { None::<&str> },
        "returned": result.matches.len(),
        "max_entries": max_entries
    })
}
