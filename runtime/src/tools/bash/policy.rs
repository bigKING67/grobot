#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BashPolicyDecisionKind {
    Allow,
    PromptRequired,
    Forbidden,
}

impl BashPolicyDecisionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::PromptRequired => "prompt_required",
            Self::Forbidden => "forbidden",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BashCommandRisk {
    ReadOnly,
    Mutating,
    HighRisk,
    Unknown,
}

impl BashCommandRisk {
    fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::Mutating => "mutating",
            Self::HighRisk => "high_risk",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone)]
struct BashPolicySegmentDecision {
    segment: String,
    command_name: String,
    risk: BashCommandRisk,
    decision: BashPolicyDecisionKind,
    reason: String,
    matched_rule: Option<String>,
    paths: Vec<String>,
}

#[derive(Debug, Clone)]
struct BashPolicyEvaluation {
    decision: BashPolicyDecisionKind,
    segments: Vec<BashPolicySegmentDecision>,
}

#[derive(Debug, Clone)]
struct ParsedBashSegment {
    raw: String,
    argv: Vec<String>,
}

impl ParsedBashSegment {
    fn command_name(&self) -> String {
        self.argv
            .first()
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default()
    }

    fn command_basename(&self) -> String {
        let command_name = self.command_name();
        command_name
            .rsplit('/')
            .find(|part| !part.is_empty())
            .unwrap_or(command_name.as_str())
            .to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BashRedirectionKind {
    Input,
    Output,
}

#[derive(Debug, Clone)]
struct BashRedirection {
    kind: BashRedirectionKind,
    target: Option<String>,
    fd_target: bool,
    dynamic_target: bool,
}

const BASH_READONLY_COMMANDS: &[&str] = &[
    "base64",
    "cat",
    "cut",
    "diff",
    "du",
    "echo",
    "file",
    "find",
    "git",
    "grep",
    "head",
    "hexdump",
    "ls",
    "md5sum",
    "nl",
    "od",
    "printf",
    "pwd",
    "rg",
    "sed",
    "sha1sum",
    "sha256sum",
    "sort",
    "stat",
    "strings",
    "tail",
    "tr",
    "uniq",
    "wc",
    "which",
];

const BASH_MUTATING_COMMANDS: &[&str] = &[
    "chmod",
    "chown",
    "cp",
    "install",
    "ln",
    "mkdir",
    "mv",
    "rm",
    "rmdir",
    "tee",
    "touch",
];

const BASH_HIGH_RISK_COMMANDS: &[&str] = &[
    "awk",
    "bash",
    "cargo",
    "curl",
    "docker",
    "env",
    "go",
    "jq",
    "make",
    "node",
    "npm",
    "npx",
    "pnpm",
    "python",
    "python3",
    "ruby",
    "sh",
    "sleep",
    "sudo",
    "tree",
    "uv",
    "wget",
    "yarn",
];

const BASH_FORBIDDEN_COMMANDS: &[&str] = &[
    "curl",
    "docker",
    "env",
    "node",
    "npm",
    "npx",
    "pnpm",
    "python",
    "python3",
    "ruby",
    "sudo",
    "uv",
    "wget",
    "yarn",
];

const BASH_DANGEROUS_PATHS: &[&str] = &[
    "/",
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/home",
    "/lib",
    "/lib64",
    "/opt",
    "/private",
    "/sbin",
    "/sys",
    "/usr",
    "/var",
    "/Users",
    "/Applications",
    "/Library",
    "/System",
];

const MAX_BASH_NESTED_SHELL_POLICY_DEPTH: usize = 3;

fn evaluate_bash_policy(
    context: &ToolContextResolved,
    request: &BashRequest,
) -> Result<BashPolicyEvaluation, ToolExecutionError> {
    evaluate_bash_policy_command(context, request.command.as_str(), 0)
}

fn evaluate_bash_policy_command(
    context: &ToolContextResolved,
    command: &str,
    depth: usize,
) -> Result<BashPolicyEvaluation, ToolExecutionError> {
    let segments = parse_bash_segments(command)?;
    if segments.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "bash.command did not contain an executable segment",
        ));
    }

    let compound_has_git = segments.iter().any(|segment| segment.command_name() == "git");
    let mut segment_decisions = Vec::new();
    let mut aggregate = BashPolicyDecisionKind::Allow;
    for segment in segments {
        let decision = evaluate_bash_policy_segment(context, &segment, compound_has_git, depth)?;
        aggregate = merge_bash_decision(aggregate, decision.decision);
        segment_decisions.push(decision);
    }

    Ok(BashPolicyEvaluation {
        decision: aggregate,
        segments: segment_decisions,
    })
}

fn merge_bash_decision(
    current: BashPolicyDecisionKind,
    next: BashPolicyDecisionKind,
) -> BashPolicyDecisionKind {
    match (current, next) {
        (BashPolicyDecisionKind::Forbidden, _) | (_, BashPolicyDecisionKind::Forbidden) => {
            BashPolicyDecisionKind::Forbidden
        }
        (BashPolicyDecisionKind::PromptRequired, _) | (_, BashPolicyDecisionKind::PromptRequired) => {
            BashPolicyDecisionKind::PromptRequired
        }
        _ => BashPolicyDecisionKind::Allow,
    }
}

fn evaluate_bash_policy_segment(
    context: &ToolContextResolved,
    segment: &ParsedBashSegment,
    compound_has_git: bool,
    depth: usize,
) -> Result<BashPolicySegmentDecision, ToolExecutionError> {
    let command_name = segment.command_name();
    if command_name.is_empty() {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::Unknown,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "empty_command".to_string(),
            matched_rule: None,
            paths: Vec::new(),
        });
    }
    let command_basename = segment.command_basename();
    if bash_command_is_forbidden(command_basename.as_str()) {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::HighRisk,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "forbidden_command".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }

    let redirections = extract_bash_redirections(segment.raw.as_str());
    if redirections.iter().any(|redir| redir.target.is_none()) {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::Unknown,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "redirection_target_missing".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }
    if redirections.iter().any(|redir| redir.dynamic_target) {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::Unknown,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "redirection_dynamic_target".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }
    if redirections
        .iter()
        .any(|redir| redir.kind == BashRedirectionKind::Output && !redir.is_null_device() && redir.target_has_glob())
    {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::Unknown,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "output_redirection_glob_target".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }
    if let Some(nested_script) = extract_nested_shell_script(segment) {
        return evaluate_nested_shell_policy_segment(
            context,
            segment,
            command_name,
            redirections.as_slice(),
            compound_has_git,
            nested_script.as_str(),
            depth,
        );
    }

    if command_name == "sed" && !sed_segment_is_read_only(segment) {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::Mutating,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "sed_operation_not_read_only".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }
    if command_name == "find" {
        if let Some(reason) = find_unsafe_predicate_reason(segment) {
            return Ok(BashPolicySegmentDecision {
                segment: segment.raw.clone(),
                command_name,
                risk: BashCommandRisk::HighRisk,
                decision: BashPolicyDecisionKind::Forbidden,
                reason: reason.to_string(),
                matched_rule: None,
                paths: extract_segment_paths(segment),
            });
        }
    }
    if command_name == "git" {
        if let Some(reason) = git_unsafe_flag_reason(segment) {
            return Ok(BashPolicySegmentDecision {
                segment: segment.raw.clone(),
                command_name,
                risk: BashCommandRisk::HighRisk,
                decision: BashPolicyDecisionKind::Forbidden,
                reason: reason.to_string(),
                matched_rule: None,
                paths: extract_segment_paths(segment),
            });
        }
    }
    if command_name == "rg" && has_long_flag(&segment.argv[1..], "--pre") {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::HighRisk,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "rg_preprocessor_flag".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }
    if matches!(command_name.as_str(), "grep" | "rg") {
        if let Some(reason) = pattern_command_unsafe_flag_reason(command_name.as_str(), segment) {
            return Ok(BashPolicySegmentDecision {
                segment: segment.raw.clone(),
                command_name,
                risk: BashCommandRisk::HighRisk,
                decision: BashPolicyDecisionKind::Forbidden,
                reason: reason.to_string(),
                matched_rule: None,
                paths: extract_segment_paths(segment),
            });
        }
    }
    if command_name == "sort" && has_short_or_long_flag(&segment.argv[1..], 'o', &["--output"]) {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::Mutating,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "sort_output_flag".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }

    let has_output_redirection = redirections
        .iter()
        .any(|redir| redir.kind == BashRedirectionKind::Output && !redir.fd_target && !redir.is_null_device());
    let mut risk = classify_bash_segment_risk(segment);
    if has_output_redirection && risk == BashCommandRisk::ReadOnly {
        risk = BashCommandRisk::Mutating;
    }
    let mut paths = extract_segment_paths(segment);
    paths.extend(
        redirections
            .iter()
            .filter(|redir| !redir.fd_target && !redir.is_null_device())
            .filter_map(|redir| redir.target.clone()),
    );
    if matches!(command_name.as_str(), "rm" | "rmdir") {
        if let Some(path) = first_dangerous_removal_path(context, &paths) {
            return Ok(BashPolicySegmentDecision {
                segment: segment.raw.clone(),
                command_name,
                risk: BashCommandRisk::HighRisk,
                decision: BashPolicyDecisionKind::Forbidden,
                reason: format!("dangerous_removal_path:{path}"),
                matched_rule: None,
                paths,
            });
        }
    }
    if !paths_workspace_safe(context, &paths, risk) {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "path_outside_workspace".to_string(),
            matched_rule: None,
            paths,
        });
    }
    if risk != BashCommandRisk::ReadOnly {
        if let Some(path) = first_git_internal_write_path(context, &paths, compound_has_git) {
            return Ok(BashPolicySegmentDecision {
                segment: segment.raw.clone(),
                command_name,
                risk: BashCommandRisk::HighRisk,
                decision: BashPolicyDecisionKind::Forbidden,
                reason: format!("git_internal_write_path:{path}"),
                matched_rule: None,
                paths,
            });
        }
    }

    let matched_rule = find_bash_allowlist_match_for_segment(segment, &context.bash_allowlist);
    let decision = match risk {
        BashCommandRisk::ReadOnly => BashPolicyDecisionKind::Allow,
        BashCommandRisk::Mutating | BashCommandRisk::HighRisk => {
            if matched_rule.is_some() {
                BashPolicyDecisionKind::Allow
            } else {
                BashPolicyDecisionKind::PromptRequired
            }
        }
        BashCommandRisk::Unknown => {
            if matched_rule.is_some() {
                BashPolicyDecisionKind::PromptRequired
            } else {
                BashPolicyDecisionKind::Forbidden
            }
        }
    };
    let reason = match (risk, matched_rule.as_ref()) {
        (BashCommandRisk::ReadOnly, _) => "read_only_command".to_string(),
        (BashCommandRisk::Mutating, Some(_)) => "mutating_command_allowlisted".to_string(),
        (BashCommandRisk::HighRisk, Some(_)) => "high_risk_command_allowlisted".to_string(),
        (BashCommandRisk::Mutating, None) => "mutating_command_requires_permission".to_string(),
        (BashCommandRisk::HighRisk, None) => "high_risk_command_requires_permission".to_string(),
        (BashCommandRisk::Unknown, Some(_)) => "unknown_command_requires_permission".to_string(),
        (BashCommandRisk::Unknown, None) => "unknown_command_forbidden".to_string(),
    };

    Ok(BashPolicySegmentDecision {
        segment: segment.raw.clone(),
        command_name,
        risk,
        decision,
        reason,
        matched_rule,
        paths,
    })
}

fn bash_command_is_forbidden(command_name: &str) -> bool {
    BASH_FORBIDDEN_COMMANDS.contains(&command_name)
        || command_name
            .strip_prefix("python3.")
            .is_some_and(|version| !version.is_empty() && version.chars().all(|ch| ch.is_ascii_digit()))
}

fn evaluate_nested_shell_policy_segment(
    context: &ToolContextResolved,
    segment: &ParsedBashSegment,
    command_name: String,
    redirections: &[BashRedirection],
    compound_has_git: bool,
    nested_script: &str,
    depth: usize,
) -> Result<BashPolicySegmentDecision, ToolExecutionError> {
    if depth >= MAX_BASH_NESTED_SHELL_POLICY_DEPTH {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk: BashCommandRisk::HighRisk,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "nested_shell_depth_exceeded".to_string(),
            matched_rule: None,
            paths: extract_segment_paths(segment),
        });
    }

    validate_bash_command_security(nested_script)?;
    let nested = evaluate_bash_policy_command(context, nested_script, depth.saturating_add(1))?;
    let nested_primary = nested_primary_segment(&nested);
    let mut risk = nested_aggregate_risk(&nested);
    let has_output_redirection = redirections
        .iter()
        .any(|redir| redir.kind == BashRedirectionKind::Output && !redir.fd_target && !redir.is_null_device());
    if has_output_redirection && risk == BashCommandRisk::ReadOnly {
        risk = BashCommandRisk::Mutating;
    }

    let mut paths = nested
        .segments
        .iter()
        .flat_map(|nested_segment| nested_segment.paths.clone())
        .collect::<Vec<String>>();
    paths.extend(
        redirections
            .iter()
            .filter(|redir| !redir.fd_target && !redir.is_null_device())
            .filter_map(|redir| redir.target.clone()),
    );

    if !paths_workspace_safe(context, &paths, risk) {
        return Ok(BashPolicySegmentDecision {
            segment: segment.raw.clone(),
            command_name,
            risk,
            decision: BashPolicyDecisionKind::Forbidden,
            reason: "path_outside_workspace".to_string(),
            matched_rule: None,
            paths,
        });
    }
    let nested_has_git = nested
        .segments
        .iter()
        .any(|nested_segment| nested_segment.command_name == "git");
    if risk != BashCommandRisk::ReadOnly {
        if let Some(path) = first_git_internal_write_path(context, &paths, compound_has_git || nested_has_git) {
            return Ok(BashPolicySegmentDecision {
                segment: segment.raw.clone(),
                command_name,
                risk: BashCommandRisk::HighRisk,
                decision: BashPolicyDecisionKind::Forbidden,
                reason: format!("git_internal_write_path:{path}"),
                matched_rule: None,
                paths,
            });
        }
    }

    let matched_rule = nested_permission_match(&nested, &context.bash_allowlist);
    let mut decision = nested.decision;
    let mut reason = nested_primary
        .map(|nested_segment| format!("nested_shell:{}", nested_segment.reason))
        .unwrap_or_else(|| "nested_shell:empty_command".to_string());

    if decision == BashPolicyDecisionKind::Allow && has_output_redirection && risk != BashCommandRisk::ReadOnly {
        if matched_rule.is_some() {
            reason = "nested_shell_output_redirection_allowlisted".to_string();
        } else {
            decision = BashPolicyDecisionKind::PromptRequired;
            reason = "nested_shell_output_redirection_requires_permission".to_string();
        }
    }

    Ok(BashPolicySegmentDecision {
        segment: segment.raw.clone(),
        command_name,
        risk,
        decision,
        reason,
        matched_rule,
        paths,
    })
}

fn extract_nested_shell_script(segment: &ParsedBashSegment) -> Option<String> {
    if !matches!(segment.command_basename().as_str(), "bash" | "sh") {
        return None;
    }
    nested_shell_script_index(&segment.argv[1..])
        .and_then(|index| segment.argv.get(index.saturating_add(1)).cloned())
}

fn nested_shell_script_index(args: &[String]) -> Option<usize> {
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            return None;
        }
        if arg == "-c" {
            return Some(index.saturating_add(1));
        }
        if arg.starts_with('-') && !arg.starts_with("--") && arg.chars().skip(1).any(|ch| ch == 'c') {
            return Some(index.saturating_add(1));
        }
        index = index.saturating_add(1);
    }
    None
}

fn nested_primary_segment(evaluation: &BashPolicyEvaluation) -> Option<&BashPolicySegmentDecision> {
    evaluation
        .segments
        .iter()
        .find(|segment| segment.decision == evaluation.decision)
        .or_else(|| evaluation.segments.first())
}

fn nested_permission_match(
    evaluation: &BashPolicyEvaluation,
    allowlist: &[String],
) -> Option<String> {
    if allowlist.iter().any(|rule| rule.trim() == "*") {
        return Some("*".to_string());
    }
    evaluation
        .segments
        .iter()
        .find_map(|segment| segment.matched_rule.clone())
}

fn nested_aggregate_risk(evaluation: &BashPolicyEvaluation) -> BashCommandRisk {
    evaluation
        .segments
        .iter()
        .fold(BashCommandRisk::ReadOnly, |current, segment| {
            merge_bash_risk(current, segment.risk)
        })
}

fn merge_bash_risk(current: BashCommandRisk, next: BashCommandRisk) -> BashCommandRisk {
    match (bash_risk_rank(current), bash_risk_rank(next)) {
        (left, right) if left >= right => current,
        _ => next,
    }
}

fn bash_risk_rank(risk: BashCommandRisk) -> u8 {
    match risk {
        BashCommandRisk::ReadOnly => 0,
        BashCommandRisk::Unknown => 1,
        BashCommandRisk::Mutating => 2,
        BashCommandRisk::HighRisk => 3,
    }
}

impl BashRedirection {
    fn target_has_glob(&self) -> bool {
        self.target
            .as_deref()
            .is_some_and(|target| target.contains('*') || target.contains('?') || target.contains('['))
    }

    fn is_null_device(&self) -> bool {
        self.target.as_deref() == Some("/dev/null")
    }
}

fn classify_bash_segment_risk(segment: &ParsedBashSegment) -> BashCommandRisk {
    let command = segment.command_name();
    if command == "git" {
        if git_segment_is_read_only(segment) {
            return BashCommandRisk::ReadOnly;
        }
        return BashCommandRisk::Mutating;
    }
    if BASH_READONLY_COMMANDS.contains(&command.as_str()) {
        return BashCommandRisk::ReadOnly;
    }
    if BASH_MUTATING_COMMANDS.contains(&command.as_str()) {
        return BashCommandRisk::Mutating;
    }
    if BASH_HIGH_RISK_COMMANDS.contains(&command.as_str()) {
        return BashCommandRisk::HighRisk;
    }
    BashCommandRisk::Unknown
}

fn find_unsafe_predicate_reason(segment: &ParsedBashSegment) -> Option<&'static str> {
    for arg in &segment.argv[1..] {
        match arg.as_str() {
            "-delete" => return Some("find_delete_predicate"),
            "-exec" | "-execdir" | "-ok" | "-okdir" => {
                return Some("find_exec_predicate");
            }
            "-fprint" | "-fprint0" | "-fls" | "-fprintf" => {
                return Some("find_output_predicate");
            }
            _ => {}
        }
    }
    None
}

fn pattern_command_unsafe_flag_reason(
    command_name: &str,
    segment: &ParsedBashSegment,
) -> Option<&'static str> {
    if has_short_or_long_flag(&segment.argv[1..], 'f', &["--file"]) {
        return Some("pattern_file_flag");
    }
    if command_name == "grep"
        && (has_long_flag(&segment.argv[1..], "--exclude-from")
            || has_long_flag(&segment.argv[1..], "--include-from"))
    {
        return Some("grep_pattern_file_flag");
    }
    if command_name == "rg" && has_long_flag(&segment.argv[1..], "--ignore-file") {
        return Some("rg_ignore_file_flag");
    }
    None
}

fn has_long_flag(args: &[String], flag: &str) -> bool {
    args.iter().take_while(|arg| arg.as_str() != "--").any(|arg| {
        arg == flag || arg.strip_prefix(flag).is_some_and(|suffix| suffix.starts_with('='))
    })
}

fn has_short_or_long_flag(args: &[String], short: char, longs: &[&str]) -> bool {
    for arg in args {
        if arg == "--" {
            return false;
        }
        if longs
            .iter()
            .any(|long| arg == long || arg.strip_prefix(long).is_some_and(|suffix| suffix.starts_with('=')))
        {
            return true;
        }
        if arg.starts_with("--") {
            continue;
        }
        if arg.starts_with('-') && arg.chars().skip(1).any(|ch| ch == short) {
            return true;
        }
    }
    false
}
