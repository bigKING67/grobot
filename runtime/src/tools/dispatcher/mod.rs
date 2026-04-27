const OVERLAP_GUARD_MAX_TURN_KEYS: usize = 256;
const FILE_LOOKUP_HINT_KEYWORDS: [&str; 22] = [
    "file",
    "filename",
    "file name",
    "path",
    "folder",
    "directory",
    "where is",
    "which file",
    "locate",
    "pdf",
    "invoice",
    "文件",
    "文件名",
    "文件夹",
    "路径",
    "目录",
    "地址",
    "在哪",
    "在哪里",
    "发票",
    ".pdf",
    ".doc",
];

#[derive(Debug, Default)]
struct SearchSemanticOverlapStore {
    turns: HashMap<String, SearchSemanticOverlapTurnState>,
    order: VecDeque<String>,
}

#[derive(Debug, Default)]
struct SearchSemanticOverlapTurnState {
    broad_search_queries: HashSet<String>,
    broad_semantic_queries: HashSet<String>,
}

#[derive(Debug, Default, Clone, Copy)]
struct SearchSemanticOverlapMetrics {
    blocked_total: u64,
    blocked_search: u64,
    blocked_semantic: u64,
    recorded_broad_search: u64,
    recorded_broad_semantic: u64,
}

#[derive(Debug, Clone)]
enum SearchSemanticToolKind {
    Search,
    SemanticSearch,
}

#[derive(Debug, Clone)]
struct SearchSemanticOverlapCandidate {
    kind: SearchSemanticToolKind,
    normalized_query: String,
    is_broad: bool,
}

fn overlap_store() -> &'static Mutex<SearchSemanticOverlapStore> {
    static STORE: OnceLock<Mutex<SearchSemanticOverlapStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(SearchSemanticOverlapStore::default()))
}

fn overlap_metrics_store() -> &'static Mutex<SearchSemanticOverlapMetrics> {
    static STORE: OnceLock<Mutex<SearchSemanticOverlapMetrics>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(SearchSemanticOverlapMetrics::default()))
}

fn overlap_turn_key(input: &TurnExecuteInput) -> String {
    format!(
        "{}::{}",
        input.session_key.trim().to_ascii_lowercase(),
        input.request_id.trim().to_ascii_lowercase()
    )
}

fn normalize_overlap_query(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .trim()
        .to_ascii_lowercase()
}

fn parse_overlap_query(args: &Map<String, Value>) -> Option<String> {
    let query = args.get("query")?.as_str()?.trim();
    if query.is_empty() {
        return None;
    }
    let normalized = normalize_overlap_query(query);
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn query_is_file_lookup_intent(normalized_query: &str) -> bool {
    if normalized_query.trim().is_empty() {
        return false;
    }
    FILE_LOOKUP_HINT_KEYWORDS
        .iter()
        .any(|keyword| normalized_query.contains(keyword))
}

fn record_overlap_blocked_metric(kind: &SearchSemanticToolKind) {
    if let Ok(mut metrics) = overlap_metrics_store().lock() {
        metrics.blocked_total = metrics.blocked_total.saturating_add(1);
        match kind {
            SearchSemanticToolKind::Search => {
                metrics.blocked_search = metrics.blocked_search.saturating_add(1);
            }
            SearchSemanticToolKind::SemanticSearch => {
                metrics.blocked_semantic = metrics.blocked_semantic.saturating_add(1);
            }
        }
    }
}

fn record_overlap_recorded_metric(kind: &SearchSemanticToolKind) {
    if let Ok(mut metrics) = overlap_metrics_store().lock() {
        match kind {
            SearchSemanticToolKind::Search => {
                metrics.recorded_broad_search = metrics.recorded_broad_search.saturating_add(1);
            }
            SearchSemanticToolKind::SemanticSearch => {
                metrics.recorded_broad_semantic =
                    metrics.recorded_broad_semantic.saturating_add(1);
            }
        }
    }
}

pub(crate) fn overlap_guard_metrics_snapshot() -> Value {
    let store_snapshot = overlap_store()
        .lock()
        .ok()
        .map(|store| (store.turns.len(), store.order.len()))
        .unwrap_or((0usize, 0usize));
    let metrics_snapshot = overlap_metrics_store()
        .lock()
        .ok()
        .map(|metrics| *metrics)
        .unwrap_or_default();
    json!({
        "blocked_total": metrics_snapshot.blocked_total,
        "blocked_search": metrics_snapshot.blocked_search,
        "blocked_semantic": metrics_snapshot.blocked_semantic,
        "recorded_broad_search": metrics_snapshot.recorded_broad_search,
        "recorded_broad_semantic": metrics_snapshot.recorded_broad_semantic,
        "tracked_turn_keys": store_snapshot.0,
        "tracked_turn_order": store_snapshot.1,
        "max_turn_keys": OVERLAP_GUARD_MAX_TURN_KEYS
    })
}

fn parse_u64_arg(args: &Map<String, Value>, key: &str, fallback: u64) -> u64 {
    args.get(key).and_then(Value::as_u64).unwrap_or(fallback)
}

fn parse_bool_arg(args: &Map<String, Value>, key: &str, fallback: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn is_broad_search_request(args: &Map<String, Value>) -> bool {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or(".");
    let regex = parse_bool_arg(args, "regex", false);
    let context_before = parse_u64_arg(args, "context_before", 0);
    let context_after = parse_u64_arg(args, "context_after", 0);
    let scoped_path = path != ".";
    !scoped_path && !regex && context_before == 0 && context_after == 0
}

fn is_broad_semantic_search_request(args: &Map<String, Value>) -> bool {
    let include_org = parse_bool_arg(args, "include_org", false);
    let technical_terms = args
        .get("technical_terms")
        .and_then(Value::as_array)
        .map(|rows| !rows.is_empty())
        .unwrap_or(false);
    let sources = args
        .get("sources")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(|item| item.trim().to_ascii_lowercase())
                .filter(|item| !item.is_empty())
                .collect::<HashSet<String>>()
        });
    let broad_sources = match sources {
        None => true,
        Some(ref set) if set.is_empty() => true,
        Some(set) => {
            set.len() == 3 && set.contains("code") && set.contains("memory") && set.contains("wiki")
        }
    };
    !include_org && !technical_terms && broad_sources
}

fn build_overlap_candidate(
    tool_name: &str,
    args: &Map<String, Value>,
) -> Option<SearchSemanticOverlapCandidate> {
    let normalized_query = parse_overlap_query(args)?;
    if tool_name == TOOL_SEARCH {
        return Some(SearchSemanticOverlapCandidate {
            kind: SearchSemanticToolKind::Search,
            normalized_query,
            is_broad: is_broad_search_request(args),
        });
    }
    if tool_name == TOOL_SEMANTIC_SEARCH {
        return Some(SearchSemanticOverlapCandidate {
            kind: SearchSemanticToolKind::SemanticSearch,
            normalized_query,
            is_broad: is_broad_semantic_search_request(args),
        });
    }
    None
}

fn should_block_overlap_candidate(
    input: &TurnExecuteInput,
    candidate: &SearchSemanticOverlapCandidate,
) -> Result<bool, ToolExecutionError> {
    if !candidate.is_broad {
        return Ok(false);
    }
    let turn_key = overlap_turn_key(input);
    let store = overlap_store()
        .lock()
        .map_err(|_| {
            runtime_state_unavailable_error(
                "failed to lock overlap guard state",
                "overlap_guard",
                input.tool_context
                    .as_ref()
                    .and_then(|context| context.work_dir.as_deref()),
            )
        })?;
    let Some(turn) = store.turns.get(turn_key.as_str()) else {
        return Ok(false);
    };
    let blocked = match candidate.kind {
        SearchSemanticToolKind::Search => turn
            .broad_semantic_queries
            .contains(candidate.normalized_query.as_str()),
        SearchSemanticToolKind::SemanticSearch => turn
            .broad_search_queries
            .contains(candidate.normalized_query.as_str()),
    };
    Ok(blocked)
}

fn record_overlap_candidate(
    input: &TurnExecuteInput,
    candidate: &SearchSemanticOverlapCandidate,
) -> Result<(), ToolExecutionError> {
    if !candidate.is_broad {
        return Ok(());
    }
    record_overlap_recorded_metric(&candidate.kind);
    let turn_key = overlap_turn_key(input);
    let mut store = overlap_store()
        .lock()
        .map_err(|_| {
            runtime_state_unavailable_error(
                "failed to lock overlap guard state",
                "overlap_guard",
                input.tool_context
                    .as_ref()
                    .and_then(|context| context.work_dir.as_deref()),
            )
        })?;
    if !store.turns.contains_key(turn_key.as_str()) {
        store.order.push_back(turn_key.clone());
    }
    let turn = store.turns.entry(turn_key.clone()).or_default();
    match candidate.kind {
        SearchSemanticToolKind::Search => {
            turn.broad_search_queries
                .insert(candidate.normalized_query.clone());
        }
        SearchSemanticToolKind::SemanticSearch => {
            turn.broad_semantic_queries
                .insert(candidate.normalized_query.clone());
        }
    }
    while store.order.len() > OVERLAP_GUARD_MAX_TURN_KEYS {
        let Some(oldest_key) = store.order.pop_front() else {
            break;
        };
        store.turns.remove(oldest_key.as_str());
    }
    Ok(())
}

fn build_overlap_block_error(
    tool_name: &str,
    candidate: &SearchSemanticOverlapCandidate,
) -> ToolExecutionError {
    let file_lookup_query = query_is_file_lookup_intent(candidate.normalized_query.as_str());
    let suggested_tool = if file_lookup_query {
        TOOL_GLOB
    } else if tool_name == TOOL_SEARCH {
        TOOL_SEMANTIC_SEARCH
    } else {
        TOOL_SEARCH
    };
    let intent_hint = if file_lookup_query {
        "; query looks like filename/path lookup, prefer glob (for example pattern '*invoice*.pdf')"
    } else {
        ""
    };
    ToolExecutionError::new(
        "tool_overlap_blocked",
        format!(
            "blocked overlapping broad query between search and semantic_search for query '{}'; refine arguments or use {suggested_tool} with scoped params{intent_hint}",
            candidate.normalized_query,
        ),
    )
}

pub(crate) fn is_local_tool_dispatch_supported(tool_name: &str) -> bool {
    matches!(
        tool_name,
        TOOL_LIST
            | TOOL_GLOB
            | TOOL_SEARCH
            | TOOL_READ
            | TOOL_WRITE
            | TOOL_EDIT
            | TOOL_BASH
            | TOOL_MCP_SERVERS
            | TOOL_MCP_CALL
            | TOOL_WEB_SCAN
            | TOOL_WEB_EXECUTE_JS
            | TOOL_SEMANTIC_SEARCH
            | TOOL_PROMPT_ENHANCER
            | TOOL_ASK_USER
            | TOOL_ASK_USER_LEGACY
    )
}

impl ToolExecutor for LocalToolExecutor {
    fn execute_tool_call(
        &self,
        call: &ToolCallInput,
        input: &TurnExecuteInput,
    ) -> Result<ToolCallOutput, ToolExecutionError> {
        if let Some(kimi_result) = execute_kimi_tool_call(call, input) {
            return kimi_result;
        }
        let tool_name = normalize_tool_name(&call.name);
        let context = parse_tool_context(input)?;
        if !context.model_visible_tools.contains(&tool_name) {
            return Err(ToolExecutionError::new(
                "tool_not_visible",
                format!(
                    "tool is not visible in current tool surface profile: {tool_name} profile={}",
                    context.tool_surface_profile
                ),
            ));
        }
        if !context.enabled_tools.contains(&tool_name) {
            return Err(ToolExecutionError::new(
                "tool_disabled",
                format!("tool is disabled by runtime context: {tool_name}"),
            ));
        }
        if !is_local_tool_dispatch_supported(tool_name.as_str()) {
            return Err(ToolExecutionError::new(
                "tool_call_not_supported",
                format!("runtime v1 does not support tool calls yet: {}", call.name),
            ));
        }
        let args = value_object(&call.arguments, &tool_name)?;
        let overlap_candidate = build_overlap_candidate(tool_name.as_str(), args);
        if let Some(candidate) = overlap_candidate.as_ref() {
            if should_block_overlap_candidate(input, candidate)? {
                record_overlap_blocked_metric(&candidate.kind);
                return Err(build_overlap_block_error(tool_name.as_str(), candidate));
            }
        }

        let result = match tool_name.as_str() {
            TOOL_LIST => run_list(&context, args),
            TOOL_GLOB => run_glob(&context, args),
            TOOL_SEARCH => run_search(&context, args),
            TOOL_READ => run_read(&context, args, input),
            TOOL_WRITE => run_write(&context, args),
            TOOL_EDIT => run_edit(&context, args),
            TOOL_BASH => run_bash(&context, args),
            TOOL_MCP_SERVERS => run_mcp_servers(&context, args),
            TOOL_MCP_CALL => run_mcp_call(&context, args),
            TOOL_WEB_SCAN => run_web_scan(&context, args),
            TOOL_WEB_EXECUTE_JS => run_web_execute_js(&context, args),
            TOOL_SEMANTIC_SEARCH => run_semantic_search(&context, args, input),
            TOOL_PROMPT_ENHANCER => run_prompt_enhancer(&context, args, input),
            TOOL_ASK_USER | TOOL_ASK_USER_LEGACY => run_ask_user(&context, args),
            _ => Err(ToolExecutionError::new(
                "tool_dispatch_not_implemented",
                format!("dispatch table missing handler for: {}", call.name),
            )),
        };
        if result.is_ok() {
            if let Some(candidate) = overlap_candidate.as_ref() {
                record_overlap_candidate(input, candidate)?;
            }
        }
        result
    }
}
