fn normalize_attachment_type(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

fn normalize_attachment_source_type(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

fn map_kimi_upload_purpose(attachment_type: &str) -> Option<&'static str> {
    match attachment_type {
        "file" => Some("file-extract"),
        "image" => Some("image"),
        "video" => Some("video"),
        _ => None,
    }
}

fn attachment_invalid_error(
    message: impl Into<String>,
    stage: &str,
    fields: &[(&str, Value)],
) -> ModelExecutionError {
    model_error_with_fields(
        model_diagnostic_error(
            "attachment_invalid",
            message,
            "model.kimi_attachments",
            stage,
            "provide a supported attachment type/source_type and ensure local file paths are readable before retrying",
        ),
        fields,
    )
}

fn upload_kimi_file_from_path(
    client: &Client,
    config: &RuntimeModelConfig,
    source_path: &str,
    purpose: &str,
) -> Result<String, ModelExecutionError> {
    let path = std::path::Path::new(source_path);
    if !path.is_file() {
        return Err(attachment_invalid_error(
            format!("attachment source is not a readable file: {}", path.display()),
            "upload_file_path_validate",
            &[("path", json!(path.display().to_string())), ("purpose", json!(purpose))],
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| "upload.bin".to_string());
    let file = std::fs::File::open(path).map_err(|error| {
        attachment_invalid_error(
            format!("failed to open attachment file {}: {error}", path.display()),
            "upload_file_open",
            &[("path", json!(path.display().to_string())), ("purpose", json!(purpose))],
        )
    })?;
    let file_part = Part::reader(file).file_name(file_name);
    let form = Form::new()
        .part("file", file_part)
        .text("purpose", purpose.to_string());
    let endpoint = format!("{}/files", config.base_url);
    let response = client
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .multipart(form)
        .send()
        .map_err(|error| {
            model_error_with_fields(
                model_request_error(
                    &error,
                    format!("kimi file upload failed: {error}"),
                    "model.kimi_attachments",
                    "upload_file_request",
                    "retry later or verify provider network connectivity and files capability",
                ),
                &[("provider", json!("kimi")), ("purpose", json!(purpose))],
            )
        })?;
    let status = response.status();
    let response_headers = summarize_response_headers_for_diagnostics(response.headers());
    let body = response.text().map_err(|error| {
        model_error_with_fields(
            model_response_read_error(
                format!(
                    "failed to read kimi upload response: {error}; status={}; headers={response_headers}",
                    status.as_u16()
                ),
                "model.kimi_attachments",
                "upload_file_response_read",
            ),
            &[
                ("provider", json!("kimi")),
                ("purpose", json!(purpose)),
                ("http_status", json!(status.as_u16())),
                ("response_headers", json!(response_headers)),
            ],
        )
    })?;
    if !status.is_success() {
        let detail = body.chars().take(240).collect::<String>();
        return Err(model_error_with_fields(
            model_http_error(
                format!("kimi file upload status={} body={detail}", status.as_u16()),
                status,
                detail.as_str(),
                "model.kimi_attachments",
                "upload_file_http_status",
            ),
            &[
                ("provider", json!("kimi")),
                ("purpose", json!(purpose)),
                ("response_headers", json!(response_headers)),
            ],
        ));
    }
    let parsed: Value = serde_json::from_str(&body).map_err(|error| {
        model_error_with_fields(
            model_invalid_json_error(
                format!("invalid kimi upload response json: {error}"),
                "model.kimi_attachments",
                "upload_file_parse_json",
            ),
            &[("provider", json!("kimi")), ("purpose", json!(purpose))],
        )
    })?;
    let file_id = parsed
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            model_error_with_fields(
                model_invalid_response_error(
                    "missing file id in kimi upload response",
                    "model.kimi_attachments",
                    "upload_file_parse_id",
                ),
                &[("provider", json!("kimi")), ("purpose", json!(purpose))],
            )
        })?;
    Ok(file_id.to_string())
}

fn fetch_kimi_file_content(
    client: &Client,
    config: &RuntimeModelConfig,
    file_id: &str,
) -> Result<String, ModelExecutionError> {
    let endpoint = format!("{}/files/{}/content", config.base_url, file_id);
    let response = client
        .get(&endpoint)
        .bearer_auth(&config.api_key)
        .send()
        .map_err(|error| {
            model_error_with_fields(
                model_request_error(
                    &error,
                    format!("kimi file content fetch failed: {error}"),
                    "model.kimi_attachments",
                    "fetch_file_content_request",
                    "retry later or verify provider network connectivity and files capability",
                ),
                &[("provider", json!("kimi")), ("file_id", json!(file_id))],
            )
        })?;
    let status = response.status();
    let response_headers = summarize_response_headers_for_diagnostics(response.headers());
    let body = response.text().map_err(|error| {
        model_error_with_fields(
            model_response_read_error(
                format!(
                    "failed to read kimi file content response: {error}; status={}; headers={response_headers}",
                    status.as_u16()
                ),
                "model.kimi_attachments",
                "fetch_file_content_response_read",
            ),
            &[
                ("provider", json!("kimi")),
                ("file_id", json!(file_id)),
                ("http_status", json!(status.as_u16())),
                ("response_headers", json!(response_headers)),
            ],
        )
    })?;
    if !status.is_success() {
        let detail = body.chars().take(240).collect::<String>();
        return Err(model_error_with_fields(
            model_http_error(
                format!("kimi file content status={} body={detail}", status.as_u16()),
                status,
                detail.as_str(),
                "model.kimi_attachments",
                "fetch_file_content_http_status",
            ),
            &[
                ("provider", json!("kimi")),
                ("file_id", json!(file_id)),
                ("response_headers", json!(response_headers)),
            ],
        ));
    }
    Ok(body)
}
