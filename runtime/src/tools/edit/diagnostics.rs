const EDIT_DIAGNOSTIC_CANDIDATE_LIMIT: usize = 4;
const EDIT_DIAGNOSTIC_PREVIEW_CHARS: usize = 120;

#[derive(Debug, Clone)]
struct EditCandidatePreview {
    line: usize,
    preview: String,
}

fn build_edit_match_candidates_detail(content: &str, ranges: &[(usize, usize)]) -> String {
    let candidates = ranges
        .iter()
        .take(EDIT_DIAGNOSTIC_CANDIDATE_LIMIT)
        .map(|(start, _)| EditCandidatePreview {
            line: line_number_for_offset(content, *start),
            preview: preview_line_for_offset(content, *start),
        })
        .collect::<Vec<EditCandidatePreview>>();
    format_edit_candidate_list(
        "candidates",
        &candidates,
        "recovery=read target around candidate lines and retry with a unique old_text",
    )
}

fn build_edit_not_found_detail(content: &str, old_text: &str) -> String {
    let candidates = nearest_edit_candidate_lines(
        content,
        old_text,
        EDIT_DIAGNOSTIC_CANDIDATE_LIMIT,
    );
    if candidates.is_empty() {
        return "recovery=read target then retry with exact old_text from the latest file content".to_string();
    }
    format_edit_candidate_list(
        "closest_lines",
        &candidates,
        "recovery=read target around closest_lines and retry with exact old_text",
    )
}

fn append_edit_diagnostics(message: String, detail: String) -> String {
    if detail.trim().is_empty() {
        message
    } else {
        format!("{message}; {detail}")
    }
}

fn format_edit_candidate_list(
    label: &str,
    candidates: &[EditCandidatePreview],
    recovery: &str,
) -> String {
    if candidates.is_empty() {
        return recovery.to_string();
    }
    let rows = candidates
        .iter()
        .map(|candidate| {
            format!(
                "line {}: {}",
                candidate.line,
                quote_preview(candidate.preview.as_str())
            )
        })
        .collect::<Vec<String>>()
        .join(", ");
    format!("{label}={rows}; {recovery}")
}

fn preview_line_for_offset(content: &str, byte_offset: usize) -> String {
    if content.is_empty() {
        return "<empty>".to_string();
    }
    let clamped = byte_offset.min(content.len());
    let line_start = content[..clamped]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let line_end = content[clamped..]
        .find('\n')
        .map(|index| clamped + index)
        .unwrap_or(content.len());
    compact_edit_preview(&content[line_start..line_end])
}

fn compact_edit_preview(raw: &str) -> String {
    let normalized = raw.trim().replace('\t', " ");
    if normalized.is_empty() {
        return "<blank>".to_string();
    }
    let mut preview = normalized
        .chars()
        .take(EDIT_DIAGNOSTIC_PREVIEW_CHARS)
        .collect::<String>();
    if normalized.chars().count() > EDIT_DIAGNOSTIC_PREVIEW_CHARS {
        preview.push_str("...");
    }
    preview
}

fn quote_preview(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"<unprintable>\"".to_string())
}

fn normalize_edit_diagnostic_text(value: &str) -> String {
    value
        .chars()
        .map(normalize_safe_fuzzy_char)
        .flat_map(char::to_lowercase)
        .collect::<String>()
}

fn edit_diagnostic_tokens(value: &str) -> Vec<String> {
    let normalized = normalize_edit_diagnostic_text(value);
    let mut tokens: Vec<String> = Vec::new();
    for token in normalized.split(|ch: char| !ch.is_alphanumeric()) {
        if token.chars().count() < 3 {
            continue;
        }
        if !tokens.iter().any(|item| item == token) {
            tokens.push(token.to_string());
        }
    }
    tokens
}

fn first_non_empty_diagnostic_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(normalize_edit_diagnostic_text)
}

fn nearest_edit_candidate_lines(
    content: &str,
    old_text: &str,
    limit: usize,
) -> Vec<EditCandidatePreview> {
    let tokens = edit_diagnostic_tokens(old_text);
    let anchor = first_non_empty_diagnostic_line(old_text);
    if tokens.is_empty()
        && anchor
            .as_ref()
            .map(|value| value.chars().count())
            .unwrap_or(0)
            < 3
    {
        return Vec::new();
    }

    let mut scored: Vec<(usize, usize, EditCandidatePreview)> = Vec::new();
    for (line_index, raw_line) in content.split_inclusive('\n').enumerate() {
        let line = raw_line.trim_end_matches('\n').trim_end_matches('\r');
        let normalized_line = normalize_edit_diagnostic_text(line);
        let mut score = 0usize;
        if let Some(anchor_value) = anchor.as_ref() {
            if anchor_value.chars().count() >= 3 {
                if normalized_line == *anchor_value {
                    score += 100;
                } else if normalized_line.contains(anchor_value) {
                    score += 50;
                }
            }
        }
        for token in &tokens {
            if normalized_line.contains(token) {
                score += 10 + token.chars().count().min(12);
            }
        }
        if score == 0 {
            continue;
        }
        scored.push((
            score,
            line_index + 1,
            EditCandidatePreview {
                line: line_index + 1,
                preview: compact_edit_preview(line),
            },
        ));
    }

    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(_, _, candidate)| candidate)
        .collect()
}
