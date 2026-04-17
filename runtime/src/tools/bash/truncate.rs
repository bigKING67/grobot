fn summarize_bash_stream(
    content: &str,
    total_lines: usize,
    total_bytes: usize,
    max_lines: usize,
    max_bytes: usize,
) -> BashTruncationSummary {
    if content.is_empty() {
        return BashTruncationSummary {
            content: String::new(),
            truncated: total_bytes > 0,
            truncated_by: if total_bytes > 0 { Some("bytes") } else { None },
            total_lines,
            total_bytes,
            output_lines: 0,
            output_bytes: 0,
            last_line_partial: false,
            max_lines,
            max_bytes,
        };
    }

    let lines: Vec<&str> = content.split('\n').collect();
    let mut output_lines_rev: Vec<String> = Vec::new();
    let mut output_bytes = 0usize;
    let mut last_line_partial = false;
    let mut truncated_by: Option<&'static str> = None;

    for line in lines.iter().rev() {
        if output_lines_rev.len() >= max_lines {
            truncated_by = Some("lines");
            break;
        }

        let newline_cost = if output_lines_rev.is_empty() { 0 } else { 1 };
        let line_bytes = line.as_bytes().len();
        let candidate = output_bytes
            .saturating_add(newline_cost)
            .saturating_add(line_bytes);

        if candidate > max_bytes {
            truncated_by = Some("bytes");
            if output_lines_rev.is_empty() {
                let partial = truncate_utf8_from_end(line, max_bytes);
                output_lines_rev.push(partial);
                last_line_partial = true;
            }
            break;
        }

        output_lines_rev.push((*line).to_string());
        output_bytes = candidate;
    }

    output_lines_rev.reverse();
    let output_content = output_lines_rev.join("\n");
    let output_bytes = output_content.as_bytes().len();
    let output_lines = if output_content.is_empty() {
        0
    } else {
        output_content.split('\n').count()
    };

    let truncated = total_bytes > output_bytes || total_lines > output_lines;
    let truncated_by = if truncated {
        if truncated_by.is_none() {
            if total_bytes > output_bytes {
                Some("bytes")
            } else {
                Some("lines")
            }
        } else {
            truncated_by
        }
    } else {
        None
    };

    BashTruncationSummary {
        content: output_content,
        truncated,
        truncated_by,
        total_lines,
        total_bytes,
        output_lines,
        output_bytes,
        last_line_partial,
        max_lines,
        max_bytes,
    }
}

fn truncate_utf8_from_end(input: &str, max_bytes: usize) -> String {
    if max_bytes == 0 {
        return String::new();
    }
    let bytes = input.as_bytes();
    if bytes.len() <= max_bytes {
        return input.to_string();
    }

    let mut start = bytes.len().saturating_sub(max_bytes);
    while start < bytes.len() && (bytes[start] & 0b1100_0000) == 0b1000_0000 {
        start += 1;
    }

    String::from_utf8_lossy(&bytes[start..]).to_string()
}

fn truncation_summary_to_json(summary: &BashTruncationSummary) -> Value {
    json!({
        "truncated": summary.truncated,
        "truncated_by": summary.truncated_by,
        "total_lines": summary.total_lines,
        "total_bytes": summary.total_bytes,
        "output_lines": summary.output_lines,
        "output_bytes": summary.output_bytes,
        "last_line_partial": summary.last_line_partial,
        "max_lines": summary.max_lines,
        "max_bytes": summary.max_bytes,
    })
}
