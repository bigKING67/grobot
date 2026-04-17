fn validate_bash_command_security(command: &str) -> Result<(), ToolExecutionError> {
    if command.contains('\0') {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            "bash command contains NUL byte",
        ));
    }

    if let Some(reason) = find_bash_security_violation(command) {
        return Err(ToolExecutionError::new("bash_security_denied", reason));
    }

    Ok(())
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

    None
}
