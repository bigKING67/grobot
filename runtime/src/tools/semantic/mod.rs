const DEFAULT_SEMANTIC_TIMEOUT_MS: u64 = 45_000;
const MIN_SEMANTIC_TIMEOUT_MS: u64 = 1_000;
const MAX_SEMANTIC_TIMEOUT_MS: u64 = 180_000;
const DEFAULT_SEMANTIC_PER_SOURCE_LIMIT: usize = 6;
const MAX_SEMANTIC_PER_SOURCE_LIMIT: usize = 50;
const DEFAULT_SEMANTIC_MAX_SEGMENTS: usize = 24;
const MAX_SEMANTIC_MAX_SEGMENTS: usize = 200;
const DEFAULT_PROMPT_MAX_EVIDENCE: usize = 16;
const MAX_PROMPT_MAX_EVIDENCE: usize = 200;
const MAX_TERM_ITEMS: usize = 32;
const SEMANTIC_ERROR_PREVIEW_CHARS: usize = 1_000;
const SEMANTIC_ERROR_SOURCE_ROOT_PREVIEW_LIMIT: usize = 4;

#[derive(Debug, Clone)]
struct SessionKeyParts {
    tenant: String,
    scope: String,
    subject: String,
}

#[derive(Debug, Clone)]
struct SemanticBridgeRequestMeta<'a> {
    tool_name: &'static str,
    bridge_command: &'static str,
    requested_sources: &'a [String],
    source_roots: &'a [Value],
    timeout_ms: u64,
    bridge_script_override: Option<&'a str>,
}

#[derive(Debug, Clone)]
struct BridgeErrorPayload {
    error_class: String,
    message: String,
    details: Option<Value>,
}

fn run_semantic_search(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    input: &TurnExecuteInput,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let query = get_string_arg(args, "query").ok_or_else(|| {
        ToolExecutionError::new("invalid_tool_arguments", "semantic_search.query is required")
    })?;
    let technical_terms = get_string_array_arg(args, "technical_terms", MAX_TERM_ITEMS);
    let include_org = get_bool_arg(args, "include_org", false);
    let requested_sources = resolve_requested_sources(args);
    let source_roots = resolve_source_roots(context, input, &requested_sources, include_org);
    let timeout_ms = get_timeout_ms_arg(args, "timeout_ms");
    let bridge_script_override = get_string_arg(args, "bridge_script");
    let bridge_meta = SemanticBridgeRequestMeta {
        tool_name: TOOL_SEMANTIC_SEARCH,
        bridge_command: "semantic-search",
        requested_sources: &requested_sources,
        source_roots: &source_roots,
        timeout_ms,
        bridge_script_override: bridge_script_override.as_deref(),
    };
    if source_roots.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_no_source_available",
            "semantic_search has no available source roots",
        )
        .with_data(semantic_error_data(
            "semantic_no_source_available",
            &bridge_meta,
            "resolve_source_roots",
            None,
        )));
    }
    let per_source_limit = get_usize_arg(
        args,
        "per_source_limit",
        DEFAULT_SEMANTIC_PER_SOURCE_LIMIT,
        MAX_SEMANTIC_PER_SOURCE_LIMIT,
    );
    let max_segments = get_usize_arg(
        args,
        "max_segments",
        DEFAULT_SEMANTIC_MAX_SEGMENTS,
        MAX_SEMANTIC_MAX_SEGMENTS,
    );
    let refresh = normalize_refresh_mode(get_string_arg(args, "refresh"));

    let payload = json!({
        "query": query,
        "technicalTerms": technical_terms,
        "sourceRoots": source_roots.clone(),
        "perSourceLimit": per_source_limit,
        "maxSegments": max_segments,
        "refresh": refresh,
    });
    let result = run_contextweaver_bridge(
        context,
        &payload,
        &bridge_meta,
    )?;
    Ok(ToolCallOutput::from_payload(result))
}

fn run_prompt_enhancer(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    input: &TurnExecuteInput,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let prompt = get_string_arg(args, "prompt").ok_or_else(|| {
        ToolExecutionError::new("invalid_tool_arguments", "prompt_enhancer.prompt is required")
    })?;
    let explicit_paths = get_string_array_arg(args, "explicit_paths", MAX_TERM_ITEMS);
    let explicit_symbols = get_string_array_arg(args, "explicit_symbols", MAX_TERM_ITEMS);
    let include_org = get_bool_arg(args, "include_org", false);
    let requested_sources = resolve_requested_sources(args);
    let source_roots = resolve_source_roots(context, input, &requested_sources, include_org);
    let timeout_ms = get_timeout_ms_arg(args, "timeout_ms");
    let bridge_script_override = get_string_arg(args, "bridge_script");
    let bridge_meta = SemanticBridgeRequestMeta {
        tool_name: TOOL_PROMPT_ENHANCER,
        bridge_command: "prompt-enhancer",
        requested_sources: &requested_sources,
        source_roots: &source_roots,
        timeout_ms,
        bridge_script_override: bridge_script_override.as_deref(),
    };
    if source_roots.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_no_source_available",
            "prompt_enhancer has no available source roots",
        )
        .with_data(semantic_error_data(
            "semantic_no_source_available",
            &bridge_meta,
            "resolve_source_roots",
            None,
        )));
    }
    let max_evidence = get_usize_arg(
        args,
        "max_evidence",
        DEFAULT_PROMPT_MAX_EVIDENCE,
        MAX_PROMPT_MAX_EVIDENCE,
    );
    let refresh = normalize_refresh_mode(get_string_arg(args, "refresh"));

    let payload = json!({
        "prompt": prompt,
        "explicitPaths": explicit_paths,
        "explicitSymbols": explicit_symbols,
        "sourceRoots": source_roots.clone(),
        "maxEvidence": max_evidence,
        "refresh": refresh,
    });
    let result = run_contextweaver_bridge(
        context,
        &payload,
        &bridge_meta,
    )?;
    Ok(ToolCallOutput::from_payload(result))
}

fn get_string_array_arg(args: &Map<String, Value>, key: &str, max_items: usize) -> Vec<String> {
    let mut values = Vec::new();
    let Some(raw_items) = args.get(key).and_then(Value::as_array) else {
        return values;
    };
    for raw_item in raw_items {
        let Some(raw_text) = raw_item.as_str() else {
            continue;
        };
        let normalized = raw_text.trim();
        if normalized.is_empty() {
            continue;
        }
        values.push(normalized.to_string());
        if values.len() >= max_items {
            break;
        }
    }
    values
}

fn resolve_requested_sources(args: &Map<String, Value>) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    let raw_sources = get_string_array_arg(args, "sources", 8);
    if raw_sources.is_empty() {
        return vec!["code".to_string(), "memory".to_string(), "wiki".to_string()];
    }
    for item in raw_sources {
        let canonical = item.to_ascii_lowercase();
        if canonical != "code" && canonical != "memory" && canonical != "wiki" {
            continue;
        }
        if normalized.iter().any(|entry| entry == &canonical) {
            continue;
        }
        normalized.push(canonical);
    }
    if normalized.is_empty() {
        return vec!["code".to_string(), "memory".to_string(), "wiki".to_string()];
    }
    normalized
}

fn parse_session_key_parts(session_key: &str) -> SessionKeyParts {
    let mut parts = session_key.splitn(4, ':');
    let _platform = parts.next();
    let tenant = parts.next().unwrap_or("default").trim();
    let scope = parts.next().unwrap_or("dm").trim();
    let subject = parts.next().unwrap_or("user").trim();
    SessionKeyParts {
        tenant: if tenant.is_empty() {
            "default".to_string()
        } else {
            tenant.to_string()
        },
        scope: if scope.is_empty() {
            "dm".to_string()
        } else {
            scope.to_ascii_lowercase()
        },
        subject: if subject.is_empty() {
            "user".to_string()
        } else {
            subject.to_string()
        },
    }
}

fn resolve_source_roots(
    context: &ToolContextResolved,
    input: &TurnExecuteInput,
    requested_sources: &[String],
    include_org: bool,
) -> Vec<Value> {
    let session = parse_session_key_parts(&input.session_key);
  let project_root = find_project_grobot_dir(&context.work_dir)
      .and_then(|path| path.parent().map(Path::to_path_buf))
      .unwrap_or_else(|| context.work_dir.clone());
  let scope_folder = if session.scope == "group" {
      "groups"
  } else {
      "users"
    };
    let mut rows: Vec<Value> = Vec::new();
    let mut dedup: HashSet<String> = HashSet::new();
    for source in requested_sources {
        match source.as_str() {
            "code" => {
                push_source_root(&mut rows, &mut dedup, "code", context.work_dir.clone());
            }
            "memory" => {
              let scoped_root = project_root
                  .join(".grobot")
                  .join("memory")
                  .join("v1")
                  .join(scope_folder)
                  .join(&session.subject);
              push_source_root(&mut rows, &mut dedup, "memory", scoped_root);
              if include_org {
                  let org_root = project_root
                      .join(".grobot")
                      .join("memory")
                      .join("v1")
                      .join("org")
                      .join(&session.tenant);
                  push_source_root(&mut rows, &mut dedup, "memory", org_root);
              }
          }
            "wiki" => {
                let scoped_root = project_root
                    .join(".grobot")
                    .join("wiki")
                    .join(scope_folder)
                    .join(&session.subject);
                push_source_root(&mut rows, &mut dedup, "wiki", scoped_root);
              push_source_root(
                  &mut rows,
                  &mut dedup,
                  "wiki",
                  project_root.join(".grobot").join("wiki").join("shared"),
              );
              if include_org {
                  let org_root = project_root
                      .join(".grobot")
                      .join("wiki")
                      .join("org")
                      .join(&session.tenant);
                  push_source_root(&mut rows, &mut dedup, "wiki", org_root);
              }
          }
            _ => {}
        }
    }
    rows
}

fn push_source_root(
    rows: &mut Vec<Value>,
    dedup: &mut HashSet<String>,
    source: &str,
    path: PathBuf,
) {
    let canonical_path = match fs::canonicalize(&path) {
        Ok(resolved) => resolved,
        Err(_) => return,
    };
    if !canonical_path.is_dir() {
        return;
    }
    let path_text = canonical_path.to_string_lossy().to_string();
    let key = format!("{source}:{path_text}");
    if dedup.contains(&key) {
        return;
    }
    dedup.insert(key);
    rows.push(json!({
        "source": source,
        "rootPath": path_text,
    }));
}

fn get_timeout_ms_arg(args: &Map<String, Value>, key: &str) -> u64 {
    if let Some(raw) = args.get(key).and_then(Value::as_u64) {
        return raw.clamp(MIN_SEMANTIC_TIMEOUT_MS, MAX_SEMANTIC_TIMEOUT_MS);
    }
    if let Ok(raw_env) = env::var("GROBOT_CONTEXTWEAVER_TIMEOUT_MS") {
        if let Ok(parsed) = raw_env.trim().parse::<u64>() {
            return parsed.clamp(MIN_SEMANTIC_TIMEOUT_MS, MAX_SEMANTIC_TIMEOUT_MS);
        }
    }
    DEFAULT_SEMANTIC_TIMEOUT_MS
}

fn normalize_refresh_mode(raw: Option<String>) -> String {
    let normalized = raw
        .unwrap_or_else(|| "auto".to_string())
        .trim()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "force" | "always" => "force".to_string(),
        "skip" | "never" => "skip".to_string(),
        _ => "auto".to_string(),
    }
}

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

fn run_contextweaver_bridge(
    context: &ToolContextResolved,
    payload: &Value,
    meta: &SemanticBridgeRequestMeta,
) -> Result<Value, ToolExecutionError> {
    let bridge_script_path = resolve_bridge_script_path(meta.bridge_script_override).ok_or_else(|| {
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
    let node_bin = env::var("GROBOT_NODE_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "node".to_string());
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
        let parsed_error = parse_bridge_error_payload(&stderr_text)
            .or_else(|| parse_bridge_error_payload(&stdout_text));
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
        return Err(ToolExecutionError::new(default_error_class, message)
            .with_data(Value::Object(data)));
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

fn resolve_bridge_script_path(override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(value) = override_path {
        let normalized = value.trim();
        if normalized.is_empty() {
            return None;
        }
        let candidate = PathBuf::from(normalized);
        return if candidate.is_file() { Some(candidate) } else { None };
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(value) = env::var("GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT") {
        let normalized = value.trim();
        if !normalized.is_empty() {
            candidates.push(PathBuf::from(normalized));
        }
    }
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join("adapters").join("contextweaver").join("bridge").join("cli.mjs"));
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
            return Some(candidate);
        }
    }
    None
}
