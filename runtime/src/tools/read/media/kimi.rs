fn is_kimi_k25_read_route(input: &TurnExecuteInput) -> bool {
    if !matches!(is_kimi_provider(input), Ok(true)) {
        return false;
    }
    let model = input
        .model_config
        .as_ref()
        .and_then(|config| config.model.as_ref())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if model.is_empty() {
        return false;
    }
    model.contains("k2.5") || model.contains("k2_5")
}

fn resolve_kimi_model_name_for_read(input: &TurnExecuteInput) -> String {
    input
        .model_config
        .as_ref()
        .and_then(|config| config.model.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("kimi-k2.5")
        .to_string()
}

fn should_use_kimi_multimodal_read(
    kind: ReadKind,
    request: &ReadRequest,
    input: &TurnExecuteInput,
) -> bool {
    if !is_kimi_k25_read_route(input) {
        return false;
    }
    if !resolve_kimi_files_enabled(input) {
        return false;
    }
    match kind {
        ReadKind::Pdf => {
            let _ = request;
            true
        }
        ReadKind::Image | ReadKind::Video => true,
        _ => false,
    }
}

fn guess_read_upload_mime(target: &Path, kind: ReadKind) -> &'static str {
    match kind {
        ReadKind::Pdf => "application/pdf",
        ReadKind::Image => match target
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "svg" => "image/svg+xml",
            _ => "image/png",
        },
        ReadKind::Video => match target
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "mov" => "video/quicktime",
            "webm" => "video/webm",
            "m4v" => "video/x-m4v",
            "avi" => "video/x-msvideo",
            "mkv" => "video/x-matroska",
            _ => "video/mp4",
        },
        _ => "application/octet-stream",
    }
}

fn upload_kimi_file_for_read(
    client: &Client,
    base_url: &str,
    api_key: &str,
    target: &Path,
    purpose: &str,
    mime: &str,
) -> Result<String, ToolExecutionError> {
    let file_bytes = fs::read(target).map_err(|error| {
        file_io_error(
            format!("failed to read file for kimi upload: {error}"),
            target,
            None,
            "read.kimi_media",
            "read_upload_file",
            "confirm the media file still exists and is readable before retrying remote extraction",
        )
    })?;
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "read-upload.bin".to_string());
    let endpoint = format!("{}/files", base_url.trim_end_matches('/'));
    let part = reqwest::blocking::multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str(mime)
        .map_err(|error| {
            kimi_tool_error_with_fields(
                kimi_tool_error(
                    "invalid_tool_arguments",
                    format!("invalid mime for kimi upload: {mime} ({error})"),
                    "invalid_tool_arguments",
                    "read.kimi_media",
                    "build_upload_part",
                    "use a supported MIME type for the media kind and retry",
                ),
                &[("mime", json!(mime))],
            )
        })?;
    let form = reqwest::blocking::multipart::Form::new()
        .part("file", part)
        .text("purpose", purpose.to_string());
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .map_err(|error| {
            kimi_request_error(
                &error,
                format!("kimi file upload failed: {error}"),
                "read.kimi_media",
                "upload_file_request",
                "retry later or verify provider network connectivity and files capability",
            )
        })?;
    let status = response.status();
    let body_text = response.text().map_err(|error| {
        kimi_response_read_error(
            format!("failed to read kimi upload response: {error}"),
            "read.kimi_media",
            "upload_file_response_read",
        )
    })?;
    if !status.is_success() {
        let detail = body_text.chars().take(240).collect::<String>();
        return Err(kimi_http_error(
            format!("kimi file upload status={} body={detail}", status.as_u16()),
            status,
            detail.as_str(),
            "read.kimi_media",
            "upload_file_http_status",
        ));
    }
    let payload: Value = serde_json::from_str(&body_text).map_err(|error| {
        kimi_invalid_json_error(
            format!("invalid kimi upload response json: {error}"),
            "read.kimi_media",
            "upload_file_parse_json",
        )
    })?;
    payload
        .get("id")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            kimi_invalid_response_error(
                "missing file id in kimi upload response",
                "read.kimi_media",
                "upload_file_parse_id",
            )
        })
}

fn fetch_kimi_file_content_for_read(
    client: &Client,
    base_url: &str,
    api_key: &str,
    file_id: &str,
) -> Result<String, ToolExecutionError> {
    let endpoint = format!(
        "{}/files/{}/content",
        base_url.trim_end_matches('/'),
        file_id
    );
    let response = client
        .get(endpoint)
        .bearer_auth(api_key)
        .send()
        .map_err(|error| {
            kimi_request_error(
                &error,
                format!("kimi file content fetch failed: {error}"),
                "read.kimi_media",
                "fetch_file_content_request",
                "retry later or verify provider network connectivity and files capability",
            )
        })?;
    let status = response.status();
    let body_text = response.text().map_err(|error| {
        kimi_response_read_error(
            format!("failed to read kimi file content response: {error}"),
            "read.kimi_media",
            "fetch_file_content_response_read",
        )
    })?;
    if !status.is_success() {
        let detail = body_text.chars().take(240).collect::<String>();
        return Err(kimi_tool_error_with_fields(
            kimi_http_error(
                format!("kimi file content status={} body={detail}", status.as_u16()),
                status,
                detail.as_str(),
                "read.kimi_media",
                "fetch_file_content_http_status",
            ),
            &[("file_id", json!(file_id))],
        ));
    }
    Ok(body_text)
}

#[derive(Debug, Clone)]
struct KimiFileExtractParseResult {
    text: String,
    content_source: &'static str,
    file_type: Option<String>,
    filename: Option<String>,
    title: Option<String>,
    was_json_payload: bool,
}

fn extract_text_from_json_value(value: &Value) -> Option<String> {
    match value {
        Value::String(raw) => Some(raw.to_string()),
        Value::Array(items) => {
            let merged = items
                .iter()
                .filter_map(extract_text_from_json_value)
                .filter(|item| !item.trim().is_empty())
                .collect::<Vec<String>>();
            if merged.is_empty() {
                return None;
            }
            Some(merged.join("\n"))
        }
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(extract_text_from_json_value) {
                return Some(text);
            }
            map.get("content").and_then(extract_text_from_json_value)
        }
        _ => None,
    }
}

fn parse_kimi_file_extract_response(body_text: &str) -> KimiFileExtractParseResult {
    let mut parsed = KimiFileExtractParseResult {
        text: body_text.to_string(),
        content_source: "plain_text",
        file_type: None,
        filename: None,
        title: None,
        was_json_payload: false,
    };

    let Ok(payload) = serde_json::from_str::<Value>(body_text) else {
        return parsed;
    };
    parsed.was_json_payload = true;

    if let Some(object) = payload.as_object() {
        if let Some(content) = object.get("content").and_then(extract_text_from_json_value) {
            parsed.text = content;
            parsed.content_source = "json.content";
        } else if let Some(text) = object.get("text").and_then(extract_text_from_json_value) {
            parsed.text = text;
            parsed.content_source = "json.text";
        } else if let Some(content) = extract_text_from_json_value(&payload) {
            parsed.text = content;
            parsed.content_source = "json.fallback";
        }
        parsed.file_type = object
            .get("file_type")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        parsed.filename = object
            .get("filename")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        parsed.title = object
            .get("title")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        return parsed;
    }

    if let Some(content) = extract_text_from_json_value(&payload) {
        parsed.text = content;
        parsed.content_source = "json.value";
    }
    parsed
}

fn parse_kimi_chat_text_response(body_text: &str) -> Result<String, ToolExecutionError> {
    let payload: Value = serde_json::from_str(body_text).map_err(|error| {
        kimi_invalid_json_error(
            format!("invalid kimi chat response json: {error}"),
            "read.kimi_media",
            "chat_parse_json",
        )
    })?;
    let content_value = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("message"))
        .and_then(|message| message.get("content"))
        .cloned()
        .ok_or_else(|| {
            kimi_invalid_response_error(
                "missing choices[0].message.content in kimi chat response",
                "read.kimi_media",
                "chat_parse_content",
            )
        })?;
    if let Some(text) = content_value.as_str() {
        return Ok(text.to_string());
    }
    if let Some(items) = content_value.as_array() {
        let merged = items
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
            })
            .collect::<Vec<String>>()
            .join("\n");
        return Ok(merged);
    }
    Err(kimi_invalid_response_error(
        "unsupported kimi chat message.content payload",
        "read.kimi_media",
        "chat_parse_content_type",
    ))
}

fn run_kimi_multimodal_extract_for_read(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    kind: ReadKind,
    media_url: &str,
) -> Result<String, ToolExecutionError> {
    let mut user_parts = vec![json!({
        "type": "text",
        "text": "Extract all useful information from this media. Return plain text only, include visible text and key structured fields."
    })];
    match kind {
        ReadKind::Image => user_parts.push(json!({
            "type": "image_url",
            "image_url": { "url": media_url }
        })),
        ReadKind::Video => user_parts.push(json!({
            "type": "video_url",
            "video_url": { "url": media_url }
        })),
        _ => {
            return Err(ToolExecutionError::new(
                "tool_execution_failed",
                "kimi multimodal extract only supports image/video",
            )
            .with_data(json!({
                "diagnostic_kind": "read_internal_state_error",
                "source": "read.kimi_media",
                "stage": "multimodal_kind_dispatch",
                "kind": kind.as_str(),
                "recovery_hint": "report this internal routing bug with the read payload and media kind"
            })))
        }
    }
    let body = json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": user_parts
            }
        ]
    });
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|error| {
            kimi_request_error(
                &error,
                format!("kimi multimodal chat request failed: {error}"),
                "read.kimi_media",
                "chat_request",
                "retry later or verify provider network connectivity and multimodal support",
            )
        })?;
    let status = response.status();
    let body_text = response.text().map_err(|error| {
        kimi_response_read_error(
            format!("failed to read kimi multimodal chat response: {error}"),
            "read.kimi_media",
            "chat_response_read",
        )
    })?;
    if !status.is_success() {
        let detail = body_text.chars().take(240).collect::<String>();
        return Err(kimi_tool_error_with_fields(
            kimi_http_error(
                format!("kimi multimodal chat status={} body={detail}", status.as_u16()),
                status,
                detail.as_str(),
                "read.kimi_media",
                "chat_http_status",
            ),
            &[
                ("kind", json!(kind.as_str())),
                ("model", json!(model)),
                ("media_url", json!(media_url)),
            ],
        ));
    }
    parse_kimi_chat_text_response(&body_text)
}

fn maybe_read_media_payload_via_kimi(
    kind: ReadKind,
    target: &Path,
    relative_path: &str,
    request: &ReadRequest,
    input: &TurnExecuteInput,
) -> Result<Option<Value>, ToolExecutionError> {
    if !should_use_kimi_multimodal_read(kind, request, input) {
        return Ok(None);
    }
    let metadata = fs::metadata(target).map_err(|error| {
        file_io_error(
            format!("failed to read file metadata: {error}"),
            target,
            Some(relative_path),
            "read.kimi_media",
            "read_metadata",
            "confirm the media target still exists and is readable, then retry",
        )
    })?;
    let size_bytes = metadata.len();
    let (base_url, api_key, timeout_ms) = resolve_kimi_connection(input)?;
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            kimi_client_init_error(
                format!("failed to init http client for kimi read route: {error}"),
                "read.kimi_media",
                "read_route_client_init",
            )
        })?;
    let remote_model = resolve_kimi_model_name_for_read(input);
    match kind {
        ReadKind::Pdf => {
            if request.pages.is_some() {
                return Err(ToolExecutionError::new(
                    "invalid_tool_arguments",
                    "read.pages is not supported in kimi remote pdf mode; remove pages and use offset/limit on extracted text",
                ));
            }
            let file_id = upload_kimi_file_for_read(
                &client,
                &base_url,
                &api_key,
                target,
                "file-extract",
                guess_read_upload_mime(target, kind),
            )?;
            let extracted_raw = fetch_kimi_file_content_for_read(&client, &base_url, &api_key, &file_id)?;
            let extracted_parse = parse_kimi_file_extract_response(extracted_raw.as_str());
            let extracted = extracted_parse.text;
            if !pdf_has_visible_text(extracted.as_str()) {
                let payload = build_media_payload(
                    relative_path,
                    request,
                    target,
                    kind,
                    format!(
                        "PDF file detected: {relative_path}\nKimi file-extract returned no visible text.\nfile_id={file_id}\ncontent_source={}\nTry improving source quality or re-exporting PDF with searchable text.",
                        extracted_parse.content_source
                    ),
                    1,
                    0,
                    false,
                    None,
                    false,
                    None,
                    json!({
                        "size_bytes": size_bytes,
                        "extract_status": "extracted_no_text_remote",
                        "extractor": "kimi-files-content",
                        "remote_provider": "kimi",
                        "remote_model": remote_model,
                        "remote_file_id": file_id,
                        "remote_content_source": extracted_parse.content_source,
                        "remote_response_is_json": extracted_parse.was_json_payload,
                        "remote_file_type": extracted_parse.file_type,
                        "remote_filename": extracted_parse.filename,
                        "remote_title": extracted_parse.title,
                        "text_detected": false,
                    }),
                );
                return Ok(Some(payload));
            }
            let text_result = read_text_window_from_content(extracted.as_str(), request)?;
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
                    "extract_status": "extracted_remote_kimi_file_extract",
                    "extractor": "kimi-files-content",
                    "remote_provider": "kimi",
                    "remote_model": remote_model,
                    "remote_file_id": file_id,
                    "remote_content_source": extracted_parse.content_source,
                    "remote_response_is_json": extracted_parse.was_json_payload,
                    "remote_file_type": extracted_parse.file_type,
                    "remote_filename": extracted_parse.filename,
                    "remote_title": extracted_parse.title,
                    "text_detected": true,
                    "read_bytes": text_result.read_bytes,
                }),
            );
            Ok(Some(payload))
        }
        ReadKind::Image | ReadKind::Video => {
            let purpose = if kind == ReadKind::Image { "image" } else { "video" };
            let file_id = upload_kimi_file_for_read(
                &client,
                &base_url,
                &api_key,
                target,
                purpose,
                guess_read_upload_mime(target, kind),
            )?;
            let media_url = format!("ms://{file_id}");
            let mut extracted = run_kimi_multimodal_extract_for_read(
                &client,
                &base_url,
                &api_key,
                remote_model.as_str(),
                kind,
                media_url.as_str(),
            )?;
            let text_detected = pdf_has_visible_text(extracted.as_str());
            if !text_detected {
                extracted = "Kimi multimodal extraction returned empty content.".to_string();
            }
            let text_result = read_text_window_from_content(extracted.as_str(), request)?;
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
                    "extract_status": "extracted_remote_kimi_multimodal",
                    "extractor": "kimi-chat-completions",
                    "remote_provider": "kimi",
                    "remote_model": remote_model,
                    "remote_file_id": file_id,
                    "remote_media_url": media_url,
                    "text_detected": text_detected,
                    "read_bytes": text_result.read_bytes,
                }),
            );
            Ok(Some(payload))
        }
        _ => Ok(None),
    }
}
