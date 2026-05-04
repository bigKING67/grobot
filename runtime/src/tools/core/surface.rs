fn canonical_tool_surface_profile(raw: Option<&str>) -> &'static str {
    match raw
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| TOOL_SURFACE_CODING.to_string())
        .replace('-', "_")
        .as_str()
    {
        TOOL_SURFACE_MINIMAL => TOOL_SURFACE_MINIMAL,
        TOOL_SURFACE_BROWSER => TOOL_SURFACE_BROWSER,
        TOOL_SURFACE_BROWSER_ADVANCED => TOOL_SURFACE_BROWSER_ADVANCED,
        TOOL_SURFACE_CONTEXT => TOOL_SURFACE_CONTEXT,
        TOOL_SURFACE_MCP => TOOL_SURFACE_MCP,
        TOOL_SURFACE_FULL_DEBUG => TOOL_SURFACE_FULL_DEBUG,
        _ => TOOL_SURFACE_CODING,
    }
}

fn tool_surface_profile_names(profile: &str) -> Vec<&'static str> {
    match canonical_tool_surface_profile(Some(profile)) {
        TOOL_SURFACE_MINIMAL => vec![TOOL_READ, TOOL_EDIT, TOOL_WRITE, TOOL_ASK_USER],
        TOOL_SURFACE_BROWSER => vec![TOOL_WEB_SCAN, TOOL_WEB_EXECUTE_JS, TOOL_READ, TOOL_ASK_USER],
        TOOL_SURFACE_BROWSER_ADVANCED => {
            vec![TOOL_WEB_SCAN, TOOL_WEB_EXECUTE_JS, TOOL_READ, TOOL_ASK_USER]
        }
        TOOL_SURFACE_CONTEXT => vec![TOOL_SEMANTIC_SEARCH, TOOL_READ, TOOL_ASK_USER],
        TOOL_SURFACE_MCP => vec![TOOL_MCP_SERVERS, TOOL_MCP_CALL, TOOL_ASK_USER],
        TOOL_SURFACE_FULL_DEBUG => local_tool_catalog()
            .into_iter()
            .map(|tool| tool.name)
            .collect(),
        _ => default_enabled_local_tool_names(),
    }
}

fn schema_projection_mode(profile: &str, advanced_tool_schema: bool) -> &'static str {
    if canonical_tool_surface_profile(Some(profile)) == TOOL_SURFACE_FULL_DEBUG {
        return "full";
    }
    if advanced_tool_schema
        || canonical_tool_surface_profile(Some(profile)) == TOOL_SURFACE_BROWSER_ADVANCED
    {
        return "advanced";
    }
    "slim"
}

fn project_object_schema_properties(parameters: &Value, allowed_properties: &[&str]) -> Value {
    let mut projected = parameters.clone();
    let allowed: HashSet<&str> = allowed_properties.iter().copied().collect();
    if let Some(properties) = projected
        .get_mut("properties")
        .and_then(Value::as_object_mut)
    {
        properties.retain(|key, _| allowed.contains(key.as_str()));
    }
    prune_required_schema_array(projected.get_mut("required"), &allowed);
    if projected
        .get("required")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        if let Some(object) = projected.as_object_mut() {
            object.remove("required");
        }
    }
    if let Some(any_of) = projected.get_mut("anyOf").and_then(Value::as_array_mut) {
        for branch in any_of.iter_mut() {
            prune_required_schema_array(branch.get_mut("required"), &allowed);
        }
        any_of.retain(|branch| {
            branch
                .get("required")
                .and_then(Value::as_array)
                .is_none_or(|required| !required.is_empty())
        });
    }
    if projected
        .get("anyOf")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        if let Some(object) = projected.as_object_mut() {
            object.remove("anyOf");
        }
    }
    projected
}

fn prune_required_schema_array(required: Option<&mut Value>, allowed: &HashSet<&str>) {
    if let Some(required) = required.and_then(Value::as_array_mut) {
        required.retain(|item| item.as_str().is_some_and(|name| allowed.contains(name)));
    }
}

fn project_tool_parameters(
    name: &str,
    parameters: &Value,
    profile: &str,
    advanced_tool_schema: bool,
) -> Value {
    let canonical_profile = canonical_tool_surface_profile(Some(profile));
    let mode = schema_projection_mode(profile, advanced_tool_schema);
    if mode == "full" {
        return parameters.clone();
    }
    if name == TOOL_READ
        && !advanced_tool_schema
        && matches!(
            canonical_profile,
            TOOL_SURFACE_MINIMAL | TOOL_SURFACE_BROWSER | TOOL_SURFACE_CONTEXT
        )
    {
        return project_object_schema_properties(
            parameters,
            &["path", "offset", "limit", "include_metadata"],
        );
    }
    if name == TOOL_SEMANTIC_SEARCH
        && !advanced_tool_schema
        && canonical_profile == TOOL_SURFACE_CONTEXT
    {
        return project_object_schema_properties(
            parameters,
            &[
                "query",
                "sources",
                "per_source_limit",
                "max_segments",
                "include_org",
            ],
        );
    }
    if name == TOOL_ASK_USER && mode != "full" {
        return project_object_schema_properties(parameters, &["questions"]);
    }
    if name == TOOL_MCP_SERVERS && mode != "full" {
        return project_object_schema_properties(parameters, &["ready_only"]);
    }
    match (name, mode) {
        (TOOL_WEB_SCAN, "slim") => project_object_schema_properties(
            parameters,
            &[
                "tabs_only",
                "main_only",
                "switch_tab_id",
                "session_id",
                "max_chars",
            ],
        ),
        (TOOL_WEB_EXECUTE_JS, "slim") => project_object_schema_properties(
            parameters,
            &[
                "script",
                "code",
                "tab_id",
                "switch_tab_id",
                "session_id",
                "timeout_ms",
            ],
        ),
        (TOOL_WEB_SCAN, "advanced") => project_object_schema_properties(
            parameters,
            &[
                "tabs_only",
                "text_only",
                "main_only",
                "main_only_fallback_to_full",
                "main_only_min_chars",
                "main_only_min_coverage",
                "switch_tab_id",
                "session_id",
                "session_url_pattern",
                "max_chars",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
            ],
        ),
        (TOOL_WEB_EXECUTE_JS, "advanced") => project_object_schema_properties(
            parameters,
            &[
                "script",
                "code",
                "tab_id",
                "switch_tab_id",
                "session_id",
                "session_url_pattern",
                "timeout_ms",
                "tmwd_mode",
                "tmwd_transport",
                "tmwd_ws_endpoint",
                "tmwd_link_endpoint",
                "cdp_endpoint",
                "target_url_contains",
                "native_auto_fallback",
                "native_auto_fallback_policy",
                "native_fallback_timeout_ms",
            ],
        ),
        _ => parameters.clone(),
    }
}

fn projected_tool_property_names_for_context(
    context: &ToolContextResolved,
    tool_name: &str,
) -> Result<HashSet<String>, ToolExecutionError> {
    let tool = local_tool_catalog()
        .into_iter()
        .find(|tool| tool.name == tool_name)
        .ok_or_else(|| {
            ToolExecutionError::new(
                "tool_dispatch_not_implemented",
                format!("missing local tool schema for current surface: {tool_name}"),
            )
        })?;
    let projected = project_tool_parameters(
        tool.name,
        &tool.parameters,
        &context.tool_surface_profile,
        context.advanced_tool_schema,
    );
    Ok(projected
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| properties.keys().cloned().collect::<HashSet<String>>())
        .unwrap_or_default())
}

fn validate_projected_tool_args_visible(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
    tool_name: &str,
    operation: &str,
    recovery_hint: &str,
) -> Result<(), ToolExecutionError> {
    let visible_properties = projected_tool_property_names_for_context(context, tool_name)?;
    let mut hidden_args = args
        .keys()
        .filter(|key| !visible_properties.contains(key.as_str()))
        .cloned()
        .collect::<Vec<String>>();
    if hidden_args.is_empty() {
        return Ok(());
    }
    hidden_args.sort();
    let mut visible_args = visible_properties.into_iter().collect::<Vec<String>>();
    visible_args.sort();
    let hidden_args_text = hidden_args.join(", ");
    Err(ToolExecutionError::new(
        "tool_argument_not_visible",
        format!(
            "{tool_name} argument(s) [{hidden_args_text}] are not visible in current tool surface profile={} advanced_tool_schema={}. {recovery_hint}",
            context.tool_surface_profile,
            context.advanced_tool_schema,
        ),
    )
    .with_data({
        let mut data = Map::new();
        data.insert(
            "diagnostic_kind".to_string(),
            json!("tool_argument_not_visible"),
        );
        data.insert("tool".to_string(), json!(tool_name));
        data.insert("operation".to_string(), json!(operation));
        data.insert(
            "tool_surface_profile".to_string(),
            json!(context.tool_surface_profile),
        );
        data.insert(
            "advanced_tool_schema".to_string(),
            json!(context.advanced_tool_schema),
        );
        data.insert("hidden_args".to_string(), json!(hidden_args));
        data.insert("visible_args".to_string(), json!(visible_args));
        data.insert(
            "recovery_stage".to_string(),
            json!(TOOL_RECOVERY_STAGE_STRATEGY_SWITCH),
        );
        data.insert(
            "recommended_next_action".to_string(),
            json!(TOOL_RECOVERY_ACTION_INSPECT_VISIBLE_TOOL_SCHEMA_THEN_RETRY),
        );
        data.insert("recoverable".to_string(), json!(true));
        data.insert(
            "recovery_policy_version".to_string(),
            json!(tool_recovery_policy_version()),
        );
        data.insert("recovery_hint".to_string(), json!(recovery_hint));
        Value::Object(data)
    }))
}

fn schema_property_names(parameters: &Value) -> Vec<String> {
    let mut names = parameters
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| properties.keys().cloned().collect::<Vec<String>>())
        .unwrap_or_default();
    names.sort();
    names
}

fn stable_json_fingerprint(prefix: &str, payload: &Value) -> String {
    let text = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    let mut hash: u32 = 0x811c9dc5;
    for byte in text.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{prefix}:{hash:08x}")
}

fn tool_surface_schema_profile(profile: &str, advanced_tool_schema: bool) -> Value {
    let profile = canonical_tool_surface_profile(Some(profile));
    let mode = schema_projection_mode(profile, advanced_tool_schema);
    let tool_names = tool_surface_profile_names(profile);
    let visible_tool_count = tool_names.len();
    let catalog = local_tool_catalog();
    let mut per_tool_property_count = Map::new();
    let mut per_tool_visible_args = Map::new();
    let mut per_tool_suppressed_args = Map::new();
    let mut projected_tool_schemas = Vec::new();
    let mut schema_property_total = 0usize;
    let mut full_schema_property_total = 0usize;

    for tool_name in &tool_names {
        if let Some(tool) = catalog.iter().find(|entry| entry.name == *tool_name) {
            let projected_parameters =
                project_tool_parameters(tool.name, &tool.parameters, profile, advanced_tool_schema);
            let visible_args = schema_property_names(&projected_parameters);
            let full_args = schema_property_names(&tool.parameters);
            let visible_arg_set = visible_args.iter().cloned().collect::<HashSet<String>>();
            let suppressed_args = full_args
                .iter()
                .filter(|name| !visible_arg_set.contains(*name))
                .cloned()
                .collect::<Vec<String>>();
            let projected_count = visible_args.len();
            let full_count = full_args.len();
            schema_property_total += projected_count;
            full_schema_property_total += full_count;
            per_tool_property_count.insert(tool.name.to_string(), json!(projected_count));
            per_tool_visible_args.insert(tool.name.to_string(), json!(visible_args));
            per_tool_suppressed_args.insert(tool.name.to_string(), json!(suppressed_args));
            projected_tool_schemas.push(json!({
                "name": tool.name,
                "full_property_names": full_args,
                "parameters": projected_parameters,
            }));
        }
    }
    let advanced_schema_effective =
        advanced_tool_schema || profile == TOOL_SURFACE_BROWSER_ADVANCED || profile == TOOL_SURFACE_FULL_DEBUG;
    let schema_fingerprint = stable_json_fingerprint(
        "schema",
        &json!({
            "policy_version": TOOL_SURFACE_POLICY_VERSION,
            "profile": profile,
            "projection_mode": mode,
            "advanced_tool_schema": advanced_schema_effective,
            "tools": projected_tool_schemas,
        }),
    );

    json!({
        "policy_version": TOOL_SURFACE_POLICY_VERSION,
        "profile": profile,
        "projection_mode": mode,
        "advanced_tool_schema": advanced_schema_effective,
        "schema_fingerprint": schema_fingerprint,
        "tool_names": tool_names,
        "visible_tool_count": visible_tool_count,
        "schema_property_count": schema_property_total,
        "full_schema_property_count": full_schema_property_total,
        "suppressed_schema_property_count": full_schema_property_total.saturating_sub(schema_property_total),
        "per_tool_property_count": per_tool_property_count,
        "per_tool_visible_args": per_tool_visible_args,
        "per_tool_suppressed_args": per_tool_suppressed_args,
    })
}

pub(crate) fn tool_surface_schema_profiles() -> Vec<Value> {
    [
        (TOOL_SURFACE_MINIMAL, false),
        (TOOL_SURFACE_CODING, false),
        (TOOL_SURFACE_BROWSER, false),
        (TOOL_SURFACE_BROWSER_ADVANCED, true),
        (TOOL_SURFACE_CONTEXT, false),
        (TOOL_SURFACE_MCP, false),
        (TOOL_SURFACE_FULL_DEBUG, true),
    ]
    .into_iter()
    .map(|(profile, advanced_tool_schema)| {
        tool_surface_schema_profile(profile, advanced_tool_schema)
    })
    .collect()
}

pub(crate) fn tool_surface_schema_profiles_fingerprint(profiles: &[Value]) -> String {
    stable_json_fingerprint(
        "schema_profiles",
        &json!({
            "policy_version": TOOL_SURFACE_POLICY_VERSION,
            "profiles": profiles,
        }),
    )
}

pub(crate) fn local_tool_definitions_for_surface(
    visible_tools: &[String],
    profile: Option<&str>,
    advanced_tool_schema: bool,
) -> Vec<Value> {
    let profile = canonical_tool_surface_profile(profile);
    let visible: HashSet<String> = if visible_tools.is_empty() {
        tool_surface_profile_names(profile)
            .into_iter()
            .map(str::to_string)
            .collect()
    } else {
        visible_tools
            .iter()
            .map(|item| item.trim().to_ascii_lowercase())
            .filter(|item| !item.is_empty())
            .collect()
    };
    local_tool_catalog()
        .into_iter()
        .filter(|tool| visible.contains(tool.name))
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": project_tool_parameters(tool.name, &tool.parameters, profile, advanced_tool_schema),
                }
            })
        })
        .collect()
}

pub(crate) fn tool_surface_policy_version() -> &'static str {
    TOOL_SURFACE_POLICY_VERSION
}
