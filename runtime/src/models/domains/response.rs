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

fn extract_first_tool_call_name(response: &Value) -> Option<String> {
    let choices = match response.get("choices").and_then(Value::as_array) {
        Some(choices) => choices,
        None => return None,
    };
    let first = match choices.first() {
        Some(first) => first,
        None => return None,
    };
    let message = match first.get("message") {
        Some(message) => message,
        None => return None,
    };
    let first_tool = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .and_then(|tool_calls| tool_calls.first())?;
    let function = first_tool.get("function")?;
    let name = function.get("name").and_then(Value::as_str)?;
    let normalized = name.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_string())
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
