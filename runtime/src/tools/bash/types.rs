const DEFAULT_BASH_TIMEOUT_MS: u64 = 120_000;
const MIN_BASH_TIMEOUT_MS: u64 = 100;
const MAX_BASH_TIMEOUT_MS: u64 = 600_000;
const MAX_BASH_COMMAND_CHARS: usize = 20_000;

const DEFAULT_BASH_MAX_OUTPUT_BYTES: usize = 50 * 1024;
const MIN_BASH_MAX_OUTPUT_BYTES: usize = 256;
const MAX_BASH_MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

const DEFAULT_BASH_MAX_OUTPUT_LINES: usize = 2_000;
const MIN_BASH_MAX_OUTPUT_LINES: usize = 1;
const MAX_BASH_MAX_OUTPUT_LINES: usize = 20_000;

const DEFAULT_BASH_OUTPUT_TTL_SECS: u64 = 6 * 60 * 60;
const MIN_BASH_OUTPUT_TTL_SECS: u64 = 60;
const MAX_BASH_OUTPUT_TTL_SECS: u64 = 30 * 24 * 60 * 60;

const DEFAULT_BASH_OUTPUT_MAX_FILES: usize = 512;
const MIN_BASH_OUTPUT_MAX_FILES: usize = 32;
const MAX_BASH_OUTPUT_MAX_FILES: usize = 20_000;

const DEFAULT_BASH_AUDIT_PREVIEW_CHARS: usize = 240;
const MIN_BASH_AUDIT_PREVIEW_CHARS: usize = 40;
const MAX_BASH_AUDIT_PREVIEW_CHARS: usize = 4_000;

const DEFAULT_BASH_AUDIT_SEGMENT_CHARS: usize = 200;
const MIN_BASH_AUDIT_SEGMENT_CHARS: usize = 40;
const MAX_BASH_AUDIT_SEGMENT_CHARS: usize = 4_000;

const DEFAULT_BASH_AUDIT_REDACT_SECRETS: bool = true;

#[derive(Debug, Clone)]
struct BashRequest {
    command: String,
    timeout_ms: u64,
    max_output_bytes: usize,
    max_output_lines: usize,
}

#[derive(Debug, Clone)]
struct BashTruncationSummary {
    content: String,
    truncated: bool,
    truncated_by: Option<&'static str>,
    total_lines: usize,
    total_bytes: usize,
    output_lines: usize,
    output_bytes: usize,
    last_line_partial: bool,
    max_lines: usize,
    max_bytes: usize,
}

#[derive(Debug)]
struct BashExecutionResult {
    exit_code: i32,
    duration_ms: u64,
    timed_out: bool,
    stdout: BashStreamCapture,
    stderr: BashStreamCapture,
}

#[derive(Debug, Clone, Copy)]
struct BashRuntimePolicy {
    output_ttl_secs: u64,
    output_max_files: usize,
    audit_preview_chars: usize,
    audit_segment_chars: usize,
    audit_redact_secrets: bool,
}
