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

fn parse_pdf_total_pages(raw: &str) -> Option<usize> {
    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.to_ascii_lowercase().starts_with("pages:") {
            continue;
        }
        let (_, value) = trimmed.split_once(':')?;
        let parsed = value.trim().parse::<usize>().ok()?;
        if parsed == 0 {
            return None;
        }
        return Some(parsed);
    }
    None
}

fn read_pdf_total_pages(target: &Path) -> Option<usize> {
    if !command_available("pdfinfo") {
        return None;
    }
    let output = Command::new("pdfinfo").arg(target).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_pdf_total_pages(stdout.as_ref())
}

fn parse_pdfimages_list_count(raw: &str) -> Option<usize> {
    let mut count = 0usize;
    let mut saw_header = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lowered = trimmed.to_ascii_lowercase();
        if lowered.starts_with("page") && lowered.contains("num") && lowered.contains("type") {
            saw_header = true;
            continue;
        }
        if trimmed.starts_with('-') {
            continue;
        }
        if trimmed
            .split_whitespace()
            .next()
            .and_then(|token| token.parse::<usize>().ok())
            .is_some()
        {
            count = count.saturating_add(1);
        }
    }
    if saw_header || count > 0 {
        return Some(count);
    }
    None
}

fn read_pdf_embedded_image_count(target: &Path) -> Option<usize> {
    if !command_available("pdfimages") {
        return None;
    }
    let output = Command::new("pdfimages")
        .arg("-list")
        .arg(target)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_pdfimages_list_count(stdout.as_ref())
}

#[derive(Debug, Clone)]
struct PdfExtractPlan {
    first_page: usize,
    last_page: usize,
    has_more_pages: bool,
    next_pages: Option<String>,
}

fn compute_pdf_extract_plan(
    requested_range: Option<(usize, usize)>,
    total_pages: Option<usize>,
) -> Result<PdfExtractPlan, ToolExecutionError> {
    let (first_page, mut last_page) = if let Some((first, last)) = requested_range {
        (first, last)
    } else {
        (1, READ_PDF_MAX_PAGES)
    };

    if let Some(total) = total_pages {
        if first_page > total {
            return Err(ToolExecutionError::new(
                "range_out_of_bounds",
                format!("requested page {} exceeds total pages {}", first_page, total),
            ));
        }
        last_page = last_page.min(total);
    }

    if last_page < first_page {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "pdf page range is invalid after normalization",
        ));
    }
    let selected_count = last_page.saturating_sub(first_page).saturating_add(1);
    if selected_count > READ_PDF_MAX_PAGES {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("pdf read window exceeds max {} pages", READ_PDF_MAX_PAGES),
        ));
    }

    let has_more_pages = total_pages
        .map(|total| last_page < total)
        .unwrap_or(false);
    let next_pages = if has_more_pages {
        let total = total_pages.unwrap_or(last_page);
        let next_first = last_page.saturating_add(1);
        let next_last = next_first
            .saturating_add(READ_PDF_MAX_PAGES.saturating_sub(1))
            .min(total);
        Some(format!("{next_first}-{next_last}"))
    } else {
        None
    };

    Ok(PdfExtractPlan {
        first_page,
        last_page,
        has_more_pages,
        next_pages,
    })
}

fn format_pdf_page_range(first_page: usize, last_page: usize) -> String {
    if first_page == last_page {
        return first_page.to_string();
    }
    format!("{first_page}-{last_page}")
}

fn pdf_has_visible_text(raw: &str) -> bool {
    raw.chars().any(|ch| !ch.is_whitespace())
}

fn extract_pdf_text_with_pdftotext(
    target: &Path,
    page_range: Option<(usize, usize)>,
) -> Result<String, ToolExecutionError> {
    let mut command = Command::new("pdftotext");
    command.arg("-q").arg("-enc").arg("UTF-8");
    if let Some((first_page, last_page)) = page_range {
        command
            .arg("-f")
            .arg(first_page.to_string())
            .arg("-l")
            .arg(last_page.to_string());
    }
    command.arg(target).arg("-");
    let output = command.output().map_err(|error| {
        ToolExecutionError::new(
            "pdf_extract_unavailable",
            format!("failed to execute pdftotext: {error}"),
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let reason = if stderr.is_empty() {
            "unknown error".to_string()
        } else {
            stderr
        };
        return Err(ToolExecutionError::new(
            "pdf_extract_failed",
            format!("pdftotext failed: {reason}"),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
            if total_cells == 0 {
                if request.start_line > 1 {
                    return Err(ToolExecutionError::new(
                        "range_out_of_bounds",
                        format!(
                            "read offset {} is beyond end of notebook (0 cells)",
                            request.start_line
                        ),
                    ));
                }
                let payload = build_media_payload(
                    relative_path,
                    request,
                    target,
                    kind,
                    format!("Notebook file detected: {relative_path}\ncell_count=0\nwindow=1..0"),
                    1,
                    0,
                    false,
                    None,
                    false,
                    None,
                    json!({
                        "size_bytes": size_bytes,
                        "cell_count": 0,
                        "selected_count": 0,
                        "has_more_cells": false,
                        "next_cell_offset": Value::Null,
                        "selected_cells": [],
                    }),
                );
                return Ok(payload);
            }
            if start_index >= total_cells {
                return Err(ToolExecutionError::new(
                    "range_out_of_bounds",
                    format!(
                        "read offset {} is beyond end of notebook ({} cells)",
                        request.start_line, total_cells
                    ),
                ));
            }
            let requested_limit = request
                .line_limit
                .unwrap_or(READ_NOTEBOOK_DEFAULT_CELLS)
                .min(READ_NOTEBOOK_MAX_CELLS);
            let end_index = start_index.saturating_add(requested_limit).min(total_cells);
            let has_more = end_index < total_cells;
            let next_offset = if has_more { Some(end_index + 1) } else { None };

            let mut preview_rows: Vec<String> = Vec::new();
            let mut selected_cells: Vec<Value> = Vec::new();
            for (index, cell) in cells[start_index..end_index].iter().enumerate() {
                let cell_type = cell
                    .get("cell_type")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let source = truncate_preview(extract_notebook_cell_source(cell).trim(), 160);
                let display_index = start_index + index + 1;
                preview_rows.push(format!("[{}] {} {}", display_index, cell_type, source));
                selected_cells.push(json!({
                    "index": display_index,
                    "cell_type": cell_type,
                    "source_preview": source,
                    "source_chars": extract_notebook_cell_source(cell).chars().count(),
                }));
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
                false,
                None,
                json!({
                    "size_bytes": size_bytes,
                    "cell_count": total_cells,
                    "selected_count": selected_cells.len(),
                    "has_more_cells": has_more,
                    "next_cell_offset": next_offset,
                    "selected_cells": selected_cells,
                }),
            );
            Ok(payload)
        }
        ReadKind::Pdf => {
            let requested_range = parse_pdf_page_range(request.pages.as_deref());
            let total_pages = read_pdf_total_pages(target);
            let extract_plan = compute_pdf_extract_plan(requested_range, total_pages)?;
            let selected_pages = format_pdf_page_range(extract_plan.first_page, extract_plan.last_page);
            let selected_range = Some((extract_plan.first_page, extract_plan.last_page));
            match extract_pdf_text_with_pdftotext(target, selected_range) {
                Ok(extracted_text) => {
                    let embedded_image_count = read_pdf_embedded_image_count(target);
                    if !pdf_has_visible_text(extracted_text.as_str()) {
                        let likely_image_only_pdf = embedded_image_count
                            .map(|count| count > 0)
                            .unwrap_or(false);
                        let mut content = format!(
                            "PDF file detected: {relative_path}\nselected_pages={selected_pages}\nNo extractable text found in selected pages."
                        );
                        if let Some(count) = embedded_image_count {
                            content.push_str(&format!("\nembedded_image_count={count}"));
                        }
                        if likely_image_only_pdf {
                            content.push_str(
                                "\nLikely scanned/image-only PDF. OCR is required to extract text content.",
                            );
                        }
                        if let Some(next_pages) = extract_plan.next_pages.as_ref() {
                            content.push_str(&format!(
                                "\n\n[More PDF pages available. Use pages=\"{}\" to continue.]",
                                next_pages
                            ));
                        }
                        let payload = build_media_payload(
                            relative_path,
                            request,
                            target,
                            kind,
                            content,
                            1,
                            0,
                            false,
                            None,
                            false,
                            None,
                            json!({
                                "size_bytes": size_bytes,
                                "pages": request.pages,
                                "selected_page_range": {
                                    "first_page": extract_plan.first_page,
                                    "last_page": extract_plan.last_page
                                },
                                "selected_pages": selected_pages,
                                "total_pages": total_pages,
                                "total_pages_known": total_pages.is_some(),
                                "has_more_pages": extract_plan.has_more_pages,
                                "next_pages": extract_plan.next_pages,
                                "extract_status": "extracted_no_text",
                                "extractor": "pdftotext",
                                "text_detected": false,
                                "embedded_image_count": embedded_image_count,
                                "likely_image_only_pdf": likely_image_only_pdf,
                                "ocr_guidance": "Run OCR first, then read again.",
                                "read_bytes": 0,
                            }),
                        );
                        return Ok(payload);
                    }
                    let mut text_result = read_text_window_from_content(extracted_text.as_str(), request)?;
                    if let Some(next_pages) = extract_plan.next_pages.as_ref() {
                        text_result.content.push_str(&format!(
                            "\n\n[More PDF pages available. Use pages=\"{}\" to continue.]",
                            next_pages
                        ));
                    }
                    let payload = build_media_payload(
                        relative_path,
                        request,
                        target,
                        kind,
                        text_result.content,
                        text_result.line_start,
                        text_result.line_end,
                        text_result.has_more,
                        text_result.next_offset,
                        text_result.truncated_by.is_some(),
                        text_result.truncated_by,
                        json!({
                            "size_bytes": size_bytes,
                            "pages": request.pages,
                            "selected_page_range": {
                                "first_page": extract_plan.first_page,
                                "last_page": extract_plan.last_page
                            },
                            "selected_pages": selected_pages,
                            "total_pages": total_pages,
                            "total_pages_known": total_pages.is_some(),
                            "has_more_pages": extract_plan.has_more_pages,
                            "next_pages": extract_plan.next_pages,
                            "extract_status": "extracted",
                            "extractor": "pdftotext",
                            "text_detected": true,
                            "embedded_image_count": embedded_image_count,
                            "likely_image_only_pdf": false,
                            "read_bytes": text_result.read_bytes,
                        }),
                    );
                    Ok(payload)
                }
                Err(extract_error) => {
                    let pages_note = request.pages.as_ref().map_or_else(
                        || format!("requested_pages=default({selected_pages})"),
                        |value| format!("requested_pages={value}"),
                    );
                    let extraction_hint =
                        "If pdftotext is unavailable, install poppler (macOS: brew install poppler; Debian/Ubuntu: apt-get install poppler-utils).";
                    let extract_error_message = extract_error.message.clone();
                    let content = format!(
                        "PDF file detected: {relative_path}\n{pages_note}\nselected_pages={selected_pages}\nPDF text extraction unavailable ({})\n{}",
                        extract_error_message, extraction_hint
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
                        false,
                        None,
                        json!({
                            "size_bytes": size_bytes,
                            "pages": request.pages,
                            "selected_page_range": {
                                "first_page": extract_plan.first_page,
                                "last_page": extract_plan.last_page
                            },
                            "selected_pages": selected_pages,
                            "total_pages": total_pages,
                            "total_pages_known": total_pages.is_some(),
                            "has_more_pages": extract_plan.has_more_pages,
                            "next_pages": extract_plan.next_pages,
                            "extract_status": "fallback",
                            "extract_error_class": extract_error.error_class,
                            "extract_error_message": extract_error_message,
                            "extract_guidance": extraction_hint,
                        }),
                    );
                    Ok(payload)
                }
            }
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
