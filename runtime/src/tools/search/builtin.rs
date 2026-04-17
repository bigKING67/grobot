fn search_line_matches(
    line: &str,
    request: &SearchRequest,
    fixed_casefold_regex: Option<&regex::Regex>,
    needle_lower: Option<&str>,
    regex: Option<&regex::Regex>,
) -> bool {
    if request.fixed_mode {
        if request.case_sensitive {
            return line.contains(request.query.as_str());
        }
        if let Some(compiled) = fixed_casefold_regex {
            return compiled.is_match(line);
        }
        if let Some(needle) = needle_lower {
            return line.to_lowercase().contains(needle);
        }
        return false;
    }
    if let Some(compiled) = regex {
        return compiled.is_match(line);
    }
    false
}

fn collect_builtin_search_matches_for_file(
    context: &ToolContextResolved,
    file: &Path,
    request: &SearchRequest,
    fixed_casefold_regex: Option<&regex::Regex>,
    needle_lower: Option<&str>,
    regex: Option<&regex::Regex>,
    matches: &mut Vec<Value>,
) -> bool {
    let file_handle = match fs::File::open(file) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut reader = BufReader::new(file_handle);
    let probe = match reader.fill_buf() {
        Ok(probe) => probe,
        Err(_) => return false,
    };
    if probe.iter().take(1024).any(|byte| *byte == 0) {
        return false;
    }
    let relative_path = relative_to_work_dir(&context.work_dir, file);

    if request.context_before == 0 && request.context_after == 0 {
        for (index, line_result) in reader.lines().enumerate() {
            let line = match line_result {
                Ok(line) => line,
                Err(_) => return false,
            };
            let matched = search_line_matches(
                &line,
                request,
                fixed_casefold_regex,
                needle_lower,
                regex,
            );
            if !matched {
                continue;
            }
            if matches.len() >= request.max_results {
                return true;
            }
            matches.push(build_search_plain_match(
                relative_path.as_str(),
                index + 1,
                line.as_str(),
            ));
            if matches.len() >= request.max_results {
                return true;
            }
        }
        return false;
    }

    let mut previous_lines: VecDeque<(usize, String)> = VecDeque::new();
    let mut pending_matches: Vec<PendingContextMatch> = Vec::new();
    let mut stop_new_matches = false;
    for (index, line_result) in reader.lines().enumerate() {
        let line = match line_result {
            Ok(line) => line,
            Err(_) => return false,
        };
        let line_number = index + 1;
        for pending in &mut pending_matches {
            if line_number > pending.line_number && line_number <= pending.end_line {
                pending
                    .records
                    .push(build_search_text_record(line_number, false, line.as_str()));
            }
        }
        let mut pending_index = 0_usize;
        while pending_index < pending_matches.len() {
            if line_number >= pending_matches[pending_index].end_line {
                if matches.len() >= request.max_results {
                    return true;
                }
                let completed = pending_matches.remove(pending_index);
                matches.push(build_search_context_match(
                    relative_path.as_str(),
                    completed.line_number,
                    completed.records,
                ));
                continue;
            }
            pending_index += 1;
        }
        if !stop_new_matches {
            let matched = search_line_matches(
                &line,
                request,
                fixed_casefold_regex,
                needle_lower,
                regex,
            );
            if matched {
                let mut records: Vec<Value> = previous_lines
                    .iter()
                    .map(|(row, text)| build_search_text_record(*row, false, text.as_str()))
                    .collect();
                records.push(build_search_text_record(line_number, true, line.as_str()));
                if request.context_after == 0 {
                    if matches.len() >= request.max_results {
                        return true;
                    }
                    matches.push(build_search_context_match(
                        relative_path.as_str(),
                        line_number,
                        records,
                    ));
                } else {
                    pending_matches.push(PendingContextMatch {
                        line_number,
                        end_line: line_number.saturating_add(request.context_after),
                        records,
                    });
                }
                let selected_count = matches.len().saturating_add(pending_matches.len());
                if selected_count >= request.max_results {
                    stop_new_matches = true;
                    if request.context_after == 0 && pending_matches.is_empty() {
                        return true;
                    }
                }
            }
        }
        previous_lines.push_back((line_number, line));
        while previous_lines.len() > request.context_before {
            previous_lines.pop_front();
        }
    }
    for pending in pending_matches {
        if matches.len() >= request.max_results {
            return true;
        }
        matches.push(build_search_context_match(
            relative_path.as_str(),
            pending.line_number,
            pending.records,
        ));
    }
    matches.len() >= request.max_results
}

fn collect_search_matches_with_builtin(
    context: &ToolContextResolved,
    target: &Path,
    request: &SearchRequest,
) -> Result<SearchCollectResult, ToolExecutionError> {
    let regex = if request.fixed_mode {
        None
    } else {
        Some(
            RegexBuilder::new(&request.query)
                .case_insensitive(!request.case_sensitive)
                .build()
                .map_err(|error| {
                    ToolExecutionError::new(
                        "invalid_tool_arguments",
                        format!("invalid regex query: {error}"),
                    )
                })?,
        )
    };
    let fixed_casefold_regex = if request.fixed_mode && !request.case_sensitive {
        Some(
            RegexBuilder::new(&regex::escape(&request.query))
                .case_insensitive(true)
                .build()
                .map_err(|error| {
                    ToolExecutionError::new(
                        "invalid_tool_arguments",
                        format!("invalid fixed query regex: {error}"),
                    )
                })?,
        )
    } else {
        None
    };
    let needle_lower = if request.fixed_mode && !request.case_sensitive && fixed_casefold_regex.is_none() {
        Some(request.query.to_lowercase())
    } else {
        None
    };

    let mut matches: Vec<Value> = Vec::new();
    let mut max_results_reached = false;
    if target.is_file() {
        max_results_reached = collect_builtin_search_matches_for_file(
            context,
            target,
            request,
            fixed_casefold_regex.as_ref(),
            needle_lower.as_deref(),
            regex.as_ref(),
            &mut matches,
        );
    } else if target.is_dir() {
        for item in WalkDir::new(target).into_iter() {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            max_results_reached = collect_builtin_search_matches_for_file(
                context,
                entry.path(),
                request,
                fixed_casefold_regex.as_ref(),
                needle_lower.as_deref(),
                regex.as_ref(),
                &mut matches,
            );
            if max_results_reached {
                break;
            }
        }
    } else {
        return Err(ToolExecutionError::new(
            "path_invalid",
            "search target must be file or directory",
        ));
    }

    Ok(SearchCollectResult {
        matches,
        max_results_reached,
        engine: "builtin",
    })
}
