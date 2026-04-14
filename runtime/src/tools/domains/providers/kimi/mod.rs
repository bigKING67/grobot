fn canonical_kimi_tool_name(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace('-', "_")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KimiWebSearchMode {
    BuiltinPreferred,
    BuiltinOnly,
    OfficialOnly,
    Off,
}

fn resolve_kimi_timeout_ms(input: &TurnExecuteInput) -> u64 {
    let from_model = input
        .model_config
        .as_ref()
        .and_then(|config| config.timeout_ms)
        .unwrap_or(15_000);
    from_model.clamp(1_000, 120_000)
}

fn is_kimi_provider(input: &TurnExecuteInput) -> bool {
    let model_config = match input.model_config.as_ref() {
        Some(config) => config,
        None => return false,
    };
    let explicit_kind = model_config
        .provider_kind
        .as_ref()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if explicit_kind == "kimi" {
        return true;
    }
    if explicit_kind == "openai_compatible" || explicit_kind == "openai-compatible" {
        return false;
    }
    let base_url = model_config
        .base_url
        .as_ref()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    base_url.contains("moonshot.cn")
}

fn resolve_kimi_web_search_mode(input: &TurnExecuteInput) -> KimiWebSearchMode {
    let normalized = input
        .model_config
        .as_ref()
        .and_then(|config| config.provider_options.as_ref())
        .and_then(|options| options.kimi.as_ref())
        .and_then(|options| options.web_search_mode.as_ref())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "builtin_preferred".to_string());
    match normalized.as_str() {
        "builtin_only" => KimiWebSearchMode::BuiltinOnly,
        "official_only" => KimiWebSearchMode::OfficialOnly,
        "off" => KimiWebSearchMode::Off,
        _ => KimiWebSearchMode::BuiltinPreferred,
    }
}

fn resolve_kimi_official_allowlist(input: &TurnExecuteInput) -> Vec<String> {
    let from_config = input
        .model_config
        .as_ref()
        .and_then(|config| config.provider_options.as_ref())
        .and_then(|options| options.kimi.as_ref())
        .and_then(|options| options.official_tools_allowlist.clone())
        .unwrap_or_else(|| {
            vec![
                "web-search".to_string(),
                "date".to_string(),
                "fetch".to_string(),
                "rethink".to_string(),
                "code_runner".to_string(),
            ]
        });
    from_config
        .into_iter()
        .map(|item| canonical_kimi_tool_name(&item))
        .filter(|item| !item.is_empty())
        .collect()
}

fn resolve_kimi_allow_file_admin(input: &TurnExecuteInput) -> bool {
    input
        .model_config
        .as_ref()
        .and_then(|config| config.provider_options.as_ref())
        .and_then(|options| options.kimi.as_ref())
        .and_then(|options| options.allow_file_admin)
        .unwrap_or(false)
}

fn resolve_kimi_files_enabled(input: &TurnExecuteInput) -> bool {
    input
        .model_config
        .as_ref()
        .and_then(|config| config.provider_options.as_ref())
        .and_then(|options| options.kimi.as_ref())
        .and_then(|options| options.files_enabled)
        .unwrap_or(true)
}

fn resolve_kimi_formula_map(input: &TurnExecuteInput) -> HashMap<String, String> {
    let mut map = HashMap::new();
    map.insert("web_search".to_string(), "moonshot/web-search:latest".to_string());
    map.insert("date".to_string(), "moonshot/date:latest".to_string());
    map.insert("fetch".to_string(), "moonshot/fetch:latest".to_string());
    map.insert("rethink".to_string(), "moonshot/rethink:latest".to_string());
    map.insert(
        "code_runner".to_string(),
        "moonshot/code_runner:latest".to_string(),
    );
    if let Some(custom) = input
        .model_config
        .as_ref()
        .and_then(|config| config.provider_options.as_ref())
        .and_then(|options| options.kimi.as_ref())
        .and_then(|options| options.official_tool_formulas.as_ref())
    {
        if let Some(mapping) = custom.as_object() {
            for (raw_name, raw_uri) in mapping {
                let tool_name = canonical_kimi_tool_name(raw_name);
                if tool_name.is_empty() {
                    continue;
                }
                let Some(uri) = raw_uri.as_str() else {
                    continue;
                };
                let normalized_uri = uri.trim();
                if normalized_uri.is_empty() {
                    continue;
                }
                map.insert(tool_name, normalized_uri.to_string());
            }
        }
    }
    map
}

fn resolve_kimi_connection(input: &TurnExecuteInput) -> Result<(String, String, u64), ToolExecutionError> {
    let model_config = input.model_config.as_ref().ok_or_else(|| {
        ToolExecutionError::new(
            "config_missing",
            "model_config is required for kimi official tools",
        )
    })?;
    let base_url = model_config
        .base_url
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ToolExecutionError::new(
                "config_missing",
                "model_config.base_url is required for kimi official tools",
            )
        })?;
    let api_key = model_config
        .api_key
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ToolExecutionError::new(
                "config_missing",
                "model_config.api_key is required for kimi official tools",
            )
        })?;
    Ok((
        base_url.trim_end_matches('/').to_string(),
        api_key.to_string(),
        resolve_kimi_timeout_ms(input),
    ))
}

fn run_kimi_builtin_web_search(
    call: &ToolCallInput,
    input: &TurnExecuteInput,
) -> Result<ToolCallOutput, ToolExecutionError> {
    match resolve_kimi_web_search_mode(input) {
        KimiWebSearchMode::OfficialOnly | KimiWebSearchMode::Off => Err(ToolExecutionError::new(
            "tool_disabled",
            "kimi builtin $web_search is disabled by web_search_mode",
        )),
        KimiWebSearchMode::BuiltinPreferred | KimiWebSearchMode::BuiltinOnly => {
            let content = serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string());
            Ok(ToolCallOutput { content })
        }
    }
}

fn run_kimi_formula_tool(
    call: &ToolCallInput,
    input: &TurnExecuteInput,
    formula_uri: &str,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let (base_url, api_key, timeout_ms) = resolve_kimi_connection(input)?;
    let endpoint = format!("{}/formulas/{}/fibers", base_url, formula_uri);
    let body = json!({
        "name": call.name,
        "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string())
    });
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            ToolExecutionError::new(
                "client_init_failed",
                format!("failed to init http client for kimi formula tool: {error}"),
            )
        })?;
    let response = client
        .post(&endpoint)
        .bearer_auth(&api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|error| {
            let class = if error.is_timeout() {
                "upstream_timeout"
            } else if error.is_connect() {
                "upstream_connect_failed"
            } else {
                "upstream_request_failed"
            };
            ToolExecutionError::new(class, format!("kimi formula tool request failed: {error}"))
        })?;
    let status = response.status();
    let body_text = response.text().map_err(|error| {
        ToolExecutionError::new(
            "upstream_response_read_failed",
            format!("failed to read kimi formula tool response: {error}"),
        )
    })?;
    if !status.is_success() {
        let detail = body_text.chars().take(240).collect::<String>();
        return Err(ToolExecutionError::new(
            "upstream_http_error",
            format!(
                "kimi formula tool status={} formula={} body={detail}",
                status.as_u16(),
                formula_uri
            ),
        ));
    }
    let payload: Value = serde_json::from_str(&body_text).map_err(|error| {
        ToolExecutionError::new(
            "upstream_invalid_json",
            format!("invalid kimi formula tool response json: {error}"),
        )
    })?;
    let status_text = payload
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if status_text != "succeeded" {
        let error_text = payload
            .get("error")
            .and_then(Value::as_str)
            .or_else(|| {
                payload
                    .get("context")
                    .and_then(Value::as_object)
                    .and_then(|context| context.get("error"))
                    .and_then(Value::as_str)
            })
            .unwrap_or("unknown kimi formula tool error");
        return Err(ToolExecutionError::new(
            "tool_execution_failed",
            format!("kimi formula tool failed: {}", error_text),
        ));
    }
    let content_value = payload
        .get("context")
        .and_then(Value::as_object)
        .and_then(|context| {
            context
                .get("output")
                .cloned()
                .or_else(|| context.get("encrypted_output").cloned())
        })
        .unwrap_or_else(|| json!({}));
    let content = if let Some(text) = content_value.as_str() {
        text.to_string()
    } else {
        serde_json::to_string(&content_value).unwrap_or_else(|_| "{}".to_string())
    };
    Ok(ToolCallOutput { content })
}

fn run_kimi_files_list(input: &TurnExecuteInput) -> Result<ToolCallOutput, ToolExecutionError> {
    let (base_url, api_key, timeout_ms) = resolve_kimi_connection(input)?;
    let endpoint = format!("{}/files", base_url);
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            ToolExecutionError::new(
                "client_init_failed",
                format!("failed to init http client for kimi files list: {error}"),
            )
        })?;
    let response = client
        .get(&endpoint)
        .bearer_auth(&api_key)
        .send()
        .map_err(|error| {
            let class = if error.is_timeout() {
                "upstream_timeout"
            } else if error.is_connect() {
                "upstream_connect_failed"
            } else {
                "upstream_request_failed"
            };
            ToolExecutionError::new(class, format!("kimi files list request failed: {error}"))
        })?;
    let status = response.status();
    let body = response.text().map_err(|error| {
        ToolExecutionError::new(
            "upstream_response_read_failed",
            format!("failed to read kimi files list response: {error}"),
        )
    })?;
    if !status.is_success() {
        let detail = body.chars().take(240).collect::<String>();
        return Err(ToolExecutionError::new(
            "upstream_http_error",
            format!("kimi files list status={} body={detail}", status.as_u16()),
        ));
    }
    Ok(ToolCallOutput { content: body })
}

fn run_kimi_files_delete(
    call: &ToolCallInput,
    input: &TurnExecuteInput,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let args = value_object(&call.arguments, "kimi_files_delete")?;
    let file_id = get_string_arg(args, "file_id").ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            "kimi_files_delete.file_id is required",
        )
    })?;
    let (base_url, api_key, timeout_ms) = resolve_kimi_connection(input)?;
    let endpoint = format!("{}/files/{}", base_url, file_id);
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            ToolExecutionError::new(
                "client_init_failed",
                format!("failed to init http client for kimi files delete: {error}"),
            )
        })?;
    let response = client
        .delete(&endpoint)
        .bearer_auth(&api_key)
        .send()
        .map_err(|error| {
            let class = if error.is_timeout() {
                "upstream_timeout"
            } else if error.is_connect() {
                "upstream_connect_failed"
            } else {
                "upstream_request_failed"
            };
            ToolExecutionError::new(class, format!("kimi files delete request failed: {error}"))
        })?;
    let status = response.status();
    let body = response.text().map_err(|error| {
        ToolExecutionError::new(
            "upstream_response_read_failed",
            format!("failed to read kimi files delete response: {error}"),
        )
    })?;
    if !status.is_success() {
        let detail = body.chars().take(240).collect::<String>();
        return Err(ToolExecutionError::new(
            "upstream_http_error",
            format!("kimi files delete status={} body={detail}", status.as_u16()),
        ));
    }
    Ok(ToolCallOutput { content: body })
}

fn execute_kimi_tool_call(
    call: &ToolCallInput,
    input: &TurnExecuteInput,
) -> Option<Result<ToolCallOutput, ToolExecutionError>> {
    if !is_kimi_provider(input) {
        return None;
    }
    let normalized_name = canonical_kimi_tool_name(&call.name);
    if call.name.trim() == "$web_search" {
        return Some(run_kimi_builtin_web_search(call, input));
    }
    let web_search_mode = resolve_kimi_web_search_mode(input);
    if normalized_name == "web_search" {
        if matches!(
            web_search_mode,
            KimiWebSearchMode::BuiltinOnly | KimiWebSearchMode::Off
        ) {
            return Some(Err(ToolExecutionError::new(
                "tool_disabled",
                "kimi official web_search is disabled by web_search_mode",
            )));
        }
    }
    if normalized_name == "kimi_files_list" {
        if !resolve_kimi_allow_file_admin(input) {
            return Some(Err(ToolExecutionError::new(
                "tool_disabled",
                "kimi file admin operations are disabled",
            )));
        }
        if !resolve_kimi_files_enabled(input) {
            return Some(Err(ToolExecutionError::new(
                "tool_disabled",
                "kimi file capability is disabled",
            )));
        }
        return Some(run_kimi_files_list(input));
    }
    if normalized_name == "kimi_files_delete" {
        if !resolve_kimi_allow_file_admin(input) {
            return Some(Err(ToolExecutionError::new(
                "tool_disabled",
                "kimi file admin operations are disabled",
            )));
        }
        if !resolve_kimi_files_enabled(input) {
            return Some(Err(ToolExecutionError::new(
                "tool_disabled",
                "kimi file capability is disabled",
            )));
        }
        return Some(run_kimi_files_delete(call, input));
    }
    let allowlist = resolve_kimi_official_allowlist(input);
    if !allowlist.iter().any(|item| item == &normalized_name) {
        return None;
    }
    let formulas = resolve_kimi_formula_map(input);
    let formula_uri = formulas.get(&normalized_name).cloned().or_else(|| {
        if normalized_name == "web_search" {
            Some("moonshot/web-search:latest".to_string())
        } else {
            None
        }
    });
    let Some(uri) = formula_uri else {
        return Some(Err(ToolExecutionError::new(
            "tool_call_not_supported",
            format!("no formula uri configured for kimi official tool: {}", call.name),
        )));
    };
    Some(run_kimi_formula_tool(call, input, &uri))
}
