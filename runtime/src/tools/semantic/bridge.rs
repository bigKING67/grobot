fn run_contextweaver_bridge(
    context: &ToolContextResolved,
    payload: &Value,
    meta: &SemanticBridgeRequestMeta,
) -> Result<Value, ToolExecutionError> {
    let bridge_script_path = resolve_bridge_script_path(meta.bridge_script_override)?.ok_or_else(|| {
        ToolExecutionError::new(
            "semantic_tool_unavailable",
            "contextweaver bridge script not found; set GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT",
        )
        .with_data(semantic_error_data(
            "semantic_tool_unavailable",
            meta,
            "resolve_bridge_script",
            None,
        ))
    })?;
    let node_bin = resolve_contextweaver_node_bin()?;
    let payload_text = serde_json::to_string(payload).map_err(|error| {
        let mut data = semantic_error_data_map(
            "semantic_invalid_response",
            meta,
            "serialize_bridge_payload",
            Some(&bridge_script_path),
        );
        data.insert("serde_error".to_string(), json!(error.to_string()));
        ToolExecutionError::new(
            "semantic_invalid_response",
            format!("failed to serialize bridge payload: {error}"),
        )
        .with_data(Value::Object(data))
    })?;

    let output = Command::new(&node_bin)
        .arg(&bridge_script_path)
        .arg(meta.bridge_command)
        .arg("--payload")
        .arg(payload_text)
        .arg("--timeout-ms")
        .arg(meta.timeout_ms.to_string())
        .current_dir(&context.work_dir)
        .output()
        .map_err(|error| {
            let mut data = semantic_error_data_map(
                "semantic_tool_unavailable",
                meta,
                "launch_bridge",
                Some(&bridge_script_path),
            );
            data.insert("node_bin".to_string(), json!(node_bin));
            data.insert("launch_error".to_string(), json!(error.to_string()));
            ToolExecutionError::new(
                "semantic_tool_unavailable",
                format!("failed to launch contextweaver bridge: {error}"),
            )
            .with_data(Value::Object(data))
        })?;
    if !output.status.success() {
        let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parsed_error =
            parse_bridge_error_payload(&stderr_text).or_else(|| parse_bridge_error_payload(&stdout_text));
        if let Some(parsed_error) = parsed_error {
            let mut data = semantic_error_data_map(
                &parsed_error.error_class,
                meta,
                "bridge_exit",
                Some(&bridge_script_path),
            );
            insert_semantic_bridge_output_data(
                &mut data,
                output.status,
                &stdout_text,
                &stderr_text,
            );
            insert_semantic_bridge_error_payload(&mut data, &parsed_error);
            return Err(ToolExecutionError::new(
                &parsed_error.error_class,
                parsed_error.message,
            )
            .with_data(Value::Object(data)));
        }
        let message = if stderr_text.is_empty() {
            if stdout_text.is_empty() {
                "contextweaver bridge command failed".to_string()
            } else {
                truncate_output(stdout_text.clone(), 1_000)
            }
        } else {
            truncate_output(stderr_text.clone(), 1_000)
        };
        let default_error_class = if meta.bridge_command == "prompt-enhancer" {
            "prompt_enhancer_failed"
        } else {
            "semantic_search_failed"
        };
        let mut data = semantic_error_data_map(
            default_error_class,
            meta,
            "bridge_exit",
            Some(&bridge_script_path),
        );
        insert_semantic_bridge_output_data(
            &mut data,
            output.status,
            &stdout_text,
            &stderr_text,
        );
        return Err(
            ToolExecutionError::new(default_error_class, message).with_data(Value::Object(data))
        );
    }
    let stdout_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout_text.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_invalid_response",
            "contextweaver bridge returned empty output",
        )
        .with_data(semantic_error_data(
            "semantic_invalid_response",
            meta,
            "parse_bridge_stdout",
            Some(&bridge_script_path),
        )));
    }
    let parsed: Value = serde_json::from_str(&stdout_text).map_err(|error| {
        let mut data = semantic_error_data_map(
            "semantic_invalid_response",
            meta,
            "parse_bridge_stdout",
            Some(&bridge_script_path),
        );
        data.insert("serde_error".to_string(), json!(error.to_string()));
        insert_semantic_text_preview(&mut data, "stdout_preview", &stdout_text);
        ToolExecutionError::new(
            "semantic_invalid_response",
            format!("contextweaver bridge returned invalid JSON: {error}"),
        )
        .with_data(Value::Object(data))
    })?;
    Ok(parsed)
}

fn parse_bridge_error_payload(raw: &str) -> Option<BridgeErrorPayload> {
    if raw.trim().is_empty() {
        return None;
    }
    for line in raw.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let error_class = parsed
            .get("error_class")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("semantic_search_failed")
            .to_string();
        let message = parsed
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("contextweaver bridge command failed")
            .to_string();
        let details = parsed
            .get("details")
            .or_else(|| parsed.get("error_data"))
            .filter(|value| !value.is_null())
            .cloned();
        return Some(BridgeErrorPayload {
            error_class,
            message,
            details,
        });
    }
    None
}

fn invalid_contextweaver_env_error(key: &str, detail: &str) -> ToolExecutionError {
    ToolExecutionError::new("invalid_tool_arguments", detail.to_string())
        .with_data(json!({
            "diagnostic_kind": "invalid_tool_arguments",
            "env_key": key,
            "source": "semantic.bridge",
            "stage": "resolve_env_control",
            "recovery_hint": "unset the env var to use discovery/defaults, or provide a valid non-empty value"
        }))
}

fn resolve_contextweaver_node_bin() -> Result<String, ToolExecutionError> {
    match env::var("GROBOT_NODE_BIN") {
        Ok(value) => {
            let normalized = value.trim();
            if normalized.is_empty() {
                return Err(invalid_contextweaver_env_error(
                    "GROBOT_NODE_BIN",
                    "GROBOT_NODE_BIN must be a non-empty executable path",
                ));
            }
            Ok(normalized.to_string())
        }
        Err(env::VarError::NotPresent) => Ok("node".to_string()),
        Err(env::VarError::NotUnicode(_)) => Err(invalid_contextweaver_env_error(
            "GROBOT_NODE_BIN",
            "GROBOT_NODE_BIN must be valid unicode",
        )),
    }
}

fn resolve_bridge_script_path(override_path: Option<&str>) -> Result<Option<PathBuf>, ToolExecutionError> {
    if let Some(value) = override_path {
        let normalized = value.trim();
        if normalized.is_empty() {
            return Ok(None);
        }
        let candidate = PathBuf::from(normalized);
        return if candidate.is_file() {
            Ok(Some(candidate))
        } else {
            Ok(None)
        };
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    match env::var("GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT") {
        Ok(value) => {
            let normalized = value.trim();
            if normalized.is_empty() {
                return Err(invalid_contextweaver_env_error(
                    "GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT",
                    "GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT must be a non-empty file path",
                ));
            }
            candidates.push(PathBuf::from(normalized));
        }
        Err(env::VarError::NotPresent) => {}
        Err(env::VarError::NotUnicode(_)) => {
            return Err(invalid_contextweaver_env_error(
                "GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT",
                "GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT must be valid unicode",
            ));
        }
    }
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(
            current_dir
                .join("adapters")
                .join("contextweaver")
                .join("bridge")
                .join("cli.mjs"),
        );
    }
    if let Ok(executable_path) = env::current_exe() {
        for ancestor in executable_path.ancestors().take(8) {
            candidates.push(
                ancestor
                    .join("adapters")
                    .join("contextweaver")
                    .join("bridge")
                    .join("cli.mjs"),
            );
        }
    }
    for candidate in candidates {
        if candidate.is_file() {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}
