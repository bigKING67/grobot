fn clamp_policy_usize(value: Option<usize>, default_value: usize, min: usize, max: usize) -> usize {
    value.unwrap_or(default_value).clamp(min, max)
}

fn clamp_policy_u64(value: Option<u64>, default_value: u64, min: u64, max: u64) -> u64 {
    value.unwrap_or(default_value).clamp(min, max)
}

fn parse_toml_file<T>(path: &Path) -> Option<T>
where
    T: DeserializeOwned,
{
    let raw = fs::read_to_string(path).ok()?;
    toml::from_str::<T>(&raw).ok()
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
) {
    let parsed = match parse_toml_file::<McpServerRegistryFile>(path) {
        Some(parsed) => parsed,
        None => return,
    };
    for raw in parsed.servers {
        let name = normalize_name(&raw.name);
        let command = normalize_name(&raw.command);
        if name.is_empty() || command.is_empty() {
            continue;
        }
        let args = raw
            .args
            .iter()
            .map(|item| item.trim())
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect::<Vec<String>>();
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
}

fn load_mcp_servers(context: &ToolContextResolved) -> Vec<McpServerResolved> {
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
        );
    }
    if let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) {
        let project_registry = project_grobot_dir.join("mcp.toml");
        merge_mcp_servers_from_file(
            &project_registry,
            "project",
            &mut merged,
            &mut index_by_name,
        );
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
    merged
}

fn load_mcp_call_policy(context: &ToolContextResolved) -> McpCallPolicy {
    let mut policy = default_mcp_call_policy();
    let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) else {
        return policy;
    };
    let project_toml = project_grobot_dir.join("project.toml");
    let parsed = match parse_toml_file::<ProjectPolicyConfigFile>(&project_toml) {
        Some(parsed) => parsed,
        None => return policy,
    };
    let project_policy = parsed.tools.mcp;
    let allow_tools = project_policy
        .allow_tools
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect::<Vec<String>>();
    policy.max_concurrency_per_server = clamp_policy_usize(
        project_policy.max_concurrency_per_server,
        DEFAULT_MCP_MAX_CONCURRENCY_PER_SERVER,
        MIN_MCP_MAX_CONCURRENCY_PER_SERVER,
        MAX_MCP_MAX_CONCURRENCY_PER_SERVER,
    );
    policy.max_queue_per_server = clamp_policy_usize(
        project_policy.max_queue_per_server,
        DEFAULT_MCP_MAX_QUEUE_PER_SERVER,
        MIN_MCP_MAX_QUEUE_PER_SERVER,
        MAX_MCP_MAX_QUEUE_PER_SERVER,
    );
    policy.failure_threshold = clamp_policy_usize(
        project_policy.failure_threshold,
        DEFAULT_MCP_FAILURE_THRESHOLD,
        MIN_MCP_FAILURE_THRESHOLD,
        MAX_MCP_FAILURE_THRESHOLD,
    );
    policy.cooldown_secs = clamp_policy_u64(
        project_policy.cooldown_secs,
        DEFAULT_MCP_COOLDOWN_SECS,
        MIN_MCP_COOLDOWN_SECS,
        MAX_MCP_COOLDOWN_SECS,
    );
    policy.latency_sample_limit = clamp_policy_usize(
        project_policy.latency_sample_limit,
        DEFAULT_MCP_LATENCY_SAMPLE_LIMIT,
        MIN_MCP_LATENCY_SAMPLE_LIMIT,
        MAX_MCP_LATENCY_SAMPLE_LIMIT,
    );
    policy.call_timeout_ms = clamp_policy_u64(
        project_policy.call_timeout_ms,
        DEFAULT_MCP_CALL_TIMEOUT_MS,
        MIN_MCP_CALL_TIMEOUT_MS,
        MAX_MCP_CALL_TIMEOUT_MS,
    );
    policy.session_idle_ttl_secs = clamp_policy_u64(
        project_policy.session_idle_ttl_secs,
        DEFAULT_MCP_SESSION_IDLE_TTL_SECS,
        MIN_MCP_SESSION_IDLE_TTL_SECS,
        MAX_MCP_SESSION_IDLE_TTL_SECS,
    );
    policy.allow_tools = allow_tools;
    policy
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
