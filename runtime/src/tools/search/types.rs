const SEARCH_MAX_MATCH_TEXT_CHARS: usize = 4_096;
const SEARCH_MAX_OUTPUT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone)]
struct SearchRequest {
    query: String,
    path: String,
    max_results: usize,
    context_before: usize,
    context_after: usize,
    fixed_mode: bool,
    case_sensitive: bool,
}

#[derive(Debug, Clone)]
struct SearchCollectResult {
    matches: Vec<Value>,
    max_results_reached: bool,
    engine: &'static str,
}

#[derive(Debug, Clone)]
struct SearchOutputLimitResult {
    matches: Vec<Value>,
    output_bytes: usize,
    output_bytes_reached: bool,
}

#[derive(Debug, Clone)]
struct PendingContextMatch {
    line_number: usize,
    end_line: usize,
    records: Vec<Value>,
}

fn build_search_truncation_payload(
    request: &SearchRequest,
    max_results_reached: bool,
    output: &SearchOutputLimitResult,
) -> Value {
    json!({
        "truncated": max_results_reached || output.output_bytes_reached,
        "max_results_reached": max_results_reached,
        "output_bytes_reached": output.output_bytes_reached,
        "returned": output.matches.len(),
        "max_results": request.max_results,
        "output_bytes": output.output_bytes,
        "max_output_bytes": SEARCH_MAX_OUTPUT_BYTES,
        "max_match_text_chars": SEARCH_MAX_MATCH_TEXT_CHARS
    })
}
