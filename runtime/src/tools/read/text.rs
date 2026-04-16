fn read_text_window(target: &Path, request: &ReadRequest) -> Result<ReadTextResult, ToolExecutionError> {
    let file = fs::File::open(target)
        .map_err(|error| ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}")))?;
    let reader = BufReader::new(file);

    let mut line_number = 0usize;
    let mut reached_start_line = false;
    let mut selected_lines: Vec<String> = Vec::new();
    let mut selected_bytes = 0usize;
    let mut has_more = false;
    let mut truncated_by: Option<&'static str> = None;

    for line_result in reader.lines() {
        line_number = line_number.saturating_add(1);
        let line = line_result
            .map_err(|error| ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}")))?;
        if line_number < request.start_line {
            continue;
        }
        reached_start_line = true;

        if let Some(user_limit) = request.line_limit {
            if selected_lines.len() >= user_limit {
                has_more = true;
                break;
            }
        }
        if selected_lines.len() >= READ_MAX_OUTPUT_LINES {
            has_more = true;
            truncated_by = Some("lines");
            break;
        }

        let line_bytes = line.as_bytes().len();
        if selected_lines.is_empty() && line_bytes > READ_MAX_OUTPUT_BYTES {
            selected_lines.push(format!(
                "[line {} exceeds {} bytes; use offset/limit or search for a narrower read]",
                line_number, READ_MAX_OUTPUT_BYTES
            ));
            selected_bytes = selected_lines[0].as_bytes().len();
            has_more = true;
            truncated_by = Some("bytes");
            break;
        }

        let separator_bytes = if selected_lines.is_empty() { 0 } else { 1 };
        let next_size = selected_bytes
            .saturating_add(separator_bytes)
            .saturating_add(line_bytes);
        if next_size > READ_MAX_OUTPUT_BYTES {
            has_more = true;
            truncated_by = Some("bytes");
            break;
        }
        selected_bytes = next_size;
        selected_lines.push(line);
    }

    if !reached_start_line {
        return Err(ToolExecutionError::new(
            "range_out_of_bounds",
            format!("read offset {} is beyond end of file", request.start_line),
        ));
    }

    let line_end = if selected_lines.is_empty() {
        request.start_line.saturating_sub(1)
    } else {
        request
            .start_line
            .saturating_add(selected_lines.len().saturating_sub(1))
    };
    let next_offset = if has_more {
        Some(line_end.saturating_add(1))
    } else {
        None
    };

    let mut content = selected_lines.join("\n");
    if let Some(next) = next_offset {
        content.push_str(&format!(
            "\n\n[More content available. Use offset={} to continue.]",
            next
        ));
    }

    Ok(ReadTextResult {
        content,
        line_start: request.start_line,
        line_end,
        has_more,
        next_offset,
        truncated_by,
        read_bytes: selected_bytes,
    })
}
