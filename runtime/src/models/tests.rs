#[cfg(test)]
mod tests {
    use super::{
        apply_prompt_cache_hints,
        build_runtime_messages, build_runtime_user_prompt, build_tool_definitions, extract_response_content,
        extract_prompt_cache_usage_observation,
        load_runtime_model_config, parse_model_response_payload, parse_tool_interrupt,
        pick_auto_model,
        PromptCacheOptions, PromptCacheStrategy,
        should_disable_thinking_for_kimi_builtin_web_search, build_tool_start_event, ModelExecutor,
        OpenAiCompatibleModelExecutor, ProviderKind, ENV_API_KEY, ENV_BASE_URL, ENV_MODEL,
        ENV_MODEL_AUTO_CACHE_TTL_SECS, ENV_RUNTIME_TIMEOUT_MS, TOOL_MESSAGE_BROWSER_MAX_CHARS,
    };
    use crate::models::engine::{
        RuntimeKimiOptionsInput, RuntimeModelConfigInput, RuntimePromptCacheOptionsInput,
        RuntimeProviderOptionsInput, RuntimeToolContextInput, TurnExecuteInput,
    };
    use crate::tools::tools::{
        LocalToolExecutor, ToolCallInput, ToolCallOutput, ToolExecutionError, ToolExecutor,
    };
    use reqwest::blocking::Client;
    use serde_json::{json, Value};
    use std::env;
    use std::ffi::OsString;
    use std::io::{ErrorKind, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
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

    #[test]
    fn tool_start_input_summary_redacts_secret_like_values() {
        let event = build_tool_start_event(
            &ToolCallInput {
                id: "bash_1".to_string(),
                name: "bash".to_string(),
                arguments: json!({
                    "command": "curl -H 'Authorization: Bearer sk-testsecret123456' https://example.test"
                }),
            },
            1,
            0,
            "high_risk",
        );
        let command_preview = event
            .payload
            .as_ref()
            .and_then(|payload| payload.get("input_summary"))
            .and_then(|summary| summary.get("command_preview"))
            .and_then(Value::as_str)
            .expect("tool_start should expose bounded command preview");
        assert!(command_preview.contains("Authorization:<redacted>"));
        assert!(!command_preview.contains("sk-testsecret123456"));
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn lock_env() -> MutexGuard<'static, ()> {
        match env_lock().lock() {
            Ok(guard) => guard,
            // Keep one failed env-mutating test from cascading into unrelated PoisonError failures.
            Err(poisoned) => poisoned.into_inner(),
        }
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

    #[derive(Debug, Clone)]
    struct StaticToolExecutor {
        content: String,
    }

    impl ToolExecutor for StaticToolExecutor {
        fn execute_tool_call(
            &self,
            _call: &ToolCallInput,
            _input: &TurnExecuteInput,
        ) -> Result<ToolCallOutput, ToolExecutionError> {
            Ok(ToolCallOutput::from_content(self.content.clone()))
        }
    }

    #[derive(Debug, Clone)]
    struct ObservedErrorToolExecutor {
        content: String,
        error: ToolExecutionError,
    }

    impl ToolExecutor for ObservedErrorToolExecutor {
        fn execute_tool_call(
            &self,
            _call: &ToolCallInput,
            _input: &TurnExecuteInput,
        ) -> Result<ToolCallOutput, ToolExecutionError> {
            Ok(ToolCallOutput::from_content(self.content.clone())
                .with_observed_error(self.error.clone()))
        }
    }

    #[derive(Debug, Clone)]
    struct FailingToolExecutor {
        error: ToolExecutionError,
    }

    impl ToolExecutor for FailingToolExecutor {
        fn execute_tool_call(
            &self,
            _call: &ToolCallInput,
            _input: &TurnExecuteInput,
        ) -> Result<ToolCallOutput, ToolExecutionError> {
            Err(self.error.clone())
        }
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
        start_mock_http_server_sequence(&[(status_line, response_body)])
    }

    fn write_http_response(stream: &mut TcpStream, status: &str, response_payload: &str) {
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            response_payload.as_bytes().len(),
            response_payload
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }

    fn start_mock_http_server_sequence(responses: &[(&str, &str)]) -> MockHttpServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test mock http server");
        let addr = listener.local_addr().expect("read local addr");
        listener
            .set_nonblocking(true)
            .expect("set non-blocking listener");
        let requests = Arc::new(Mutex::new(Vec::<RecordedRequest>::new()));
        let requests_for_thread = Arc::clone(&requests);
        let response_specs = responses
            .iter()
            .map(|(status, body)| (status.to_string(), body.to_string()))
            .collect::<Vec<(String, String)>>();
        let handle = thread::spawn(move || {
            for (status, response_payload) in response_specs {
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            stream
                                .set_nonblocking(false)
                                .expect("set blocking stream");
                            stream
                                .set_read_timeout(Some(Duration::from_secs(2)))
                                .expect("set read timeout");
                            let request_raw = read_http_request(&mut stream);
                            let Some(request) = parse_recorded_request(&request_raw) else {
                                if !request_raw.is_empty() {
                                    write_http_response(&mut stream, &status, &response_payload);
                                    break;
                                }
                                if Instant::now() >= deadline {
                                    break;
                                }
                                continue;
                            };
                            if let Ok(mut guard) = requests_for_thread.lock() {
                                guard.push(request);
                            }
                            write_http_response(&mut stream, &status, &response_payload);
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
                            if Instant::now() >= deadline {
                                break;
                            }
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(_) => {
                            if Instant::now() >= deadline {
                                break;
                            }
                            thread::sleep(Duration::from_millis(10));
                        }
                    }
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


    include!("tests/content_prompt.rs");
    include!("tests/prompt_cache_executor.rs");
    include!("tests/http_retry.rs");
    include!("tests/kimi_tooling.rs");
    include!("tests/tool_output_budget.rs");
    include!("tests/fallback_and_tool_errors.rs");
}
