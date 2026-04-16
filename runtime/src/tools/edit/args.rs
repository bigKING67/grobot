fn parse_edit_operations(args: &Map<String, Value>) -> Result<Vec<EditOperation>, ToolExecutionError> {
    if args.contains_key("old_text") || args.contains_key("new_text") || args.contains_key("replace_all") {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "legacy edit.old_text/new_text/replace_all has been removed; use edit.edits[]",
        ));
    }
    for key in args.keys() {
        if key != "path" && key != "edits" {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("unsupported edit argument: {key}"),
            ));
        }
    }
    let edits_value = args
        .get("edits")
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "edit.edits is required"))?;
    let edits_array = edits_value
        .as_array()
        .ok_or_else(|| ToolExecutionError::new("invalid_tool_arguments", "edit.edits must be an array"))?;
    if edits_array.is_empty() {
        return Err(ToolExecutionError::new(
            "invalid_tool_arguments",
            "edit.edits must contain at least one edit",
        ));
    }
    let mut edits: Vec<EditOperation> = Vec::with_capacity(edits_array.len());
    for (index, item) in edits_array.iter().enumerate() {
        let edit = item.as_object().ok_or_else(|| {
            ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("edit.edits[{index}] must be an object"),
            )
        })?;
        for key in edit.keys() {
            if key != "old_text" && key != "new_text" {
                return Err(ToolExecutionError::new(
                    "invalid_tool_arguments",
                    format!("unsupported key in edit.edits[{index}]: {key}"),
                ));
            }
        }
        let old_text = edit
            .get("old_text")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ToolExecutionError::new(
                    "invalid_tool_arguments",
                    format!("edit.edits[{index}].old_text is required"),
                )
            })?
            .to_string();
        if old_text.is_empty() {
            return Err(ToolExecutionError::new(
                "invalid_tool_arguments",
                format!("edit.edits[{index}].old_text cannot be empty"),
            ));
        }
        let new_text = edit
            .get("new_text")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ToolExecutionError::new(
                    "invalid_tool_arguments",
                    format!("edit.edits[{index}].new_text is required"),
                )
            })?
            .to_string();
        edits.push(EditOperation { old_text, new_text });
    }
    Ok(edits)
}

fn normalize_edit_operations(edits: &[EditOperation]) -> Vec<NormalizedEditOperation> {
    edits
        .iter()
        .map(|edit| NormalizedEditOperation {
            old_text: normalize_to_lf(edit.old_text.as_str()),
            new_text: normalize_to_lf(edit.new_text.as_str()),
        })
        .collect()
}
