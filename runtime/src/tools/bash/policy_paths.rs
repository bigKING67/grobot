fn extract_bash_redirections(raw: &str) -> Vec<BashRedirection> {
    let chars: Vec<char> = raw.chars().collect();
    let mut redirections = Vec::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut index = 0usize;

    while index < chars.len() {
        let ch = chars[index];
        if escaped {
            escaped = false;
            index += 1;
            continue;
        }
        if ch == '\\' && !in_single {
            escaped = true;
            index += 1;
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            index += 1;
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            index += 1;
            continue;
        }
        if in_single || in_double {
            index += 1;
            continue;
        }

        if ch != '<' && ch != '>' {
            index += 1;
            continue;
        }

        let previous_is_fd = index > 0 && chars[index - 1].is_ascii_digit();
        let operator_start = if previous_is_fd {
            index.saturating_sub(1)
        } else {
            index
        };
        let kind = if ch == '<' {
            BashRedirectionKind::Input
        } else {
            BashRedirectionKind::Output
        };
        let mut cursor = index.saturating_add(1);
        if ch == '>' && chars.get(cursor).copied() == Some('>') {
            cursor = cursor.saturating_add(1);
        }
        if chars.get(cursor).copied() == Some('&') {
            cursor = cursor.saturating_add(1);
            let (target, next_index) = read_bash_redirection_target(&chars, cursor);
            redirections.push(BashRedirection {
                kind,
                target: target.clone(),
                fd_target: target
                    .as_deref()
                    .is_some_and(|value| value == "-" || value.chars().all(|ch| ch.is_ascii_digit())),
                dynamic_target: target
                    .as_deref()
                    .is_some_and(bash_redirection_target_is_dynamic),
            });
            index = next_index.max(operator_start.saturating_add(1));
            continue;
        }

        let (target, next_index) = read_bash_redirection_target(&chars, cursor);
        redirections.push(BashRedirection {
            kind,
            fd_target: false,
            dynamic_target: target
                .as_deref()
                .is_some_and(bash_redirection_target_is_dynamic),
            target,
        });
        index = next_index.max(operator_start.saturating_add(1));
    }

    redirections
}

fn read_bash_redirection_target(chars: &[char], mut index: usize) -> (Option<String>, usize) {
    while chars.get(index).is_some_and(|ch| ch.is_whitespace()) {
        index = index.saturating_add(1);
    }
    let mut target = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    while let Some(ch) = chars.get(index).copied() {
        if escaped {
            target.push(ch);
            escaped = false;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '\\' && !in_single {
            escaped = true;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            index = index.saturating_add(1);
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            index = index.saturating_add(1);
            continue;
        }
        if ch.is_whitespace() && !in_single && !in_double {
            break;
        }
        if !in_single && !in_double && matches!(ch, ';' | '|' | '&' | '<' | '>') {
            break;
        }
        target.push(ch);
        index = index.saturating_add(1);
    }

    let trimmed = target.trim();
    if trimmed.is_empty() {
        (None, index)
    } else {
        (Some(trimmed.to_string()), index)
    }
}

fn bash_redirection_target_is_dynamic(target: &str) -> bool {
    target.starts_with('$')
        || target.contains("${")
        || target.contains("$(")
        || target.contains('`')
}

fn extract_segment_paths(segment: &ParsedBashSegment) -> Vec<String> {
    let command = segment.command_name();
    let args = &segment.argv[1..];
    match command.as_str() {
        "cd" => {
            if args.is_empty() {
                vec!["~".to_string()]
            } else {
                vec![args.join(" ")]
            }
        }
        "ls" | "cat" | "head" | "tail" | "sort" | "uniq" | "wc" | "cut" | "file" | "stat"
        | "diff" | "strings" | "hexdump" | "od" | "base64" | "nl" | "sha256sum" | "sha1sum"
        | "md5sum" | "rm" | "rmdir" | "mkdir" | "touch" | "cp" | "mv" | "chmod" | "chown"
        | "tee" => {
            filter_shell_flags(args)
        }
        "find" => extract_find_paths(args),
        "git" => extract_git_paths(args),
        "grep" | "rg" => extract_pattern_command_paths(args),
        "sed" => extract_sed_paths(args),
        _ => Vec::new(),
    }
}

fn filter_shell_flags(args: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    let mut after_double_dash = false;
    for arg in args {
        if after_double_dash {
            result.push(arg.clone());
        } else if arg == "--" {
            after_double_dash = true;
        } else if !arg.starts_with('-') {
            result.push(arg.clone());
        }
    }
    result
}

fn extract_find_paths(args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut after_double_dash = false;
    let mut found_predicate = false;
    let path_flags = [
        "-newer",
        "-anewer",
        "-cnewer",
        "-mnewer",
        "-samefile",
        "-path",
        "-wholename",
        "-ilname",
        "-lname",
        "-ipath",
        "-iwholename",
    ];
    let mut index = 0usize;
    while index < args.len() {
        let arg = &args[index];
        if after_double_dash {
            paths.push(arg.clone());
            index += 1;
            continue;
        }
        if arg == "--" {
            after_double_dash = true;
            index += 1;
            continue;
        }
        if arg.starts_with('-') {
            if !matches!(arg.as_str(), "-H" | "-L" | "-P") {
                found_predicate = true;
            }
            if path_flags.contains(&arg.as_str()) || arg.starts_with("-newer") {
                if let Some(next) = args.get(index + 1) {
                    paths.push(next.clone());
                    index += 2;
                    continue;
                }
            }
            index += 1;
            continue;
        }
        if !found_predicate {
            paths.push(arg.clone());
        }
        index += 1;
    }
    if paths.is_empty() {
        paths.push(".".to_string());
    }
    paths
}

fn extract_git_paths(args: &[String]) -> Vec<String> {
    let mut paths = git_global_cwd_paths(args);
    let Some(diff_index) = args.iter().position(|arg| arg == "diff") else {
        return paths;
    };
    if !args
        .iter()
        .skip(diff_index.saturating_add(1))
        .any(|arg| arg == "--no-index")
    {
        return paths;
    }

    let mut after_double_dash = false;
    let mut index = diff_index.saturating_add(1);
    while index < args.len() {
        let arg = &args[index];
        if after_double_dash {
            paths.push(arg.clone());
            index += 1;
            continue;
        }
        if arg == "--" {
            after_double_dash = true;
            index += 1;
            continue;
        }
        if arg.starts_with('-') {
            index += 1;
            continue;
        }
        paths.push(arg.clone());
        index += 1;
    }
    paths
}

fn extract_pattern_command_paths(args: &[String]) -> Vec<String> {
    let flags_with_args = [
        "-e",
        "--regexp",
        "-f",
        "--file",
        "--exclude",
        "--include",
        "--exclude-dir",
        "--include-dir",
        "-m",
        "--max-count",
        "-A",
        "--after-context",
        "-B",
        "--before-context",
        "-C",
        "--context",
        "-g",
        "--glob",
        "--max-depth",
        "-t",
        "--type",
        "-T",
        "--type-not",
    ];
    let mut paths = Vec::new();
    let mut pattern_found = false;
    let mut after_double_dash = false;
    let mut index = 0usize;
    while index < args.len() {
        let arg = &args[index];
        if !after_double_dash && arg == "--" {
            after_double_dash = true;
            index += 1;
            continue;
        }
        if !after_double_dash && arg.starts_with('-') {
            let flag = arg.split('=').next().unwrap_or(arg.as_str());
            if matches!(flag, "-e" | "--regexp" | "-f" | "--file") {
                pattern_found = true;
            }
            if flags_with_args.contains(&flag) && !arg.contains('=') {
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if !pattern_found {
            pattern_found = true;
            index += 1;
            continue;
        }
        paths.push(arg.clone());
        index += 1;
    }
    if paths.is_empty() && args.iter().any(|arg| matches!(arg.as_str(), "-r" | "-R" | "--recursive")) {
        paths.push(".".to_string());
    }
    paths
}

fn extract_sed_paths(args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut consumed_expression = false;
    let mut index = 0usize;
    while index < args.len() {
        let arg = &args[index];
        if arg == "-e" || arg == "--expression" {
            index += 2;
            consumed_expression = true;
            continue;
        }
        if arg.starts_with("--expression=") || arg.starts_with("-e=") {
            consumed_expression = true;
            index += 1;
            continue;
        }
        if arg.starts_with('-') {
            index += 1;
            continue;
        }
        if !consumed_expression {
            consumed_expression = true;
            index += 1;
            continue;
        }
        paths.push(arg.clone());
        index += 1;
    }
    paths
}

fn paths_workspace_safe(
    context: &ToolContextResolved,
    paths: &[String],
    risk: BashCommandRisk,
) -> bool {
    if paths.is_empty() {
        return true;
    }
    for raw in paths {
        let normalized = raw.trim().trim_matches('"').trim_matches('\'');
        if normalized.is_empty() || normalized == "~" {
            if risk != BashCommandRisk::ReadOnly {
                return false;
            }
            continue;
        }
        let candidate = if Path::new(normalized).is_absolute() {
            PathBuf::from(normalized)
        } else {
            context.work_dir.join(normalized)
        };
        let resolved = if candidate.exists() {
            match fs::canonicalize(&candidate) {
                Ok(value) => value,
                Err(_) => return false,
            }
        } else {
            let Some(parent) = candidate.parent() else {
                return false;
            };
            let Ok(parent) = fs::canonicalize(parent) else {
                return false;
            };
            let Some(file_name) = candidate.file_name() else {
                return false;
            };
            parent.join(file_name)
        };
        if !resolved.starts_with(&context.work_dir) {
            return false;
        }
    }
    true
}

fn first_git_internal_write_path(
    context: &ToolContextResolved,
    paths: &[String],
    compound_has_git: bool,
) -> Option<String> {
    for raw in paths {
        let normalized = normalize_bash_policy_path_text(raw);
        if normalized.is_empty() || normalized == "~" {
            continue;
        }
        if path_targets_dot_git_internal(context, normalized.as_str()) {
            return Some(normalized);
        }
        if compound_has_git && path_targets_bare_git_internal(normalized.as_str()) {
            return Some(normalized);
        }
    }
    None
}

fn normalize_bash_policy_path_text(raw: &str) -> String {
    raw.trim().trim_matches('"').trim_matches('\'').to_string()
}

fn path_targets_dot_git_internal(context: &ToolContextResolved, normalized: &str) -> bool {
    let path = Path::new(normalized);
    let candidate = if path.is_absolute() {
        PathBuf::from(path)
    } else {
        context.work_dir.join(path)
    };
    candidate.components().any(|component| {
        matches!(
            component,
            std::path::Component::Normal(value) if value == std::ffi::OsStr::new(".git")
        )
    })
}

fn path_targets_bare_git_internal(normalized: &str) -> bool {
    let path = Path::new(normalized);
    if path.is_absolute() {
        return false;
    }
    let mut components = path.components().filter_map(|component| match component {
        std::path::Component::CurDir => None,
        std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
        _ => None,
    });
    let Some(first) = components.next() else {
        return false;
    };
    if first == "HEAD" {
        return components.next().is_none();
    }
    matches!(first.as_str(), "objects" | "refs" | "hooks")
}

fn first_dangerous_removal_path(context: &ToolContextResolved, paths: &[String]) -> Option<String> {
    for raw in paths {
        let normalized = raw.trim().trim_matches('"').trim_matches('\'');
        if normalized.is_empty() {
            continue;
        }
        let candidate = if Path::new(normalized).is_absolute() {
            PathBuf::from(normalized)
        } else {
            context.work_dir.join(normalized)
        };
        let comparable = if candidate == PathBuf::from("/") {
            "/".to_string()
        } else {
            candidate.to_string_lossy().trim_end_matches('/').to_string()
        };
        if BASH_DANGEROUS_PATHS.iter().any(|path| comparable == *path) {
            return Some(comparable);
        }
    }
    None
}

fn bash_policy_segments_json(
    evaluation: &BashPolicyEvaluation,
    policy: &BashRuntimePolicy,
) -> Vec<Value> {
    evaluation
        .segments
        .iter()
        .map(|segment| {
            json!({
                "segment": sanitize_bash_audit_value(
                    segment.segment.as_str(),
                    policy.audit_segment_chars,
                    policy.audit_redact_secrets
                ),
                "command_name": segment.command_name,
                "risk_class": segment.risk.as_str(),
                "decision": segment.decision.as_str(),
                "reason": segment.reason,
                "matched_rule": segment.matched_rule,
                "paths": segment.paths,
            })
        })
        .collect()
}
