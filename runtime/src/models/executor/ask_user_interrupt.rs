fn parse_non_empty_string_field(
    payload: &serde_json::Map<String, Value>,
    key: &str,
) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_ask_user_option_objects(value: Option<&Value>) -> Vec<ModelAskUserOption> {
    let Some(raw_options) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut options = Vec::new();
    for raw in raw_options {
        if let Some(option) = raw.as_str() {
            let normalized = option.trim();
            if normalized.is_empty() {
                continue;
            }
            options.push(ModelAskUserOption {
                label: normalized.to_string(),
                description: None,
                value: Some(normalized.to_string()),
            });
        } else if let Some(option_obj) = raw.as_object() {
            let label = parse_non_empty_string_field(option_obj, "label")
                .or_else(|| parse_non_empty_string_field(option_obj, "value"))
                .or_else(|| parse_non_empty_string_field(option_obj, "id"));
            let Some(label) = label else {
                continue;
            };
            options.push(ModelAskUserOption {
                label: label.clone(),
                description: parse_non_empty_string_field(option_obj, "description"),
                value: parse_non_empty_string_field(option_obj, "value").or(Some(label)),
            });
        }
        if options.len() >= 6 {
            break;
        }
    }
    options
}

fn parse_ask_user_questions(payload: &serde_json::Map<String, Value>) -> Vec<ModelAskUserQuestion> {
    let Some(raw_questions) = payload.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut questions = Vec::new();
    for (index, raw) in raw_questions.iter().enumerate() {
        let Some(question_obj) = raw.as_object() else {
            continue;
        };
        let Some(question) = parse_non_empty_string_field(question_obj, "question") else {
            continue;
        };
        let id = parse_non_empty_string_field(question_obj, "id")
            .unwrap_or_else(|| format!("q{}", index + 1));
        let header = parse_non_empty_string_field(question_obj, "header")
            .unwrap_or_else(|| format!("Question {}", index + 1));
        let options = parse_ask_user_option_objects(question_obj.get("options"));
        questions.push(ModelAskUserQuestion {
            id,
            header,
            question,
            options,
        });
        if questions.len() >= 3 {
            break;
        }
    }
    questions
}

fn invalid_tool_output_error(
    tool_call: &ToolCallInput,
    message: impl Into<String>,
    stage: &str,
) -> ModelExecutionError {
    model_error_with_fields(
        model_diagnostic_error(
            "invalid_tool_output",
            message,
            "model.ask_user_interrupt",
            stage,
            "ensure ask_user tool output is a JSON object with type=ask_user and non-empty questions[]",
        ),
        &[
            ("tool_name", json!(tool_call.name.clone())),
            ("tool_call_id", json!(tool_call.id.clone())),
        ],
    )
}

fn parse_tool_interrupt(
    tool_call: &ToolCallInput,
    output: &ToolCallOutput,
) -> Result<Option<ModelExecutionInterrupt>, ModelExecutionError> {
    let tool_name = tool_call.name.trim();
    if !tool_name.eq_ignore_ascii_case("ask_user")
        && !tool_name.eq_ignore_ascii_case("ask_user_question")
    {
        return Ok(None);
    }
    let parsed: Value = serde_json::from_str(output.content.as_str()).map_err(|error| {
        invalid_tool_output_error(
            tool_call,
            format!("{tool_name} output is not valid JSON: {error}"),
            "ask_user_output_parse_json",
        )
    })?;
    let payload = parsed.as_object().ok_or_else(|| {
        invalid_tool_output_error(
            tool_call,
            format!("{tool_name} output must be a JSON object"),
            "ask_user_output_validate_object",
        )
    })?;
    let payload_type = parse_non_empty_string_field(payload, "type").unwrap_or_default();
    if payload_type != "ask_user" {
        return Err(invalid_tool_output_error(
            tool_call,
            format!("{tool_name} output type must be ask_user"),
            "ask_user_output_validate_type",
        ));
    }
    let questions = parse_ask_user_questions(payload);
    if questions.is_empty() {
        return Err(invalid_tool_output_error(
            tool_call,
            format!("{tool_name} output missing valid questions[]"),
            "ask_user_output_validate_questions",
        ));
    }
    let blocking_node_id = parse_non_empty_string_field(payload, "blocking_node_id")
        .unwrap_or_else(|| "node.unknown".to_string());
    let default_on_timeout = parse_non_empty_string_field(payload, "default_on_timeout")
        .unwrap_or_else(|| "continue_with_best_effort".to_string());
    let resume_token = parse_non_empty_string_field(payload, "resume_token")
        .unwrap_or_else(|| format!("resume_{}", tool_call.id));
    let created_at = parse_non_empty_string_field(payload, "created_at")
        .unwrap_or_else(|| "unix:0".to_string());
    let interrupt = ModelExecutionInterrupt::AskUser(ModelAskUserInterrupt {
        blocking_node_id,
        questions,
        default_on_timeout,
        resume_token,
        created_at,
    });
    Ok(Some(interrupt))
}
