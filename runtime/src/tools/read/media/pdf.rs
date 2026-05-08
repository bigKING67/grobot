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

fn read_pdf_embedded_image_count(target: &Path, page_range: Option<(usize, usize)>) -> Option<usize> {
    if !command_available("pdfimages") {
        return None;
    }
    let mut command = Command::new("pdfimages");
    command.arg("-list");
    if let Some((first_page, last_page)) = page_range {
        command
            .arg("-f")
            .arg(first_page.to_string())
            .arg("-l")
            .arg(last_page.to_string());
    }
    let output = command.arg(target).output().ok()?;
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
            )
            .with_data(json!({
                "diagnostic_kind": "range_out_of_bounds",
                "range_kind": "pdf_page",
                "requested_page": first_page,
                "available_count": total,
                "max_window_pages": READ_PDF_MAX_PAGES,
                "recovery_hint": "retry with read.pages inside the reported page count"
            })));
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

fn should_attempt_pdf_ocr(likely_image_only_pdf: bool, selected_page_count: usize) -> bool {
    likely_image_only_pdf && selected_page_count <= READ_PDF_OCR_MAX_PAGES
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

fn extract_pdf_text_with_ocr(
    target: &Path,
    first_page: usize,
    last_page: usize,
) -> Result<String, ToolExecutionError> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_dir = env::temp_dir().join(format!(
        "grobot-read-ocr-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&temp_dir).map_err(|error| {
        ToolExecutionError::new(
            "pdf_ocr_failed",
            format!("failed to create OCR temp dir: {error}"),
        )
    })?;
    let output_prefix = temp_dir.join("page");

    let pdftoppm_output = Command::new("pdftoppm")
        .arg("-f")
        .arg(first_page.to_string())
        .arg("-l")
        .arg(last_page.to_string())
        .arg("-r")
        .arg("200")
        .arg("-png")
        .arg(target)
        .arg(&output_prefix)
        .output()
        .map_err(|error| {
            ToolExecutionError::new(
                "pdf_ocr_failed",
                format!("failed to execute pdftoppm: {error}"),
            )
        })?;

    if !pdftoppm_output.status.success() {
        let stderr = String::from_utf8_lossy(&pdftoppm_output.stderr)
            .trim()
            .to_string();
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(ToolExecutionError::new(
            "pdf_ocr_failed",
            format!("pdftoppm failed: {}", if stderr.is_empty() { "unknown error" } else { stderr.as_str() }),
        ));
    }

    let mut images = fs::read_dir(&temp_dir)
        .map_err(|error| {
            ToolExecutionError::new(
                "pdf_ocr_failed",
                format!("failed to list OCR temp dir: {error}"),
            )
        })?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            if !name.starts_with("page-") || !name.ends_with(".png") {
                return None;
            }
            Some(path)
        })
        .collect::<Vec<PathBuf>>();
    images.sort();

    if images.is_empty() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(ToolExecutionError::new(
            "pdf_ocr_failed",
            "pdftoppm produced no page images for OCR",
        ));
    }

    let mut chunks: Vec<String> = Vec::new();
    for (index, image_path) in images.iter().enumerate() {
        let tesseract_output = Command::new("tesseract")
            .arg(image_path)
            .arg("stdout")
            .output()
            .map_err(|error| {
                ToolExecutionError::new(
                    "pdf_ocr_failed",
                    format!("failed to execute tesseract: {error}"),
                )
            })?;
        if !tesseract_output.status.success() {
            let stderr = String::from_utf8_lossy(&tesseract_output.stderr)
                .trim()
                .to_string();
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(ToolExecutionError::new(
                "pdf_ocr_failed",
                format!(
                    "tesseract failed: {}",
                    if stderr.is_empty() { "unknown error" } else { stderr.as_str() }
                ),
            ));
        }
        let chunk = String::from_utf8_lossy(&tesseract_output.stdout).to_string();
        if !pdf_has_visible_text(chunk.as_str()) {
            continue;
        }
        let page_no = first_page.saturating_add(index);
        chunks.push(format!("[OCR page {page_no}]\n{}", chunk.trim()));
    }

    let _ = fs::remove_dir_all(&temp_dir);

    if chunks.is_empty() {
        return Ok(String::new());
    }
    Ok(chunks.join("\n\n"))
}

fn collect_missing_pdf_extract_tools() -> Vec<&'static str> {
    let mut missing = Vec::new();
    if !command_available("pdftotext") {
        missing.push("pdftotext");
    }
    if !command_available("pdftoppm") {
        missing.push("pdftoppm");
    }
    if !command_available("tesseract") {
        missing.push("tesseract");
    }
    missing
}

fn build_pdf_extract_guidance(missing_tools: &[&str]) -> String {
    if missing_tools.is_empty() {
        return "Install poppler + tesseract if scanned PDF OCR is needed (macOS: brew install poppler tesseract; Debian/Ubuntu: apt-get install poppler-utils tesseract-ocr).".to_string();
    }
    let missing_list = missing_tools.join(", ");
    format!(
        "Missing runtime tools: {missing_list}. Install poppler + tesseract (macOS: brew install poppler tesseract; Debian/Ubuntu: apt-get install poppler-utils tesseract-ocr)."
    )
}
