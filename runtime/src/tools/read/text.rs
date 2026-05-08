fn build_text_window_result(
    request: &ReadRequest,
    selected_lines: Vec<String>,
    selected_bytes: usize,
    has_more: bool,
    truncated_by: Option<&'static str>,
) -> ReadTextResult {
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

    let visible_content = selected_lines.join("\n");
    let mut content = visible_content.clone();
    if let Some(next) = next_offset {
        content.push_str(&format!(
            "\n\n[More content available. Use offset={} to continue.]",
            next
        ));
    }

    ReadTextResult {
        content,
        visible_content,
        line_start: request.start_line,
        line_end,
        has_more,
        next_offset,
        truncated_by,
        read_bytes: selected_bytes,
    }
}

fn read_text_window_from_content(raw: &str, request: &ReadRequest) -> Result<ReadTextResult, ToolExecutionError> {
    let lines = raw.lines().map(ToString::to_string).collect::<Vec<String>>();
    if lines.is_empty() {
        if request.start_line == 1 {
            return Ok(build_text_window_result(
                request,
                Vec::new(),
                0,
                false,
                None,
            ));
        }
        return Err(ToolExecutionError::new(
            "range_out_of_bounds",
            format!("read offset {} is beyond end of file", request.start_line),
        )
        .with_data(json!({
            "diagnostic_kind": "range_out_of_bounds",
            "range_kind": "line",
            "requested_offset": request.start_line,
            "available_count": 0,
            "recovery_hint": "retry with an offset within the reported line range"
        })));
    }
    if request.start_line > lines.len() {
        return Err(ToolExecutionError::new(
            "range_out_of_bounds",
            format!("read offset {} is beyond end of file", request.start_line),
        )
        .with_data(json!({
            "diagnostic_kind": "range_out_of_bounds",
            "range_kind": "line",
            "requested_offset": request.start_line,
            "available_count": lines.len(),
            "recovery_hint": "retry with an offset within the reported line range"
        })));
    }

    let mut selected_lines: Vec<String> = Vec::new();
    let mut selected_bytes = 0usize;
    let mut has_more = false;
    let mut truncated_by: Option<&'static str> = None;
    for (index, line) in lines.iter().enumerate().skip(request.start_line.saturating_sub(1)) {
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

        let line_number = index + 1;
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
        selected_lines.push(line.clone());
    }

    Ok(build_text_window_result(
        request,
        selected_lines,
        selected_bytes,
        has_more,
        truncated_by,
    ))
}

fn read_text_window(
    target: &Path,
    relative_path: Option<&str>,
    request: &ReadRequest,
) -> Result<ReadTextResult, ToolExecutionError> {
    let file = fs::File::open(target).map_err(|error| {
        file_io_error(
            format!("failed to read file: {error}"),
            target,
            relative_path,
            "read.text",
            "open_text_window",
            "confirm the text file still exists and is readable, then retry",
        )
    })?;
    let reader = BufReader::new(file);

    let mut saw_any_line = false;
    let mut line_number = 0usize;
    let mut reached_start_line = false;
    let mut selected_lines: Vec<String> = Vec::new();
    let mut selected_bytes = 0usize;
    let mut has_more = false;
    let mut truncated_by: Option<&'static str> = None;

    for line_result in reader.lines() {
        saw_any_line = true;
        line_number = line_number.saturating_add(1);
        let line = line_result.map_err(|error| {
            file_io_error(
                format!("failed to read file: {error}"),
                target,
                relative_path,
                "read.text",
                "read_text_line",
                "confirm the text file is readable and stable, then retry",
            )
        })?;
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
        if !saw_any_line && request.start_line == 1 {
            return Ok(build_text_window_result(
                request,
                Vec::new(),
                0,
                false,
                None,
            ));
        }
        return Err(ToolExecutionError::new(
            "range_out_of_bounds",
            format!("read offset {} is beyond end of file", request.start_line),
        )
        .with_data(json!({
            "diagnostic_kind": "range_out_of_bounds",
            "range_kind": "line",
            "requested_offset": request.start_line,
            "available_count": line_number,
            "recovery_hint": "retry with an offset within the reported line range"
        })));
    }

    Ok(build_text_window_result(
        request,
        selected_lines,
        selected_bytes,
        has_more,
        truncated_by,
    ))
}
