#[derive(Debug, Clone)]
struct ListRequest {
    path: String,
    recursive: bool,
    max_entries: usize,
}

#[derive(Debug, Clone)]
struct ListEntriesResult {
    entries: Vec<String>,
    limit_reached: bool,
}

fn build_list_truncation_payload(result: &ListEntriesResult, max_entries: usize) -> Value {
    json!({
        "truncated": result.limit_reached,
        "reason": if result.limit_reached { Some("max_entries") } else { None::<&str> },
        "returned": result.entries.len(),
        "max_entries": max_entries
    })
}
