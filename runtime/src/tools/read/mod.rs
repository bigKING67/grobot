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
}

#[derive(Debug, Default)]
struct ReadCacheStore {
    entries: HashMap<String, ReadCacheEntry>,
    order: VecDeque<String>,
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
            let payload = build_file_unchanged_payload(&relative_path, &request, &cached, mtime_ms);
            return Ok(ToolCallOutput::from_payload(payload));
        }

        let text_result = read_text_window(&target, &request)?;
        let payload = build_text_payload(&relative_path, &request, &text_result, &target);
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
            },
        );
        return Ok(ToolCallOutput::from_payload(payload));
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
