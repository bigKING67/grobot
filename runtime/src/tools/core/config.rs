fn config_invalid_error(
    message: impl Into<String>,
    source: &str,
    required_config: &str,
    recovery_hint: &str,
) -> ToolExecutionError {
    ToolExecutionError::new("config_invalid", message).with_data({
        let mut data = Map::new();
        data.insert("diagnostic_kind".to_string(), json!("config_invalid"));
        data.insert("source".to_string(), json!(source));
        data.insert("required_config".to_string(), json!(required_config));
        data.insert("recovery_hint".to_string(), json!(recovery_hint));
        Value::Object(data)
    })
}

fn invalid_project_config_error(
    path: &Path,
    field: &str,
    detail: impl Into<String>,
) -> ToolExecutionError {
    let detail = detail.into();
    config_invalid_error(
        format!("invalid project config `{field}`: {detail}"),
        path.to_string_lossy().as_ref(),
        field,
        "fix .grobot/project.toml explicit values or remove the field to use defaults",
    )
}

fn invalid_mcp_registry_error(
    path: &Path,
    field: &str,
    detail: impl Into<String>,
) -> ToolExecutionError {
    let detail = detail.into();
    config_invalid_error(
        format!("invalid MCP registry `{field}`: {detail}"),
        path.to_string_lossy().as_ref(),
        field,
        "fix the MCP registry entry or disable/remove the malformed server",
    )
}

fn parse_toml_file<T>(path: &Path) -> Result<Option<T>, ToolExecutionError>
where
    T: DeserializeOwned,
{
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(config_invalid_error(
                format!("failed to read TOML config `{}`: {error}", path.display()),
                path.to_string_lossy().as_ref(),
                path.to_string_lossy().as_ref(),
                "fix config file permissions or remove the unreadable config file",
            ));
        }
    };
    toml::from_str::<T>(&raw).map(Some).map_err(|error| {
        config_invalid_error(
            format!("failed to parse TOML config `{}`: {error}", path.display()),
            path.to_string_lossy().as_ref(),
            path.to_string_lossy().as_ref(),
            "fix malformed TOML syntax or remove the invalid explicit config file",
        )
    })
}

fn validate_policy_usize(
    value: Option<usize>,
    default_value: usize,
    min: usize,
    max: usize,
    field: &str,
    path: &Path,
) -> Result<usize, ToolExecutionError> {
    let Some(raw) = value else {
        return Ok(default_value);
    };
    if raw < min || raw > max {
        return Err(invalid_project_config_error(
            path,
            field,
            format!("must be an integer between {min} and {max}"),
        ));
    }
    Ok(raw)
}

fn validate_policy_u64(
    value: Option<u64>,
    default_value: u64,
    min: u64,
    max: u64,
    field: &str,
    path: &Path,
) -> Result<u64, ToolExecutionError> {
    let Some(raw) = value else {
        return Ok(default_value);
    };
    if raw < min || raw > max {
        return Err(invalid_project_config_error(
            path,
            field,
            format!("must be an integer between {min} and {max}"),
        ));
    }
    Ok(raw)
}

fn validate_optional_unique_non_empty_string_list(
    values: Option<&Vec<String>>,
    field: &str,
    path: &Path,
) -> Result<Vec<String>, ToolExecutionError> {
    let Some(values) = values else {
        return Ok(Vec::new());
    };
    if values.is_empty() {
        return Err(invalid_project_config_error(
            path,
            field,
            "must be a non-empty array of non-empty strings when specified",
        ));
    }
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for (index, raw) in values.iter().enumerate() {
        let value = raw.trim();
        if value.is_empty() {
            return Err(invalid_project_config_error(
                path,
                field,
                format!("entry at index {index} must be a non-empty string"),
            ));
        }
        if !seen.insert(value.to_string()) {
            return Err(invalid_project_config_error(
                path,
                field,
                "values must be unique",
            ));
        }
        normalized.push(value.to_string());
    }
    Ok(normalized)
}

fn find_project_grobot_dir(work_dir: &Path) -> Option<PathBuf> {
    let mut cursor = Some(work_dir);
    while let Some(path) = cursor {
        let candidate = path.join(".grobot");
        if candidate.is_dir() {
            return Some(candidate);
        }
        cursor = path.parent();
    }
    None
}

fn shell_escape_single(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn command_resolvable(command: &str, cwd: &Path) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains('/') {
        return Path::new(trimmed).exists();
    }
    let script = format!("command -v {} >/dev/null 2>&1", shell_escape_single(trimmed));
    Command::new("sh")
        .arg("-lc")
        .arg(script)
        .current_dir(cwd)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn normalize_name(value: &str) -> String {
    value.trim().to_string()
}

fn merge_mcp_servers_from_file(
    path: &Path,
    source: &str,
    merged: &mut Vec<McpServerResolved>,
    index_by_name: &mut HashMap<String, usize>,
) -> Result<(), ToolExecutionError> {
    let Some(parsed) = parse_toml_file::<McpServerRegistryFile>(path)? else {
        return Ok(());
    };
    for (entry_index, raw) in parsed.servers.into_iter().enumerate() {
        let name = normalize_name(&raw.name);
        let command = normalize_name(&raw.command);
        if name.is_empty() || command.is_empty() {
            let field = if name.is_empty() {
                "servers[].name"
            } else {
                "servers[].command"
            };
            return Err(invalid_mcp_registry_error(
                path,
                field,
                format!("entry {entry_index} must define non-empty name and command"),
            ));
        }
        let mut args = Vec::new();
        for (arg_index, item) in raw.args.iter().enumerate() {
            let normalized = item.trim();
            if normalized.is_empty() {
                return Err(invalid_mcp_registry_error(
                    path,
                    "servers[].args",
                    format!("entry {entry_index} arg {arg_index} must be a non-empty string"),
                ));
            }
            args.push(normalized.to_string());
        }
        let resolved = McpServerResolved {
            name: name.clone(),
            command,
            args,
            env: raw.env,
            enabled: raw.enabled.unwrap_or(true),
            source: source.to_string(),
            ready: false,
            ready_reason: "not_checked".to_string(),
        };
        if let Some(index) = index_by_name.get(&name).copied() {
            merged[index] = resolved;
        } else {
            let index = merged.len();
            merged.push(resolved);
            index_by_name.insert(name, index);
        }
    }
    Ok(())
}

fn load_mcp_servers(
    context: &ToolContextResolved,
) -> Result<Vec<McpServerResolved>, ToolExecutionError> {
    let mut merged: Vec<McpServerResolved> = Vec::new();
    let mut index_by_name: HashMap<String, usize> = HashMap::new();
    if let Some(home) = env::var_os("HOME") {
        let global_registry = PathBuf::from(home)
            .join(".grobot")
            .join("mcp")
            .join("servers.toml");
        merge_mcp_servers_from_file(
            &global_registry,
            "global",
            &mut merged,
            &mut index_by_name,
        )?;
    }
    if let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) {
        let project_registry = project_grobot_dir.join("mcp.toml");
        merge_mcp_servers_from_file(
            &project_registry,
            "project",
            &mut merged,
            &mut index_by_name,
        )?;
    }
    for server in &mut merged {
        if !server.enabled {
            server.ready = false;
            server.ready_reason = "disabled".to_string();
            continue;
        }
        if command_resolvable(&server.command, &context.work_dir) {
            server.ready = true;
            server.ready_reason = "ok".to_string();
        } else {
            server.ready = false;
            server.ready_reason = "command_not_found".to_string();
        }
    }
    Ok(merged)
}

fn load_mcp_call_policy(
    context: &ToolContextResolved,
) -> Result<McpCallPolicy, ToolExecutionError> {
    let mut policy = default_mcp_call_policy();
    let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) else {
        return Ok(policy);
    };
    let project_toml = project_grobot_dir.join("project.toml");
    let Some(parsed) = parse_toml_file::<ProjectPolicyConfigFile>(&project_toml)? else {
        return Ok(policy);
    };
    let project_policy = parsed.tools.mcp;
    let allow_tools = validate_optional_unique_non_empty_string_list(
        project_policy.allow_tools.as_ref(),
        "tools.mcp.allow_tools",
        &project_toml,
    )?;
    policy.max_concurrency_per_server = validate_policy_usize(
        project_policy.max_concurrency_per_server,
        DEFAULT_MCP_MAX_CONCURRENCY_PER_SERVER,
        MIN_MCP_MAX_CONCURRENCY_PER_SERVER,
        MAX_MCP_MAX_CONCURRENCY_PER_SERVER,
        "tools.mcp.max_concurrency_per_server",
        &project_toml,
    )?;
    policy.max_queue_per_server = validate_policy_usize(
        project_policy.max_queue_per_server,
        DEFAULT_MCP_MAX_QUEUE_PER_SERVER,
        MIN_MCP_MAX_QUEUE_PER_SERVER,
        MAX_MCP_MAX_QUEUE_PER_SERVER,
        "tools.mcp.max_queue_per_server",
        &project_toml,
    )?;
    policy.failure_threshold = validate_policy_usize(
        project_policy.failure_threshold,
        DEFAULT_MCP_FAILURE_THRESHOLD,
        MIN_MCP_FAILURE_THRESHOLD,
        MAX_MCP_FAILURE_THRESHOLD,
        "tools.mcp.failure_threshold",
        &project_toml,
    )?;
    policy.cooldown_secs = validate_policy_u64(
        project_policy.cooldown_secs,
        DEFAULT_MCP_COOLDOWN_SECS,
        MIN_MCP_COOLDOWN_SECS,
        MAX_MCP_COOLDOWN_SECS,
        "tools.mcp.cooldown_secs",
        &project_toml,
    )?;
    policy.latency_sample_limit = validate_policy_usize(
        project_policy.latency_sample_limit,
        DEFAULT_MCP_LATENCY_SAMPLE_LIMIT,
        MIN_MCP_LATENCY_SAMPLE_LIMIT,
        MAX_MCP_LATENCY_SAMPLE_LIMIT,
        "tools.mcp.latency_sample_limit",
        &project_toml,
    )?;
    policy.call_timeout_ms = validate_policy_u64(
        project_policy.call_timeout_ms,
        DEFAULT_MCP_CALL_TIMEOUT_MS,
        MIN_MCP_CALL_TIMEOUT_MS,
        MAX_MCP_CALL_TIMEOUT_MS,
        "tools.mcp.call_timeout_ms",
        &project_toml,
    )?;
    policy.session_idle_ttl_secs = validate_policy_u64(
        project_policy.session_idle_ttl_secs,
        DEFAULT_MCP_SESSION_IDLE_TTL_SECS,
        MIN_MCP_SESSION_IDLE_TTL_SECS,
        MAX_MCP_SESSION_IDLE_TTL_SECS,
        "tools.mcp.session_idle_ttl_secs",
        &project_toml,
    )?;
    policy.allow_tools = allow_tools;
    Ok(policy)
}

fn mcp_tool_allowed(policy: &McpCallPolicy, tool_name: &str) -> bool {
    if policy.allow_tools.is_empty() {
        return true;
    }
    for rule in &policy.allow_tools {
        if rule == "*" || rule == tool_name {
            return true;
        }
    }
    false
}
