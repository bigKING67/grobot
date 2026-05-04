fn parse_session_key_parts(session_key: &str) -> SessionKeyParts {
    let mut parts = session_key.splitn(4, ':');
    let _platform = parts.next();
    let tenant = parts.next().unwrap_or("default").trim();
    let scope = parts.next().unwrap_or("dm").trim();
    let subject = parts.next().unwrap_or("user").trim();
    SessionKeyParts {
        tenant: if tenant.is_empty() {
            "default".to_string()
        } else {
            tenant.to_string()
        },
        scope: if scope.is_empty() {
            "dm".to_string()
        } else {
            scope.to_ascii_lowercase()
        },
        subject: if subject.is_empty() {
            "user".to_string()
        } else {
            subject.to_string()
        },
    }
}

fn resolve_source_roots(
    context: &ToolContextResolved,
    input: &TurnExecuteInput,
    requested_sources: &[String],
    include_org: bool,
) -> Vec<Value> {
    let session = parse_session_key_parts(&input.session_key);
    let project_root = find_project_grobot_dir(&context.work_dir)
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| context.work_dir.clone());
    let scope_folder = if session.scope == "group" {
        "groups"
    } else {
        "users"
    };
    let mut rows: Vec<Value> = Vec::new();
    let mut dedup: HashSet<String> = HashSet::new();
    for source in requested_sources {
        match source.as_str() {
            "code" => {
                push_source_root(&mut rows, &mut dedup, "code", context.work_dir.clone());
            }
            "memory" => {
                let scoped_root = project_root
                    .join(".grobot")
                    .join("memory")
                    .join("v1")
                    .join(scope_folder)
                    .join(&session.subject);
                push_source_root(&mut rows, &mut dedup, "memory", scoped_root);
                if include_org {
                    let org_root = project_root
                        .join(".grobot")
                        .join("memory")
                        .join("v1")
                        .join("org")
                        .join(&session.tenant);
                    push_source_root(&mut rows, &mut dedup, "memory", org_root);
                }
            }
            "wiki" => {
                let scoped_root = project_root
                    .join(".grobot")
                    .join("wiki")
                    .join(scope_folder)
                    .join(&session.subject);
                push_source_root(&mut rows, &mut dedup, "wiki", scoped_root);
                push_source_root(
                    &mut rows,
                    &mut dedup,
                    "wiki",
                    project_root.join(".grobot").join("wiki").join("shared"),
                );
                if include_org {
                    let org_root = project_root
                        .join(".grobot")
                        .join("wiki")
                        .join("org")
                        .join(&session.tenant);
                    push_source_root(&mut rows, &mut dedup, "wiki", org_root);
                }
            }
            _ => {}
        }
    }
    rows
}

fn push_source_root(
    rows: &mut Vec<Value>,
    dedup: &mut HashSet<String>,
    source: &str,
    path: PathBuf,
) {
    let canonical_path = match fs::canonicalize(&path) {
        Ok(resolved) => resolved,
        Err(_) => return,
    };
    if !canonical_path.is_dir() {
        return;
    }
    let path_text = canonical_path.to_string_lossy().to_string();
    let key = format!("{source}:{path_text}");
    if dedup.contains(&key) {
        return;
    }
    dedup.insert(key);
    rows.push(json!({
        "source": source,
        "rootPath": path_text,
    }));
}
