fn semantic_recovery_hint(error_class: &str) -> &'static str {
    match error_class {
        "semantic_no_source_available" => {
            "choose an available source or create/index memory, wiki, or code roots before retrying"
        }
        "semantic_tool_unavailable" => {
            "fix the ContextWeaver bridge path or node runtime before retrying semantic tooling"
        }
        "semantic_index_config_invalid" => {
            "fix cwconfig.json includePatterns, then rerun `cw index <repo-path>` before retrying semantic tooling"
        }
        "semantic_index_confirmation_required" => {
            "run `cw index <repo-path>` manually, preview the matched scope, and confirm indexing"
        }
        "semantic_index_required" => {
            "initialize the semantic index with `cw index <repo-path>` before retrying semantic tooling"
        }
        "semantic_config_missing" => {
            "configure retrieval credentials/base URL/model, or switch to search/glob fallback"
        }
        "semantic_invalid_response" => {
            "inspect bridge stdout/stderr and fix the bridge output contract before retrying"
        }
        _ => "inspect the semantic bridge error and switch to search/glob fallback if needed",
    }
}

fn semantic_source_roots_preview(source_roots: &[Value]) -> Vec<Value> {
    source_roots
        .iter()
        .filter_map(|row| {
            let object = row.as_object()?;
            let source = object.get("source").and_then(Value::as_str)?.trim();
            let root_path = object.get("rootPath").and_then(Value::as_str)?.trim();
            if source.is_empty() || root_path.is_empty() {
                return None;
            }
            Some(json!({
                "source": source,
                "rootPath": root_path,
            }))
        })
        .take(SEMANTIC_ERROR_SOURCE_ROOT_PREVIEW_LIMIT)
        .collect()
}

fn semantic_error_data_map(
    diagnostic_kind: &str,
    meta: &SemanticBridgeRequestMeta,
    operation: &str,
    bridge_script_path: Option<&Path>,
) -> Map<String, Value> {
    let mut data = Map::new();
    data.insert("diagnostic_kind".to_string(), json!(diagnostic_kind));
    data.insert("tool".to_string(), json!(meta.tool_name));
    data.insert("bridge_command".to_string(), json!(meta.bridge_command));
    data.insert("operation".to_string(), json!(operation));
    data.insert("requested_sources".to_string(), json!(meta.requested_sources));
    data.insert("source_roots_count".to_string(), json!(meta.source_roots.len()));
    data.insert(
        "source_roots_preview".to_string(),
        Value::Array(semantic_source_roots_preview(meta.source_roots)),
    );
    data.insert("timeout_ms".to_string(), json!(meta.timeout_ms));
    data.insert(
        "recovery_hint".to_string(),
        json!(semantic_recovery_hint(diagnostic_kind)),
    );
    if let Some(bridge_script_override) = meta.bridge_script_override {
        data.insert(
            "bridge_script_override".to_string(),
            json!(bridge_script_override),
        );
    }
    if let Some(path) = bridge_script_path {
        data.insert(
            "bridge_script".to_string(),
            json!(path.to_string_lossy().to_string()),
        );
    }
    data
}

fn semantic_error_data(
    diagnostic_kind: &str,
    meta: &SemanticBridgeRequestMeta,
    operation: &str,
    bridge_script_path: Option<&Path>,
) -> Value {
    Value::Object(semantic_error_data_map(
        diagnostic_kind,
        meta,
        operation,
        bridge_script_path,
    ))
}

fn insert_semantic_text_preview(data: &mut Map<String, Value>, key: &str, value: &str) {
    let normalized = value.trim();
    if normalized.is_empty() {
        return;
    }
    data.insert(
        key.to_string(),
        json!(truncate_output(
            normalized.to_string(),
            SEMANTIC_ERROR_PREVIEW_CHARS,
        )),
    );
}

fn insert_semantic_bridge_output_data(
    data: &mut Map<String, Value>,
    status: std::process::ExitStatus,
    stdout_text: &str,
    stderr_text: &str,
) {
    if let Some(code) = status.code() {
        data.insert("bridge_exit_status".to_string(), json!(code));
    }
    insert_semantic_text_preview(data, "stdout_preview", stdout_text);
    insert_semantic_text_preview(data, "stderr_preview", stderr_text);
}

fn insert_semantic_bridge_detail(data: &mut Map<String, Value>, details: &Value, key: &str) {
    let Some(object) = details.as_object() else {
        return;
    };
    let Some(value) = object.get(key) else {
        return;
    };
    if value.is_string() || value.is_number() || value.is_boolean() {
        data.insert(key.to_string(), value.clone());
    }
}

fn insert_semantic_bridge_error_payload(
    data: &mut Map<String, Value>,
    parsed_error: &BridgeErrorPayload,
) {
    data.insert(
        "bridge_error_class".to_string(),
        json!(parsed_error.error_class.as_str()),
    );
    data.insert(
        "bridge_error_message".to_string(),
        json!(parsed_error.message.as_str()),
    );
    if let Some(details) = &parsed_error.details {
        data.insert("bridge_error_details".to_string(), details.clone());
        insert_semantic_bridge_detail(data, details, "index_config_path");
        insert_semantic_bridge_detail(data, details, "matched_files");
        insert_semantic_bridge_detail(data, details, "raw_message");
        insert_semantic_bridge_detail(data, details, "source_count");
    }
}
