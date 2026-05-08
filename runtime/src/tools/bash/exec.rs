#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[derive(Debug, Clone, Copy)]
enum BashStreamKind {
    Stdout,
    Stderr,
}

#[derive(Debug)]
enum BashStreamEvent {
    Data(BashStreamKind, Vec<u8>),
    Closed(BashStreamKind),
    Error(BashStreamKind, String),
}

#[derive(Debug)]
struct BashStreamCapture {
    total_bytes: usize,
    total_newlines: usize,
    tail: VecDeque<u8>,
    tail_bytes: usize,
    max_tail_bytes: usize,
    output_root: PathBuf,
    spill_path: Option<PathBuf>,
    spill_file: Option<fs::File>,
}

fn bash_io_error(
    message: impl Into<String>,
    stage: &str,
    stream: Option<&str>,
    recovery_hint: &str,
) -> ToolExecutionError {
    let mut data = json!({
        "diagnostic_kind": "bash_io_error",
        "source": TOOL_BASH,
        "stage": stage,
        "recovery_hint": recovery_hint
    });
    if let Some(stream) = stream {
        if let Some(data_object) = data.as_object_mut() {
            data_object.insert("stream".to_string(), json!(stream));
        }
    }
    ToolExecutionError::new("tool_execution_failed", message).with_data(data)
}

impl BashStreamCapture {
    fn new(max_tail_bytes: usize, output_root: &Path) -> Self {
        Self {
            total_bytes: 0,
            total_newlines: 0,
            tail: VecDeque::new(),
            tail_bytes: 0,
            max_tail_bytes,
            output_root: output_root.to_path_buf(),
            spill_path: None,
            spill_file: None,
        }
    }

    fn ingest(&mut self, chunk: &[u8], stream_label: &str) -> Result<(), ToolExecutionError> {
        if chunk.is_empty() {
            return Ok(());
        }

        if self.spill_file.is_none() && self.total_bytes.saturating_add(chunk.len()) > self.max_tail_bytes {
            self.ensure_spill_file(stream_label)?;
        }

        if let Some(file) = self.spill_file.as_mut() {
            file.write_all(chunk).map_err(|error| {
                bash_io_error(
                    format!("failed to persist {stream_label} stream: {error}"),
                    "persist_stream_chunk",
                    Some(stream_label),
                    "check temporary output storage permissions and retry with a smaller command output",
                )
            })?;
        }

        self.total_bytes = self.total_bytes.saturating_add(chunk.len());
        self.total_newlines = self
            .total_newlines
            .saturating_add(chunk.iter().filter(|byte| **byte == b'\n').count());

        for byte in chunk {
            self.tail.push_back(*byte);
            self.tail_bytes = self.tail_bytes.saturating_add(1);
        }

        while self.tail_bytes > self.max_tail_bytes {
            if self.tail.pop_front().is_some() {
                self.tail_bytes = self.tail_bytes.saturating_sub(1);
            } else {
                self.tail_bytes = 0;
                break;
            }
        }

        Ok(())
    }

    fn finalize(&mut self) {
        if let Some(file) = self.spill_file.as_mut() {
            let _ = file.flush();
        }
    }

    fn total_lines(&self) -> usize {
        if self.total_bytes == 0 {
            0
        } else {
            self.total_newlines.saturating_add(1)
        }
    }

    fn tail_text(&self) -> String {
        let bytes: Vec<u8> = self.tail.iter().copied().collect();
        String::from_utf8_lossy(bytes.as_slice()).to_string()
    }

    fn write_full_to<W: Write>(&self, writer: &mut W, stream_label: &str) -> Result<(), ToolExecutionError> {
        if let Some(path) = self.spill_path.as_ref() {
            let file = fs::File::open(path).map_err(|error| {
                bash_io_error(
                    format!("failed to open persisted {stream_label} stream: {error}"),
                    "open_persisted_stream",
                    Some(stream_label),
                    "inspect the persisted output path and retry the command if the temp file was removed",
                )
            })?;
            let mut reader = BufReader::new(file);
            std::io::copy(&mut reader, writer).map_err(|error| {
                bash_io_error(
                    format!("failed to copy persisted {stream_label} stream: {error}"),
                    "copy_persisted_stream",
                    Some(stream_label),
                    "retry with a smaller command output or inspect the persisted output path manually",
                )
            })?;
        } else {
            let bytes: Vec<u8> = self.tail.iter().copied().collect();
            writer.write_all(bytes.as_slice()).map_err(|error| {
                bash_io_error(
                    format!("failed to write {stream_label} stream: {error}"),
                    "write_stream_tail",
                    Some(stream_label),
                    "retry with a smaller command output or inspect command output directly",
                )
            })?;
        }
        Ok(())
    }

    fn cleanup_spill(&self) {
        if let Some(path) = self.spill_path.as_ref() {
            let _ = fs::remove_file(path);
        }
    }

    fn ensure_spill_file(&mut self, stream_label: &str) -> Result<(), ToolExecutionError> {
        if self.spill_file.is_some() {
            return Ok(());
        }

        let (path, mut file) = create_bash_output_file(self.output_root.as_path(), stream_label, "stream")
            .map_err(|error| {
                bash_io_error(
                    format!("failed to create {stream_label} stream buffer: {error}"),
                    "create_stream_buffer",
                    Some(stream_label),
                    "check temporary output directory permissions and retry",
                )
            })?;

        if !self.tail.is_empty() {
            let bytes: Vec<u8> = self.tail.iter().copied().collect();
            file.write_all(bytes.as_slice()).map_err(|error| {
                bash_io_error(
                    format!("failed to seed {stream_label} stream buffer: {error}"),
                    "seed_stream_buffer",
                    Some(stream_label),
                    "retry with a smaller command output or clear stale temporary output files",
                )
            })?;
        }

        self.spill_path = Some(path);
        self.spill_file = Some(file);
        Ok(())
    }
}

fn execute_bash_command(
    context: &ToolContextResolved,
    request: &BashRequest,
    policy: &BashRuntimePolicy,
) -> Result<BashExecutionResult, ToolExecutionError> {
    let output_root = ensure_bash_output_root_dir(policy)?;
    let tail_capacity = calculate_bash_tail_capacity(request.max_output_bytes, request.max_output_lines);
    let mut stdout_capture = BashStreamCapture::new(tail_capacity, output_root.as_path());
    let mut stderr_capture = BashStreamCapture::new(tail_capacity, output_root.as_path());

    let mut command = Command::new("bash");
    command
        .arg("-lc")
        .arg(&request.command)
        .current_dir(&context.work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_bash_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| {
            bash_io_error(
                format!("bash execution failed: {error}"),
                "spawn_process",
                None,
                "confirm bash is available and the workspace is accessible, then retry",
            )
        })?;

    let stdout_reader = child.stdout.take().ok_or_else(|| {
        bash_io_error(
            "failed to capture bash stdout",
            "capture_stdout_pipe",
            Some("stdout"),
            "retry the command; if it repeats, inspect runtime pipe setup",
        )
    })?;
    let stderr_reader = child.stderr.take().ok_or_else(|| {
        bash_io_error(
            "failed to capture bash stderr",
            "capture_stderr_pipe",
            Some("stderr"),
            "retry the command; if it repeats, inspect runtime pipe setup",
        )
    })?;

    let (sender, receiver) = std::sync::mpsc::channel::<BashStreamEvent>();
    let stdout_handle = spawn_bash_reader_thread(BashStreamKind::Stdout, stdout_reader, sender.clone());
    let stderr_handle = spawn_bash_reader_thread(BashStreamKind::Stderr, stderr_reader, sender.clone());
    drop(sender);

    let start = Instant::now();
    let timeout = Duration::from_millis(request.timeout_ms);
    let mut timed_out = false;
    let mut stdout_closed = false;
    let mut stderr_closed = false;
    let mut status: Option<std::process::ExitStatus> = None;

    loop {
        if status.is_none() {
            status = child
                .try_wait()
                .map_err(|error| {
                    bash_io_error(
                        format!("failed to poll bash process: {error}"),
                        "poll_process",
                        None,
                        "retry the command and inspect process state if polling failures repeat",
                    )
                })?;
        }

        if !timed_out && start.elapsed() > timeout {
            timed_out = true;
            terminate_bash_process_tree(&mut child);
        }

        match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(BashStreamEvent::Data(kind, chunk)) => {
                let ingest_result = match kind {
                    BashStreamKind::Stdout => stdout_capture.ingest(chunk.as_slice(), "stdout"),
                    BashStreamKind::Stderr => stderr_capture.ingest(chunk.as_slice(), "stderr"),
                };
                if let Err(error) = ingest_result {
                    terminate_bash_process_tree(&mut child);
                    let _ = child.wait();
                    let _ = stdout_handle.join();
                    let _ = stderr_handle.join();
                    cleanup_bash_spill_files(&stdout_capture, &stderr_capture);
                    return Err(error);
                }
            }
            Ok(BashStreamEvent::Closed(kind)) => match kind {
                BashStreamKind::Stdout => stdout_closed = true,
                BashStreamKind::Stderr => stderr_closed = true,
            },
            Ok(BashStreamEvent::Error(kind, message)) => {
                let stream = match kind {
                    BashStreamKind::Stdout => "stdout",
                    BashStreamKind::Stderr => "stderr",
                };
                terminate_bash_process_tree(&mut child);
                let _ = child.wait();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                cleanup_bash_spill_files(&stdout_capture, &stderr_capture);
                return Err(bash_io_error(
                    format!("failed to read bash {stream}: {message}"),
                    "read_process_stream",
                    Some(stream),
                    "retry with a smaller command output or inspect the command for pipe/encoding issues",
                ));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                stdout_closed = true;
                stderr_closed = true;
            }
        }

        if status.is_some() && stdout_closed && stderr_closed {
            break;
        }

        if timed_out && status.is_none() {
            status = child
                .try_wait()
                .map_err(|error| {
                    bash_io_error(
                        format!("failed to poll timed-out bash process: {error}"),
                        "poll_timed_out_process",
                        None,
                        "retry with a shorter-running command or inspect process state manually",
                    )
                })?;
        }
    }

    if status.is_none() {
        status = Some(child.wait().map_err(|error| {
            bash_io_error(
                format!("failed to wait bash process: {error}"),
                "wait_process",
                None,
                "retry the command and inspect process state if the wait failure repeats",
            )
        })?);
    }

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    stdout_capture.finalize();
    stderr_capture.finalize();

    let exit_code = status.and_then(|value| value.code()).unwrap_or(-1);
    let duration_ms = u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX);

    Ok(BashExecutionResult {
        exit_code,
        duration_ms,
        timed_out,
        stdout: stdout_capture,
        stderr: stderr_capture,
    })
}

fn spawn_bash_reader_thread<R: Read + Send + 'static>(
    kind: BashStreamKind,
    mut reader: R,
    sender: std::sync::mpsc::Sender<BashStreamEvent>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = sender.send(BashStreamEvent::Closed(kind));
                    break;
                }
                Ok(size) => {
                    let chunk = buffer[..size].to_vec();
                    if sender.send(BashStreamEvent::Data(kind, chunk)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = sender.send(BashStreamEvent::Error(kind, error.to_string()));
                    let _ = sender.send(BashStreamEvent::Closed(kind));
                    break;
                }
            }
        }
    })
}

fn calculate_bash_tail_capacity(max_output_bytes: usize, max_output_lines: usize) -> usize {
    let bytes_budget = max_output_bytes.saturating_mul(3);
    let lines_budget = max_output_lines.saturating_mul(160);
    bytes_budget.max(lines_budget).clamp(64 * 1024, 8 * 1024 * 1024)
}

fn build_bash_temp_file_path(root: &Path, prefix: &str, suffix: &str, attempt: u8) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    root.join(format!(
        "grobot-bash-{prefix}-{suffix}-{pid}-{timestamp}-{attempt}.log"
    ))
}

fn create_bash_output_file(
    root: &Path,
    prefix: &str,
    suffix: &str,
) -> Result<(PathBuf, fs::File), std::io::Error> {
    for attempt in 0..16_u8 {
        let path = build_bash_temp_file_path(root, prefix, suffix, attempt);
        match open_bash_output_file(path.as_path()) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "failed to allocate unique bash output file path",
    ))
}

fn open_bash_output_file(path: &Path) -> Result<fs::File, std::io::Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
    }
    #[cfg(not(unix))]
    {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
    }
}

fn persist_full_bash_output(
    stdout: &BashStreamCapture,
    stderr: &BashStreamCapture,
) -> Result<String, ToolExecutionError> {
    let (path, mut file) = create_bash_output_file(stdout.output_root.as_path(), "full", "output").map_err(|error| {
        bash_io_error(
            format!("failed to create full bash output file: {error}"),
            "create_full_output_file",
            None,
            "check temporary output directory permissions and retry with a smaller command output",
        )
    })?;

    file.write_all(b"### stdout\n").map_err(|error| {
        bash_io_error(
            format!("failed to write stdout header: {error}"),
            "write_full_output_header",
            Some("stdout"),
            "check temporary output storage permissions and retry",
        )
    })?;
    stdout.write_full_to(&mut file, "stdout")?;

    file.write_all(b"\n\n### stderr\n").map_err(|error| {
        bash_io_error(
            format!("failed to write stderr header: {error}"),
            "write_full_output_header",
            Some("stderr"),
            "check temporary output storage permissions and retry",
        )
    })?;
    stderr.write_full_to(&mut file, "stderr")?;

    file.flush().map_err(|error| {
        bash_io_error(
            format!("failed to flush full bash output file: {error}"),
            "flush_full_output_file",
            None,
            "check filesystem health for the temporary output directory and retry",
        )
    })?;

    Ok(path.to_string_lossy().to_string())
}

fn cleanup_bash_spill_files(stdout: &BashStreamCapture, stderr: &BashStreamCapture) {
    stdout.cleanup_spill();
    stderr.cleanup_spill();
}

fn ensure_bash_output_root_dir(policy: &BashRuntimePolicy) -> Result<PathBuf, ToolExecutionError> {
    let root = env::temp_dir().join("grobot-bash-output-v2");
    fs::create_dir_all(&root).map_err(|error| {
        bash_io_error(
            format!("failed to create bash output directory: {error}"),
            "create_output_directory",
            None,
            "check temporary directory permissions and retry",
        )
    })?;
    harden_bash_output_root_permissions(root.as_path());
    let _ = cleanup_bash_output_directory(root.as_path(), policy);
    Ok(root)
}

fn harden_bash_output_root_permissions(root: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(root) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o700);
            let _ = fs::set_permissions(root, permissions);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = root;
    }
}

fn cleanup_bash_output_directory(root: &Path, policy: &BashRuntimePolicy) -> Result<(), ToolExecutionError> {
    let now = SystemTime::now();
    let mut files: Vec<(PathBuf, u64)> = Vec::new();

    let entries = fs::read_dir(root).map_err(|error| {
        bash_io_error(
            format!("failed to read bash output directory: {error}"),
            "read_output_directory",
            None,
            "check temporary directory permissions and retry",
        )
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("grobot-bash-") || !name.ends_with(".log") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata.modified().unwrap_or(now);
        let age_secs = now
            .duration_since(modified)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        if age_secs > policy.output_ttl_secs {
            let _ = fs::remove_file(path);
            continue;
        }
        let modified_epoch = modified
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        files.push((path, modified_epoch));
    }

    if files.len() > policy.output_max_files {
        files.sort_by_key(|item| item.1);
        let remove_count = files.len().saturating_sub(policy.output_max_files);
        for (path, _) in files.iter().take(remove_count) {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

fn configure_bash_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
}

fn terminate_bash_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id();
        if let Ok(pid_i32) = i32::try_from(pid) {
            unsafe {
                let _ = libc::kill(-pid_i32, libc::SIGTERM);
            }
            thread::sleep(Duration::from_millis(80));
            match child.try_wait() {
                Ok(Some(_)) => return,
                _ => {}
            }
            unsafe {
                let _ = libc::kill(-pid_i32, libc::SIGKILL);
            }
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .arg("/F")
            .arg("/T")
            .arg("/PID")
            .arg(child.id().to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

fn load_bash_runtime_policy(context: &ToolContextResolved) -> BashRuntimePolicy {
    let mut policy = BashRuntimePolicy {
        output_ttl_secs: DEFAULT_BASH_OUTPUT_TTL_SECS,
        output_max_files: DEFAULT_BASH_OUTPUT_MAX_FILES,
        audit_preview_chars: DEFAULT_BASH_AUDIT_PREVIEW_CHARS,
        audit_segment_chars: DEFAULT_BASH_AUDIT_SEGMENT_CHARS,
        audit_redact_secrets: DEFAULT_BASH_AUDIT_REDACT_SECRETS,
    };
    let Some(project_grobot_dir) = find_project_grobot_dir(&context.work_dir) else {
        return policy;
    };
    let project_toml = project_grobot_dir.join("project.toml");
    let parsed = match parse_toml_file::<ProjectPolicyConfigFile>(&project_toml) {
        Some(parsed) => parsed,
        None => return policy,
    };
    let bash_policy = parsed.tools.bash;
    policy.output_ttl_secs = clamp_policy_u64(
        bash_policy.output_ttl_secs,
        DEFAULT_BASH_OUTPUT_TTL_SECS,
        MIN_BASH_OUTPUT_TTL_SECS,
        MAX_BASH_OUTPUT_TTL_SECS,
    );
    policy.output_max_files = clamp_policy_usize(
        bash_policy.output_max_files,
        DEFAULT_BASH_OUTPUT_MAX_FILES,
        MIN_BASH_OUTPUT_MAX_FILES,
        MAX_BASH_OUTPUT_MAX_FILES,
    );
    policy.audit_preview_chars = clamp_policy_usize(
        bash_policy.audit_preview_chars,
        DEFAULT_BASH_AUDIT_PREVIEW_CHARS,
        MIN_BASH_AUDIT_PREVIEW_CHARS,
        MAX_BASH_AUDIT_PREVIEW_CHARS,
    );
    policy.audit_segment_chars = clamp_policy_usize(
        bash_policy.audit_segment_chars,
        DEFAULT_BASH_AUDIT_SEGMENT_CHARS,
        MIN_BASH_AUDIT_SEGMENT_CHARS,
        MAX_BASH_AUDIT_SEGMENT_CHARS,
    );
    policy.audit_redact_secrets = bash_policy
        .audit_redact_secrets
        .unwrap_or(DEFAULT_BASH_AUDIT_REDACT_SECRETS);
    policy
}
