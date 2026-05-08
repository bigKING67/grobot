const BASH_READONLY_GIT_SUBCOMMANDS: &[&str] = &[
    "blame",
    "diff",
    "grep",
    "log",
    "ls-files",
    "rev-parse",
    "show",
    "status",
];

fn git_segment_is_read_only(segment: &ParsedBashSegment) -> bool {
    let subcommand = first_git_subcommand(&segment.argv[1..]);
    match subcommand.as_deref() {
        Some("branch") => git_branch_is_read_only(&segment.argv[1..]),
        Some("remote") => git_remote_is_read_only(&segment.argv[1..]),
        Some("tag") => git_tag_is_read_only(&segment.argv[1..]),
        Some(value) => BASH_READONLY_GIT_SUBCOMMANDS.contains(&value),
        None => false,
    }
}

fn git_unsafe_flag_reason(segment: &ParsedBashSegment) -> Option<&'static str> {
    if let Some(reason) = git_global_unsafe_flag_reason(&segment.argv[1..]) {
        return Some(reason);
    }

    let subcommand = first_git_subcommand(&segment.argv[1..]);
    for arg in git_args_after_global_options(&segment.argv[1..]) {
        if arg == "--ext-diff" || arg.starts_with("--ext-diff=") {
            return Some("git_ext_diff_flag");
        }
        if arg == "--output" || arg.starts_with("--output=") {
            return Some("git_output_flag");
        }
        if arg == "--textconv" || arg.starts_with("--textconv=") {
            return Some("git_textconv_flag");
        }
        if arg == "--upload-pack" || arg.starts_with("--upload-pack=") || arg.starts_with("--up") {
            return Some("git_upload_pack_flag");
        }
        if arg == "--open-files-in-pager" || arg.starts_with("--open-files-in-pager=") {
            return Some("git_open_files_in_pager_flag");
        }
        if subcommand.as_deref() == Some("grep")
            && (arg == "-O" || (arg.starts_with("-O") && !arg.starts_with("--")))
        {
            return Some("git_open_files_in_pager_flag");
        }
    }

    if subcommand.as_deref() == Some("ls-remote") {
        return git_ls_remote_unsafe_reason(&segment.argv[1..]);
    }

    None
}

fn git_global_unsafe_flag_reason(args: &[String]) -> Option<&'static str> {
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].trim();
        if arg.is_empty() {
            index = index.saturating_add(1);
            continue;
        }
        if arg == "--" {
            break;
        }
        if arg == "-c" || (arg.starts_with("-c") && !arg.starts_with("--")) {
            return Some("git_config_flag");
        }
        if arg == "-p" || arg == "--paginate" {
            return Some("git_pager_flag");
        }
        if arg == "--exec-path" || arg.starts_with("--exec-path=") {
            return Some("git_exec_path_flag");
        }
        if arg == "--config-env" || arg.starts_with("--config-env=") {
            return Some("git_config_env_flag");
        }
        if arg == "--git-dir" || arg.starts_with("--git-dir=") {
            return Some("git_dir_flag");
        }
        if arg == "--work-tree" || arg.starts_with("--work-tree=") {
            return Some("git_work_tree_flag");
        }
        if arg == "-C" {
            index = index.saturating_add(2);
            continue;
        }
        if arg.starts_with("-C") && !arg.starts_with("--") && arg.len() > 2 {
            index = index.saturating_add(1);
            continue;
        }
        if git_global_flag_consumes_next(arg) {
            index = index.saturating_add(2);
            continue;
        }
        if git_global_flag_is_value_free(arg) || arg.starts_with('-') {
            index = index.saturating_add(1);
            continue;
        }
        break;
    }
    None
}

fn first_git_subcommand(args: &[String]) -> Option<String> {
    for arg in git_args_after_global_options(args) {
        let normalized = arg.trim();
        if normalized.is_empty() || normalized == "--" {
            continue;
        }
        if normalized.starts_with('-') {
            continue;
        }
        return Some(normalized.to_ascii_lowercase());
    }
    None
}

fn git_args_after_global_options(args: &[String]) -> &[String] {
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].trim();
        if arg.is_empty() {
            index = index.saturating_add(1);
            continue;
        }
        if arg == "--" {
            index = index.saturating_add(1);
            break;
        }
        if arg == "-C" {
            index = index.saturating_add(2);
            continue;
        }
        if arg.starts_with("-C") && !arg.starts_with("--") && arg.len() > 2 {
            index = index.saturating_add(1);
            continue;
        }
        if git_global_flag_consumes_next(arg) {
            index = index.saturating_add(2);
            continue;
        }
        if git_global_flag_is_value_free(arg) {
            index = index.saturating_add(1);
            continue;
        }
        if arg.starts_with('-') {
            index = index.saturating_add(1);
            continue;
        }
        break;
    }
    &args[index.min(args.len())..]
}

fn git_global_cwd_paths(args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].trim();
        if arg.is_empty() {
            index = index.saturating_add(1);
            continue;
        }
        if arg == "--" {
            break;
        }
        if arg == "-C" {
            if let Some(path) = args.get(index + 1) {
                paths.push(path.clone());
            }
            index = index.saturating_add(2);
            continue;
        }
        if arg.starts_with("-C") && !arg.starts_with("--") && arg.len() > 2 {
            paths.push(arg[2..].to_string());
            index = index.saturating_add(1);
            continue;
        }
        if git_global_flag_consumes_next(arg) {
            index = index.saturating_add(2);
            continue;
        }
        if git_global_flag_is_value_free(arg) || arg.starts_with('-') {
            index = index.saturating_add(1);
            continue;
        }
        break;
    }
    paths
}

fn git_global_flag_consumes_next(arg: &str) -> bool {
    !arg.contains('=')
        && matches!(
            arg,
            "--namespace"
                | "--super-prefix"
                | "--html-path"
                | "--man-path"
                | "--info-path"
                | "--paginate"
        )
}

fn git_global_flag_is_value_free(arg: &str) -> bool {
    matches!(
        arg,
        "-p"
            | "-P"
            | "--no-pager"
            | "--no-replace-objects"
            | "--bare"
            | "--version"
            | "--help"
            | "--literal-pathspecs"
            | "--glob-pathspecs"
            | "--noglob-pathspecs"
            | "--icase-pathspecs"
            | "--no-optional-locks"
    ) || arg.starts_with("--namespace=")
        || arg.starts_with("--super-prefix=")
        || arg.starts_with("--html-path=")
        || arg.starts_with("--man-path=")
        || arg.starts_with("--info-path=")
}

fn git_args_after_subcommand<'a>(args: &'a [String], subcommand: &str) -> &'a [String] {
    let args = git_args_after_global_options(args);
    let Some(index) = args
        .iter()
        .position(|arg| arg.eq_ignore_ascii_case(subcommand))
    else {
        return &[];
    };
    &args[index.saturating_add(1)..]
}

fn git_ls_remote_unsafe_reason(args: &[String]) -> Option<&'static str> {
    let args = git_args_after_subcommand(args, "ls-remote");
    let mut after_double_dash = false;
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].as_str();
        if !after_double_dash && arg == "--" {
            after_double_dash = true;
            index = index.saturating_add(1);
            continue;
        }
        if !after_double_dash && arg.starts_with('-') {
            if arg == "--server-option" || arg.starts_with("--server-option=") || arg == "-o" {
                return Some("git_ls_remote_server_option_flag");
            }
            if git_ls_remote_flag_consumes_next(arg) {
                index = index.saturating_add(2);
                continue;
            }
            index = index.saturating_add(1);
            continue;
        }
        if git_remote_spec_is_forbidden(arg) {
            return Some("git_ls_remote_remote_spec");
        }
        return None;
    }
    None
}

fn git_ls_remote_flag_consumes_next(arg: &str) -> bool {
    !arg.contains('=') && matches!(arg, "--sort" | "--upload-pack" | "--server-option" | "-o")
}

fn git_remote_spec_is_forbidden(value: &str) -> bool {
    value.contains("://")
        || value.contains('@')
        || value.contains(':')
        || value.contains('$')
        || value.contains("..")
        || value.starts_with('/')
        || value.starts_with('~')
}

fn git_branch_is_read_only(args: &[String]) -> bool {
    let args = git_args_after_subcommand(args, "branch");
    if args.is_empty() {
        return true;
    }
    let mut seen_list_flag = false;
    let mut last_optional_filter = false;
    let mut index = 0usize;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--" {
            return false;
        }
        if arg.starts_with('-') {
            if arg == "--list" || arg == "-l" || short_flag_bundle_contains(arg, 'l') {
                seen_list_flag = true;
            }
            last_optional_filter = matches!(arg.as_str(), "--merged" | "--no-merged");
            if git_flag_consumes_next(
                arg.as_str(),
                &["--contains", "--no-contains", "--points-at", "--sort"],
            ) {
                index = index.saturating_add(2);
            } else {
                index = index.saturating_add(1);
            }
            continue;
        }
        if !seen_list_flag && !last_optional_filter {
            return false;
        }
        last_optional_filter = false;
        index = index.saturating_add(1);
    }
    true
}

fn git_tag_is_read_only(args: &[String]) -> bool {
    let args = git_args_after_subcommand(args, "tag");
    if args.is_empty() {
        return true;
    }
    let mut seen_list_flag = false;
    let mut index = 0usize;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--" {
            return false;
        }
        if arg.starts_with('-') {
            if arg == "--list" || arg == "-l" || short_flag_bundle_contains(arg, 'l') {
                seen_list_flag = true;
            }
            if git_flag_consumes_next(
                arg.as_str(),
                &[
                    "--contains",
                    "--no-contains",
                    "--merged",
                    "--no-merged",
                    "--points-at",
                    "--sort",
                    "--format",
                    "-n",
                ],
            ) {
                index = index.saturating_add(2);
            } else {
                index = index.saturating_add(1);
            }
            continue;
        }
        if !seen_list_flag {
            return false;
        }
        index = index.saturating_add(1);
    }
    true
}

fn git_remote_is_read_only(args: &[String]) -> bool {
    let args = git_args_after_subcommand(args, "remote");
    if args.is_empty() {
        return true;
    }
    if args.iter().all(|arg| matches!(arg.as_str(), "-v" | "--verbose")) {
        return true;
    }
    if args.first().is_some_and(|arg| arg == "show") {
        let rest = &args[1..];
        let positional = rest
            .iter()
            .filter(|arg| arg.as_str() != "-n")
            .collect::<Vec<&String>>();
        return positional.len() == 1
            && positional[0]
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'));
    }
    false
}

fn short_flag_bundle_contains(arg: &str, flag: char) -> bool {
    arg.starts_with('-') && !arg.starts_with("--") && arg.chars().skip(1).any(|ch| ch == flag)
}

fn git_flag_consumes_next(arg: &str, flags: &[&str]) -> bool {
    !arg.contains('=') && flags.contains(&arg)
}
