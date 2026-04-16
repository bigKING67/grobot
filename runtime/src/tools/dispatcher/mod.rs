pub(crate) fn is_local_tool_dispatch_supported(tool_name: &str) -> bool {
    matches!(
        tool_name,
        TOOL_LIST
            | TOOL_GLOB
            | TOOL_SEARCH
            | TOOL_READ
            | TOOL_WRITE
            | TOOL_EDIT
            | TOOL_BASH
            | TOOL_MCP_SERVERS
            | TOOL_MCP_CALL
            | TOOL_SEMANTIC_SEARCH
            | TOOL_PROMPT_ENHANCER
            | TOOL_ASK_USER_QUESTION
    )
}

impl ToolExecutor for LocalToolExecutor {
    fn execute_tool_call(
        &self,
        call: &ToolCallInput,
        input: &TurnExecuteInput,
    ) -> Result<ToolCallOutput, ToolExecutionError> {
        if let Some(kimi_result) = execute_kimi_tool_call(call, input) {
            return kimi_result;
        }
        let tool_name = normalize_tool_name(&call.name);
        let context = parse_tool_context(input)?;
        if !context.enabled_tools.contains(&tool_name) {
            return Err(ToolExecutionError::new(
                "tool_disabled",
                format!("tool is disabled by runtime context: {tool_name}"),
            ));
        }
        if !is_local_tool_dispatch_supported(tool_name.as_str()) {
            return Err(ToolExecutionError::new(
                "tool_call_not_supported",
                format!("runtime v1 does not support tool calls yet: {}", call.name),
            ));
        }
        let args = value_object(&call.arguments, &tool_name)?;
        match tool_name.as_str() {
            TOOL_LIST => run_list(&context, args),
            TOOL_GLOB => run_glob(&context, args),
            TOOL_SEARCH => run_search(&context, args),
            TOOL_READ => run_read(&context, args, input),
            TOOL_WRITE => run_write(&context, args),
            TOOL_EDIT => run_edit(&context, args),
            TOOL_BASH => run_bash(&context, args),
            TOOL_MCP_SERVERS => run_mcp_servers(&context, args),
            TOOL_MCP_CALL => run_mcp_call(&context, args),
            TOOL_SEMANTIC_SEARCH => run_semantic_search(&context, args, input),
            TOOL_PROMPT_ENHANCER => run_prompt_enhancer(&context, args, input),
            TOOL_ASK_USER_QUESTION => run_ask_user_question(&context, args),
            _ => Err(ToolExecutionError::new(
                "tool_dispatch_not_implemented",
                format!("dispatch table missing handler for: {}", call.name),
            )),
        }
    }
}
