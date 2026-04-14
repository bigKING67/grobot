use crate::models::engine::TurnExecuteInput;
use globset::{Glob, GlobSetBuilder};
use regex::RegexBuilder;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use walkdir::WalkDir;

const TOOL_LIST: &str = "list";
const TOOL_GLOB: &str = "glob";
const TOOL_SEARCH: &str = "search";
const TOOL_READ: &str = "read";
const TOOL_WRITE: &str = "write";
const TOOL_EDIT: &str = "edit";
const TOOL_BASH: &str = "bash";
const TOOL_MCP_SERVERS: &str = "mcp_servers";
const TOOL_MCP_CALL: &str = "mcp_call";

const DEFAULT_MAX_RESULTS: usize = 50;
const MAX_RESULTS_LIMIT: usize = 1_000;
const DEFAULT_MAX_ENTRIES: usize = 200;
const MAX_ENTRIES_LIMIT: usize = 5_000;

#[derive(Debug, Clone)]
pub struct ToolCallInput {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone)]
pub struct ToolCallOutput {
    pub content: String,
}

impl ToolCallOutput {
    fn from_payload(payload: Value) -> Self {
        let content = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
        Self { content }
    }
}

#[derive(Debug, Clone)]
pub struct ToolExecutionError {
    pub error_class: String,
    pub message: String,
}

impl ToolExecutionError {
    pub fn new(error_class: &str, message: impl Into<String>) -> Self {
        Self {
            error_class: error_class.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
struct ToolContextResolved {
    work_dir: PathBuf,
    enabled_tools: HashSet<String>,
    bash_allowlist: Vec<String>,
}

#[derive(Debug, Clone)]
struct McpServerResolved {
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    enabled: bool,
    source: String,
    ready: bool,
    ready_reason: String,
}

#[derive(Debug, Clone, Default)]
struct McpCallPolicy {
    allow_tools: Vec<String>,
}

#[derive(Debug, Clone)]
struct McpCallExecution {
    available_tools: Vec<String>,
    is_error: bool,
    content: Value,
    raw_preview: String,
    structured_content_preview: String,
}

#[derive(Debug, Deserialize, Default)]
struct McpServerRegistryFile {
    #[serde(default)]
    servers: Vec<McpServerFileEntry>,
}

#[derive(Debug, Deserialize, Default)]
struct McpServerFileEntry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    env: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
struct ProjectPolicyConfigFile {
    #[serde(default)]
    tools: ProjectToolsPolicy,
}

#[derive(Debug, Deserialize, Default)]
struct ProjectToolsPolicy {
    #[serde(default)]
    mcp: ProjectMcpPolicy,
}

#[derive(Debug, Deserialize, Default)]
struct ProjectMcpPolicy {
    #[serde(default)]
    allow_tools: Vec<String>,
}

pub trait ToolExecutor {
    fn before_turn(&self, _input: &TurnExecuteInput) {}

    fn after_turn(&self, _input: &TurnExecuteInput) {}

    fn execute_tool_call(
        &self,
        call: &ToolCallInput,
        _input: &TurnExecuteInput,
    ) -> Result<ToolCallOutput, ToolExecutionError> {
        Err(ToolExecutionError::new(
            "tool_call_not_supported",
            format!("runtime v1 does not support tool calls yet: {}", call.name),
        ))
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct LocalToolExecutor;

fn command_available(name: &str) -> bool {
    Command::new(name)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn normalize_tool_name(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

fn default_enabled_tools() -> HashSet<String> {
    [
        TOOL_LIST,
        TOOL_GLOB,
        TOOL_SEARCH,
        TOOL_READ,
        TOOL_WRITE,
        TOOL_EDIT,
        TOOL_BASH,
        TOOL_MCP_SERVERS,
        TOOL_MCP_CALL,
    ]
    .iter()
    .map(|item| item.to_string())
    .collect()
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
        let global_registry = PathBuf::from(home).join(".grobot").join("mcp").join("servers.toml");
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
    let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) else {
        return McpCallPolicy::default();
    };
    let project_toml = project_grobot_dir.join("project.toml");
    let parsed = match parse_toml_file::<ProjectPolicyConfigFile>(&project_toml) {
        Some(parsed) => parsed,
        None => return McpCallPolicy::default(),
    };
    let allow_tools = parsed
        .tools
        .mcp
        .allow_tools
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect::<Vec<String>>();
    McpCallPolicy { allow_tools }
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

fn parse_tool_context(input: &TurnExecuteInput) -> Result<ToolContextResolved, ToolExecutionError> {
    let tool_context = input
        .tool_context
        .as_ref()
        .ok_or_else(|| ToolExecutionError::new("tool_context_missing", "runtime tool context is required"))?;
    let raw_work_dir = tool_context
        .work_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ToolExecutionError::new("tool_context_missing", "tool_context.work_dir is required"))?;
    let canonical_work_dir = fs::canonicalize(raw_work_dir).map_err(|error| {
        ToolExecutionError::new(
            "tool_context_invalid",
            format!("failed to resolve work_dir: {error}"),
        )
    })?;
    if !canonical_work_dir.is_dir() {
        return Err(ToolExecutionError::new(
            "tool_context_invalid",
            "tool_context.work_dir is not a directory",
        ));
    }
    let enabled_tools = match tool_context.enabled_tools.as_ref() {
        Some(values) => {
            let mut set = HashSet::new();
            for item in values {
                let normalized = normalize_tool_name(item);
                if normalized.is_empty() {
                    continue;
                }
                set.insert(normalized);
            }
            set
        }
        None => default_enabled_tools(),
    };
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
    Ok(ToolContextResolved {
        work_dir: canonical_work_dir,
        enabled_tools,
        bash_allowlist,
    })
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

fn get_string_arg(args: &Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn get_bool_arg(args: &Map<String, Value>, key: &str, fallback: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn get_usize_arg(args: &Map<String, Value>, key: &str, fallback: usize, max: usize) -> usize {
    let parsed = args
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(fallback);
    parsed.clamp(1, max)
}

fn get_i64_arg(args: &Map<String, Value>, key: &str, fallback: i64, min: i64, max: i64) -> i64 {
    let parsed = args.get(key).and_then(Value::as_i64).unwrap_or(fallback);
    parsed.clamp(min, max)
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
        })?
    } else if allow_missing_leaf {
        let parent = candidate.parent().ok_or_else(|| {
            ToolExecutionError::new("path_invalid", "path parent is invalid")
        })?;
        let resolved_parent = fs::canonicalize(parent).map_err(|error| {
            ToolExecutionError::new("path_invalid", format!("failed to resolve parent: {error}"))
        })?;
        let file_name = candidate.file_name().ok_or_else(|| {
            ToolExecutionError::new("path_invalid", "path filename is invalid")
        })?;
        resolved_parent.join(file_name)
    } else {
        return Err(ToolExecutionError::new(
            "path_not_found",
            format!("path not found: {}", candidate.display()),
        ));
    };
    if !resolved.starts_with(work_dir) {
        return Err(ToolExecutionError::new(
            "path_escape_blocked",
            "path escapes workspace",
        ));
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

fn run_list(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path").unwrap_or_else(|| ".".to_string());
    let recursive = get_bool_arg(args, "recursive", false);
    let max_entries = get_usize_arg(args, "max_entries", DEFAULT_MAX_ENTRIES, MAX_ENTRIES_LIMIT);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_dir() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("list target is not a directory: {}", target.display()),
        ));
    }
    let mut entries: Vec<String> = Vec::new();
    if recursive {
        for item in WalkDir::new(&target).min_depth(1) {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            entries.push(relative_to_work_dir(&context.work_dir, entry.path()));
            if entries.len() >= max_entries {
                break;
            }
        }
    } else {
        let read_dir = fs::read_dir(&target).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to read directory: {error}"),
            )
        })?;
        for item in read_dir {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            entries.push(relative_to_work_dir(&context.work_dir, &entry.path()));
            if entries.len() >= max_entries {
                break;
            }
        }
    }
    entries.sort();
    let payload = json!({
        "tool": TOOL_LIST,
        "count": entries.len(),
        "entries": entries,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_glob(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let pattern = get_string_arg(args, "pattern")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "glob.pattern is required"))?;
    let path = get_string_arg(args, "path").unwrap_or_else(|| ".".to_string());
    let max_entries = get_usize_arg(args, "max_entries", DEFAULT_MAX_ENTRIES, MAX_ENTRIES_LIMIT);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_dir() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("glob target is not a directory: {}", target.display()),
        ));
    }
    let mut matches: Vec<String> = Vec::new();
    if command_available("fd") {
        let output = Command::new("fd")
            .arg("--hidden")
            .arg("--strip-cwd-prefix")
            .arg("--glob")
            .arg(&pattern)
            .arg(".")
            .current_dir(&target)
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                let root_rel = relative_to_work_dir(&context.work_dir, &target);
                for raw in String::from_utf8_lossy(&output.stdout).lines() {
                    let line = raw.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let composed = if root_rel == "." {
                        line.to_string()
                    } else {
                        format!("{root_rel}/{line}")
                    };
                    matches.push(composed);
                    if matches.len() >= max_entries {
                        break;
                    }
                }
                matches.sort();
                matches.dedup();
                let payload = json!({
                    "tool": TOOL_GLOB,
                    "count": matches.len(),
                    "matches": matches,
                    "engine": "fd",
                });
                return Ok(ToolCallOutput::from_payload(payload));
            }
        }
    }

    let mut builder = GlobSetBuilder::new();
    let glob = Glob::new(&pattern).map_err(|error| {
        ToolExecutionError::new("invalid_tool_arguments", format!("invalid glob pattern: {error}"))
    })?;
    builder.add(glob);
    let matcher = builder.build().map_err(|error| {
        ToolExecutionError::new("invalid_tool_arguments", format!("invalid glob matcher: {error}"))
    })?;
    for item in WalkDir::new(&target).min_depth(1) {
        let entry = match item {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let relative = entry.path().strip_prefix(&target).unwrap_or(entry.path());
        if !matcher.is_match(relative) {
            continue;
        }
        matches.push(relative_to_work_dir(&context.work_dir, entry.path()));
        if matches.len() >= max_entries {
            break;
        }
    }
    matches.sort();
    matches.dedup();
    let payload = json!({
        "tool": TOOL_GLOB,
        "count": matches.len(),
        "matches": matches,
        "engine": "builtin",
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn parse_search_match_line(raw: &str) -> Option<(String, usize, String)> {
    let mut parts = raw.splitn(3, ':');
    let path = parts.next()?.trim();
    let line = parts.next()?.trim();
    let text = parts.next()?.to_string();
    let line_number = line.parse::<usize>().ok()?;
    if path.is_empty() || line_number == 0 {
        return None;
    }
    Some((path.to_string(), line_number, text))
}

fn run_search(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let query = get_string_arg(args, "query")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "search.query is required"))?;
    let path = get_string_arg(args, "path").unwrap_or_else(|| ".".to_string());
    let max_results = get_usize_arg(args, "max_results", DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT);
    let context_before = get_i64_arg(args, "context_before", 0, 0, 16) as usize;
    let context_after = get_i64_arg(args, "context_after", 0, 0, 16) as usize;
    let regex_mode = get_bool_arg(args, "regex", false);
    let fixed_mode = if regex_mode {
        false
    } else {
        get_bool_arg(args, "fixed", true)
    };
    let case_sensitive = get_bool_arg(args, "case_sensitive", false);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;

    if command_available("rg") && context_before == 0 && context_after == 0 {
        let mut command = Command::new("rg");
        command
            .arg("--line-number")
            .arg("--no-heading")
            .arg("--color")
            .arg("never");
        if fixed_mode {
            command.arg("--fixed-strings");
        }
        if !case_sensitive {
            command.arg("--ignore-case");
        }
        command.arg(&query);
        if target.is_file() {
            command.arg(&target);
        } else {
            command.arg(".");
            command.current_dir(&target);
        }
        if let Ok(output) = command.output() {
            if output.status.success() || output.status.code() == Some(1) {
                let mut matches: Vec<Value> = Vec::new();
                let root_rel = if target.is_file() {
                    target.parent().map(|value| relative_to_work_dir(&context.work_dir, value))
                } else {
                    Some(relative_to_work_dir(&context.work_dir, &target))
                };
                for raw in String::from_utf8_lossy(&output.stdout).lines() {
                    if let Some((path_text, line_number, text)) = parse_search_match_line(raw) {
                        let normalized_path = match &root_rel {
                            Some(prefix) if prefix != "." && !target.is_file() => {
                                format!("{prefix}/{path_text}")
                            }
                            _ if target.is_file() => relative_to_work_dir(&context.work_dir, &target),
                            _ => path_text,
                        };
                        matches.push(json!({
                            "path": normalized_path,
                            "line": line_number,
                            "text": text,
                        }));
                        if matches.len() >= max_results {
                            break;
                        }
                    }
                }
                let payload = json!({
                    "tool": TOOL_SEARCH,
                    "count": matches.len(),
                    "matches": matches,
                    "engine": "rg",
                });
                return Ok(ToolCallOutput::from_payload(payload));
            }
        }
    }

    let mut files: Vec<PathBuf> = Vec::new();
    if target.is_file() {
        files.push(target.clone());
    } else if target.is_dir() {
        for item in WalkDir::new(&target).into_iter() {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            files.push(entry.path().to_path_buf());
        }
    } else {
        return Err(ToolExecutionError::new(
            "path_invalid",
            "search target must be file or directory",
        ));
    }

    let regex = if fixed_mode {
        None
    } else {
        Some(
            RegexBuilder::new(&query)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|error| {
                    ToolExecutionError::new(
                        "invalid_tool_arguments",
                        format!("invalid regex query: {error}"),
                    )
                })?,
        )
    };
    let needle_lower = if fixed_mode && !case_sensitive {
        Some(query.to_lowercase())
    } else {
        None
    };
    let mut matches: Vec<Value> = Vec::new();
    'file_loop: for file in files {
        let bytes = match fs::read(&file) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.iter().take(1024).any(|byte| *byte == 0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = content.lines().collect();
        for (index, line) in lines.iter().enumerate() {
            let matched = if fixed_mode {
                if case_sensitive {
                    line.contains(&query)
                } else if let Some(needle) = needle_lower.as_ref() {
                    line.to_lowercase().contains(needle)
                } else {
                    false
                }
            } else if let Some(compiled) = regex.as_ref() {
                compiled.is_match(line)
            } else {
                false
            };
            if !matched {
                continue;
            }
            let line_number = index + 1;
            if context_before == 0 && context_after == 0 {
                matches.push(json!({
                    "path": relative_to_work_dir(&context.work_dir, &file),
                    "line": line_number,
                    "text": *line,
                }));
            } else {
                let start = index.saturating_sub(context_before);
                let end = std::cmp::min(lines.len().saturating_sub(1), index + context_after);
                let mut records: Vec<Value> = Vec::new();
                for row in start..=end {
                    records.push(json!({
                        "line": row + 1,
                        "match": row == index,
                        "text": lines[row],
                    }));
                }
                matches.push(json!({
                    "path": relative_to_work_dir(&context.work_dir, &file),
                    "line": line_number,
                    "records": records,
                }));
            }
            if matches.len() >= max_results {
                break 'file_loop;
            }
        }
    }
    let payload = json!({
        "tool": TOOL_SEARCH,
        "count": matches.len(),
        "matches": matches,
        "engine": "builtin",
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_read(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "read.path is required"))?;
    let line_start = get_usize_arg(args, "line_start", 1, usize::MAX);
    let line_end_raw = args.get("line_end").and_then(Value::as_u64).map(|value| value as usize);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_file() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("read target is not a file: {}", target.display()),
        ));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}"))
    })?;
    let lines: Vec<&str> = content.lines().collect();
    if line_start == 0 {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "line_start must be >= 1",
        ));
    }
    let start = line_start.saturating_sub(1);
    let end = line_end_raw.unwrap_or(lines.len()).max(line_start);
    let mut selected: Vec<&str> = Vec::new();
    for index in start..std::cmp::min(end, lines.len()) {
        selected.push(lines[index]);
    }
    let selected_text = selected.join("\n");
    let payload = json!({
        "tool": TOOL_READ,
        "path": relative_to_work_dir(&context.work_dir, &target),
        "line_start": line_start,
        "line_end": if selected.is_empty() { line_start.saturating_sub(1) } else { line_start + selected.len() - 1 },
        "content": selected_text,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_write(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "write.path is required"))?;
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "write.content is required"))?;
    let append = get_bool_arg(args, "append", false);
    let target = ensure_within_workspace(&context.work_dir, &path, true)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to create parent directories: {error}"),
            )
        })?;
    }
    if append {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target)
            .map_err(|error| {
                ToolExecutionError::new(
                    "tool_execution_failed",
                    format!("failed to open file for append: {error}"),
                )
            })?;
        file.write_all(content.as_bytes()).map_err(|error| {
            ToolExecutionError::new("tool_execution_failed", format!("failed to append file: {error}"))
        })?;
    } else {
        fs::write(&target, content.as_bytes()).map_err(|error| {
            ToolExecutionError::new("tool_execution_failed", format!("failed to write file: {error}"))
        })?;
    }
    let payload = json!({
        "tool": TOOL_WRITE,
        "path": relative_to_work_dir(&context.work_dir, &target),
        "bytes_written": content.as_bytes().len(),
        "append": append,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_edit(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let path = get_string_arg(args, "path")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "edit.path is required"))?;
    let old_text = args
        .get("old_text")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "edit.old_text is required"))?;
    if old_text.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "edit.old_text cannot be empty",
        ));
    }
    let new_text = args
        .get("new_text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let replace_all = get_bool_arg(args, "replace_all", false);
    let target = ensure_within_workspace(&context.work_dir, &path, false)?;
    if !target.is_file() {
        return Err(ToolExecutionError::new(
            "path_invalid",
            format!("edit target is not a file: {}", target.display()),
        ));
    }
    let content = fs::read_to_string(&target).map_err(|error| {
        ToolExecutionError::new("tool_execution_failed", format!("failed to read file: {error}"))
    })?;
    let occurrences = content.matches(&old_text).count();
    if occurrences == 0 {
        return Err(ToolExecutionError::new(
            "edit_not_found",
            "old_text not found in file",
        ));
    }
    let replacements = if replace_all { occurrences } else { 1 };
    let updated = if replace_all {
        content.replace(&old_text, &new_text)
    } else {
        content.replacen(&old_text, &new_text, 1)
    };
    fs::write(&target, updated.as_bytes()).map_err(|error| {
        ToolExecutionError::new("tool_execution_failed", format!("failed to write file: {error}"))
    })?;
    let payload = json!({
        "tool": TOOL_EDIT,
        "path": relative_to_work_dir(&context.work_dir, &target),
        "occurrences_found": occurrences,
        "replacements": replacements,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn is_bash_allowed(command: &str, allowlist: &[String]) -> bool {
    let normalized_command = command.trim();
    if normalized_command.is_empty() {
        return false;
    }
    for rule in allowlist {
        let normalized_rule = rule.trim();
        if normalized_rule.is_empty() {
            continue;
        }
        if normalized_rule == "*" {
            return true;
        }
        if let Some(prefix) = normalized_rule.strip_suffix('*') {
            if normalized_command.starts_with(prefix) {
                return true;
            }
            continue;
        }
        if normalized_command == normalized_rule {
            return true;
        }
        let prefix = format!("{normalized_rule} ");
        if normalized_command.starts_with(&prefix) {
            return true;
        }
    }
    false
}

fn run_bash(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let command = get_string_arg(args, "command")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "bash.command is required"))?;
    if !is_bash_allowed(&command, &context.bash_allowlist) {
        return Err(ToolExecutionError::new(
            "bash_not_allowed",
            "command not allowed by allowlist",
        ));
    }
    let output = Command::new("bash")
        .arg("-lc")
        .arg(&command)
        .current_dir(&context.work_dir)
        .output()
        .map_err(|error| {
            ToolExecutionError::new("tool_execution_failed", format!("bash execution failed: {error}"))
        })?;
    let stdout = truncate_output(String::from_utf8_lossy(&output.stdout).to_string(), 8_000);
    let stderr = truncate_output(String::from_utf8_lossy(&output.stderr).to_string(), 8_000);
    let payload = json!({
        "tool": TOOL_BASH,
        "exit_code": output.status.code().unwrap_or(-1),
        "stdout": stdout,
        "stderr": stderr,
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn write_mcp_message(stdin: &mut ChildStdin, payload: &Value) -> Result<(), ToolExecutionError> {
    let body = serde_json::to_string(payload).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("failed to serialize MCP payload: {error}"),
        )
    })?;
    let header = format!("Content-Length: {}\r\n\r\n", body.as_bytes().len());
    stdin.write_all(header.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP header: {error}"),
        )
    })?;
    stdin.write_all(body.as_bytes()).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to write MCP body: {error}"),
        )
    })?;
    stdin.flush().map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to flush MCP request: {error}"),
        )
    })?;
    Ok(())
}

fn read_mcp_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, ToolExecutionError> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(|error| {
            ToolExecutionError::new(
                "mcp_transport_error",
                format!("failed to read MCP header line: {error}"),
            )
        })?;
        if read == 0 {
            return Err(ToolExecutionError::new(
                "mcp_transport_error",
                "MCP server closed stdout before response",
            ));
        }
        let normalized = line.trim_end_matches(['\r', '\n']);
        if normalized.is_empty() {
            break;
        }
        let mut parts = normalized.splitn(2, ':');
        let name = parts.next().unwrap_or("").trim().to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();
        if name == "content-length" {
            let parsed = value.parse::<usize>().map_err(|error| {
                ToolExecutionError::new(
                    "mcp_protocol_error",
                    format!("invalid MCP content-length header: {error}"),
                )
            })?;
            content_length = Some(parsed);
        }
    }
    let length = content_length.ok_or_else(|| {
        ToolExecutionError::new("mcp_protocol_error", "MCP response missing content-length")
    })?;
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_transport_error",
            format!("failed to read MCP response body: {error}"),
        )
    })?;
    serde_json::from_slice::<Value>(&body).map_err(|error| {
        ToolExecutionError::new(
            "mcp_protocol_error",
            format!("invalid MCP JSON payload: {error}"),
        )
    })
}

fn read_mcp_result_for_id(
    reader: &mut BufReader<ChildStdout>,
    request_id: i64,
) -> Result<Value, ToolExecutionError> {
    for _ in 0..64 {
        let message = read_mcp_message(reader)?;
        let id = message.get("id");
        let matched = match id {
            Some(value) => value.as_i64() == Some(request_id),
            None => false,
        };
        if !matched {
            continue;
        }
        if let Some(error) = message.get("error") {
            let detail = serde_json::to_string(error).unwrap_or_else(|_| "{}".to_string());
            return Err(ToolExecutionError::new(
                "mcp_rpc_error",
                format!("MCP response contains error: {detail}"),
            ));
        }
        return Ok(message.get("result").cloned().unwrap_or_else(|| json!({})));
    }
    Err(ToolExecutionError::new(
        "mcp_protocol_error",
        "MCP response id not observed within read budget",
    ))
}

fn extract_mcp_tool_names(payload: &Value) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let Some(tools) = payload.get("tools").and_then(Value::as_array) else {
        return names;
    };
    for item in tools {
        let Some(name) = item.get("name").and_then(Value::as_str) else {
            continue;
        };
        let normalized = name.trim();
        if normalized.is_empty() {
            continue;
        }
        names.push(normalized.to_string());
    }
    names.sort();
    names.dedup();
    names
}

fn stringify_value_preview(value: &Value, max_chars: usize) -> String {
    let text = if let Some(raw) = value.as_str() {
        raw.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
    };
    truncate_output(text, max_chars)
}

fn extract_raw_preview(content: &Value) -> String {
    if let Some(parts) = content.as_array() {
        for item in parts {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                let normalized = text.trim();
                if !normalized.is_empty() {
                    return truncate_output(normalized.to_string(), 512);
                }
            }
        }
    }
    stringify_value_preview(content, 512)
}

fn run_mcp_stdio_call(
    context: &ToolContextResolved,
    server: &McpServerResolved,
    tool_name: &str,
    arguments: &Map<String, Value>,
) -> Result<McpCallExecution, ToolExecutionError> {
    let mut command = Command::new(&server.command);
    command.args(&server.args);
    command.current_dir(&context.work_dir);
    for (key, value) in &server.env {
        command.env(key, value);
    }
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| {
        ToolExecutionError::new(
            "mcp_spawn_failed",
            format!("failed to spawn MCP server `{}`: {error}", server.command),
        )
    })?;
    let mut stdin = child.stdin.take().ok_or_else(|| {
        ToolExecutionError::new("mcp_transport_error", "missing MCP stdin pipe")
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ToolExecutionError::new("mcp_transport_error", "missing MCP stdout pipe")
    })?;
    let mut reader = BufReader::new(stdout);
    let execution = (|| -> Result<McpCallExecution, ToolExecutionError> {
        write_mcp_message(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "grobot-runtime",
                        "version": "0.1.0"
                    }
                }
            }),
        )?;
        let _initialize_result = read_mcp_result_for_id(&mut reader, 1)?;
        write_mcp_message(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {}
            }),
        )?;
        write_mcp_message(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {}
            }),
        )?;
        let listed_tools = read_mcp_result_for_id(&mut reader, 2)?;
        let available_tools = extract_mcp_tool_names(&listed_tools);
        if !available_tools.iter().any(|candidate| candidate == tool_name) {
            return Err(ToolExecutionError::new(
                "mcp_tool_not_found",
                format!("MCP tool `{tool_name}` not found on server `{}`", server.name),
            ));
        }
        write_mcp_message(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": Value::Object(arguments.clone())
                }
            }),
        )?;
        let call_result = read_mcp_result_for_id(&mut reader, 3)?;
        let is_error = call_result
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let content = call_result
            .get("content")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let raw_preview = extract_raw_preview(&content);
        let structured_content_preview = call_result
            .get("structuredContent")
            .map(|value| stringify_value_preview(value, 512))
            .unwrap_or_default();
        Ok(McpCallExecution {
            available_tools,
            is_error,
            content,
            raw_preview,
            structured_content_preview,
        })
    })();
    let _ = child.kill();
    let _ = child.wait();
    execution
}

fn run_mcp_servers(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let ready_only = get_bool_arg(args, "ready_only", false);
    let include_disabled = get_bool_arg(args, "include_disabled", true);
    let policy = load_mcp_call_policy(context);
    let mut servers_payload: Vec<Value> = Vec::new();
    let servers = load_mcp_servers(context);
    let mut total = 0usize;
    let mut enabled_count = 0usize;
    let mut ready_count = 0usize;
    for server in servers {
        if !include_disabled && !server.enabled {
            continue;
        }
        if ready_only && !server.ready {
            continue;
        }
        total += 1;
        if server.enabled {
            enabled_count += 1;
        }
        if server.ready {
            ready_count += 1;
        }
        servers_payload.push(json!({
            "name": server.name,
            "enabled": server.enabled,
            "ready": server.ready,
            "ready_reason": server.ready_reason,
            "source": server.source,
            "command": server.command,
            "args": server.args,
            "runtime_state": {
                "total_calls": 0,
                "success_calls": 0,
                "failure_calls": 0,
                "policy_denied_calls": 0,
                "gate_rejected_calls": 0,
                "timeout_failures": 0,
                "transport_failures": 0,
                "tool_failures": 0,
                "unknown_failures": 0,
            }
        }));
    }
    let payload = json!({
        "tool": TOOL_MCP_SERVERS,
        "total": total,
        "enabled_count": enabled_count,
        "ready_count": ready_count,
        "servers": servers_payload,
        "policy": {
            "allow_tools": policy.allow_tools,
        }
    });
    Ok(ToolCallOutput::from_payload(payload))
}

fn run_mcp_call(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let server_name = get_string_arg(args, "server")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "mcp_call.server is required"))?;
    let tool_name = get_string_arg(args, "tool")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "mcp_call.tool is required"))?;
    let raw_arguments = args.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let call_arguments = raw_arguments.as_object().cloned().ok_or_else(|| {
        ToolExecutionError::new("invalid_tool_arguments", "mcp_call.arguments must be an object")
    })?;
    let policy = load_mcp_call_policy(context);
    if !mcp_tool_allowed(&policy, &tool_name) {
        return Err(ToolExecutionError::new(
            "mcp_tool_blocked",
            format!("MCP tool \"{tool_name}\" blocked by [tools.mcp].allow_tools"),
        ));
    }
    let servers = load_mcp_servers(context);
    let server = servers
        .iter()
        .find(|candidate| candidate.name == server_name)
        .ok_or_else(|| {
            ToolExecutionError::new(
                "mcp_server_not_found",
                format!("MCP server not found: {server_name}"),
            )
        })?;
    if !server.enabled {
        return Err(ToolExecutionError::new(
            "mcp_server_unready",
            format!("MCP server `{}` is disabled", server.name),
        ));
    }
    if !server.ready {
        return Err(ToolExecutionError::new(
            "mcp_server_unready",
            format!(
                "MCP server `{}` is unready: {}",
                server.name, server.ready_reason
            ),
        ));
    }
    let executed = run_mcp_stdio_call(context, server, &tool_name, &call_arguments)?;
    let payload = json!({
        "tool": TOOL_MCP_CALL,
        "status": "ok",
        "server": server.name,
        "tool_name": tool_name,
        "available_tools": executed.available_tools,
        "session_reused": false,
        "session_recovered": false,
        "runtime_state": {
            "total_calls": 1,
            "success_calls": if executed.is_error { 0 } else { 1 },
            "failure_calls": if executed.is_error { 1 } else { 0 },
            "policy_denied_calls": 0,
            "gate_rejected_calls": 0,
            "timeout_failures": 0,
            "transport_failures": 0,
            "tool_failures": if executed.is_error { 1 } else { 0 },
            "unknown_failures": 0,
        },
        "result": {
            "is_error": executed.is_error,
            "content": executed.content,
            "raw_preview": executed.raw_preview,
            "structured_content_preview": executed.structured_content_preview,
        }
    });
    Ok(ToolCallOutput::from_payload(payload))
}

impl ToolExecutor for LocalToolExecutor {
    fn execute_tool_call(
        &self,
        call: &ToolCallInput,
        input: &TurnExecuteInput,
    ) -> Result<ToolCallOutput, ToolExecutionError> {
        let tool_name = normalize_tool_name(&call.name);
        let context = parse_tool_context(input)?;
        if !context.enabled_tools.contains(&tool_name) {
            return Err(ToolExecutionError::new(
                "tool_disabled",
                format!("tool is disabled by runtime context: {tool_name}"),
            ));
        }
        let args = value_object(&call.arguments, &tool_name)?;
        match tool_name.as_str() {
            TOOL_LIST => run_list(&context, args),
            TOOL_GLOB => run_glob(&context, args),
            TOOL_SEARCH => run_search(&context, args),
            TOOL_READ => run_read(&context, args),
            TOOL_WRITE => run_write(&context, args),
            TOOL_EDIT => run_edit(&context, args),
            TOOL_BASH => run_bash(&context, args),
            TOOL_MCP_SERVERS => run_mcp_servers(&context, args),
            TOOL_MCP_CALL => run_mcp_call(&context, args),
            _ => Err(ToolExecutionError::new(
                "tool_call_not_supported",
                format!("runtime v1 does not support tool calls yet: {}", call.name),
            )),
        }
    }
}
