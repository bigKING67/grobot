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
