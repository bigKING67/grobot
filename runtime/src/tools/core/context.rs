fn parse_tool_context(input: &TurnExecuteInput) -> Result<ToolContextResolved, ToolExecutionError> {
    let tool_context = input.tool_context.as_ref().ok_or_else(|| {
        runtime_environment_error(
            "tool_context_missing",
            "runtime tool context is required",
            "tool_context_missing",
            "fix the runtime tool context/work_dir, then run grobot status --json before retrying",
            "tool_context",
            None,
        )
    })?;
    let raw_work_dir = tool_context
        .work_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            runtime_environment_error(
                "tool_context_missing",
                "tool_context.work_dir is required",
                "tool_context_missing",
                "fix the runtime tool context/work_dir, then run grobot status --json before retrying",
                "tool_context.work_dir",
                None,
            )
        })?;
    let canonical_work_dir = fs::canonicalize(raw_work_dir).map_err(|error| {
        runtime_environment_error(
            "tool_context_invalid",
            format!("failed to resolve work_dir: {error}"),
            "tool_context_invalid",
            "choose a valid workspace directory, then run grobot status --json before retrying",
            "tool_context.work_dir",
            Some(raw_work_dir),
        )
    })?;
    if !canonical_work_dir.is_dir() {
        return Err(runtime_environment_error(
            "tool_context_invalid",
            "tool_context.work_dir is not a directory",
            "tool_context_invalid",
            "choose a valid workspace directory, then run grobot status --json before retrying",
            "tool_context.work_dir",
            Some(raw_work_dir),
        ));
    }
    let enabled_tools = normalize_tool_name_set(tool_context.enabled_tools.as_ref(), "enabled_tools")?
        .unwrap_or_else(default_enabled_tools);
    let profile = resolve_tool_context_surface_profile(tool_context.tool_surface_profile.as_deref())?;
    let model_visible_tools = normalize_tool_name_set(tool_context.model_visible_tools.as_ref(), "model_visible_tools")?
        .unwrap_or_else(|| enabled_tools.clone());
    let advanced_tool_schema = tool_context.advanced_tool_schema.unwrap_or(false);
    let bash_allowlist = tool_context
        .bash_allowlist
        .as_ref()
        .map(|values| {
            values
                .iter()
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
                .map(|item| item.to_string())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    let session_key = input.session_key.trim().to_string();
    Ok(ToolContextResolved {
        session_key,
        work_dir: canonical_work_dir,
        enabled_tools,
        model_visible_tools,
        tool_surface_profile: profile,
        advanced_tool_schema,
        bash_allowlist,
    })
}

fn resolve_tool_context_surface_profile(raw: Option<&str>) -> Result<String, ToolExecutionError> {
    let Some(raw_value) = raw else {
        return Ok(TOOL_SURFACE_CODING.to_string());
    };
    let normalized = raw_value.trim().to_ascii_lowercase().replace('-', "_");
    let profile = match normalized.as_str() {
        TOOL_SURFACE_MINIMAL => TOOL_SURFACE_MINIMAL,
        TOOL_SURFACE_CODING => TOOL_SURFACE_CODING,
        TOOL_SURFACE_BROWSER => TOOL_SURFACE_BROWSER,
        TOOL_SURFACE_BROWSER_ADVANCED => TOOL_SURFACE_BROWSER_ADVANCED,
        TOOL_SURFACE_CONTEXT => TOOL_SURFACE_CONTEXT,
        TOOL_SURFACE_MCP => TOOL_SURFACE_MCP,
        TOOL_SURFACE_FULL_DEBUG => TOOL_SURFACE_FULL_DEBUG,
        _ => {
            return Err(ToolExecutionError::new(
                "tool_context_invalid",
                "tool_context.tool_surface_profile must be one of: minimal, coding, browser, browser_advanced, context, mcp, full_debug",
            )
            .with_data(json!({
                "diagnostic_kind": "tool_context_invalid",
                "field": "tool_context.tool_surface_profile",
                "source": "tool_context.tool_surface_profile",
                "raw_value": raw_value,
                "valid_values": [
                    TOOL_SURFACE_MINIMAL,
                    TOOL_SURFACE_CODING,
                    TOOL_SURFACE_BROWSER,
                    TOOL_SURFACE_BROWSER_ADVANCED,
                    TOOL_SURFACE_CONTEXT,
                    TOOL_SURFACE_MCP,
                    TOOL_SURFACE_FULL_DEBUG
                ],
                "recovery_hint": "omit tool_context.tool_surface_profile to use coding defaults, or pass one of the documented surface profiles",
            })));
        }
    };
    Ok(profile.to_string())
}

fn invalid_tool_context_entry_error(field: &str, raw_value: &str, detail: impl Into<String>) -> ToolExecutionError {
    ToolExecutionError::new("tool_context_invalid", detail.into()).with_data(json!({
        "diagnostic_kind": "tool_context_invalid",
        "field": field,
        "source": field,
        "raw_value": raw_value,
        "recovery_hint": "fix the runtime tool context tool list, or omit it to use the derived surface defaults"
    }))
}

fn normalize_tool_name_set(
    values: Option<&Vec<String>>,
    field: &str,
) -> Result<Option<HashSet<String>>, ToolExecutionError> {
    values.map(|rows| {
        let mut set = HashSet::new();
        for (index, item) in rows.iter().enumerate() {
            let normalized = normalize_tool_name(item);
            if normalized.is_empty() {
                return Err(invalid_tool_context_entry_error(
                    &format!("tool_context.{field}[{index}]"),
                    item,
                    format!("tool_context.{field}[{index}] must be a non-empty tool name"),
                ));
            }
            if !is_local_tool_dispatch_supported(&normalized) {
                return Err(invalid_tool_context_entry_error(
                    &format!("tool_context.{field}[{index}]"),
                    item,
                    format!("tool_context.{field}[{index}] is not a supported runtime tool"),
                ));
            }
            if !set.insert(normalized.clone()) {
                return Err(invalid_tool_context_entry_error(
                    &format!("tool_context.{field}[{index}]"),
                    item,
                    format!("tool_context.{field} must not contain duplicate tools"),
                ));
            }
        }
        Ok(set)
    })
    .transpose()
}

fn value_object<'a>(
    arguments: &'a Value,
    tool_name: &str,
) -> Result<&'a Map<String, Value>, ToolExecutionError> {
    arguments.as_object().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("tool {tool_name} expects a JSON object argument"),
        )
    })
}

fn parse_optional_string_arg(
    args: &Map<String, Value>,
    tool_name: &str,
    key: &str,
) -> Result<Option<String>, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let parsed = value.as_str().map(str::trim).ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} must be a string"),
        )
    })?;
    if parsed.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} cannot be empty"),
        ));
    }
    Ok(Some(parsed.to_string()))
}

fn parse_required_string_arg(
    args: &Map<String, Value>,
    tool_name: &str,
    key: &str,
    required_message: &str,
) -> Result<String, ToolExecutionError> {
    parse_optional_string_arg(args, tool_name, key)?.ok_or_else(|| {
        ToolExecutionError::new("invalid_tool_arguments", required_message.to_string())
    })
}

fn get_bool_arg(
    args: &Map<String, Value>,
    tool_name: &str,
    key: &str,
    fallback: bool,
) -> Result<bool, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(fallback);
    };
    value.as_bool().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} must be a boolean"),
        )
    })
}

fn get_usize_arg(
    args: &Map<String, Value>,
    tool_name: &str,
    key: &str,
    fallback: usize,
    max: usize,
) -> Result<usize, ToolExecutionError> {
    let Some(value) = args.get(key) else {
        return Ok(fallback);
    };
    let raw_u64 = value.as_u64().ok_or_else(|| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} must be an integer"),
        )
    })?;
    let raw = usize::try_from(raw_u64).map_err(|_| {
        ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} is too large"),
        )
    })?;
    if raw == 0 {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} must be >= 1"),
        ));
    }
    if raw > max {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            format!("{tool_name}.{key} must be <= {max}"),
        ));
    }
    Ok(raw)
}

fn parse_ask_user_options_arg(raw: &Value) -> Vec<Value> {
    let Some(items) = raw.as_array() else {
        return Vec::new();
    };
    let mut normalized = Vec::new();
    for item in items {
        if let Some(text) = item.as_str() {
            let compact = truncate_output(text.trim().to_string(), 120);
            if compact.is_empty() {
                continue;
            }
            normalized.push(json!({
                "label": compact,
                "value": compact,
            }));
        } else if let Some(option_obj) = item.as_object() {
            let label = option_obj
                .get("label")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| truncate_output(value.to_string(), 120));
            let Some(label) = label else {
                continue;
            };
            let description = option_obj
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| truncate_output(value.to_string(), 180));
            let value = option_obj
                .get("value")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|raw| !raw.is_empty())
                .map(|raw| truncate_output(raw.to_string(), 120))
                .unwrap_or_else(|| label.clone());
            let mut row = serde_json::Map::new();
            row.insert("label".to_string(), Value::String(label));
            if let Some(description) = description {
                if !description.is_empty() {
                    row.insert("description".to_string(), Value::String(description));
                }
            }
            row.insert("value".to_string(), Value::String(value));
            normalized.push(Value::Object(row));
        }
        if normalized.len() >= 6 {
            break;
        }
    }
    normalized
}

fn parse_ask_user_arg_questions(args: &Map<String, Value>) -> Vec<Value> {
    let Some(raw_questions) = args.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut questions: Vec<Value> = Vec::new();
    for (index, raw_question) in raw_questions.iter().enumerate() {
        let Some(question_obj) = raw_question.as_object() else {
            continue;
        };
        let id = question_obj
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_output(value.to_string(), 80))
            .unwrap_or_else(|| format!("q{}", index + 1));
        let header = question_obj
            .get("header")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_output(value.to_string(), 120))
            .unwrap_or_else(|| format!("Question {}", index + 1));
        let question = question_obj
            .get("question")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_output(value.to_string(), 600));
        let Some(question) = question else {
            continue;
        };
        let options = question_obj
            .get("options")
            .map(parse_ask_user_options_arg)
            .unwrap_or_default();
        questions.push(json!({
            "id": id,
            "header": header,
            "question": question,
            "options": options,
        }));
        if questions.len() >= 3 {
            break;
        }
    }
    questions
}

fn build_runtime_generated_id(prefix: &str) -> String {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{prefix}_{:x}", now_nanos)
}

fn now_unix_label() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}

fn run_ask_user(
    _context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    for key in args.keys() {
        if key != "questions"
            && key != "blocking_node_id"
            && key != "default_on_timeout"
            && key != "resume_token"
        {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported ask_user argument: {key}"),
            ));
        }
    }

    let questions = parse_ask_user_arg_questions(args);
    if questions.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "ask_user.questions must include at least one valid item",
        ));
    }
    let blocking_node_id = parse_optional_string_arg(args, TOOL_ASK_USER, "blocking_node_id")?
        .unwrap_or_else(|| "node.unknown".to_string());
    let default_on_timeout = parse_optional_string_arg(args, TOOL_ASK_USER, "default_on_timeout")?
        .unwrap_or_else(|| "continue_with_best_effort".to_string());
    let resume_token = parse_optional_string_arg(args, TOOL_ASK_USER, "resume_token")?
        .unwrap_or_else(|| build_runtime_generated_id("resume"));
    let payload = json!({
        "tool": TOOL_ASK_USER,
        "type": "ask_user",
        "blocking_node_id": blocking_node_id,
        "questions": questions,
        "default_on_timeout": default_on_timeout,
        "resume_token": resume_token,
        "created_at": now_unix_label(),
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn ensure_within_workspace(
    work_dir: &Path,
    raw_path: &str,
    allow_missing_leaf: bool,
) -> Result<PathBuf, ToolExecutionError> {
    let candidate = if Path::new(raw_path).is_absolute() {
        PathBuf::from(raw_path)
    } else {
        work_dir.join(raw_path)
    };
    let resolved = if candidate.exists() {
        fs::canonicalize(&candidate).map_err(|error| {
            ToolExecutionError::new("path_invalid", format!("failed to resolve path: {error}"))
                .with_data(path_resolution_error_data(
                    raw_path,
                    Some(candidate.as_path()),
                    allow_missing_leaf,
                    "path_invalid",
                    "failed_to_resolve_path",
                ))
        })?
    } else if allow_missing_leaf {
        if candidate
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(ToolExecutionError::new(
                "path_escape_blocked",
                "missing write targets must not contain parent traversal",
            )
            .with_data(path_resolution_error_data(
                raw_path,
                Some(candidate.as_path()),
                allow_missing_leaf,
                "path_escape_blocked",
                "parent_traversal_in_missing_target",
            )));
        }

        let mut cursor = candidate.as_path();
        let mut missing_components = Vec::new();
        while !cursor.exists() {
            let component = cursor.file_name().ok_or_else(|| {
                ToolExecutionError::new("path_invalid", "path parent is invalid")
                    .with_data(path_resolution_error_data(
                        raw_path,
                        Some(candidate.as_path()),
                        allow_missing_leaf,
                        "path_invalid",
                        "missing_parent_component",
                    ))
            })?;
            missing_components.push(component.to_os_string());
            cursor = cursor.parent().ok_or_else(|| {
                ToolExecutionError::new("path_invalid", "path parent is invalid")
                    .with_data(path_resolution_error_data(
                        raw_path,
                        Some(candidate.as_path()),
                        allow_missing_leaf,
                        "path_invalid",
                        "missing_parent_path",
                    ))
            })?;
        }

        let mut resolved_parent = fs::canonicalize(cursor).map_err(|error| {
            ToolExecutionError::new("path_invalid", format!("failed to resolve parent: {error}"))
                .with_data(path_resolution_error_data(
                    raw_path,
                    Some(cursor),
                    allow_missing_leaf,
                    "path_invalid",
                    "failed_to_resolve_parent",
                ))
        })?;
        for component in missing_components.iter().rev() {
            resolved_parent.push(component);
        }
        resolved_parent
    } else {
        return Err(ToolExecutionError::new(
            "path_not_found",
            format!("path not found: {}", candidate.display()),
        )
        .with_data(path_resolution_error_data(
            raw_path,
            Some(candidate.as_path()),
            allow_missing_leaf,
            "path_not_found",
            "target_does_not_exist",
        )));
    };
    if !resolved.starts_with(work_dir) {
        return Err(ToolExecutionError::new(
            "path_escape_blocked",
            "path escapes workspace",
        )
        .with_data(path_resolution_error_data(
            raw_path,
            Some(resolved.as_path()),
            allow_missing_leaf,
            "path_escape_blocked",
            "resolved_path_outside_workspace",
        )));
    }
    Ok(resolved)
}

fn relative_to_work_dir(work_dir: &Path, value: &Path) -> String {
    value
        .strip_prefix(work_dir)
        .unwrap_or(value)
        .to_string_lossy()
        .replace('\\', "/")
}

fn truncate_output(raw: String, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        return raw;
    }
    raw.chars().take(max_chars).collect::<String>()
}
