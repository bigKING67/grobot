fn build_runtime_user_prompt(input: &TurnExecuteInput) -> String {
    if input.context_lines.is_empty() {
        return input.user_message.clone();
    }

    format!(
        "{}\n\n[Conversation Context]\n{}",
        input.user_message,
        input.context_lines.join("\n")
    )
}

fn extract_array_content(parts: &[Value]) -> String {
    let mut collected = Vec::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                collected.push(normalized.to_string());
            }
            continue;
        }
        if let Some(text) = part.get("content").and_then(Value::as_str) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                collected.push(normalized.to_string());
            }
        }
    }
    collected.join("\n")
}

fn extract_response_content(response: &Value) -> Option<String> {
    let choices = response.get("choices")?.as_array()?;
    let first = choices.first()?;
    let message = first.get("message")?;
    let content = message.get("content")?;

    if let Some(text) = content.as_str() {
        let normalized = text.trim();
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized.to_string());
    }

    if let Some(parts) = content.as_array() {
        let joined = extract_array_content(parts);
        let normalized = joined.trim();
        if normalized.is_empty() {
            return None;
        }
        return Some(normalized.to_string());
    }

    None
}

fn extract_first_assistant_message(response: &Value) -> Option<Value> {
    let choices = response.get("choices")?.as_array()?;
    let first = choices.first()?;
    let message = first.get("message")?.clone();
    if !message.is_object() {
        return None;
    }
    Some(message)
}
