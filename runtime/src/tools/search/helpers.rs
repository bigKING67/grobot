fn normalize_search_match_path(
    context: &ToolContextResolved,
    target: &Path,
    root_rel: Option<&str>,
    path_text: &str,
) -> String {
    match root_rel {
        Some(prefix) if prefix != "." && !target.is_file() => {
            format!("{prefix}/{path_text}")
        }
        _ if target.is_file() => relative_to_work_dir(&context.work_dir, target),
        _ => path_text.to_string(),
    }
}

fn truncate_search_text(raw: &str) -> (String, bool) {
    let normalized = raw.trim_end_matches('\n').trim_end_matches('\r');
    if normalized.chars().count() <= SEARCH_MAX_MATCH_TEXT_CHARS {
        return (normalized.to_string(), false);
    }
    (
        normalized.chars().take(SEARCH_MAX_MATCH_TEXT_CHARS).collect(),
        true,
    )
}

fn build_search_text_record(line_number: usize, is_match: bool, raw_text: &str) -> Value {
    let (text, text_truncated) = truncate_search_text(raw_text);
    json!({
        "line": line_number,
        "match": is_match,
        "text": text,
        "text_truncated": text_truncated,
    })
}

fn build_search_plain_match(path: &str, line_number: usize, raw_text: &str) -> Value {
    let (text, text_truncated) = truncate_search_text(raw_text);
    json!({
        "path": path,
        "line": line_number,
        "text": text,
        "text_truncated": text_truncated,
    })
}

fn build_search_context_match(path: &str, line_number: usize, records: Vec<Value>) -> Value {
    json!({
        "path": path,
        "line": line_number,
        "records": records,
    })
}

fn read_context_records_for_match(
    context: &ToolContextResolved,
    relative_path: &str,
    line_number: usize,
    context_before: usize,
    context_after: usize,
) -> Option<Vec<Value>> {
    if line_number == 0 {
        return None;
    }
    let target = ensure_within_workspace(&context.work_dir, relative_path, false).ok()?;
    if !target.is_file() {
        return None;
    }
    let file = fs::File::open(&target).ok()?;
    let reader = BufReader::new(file);
    let start = line_number.saturating_sub(context_before).max(1);
    let end = line_number.saturating_add(context_after);
    let mut records: Vec<Value> = Vec::new();
    let mut has_match_line = false;
    for (index, line_result) in reader.lines().enumerate() {
        let row = index + 1;
        if row < start {
            continue;
        }
        if row > end {
            break;
        }
        let line = line_result.ok()?;
        let is_match = row == line_number;
        if is_match {
            has_match_line = true;
        }
        records.push(build_search_text_record(row, is_match, line.as_str()));
    }
    if !has_match_line || records.is_empty() {
        return None;
    }
    Some(records)
}

fn parse_rg_json_event(raw: &str) -> Option<(String, usize, String, bool)> {
    let payload: Value = serde_json::from_str(raw).ok()?;
    let event_type = payload.get("type")?.as_str()?;
    let is_match = match event_type {
        "match" => true,
        "context" => false,
        _ => return None,
    };
    let data = payload.get("data")?;
    let path = data
        .get("path")
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)?;
    let line_number = data.get("line_number").and_then(Value::as_u64)? as usize;
    if line_number == 0 {
        return None;
    }
    let text_raw = data
        .get("lines")
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("");
    Some((
        path.to_string(),
        line_number,
        text_raw
            .trim_end_matches('\n')
            .trim_end_matches('\r')
            .to_string(),
        is_match,
    ))
}

fn build_context_records_from_rg_index(
    line_index: &HashMap<usize, String>,
    line_number: usize,
    context_before: usize,
    context_after: usize,
) -> Vec<Value> {
    if line_number == 0 {
        return Vec::new();
    }
    let start = line_number.saturating_sub(context_before).max(1);
    let end = line_number.saturating_add(context_after);
    let mut records: Vec<Value> = Vec::new();
    let mut has_match_line = false;
    for row in start..=end {
        let Some(text) = line_index.get(&row) else {
            continue;
        };
        let is_match = row == line_number;
        if is_match {
            has_match_line = true;
        }
        records.push(build_search_text_record(row, is_match, text));
    }
    if !has_match_line {
        return Vec::new();
    }
    records
}

fn line_in_context_windows(windows: &[(usize, usize)], line_number: usize) -> bool {
    for (start, end) in windows {
        if line_number >= *start && line_number <= *end {
            return true;
        }
    }
    false
}

fn estimate_search_value_bytes(value: &Value) -> usize {
    serde_json::to_vec(value).map(|bytes| bytes.len()).unwrap_or(0)
}

fn apply_search_output_byte_limit(matches: Vec<Value>) -> SearchOutputLimitResult {
    let mut selected: Vec<Value> = Vec::new();
    let mut output_bytes = 0_usize;
    let mut output_bytes_reached = false;
    for item in matches {
        let item_bytes = estimate_search_value_bytes(&item);
        if !selected.is_empty() && output_bytes.saturating_add(item_bytes) > SEARCH_MAX_OUTPUT_BYTES {
            output_bytes_reached = true;
            break;
        }
        if selected.is_empty() && item_bytes > SEARCH_MAX_OUTPUT_BYTES {
            output_bytes = item_bytes;
            selected.push(item);
            output_bytes_reached = true;
            break;
        }
        output_bytes = output_bytes.saturating_add(item_bytes);
        selected.push(item);
    }
    SearchOutputLimitResult {
        matches: selected,
        output_bytes,
        output_bytes_reached,
    }
}
