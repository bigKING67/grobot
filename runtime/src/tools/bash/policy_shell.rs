fn parse_bash_segments(command: &str) -> Result<Vec<ParsedBashSegment>, ToolExecutionError> {
    split_bash_command_segments(command)
        .into_iter()
        .map(|segment| {
            let mut argv = shell_words(segment.as_str()).map_err(|message| {
                ToolExecutionError::new("bash_security_denied", message).with_data(json!({
                    "diagnostic_kind": "bash_security_denied",
                    "reason": "shell_parse_failed",
                    "recovery_hint": "quote the command with simple POSIX shell syntax and retry"
                }))
            })?;
            argv = strip_safe_env_assignments(argv);
            argv = strip_safe_wrapper_commands(argv);
            Ok(ParsedBashSegment { raw: segment, argv })
        })
        .collect()
}

fn shell_words(raw: &str) -> Result<Vec<String>, &'static str> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut chars = raw.chars();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut saw_word = false;

    for ch in chars.by_ref() {
        if escaped {
            current.push(ch);
            escaped = false;
            saw_word = true;
            continue;
        }
        if ch == '\\' && !in_single {
            escaped = true;
            saw_word = true;
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            saw_word = true;
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            saw_word = true;
            continue;
        }
        if ch.is_whitespace() && !in_single && !in_double {
            if saw_word {
                words.push(current.clone());
                current.clear();
                saw_word = false;
            }
            continue;
        }
        current.push(ch);
        saw_word = true;
    }
    if escaped {
        return Err("trailing escape is blocked");
    }
    if in_single {
        return Err("unbalanced single quote is blocked");
    }
    if in_double {
        return Err("unbalanced double quote is blocked");
    }
    if saw_word {
        words.push(current);
    }
    Ok(words)
}

fn strip_safe_env_assignments(argv: Vec<String>) -> Vec<String> {
    let first_non_env = argv
        .iter()
        .position(|word| !safe_env_assignment(word.as_str()))
        .unwrap_or(argv.len());
    if first_non_env == 0 {
        return argv;
    }
    argv.into_iter().skip(first_non_env).collect()
}

fn strip_safe_wrapper_commands(mut argv: Vec<String>) -> Vec<String> {
    loop {
        if argv.first().is_some_and(|value| value == "time" || value == "nohup") {
            let skip = if argv.get(1).is_some_and(|value| value == "--") {
                2
            } else {
                1
            };
            argv = argv.into_iter().skip(skip).collect();
            continue;
        }
        if argv.first().is_some_and(|value| value == "timeout") {
            let Some(duration_index) = skip_timeout_flags(&argv) else {
                return argv;
            };
            if !argv
                .get(duration_index)
                .is_some_and(|value| safe_timeout_duration(value.as_str()))
            {
                return argv;
            }
            argv = argv.into_iter().skip(duration_index.saturating_add(1)).collect();
            continue;
        }
        if argv.first().is_some_and(|value| value == "nice") {
            let Some(command_index) = skip_nice_flags(&argv) else {
                return argv;
            };
            argv = argv.into_iter().skip(command_index).collect();
            continue;
        }
        if argv.first().is_some_and(|value| value == "stdbuf") {
            let Some(command_index) = skip_stdbuf_flags(&argv) else {
                return argv;
            };
            argv = argv.into_iter().skip(command_index).collect();
            continue;
        }
        if argv.first().is_some_and(|value| value == "env") {
            let Some(command_index) = skip_env_flags(&argv) else {
                return argv;
            };
            argv = argv.into_iter().skip(command_index).collect();
            continue;
        }
        return argv;
    }
}

fn skip_timeout_flags(argv: &[String]) -> Option<usize> {
    let mut index = 1usize;
    while index < argv.len() {
        let arg = argv[index].as_str();
        let next = argv.get(index + 1).map(|value| value.as_str());
        if matches!(arg, "--foreground" | "--preserve-status" | "--verbose" | "-v") {
            index = index.saturating_add(1);
        } else if timeout_long_flag_has_inline_value(arg) {
            index = index.saturating_add(1);
        } else if matches!(arg, "--kill-after" | "--signal") && next.is_some_and(safe_wrapper_value) {
            index = index.saturating_add(2);
        } else if arg == "--" {
            index = index.saturating_add(1);
            break;
        } else if matches!(arg, "-k" | "-s") && next.is_some_and(safe_wrapper_value) {
            index = index.saturating_add(2);
        } else if (arg.starts_with("-k") || arg.starts_with("-s"))
            && arg.len() > 2
            && safe_wrapper_value(&arg[2..])
        {
            index = index.saturating_add(1);
        } else if arg.starts_with('-') {
            return None;
        } else {
            break;
        }
    }
    Some(index)
}

fn timeout_long_flag_has_inline_value(arg: &str) -> bool {
    for prefix in ["--kill-after=", "--signal="] {
        if let Some(value) = arg.strip_prefix(prefix) {
            return safe_wrapper_value(value);
        }
    }
    false
}

fn skip_nice_flags(argv: &[String]) -> Option<usize> {
    if argv.len() <= 1 {
        return None;
    }
    if argv.get(1).is_some_and(|value| value == "--") {
        return argv.get(2).map(|_| 2);
    }
    if argv.get(1).is_some_and(|value| value == "-n") {
        let value = argv.get(2)?;
        if safe_signed_integer(value.as_str()) {
            if argv.get(3).is_some_and(|value| value == "--") {
                return argv.get(4).map(|_| 4);
            }
            return argv.get(3).map(|_| 3);
        }
        return None;
    }
    if argv
        .get(1)
        .is_some_and(|value| value.starts_with('-') && safe_signed_integer(value.as_str()))
    {
        if argv.get(2).is_some_and(|value| value == "--") {
            return argv.get(3).map(|_| 3);
        }
        return argv.get(2).map(|_| 2);
    }
    argv.get(1).map(|_| 1)
}

fn skip_stdbuf_flags(argv: &[String]) -> Option<usize> {
    let mut index = 1usize;
    while index < argv.len() {
        let arg = argv[index].as_str();
        if stdbuf_short_flag_has_inline_value(arg) {
            index = index.saturating_add(1);
        } else if matches!(arg, "-i" | "-o" | "-e") && argv.get(index + 1).is_some() {
            index = index.saturating_add(2);
        } else if stdbuf_long_flag_has_inline_value(arg) {
            index = index.saturating_add(1);
        } else if arg.starts_with('-') {
            return None;
        } else {
            break;
        }
    }
    if index > 1 && index < argv.len() {
        Some(index)
    } else {
        None
    }
}

fn stdbuf_short_flag_has_inline_value(arg: &str) -> bool {
    if arg.len() <= 2 {
        return false;
    }
    let mut chars = arg.chars();
    if chars.next() != Some('-') {
        return false;
    }
    let Some(flag) = chars.next() else {
        return false;
    };
    matches!(flag, 'i' | 'o' | 'e') && safe_wrapper_value(chars.as_str())
}

fn stdbuf_long_flag_has_inline_value(arg: &str) -> bool {
    for prefix in ["--input=", "--output=", "--error="] {
        if let Some(value) = arg.strip_prefix(prefix) {
            return safe_wrapper_value(value);
        }
    }
    false
}

fn skip_env_flags(argv: &[String]) -> Option<usize> {
    let mut index = 1usize;
    while index < argv.len() {
        let arg = argv[index].as_str();
        if safe_env_assignment(arg) || matches!(arg, "-i" | "-0" | "-v") {
            index = index.saturating_add(1);
        } else if arg == "-u" && argv.get(index + 1).is_some() {
            index = index.saturating_add(2);
        } else if arg.starts_with('-') {
            return None;
        } else {
            break;
        }
    }
    if index < argv.len() {
        Some(index)
    } else {
        None
    }
}

fn safe_env_assignment(word: &str) -> bool {
    let Some((name, value)) = word.split_once('=') else {
        return false;
    };
    !name.is_empty()
        && SAFE_BASH_ENV_ASSIGNMENTS.contains(&name)
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '/' | ':' | '-'))
}

fn safe_wrapper_value(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '+' | '-'))
}

fn safe_timeout_duration(value: &str) -> bool {
    let mut chars = value.chars().peekable();
    let mut saw_digit = false;
    while chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
        saw_digit = true;
        let _ = chars.next();
    }
    if chars.peek() == Some(&'.') {
        let _ = chars.next();
        let mut saw_fraction_digit = false;
        while chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
            saw_fraction_digit = true;
            let _ = chars.next();
        }
        if !saw_fraction_digit {
            return false;
        }
    }
    if !saw_digit {
        return false;
    }
    match chars.next() {
        Some('s' | 'm' | 'h' | 'd') => chars.next().is_none(),
        Some(_) => false,
        None => true,
    }
}

fn safe_signed_integer(value: &str) -> bool {
    let value = value.strip_prefix('-').unwrap_or(value);
    !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit())
}

const SAFE_BASH_ENV_ASSIGNMENTS: &[&str] = &[
    "BLOCK_SIZE",
    "BLOCKSIZE",
    "CGO_ENABLED",
    "CHARSET",
    "COLORTERM",
    "FORCE_COLOR",
    "GCC_COLORS",
    "GO111MODULE",
    "GOARCH",
    "GOEXPERIMENT",
    "GOOS",
    "GREP_COLOR",
    "GREP_COLORS",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "LC_TIME",
    "LSCOLORS",
    "LS_COLORS",
    "NODE_ENV",
    "NO_COLOR",
    "PYTEST_DEBUG",
    "PYTEST_DISABLE_PLUGIN_AUTOLOAD",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONUNBUFFERED",
    "RUST_BACKTRACE",
    "RUST_LOG",
    "TERM",
    "TIME_STYLE",
    "TZ",
];
