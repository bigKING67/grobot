fn has_kimi_search_intent(user_text: &str) -> bool {
    let normalized = user_text.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    let patterns = [
        "联网",
        "搜索",
        "检索",
        "热点",
        "新闻",
        "source",
        "search",
        "latest",
        "news",
    ];
    patterns.iter().any(|pattern| normalized.contains(pattern))
}

fn split_code_fence_content(text: &str) -> (String, usize) {
    let mut outside_segments = Vec::new();
    let mut max_code_block_chars = 0usize;
    for (index, segment) in text.split("```").enumerate() {
        if index % 2 == 0 {
            outside_segments.push(segment);
            continue;
        }
        let chars = segment.chars().count();
        if chars > max_code_block_chars {
            max_code_block_chars = chars;
        }
    }
    (outside_segments.join(" "), max_code_block_chars)
}

fn is_code_heavy_without_tool_calls(content: &str) -> bool {
    if !content.contains("```") {
        return false;
    }
    let (outside, max_code_block_chars) = split_code_fence_content(content);
    if max_code_block_chars < 300 {
        return false;
    }
    let outside_non_whitespace = outside.chars().filter(|ch| !ch.is_whitespace()).count();
    outside_non_whitespace <= 40
}

fn should_trigger_no_tool_recovery(
    content: Option<&str>,
    mode: NoToolFallbackMode,
    has_tool_context: bool,
    recovery_rounds: usize,
    max_recovery_rounds: usize,
) -> bool {
    if mode == NoToolFallbackMode::Off || max_recovery_rounds == 0 || recovery_rounds >= max_recovery_rounds {
        return false;
    }
    let normalized = content.map(str::trim).unwrap_or_default();
    if normalized.is_empty() {
        return true;
    }
    if normalized.contains("未收到完整响应 !!!]") || normalized.contains("max_tokens !!!]") {
        return true;
    }
    if is_code_heavy_without_tool_calls(normalized) {
        return true;
    }
    if mode == NoToolFallbackMode::Strict && has_tool_context {
        return true;
    }
    false
}

fn detect_no_tool_recovery_reason(content: Option<&str>) -> &'static str {
    let normalized = content.map(str::trim).unwrap_or_default();
    if normalized.is_empty() {
        return "empty_response";
    }
    if normalized.contains("未收到完整响应 !!!]") || normalized.contains("max_tokens !!!]") {
        return "incomplete_response";
    }
    if is_code_heavy_without_tool_calls(normalized) {
        return "code_only_without_tool_calls";
    }
    "strict_policy_no_tool"
}

fn build_no_tool_recovery_prompt(recovery_round: usize, reason: &str) -> String {
    format!(
        "[System][no_tool fallback]\nreason={reason}\nrecovery_round={recovery_round}\n\
Model returned no actionable tool call in previous step.\n\
If filesystem, shell, or MCP interaction is needed, call the proper tool explicitly.\n\
If no tool is needed, return a concise final answer with clear completion signal."
    )
}

fn no_tool_fallback_mode_label(mode: NoToolFallbackMode) -> &'static str {
    match mode {
        NoToolFallbackMode::Off => "off",
        NoToolFallbackMode::Safe => "safe",
        NoToolFallbackMode::Strict => "strict",
    }
}

fn build_no_tool_fallback_event(event_type: &str, payload: Value) -> ModelTelemetryEvent {
    ModelTelemetryEvent {
        event_type: event_type.to_string(),
        payload: Some(payload),
    }
}

fn normalize_tool_name_for_telemetry(raw: &str) -> String {
    let normalized = raw.trim();
    if normalized.is_empty() {
        return "unknown_tool".to_string();
    }
    normalized.to_string()
}

fn classify_tool_execution_risk(tool_name: &str) -> &'static str {
    match tool_name.trim().to_ascii_lowercase().as_str() {
        "bash" | "web_execute_js" | "mcp_call" | "code_runner" | "kimi_files_delete" => {
            "high_risk"
        }
        "write" | "edit" => "mutating",
        "ask_user" | "ask_user_question" => "interrupt",
        "list" | "glob" | "search" | "read" | "mcp_servers" | "web_scan" | "semantic_search"
        | "prompt_enhancer" | "$web_search" | "web_search" | "fetch" | "date" | "rethink"
        | "kimi_files_list" => "read_only",
        _ => "unknown",
    }
}

fn tool_requires_observation_boundary(risk_class: &str) -> bool {
    matches!(risk_class, "high_risk" | "mutating" | "interrupt" | "unknown")
}

fn tool_duration_ms(started_at: std::time::Instant) -> u64 {
    let millis = started_at.elapsed().as_millis();
    if millis > u128::from(u64::MAX) {
        return u64::MAX;
    }
    millis as u64
}

const TOOL_MESSAGE_BUDGET_POLICY_VERSION: &str = "v1";
const TOOL_MESSAGE_DEFAULT_MAX_CHARS: usize = 80_000;
const TOOL_MESSAGE_BROWSER_MAX_CHARS: usize = 48_000;
const TOOL_MESSAGE_MCP_MAX_CHARS: usize = 48_000;
const TOOL_MESSAGE_PREVIEW_OVERHEAD_CHARS: usize = 2_000;
const TOOL_MESSAGE_PREVIEW_MIN_CHARS: usize = 512;

#[derive(Debug, Clone)]
struct BudgetedToolMessageContent {
    content: String,
    truncated: bool,
    original_chars: usize,
    returned_chars: usize,
    max_chars: usize,
}

pub(crate) fn tool_message_budget_policy_version() -> &'static str {
    TOOL_MESSAGE_BUDGET_POLICY_VERSION
}

pub(crate) fn tool_message_budget_profiles() -> Value {
    json!([
        {
            "tool_name": "*",
            "max_chars": TOOL_MESSAGE_DEFAULT_MAX_CHARS,
            "applies_to": "model_tool_message_content"
        },
        {
            "tool_name": "mcp_call",
            "max_chars": TOOL_MESSAGE_MCP_MAX_CHARS,
            "applies_to": "model_tool_message_content"
        },
        {
            "tool_name": "web_scan",
            "max_chars": TOOL_MESSAGE_BROWSER_MAX_CHARS,
            "applies_to": "model_tool_message_content"
        },
        {
            "tool_name": "web_execute_js",
            "max_chars": TOOL_MESSAGE_BROWSER_MAX_CHARS,
            "applies_to": "model_tool_message_content"
        }
    ])
}

fn tool_message_max_chars(tool_name: &str) -> usize {
    match normalize_tool_name_for_telemetry(tool_name).as_str() {
        "mcp_call" => TOOL_MESSAGE_MCP_MAX_CHARS,
        "web_scan" | "web_execute_js" => TOOL_MESSAGE_BROWSER_MAX_CHARS,
        _ => TOOL_MESSAGE_DEFAULT_MAX_CHARS,
    }
}

fn truncate_middle_chars(raw: &str, max_chars: usize) -> String {
    let total_chars = raw.chars().count();
    if total_chars <= max_chars {
        return raw.to_string();
    }
    if max_chars == 0 {
        return String::new();
    }
    let head_chars = max_chars / 2;
    let tail_chars = max_chars.saturating_sub(head_chars);
    let head = raw.chars().take(head_chars).collect::<String>();
    let tail = raw
        .chars()
        .rev()
        .take(tail_chars)
        .collect::<Vec<char>>()
        .into_iter()
        .rev()
        .collect::<String>();
    let omitted = total_chars.saturating_sub(head_chars.saturating_add(tail_chars));
    format!(
        "{head}\n...[tool output truncated by message budget; omitted_chars={omitted}]...\n{tail}"
    )
}

fn budget_envelope_content(
    tool_name: &str,
    output_content: &str,
    original_chars: usize,
    max_chars: usize,
    preview_chars: usize,
) -> String {
    let preview = if preview_chars == 0 {
        Value::Null
    } else {
        Value::String(truncate_middle_chars(output_content, preview_chars))
    };
    let payload = json!({
        "tool": normalize_tool_name_for_telemetry(tool_name),
        "status": "truncated",
        "output_budget": {
            "policy_version": TOOL_MESSAGE_BUDGET_POLICY_VERSION,
            "truncated": true,
            "reason": "tool_message_budget",
            "original_chars": original_chars,
            "max_chars": max_chars,
            "retry_hint": "Retry with a narrower path/query/max_chars/limit, or inspect the original artifact through a scoped tool call."
        },
        "summary": build_tool_output_summary(tool_name, output_content),
        "preview": preview
    });
    serde_json::to_string(&payload).unwrap_or_else(|_| {
        "{\"status\":\"truncated\",\"output_budget\":{\"truncated\":true}}".to_string()
    })
}

fn budget_tool_message_content(tool_name: &str, output_content: &str) -> BudgetedToolMessageContent {
    let original_chars = output_content.chars().count();
    let max_chars = tool_message_max_chars(tool_name);
    if original_chars <= max_chars {
        return BudgetedToolMessageContent {
            content: output_content.to_string(),
            truncated: false,
            original_chars,
            returned_chars: original_chars,
            max_chars,
        };
    }

    let mut preview_chars = max_chars
        .saturating_sub(TOOL_MESSAGE_PREVIEW_OVERHEAD_CHARS)
        .max(TOOL_MESSAGE_PREVIEW_MIN_CHARS);
    loop {
        let content = budget_envelope_content(
            tool_name,
            output_content,
            original_chars,
            max_chars,
            preview_chars,
        );
        let returned_chars = content.chars().count();
        if returned_chars <= max_chars || preview_chars == 0 {
            return BudgetedToolMessageContent {
                content,
                truncated: true,
                original_chars,
                returned_chars,
                max_chars,
            };
        }
        preview_chars = if preview_chars <= TOOL_MESSAGE_PREVIEW_MIN_CHARS {
            0
        } else {
            preview_chars
                .saturating_mul(3)
                .saturating_div(4)
                .max(TOOL_MESSAGE_PREVIEW_MIN_CHARS)
        };
    }
}

fn build_tool_message_budget_event_payload(budget: &BudgetedToolMessageContent) -> Value {
    json!({
        "policy_version": TOOL_MESSAGE_BUDGET_POLICY_VERSION,
        "truncated": budget.truncated,
        "reason": if budget.truncated { Value::String("tool_message_budget".to_string()) } else { Value::Null },
        "original_chars": budget.original_chars,
        "returned_chars": budget.returned_chars,
        "max_chars": budget.max_chars,
    })
}

fn build_tool_start_event(
    tool_call: &ToolCallInput,
    tool_round: usize,
    batch_index: usize,
    risk_class: &str,
) -> ModelTelemetryEvent {
    ModelTelemetryEvent {
        event_type: "tool_start".to_string(),
        payload: Some(json!({
            "tool_name": normalize_tool_name_for_telemetry(&tool_call.name),
            "tool_call_id": tool_call.id,
            "tool_round": tool_round,
            "batch_index": batch_index,
            "risk_class": risk_class,
        })),
    }
}

fn truncate_multiline_tool_summary(raw: &str, max_chars: usize, max_lines: usize) -> String {
    let mut normalized = raw
        .lines()
        .take(max_lines)
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    normalized = normalized.chars().take(max_chars).collect::<String>();
    format!("{normalized}…")
}

fn build_tool_output_summary(tool_name: &str, output_content: &str) -> Value {
    let mut summary = serde_json::Map::new();
    summary.insert(
        "tool_name".to_string(),
        Value::String(normalize_tool_name_for_telemetry(tool_name)),
    );
    summary.insert(
        "content_chars".to_string(),
        json!(output_content.chars().count()),
    );

    let Ok(parsed) = serde_json::from_str::<Value>(output_content) else {
        summary.insert("json".to_string(), Value::Bool(false));
        return Value::Object(summary);
    };
    summary.insert("json".to_string(), Value::Bool(true));
    let Some(object) = parsed.as_object() else {
        return Value::Object(summary);
    };

    for key in [
        "tool",
        "type",
        "count",
        "limit_reached",
        "engine",
        "preferred_engine",
        "exit_code",
        "status",
        "error_class",
        "kind",
        "path",
        "operation",
        "line_count",
        "line_start",
        "line_end",
        "has_more",
        "first_changed_line",
        "blocks_requested",
        "replacements",
        "fuzzy_fallback_used",
        "bytes_written",
    ] {
        if let Some(value) = object.get(key) {
            summary.insert(key.to_string(), value.clone());
        }
    }
    if let Some(diff) = object.get("diff").and_then(Value::as_str) {
        summary.insert(
            "diff_preview".to_string(),
            Value::String(truncate_multiline_tool_summary(diff, 900, 8)),
        );
    }
    if let Some(command_preview) = object
        .get("audit")
        .and_then(Value::as_object)
        .and_then(|audit| audit.get("command_preview"))
        .and_then(Value::as_str)
    {
        summary.insert(
            "command_preview".to_string(),
            Value::String(truncate_header_value_for_diagnostics(command_preview, 160)),
        );
    }
    for (key, summary_key) in [
        ("matches", "matches_count"),
        ("entries", "entries_count"),
        ("records", "records_count"),
        ("evidence", "evidence_count"),
        ("technical_terms", "technical_terms_count"),
    ] {
        if let Some(count) = object.get(key).and_then(Value::as_array).map(Vec::len) {
            summary.insert(summary_key.to_string(), json!(count));
        }
    }
    if let Some(stdout_chars) = object
        .get("stdout")
        .and_then(Value::as_str)
        .map(|value| value.chars().count())
    {
        summary.insert("stdout_chars".to_string(), json!(stdout_chars));
    }
    if let Some(stderr_chars) = object
        .get("stderr")
        .and_then(Value::as_str)
        .map(|value| value.chars().count())
    {
        summary.insert("stderr_chars".to_string(), json!(stderr_chars));
    }
    if let Some(content_chars) = object
        .get("content")
        .and_then(Value::as_str)
        .map(|value| value.chars().count())
    {
        summary.insert("tool_content_chars".to_string(), json!(content_chars));
    }
    Value::Object(summary)
}

fn build_tool_end_success_event(
    tool_call: &ToolCallInput,
    tool_round: usize,
    batch_index: usize,
    risk_class: &str,
    duration_ms: u64,
    output: &ToolCallOutput,
    budget: &BudgetedToolMessageContent,
) -> ModelTelemetryEvent {
    ModelTelemetryEvent {
        event_type: "tool_end".to_string(),
        payload: Some(json!({
            "tool_name": normalize_tool_name_for_telemetry(&tool_call.name),
            "tool_call_id": tool_call.id,
            "tool_round": tool_round,
            "batch_index": batch_index,
            "risk_class": risk_class,
            "status": "ok",
            "duration_ms": duration_ms,
            "output_summary": build_tool_output_summary(&tool_call.name, &output.content),
            "output_budget": build_tool_message_budget_event_payload(budget),
        })),
    }
}

fn build_tool_end_deferred_event(
    tool_call: &ToolCallInput,
    tool_round: usize,
    batch_index: usize,
    risk_class: &str,
    output: &ToolCallOutput,
    budget: &BudgetedToolMessageContent,
) -> ModelTelemetryEvent {
    ModelTelemetryEvent {
        event_type: "tool_end".to_string(),
        payload: Some(json!({
            "tool_name": normalize_tool_name_for_telemetry(&tool_call.name),
            "tool_call_id": tool_call.id,
            "tool_round": tool_round,
            "batch_index": batch_index,
            "risk_class": risk_class,
            "status": "deferred",
            "duration_ms": 0,
            "error_class": "tool_execution_deferred",
            "output_summary": build_tool_output_summary(&tool_call.name, &output.content),
            "output_budget": build_tool_message_budget_event_payload(budget),
        })),
    }
}

fn build_tool_end_failure_event(
    tool_call: &ToolCallInput,
    tool_round: usize,
    batch_index: usize,
    risk_class: &str,
    duration_ms: u64,
    error: &ToolExecutionError,
) -> ModelTelemetryEvent {
    ModelTelemetryEvent {
        event_type: "tool_end".to_string(),
        payload: Some(json!({
            "tool_name": normalize_tool_name_for_telemetry(&tool_call.name),
            "tool_call_id": tool_call.id,
            "tool_round": tool_round,
            "batch_index": batch_index,
            "risk_class": risk_class,
            "status": "failed",
            "duration_ms": duration_ms,
            "error_class": error.error_class,
            "error_message": truncate_header_value_for_diagnostics(&error.message, 240),
            "error_data": error.data.clone(),
        })),
    }
}

fn build_tool_end_observed_failure_event(
    tool_call: &ToolCallInput,
    tool_round: usize,
    batch_index: usize,
    risk_class: &str,
    duration_ms: u64,
    output: &ToolCallOutput,
    budget: &BudgetedToolMessageContent,
    error: &ToolExecutionError,
) -> ModelTelemetryEvent {
    ModelTelemetryEvent {
        event_type: "tool_end".to_string(),
        payload: Some(json!({
            "tool_name": normalize_tool_name_for_telemetry(&tool_call.name),
            "tool_call_id": tool_call.id,
            "tool_round": tool_round,
            "batch_index": batch_index,
            "risk_class": risk_class,
            "status": "failed",
            "observed_by_model": true,
            "duration_ms": duration_ms,
            "error_class": error.error_class,
            "error_message": truncate_header_value_for_diagnostics(&error.message, 240),
            "error_data": error.data.clone(),
            "output_summary": build_tool_output_summary(&tool_call.name, &output.content),
            "output_budget": build_tool_message_budget_event_payload(budget),
        })),
    }
}

fn build_tool_recovery_event(
    tool_call: &ToolCallInput,
    tool_round: usize,
    batch_index: usize,
    risk_class: &str,
    error_class: &str,
    error_message: Option<&str>,
    error_data: Option<&Value>,
) -> ModelTelemetryEvent {
    let policy = classify_tool_recovery(error_class, risk_class);
    ModelTelemetryEvent {
        event_type: "tool_recovery".to_string(),
        payload: Some(json!({
            "tool_name": normalize_tool_name_for_telemetry(&tool_call.name),
            "tool_call_id": tool_call.id,
            "tool_round": tool_round,
            "batch_index": batch_index,
            "risk_class": risk_class,
            "error_class": error_class,
            "error_message": error_message.map(|message| truncate_header_value_for_diagnostics(message, 240)),
            "error_data": error_data.cloned(),
            "recovery_stage": policy.stage,
            "recovery_reason": error_class,
            "recommended_next_action": policy.recommended_next_action,
            "recoverable": policy.recoverable,
        })),
    }
}

fn build_deferred_tool_output(
    tool_call: &ToolCallInput,
    tool_round: usize,
    batch_index: usize,
    risk_class: &str,
) -> ToolCallOutput {
    let content = serde_json::to_string(&json!({
        "tool": normalize_tool_name_for_telemetry(&tool_call.name),
        "status": "deferred",
        "error_class": "tool_execution_deferred",
        "message": "deferred because a mutating, high-risk, interrupting, or unknown-risk tool already ran in this batch; observe prior result and re-issue this tool call if it is still needed",
        "tool_round": tool_round,
        "batch_index": batch_index,
        "risk_class": risk_class,
    }))
    .unwrap_or_else(|_| "{\"status\":\"deferred\"}".to_string());
    ToolCallOutput::from_content(content)
}
