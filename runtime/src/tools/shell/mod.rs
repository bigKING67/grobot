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
