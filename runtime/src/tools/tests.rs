#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::engine::{
        RuntimeKimiOptionsInput, RuntimeModelConfigInput, RuntimeProviderOptionsInput,
        RuntimeToolContextInput, TurnExecuteInput,
    };
    use serde_json::Value;
    use std::collections::HashMap as StdHashMap;
    use std::collections::HashSet as StdHashSet;
    use std::fs;
    use std::io::{ErrorKind, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::process;
    use std::sync::Arc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    static BROWSER_MCP_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[derive(Debug, Clone)]
    struct ToolRecordedRequest {
        path: String,
    }

    #[derive(Debug)]
    struct ToolMockHttpServer {
        base_url: String,
        requests: Arc<Mutex<Vec<ToolRecordedRequest>>>,
        handle: Option<thread::JoinHandle<()>>,
    }

    impl ToolMockHttpServer {
        fn finish(mut self) -> Vec<ToolRecordedRequest> {
            if let Some(handle) = self.handle.take() {
                handle.join().expect("join tool mock HTTP server");
            }
            self.requests
                .lock()
                .expect("read mock HTTP requests")
                .clone()
        }
    }

    fn read_tool_http_request(stream: &mut TcpStream) -> String {
        let mut buffer = [0_u8; 4096];
        let mut raw = Vec::new();
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    raw.extend_from_slice(&buffer[..count]);
                    if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                    ) =>
                {
                    break;
                }
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&raw).to_string()
    }

    fn parse_tool_recorded_request(raw: &str) -> Option<ToolRecordedRequest> {
        let request_line = raw.lines().next()?;
        let mut parts = request_line.split_whitespace();
        let _method = parts.next()?;
        let path = parts.next()?.to_string();
        Some(ToolRecordedRequest { path })
    }

    fn start_mock_http_server(status_line: &str, response_body: &str) -> ToolMockHttpServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind tool mock HTTP server");
        let addr = listener.local_addr().expect("read tool mock addr");
        listener
            .set_nonblocking(true)
            .expect("set tool mock non-blocking listener");
        let requests = Arc::new(Mutex::new(Vec::<ToolRecordedRequest>::new()));
        let requests_for_thread = Arc::clone(&requests);
        let status = status_line.to_string();
        let body = response_body.to_string();
        let handle = thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .expect("set tool mock read timeout");
                        if let Some(request) = parse_tool_recorded_request(&read_tool_http_request(&mut stream)) {
                            if let Ok(mut guard) = requests_for_thread.lock() {
                                guard.push(request);
                            }
                        }
                        let response = format!(
                            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                            body.as_bytes().len(),
                            body
                        );
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                        break;
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            ErrorKind::WouldBlock
                                | ErrorKind::Interrupted
                                | ErrorKind::ConnectionAborted
                        ) =>
                    {
                        if std::time::Instant::now() >= deadline {
                            break;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => {
                        if std::time::Instant::now() >= deadline {
                            break;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                }
            }
        });

        ToolMockHttpServer {
            base_url: format!("http://127.0.0.1:{}/v1", addr.port()),
            requests,
            handle: Some(handle),
        }
    }

    fn make_temp_workspace(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("grobot-tools-{prefix}-{}-{nonce}", process::id()));
        fs::create_dir_all(&root).expect("create temp workspace root");
        root
    }

    fn make_read_only_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_read_edit_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-edit-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read and edit".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string(), "edit".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_read_write_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-write-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read and write".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string(), "write".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_read_write_edit_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-read-write-edit-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run read, write and edit".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["read".to_string(), "write".to_string(), "edit".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_bash_input(workspace: &PathBuf, bash_allowlist: Vec<String>) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-bash-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run bash".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["bash".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: Some(bash_allowlist),
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_fs_input(workspace: &PathBuf) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: "req-fs-v2".to_string(),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run list/glob/search".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![
                    "list".to_string(),
                    "glob".to_string(),
                    "search".to_string(),
                ]),
                model_visible_tools: None,
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_search_semantic_input(workspace: &PathBuf, request_suffix: &str) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: format!("req-search-semantic-{request_suffix}"),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run search and semantic_search".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec!["search".to_string(), "semantic_search".to_string()]),
                model_visible_tools: None,
                tool_surface_profile: Some("context".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn make_browser_input(
        workspace: &PathBuf,
        profile: &str,
        advanced_tool_schema: bool,
    ) -> TurnExecuteInput {
        TurnExecuteInput {
            request_id: format!("req-browser-{profile}"),
            session_key: "feishu:grobot:dm:tester".to_string(),
            system_prompt: None,
            user_message: "run browser tool".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(workspace.to_string_lossy().to_string()),
                enabled_tools: Some(vec![TOOL_WEB_EXECUTE_JS.to_string()]),
                model_visible_tools: Some(vec![TOOL_WEB_EXECUTE_JS.to_string()]),
                tool_surface_profile: Some(profile.to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(advanced_tool_schema),
                bash_allowlist: None,
                max_tool_rounds: Some(8),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        }
    }

    fn execute_tool_payload(
        executor: &LocalToolExecutor,
        input: &TurnExecuteInput,
        name: &str,
        arguments: Value,
    ) -> Result<Value, ToolExecutionError> {
        let call = ToolCallInput {
            id: format!("tool-{name}"),
            name: name.to_string(),
            arguments,
        };
        let output = executor.execute_tool_call(&call, input)?;
        serde_json::from_str(&output.content).map_err(|error| {
            ToolExecutionError::new(
                "tool_execution_failed",
                format!("failed to decode tool output json: {error}"),
            )
        })
    }

    fn surface_parameters(profile: &str, tools: Vec<&str>, tool_name: &str) -> Value {
        surface_parameters_with_advanced(profile, tools, tool_name, false)
    }

    fn surface_definitions(profile: &str, advanced_tool_schema: bool) -> Vec<Value> {
        local_tool_definitions_for_surface(&Vec::new(), Some(profile), advanced_tool_schema)
    }

    fn surface_parameters_with_advanced(
        profile: &str,
        tools: Vec<&str>,
        tool_name: &str,
        advanced_tool_schema: bool,
    ) -> Value {
        let visible_tools = tools.into_iter().map(str::to_string).collect::<Vec<String>>();
        let definitions =
            local_tool_definitions_for_surface(&visible_tools, Some(profile), advanced_tool_schema);
        definitions
            .into_iter()
            .find_map(|definition| {
                let function = definition.get("function")?.as_object()?;
                if function.get("name").and_then(Value::as_str) != Some(tool_name) {
                    return None;
                }
                function.get("parameters").cloned()
            })
            .unwrap_or_else(|| panic!("missing projected tool schema for {tool_name}"))
    }

    fn surface_tool_names(profile: &str) -> StdHashSet<String> {
        surface_definitions(profile, false)
            .iter()
            .filter_map(|definition| {
                definition
                    .get("function")
                    .and_then(Value::as_object)
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect()
    }

    fn surface_schema_property_count(profile: &str, advanced_tool_schema: bool) -> usize {
        surface_definitions(profile, advanced_tool_schema)
            .iter()
            .map(|definition| {
                definition
                    .get("function")
                    .and_then(Value::as_object)
                    .and_then(|function| function.get("parameters"))
                    .and_then(|parameters| parameters.get("properties"))
                    .and_then(Value::as_object)
                    .map_or(0, |properties| properties.len())
            })
            .sum()
    }

    fn surface_schema_profile(profile: &str) -> Value {
        tool_surface_schema_profiles()
            .into_iter()
            .find(|row| row.get("profile").and_then(Value::as_str) == Some(profile))
            .unwrap_or_else(|| panic!("missing schema profile metadata for {profile}"))
    }

    fn schema_property_names(parameters: &Value) -> StdHashSet<String> {
        parameters
            .get("properties")
            .and_then(Value::as_object)
            .map(|properties| properties.keys().cloned().collect::<StdHashSet<String>>())
            .unwrap_or_default()
    }

    fn assert_schema_props_include(props: &StdHashSet<String>, names: &[&str]) {
        for name in names {
            assert!(props.contains(*name), "projected schema should expose {name}");
        }
    }

    fn assert_schema_props_omit(props: &StdHashSet<String>, names: &[&str]) {
        for name in names {
            assert!(!props.contains(*name), "projected schema should hide {name}");
        }
    }

    fn assert_surface_tool_names(profile: &str, names: &[&str]) {
        let actual = surface_tool_names(profile);
        let expected = names
            .iter()
            .map(|name| name.to_string())
            .collect::<StdHashSet<String>>();
        assert_eq!(actual, expected, "{profile} surface tool set drifted");
    }

    fn browser_test_context(profile: &str, advanced_tool_schema: bool) -> ToolContextResolved {
        let visible_tools = HashSet::from([
            TOOL_WEB_SCAN.to_string(),
            TOOL_WEB_EXECUTE_JS.to_string(),
        ]);
        ToolContextResolved {
            session_key: "browser-test-session".to_string(),
            work_dir: env::temp_dir(),
            enabled_tools: visible_tools.clone(),
            model_visible_tools: visible_tools,
            tool_surface_profile: profile.to_string(),
            advanced_tool_schema,
            bash_allowlist: Vec::new(),
        }
    }

    fn json_object_args(value: Value) -> Map<String, Value> {
        value.as_object().expect("test args must be object").clone()
    }

    fn toml_basic_string(value: &str) -> String {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    }

    fn clear_mcp_runtime_state(server_key: &str) {
        let stale_session = {
            let mut store = lock_runtime_store().expect("lock runtime store");
            store.states.remove(server_key);
            store.sessions.remove(server_key)
        };
        if let Some(mut session) = stale_session {
            close_mcp_session(&mut session);
        }
    }

    fn fake_browser_structured_mcp_server_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/tools/fixtures/fake-browser-structured-mcp.mjs")
    }

    fn write_fake_browser_mcp_registry(
        grobot_dir: &Path,
        backend_payload: &Value,
        mcp_is_error: bool,
        mcp_rpc_error: bool,
    ) {
        let server_script = fake_browser_structured_mcp_server_path();
        let backend_json =
            serde_json::to_string(backend_payload).expect("serialize backend fixture");
        fs::write(
            grobot_dir.join("mcp.toml"),
            format!(
                "\
[[servers]]
name = \"browser-structured\"
command = \"node\"
args = [{}]
enabled = true
env = {{ GROBOT_FAKE_BROWSER_BACKEND_PAYLOAD = {}, GROBOT_FAKE_BROWSER_MCP_IS_ERROR = {}, GROBOT_FAKE_BROWSER_MCP_RPC_ERROR = {} }}
",
                toml_basic_string(&server_script.to_string_lossy()),
                toml_basic_string(&backend_json),
                toml_basic_string(if mcp_is_error { "1" } else { "0" }),
                toml_basic_string(if mcp_rpc_error { "1" } else { "0" })
            ),
        )
        .expect("write browser MCP registry");
    }


    include!("tests/surface_browser.rs");
    include!("tests/runtime_policy_and_dispatch.rs");
    include!("tests/recovery.rs");
    include!("tests/mcp_call.rs");
    include!("tests/bash.rs");
    include!("tests/write.rs");
    include!("tests/read.rs");
    include!("tests/edit.rs");
    include!("tests/semantic_bridge.rs");

}
