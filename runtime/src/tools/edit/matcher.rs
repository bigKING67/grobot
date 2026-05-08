fn find_all_exact_match_ranges(content: &str, needle: &str) -> Vec<(usize, usize)> {
    if needle.is_empty() {
        return Vec::new();
    }
    content
        .match_indices(needle)
        .map(|(start, matched)| (start, start + matched.len()))
        .collect()
}

fn normalize_safe_fuzzy_char(ch: char) -> char {
    match ch {
        '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
        '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
        '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}' | '\u{2212}' => '-',
        '\u{00A0}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => ' ',
        _ => ch,
    }
}

fn find_all_safe_fuzzy_match_ranges(content: &str, needle: &str) -> Vec<(usize, usize)> {
    if needle.is_empty() {
        return Vec::new();
    }
    let content_chars: Vec<char> = content.chars().map(normalize_safe_fuzzy_char).collect();
    let needle_chars: Vec<char> = needle.chars().map(normalize_safe_fuzzy_char).collect();
    if needle_chars.is_empty() || needle_chars.len() > content_chars.len() {
        return Vec::new();
    }
    let mut byte_offsets: Vec<usize> = content.char_indices().map(|(index, _)| index).collect();
    byte_offsets.push(content.len());
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let needle_len = needle_chars.len();
    for start in 0..=content_chars.len() - needle_len {
        if content_chars[start..start + needle_len] == needle_chars[..] {
            let start_byte = byte_offsets[start];
            let end_byte = byte_offsets[start + needle_len];
            ranges.push((start_byte, end_byte));
        }
    }
    ranges
}

fn line_number_for_offset(content: &str, byte_offset: usize) -> usize {
    let clamped = byte_offset.min(content.len());
    1 + content[..clamped]
        .as_bytes()
        .iter()
        .filter(|value| **value == b'\n')
        .count()
}

fn end_line_number_for_range(content: &str, start: usize, end: usize) -> usize {
    if end <= start {
        return line_number_for_offset(content, start);
    }
    let end_for_line = end.saturating_sub(1);
    line_number_for_offset(content, end_for_line)
}
