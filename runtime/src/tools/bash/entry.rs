fn run_bash(
    context: &ToolContextResolved,
    args: &Map<String, Value>,
) -> Result<ToolCallOutput, ToolExecutionError> {
    let request = parse_bash_request(args)?;
    let policy = load_bash_runtime_policy(context)?;
    validate_bash_command_security(&request.command)?;
    let policy_evaluation = evaluate_bash_policy(context, &request)?;

    if policy_evaluation.decision == BashPolicyDecisionKind::Forbidden {
        let denied = policy_evaluation
            .segments
            .iter()
            .find(|segment| segment.decision == BashPolicyDecisionKind::Forbidden);
        let denied_segment = denied
            .map(|value| {
                sanitize_bash_audit_value(
                    value.segment.as_str(),
                    policy.audit_segment_chars,
                    policy.audit_redact_secrets,
                )
            })
            .unwrap_or_else(|| "<empty>".to_string());
        let reason = denied
            .map(|value| value.reason.as_str())
            .unwrap_or("policy_forbidden");
        let error_class = if reason.starts_with("dangerous_removal_path")
            || reason.starts_with("nested_shell:dangerous_removal_path")
        {
            "bash_dangerous_path"
        } else if reason == "path_outside_workspace" {
            "bash_path_outside_workspace"
        } else {
            "bash_policy_forbidden"
        };
        return Err(ToolExecutionError::new(
            error_class,
            format!("bash command forbidden by policy: {denied_segment}; reason={reason}"),
        )
        .with_data(json!({
            "diagnostic_kind": error_class,
            "decision": policy_evaluation.decision.as_str(),
            "denied_segment": denied_segment,
            "reason": reason,
            "segments": bash_policy_segments_json(&policy_evaluation, &policy),
            "recovery_hint": "use a read-only workspace-contained command or request a safer tool path"
        })));
    }

    if policy_evaluation.decision == BashPolicyDecisionKind::PromptRequired {
        let prompt_segment = policy_evaluation
            .segments
            .iter()
            .find(|segment| segment.decision == BashPolicyDecisionKind::PromptRequired);
        let command_preview = sanitize_bash_audit_value(
            request.command.as_str(),
            policy.audit_preview_chars,
            policy.audit_redact_secrets,
        );
        let reason = prompt_segment
            .map(|value| value.reason.as_str())
            .unwrap_or("permission_required");
        return Err(ToolExecutionError::new(
            "bash_permission_required",
            format!("bash command requires permission before execution: {command_preview}; reason={reason}"),
        )
        .with_data(json!({
            "diagnostic_kind": "bash_permission_required",
            "decision": policy_evaluation.decision.as_str(),
            "command_preview": command_preview,
            "reason": reason,
            "segments": bash_policy_segments_json(&policy_evaluation, &policy),
            "recovery_hint": "ask the user for approval or choose a read-only built-in tool path"
        })));
    }

    let execution = execute_bash_command(context, &request, &policy)?;

    let stdout_summary = summarize_bash_stream(
        execution.stdout.tail_text().as_str(),
        execution.stdout.total_lines(),
        execution.stdout.total_bytes,
        request.max_output_lines,
        request.max_output_bytes,
    );
    let stderr_summary = summarize_bash_stream(
        execution.stderr.tail_text().as_str(),
        execution.stderr.total_lines(),
        execution.stderr.total_bytes,
        request.max_output_lines,
        request.max_output_bytes,
    );

    let truncated_any = stdout_summary.truncated || stderr_summary.truncated;
    let persist_full = truncated_any || execution.timed_out;
    let full_output_path = if persist_full {
        Some(persist_full_bash_output(&execution.stdout, &execution.stderr)?)
    } else {
        None
    };

    if execution.timed_out {
        let message = build_bash_timeout_message(
            request.timeout_ms,
            stdout_summary.content.as_str(),
            stderr_summary.content.as_str(),
            full_output_path.as_deref(),
            &policy,
        );
        cleanup_bash_spill_files(&execution.stdout, &execution.stderr);
        return Err(ToolExecutionError::new("bash_timeout", message).with_data(json!({
            "diagnostic_kind": "bash_timeout",
            "timeout_ms": request.timeout_ms,
            "duration_ms": execution.duration_ms,
            "full_output_path": full_output_path,
            "stdout_truncated": stdout_summary.truncated,
            "stderr_truncated": stderr_summary.truncated,
            "recovery_hint": "retry with a smaller command scope, increase timeout within policy, or inspect persisted output"
        })));
    }
    let audit = json!({
        "policy": "bash_v2_strict",
        "command_preview": sanitize_bash_audit_value(
            request.command.as_str(),
            policy.audit_preview_chars,
            policy.audit_redact_secrets
        ),
        "allowlist_rule_count": context.bash_allowlist.len(),
        "decision": policy_evaluation.decision.as_str(),
        "segments": bash_policy_segments_json(&policy_evaluation, &policy),
        "redaction_enabled": policy.audit_redact_secrets,
    });

    let payload = if let Some(path) = full_output_path.as_ref() {
        json!({
            "tool": TOOL_BASH,
            "exit_code": execution.exit_code,
            "timed_out": false,
            "duration_ms": execution.duration_ms,
            "stdout": stdout_summary.content,
            "stderr": stderr_summary.content,
            "truncation": {
                "stdout": truncation_summary_to_json(&stdout_summary),
                "stderr": truncation_summary_to_json(&stderr_summary),
            },
            "full_output_path": path,
            "audit": audit,
        })
    } else {
        json!({
            "tool": TOOL_BASH,
            "exit_code": execution.exit_code,
            "timed_out": false,
            "duration_ms": execution.duration_ms,
            "stdout": stdout_summary.content,
            "stderr": stderr_summary.content,
            "truncation": {
                "stdout": truncation_summary_to_json(&stdout_summary),
                "stderr": truncation_summary_to_json(&stderr_summary),
            },
            "audit": audit,
        })
    };

    cleanup_bash_spill_files(&execution.stdout, &execution.stderr);
    Ok(ToolCallOutput::from_payload(payload))
}

fn build_bash_timeout_message(
    timeout_ms: u64,
    stdout: &str,
    stderr: &str,
    full_output_path: Option<&str>,
    policy: &BashRuntimePolicy,
) -> String {
    let mut message = format!("bash command timed out after {timeout_ms} ms");

    let stdout_preview = sanitize_bash_audit_value(
        stdout,
        policy.audit_preview_chars,
        policy.audit_redact_secrets,
    );
    let stderr_preview = sanitize_bash_audit_value(
        stderr,
        policy.audit_preview_chars,
        policy.audit_redact_secrets,
    );

    if !stdout_preview.is_empty() {
        message.push_str("; stdout preview: ");
        message.push_str(stdout_preview.as_str());
    }
    if !stderr_preview.is_empty() {
        message.push_str("; stderr preview: ");
        message.push_str(stderr_preview.as_str());
    }
    if let Some(path) = full_output_path {
        message.push_str("; full output: ");
        message.push_str(path);
    }

    message
}

fn sanitize_bash_audit_value(raw: &str, max_chars: usize, redact_enabled: bool) -> String {
    let truncated = truncate_output(raw.to_string(), max_chars);
    if !redact_enabled || truncated.is_empty() {
        return truncated;
    }
    redact_bash_secrets(truncated.as_str())
}

fn redact_bash_secrets(raw: &str) -> String {
    redact_tool_preview_secrets(raw)
}
