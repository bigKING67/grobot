fn validate_bash_command_security(command: &str) -> Result<(), ToolExecutionError> {
    if command.contains('\0') {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            "bash command contains NUL byte",
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "nul_byte",
            "recovery_hint": "remove the forbidden shell construct or use a safer command"
        })));
    }
    if let Some(index) = first_disallowed_control_char_index(command) {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            format!("bash command contains disallowed control character at index {index}"),
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "disallowed_control_character",
            "char_index": index,
            "recovery_hint": "remove the disallowed control character and retry"
        })));
    }

    if let Some(reason) = find_bash_security_violation(command) {
        return Err(ToolExecutionError::new("bash_security_denied", reason).with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": reason,
            "recovery_hint": "remove the forbidden shell construct or use a safer command"
        })));
    }

    Ok(())
}

fn first_disallowed_control_char_index(command: &str) -> Option<usize> {
    for (index, ch) in command.char_indices() {
        if ch == '\t' || ch == '\n' || ch == '\r' {
            continue;
        }
        let code = ch as u32;
        if code == 0x7f || code < 0x20 {
            return Some(index);
        }
    }
    None
}

fn find_bash_security_violation(command: &str) -> Option<&'static str> {
    let chars: Vec<char> = command.chars().collect();

    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        let next = chars.get(index + 1).copied();
        let next_next = chars.get(index + 2).copied();

        if escaped {
            escaped = false;
            index += 1;
            continue;
        }

        if ch == '\\' {
            escaped = true;
            index += 1;
            continue;
        }

        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            index += 1;
            continue;
        }
        if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            index += 1;
            continue;
        }

        if !in_single_quote {
            if ch == '`' {
                return Some("command substitution using backticks is blocked");
            }
            if ch == '$' && next == Some('(') {
                return Some("command substitution using $(...) is blocked");
            }
        }

        if !in_single_quote && !in_double_quote {
            if ch == '<' && next == Some('<') {
                if next_next == Some('<') {
                    return Some("here-string redirection (<<<) is blocked");
                }
                return Some("heredoc redirection (<<) is blocked");
            }
            if ch == '<' && next == Some('(') {
                return Some("process substitution <(...) is blocked");
            }
            if ch == '>' && next == Some('(') {
                return Some("process substitution >(...) is blocked");
            }
        }

        index += 1;
    }

    if escaped {
        return Some("trailing escape is blocked");
    }
    if in_single_quote {
        return Some("unbalanced single quote is blocked");
    }
    if in_double_quote {
        return Some("unbalanced double quote is blocked");
    }

    None
}
