const READ_MAX_OUTPUT_LINES: usize = 2000;
const READ_MAX_OUTPUT_BYTES: usize = 50 * 1024;
const READ_CACHE_MAX_ENTRIES: usize = 256;
const READ_PDF_MAX_PAGES: usize = 20;
const READ_PDF_OCR_MAX_PAGES: usize = 5;
const READ_NOTEBOOK_DEFAULT_CELLS: usize = 20;
const READ_NOTEBOOK_MAX_CELLS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadKind {
    Text,
    Notebook,
    Pdf,
    Image,
    Video,
}

impl ReadKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Notebook => "notebook",
            Self::Pdf => "pdf",
            Self::Image => "image",
            Self::Video => "video",
        }
    }
}

#[derive(Debug, Clone)]
struct ReadRequest {
    path: String,
    start_line: usize,
    line_limit: Option<usize>,
    include_metadata: bool,
    pages: Option<String>,
    range_mode: &'static str,
}

#[derive(Debug, Clone)]
struct ReadTextResult {
    content: String,
    line_start: usize,
    line_end: usize,
    has_more: bool,
    next_offset: Option<usize>,
    truncated_by: Option<&'static str>,
    read_bytes: usize,
}

#[derive(Debug, Clone)]
struct ReadCacheEntry {
    mtime_ms: u128,
    line_start: usize,
    line_limit: Option<usize>,
    line_end: usize,
    has_more: bool,
    next_offset: Option<usize>,
    kind: &'static str,
    content_hash: Option<u64>,
    size_bytes: u64,
    read_bytes: usize,
    line_ending: &'static str,
    bom_detected: bool,
    full_view: bool,
}

#[derive(Debug, Default)]
struct ReadCacheStore {
    entries: HashMap<String, ReadCacheEntry>,
    order: VecDeque<String>,
}

fn is_full_text_read_for_write(request: &ReadRequest, has_more: bool) -> bool {
    request.range_mode == "full" && request.line_limit.is_none() && !has_more
}

fn should_try_small_file_full_read_for_hash(request: &ReadRequest, target: &Path) -> bool {
    if request.range_mode != "full" || request.line_limit.is_some() || request.start_line != 1 {
        return false;
    }
    let Ok(metadata) = fs::metadata(target) else {
        return false;
    };
    metadata.len() <= READ_MAX_OUTPUT_BYTES as u64
}

fn read_text_window_with_guard_hash(
    target: &Path,
    request: &ReadRequest,
) -> Result<(ReadTextResult, Option<u64>, TextFormatMetadata), ToolExecutionError> {
    if !should_try_small_file_full_read_for_hash(request, target) {
        let text_result = read_text_window(target, request)?;
        let text_format = inspect_text_file_format(target)?;
        return Ok((text_result, None, text_format));
    }

    let file_bytes = fs::read(target)
        .map_err(|error| ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}")))?;
    let file_content = String::from_utf8(file_bytes).map_err(|_| {
        ToolExecutionError::new(
            "binary_file_not_supported",
            "read only supports utf-8 text files",
        )
    })?;
    let text_format = inspect_text_content_format(file_content.as_str());
    let text_result = read_text_window_from_content(file_content.as_str(), request)?;
    let content_hash = if is_full_text_read_for_write(request, text_result.has_more) {
        Some(hash_write_guard_text(file_content.as_str()))
    } else {
        None
    };
    Ok((text_result, content_hash, text_format))
}

fn run_read(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    input: &TurnExecuteInput,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let request = parse_read_request(args)?;
    let target = resolve_read_target(context, &request.path)?;
    let relative_path = relative_to_work_dir(&context.work_dir, &target);
    let kind = classify_read_kind(&target);

    if request.pages.is_some() && kind != ReadKind::Pdf {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "read.pages is only supported for PDF files",
        ));
    }

    if kind == ReadKind::Text {
        ensure_text_read_allowed(&target)?;
        let mtime_ms = read_file_mtime_ms(&target)?;
        let cache_key = build_read_cache_key(context.session_key.as_str(), &target, &request);
        if let Some(cached) = lookup_read_cache(&cache_key, mtime_ms) {
            let full_view = is_full_text_read_for_write(&request, cached.has_more);
            let content_hash = if full_view {
                match cached.content_hash {
                    Some(value) => Some(value),
                    None => Some(compute_write_guard_hash_for_file(&target)?),
                }
            } else {
                None
            };
            record_write_read_snapshot(
                context.session_key.as_str(),
                &target,
                mtime_ms,
                full_view,
                content_hash,
            );
            let payload = build_file_unchanged_payload(&relative_path, &request, &cached, mtime_ms);
            return Ok(ToolCallOutput::from_payload(payload));
        }

        let (text_result, precomputed_content_hash, text_format) =
            read_text_window_with_guard_hash(&target, &request)?;
        let full_view = is_full_text_read_for_write(&request, text_result.has_more);
        let payload = build_text_payload(&relative_path, &request, &text_result, &target, text_format, full_view);
        let content_hash = if full_view {
            match precomputed_content_hash {
                Some(value) => Some(value),
                None => Some(compute_write_guard_hash_for_file(&target)?),
            }
        } else {
            None
        };
        store_read_cache(
            cache_key,
            ReadCacheEntry {
                mtime_ms,
                line_start: text_result.line_start,
                line_limit: request.line_limit,
                line_end: text_result.line_end,
                has_more: text_result.has_more,
                next_offset: text_result.next_offset,
                kind: "text",
                content_hash,
                size_bytes: file_size_for_meta(&target),
                read_bytes: text_result.read_bytes,
                line_ending: text_format.line_ending,
                bom_detected: text_format.bom_detected,
                full_view,
            },
        );
        record_write_read_snapshot(
            context.session_key.as_str(),
            &target,
            mtime_ms,
            full_view,
            content_hash,
        );
        return Ok(ToolCallOutput::from_payload(payload));
    }

    if matches!(kind, ReadKind::Pdf | ReadKind::Image | ReadKind::Video) && is_kimi_provider(input) {
        if !is_kimi_k25_read_route(input) {
            return Err(ToolExecutionError::new(
                "config_missing",
                "kimi media read requires model kimi-k2.5",
            ));
        }
        if !resolve_kimi_files_enabled(input) {
            return Err(ToolExecutionError::new(
                "config_missing",
                "kimi media read requires provider_options.kimi.files_enabled=true",
            ));
        }
    }

    if let Some(payload) = maybe_read_media_payload_via_kimi(
        kind,
        &target,
        &relative_path,
        &request,
        input,
    )? {
        return Ok(ToolCallOutput::from_payload(payload));
    }

    let payload = read_media_payload(kind, &target, &relative_path, &request)?;
    Ok(ToolCallOutput::from_payload(payload))
}

include!("request.rs");
include!("guard.rs");
include!("cache.rs");
include!("text.rs");
include!("media.rs");
include!("output.rs");
