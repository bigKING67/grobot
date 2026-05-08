const LEFT_SINGLE_CURLY_QUOTE: char = '\u{2018}';
const RIGHT_SINGLE_CURLY_QUOTE: char = '\u{2019}';
const LEFT_DOUBLE_CURLY_QUOTE: char = '\u{201C}';
const RIGHT_DOUBLE_CURLY_QUOTE: char = '\u{201D}';

fn preserve_quote_style(old_text: &str, actual_old_text: &str, new_text: &str) -> String {
    if old_text == actual_old_text {
        return new_text.to_string();
    }

    let has_double_quotes = actual_old_text.contains(LEFT_DOUBLE_CURLY_QUOTE)
        || actual_old_text.contains(RIGHT_DOUBLE_CURLY_QUOTE);
    let has_single_quotes = actual_old_text.contains(LEFT_SINGLE_CURLY_QUOTE)
        || actual_old_text.contains(RIGHT_SINGLE_CURLY_QUOTE);

    if !has_double_quotes && !has_single_quotes {
        return new_text.to_string();
    }

    let mut result = new_text.to_string();
    if has_double_quotes {
        result = apply_curly_double_quotes(result.as_str());
    }
    if has_single_quotes {
        result = apply_curly_single_quotes(result.as_str());
    }
    result
}

fn is_opening_quote_context(chars: &[char], index: usize) -> bool {
    if index == 0 {
        return true;
    }
    matches!(
        chars[index - 1],
        ' ' | '\t' | '\n' | '\r' | '(' | '[' | '{' | '\u{2014}' | '\u{2013}'
    )
}

fn apply_curly_double_quotes(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut result = String::with_capacity(value.len());
    for (index, ch) in chars.iter().enumerate() {
        if *ch == '"' {
            if is_opening_quote_context(&chars, index) {
                result.push(LEFT_DOUBLE_CURLY_QUOTE);
            } else {
                result.push(RIGHT_DOUBLE_CURLY_QUOTE);
            }
        } else {
            result.push(*ch);
        }
    }
    result
}

fn apply_curly_single_quotes(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut result = String::with_capacity(value.len());
    for (index, ch) in chars.iter().enumerate() {
        if *ch != '\'' {
            result.push(*ch);
            continue;
        }

        let prev_is_letter = index
            .checked_sub(1)
            .and_then(|prev| chars.get(prev))
            .is_some_and(|prev| prev.is_alphabetic());
        let next_is_letter = chars
            .get(index.saturating_add(1))
            .is_some_and(|next| next.is_alphabetic());
        if prev_is_letter && next_is_letter {
            result.push(RIGHT_SINGLE_CURLY_QUOTE);
        } else if is_opening_quote_context(&chars, index) {
            result.push(LEFT_SINGLE_CURLY_QUOTE);
        } else {
            result.push(RIGHT_SINGLE_CURLY_QUOTE);
        }
    }
    result
}
