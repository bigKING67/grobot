#[cfg(test)]
mod tests {
    use super::{
        apply_prompt_cache_hints,
        build_runtime_messages, build_runtime_user_prompt, build_tool_definitions, extract_response_content,
        extract_prompt_cache_usage_observation,
        load_runtime_model_config, parse_model_response_payload, pick_auto_model,
        PromptCacheOptions, PromptCacheStrategy,
        should_disable_thinking_for_kimi_builtin_web_search, ModelExecutor,
        OpenAiCompatibleModelExecutor, ProviderKind, ENV_API_KEY, ENV_BASE_URL, ENV_MODEL,
        ENV_RUNTIME_TIMEOUT_MS,
    };
    use crate::models::engine::{
        RuntimeKimiOptionsInput, RuntimeModelConfigInput, RuntimePromptCacheOptionsInput,
        RuntimeProviderOptionsInput, RuntimeToolContextInput, TurnExecuteInput,
    };
    use crate::tools::tools::LocalToolExecutor;
    use reqwest::blocking::Client;
    use serde_json::{json, Value};
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
        start_mock_http_server_sequence(&[(status_line, response_body)])
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
            system_prompt: None,
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
    fn build_runtime_messages_prepends_system_prompt() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.example.test/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("test-model".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("openai_compatible".to_string()),
            provider_options: None,
        };
        let config = load_runtime_model_config(Some(&model_config_input))
            .expect("resolve openai-compatible config");
        let client = Client::new();
        let input = TurnExecuteInput {
            request_id: "req_system_prompt".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: Some("SYSTEM built-in system prompt".to_string()),
            user_message: "hello".to_string(),
            context_lines: vec![],
            model_config: Some(model_config_input),
            tool_context: None,
            attachments: vec![],
        };
        let messages = build_runtime_messages(&input, &client, &config)
            .expect("runtime messages");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].get("role").and_then(Value::as_str), Some("system"));
        assert_eq!(
            messages[0].get("content").and_then(Value::as_str),
            Some("SYSTEM built-in system prompt")
        );
        assert_eq!(messages[1].get("role").and_then(Value::as_str), Some("user"));
    }

    #[test]
    fn build_runtime_messages_keeps_system_prompt_before_kimi_image_parts() {
        let model_config_input = RuntimeModelConfigInput {
            base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_key: Some("runtime-test-key".to_string()),
            model: Some("kimi-k2.5".to_string()),
            timeout_ms: Some(5_000),
            provider_kind: Some("kimi".to_string()),
            provider_options: Some(RuntimeProviderOptionsInput {
                kimi: Some(RuntimeKimiOptionsInput {
                    web_search_mode: None,
                    disable_thinking_on_builtin_web_search: None,
                    official_tools_allowlist: None,
                    official_tool_formulas: None,
                    prompt_cache: None,
                    max_tokens: None,
                    stream: None,
                    temperature: None,
                    top_p: None,
                    files_enabled: Some(true),
                    allow_file_admin: None,
                }),
            }),
        };
        let config = load_runtime_model_config(Some(&model_config_input))
            .expect("resolve kimi config");
        let client = Client::new();
        let input = TurnExecuteInput {
            request_id: "req_kimi_system_prompt".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: Some("SYSTEM built-in system prompt".to_string()),
            user_message: "describe this image".to_string(),
            context_lines: vec![],
            model_config: Some(model_config_input),
            tool_context: None,
            attachments: vec![crate::models::engine::RuntimeAttachmentInput {
                attachment_type: "image".to_string(),
                source_type: "url".to_string(),
                source: "https://example.test/image.png".to_string(),
                mime_type: Some("image/png".to_string()),
                filename: Some("image.png".to_string()),
            }],
        };
        let messages = build_runtime_messages(&input, &client, &config)
            .expect("runtime messages");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].get("role").and_then(Value::as_str), Some("system"));
        assert_eq!(messages[1].get("role").and_then(Value::as_str), Some("user"));
        let user_parts = messages[1]
            .get("content")
            .and_then(Value::as_array)
            .expect("kimi content parts");
        assert!(user_parts.iter().any(|part| part.get("image_url").is_some()));
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
            system_prompt: None,
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
        assert_eq!(resolved.provider_options.kimi.max_tokens, 262_144);
        assert!(resolved.provider_options.kimi.stream);
        assert_eq!(resolved.provider_options.kimi.temperature, 1.0);
        assert_eq!(resolved.provider_options.kimi.top_p, 0.95);
    }

    #[test]
    fn pick_auto_model_prioritizes_kimi_k25_family() {
        let models = vec![
            "moonshot-v1-128k-vision-preview".to_string(),
            "kimi-k2-thinking".to_string(),
            "kimi-k2.5".to_string(),
        ];
        let selected = pick_auto_model(&models, ProviderKind::Kimi).expect("selected model");
        assert_eq!(selected, "kimi-k2.5");
    }

    #[test]
    fn pick_auto_model_uses_first_for_non_kimi_provider() {
        let models = vec![
            "model-a".to_string(),
            "kimi-k2.5".to_string(),
            "model-c".to_string(),
        ];
        let selected =
            pick_auto_model(&models, ProviderKind::OpenAiCompatible).expect("selected model");
        assert_eq!(selected, "model-a");
    }

    #[test]
    fn prompt_cache_hints_target_latest_user_messages_only() {
        let mut messages = vec![
            json!({ "role": "system", "content": "system prompt" }),
            json!({ "role": "user", "content": "first user" }),
            json!({ "role": "assistant", "content": "assistant reply" }),
            json!({ "role": "user", "content": "second user" }),
            json!({ "role": "user", "content": [ { "type": "text", "text": "third user" } ] }),
        ];

        let applied = apply_prompt_cache_hints(
            &mut messages,
            PromptCacheOptions {
                enabled: true,
                strategy: PromptCacheStrategy::UserLastN,
                user_last_n: 2,
                capability: super::PromptCacheCapability::AnthropicCompatible,
            },
        );
        assert_eq!(applied, 2);

        let first_user = &messages[1];
        let second_user = &messages[3];
        let third_user = &messages[4];

        assert_eq!(
            first_user
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or(""),
            "first user"
        );
        assert_eq!(
            second_user
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_object)
                .and_then(|part| part.get("cache_control"))
                .and_then(Value::as_object)
                .and_then(|cache| cache.get("type"))
                .and_then(Value::as_str),
            Some("ephemeral")
        );
        assert_eq!(
            third_user
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_object)
                .and_then(|part| part.get("cache_control"))
                .and_then(Value::as_object)
                .and_then(|cache| cache.get("type"))
                .and_then(Value::as_str),
            Some("ephemeral")
        );
    }

    #[test]
    fn prompt_cache_usage_observation_parses_cached_token_signals() {
        let payload = json!({
            "usage": {
                "cache_read_input_tokens": 24,
                "cache_creation_input_tokens": 8,
                "input_tokens_details": {
                    "cached_tokens": 20
                }
            }
        });
        let observation = extract_prompt_cache_usage_observation(&payload)
            .expect("expected prompt cache observation");
        assert_eq!(observation.cached_tokens_total, 24);
        assert_eq!(
            observation
                .payload
                .get("cache_creation_input_tokens")
                .and_then(Value::as_u64),
            Some(8)
        );
    }

    #[test]
    fn executor_emits_prompt_cache_telemetry_for_anthropic_compatible_requests() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","usage":{"cache_read_input_tokens":9},"choices":[{"message":{"content":"PROMPT_CACHE_OK"}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_prompt_cache_telemetry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "please summarize".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("claude-3.7-sonnet".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("openai_compatible".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: Some(RuntimePromptCacheOptionsInput {
                            enabled: Some(true),
                            strategy: Some("user_last_n".to_string()),
                            user_last_n: Some(1),
                            capability: Some("anthropic_compatible".to_string()),
                        }),
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: None,
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected prompt cache request success");
        assert_eq!(output.assistant_message, "PROMPT_CACHE_OK");
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "prompt_cache_hint_applied")
        );
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "prompt_cache_usage_observed")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        let body_payload: Value =
            serde_json::from_str(&calls[0].body).expect("request body should be json");
        let first_message = body_payload["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("first message should exist");
        let content_part = first_message
            .get("content")
            .and_then(Value::as_array)
            .and_then(|parts| parts.first())
            .and_then(Value::as_object)
            .expect("first message content should be structured");
        assert_eq!(
            content_part
                .get("cache_control")
                .and_then(Value::as_object)
                .and_then(|cache| cache.get("type"))
                .and_then(Value::as_str),
            Some("ephemeral")
        );
    }

    #[test]
    fn executor_skips_prompt_cache_hints_without_explicit_capability() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"content":"PROMPT_CACHE_CAP_OFF"}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_prompt_cache_capability_missing".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "please summarize".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("claude-3.7-sonnet".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("openai_compatible".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: Some(RuntimePromptCacheOptionsInput {
                            enabled: Some(true),
                            strategy: Some("user_last_n".to_string()),
                            user_last_n: Some(1),
                            capability: None,
                        }),
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: None,
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected prompt cache request success");
        assert_eq!(output.assistant_message, "PROMPT_CACHE_CAP_OFF");
        let hint_event = output
            .telemetry_events
            .iter()
            .find(|event| event.event_type == "prompt_cache_hint_applied")
            .expect("prompt_cache_hint_applied event expected");
        assert_eq!(
            hint_event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("supported"))
                .and_then(Value::as_bool),
            Some(false)
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
        let body_payload: Value =
            serde_json::from_str(&calls[0].body).expect("request body should be json");
        let first_message = body_payload["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("first message should exist");
        assert!(
            first_message
                .get("content")
                .and_then(Value::as_str)
                .is_some(),
            "without explicit capability, prompt cache hints should not mutate message content"
        );
    }

    #[test]
    fn executor_retries_without_prompt_cache_hint_when_upstream_rejects_cache_control() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "400 Bad Request",
                r#"{"error":{"message":"cache_control is unsupported for this model"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"PROMPT_CACHE_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_prompt_cache_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "please summarize".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("claude-3.7-sonnet".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("openai_compatible".to_string()),
                provider_options: Some(RuntimeProviderOptionsInput {
                    kimi: Some(RuntimeKimiOptionsInput {
                        web_search_mode: None,
                        disable_thinking_on_builtin_web_search: None,
                        official_tools_allowlist: None,
                        official_tool_formulas: None,
                        prompt_cache: Some(RuntimePromptCacheOptionsInput {
                            enabled: Some(true),
                            strategy: Some("user_last_n".to_string()),
                            user_last_n: Some(1),
                            capability: Some("anthropic_compatible".to_string()),
                        }),
                        max_tokens: None,
                        stream: None,
                        temperature: None,
                        top_p: None,
                        files_enabled: None,
                        allow_file_admin: None,
                    }),
                }),
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected fallback retry success");
        assert_eq!(output.assistant_message, "PROMPT_CACHE_RETRY_OK");
        assert!(
            output.telemetry_events.iter().any(|event| {
                event.event_type == "prompt_cache_hint_applied"
                    && event
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("fallback_retry"))
                        .and_then(Value::as_bool)
                        == Some(true)
            }),
            "fallback retry telemetry expected"
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let first_body: Value =
            serde_json::from_str(&calls[0].body).expect("first request body should be json");
        let second_body: Value =
            serde_json::from_str(&calls[1].body).expect("second request body should be json");
        let first_message_first = first_body["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("first request should contain message");
        let second_message_first = second_body["messages"]
            .as_array()
            .and_then(|messages| messages.first())
            .expect("second request should contain message");
        assert!(
            first_message_first
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_object)
                .and_then(|part| part.get("cache_control"))
                .is_some(),
            "first request should carry prompt cache hint"
        );
        assert!(
            second_message_first
                .get("content")
                .and_then(Value::as_str)
                .is_some(),
            "fallback retry should remove prompt cache hint payload"
        );
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
            system_prompt: None,
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
        assert_eq!(output.assistant_message, "MOCK_RUNTIME_OK");
        assert_eq!(output.telemetry_events.len(), 0);

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
            system_prompt: None,
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
    fn executor_retries_kimi_overload_and_succeeds() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "429 Too Many Requests",
                r#"{"error":{"message":"The engine is currently overloaded, please try again later"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"KIMI_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请总结一下当前状态".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi request should retry and succeed");
        assert_eq!(output.assistant_message, "KIMI_RETRY_OK");
        assert_eq!(output.telemetry_events.len(), 0);

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].path, "/v1/chat/completions");
        assert_eq!(calls[1].path, "/v1/chat/completions");
        let first_payload: serde_json::Value =
            serde_json::from_str(&calls[0].body).expect("first request body json");
        assert_eq!(first_payload["max_tokens"], 262_144);
        assert_eq!(first_payload["stream"], true);
        assert_eq!(first_payload["temperature"], 1.0);
        assert_eq!(first_payload["top_p"], 0.95);
    }

    #[test]
    fn executor_retries_kimi_reasoning_context_error_with_thinking_disabled() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "400 Bad Request",
                r#"{"error":{"message":"thinking is enabled but reasoning_content is missing in assistant tool call context"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"KIMI_REASONING_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_reasoning_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请联网搜索今天热点".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi reasoning context retry should succeed");
        assert_eq!(output.assistant_message, "KIMI_REASONING_RETRY_OK");
        assert_eq!(output.telemetry_events.len(), 0);

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let first_payload: serde_json::Value =
            serde_json::from_str(&calls[0].body).expect("first request body json");
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        assert_eq!(first_payload["thinking"]["type"], "disabled");
        assert_eq!(second_payload["thinking"]["type"], "disabled");
    }

    #[test]
    fn executor_retries_kimi_invalid_temperature_without_sampling_controls() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "400 Bad Request",
                r#"{"error":{"message":"invalid temperature: only 0.6 is allowed for this model"}}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"KIMI_TEMP_RETRY_OK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_temp_retry".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请总结一下当前状态".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: None,
            attachments: vec![],
        };

        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi invalid temperature retry should succeed");
        assert_eq!(output.assistant_message, "KIMI_TEMP_RETRY_OK");
        assert_eq!(output.telemetry_events.len(), 0);

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let first_payload: serde_json::Value =
            serde_json::from_str(&calls[0].body).expect("first request body json");
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        assert_eq!(first_payload["temperature"], 1.0);
        assert_eq!(first_payload["top_p"], 0.95);
        assert!(second_payload.get("temperature").is_none());
        assert!(second_payload.get("top_p").is_none());
    }

    #[test]
    fn parse_kimi_stream_payload_keeps_reasoning_and_tool_calls() {
        let stream_body = concat!(
            "data: {\"id\":\"stream_1\",\"model\":\"kimi-k2.5\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"先\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"$web_search\",\"arguments\":\"{\\\"query\\\":\\\"今天\"}}]}}]}\n",
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"查新闻\",\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"热点\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n",
            "data: [DONE]\n",
        );
        let payload = parse_model_response_payload(stream_body, ProviderKind::Kimi)
            .expect("parse kimi stream payload");
        let message = payload["choices"][0]["message"].clone();
        assert_eq!(message["reasoning_content"], "先查新闻");
        assert_eq!(message["tool_calls"][0]["function"]["name"], "$web_search");
        assert_eq!(
            message["tool_calls"][0]["function"]["arguments"],
            "{\"query\":\"今天热点\"}"
        );
    }

    #[test]
    fn executor_injects_reasoning_content_for_kimi_tool_call_message() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list","arguments":"{\"path\":\".\"}"}}]}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"DONE"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_kimi_reasoning_context".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请列出当前目录文件".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("kimi-k2.5".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: Some("kimi".to_string()),
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("kimi tool turn should succeed");
        assert_eq!(output.assistant_message, "DONE");
        assert_eq!(
            output
                .telemetry_events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<&str>>(),
            vec!["tool_start", "tool_end"]
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        assert_eq!(
            second_payload["messages"][1]["reasoning_content"],
            "Reasoning kept for continuity."
        );
        assert_eq!(second_payload["messages"][1]["content"], "");
        assert_eq!(second_payload["thinking"]["type"], "disabled");
    }

    #[test]
    fn executor_defers_followup_tools_after_high_risk_tool_in_same_batch() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"tool_calls":[{"id":"bash_1","type":"function","function":{"name":"bash","arguments":"{\"command\":\"printf first\"}"}},{"id":"list_1","type":"function","function":{"name":"list","arguments":"{\"path\":\".\"}"}}]}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"DONE_AFTER_DEFER"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);
        let input = TurnExecuteInput {
            request_id: "req_rt_high_risk_defer".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "run bash then list".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["bash".to_string(), "list".to_string()]),
                model_visible_tools: Some(vec!["bash".to_string(), "list".to_string()]),
                tool_surface_profile: Some("full_debug".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(true),
                bash_allowlist: Some(vec!["printf".to_string()]),
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: None,
                max_recovery_rounds: None,
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("high-risk batch should finish after deferred observation");
        assert_eq!(output.assistant_message, "DONE_AFTER_DEFER");
        assert_eq!(
            output
                .telemetry_events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<&str>>(),
            vec![
                "tool_start",
                "tool_end",
                "tool_start",
                "tool_end",
                "tool_recovery"
            ]
        );
        assert_eq!(
            output.telemetry_events[1]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("risk_class"))
                .and_then(Value::as_str),
            Some("high_risk")
        );
        assert_eq!(
            output.telemetry_events[3]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("status"))
                .and_then(Value::as_str),
            Some("deferred")
        );
        assert_eq!(
            output.telemetry_events[3]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("error_class"))
                .and_then(Value::as_str),
            Some("tool_execution_deferred")
        );
        assert_eq!(
            output.telemetry_events[4]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("recovery_stage"))
                .and_then(Value::as_str),
            Some("observe_first")
        );
        assert_eq!(
            output.telemetry_events[4]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("recommended_next_action"))
                .and_then(Value::as_str),
            Some("observe_prior_tool_result")
        );
        assert_eq!(
            output.telemetry_events[4]
                .payload
                .as_ref()
                .and_then(|payload| payload.get("recoverable"))
                .and_then(Value::as_bool),
            Some(true)
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let second_payload: Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        let tool_messages = second_payload["messages"]
            .as_array()
            .expect("messages should be array")
            .iter()
            .filter(|message| message.get("role").and_then(Value::as_str) == Some("tool"))
            .collect::<Vec<&Value>>();
        assert_eq!(tool_messages.len(), 2);
        let deferred_payload: Value = serde_json::from_str(
            tool_messages[1]
                .get("content")
                .and_then(Value::as_str)
                .expect("deferred tool content should be string"),
        )
        .expect("deferred tool payload should be json");
        assert_eq!(
            deferred_payload["error_class"].as_str(),
            Some("tool_execution_deferred")
        );
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
            system_prompt: None,
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
    fn executor_no_tool_fallback_recovers_from_empty_content_when_safe_mode_enabled() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"RECOVERED_WITH_FALLBACK"}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_no_tool_fallback".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请处理这个任务".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: Some("safe".to_string()),
                max_recovery_rounds: Some(2),
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let output = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect("expected fallback recovery");
        assert_eq!(output.assistant_message, "RECOVERED_WITH_FALLBACK");
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_triggered")
        );
        assert!(
            output
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_succeeded")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
        let second_payload: serde_json::Value =
            serde_json::from_str(&calls[1].body).expect("second request body json");
        let second_messages = second_payload["messages"]
            .as_array()
            .expect("messages should be an array");
        assert!(
            second_messages.iter().any(|message| {
                message
                    .get("content")
                    .and_then(serde_json::Value::as_str)
                    .map(|content| content.contains("[System][no_tool fallback]"))
                    .unwrap_or(false)
            }),
            "expected no_tool fallback prompt in retried request"
        );
    }

    #[test]
    fn executor_no_tool_fallback_off_keeps_original_invalid_response_error() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server(
            "200 OK",
            r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
        );
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_no_tool_off".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请处理这个任务".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: Some("off".to_string()),
                max_recovery_rounds: Some(2),
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected upstream_invalid_response without fallback");
        assert_eq!(error.error_class, "upstream_invalid_response");

        let calls = server.finish();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn executor_no_tool_fallback_emits_exhausted_telemetry_after_recovery_budget_spent() {
        let _env_guard = env_lock().lock().expect("lock env");
        let server = start_mock_http_server_sequence(&[
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
            ),
            (
                "200 OK",
                r#"{"id":"mock","choices":[{"message":{"content":"   "}}]}"#,
            ),
        ]);
        let _restore = apply_env(&[
            (ENV_BASE_URL, None),
            (ENV_API_KEY, None),
            (ENV_MODEL, None),
            (ENV_RUNTIME_TIMEOUT_MS, None),
        ]);

        let input = TurnExecuteInput {
            request_id: "req_rt_no_tool_exhausted".to_string(),
            session_key: "feishu:tenant:dm:user".to_string(),
            system_prompt: None,
            user_message: "请处理这个任务".to_string(),
            context_lines: vec![],
            model_config: Some(RuntimeModelConfigInput {
                base_url: Some(server.base_url.clone()),
                api_key: Some("runtime-test-key".to_string()),
                model: Some("runtime-test-model".to_string()),
                timeout_ms: Some(5_000),
                provider_kind: None,
                provider_options: None,
            }),
            tool_context: Some(RuntimeToolContextInput {
                work_dir: Some(".".to_string()),
                enabled_tools: Some(vec!["list".to_string()]),
                model_visible_tools: Some(vec!["list".to_string()]),
                tool_surface_profile: Some("coding".to_string()),
                tool_surface_source: Some("test".to_string()),
                tool_surface_reason: Some("test".to_string()),
                tool_policy_version: Some("v1".to_string()),
                advanced_tool_schema: Some(false),
                bash_allowlist: None,
                max_tool_rounds: Some(4),
                no_tool_fallback_mode: Some("safe".to_string()),
                max_recovery_rounds: Some(1),
            }),
            attachments: vec![],
        };
        let executor = OpenAiCompatibleModelExecutor;
        let error = executor
            .generate_assistant_message(&input, &LocalToolExecutor)
            .expect_err("expected upstream_invalid_response after recovery budget is exhausted");
        assert_eq!(error.error_class, "upstream_invalid_response");
        assert!(
            error
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_triggered")
        );
        assert!(
            error
                .telemetry_events
                .iter()
                .any(|event| event.event_type == "no_tool_fallback_exhausted")
        );

        let calls = server.finish();
        assert_eq!(calls.len(), 2);
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
            system_prompt: None,
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
