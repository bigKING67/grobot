fn sed_segment_is_read_only(segment: &ParsedBashSegment) -> bool {
    let analysis = analyze_sed_args(&segment.argv[1..]);
    sed_line_printing_allowed(&analysis) || sed_stdout_substitution_allowed(&analysis)
}

#[derive(Debug)]
struct SedArgAnalysis {
    flags: Vec<String>,
    expressions: Vec<String>,
    has_file_args: bool,
}

fn analyze_sed_args(args: &[String]) -> SedArgAnalysis {
    let mut expressions = Vec::new();
    let mut flags = Vec::new();
    let mut has_file_args = false;
    let mut consumed_expression = false;
    let mut used_expression_flag = false;
    let mut index = 0usize;
    while index < args.len() {
        let arg = &args[index];
        if arg == "-e" || arg == "--expression" {
            flags.push(arg.clone());
            let Some(expr) = args.get(index + 1) else {
                return SedArgAnalysis {
                    flags,
                    expressions,
                    has_file_args: true,
                };
            };
            expressions.push(expr.clone());
            consumed_expression = true;
            used_expression_flag = true;
            index += 2;
            continue;
        }
        if let Some(expr) = arg.strip_prefix("--expression=") {
            flags.push("--expression".to_string());
            expressions.push(expr.to_string());
            consumed_expression = true;
            used_expression_flag = true;
            index += 1;
            continue;
        }
        if let Some(expr) = arg.strip_prefix("-e=") {
            flags.push("-e".to_string());
            expressions.push(expr.to_string());
            consumed_expression = true;
            used_expression_flag = true;
            index += 1;
            continue;
        }
        if arg.starts_with('-') {
            flags.push(arg.clone());
            index += 1;
            continue;
        }

        if !consumed_expression && !used_expression_flag {
            expressions.push(arg.clone());
            consumed_expression = true;
            index += 1;
            continue;
        }

        has_file_args = true;
        index += 1;
    }

    SedArgAnalysis {
        flags,
        expressions,
        has_file_args,
    }
}

fn sed_line_printing_allowed(analysis: &SedArgAnalysis) -> bool {
    if !sed_flags_allowed(
        &analysis.flags,
        &[
            "-n",
            "--quiet",
            "--silent",
            "-E",
            "--regexp-extended",
            "-r",
            "-z",
            "--zero-terminated",
            "--posix",
        ],
    ) {
        return false;
    }
    let has_quiet = analysis.flags.iter().any(|arg| {
        arg == "-n"
            || arg == "--quiet"
            || arg == "--silent"
            || (arg.starts_with('-') && !arg.starts_with("--") && arg.contains('n'))
    });
    if !has_quiet || analysis.expressions.is_empty() {
        return false;
    }
    analysis
        .expressions
        .iter()
        .all(|expr| expr.split(';').all(|cmd| sed_print_command_allowed(cmd.trim())))
}

fn sed_stdout_substitution_allowed(analysis: &SedArgAnalysis) -> bool {
    if analysis.has_file_args || analysis.expressions.len() != 1 {
        return false;
    }
    if !sed_flags_allowed(
        &analysis.flags,
        &["-E", "--regexp-extended", "-r", "--posix"],
    ) {
        return false;
    }
    sed_substitution_command_allowed(analysis.expressions[0].trim())
}

fn sed_flags_allowed(flags: &[String], allowed: &[&str]) -> bool {
    for flag in flags {
        if flag == "--" {
            return false;
        }
        if flag == "-e" || flag == "--expression" {
            continue;
        }
        if flag.starts_with("--") {
            if !allowed.contains(&flag.as_str()) {
                return false;
            }
            continue;
        }
        if flag.starts_with('-') && flag.len() > 2 {
            for ch in flag.chars().skip(1) {
                let short = format!("-{ch}");
                if !allowed.contains(&short.as_str()) {
                    return false;
                }
            }
            continue;
        }
        if !allowed.contains(&flag.as_str()) {
            return false;
        }
    }
    true
}

fn sed_print_command_allowed(cmd: &str) -> bool {
    if cmd == "p" {
        return true;
    }
    let Some(prefix) = cmd.strip_suffix('p') else {
        return false;
    };
    if prefix.is_empty() {
        return true;
    }
    let mut parts = prefix.split(',');
    let Some(first) = parts.next() else {
        return false;
    };
    if first.is_empty() || !first.chars().all(|ch| ch.is_ascii_digit()) {
        return false;
    }
    if let Some(second) = parts.next() {
        if second.is_empty() || !second.chars().all(|ch| ch.is_ascii_digit()) {
            return false;
        }
    }
    parts.next().is_none()
}

fn sed_substitution_command_allowed(expr: &str) -> bool {
    if !expr.starts_with("s/") || expr.contains(';') || sed_expression_has_dangerous_ops(expr) {
        return false;
    }
    sed_substitution_flags(expr).is_some()
}

fn sed_substitution_flags(expr: &str) -> Option<&str> {
    let rest = expr.strip_prefix("s/")?;
    let mut delimiter_count = 0usize;
    let mut last_delimiter = None;
    let mut escaped = false;
    for (index, ch) in rest.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '/' {
            delimiter_count = delimiter_count.saturating_add(1);
            last_delimiter = Some(index);
        }
    }
    if delimiter_count != 2 {
        return None;
    }
    let flags = &rest[last_delimiter?.saturating_add(1)..];
    if sed_substitution_flags_safe(flags) {
        Some(flags)
    } else {
        None
    }
}

fn sed_substitution_flags_safe(flags: &str) -> bool {
    let mut digit_count = 0usize;
    for ch in flags.chars() {
        if matches!(ch, 'g' | 'p' | 'i' | 'I' | 'm' | 'M') {
            continue;
        }
        if matches!(ch, '1'..='9') {
            digit_count = digit_count.saturating_add(1);
            if digit_count > 1 {
                return false;
            }
            continue;
        }
        return false;
    }
    true
}

fn sed_expression_has_dangerous_ops(expr: &str) -> bool {
    !expr.is_ascii()
        || expr.contains('{')
        || expr.contains('}')
        || expr.contains('\n')
        || sed_expression_has_dangerous_hash(expr)
        || expr.starts_with('!')
        || expr.starts_with(',')
        || expr.contains('~')
        || expr.contains("\\|")
        || expr.contains("\\#")
        || expr.contains("\\%")
        || sed_write_or_execute_command(expr)
}

fn sed_expression_has_dangerous_hash(expr: &str) -> bool {
    let Some(index) = expr.find('#') else {
        return false;
    };
    index == 0 || expr.as_bytes().get(index.saturating_sub(1)).copied() != Some(b's')
}

fn sed_write_or_execute_command(expr: &str) -> bool {
    let trimmed = expr.trim();
    trimmed.starts_with('e')
        || trimmed.starts_with('E')
        || trimmed.starts_with('w')
        || trimmed.starts_with('W')
        || trimmed.contains("/w ")
        || trimmed.contains("/W ")
        || trimmed.contains("/e")
        || trimmed.contains("/E")
}
