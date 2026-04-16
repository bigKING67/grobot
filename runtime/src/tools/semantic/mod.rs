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

#[derive(Debug, Clone)]
struct SessionKeyParts {
    tenant: String,
    scope: String,
    subject: String,
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
    if source_roots.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_no_source_available",
            "semantic_search has no available source roots",
        ));
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
    let timeout_ms = get_timeout_ms_arg(args, "timeout_ms");
    let bridge_script_override = get_string_arg(args, "bridge_script");

    let payload = json!({
        "query": query,
        "technicalTerms": technical_terms,
        "sourceRoots": source_roots,
        "perSourceLimit": per_source_limit,
        "maxSegments": max_segments,
        "refresh": refresh,
    });
    let result = run_contextweaver_bridge(
        context,
        "semantic-search",
        &payload,
        timeout_ms,
        bridge_script_override.as_deref(),
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
    if source_roots.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_no_source_available",
            "prompt_enhancer has no available source roots",
        ));
    }
    let max_evidence = get_usize_arg(
        args,
        "max_evidence",
        DEFAULT_PROMPT_MAX_EVIDENCE,
        MAX_PROMPT_MAX_EVIDENCE,
    );
    let refresh = normalize_refresh_mode(get_string_arg(args, "refresh"));
    let timeout_ms = get_timeout_ms_arg(args, "timeout_ms");
    let bridge_script_override = get_string_arg(args, "bridge_script");

    let payload = json!({
        "prompt": prompt,
        "explicitPaths": explicit_paths,
        "explicitSymbols": explicit_symbols,
        "sourceRoots": source_roots,
        "maxEvidence": max_evidence,
        "refresh": refresh,
    });
    let result = run_contextweaver_bridge(
        context,
        "prompt-enhancer",
        &payload,
        timeout_ms,
        bridge_script_override.as_deref(),
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

fn run_contextweaver_bridge(
    context: &ToolContextResolved,
    command: &str,
    payload: &Value,
    timeout_ms: u64,
    bridge_script_override: Option<&str>,
) -> Result<Value, ToolExecutionError> {
    let bridge_script_path = resolve_bridge_script_path(bridge_script_override).ok_or_else(|| {
        ToolExecutionError::new(
            "semantic_tool_unavailable",
            "contextweaver bridge script not found; set GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT",
        )
    })?;
    let node_bin = env::var("GROBOT_NODE_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "node".to_string());
    let payload_text = serde_json::to_string(payload).map_err(|error| {
        ToolExecutionError::new(
            "semantic_invalid_response",
            format!("failed to serialize bridge payload: {error}"),
        )
    })?;

    let output = Command::new(node_bin)
        .arg(&bridge_script_path)
        .arg(command)
        .arg("--payload")
        .arg(payload_text)
        .arg("--timeout-ms")
        .arg(timeout_ms.to_string())
        .current_dir(&context.work_dir)
        .output()
        .map_err(|error| {
            ToolExecutionError::new(
                "semantic_tool_unavailable",
                format!("failed to launch contextweaver bridge: {error}"),
            )
        })?;
    if !output.status.success() {
        let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parsed_error = parse_bridge_error_payload(&stderr_text)
            .or_else(|| parse_bridge_error_payload(&stdout_text));
        if let Some((error_class, message)) = parsed_error {
            return Err(ToolExecutionError::new(&error_class, message));
        }
        let message = if stderr_text.is_empty() {
            if stdout_text.is_empty() {
                "contextweaver bridge command failed".to_string()
            } else {
                truncate_output(stdout_text, 1_000)
            }
        } else {
            truncate_output(stderr_text, 1_000)
        };
        let default_error_class = if command == "prompt-enhancer" {
            "prompt_enhancer_failed"
        } else {
            "semantic_search_failed"
        };
        return Err(ToolExecutionError::new(default_error_class, message));
    }
    let stdout_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout_text.is_empty() {
        return Err(ToolExecutionError::new(
            "semantic_invalid_response",
            "contextweaver bridge returned empty output",
        ));
    }
    let parsed: Value = serde_json::from_str(&stdout_text).map_err(|error| {
        ToolExecutionError::new(
            "semantic_invalid_response",
            format!("contextweaver bridge returned invalid JSON: {error}"),
        )
    })?;
    Ok(parsed)
}

fn parse_bridge_error_payload(raw: &str) -> Option<(String, String)> {
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
        return Some((error_class, message));
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
