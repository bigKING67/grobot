fn parse_positive_usize_arg(
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<usize>, ToolExecutionError> {
    let Some(raw_value) = args.get(key) else {
        return Ok(None);
    };
    let Some(parsed) = raw_value.as_u64() else {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("read.{key} must be an integer"),
        ));
    };
    if parsed == 0 {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("read.{key} must be >= 1"),
        ));
    }
    if parsed > usize::MAX as u64 {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("read.{key} is too large"),
        ));
    }
    Ok(Some(parsed as usize))
}

fn validate_pdf_pages_argument(raw_pages: &str) -> Result<(), ToolExecutionError> {
    let trimmed = raw_pages.trim();
    if trimmed.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "read.pages must not be empty",
        ));
    }

    let (first_page, last_page) = if let Some((first, last)) = trimmed.split_once('-') {
        let first_page = first.trim().parse::<usize>().ok();
        let last_page = last.trim().parse::<usize>().ok();
        match (first_page, last_page) {
            (Some(first_page), Some(last_page)) => (first_page, last_page),
            _ => {
                return Err(ToolExecutionError::new(
                    "invalid_tool_arguments",
                    "read.pages format must be like \"3\" or \"3-5\"",
                ))
            }
        }
    } else {
        let Some(page) = trimmed.parse::<usize>().ok() else {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                "read.pages format must be like \"3\" or \"3-5\"",
            ));
        };
        (page, page)
    };

    if first_page == 0 || last_page == 0 {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "read.pages must be 1-indexed and >= 1",
        ));
    }
    if last_page < first_page {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "read.pages last page must be >= first page",
        ));
    }
    let page_count = last_page.saturating_sub(first_page).saturating_add(1);
    if page_count > READ_PDF_MAX_PAGES {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("read.pages exceeds max range of {READ_PDF_MAX_PAGES} pages"),
        ));
    }
    Ok(())
}

fn parse_read_request(args: &Map<String, Value>) -> Result<ReadRequest, ToolExecutionError> {
    for key in args.keys() {
        if key != "path"
            && key != "line_start"
            && key != "line_end"
            && key != "offset"
            && key != "limit"
            && key != "pages"
            && key != "include_metadata"
        {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported read argument: {key}"),
            ));
        }
    }

    let path = parse_required_string_arg(args, TOOL_READ, "path", "read.path is required")?;

    let include_metadata = get_bool_arg(args, TOOL_READ, "include_metadata", true)?;
    let pages = parse_optional_string_arg(args, TOOL_READ, "pages")?;
    if let Some(value) = pages.as_deref() {
        validate_pdf_pages_argument(value)?;
    }

    let has_legacy_range = args.contains_key("line_start") || args.contains_key("line_end");
    let has_offset_range = args.contains_key("offset") || args.contains_key("limit");
    if has_legacy_range && has_offset_range {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "read.line_start/line_end and read.offset/limit cannot be used together",
        ));
    }

    let line_start = parse_positive_usize_arg(args, "line_start")?;
    let line_end = parse_positive_usize_arg(args, "line_end")?;
    let offset = parse_positive_usize_arg(args, "offset")?;
    let limit = parse_positive_usize_arg(args, "limit")?;

    if has_legacy_range {
        let start_line = line_start.unwrap_or(1);
        let line_limit = line_end
            .map(|end| end.max(start_line))
            .map(|end| end.saturating_sub(start_line).saturating_add(1));
        return Ok(ReadRequest {
            path,
            start_line,
            line_limit,
            include_metadata,
            pages,
            range_mode: "legacy",
        });
    }

    Ok(ReadRequest {
        path,
        start_line: offset.unwrap_or(1),
        line_limit: limit,
        include_metadata,
        pages,
        range_mode: if has_offset_range { "offset" } else { "full" },
    })
}
