fn build_edit_diff(matches: &[EditMatch]) -> String {
    let mut lines: Vec<String> = Vec::new();
    for item in matches {
        let old_count = line_count_for_diff(item.actual_old_text.as_str());
        let new_count = line_count_for_diff(item.actual_new_text.as_str());
        lines.push(format!(
            "@@ -{},{} +{},{} @@",
            item.start_line, old_count, item.start_line, new_count
        ));
        for line in lines_for_diff(item.actual_old_text.as_str()) {
            lines.push(format!("-{line}"));
        }
        for line in lines_for_diff(item.actual_new_text.as_str()) {
            lines.push(format!("+{line}"));
        }
    }
    lines.join("\n")
}

fn line_count_for_diff(content: &str) -> usize {
    if content.is_empty() {
        0
    } else {
        content.lines().count()
    }
}

fn lines_for_diff(content: &str) -> Vec<&str> {
    if content.is_empty() {
        Vec::new()
    } else {
        content.lines().collect()
    }
}
