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
    if let Some(index) = first_unicode_whitespace_index(command) {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            format!("bash command contains unicode whitespace at index {index}"),
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "unicode_whitespace",
            "char_index": index,
            "recovery_hint": "replace unicode whitespace with plain ASCII spaces"
        })));
    }
    if command_contains_carriage_return_outside_double_quotes(command) {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            "bash command contains carriage return outside double quotes",
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "carriage_return_misparse",
            "recovery_hint": "remove carriage returns; use a single-line command or explicit quoted data"
        })));
    }
    if quoted_newline_hash_line(command) {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            "bash command contains a quoted newline followed by a #-prefixed line",
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "quoted_newline_hash_line",
            "recovery_hint": "avoid quoted multiline arguments that hide #-prefixed lines"
        })));
    }
    if comment_quote_desync(command) {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            "bash command contains quote characters inside a shell comment",
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "comment_quote_desync",
            "recovery_hint": "remove quotes from shell comments or split the command into safer steps"
        })));
    }
    if let Some(reason) = powershell_comment_syntax_reason(command) {
        return Err(ToolExecutionError::new("bash_security_denied", reason).with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": reason,
            "recovery_hint": "avoid PowerShell-specific comment syntax in bash commands"
        })));
    }
    if mid_word_hash(command) {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            "bash command contains mid-word # with parser-differential risk",
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "mid_word_hash",
            "recovery_hint": "quote the argument explicitly or avoid # in unquoted word positions"
        })));
    }
    if backslash_escaped_whitespace(command) {
        return Err(ToolExecutionError::new(
            "bash_security_denied",
            "bash command contains backslash-escaped whitespace outside quotes",
        )
        .with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": "backslash_escaped_whitespace",
            "recovery_hint": "quote the full argument instead of escaping whitespace in command position"
        })));
    }
    if let Some(reason) = zsh_dangerous_command_reason(command) {
        return Err(ToolExecutionError::new("bash_security_denied", reason).with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": reason,
            "recovery_hint": "avoid zsh-specific execution, module, network, or file builtins"
        })));
    }

    if let Some(reason) = find_bash_security_violation(command) {
        return Err(ToolExecutionError::new("bash_security_denied", reason).with_data(json!({
            "diagnostic_kind": "bash_security_denied",
            "reason": reason,
            "recovery_hint": "remove the forbidden shell construct or use a safer command"
        })));
    }

    if let Some(path) = proc_environ_path(command) {
        return Err(
            ToolExecutionError::new(
                "bash_security_denied",
                format!("bash command accesses environment disclosure path: {path}"),
            )
            .with_data(json!({
                "diagnostic_kind": "bash_security_denied",
                "reason": "proc_environ_access",
                "path": path,
                "recovery_hint": "avoid reading /proc/*/environ; it may expose process secrets"
            })),
        );
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

fn first_unicode_whitespace_index(command: &str) -> Option<usize> {
    command.char_indices().find_map(|(index, ch)| {
        if matches!(
            ch,
            '\u{00A0}'
                | '\u{1680}'
                | '\u{2000}'..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
        ) {
            Some(index)
        } else {
            None
        }
    })
}

fn command_contains_carriage_return_outside_double_quotes(command: &str) -> bool {
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;

    for ch in command.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' && !in_single_quote {
            escaped = true;
            continue;
        }
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            continue;
        }
        if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            continue;
        }
        if ch == '\r' && !in_double_quote {
            return true;
        }
    }
    false
}

fn quoted_newline_hash_line(command: &str) -> bool {
    let chars: Vec<char> = command.chars().collect();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;
    let mut index = 0usize;

    while index < chars.len() {
        let ch = chars[index];
        if escaped {
            escaped = false;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '\\' && !in_single_quote {
            escaped = true;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '\n' && (in_single_quote || in_double_quote) {
            let mut cursor = index.saturating_add(1);
            while cursor < chars.len() && matches!(chars[cursor], ' ' | '\t' | '\r') {
                cursor = cursor.saturating_add(1);
            }
            if chars.get(cursor).copied() == Some('#') {
                return true;
            }
        }
        index = index.saturating_add(1);
    }

    false
}

fn comment_quote_desync(command: &str) -> bool {
    let chars: Vec<char> = command.chars().collect();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;
    let mut index = 0usize;

    while index < chars.len() {
        let ch = chars[index];
        if escaped {
            escaped = false;
            index = index.saturating_add(1);
            continue;
        }
        if in_single_quote {
            if ch == '\'' {
                in_single_quote = false;
            }
            index = index.saturating_add(1);
            continue;
        }
        if ch == '\\' {
            escaped = true;
            index = index.saturating_add(1);
            continue;
        }
        if in_double_quote {
            if ch == '"' {
                in_double_quote = false;
            }
            index = index.saturating_add(1);
            continue;
        }
        if ch == '\'' {
            in_single_quote = true;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '"' {
            in_double_quote = true;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '#' {
            let mut cursor = index.saturating_add(1);
            while let Some(next) = chars.get(cursor).copied() {
                if next == '\n' {
                    break;
                }
                if matches!(next, '\'' | '"') {
                    return true;
                }
                cursor = cursor.saturating_add(1);
            }
        }
        index = index.saturating_add(1);
    }

    false
}

fn mid_word_hash(command: &str) -> bool {
    let mut previous_unquoted: Option<char> = None;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;
    let mut chars = command.chars().peekable();

    while let Some(ch) = chars.next() {
        if escaped {
            escaped = false;
            if !in_single_quote && !in_double_quote {
                previous_unquoted = Some(ch);
            }
            continue;
        }
        if ch == '\\' && !in_single_quote {
            escaped = true;
            continue;
        }
        if ch == '\'' && !in_double_quote {
            previous_unquoted = Some(ch);
            in_single_quote = !in_single_quote;
            continue;
        }
        if ch == '"' && !in_single_quote {
            previous_unquoted = Some(ch);
            in_double_quote = !in_double_quote;
            continue;
        }
        if in_single_quote || in_double_quote {
            continue;
        }
        if ch == '#' && previous_unquoted.is_some_and(|prev| !prev.is_whitespace()) {
            return true;
        }
        previous_unquoted = Some(ch);
    }

    false
}

fn powershell_comment_syntax_reason(command: &str) -> Option<&'static str> {
    if unquoted_shell_text(command).contains("<#") {
        Some("PowerShell comment syntax is blocked")
    } else {
        None
    }
}

fn backslash_escaped_whitespace(command: &str) -> bool {
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut chars = command.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' && !in_single_quote {
            let next = chars.peek().copied();
            if !in_double_quote && matches!(next, Some(' ' | '\t')) {
                return true;
            }
            let _ = chars.next();
            continue;
        }
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            continue;
        }
        if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            continue;
        }
    }

    false
}

fn zsh_dangerous_command_reason(command: &str) -> Option<&'static str> {
    for segment in split_bash_command_segments(command) {
        let Ok(argv) = shell_words(segment.as_str()) else {
            continue;
        };
        let Some((base_index, base_command)) = zsh_base_command(&argv) else {
            continue;
        };
        if zsh_dangerous_command(base_command.as_str()) {
            return Some("zsh dangerous command is blocked");
        }
        if base_command == "fc"
            && argv
                .iter()
                .skip(base_index.saturating_add(1))
                .any(|arg| zsh_fc_editor_flag(arg.as_str()))
        {
            return Some("fc -e editor execution is blocked");
        }
    }

    None
}

fn zsh_base_command(argv: &[String]) -> Option<(usize, String)> {
    for (index, arg) in argv.iter().enumerate() {
        if shell_env_assignment_prefix(arg.as_str()) {
            continue;
        }
        if matches!(arg.as_str(), "command" | "builtin" | "noglob" | "nocorrect") {
            continue;
        }
        return Some((index, arg.to_ascii_lowercase()));
    }
    None
}

fn shell_env_assignment_prefix(arg: &str) -> bool {
    let Some((name, _value)) = arg.split_once('=') else {
        return false;
    };
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn zsh_dangerous_command(command: &str) -> bool {
    matches!(
        command,
        "zmodload"
            | "emulate"
            | "sysopen"
            | "sysread"
            | "syswrite"
            | "sysseek"
            | "zpty"
            | "ztcp"
            | "zsocket"
            | "mapfile"
            | "zf_rm"
            | "zf_mv"
            | "zf_ln"
            | "zf_chmod"
            | "zf_chown"
            | "zf_mkdir"
            | "zf_rmdir"
            | "zf_chgrp"
    )
}

fn zsh_fc_editor_flag(arg: &str) -> bool {
    arg == "--editor"
        || arg.starts_with("--editor=")
        || (arg.starts_with('-') && !arg.starts_with("--") && arg.chars().skip(1).any(|ch| ch == 'e'))
}

fn find_bash_security_violation(command: &str) -> Option<&'static str> {
    if zsh_glob_qualifier(command) {
        return Some("zsh glob qualifier execution is blocked");
    }
    if zsh_always_block(command) {
        return Some("zsh always block is blocked");
    }

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

        if ch == '\\' && !in_single_quote {
            escaped = true;
            index += 1;
            continue;
        }

        if !in_single_quote && !in_double_quote && consecutive_quote_obfuscation(&chars, index) {
            return Some("consecutive quote obfuscation is blocked");
        }
        if !in_single_quote && !in_double_quote && empty_quote_dash_obfuscation(&chars, index) {
            return Some("empty quote dash obfuscation is blocked");
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
            if ch == '$' && next == Some('\'') {
                return Some("ANSI-C shell quoting is blocked");
            }
            if ch == '$' && next == Some('"') {
                return Some("locale shell quoting is blocked");
            }
            if ch == '`' {
                return Some("command substitution using backticks is blocked");
            }
            if ch == '$' && next == Some('(') {
                return Some("command substitution using $(...) is blocked");
            }
            if ch == '$' && next == Some('[') {
                return Some("legacy arithmetic expansion is blocked");
            }
            if ch == '$' && shell_variable_expansion_follows(next) {
                return Some("shell variable expansion is blocked");
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
            if ch == '=' && next == Some('(') {
                return Some("process substitution =(...) is blocked");
            }
            if ch == '=' && next.is_some_and(|value| value == '_' || value.is_ascii_alphabetic())
                && command_word_starts_at(&chars, index)
            {
                return Some("zsh equals expansion is blocked");
            }
            if ch == '~' && next == Some('[') {
                return Some("zsh-style parameter expansion is blocked");
            }
            if ch == '(' && next == Some('e') && next_next == Some(':') {
                return Some("zsh glob qualifier execution is blocked");
            }
            if ch == '(' && next == Some('+') {
                return Some("zsh glob qualifier execution is blocked");
            }
            if ch == '<' && next == Some('#') {
                return Some("PowerShell comment syntax is blocked");
            }
        }

        if !in_single_quote && !in_double_quote && matches!(ch, '*' | '?' | '[') {
            return Some("unquoted shell glob expansion is blocked");
        }
        if !in_single_quote && !in_double_quote && matches!(ch, '{' | '}') {
            return Some("unquoted shell brace expansion is blocked");
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

fn command_word_starts_at(chars: &[char], index: usize) -> bool {
    if index == 0 {
        return true;
    }
    chars
        .get(index.saturating_sub(1))
        .is_some_and(|ch| ch.is_whitespace() || matches!(ch, ';' | '&' | '|'))
}

fn zsh_always_block(command: &str) -> bool {
    unquoted_shell_text(command).contains("} always {")
}

fn zsh_glob_qualifier(command: &str) -> bool {
    let unquoted = unquoted_shell_text(command);
    unquoted.contains("(e:") || unquoted.contains("(+")
}

fn unquoted_shell_text(command: &str) -> String {
    let mut result = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;

    for ch in command.chars() {
        if escaped {
            escaped = false;
            if !in_single_quote && !in_double_quote {
                result.push(ch);
            }
            continue;
        }
        if ch == '\\' && !in_single_quote {
            escaped = true;
            continue;
        }
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            result.push(' ');
            continue;
        }
        if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            result.push(' ');
            continue;
        }
        if in_single_quote || in_double_quote {
            result.push(' ');
        } else {
            result.push(ch);
        }
    }

    result
}

fn empty_quote_dash_obfuscation(chars: &[char], start: usize) -> bool {
    let Some(quote) = chars.get(start).copied() else {
        return false;
    };
    if !matches!(quote, '\'' | '"') || chars.get(start + 1).copied() != Some(quote) {
        return false;
    }

    let mut index = start;
    while chars.get(index).copied() == Some(quote)
        && chars.get(index + 1).copied() == Some(quote)
    {
        index = index.saturating_add(2);
    }
    while chars.get(index).is_some_and(|ch| matches!(ch, ' ' | '\t')) {
        index = index.saturating_add(1);
    }
    chars.get(index).copied() == Some('-')
}

fn consecutive_quote_obfuscation(chars: &[char], start: usize) -> bool {
    let Some(quote) = chars.get(start).copied() else {
        return false;
    };
    if !matches!(quote, '\'' | '"') {
        return false;
    }
    let word_start = if start == 0 {
        true
    } else {
        chars
            .get(start.saturating_sub(1))
            .is_some_and(|ch| ch.is_whitespace() || matches!(ch, ';' | '|' | '&'))
    };
    word_start
        && chars.get(start + 1).copied() == Some(quote)
        && chars.get(start + 2).copied() == Some(quote)
}

fn shell_variable_expansion_follows(next: Option<char>) -> bool {
    next.is_some_and(|value| {
        value == '{'
            || value == '_'
            || value.is_ascii_alphabetic()
            || matches!(value, '@' | '*' | '#' | '?' | '!' | '$' | '-' | '0'..='9')
    })
}

fn proc_environ_path(command: &str) -> Option<String> {
    let normalized = command.replace("\\e", "e").replace("\\n", "n");
    for token in normalized.split(|ch: char| ch.is_whitespace() || matches!(ch, '<' | '>' | '|' | ';' | '&')) {
        let token = token.trim_matches(|ch| matches!(ch, '"' | '\'' | '(' | ')' | '[' | ']' | ',' | ':'));
        if token.starts_with("/proc/") && token.ends_with("/environ") {
            return Some(token.to_string());
        }
    }
    None
}
