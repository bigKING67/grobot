fn truncate_preview(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let clipped = text.chars().take(max_chars).collect::<String>();
    format!("{clipped}...")
}

fn extract_notebook_cell_source(cell: &Value) -> String {
    if let Some(raw) = cell.get("source").and_then(Value::as_str) {
        return raw.replace('\n', " ");
    }
    if let Some(lines) = cell.get("source").and_then(Value::as_array) {
        let merged = lines
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<&str>>()
            .join("");
        return merged.replace('\n', " ");
    }
    String::new()
}

fn parse_pdf_page_range(raw: Option<&str>) -> Option<(usize, usize)> {
    let pages = raw?.trim();
    if pages.is_empty() {
        return None;
    }
    if let Some((first, last)) = pages.split_once('-') {
        let first_page = first.trim().parse::<usize>().ok()?;
        let last_page = last.trim().parse::<usize>().ok()?;
        if first_page == 0 || last_page == 0 || last_page < first_page {
            return None;
        }
        return Some((first_page, last_page));
    }
    let page = pages.parse::<usize>().ok()?;
    if page == 0 {
        return None;
    }
    Some((page, page))
}

fn read_media_payload(
    kind: ReadKind,
    target: &Path,
    relative_path: &str,
    request: &ReadRequest,
) -> Result<Value, ToolExecutionError> {
    let metadata = fs::metadata(target).map_err(|error| {
        ToolExecutionError::new("tool_execution_failed", format!("failed to read file metadata: {error}"))
    })?;
    let size_bytes = metadata.len();

    match kind {
        ReadKind::Notebook => {
            let raw = fs::read_to_string(target).map_err(|error| {
                ToolExecutionError::new("tool_execution_failed", format!("failed to read notebook file: {error}"))
            })?;
            let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
                ToolExecutionError::new(
                    "tool_execution_failed",
                    format!("failed to parse notebook json: {error}"),
                )
            })?;
            let cells = parsed
                .get("cells")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let total_cells = cells.len();
            let start_index = request.start_line.saturating_sub(1);
            if start_index >= total_cells {
                return Err(ToolExecutionError::new(
                    "range_out_of_bounds",
                    format!(
                        "read offset {} is beyond end of notebook ({} cells)",
                        request.start_line, total_cells
                    ),
                ));
            }
            let requested_limit = request.line_limit.unwrap_or(20).min(READ_MAX_OUTPUT_LINES);
            let end_index = start_index.saturating_add(requested_limit).min(total_cells);
            let has_more = end_index < total_cells;
            let next_offset = if has_more { Some(end_index + 1) } else { None };

            let mut preview_rows: Vec<String> = Vec::new();
            for (index, cell) in cells[start_index..end_index].iter().enumerate() {
                let cell_type = cell
                    .get("cell_type")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let source = truncate_preview(extract_notebook_cell_source(cell).trim(), 160);
                preview_rows.push(format!("[{}] {} {}", start_index + index + 1, cell_type, source));
            }
            let mut content = format!(
                "Notebook file detected: {relative_path}\ncell_count={total_cells}\nwindow={}..{}",
                start_index + 1,
                end_index
            );
            if !preview_rows.is_empty() {
                content.push('\n');
                content.push_str(preview_rows.join("\n").as_str());
            }
            if let Some(next) = next_offset {
                content.push_str(&format!(
                    "\n\n[More notebook cells available. Use offset={} to continue.]",
                    next
                ));
            }
            let payload = build_media_payload(
                relative_path,
                request,
                target,
                kind,
                content,
                start_index + 1,
                end_index,
                has_more,
                next_offset,
                json!({
                    "size_bytes": size_bytes,
                    "cell_count": total_cells,
                }),
            );
            Ok(payload)
        }
        ReadKind::Pdf => {
            let pages_note = request
                .pages
                .as_ref()
                .map(|value| format!("requested_pages={value}"))
                .unwrap_or_else(|| "requested_pages=all".to_string());
            let content = format!(
                "PDF file detected: {relative_path}\n{pages_note}\nPDF text extraction is not enabled in runtime read yet."
            );
            let page_range = parse_pdf_page_range(request.pages.as_deref());
            let payload = build_media_payload(
                relative_path,
                request,
                target,
                kind,
                content,
                1,
                1,
                false,
                None,
                json!({
                    "size_bytes": size_bytes,
                    "pages": request.pages,
                    "page_range": page_range.map(|(first, last)| json!({"first_page": first, "last_page": last})),
                }),
            );
            Ok(payload)
        }
        ReadKind::Image => {
            let extension = target
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let content = format!(
                "Image file detected: {relative_path}\nformat={extension}\nsize_bytes={size_bytes}\nImage binary payload is intentionally not inlined."
            );
            let payload = build_media_payload(
                relative_path,
                request,
                target,
                kind,
                content,
                1,
                1,
                false,
                None,
                json!({
                    "size_bytes": size_bytes,
                    "format": extension,
                }),
            );
            Ok(payload)
        }
        ReadKind::Text => Err(ToolExecutionError::new(
            "tool_execution_failed",
            "read media branch received text kind unexpectedly",
        )),
    }
}
