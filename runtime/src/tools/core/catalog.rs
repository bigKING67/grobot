fn command_available(name: &str) -> bool {
    let normalized = name.trim();
    if normalized.is_empty() {
        return false;
    }
    static COMMAND_CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = COMMAND_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(normalized).copied() {
            return value;
        }
    }
    let available = Command::new(normalized)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(normalized.to_string(), available);
    }
    available
}

fn normalize_tool_name(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

pub(crate) fn local_tool_catalog() -> Vec<LocalToolCatalogEntry> {
    vec![
        LocalToolCatalogEntry {
            name: TOOL_LIST,
            description: "List files/directories under workspace",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "minLength": 1 },
                    "recursive": { "type": "boolean" },
                    "max_entries": { "type": "integer", "minimum": 1, "maximum": MAX_ENTRIES_LIMIT }
                },
                "additionalProperties": false
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_GLOB,
            description: "Find workspace paths by glob pattern. Prefer this for filename/path lookup questions.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "minLength": 1 },
                    "path": { "type": "string", "minLength": 1 },
                    "max_entries": { "type": "integer", "minimum": 1, "maximum": MAX_ENTRIES_LIMIT }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_SEARCH,
            description: "Literal lexical content search in workspace files (grep/rg style). Prefer for exact strings, symbols, errors, or scoped paths; this is not a filename finder.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "minLength": 1 },
                    "path": { "type": "string", "minLength": 1 },
                    "fixed": { "type": "boolean" },
                    "regex": { "type": "boolean" },
                    "case_sensitive": { "type": "boolean" },
                    "context_before": { "type": "integer", "minimum": 0, "maximum": MAX_SEARCH_CONTEXT_LINES },
                    "context_after": { "type": "integer", "minimum": 0, "maximum": MAX_SEARCH_CONTEXT_LINES },
                    "max_results": { "type": "integer", "minimum": 1, "maximum": MAX_RESULTS_LIMIT }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_READ,
            description: "Read file content",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "line_start": { "type": "integer" },
                    "line_end": { "type": "integer" },
                    "offset": { "type": "integer" },
                    "limit": { "type": "integer" },
                    "pages": { "type": "string" },
                    "include_metadata": { "type": "boolean" }
                },
                "required": ["path"]
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_WRITE,
            description: "Create or fully rewrite a text file. Existing files require a prior full read in the same session and stale targets are rejected.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_EDIT,
            description: "Apply one or more targeted text replacements in a text file. Requires a prior read in the same session and rejects stale targets.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_text": { "type": "string" },
                                "new_text": { "type": "string" }
                            },
                            "required": ["old_text", "new_text"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["path", "edits"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_BASH,
            description: "Run an allowlisted shell command with timeout and output truncation safeguards",
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_BASH_COMMAND_CHARS
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "minimum": MIN_BASH_TIMEOUT_MS,
                        "maximum": MAX_BASH_TIMEOUT_MS
                    },
                    "max_output_bytes": {
                        "type": "integer",
                        "minimum": MIN_BASH_MAX_OUTPUT_BYTES,
                        "maximum": MAX_BASH_MAX_OUTPUT_BYTES
                    },
                    "max_output_lines": {
                        "type": "integer",
                        "minimum": MIN_BASH_MAX_OUTPUT_LINES,
                        "maximum": MAX_BASH_MAX_OUTPUT_LINES
                    }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
            default_enabled: true,
        },
        LocalToolCatalogEntry {
            name: TOOL_MCP_SERVERS,
            description: "List MCP servers merged from global/project registry",
            parameters: json!({
                "type": "object",
                "properties": {
                    "ready_only": { "type": "boolean" },
                    "include_disabled": { "type": "boolean" }
                }
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_MCP_CALL,
            description: "Call one MCP tool via stdio",
            parameters: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "tool": { "type": "string" },
                    "arguments": { "type": "object" }
                },
                "required": ["server", "tool"]
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_WEB_SCAN,
            description: "Scan the user's real browser via TMWD by default. Use this as the primary browser reading tool for tabs, current page text, logged-in pages, and session-aware page inspection. Use tmwd_mode=remote_cdp only for explicit debug Chrome/CI contexts.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "tabs_only": { "type": "boolean", "default": false },
                    "text_only": { "type": "boolean", "default": false },
                    "main_only": { "type": "boolean", "default": false },
                    "main_only_fallback_to_full": { "type": "boolean", "default": true },
                    "main_only_min_chars": { "type": "number", "minimum": 100, "maximum": 10_000 },
                    "main_only_min_coverage": { "type": "number", "minimum": 0.05, "maximum": 0.95 },
                    "switch_tab_id": { "type": "string" },
                    "session_id": { "type": "string" },
                    "session_url_pattern": { "type": "string" },
                    "max_chars": { "type": "number", "minimum": 1_000, "maximum": 300_000 },
                    "tmwd_mode": { "type": "string", "enum": ["auto", "tmwd", "remote_cdp", "cdp"], "default": "tmwd" },
                    "tmwd_transport": { "type": "string", "enum": ["auto", "ws", "link"], "default": "auto" },
                    "tmwd_ws_endpoint": { "type": "string" },
                    "tmwd_link_endpoint": { "type": "string" },
                    "cdp_endpoint": { "type": "string" }
                },
                "additionalProperties": false
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_WEB_EXECUTE_JS,
            description: "Execute JavaScript or a GA-style browser bridge command in the user's real browser via TMWD by default. Use this as the primary browser action tool for navigation, DOM operations, DevTools bridge commands, cookies, tabs, and batch browser actions. Use tmwd_mode=remote_cdp only for explicit debug Chrome/CI contexts.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "script": { "type": "string" },
                    "code": { "type": "string" },
                    "tab_id": { "type": "string" },
                    "switch_tab_id": { "type": "string" },
                    "session_id": { "type": "string" },
                    "session_url_pattern": { "type": "string" },
                    "no_monitor": { "type": "boolean", "default": false },
                    "timeout_ms": { "type": "number", "minimum": 100, "maximum": 120_000 },
                    "tmwd_mode": { "type": "string", "enum": ["auto", "tmwd", "remote_cdp", "cdp"], "default": "tmwd" },
                    "tmwd_transport": { "type": "string", "enum": ["auto", "ws", "link"], "default": "auto" },
                    "tmwd_ws_endpoint": { "type": "string" },
                    "tmwd_link_endpoint": { "type": "string" },
                    "cdp_endpoint": { "type": "string" },
                    "target_url_contains": { "type": "string" },
                    "native_auto_fallback": { "type": "boolean", "default": false },
                    "native_auto_fallback_policy": {
                        "type": "string",
                        "enum": ["strict", "balanced", "aggressive"],
                        "default": "balanced"
                    },
                    "native_auto_execute": { "type": "boolean", "default": false },
                    "native_execute_action_scope": {
                        "type": "string",
                        "enum": ["non_pointer", "all"],
                        "default": "non_pointer"
                    },
                    "native_fallback_action": {
                        "type": "string",
                        "enum": [
                            "activate_window",
                            "move",
                            "click",
                            "double_click",
                            "press",
                            "type",
                            "paste",
                            "scroll",
                            "get_window_rect"
                        ]
                    },
                    "native_fallback_args": { "type": "object" },
                    "native_fallback_timeout_ms": { "type": "number", "minimum": 500, "maximum": 30_000 }
                },
                "anyOf": [
                    { "required": ["script"] },
                    { "required": ["code"] }
                ],
                "additionalProperties": false
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_SEMANTIC_SEARCH,
            description: "Conceptual semantic retrieval across code, memory, and wiki sources. Prefer for intent/topic questions over literal text matching; not intended for direct filename/path lookup.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "sources": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["code", "memory", "wiki"] }
                    },
                    "technical_terms": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "per_source_limit": { "type": "integer" },
                    "max_segments": { "type": "integer" },
                    "include_org": { "type": "boolean" },
                    "refresh": { "type": "string", "enum": ["auto", "force", "skip"] },
                    "timeout_ms": { "type": "integer" },
                    "bridge_script": { "type": "string" }
                },
                "required": ["query"]
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_PROMPT_ENHANCER,
            description: "Enhance prompt with semantic evidence and extracted technical terms",
            parameters: json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "sources": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["code", "memory", "wiki"] }
                    },
                    "explicit_paths": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "explicit_symbols": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "max_evidence": { "type": "integer" },
                    "include_org": { "type": "boolean" },
                    "refresh": { "type": "string", "enum": ["auto", "force", "skip"] },
                    "timeout_ms": { "type": "integer" },
                    "bridge_script": { "type": "string" }
                },
                "required": ["prompt"]
            }),
            default_enabled: false,
        },
        LocalToolCatalogEntry {
            name: TOOL_ASK_USER,
            description: "Interrupt current turn and ask user one or more structured clarification questions",
            parameters: json!({
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "header": { "type": "string" },
                                "question": { "type": "string" },
                                "options": {
                                    "type": "array",
                                    "items": {
                                        "oneOf": [
                                            { "type": "string" },
                                            {
                                                "type": "object",
                                                "properties": {
                                                    "label": { "type": "string" },
                                                    "description": { "type": "string" },
                                                    "value": { "type": "string" }
                                                },
                                                "required": ["label"]
                                            }
                                        ]
                                    }
                                }
                            },
                            "required": ["id", "header", "question"]
                        }
                    },
                    "blocking_node_id": { "type": "string" },
                    "default_on_timeout": { "type": "string" },
                    "resume_token": { "type": "string" }
                },
                "required": ["questions"]
            }),
            default_enabled: true,
        },
    ]
}

pub(crate) fn local_tool_definitions() -> Vec<Value> {
    local_tool_catalog()
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
            })
        })
        .collect()
}

pub(crate) fn default_enabled_local_tool_names() -> Vec<&'static str> {
    local_tool_catalog()
        .into_iter()
        .filter(|tool| tool.default_enabled)
        .map(|tool| tool.name)
        .collect()
}

fn default_enabled_tools() -> HashSet<String> {
    default_enabled_local_tool_names()
        .into_iter()
        .map(|item| item.to_string())
        .collect()
}
