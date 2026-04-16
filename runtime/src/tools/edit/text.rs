fn split_utf8_bom(content: &str) -> (&'static str, &str) {
    if let Some(stripped) = content.strip_prefix('\u{FEFF}') {
        ("\u{FEFF}", stripped)
    } else {
        ("", content)
    }
}

fn detect_line_ending(content: &str) -> &'static str {
    let crlf_index = content.find("\r\n");
    let lf_index = content.find('\n');
    match (crlf_index, lf_index) {
        (Some(crlf), Some(lf)) if crlf <= lf => "\r\n",
        (_, Some(_)) => "\n",
        _ => "\n",
    }
}

fn normalize_to_lf(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn restore_line_endings(content: &str, line_ending: &str) -> String {
    if line_ending == "\r\n" {
        content.replace('\n', "\r\n")
    } else {
        content.to_string()
    }
}
