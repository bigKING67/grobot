fn canonical_kimi_tool_name(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace('-', "_")
}
