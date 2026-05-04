#[derive(Debug, Clone)]
struct SessionKeyParts {
    tenant: String,
    scope: String,
    subject: String,
}

#[derive(Debug, Clone)]
struct SemanticBridgeRequestMeta<'a> {
    tool_name: &'static str,
    bridge_command: &'static str,
    requested_sources: &'a [String],
    source_roots: &'a [Value],
    timeout_ms: u64,
    bridge_script_override: Option<&'a str>,
}

#[derive(Debug, Clone)]
struct BridgeErrorPayload {
    error_class: String,
    message: String,
    details: Option<Value>,
}
