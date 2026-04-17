pub fn handle_request(request: RpcRequest) -> Result<RpcSuccessResponse, RpcErrorResponse> {
    if request.jsonrpc != JSONRPC_VERSION {
        return Err(error(request.id, -32600, "invalid jsonrpc version"));
    }

    match request.method.as_str() {
        "runtime.health" => {
            let params: RuntimeHealthParams = if request.params.is_null() {
                RuntimeHealthParams::default()
            } else {
                serde_json::from_value(request.params.clone())
                    .map_err(|_| error(request.id.clone(), -32602, "invalid params"))?
            };
            Ok(success(
                request.id,
                json!({
                    "protocol_version": RUNTIME_PROTOCOL_VERSION,
                    "runtime": "rust",
                    "status": "ok",
                    "runtime_tools": {
                        "overlap_guard": crate::tools::tools::overlap_guard_metrics_snapshot()
                    },
                    "cache_stats": crate::models::model::runtime_cache_stats_snapshot_with_options(crate::models::model::RuntimeCacheStatsSnapshotOptions {
                        window_ms: params.cache_stats_window_ms,
                        reset_window: params.cache_stats_reset_window.unwrap_or(false),
                    })
                }),
            ))
        }
        "runtime.tools.describe" => Ok(success(
            request.id,
            json!({
                "protocol_version": RUNTIME_PROTOCOL_VERSION,
                "tools": crate::tools::tools::local_tool_definitions(),
                "default_enabled_tools": crate::tools::tools::default_enabled_local_tool_names()
            }),
        )),
        "runtime.turn.execute" => {
            let params: TurnExecuteParams = serde_json::from_value(request.params)
                .map_err(|_| error(request.id.clone(), -32602, "invalid params"))?;
            if params.request_id.trim().is_empty()
                || params.session_key.trim().is_empty()
                || params.user_message.trim().is_empty()
            {
                return Err(error(request.id, -32602, "empty request fields"));
            }

            let execution_result = execute_turn(TurnExecuteInput {
                request_id: params.request_id,
                session_key: params.session_key,
                user_message: params.user_message,
                context_lines: params.context_lines,
                model_config: params.model_config.map(|model_config| RuntimeModelConfigInput {
                    base_url: model_config.base_url,
                    api_key: model_config.api_key,
                    model: model_config.model,
                    timeout_ms: model_config.timeout_ms,
                    provider_kind: model_config.provider_kind,
                    provider_options: model_config.provider_options.map(|options| {
                        RuntimeProviderOptionsInput {
                            kimi: options.kimi.map(|kimi| RuntimeKimiOptionsInput {
                                web_search_mode: kimi.web_search_mode,
                                disable_thinking_on_builtin_web_search: kimi
                                    .disable_thinking_on_builtin_web_search,
                                official_tools_allowlist: kimi.official_tools_allowlist,
                                official_tool_formulas: kimi.official_tool_formulas,
                                prompt_cache: kimi.prompt_cache.map(|prompt_cache| RuntimePromptCacheOptionsInput {
                                    enabled: prompt_cache.enabled,
                                    strategy: prompt_cache.strategy,
                                    user_last_n: prompt_cache.user_last_n,
                                    capability: prompt_cache.capability,
                                }),
                                max_tokens: kimi.max_tokens,
                                stream: kimi.stream,
                                temperature: kimi.temperature,
                                top_p: kimi.top_p,
                                files_enabled: kimi.files_enabled,
                                allow_file_admin: kimi.allow_file_admin,
                            }),
                        }
                    }),
                }),
                tool_context: params.tool_context.map(|tool_context| RuntimeToolContextInput {
                    work_dir: tool_context.work_dir,
                    enabled_tools: tool_context.enabled_tools,
                    bash_allowlist: tool_context.bash_allowlist,
                    max_tool_rounds: tool_context.max_tool_rounds,
                    no_tool_fallback_mode: tool_context.no_tool_fallback_mode,
                    max_recovery_rounds: tool_context.max_recovery_rounds,
                }),
                attachments: params
                    .attachments
                    .into_iter()
                    .map(|attachment| RuntimeAttachmentInput {
                        attachment_type: attachment.attachment_type,
                        source_type: attachment.source_type,
                        source: attachment.source,
                        mime_type: attachment.mime_type,
                        filename: attachment.filename,
                    })
                    .collect(),
            });
            match execution_result {
                Ok(execution) => Ok(success(
                    request.id,
                    json!({
                        "protocol_version": RUNTIME_PROTOCOL_VERSION,
                        "trace_id": execution.trace_id,
                        "request_id": execution.request_id,
                        "session_key": execution.session_key,
                        "assistant_message": execution.assistant_message,
                        "interrupt": execution.interrupt,
                        "events": execution.events
                    }),
                )),
                Err(failure) => Err(error_with_data(
                    request.id,
                    -32001,
                    "runtime turn execution failed",
                    json!({
                        "protocol_version": RUNTIME_PROTOCOL_VERSION,
                        "trace_id": failure.trace_id,
                        "request_id": failure.request_id,
                        "session_key": failure.session_key,
                        "error_class": failure.error_class,
                        "error_message": failure.error_message,
                        "events": failure.events
                    }),
                )),
            }
        }
        _ => Err(error(request.id, -32601, "method not found")),
    }
}

pub fn handle_json_line(line: &str) -> String {
    let parsed = serde_json::from_str::<RpcRequest>(line);
    let response = match parsed {
        Ok(request) => match handle_request(request) {
            Ok(ok) => serde_json::to_value(ok).unwrap_or_else(|_| {
                json!({
                    "jsonrpc": JSONRPC_VERSION,
                    "id": null,
                    "error": { "code": -32603, "message": "internal serialization error" }
                })
            }),
            Err(err) => serde_json::to_value(err).unwrap_or_else(|_| {
                json!({
                    "jsonrpc": JSONRPC_VERSION,
                    "id": null,
                    "error": { "code": -32603, "message": "internal serialization error" }
                })
            }),
        },
        Err(_) => json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": null,
            "error": { "code": -32700, "message": "parse error" }
        }),
    };

    serde_json::to_string(&response).unwrap_or_else(|_| {
        "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32603,\"message\":\"serialization failure\"}}"
            .to_string()
    })
}
