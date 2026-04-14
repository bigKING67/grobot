#[cfg(test)]
mod tests {
    use super::{
        build_runtime_user_prompt, build_tool_definitions, extract_response_content,
        load_runtime_model_config, should_disable_thinking_for_kimi_builtin_web_search,
        ModelExecutor, OpenAiCompatibleModelExecutor, ENV_API_KEY, ENV_BASE_URL,
        ENV_MODEL, ENV_RUNTIME_TIMEOUT_MS,
    };
    use crate::models::engine::{RuntimeModelConfigInput, TurnExecuteInput};
    use crate::tools::tools::LocalToolExecutor;
    use serde_json::json;
    use std::env;
    use std::ffi::OsString;
    use std::io::{ErrorKind, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    #[derive(Debug, Clone)]
    struct RecordedRequest {
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    #[derive(Debug)]
    struct MockHttpServer {
        base_url: String,
        requests: Arc<Mutex<Vec<RecordedRequest>>>,
        handle: Option<thread::JoinHandle<()>>,
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvRestoreGuard {
        previous: Vec<(String, Option<OsString>)>,
    }

    impl Drop for EnvRestoreGuard {
        fn drop(&mut self) {
            for (key, previous) in self.previous.drain(..) {
                match previous {
                    Some(value) => env::set_var(&key, value),
                    None => env::remove_var(&key),
                }
            }
        }
    }

    fn apply_env(entries: &[(&str, Option<&str>)]) -> EnvRestoreGuard {
        let mut previous = Vec::with_capacity(entries.len());
        for (key, value) in entries {
            previous.push(((*key).to_string(), env::var_os(key)));
            match value {
                Some(next) => env::set_var(key, next),
                None => env::remove_var(key),
            }
        }
        EnvRestoreGuard { previous }
    }

    fn find_header_end(raw: &[u8]) -> Option<usize> {
        raw.windows(4).position(|window| window == b"\r\n\r\n")
    }

    fn parse_content_length(header_text: &str) -> usize {
        for line in header_text.lines() {
            let mut parts = line.splitn(2, ':');
            let name = parts.next().unwrap_or("").trim();
            let value = parts.next().unwrap_or("").trim();
            if name.eq_ignore_ascii_case("content-length") {
                if let Ok(parsed) = value.parse::<usize>() {
                    return parsed;
                }
            }
        }
        0
    }

    fn read_http_request(stream: &mut TcpStream) -> Vec<u8> {
        let mut raw = Vec::<u8>::new();
        let mut chunk = [0_u8; 4096];
        let mut expected_total: Option<usize> = None;

        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read_bytes) => {
                    raw.extend_from_slice(&chunk[..read_bytes]);
                    if expected_total.is_none() {
                        if let Some(header_end) = find_header_end(&raw) {
                            let header_text =
                                String::from_utf8_lossy(&raw[..header_end]).into_owned();
                            let content_length = parse_content_length(&header_text);
                            expected_total = Some(header_end + 4 + content_length);
                        }
                    }
                    if let Some(expected) = expected_total {
                        if raw.len() >= expected {
                            break;
                        }
                    }
                }
                Err(error)
                    if error.kind() == ErrorKind::WouldBlock
                        || error.kind() == ErrorKind::TimedOut =>
                {
                    break;
                }
                Err(_) => break,
            }
        }

        raw
    }

    fn parse_recorded_request(raw: &[u8]) -> Option<RecordedRequest> {
        let full_text = String::from_utf8_lossy(raw).into_owned();
        let split_index = full_text.find("\r\n\r\n")?;
        let head = &full_text[..split_index];
        let body = full_text[(split_index + 4)..].to_string();
        let mut lines = head.lines();
        let request_line = lines.next().unwrap_or("").trim();
        let mut request_parts = request_line.split_whitespace();
        let method = request_parts.next().unwrap_or("").to_string();
        let path = request_parts.next().unwrap_or("").to_string();
        if method.is_empty() || path.is_empty() {
            return None;
        }
        let mut headers = Vec::new();
        for line in lines {
            let mut parts = line.splitn(2, ':');
            let name = parts.next().unwrap_or("").trim();
            let value = parts.next().unwrap_or("").trim();
            if name.is_empty() {
                continue;
            }
            headers.push((name.to_ascii_lowercase(), value.to_string()));
        }
        Some(RecordedRequest {
            method,
            path,
            headers,
            body,
        })
    }

    fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        let target = name.to_ascii_lowercase();
        headers
            .iter()
            .find(|(header_name, _)| header_name == &target)
            .map(|(_, value)| value.as_str())
    }

    fn start_mock_http_server(status_line: &str, response_body: &str) -> MockHttpServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test mock http server");
        let addr = listener.local_addr().expect("read local addr");
        listener
            .set_nonblocking(true)
            .expect("set non-blocking listener");
        let requests = Arc::new(Mutex::new(Vec::<RecordedRequest>::new()));
        let requests_for_thread = Arc::clone(&requests);
        let status = status_line.to_string();
        let response_payload = response_body.to_string();
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .expect("set read timeout");
                        let request_raw = read_http_request(&mut stream);
                        if let Some(request) = parse_recorded_request(&request_raw) {
                            if let Ok(mut guard) = requests_for_thread.lock() {
                                guard.push(request);
                            }
                        }
                        let response = format!(
                            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                            response_payload.as_bytes().len(),
                            response_payload
                        );
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                        break;
                    }
                    Err(error) if error.kind() == ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            break;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        MockHttpServer {
            base_url: format!("http://127.0.0.1:{}/v1", addr.port()),
            requests,
            handle: Some(handle),
        }
    }

    impl MockHttpServer {
        fn finish(mut self) -> Vec<RecordedRequest> {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
            match self.requests.lock() {
                Ok(guard) => guard.clone(),
                Err(_) => Vec::new(),
            }
        }
    }

    #[test]
    fn extracts_plain_string_content() {
        let payload = json!({
            "choices": [
                {
                    "message": {
                        "content": "hello from model"
                    }
                }
            ]
        });
        let result = extract_response_content(&payload);
        assert_eq!(result.as_deref(), Some("hello from model"));
    }

    #[test]
    fn extracts_array_content_parts() {
        let payload = json!({
            "choices": [
                {
                    "message": {
                        "content": [
                            { "type": "text", "text": "line-1" },
                            { "type": "text", "text": "line-2" }
                        ]
                    }
                }
            ]
        });
        let result = extract_response_content(&payload);
        assert_eq!(result.as_deref(), Some("line-1\nline-2"));
    }

    #[test]
    fn builds_prompt_with_context() {
        let input = TurnExecuteInput {
            request_id: "req_1".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "请总结一下".to_string(),
            context_lines: vec!["A".to_string(), "B".to_string()],
            model_config: None,
            tool_context: None,
            attachments: vec![],
        };
        let prompt = build_runtime_user_prompt(&input);
        assert!(prompt.contains("请总结一下"));
        assert!(prompt.contains("[Conversation Context]"));
        assert!(prompt.contains("A"));
        assert!(prompt.contains("B"));
    }

    #[test]
    fn kimi_defaults_declare_builtin_web_search_and_disable_thinking() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("kimi-k2.5".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("kimi".to_string()),
            provider_options: None,
        };
        let resolved = load_runtime_model_config(Some(&model_config_input))
            .expect("resolve kimi config");
        let input = TurnExecuteInput {
            request_id: "req_kimi_defaults".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "请搜索今天的科技新闻".to_string(),
            context_lines: vec![],
            model_config: Some(model_config_input),
            tool_context: None,
            attachments: vec![],
        };
        let definitions = build_tool_definitions(&input, &resolved).expect("tool definitions");
        let tool_entries = definitions.as_array().expect("tool array");
        assert!(
            tool_entries.iter().any(|entry| {
                entry
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .map(|value| value == "builtin_function")
                    .unwrap_or(false)
                    && entry
                        .get("function")
                        .and_then(serde_json::Value::as_object)
                        .and_then(|function| function.get("name"))
                        .and_then(serde_json::Value::as_str)
                        .map(|name| name == "$web_search")
                        .unwrap_or(false)
            }),
            "expected builtin $web_search in tool definitions"
        );
        assert!(should_disable_thinking_for_kimi_builtin_web_search(&resolved));
    }

    #[test]
    fn executor_roundtrip_with_mock_http_server() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"content":"MOCK_RUNTIME_OK"}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_success".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "请总结本轮进展".to_string(),
            context_lines: vec!["user: hi".to_string(), "assistant: hello".to_string()],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("runtime model success");
        assert_eq!(output, "MOCK_RUNTIME_OK");

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        let call = &calls[0];
        assert_eq!(call.method, "POST");
        assert_eq!(call.path, "/v1/chat/completions");
        assert_eq!(
            header_value(&call.headers, "authorization"),
            Some("Bearer runtime-test-key")
        );
        let payload: serde_json::Value =
            serde_json::from_str(&call.body).expect("request body json");
        assert_eq!(payload["model"], "runtime-test-model");
        let user_content = payload["messages"][0]["content"]
            .as_str()
            .expect("user content string");
        assert!(user_content.contains("请总结本轮进展"));
        assert!(user_content.contains("[Conversation Context]"));
        assert!(user_content.contains("user: hi"));
    }

    #[test]
    fn executor_maps_non_success_status_to_upstream_http_error() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server("503 Service Unavailable", r#"{"error":"unavailable"}"#);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_http_error".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "ping".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected upstream_http_error");
        assert_eq!(error.error_class, "upstream_http_error");
        assert!(error.message.contains("status=503"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn executor_reports_missing_config_when_required_env_absent() {
        let _env_guard = env_lock().lock().expect("lock env");
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_cfg_missing".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "ping".to_string(),
            context_lines: vec![],
            model_config: None,
            tool_context: None,
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected config_missing");
        assert_eq!(error.error_class, "config_missing");
        assert!(error.message.contains(ENV_BASE_URL));
    }

    #[test]
    fn executor_rejects_tool_calls_with_explicit_error_class() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{}"}}]}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_tool_call".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            user_message: "请调用工具".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected tool_call_not_supported");
        assert_eq!(error.error_class, "tool_call_not_supported");
        assert!(error.message.contains("lookup"));

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }
}
