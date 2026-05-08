fn split_bash_command_segments(command: &str) -> Vec<String> {
    let mut segments: Vec<String> = Vec::new();
    let mut current = String::new();

    let mut chars = command.chars().peekable();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;

    while let Some(ch) = chars.next() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        if ch == '\\' && !in_single_quote {
            current.push(ch);
            escaped = true;
            continue;
        }

        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            current.push(ch);
            continue;
        }
        if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            current.push(ch);
            continue;
        }

        if !in_single_quote && !in_double_quote {
            match ch {
                ';' => {
                    push_bash_segment(&mut segments, &mut current);
                    continue;
                }
                '\n' | '\r' => {
                    push_bash_segment(&mut segments, &mut current);
                    continue;
                }
                '|' => {
                    if chars.peek() == Some(&'|') {
                        let _ = chars.next();
                    }
                    push_bash_segment(&mut segments, &mut current);
                    continue;
                }
                '&' => {
                    if current.ends_with('>') || current.ends_with('<') {
                        current.push(ch);
                        continue;
                    }
                    if chars.peek() == Some(&'&') {
                        let _ = chars.next();
                    }
                    push_bash_segment(&mut segments, &mut current);
                    continue;
                }
                _ => {}
            }
        }

        current.push(ch);
    }

    push_bash_segment(&mut segments, &mut current);
    segments
}

fn push_bash_segment(segments: &mut Vec<String>, current: &mut String) {
    let normalized = current.trim();
    if !normalized.is_empty() {
        segments.push(normalized.to_string());
    }
    current.clear();
}

fn find_bash_allowlist_match(segment: &str, allowlist: &[String]) -> Option<String> {
    let normalized_segment = segment.trim();
    if normalized_segment.is_empty() {
        return None;
    }

    for rule in allowlist {
        let normalized_rule = rule.trim();
        if normalized_rule.is_empty() {
            continue;
        }
        if normalized_rule == "*" {
            return Some(normalized_rule.to_string());
        }
        if let Some(prefix) = normalized_rule.strip_suffix('*') {
            if normalized_segment.starts_with(prefix) {
                return Some(normalized_rule.to_string());
            }
            continue;
        }
        if normalized_segment == normalized_rule {
            return Some(normalized_rule.to_string());
        }
        let prefix = format!("{normalized_rule} ");
        if normalized_segment.starts_with(&prefix) {
            return Some(normalized_rule.to_string());
        }
    }

    None
}

fn find_bash_allowlist_match_for_segment(
    segment: &ParsedBashSegment,
    allowlist: &[String],
) -> Option<String> {
    find_bash_allowlist_match(segment.raw.as_str(), allowlist).or_else(|| {
        if segment.argv.is_empty() {
            return None;
        }
        find_bash_allowlist_match(segment.argv.join(" ").as_str(), allowlist)
    })
}
