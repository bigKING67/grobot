#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hmac
import json
import math
import os
import re
import select
import shlex
import shutil
import socket
import subprocess
import sys
import textwrap
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from heapq import nsmallest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import tomllib


RESPONSE_TIMEOUT_SECS = 60
DEFAULT_BASE_URL = "https://api.moonshot.cn/v1"
DEFAULT_MODEL = "auto"
DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0"
REDIS_TIMEOUT_SECS = 2.0


CIRCUIT_STATE: dict[str, dict[str, float]] = {}


@dataclass
class ProviderConfig:
    name: str
    api_key: str
    base_url: str
    model: str


@dataclass
class ProjectSelection:
    name: str
    work_dir: Path
    platform: str
    provider: ProviderConfig


@dataclass
class ProviderRoute:
    provider: ProviderConfig
    model: str


@dataclass
class SessionStoreConfig:
    backend: str
    redis_url: str | None
    ttl_secs: int
    root: Path


@dataclass
class RuntimePaths:
    repo_root: Path
    home: Path
    project_root: Path
    project_dir: Path
    project_toml: Path
    config_toml: Path
    runtime_dir: Path
    sessions_dir: Path
    global_rules_dir: Path
    project_rules_dir: Path
    global_skills_dir: Path
    project_skills_dir: Path
    global_hooks_dir: Path
    project_hooks_dir: Path
    global_mcp_dir: Path
    global_mcp_registry: Path
    project_mcp_file: Path
    global_memory_dir: Path
    project_memory_dir: Path
    session_memory_dir: Path


@dataclass
class MemoryStorePaths:
    session_snapshot: Path
    project_log: Path
    global_log: Path


@dataclass
class MCPServerSpec:
    name: str
    command: str
    args: tuple[str, ...]
    env: dict[str, str]
    cwd: str | None
    enabled: bool
    source: str


@dataclass
class MCPClientSession:
    server_name: str
    signature: str
    process: subprocess.Popen[Any]
    stdin: Any
    stdout: Any
    stdout_fd: int
    stderr: Any
    stderr_chunks: list[str] = field(default_factory=list, repr=False)
    stderr_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    stderr_thread: threading.Thread | None = field(default=None, repr=False)
    message_buffer: bytearray = field(default_factory=bytearray, repr=False)
    available_tools: tuple[str, ...] = ()
    next_request_id: int = 1


@dataclass
class MCPCallPolicy:
    max_concurrency_per_server: int
    max_queue_per_server: int
    failure_threshold: int
    cooldown_secs: int
    allow_tools: tuple[str, ...] | None
    latency_sample_limit: int


@dataclass
class HookPolicy:
    enabled: bool
    strict: bool
    timeout_secs: int


@dataclass
class MCPServerCallState:
    condition: threading.Condition = field(default_factory=lambda: threading.Condition(threading.Lock()), repr=False)
    in_flight: int = 0
    queued: int = 0
    consecutive_failures: int = 0
    circuit_open_until: float = 0.0
    last_error: str | None = None
    total_calls: int = 0
    success_calls: int = 0
    failure_calls: int = 0
    retry_calls: int = 0
    recovered_calls: int = 0
    policy_denied_calls: int = 0
    gate_rejected_calls: int = 0
    timeout_failures: int = 0
    transport_failures: int = 0
    tool_failures: int = 0
    unknown_failures: int = 0
    error_buckets: dict[str, int] = field(default_factory=dict, repr=False)
    total_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    last_latency_ms: float = 0.0
    last_finished_at: float = 0.0
    latency_ms_samples: list[float] = field(default_factory=list, repr=False)


@dataclass
class CircuitPolicy:
    failure_threshold: int
    cooldown_secs: int


@dataclass
class LocalToolContext:
    work_dir: Path
    allow_tokens: tuple[str, ...]
    mcp_runtime: dict[str, Any] | None = None
    global_hooks_dir: Path | None = None
    project_hooks_dir: Path | None = None
    hook_policy: HookPolicy = field(
        default_factory=lambda: HookPolicy(
            enabled=True,
            strict=False,
            timeout_secs=LOCAL_TOOL_HOOK_TIMEOUT_DEFAULT_SECS,
        )
    )
    mcp_sessions: dict[str, MCPClientSession] = field(default_factory=dict, repr=False)
    mcp_policy: MCPCallPolicy = field(
        default_factory=lambda: MCPCallPolicy(
            max_concurrency_per_server=1,
            max_queue_per_server=16,
            failure_threshold=3,
            cooldown_secs=20,
            allow_tools=None,
            latency_sample_limit=LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_DEFAULT,
        )
    )
    mcp_server_states: dict[str, MCPServerCallState] = field(default_factory=dict, repr=False)
    mcp_server_states_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


@dataclass
class RetrievalRemoteConfig:
    base_url: str
    api_key: str
    model: str


@dataclass
class ContextRetrievalConfig:
    enabled: bool
    candidate_limit: int
    selected_limit: int
    embedding: RetrievalRemoteConfig | None
    rerank: RetrievalRemoteConfig | None


@dataclass(frozen=True)
class SkillRouterConfig:
    enabled: bool
    descriptor_scan_lines: int
    max_descriptors: int
    score_threshold: float
    min_score_gap: float
    max_skill_block_chars: int
    observability_enabled: bool
    observability_path: str | None


@dataclass
class MentionPathIndex:
    work_dir: Path
    paths: set[str]
    exact_map: dict[str, set[str]]
    basename_map: dict[str, set[str]]
    trigram_map: dict[str, set[str]]
    query_cache: dict[str, list[str]]
    engine: str
    last_scan_at: float


@dataclass
class MentionIndexState:
    active: MentionPathIndex
    refresh_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    refresh_thread: threading.Thread | None = field(default=None, repr=False)
    pending_active: MentionPathIndex | None = field(default=None, repr=False)
    last_refresh_started_at: float = 0.0
    last_refresh_applied_at: float = 0.0
    last_refresh_error: str | None = None
    last_refresh_status: str = "idle"


@dataclass(frozen=True)
class SkillDescriptor:
    name: str
    scope: str
    source: str
    skill_file: Path
    description: str
    use_when: tuple[str, ...]
    dont_use_when: tuple[str, ...]
    output: str
    side_effect: bool
    rate_limit: str | None
    keywords: tuple[str, ...]
    specificity: float


@dataclass(frozen=True)
class SkillRoutingResult:
    descriptor: SkillDescriptor
    score: float
    positive_hits: tuple[str, ...]
    negative_hits: tuple[str, ...]
    reason: str


@dataclass(frozen=True)
class SkillRuntimeResolution:
    block: str
    status: str
    routing: SkillRoutingResult | None
    truncated: bool


@dataclass
class ManagementCredential:
    name: str
    token: str
    source: str
    actions: tuple[str, ...]
    interrupt_session_prefixes: tuple[str, ...]
    config_sections: tuple[str, ...] | None


MANAGEMENT_ACTION_RELOAD = "reload"
MANAGEMENT_ACTION_INTERRUPT = "interrupt"
MANAGEMENT_ACTION_CONFIG_READ = "config_read"
MANAGEMENT_ACTION_MCP_RESET = "mcp_reset"
MANAGEMENT_ACTION_ALL = (
    MANAGEMENT_ACTION_RELOAD,
    MANAGEMENT_ACTION_INTERRUPT,
    MANAGEMENT_ACTION_CONFIG_READ,
    MANAGEMENT_ACTION_MCP_RESET,
)

CONFIG_READ_POLICY_AUTO = "auto"
CONFIG_READ_POLICY_PUBLIC = "public"
CONFIG_READ_POLICY_AUTH = "auth"
CONFIG_READ_POLICY_DISABLED = "disabled"
CONFIG_READ_POLICY_ALL = (
    CONFIG_READ_POLICY_AUTO,
    CONFIG_READ_POLICY_PUBLIC,
    CONFIG_READ_POLICY_AUTH,
    CONFIG_READ_POLICY_DISABLED,
)

CONFIG_SECTION_PATHS = "paths"
CONFIG_SECTION_SELECTION = "selection"
CONFIG_SECTION_SESSION_STORE = "session_store"
CONFIG_SECTION_PROJECT_TOML = "project_toml"
CONFIG_SECTION_CONFIG_TOML = "config_toml"
CONFIG_SECTION_ALL = (
    CONFIG_SECTION_PATHS,
    CONFIG_SECTION_SELECTION,
    CONFIG_SECTION_SESSION_STORE,
    CONFIG_SECTION_PROJECT_TOML,
    CONFIG_SECTION_CONFIG_TOML,
)
DEFAULT_PUBLIC_CONFIG_SECTIONS = (
    CONFIG_SECTION_SELECTION,
    CONFIG_SECTION_SESSION_STORE,
)
CONFIG_PROFILE_OPERATOR = "operator"
CONFIG_PROFILE_AUDITOR = "auditor"
CONFIG_PROFILE_ADMIN = "admin"
CONFIG_PROFILE_ALL = (
    CONFIG_PROFILE_OPERATOR,
    CONFIG_PROFILE_AUDITOR,
    CONFIG_PROFILE_ADMIN,
)
CONFIG_PROFILE_SECTION_MAP: dict[str, tuple[str, ...] | None] = {
    CONFIG_PROFILE_OPERATOR: DEFAULT_PUBLIC_CONFIG_SECTIONS,
    CONFIG_PROFILE_AUDITOR: (
        CONFIG_SECTION_PATHS,
        CONFIG_SECTION_SELECTION,
        CONFIG_SECTION_SESSION_STORE,
        CONFIG_SECTION_PROJECT_TOML,
    ),
    CONFIG_PROFILE_ADMIN: None,
}
POLICY_TEMPLATE_OPS_READ_ONLY = "ops_read_only"
POLICY_TEMPLATE_AUDIT_READ = "audit_read"
POLICY_TEMPLATE_FULL_ADMIN = "full_admin"
POLICY_TEMPLATE_ALL = (
    POLICY_TEMPLATE_OPS_READ_ONLY,
    POLICY_TEMPLATE_AUDIT_READ,
    POLICY_TEMPLATE_FULL_ADMIN,
)
POLICY_TEMPLATE_DEFAULTS: dict[str, dict[str, Any]] = {
    POLICY_TEMPLATE_OPS_READ_ONLY: {
        "actions": (MANAGEMENT_ACTION_CONFIG_READ,),
        "config_profile": CONFIG_PROFILE_OPERATOR,
    },
    POLICY_TEMPLATE_AUDIT_READ: {
        "actions": (MANAGEMENT_ACTION_CONFIG_READ,),
        "config_profile": CONFIG_PROFILE_AUDITOR,
    },
    POLICY_TEMPLATE_FULL_ADMIN: {
        "actions": ("all",),
        "config_profile": CONFIG_PROFILE_ADMIN,
    },
}

LOCAL_TOOL_READ = "read"
LOCAL_TOOL_WRITE = "write"
LOCAL_TOOL_EDIT = "edit"
LOCAL_TOOL_BASH = "bash"
LOCAL_TOOL_LIST = "list"
LOCAL_TOOL_GLOB = "glob"
LOCAL_TOOL_SEARCH = "search"
LOCAL_TOOL_MCP_SERVERS = "mcp_servers"
LOCAL_TOOL_MCP_CALL = "mcp_call"
LOCAL_TOOL_ALL = (
    LOCAL_TOOL_READ,
    LOCAL_TOOL_WRITE,
    LOCAL_TOOL_EDIT,
    LOCAL_TOOL_BASH,
    LOCAL_TOOL_LIST,
    LOCAL_TOOL_GLOB,
    LOCAL_TOOL_SEARCH,
    LOCAL_TOOL_MCP_SERVERS,
    LOCAL_TOOL_MCP_CALL,
)
LOCAL_TOOL_OUTPUT_LIMIT = 12000
LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT = "user-prompt-submit"
LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE = "before-tool-use"
LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE = "after-tool-use"
LOCAL_TOOL_HOOK_EVENTS = (
    LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
    LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
    LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
)
LOCAL_TOOL_HOOK_TIMEOUT_DEFAULT_SECS = 5
LOCAL_TOOL_HOOK_TIMEOUT_MAX_SECS = 120
LOCAL_TOOL_HOOK_OUTPUT_PREVIEW_LIMIT = 300
LOCAL_TOOL_BASH_DEFAULT_TIMEOUT_SECS = 30
LOCAL_TOOL_BASH_MAX_TIMEOUT_SECS = 120
LOCAL_TOOL_MCP_CALL_DEFAULT_TIMEOUT_SECS = 20
LOCAL_TOOL_MCP_CALL_MAX_TIMEOUT_SECS = 120
LOCAL_TOOL_MCP_HEADER_LIMIT = 16384
LOCAL_TOOL_MCP_MESSAGE_LIMIT = 2 * 1024 * 1024
LOCAL_TOOL_MCP_STDERR_PREVIEW_MAX_CHARS = 8000
LOCAL_TOOL_MCP_MAX_CONCURRENCY_DEFAULT = 1
LOCAL_TOOL_MCP_MAX_CONCURRENCY_MAX = 8
LOCAL_TOOL_MCP_MAX_QUEUE_DEFAULT = 16
LOCAL_TOOL_MCP_MAX_QUEUE_MAX = 256
LOCAL_TOOL_MCP_CIRCUIT_FAILURE_THRESHOLD_DEFAULT = 3
LOCAL_TOOL_MCP_CIRCUIT_FAILURE_THRESHOLD_MAX = 20
LOCAL_TOOL_MCP_CIRCUIT_COOLDOWN_DEFAULT_SECS = 20
LOCAL_TOOL_MCP_CIRCUIT_COOLDOWN_MAX_SECS = 600
LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_DEFAULT = 256
LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_MAX = 1024
LOCAL_TOOL_MCP_ERROR_BUCKET_LIMIT_DEFAULT = 64
LOCAL_TOOL_MCP_ERROR_KEY_MAX_CHARS = 240
LOCAL_TOOL_READ_DEFAULT_LIMIT = 200
LOCAL_TOOL_READ_MAX_LIMIT = 2000
LOCAL_TOOL_LIST_DEFAULT_LIMIT = 200
LOCAL_TOOL_LIST_MAX_LIMIT = 2000
LOCAL_TOOL_GLOB_DEFAULT_LIMIT = 200
LOCAL_TOOL_GLOB_MAX_LIMIT = 2000
LOCAL_TOOL_SEARCH_DEFAULT_LIMIT = 200
LOCAL_TOOL_SEARCH_MAX_LIMIT = 2000
LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES = 20
FILE_MENTION_PATTERN = re.compile(r"@([^\s@,，。；：！？、()（）\[\]【】{}<>《》]+)")
FILE_MENTION_MAX_TOKENS = 8
FILE_MENTION_MAX_CANDIDATES = 5
FILE_MENTION_TRAILING_PUNCTUATION = ".,;:!?)]}>,，。；：！？）】》、"
FILE_MENTION_INDEX_REFRESH_SECS = 3.0
FILE_MENTION_INDEX_FORCE_REFRESH_SECS = 30.0
FILE_MENTION_INDEX_MAX_SCAN_FILES = 300000
FILE_MENTION_MAX_POOL_SIZE = 10000
FILE_MENTION_QUERY_CACHE_MAX_ENTRIES = 4096
FILE_MENTION_REFRESH_ERROR_BACKOFF_SECS = 5.0
FILE_MENTION_PYTHON_EXCLUDE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    "node_modules",
    ".next",
    "dist",
    "build",
    "target",
    ".venv",
    "venv",
}
HISTORY_COMPACT_HEADER = "[Compact Context Snapshot v1]"
HISTORY_COMPACT_SECTION_ARCHITECTURE = "Architecture decisions"
HISTORY_COMPACT_SECTION_MODIFIED = "Modified files and key changes"
HISTORY_COMPACT_SECTION_VERIFICATION = "Current verification status"
HISTORY_COMPACT_SECTION_TODO = "Open TODOs and rollback notes"
HISTORY_COMPACT_SECTION_TOOL_OUTPUT = "Tool outputs (pass/fail only)"
HISTORY_COMPACT_SECTIONS = (
    HISTORY_COMPACT_SECTION_ARCHITECTURE,
    HISTORY_COMPACT_SECTION_MODIFIED,
    HISTORY_COMPACT_SECTION_VERIFICATION,
    HISTORY_COMPACT_SECTION_TODO,
    HISTORY_COMPACT_SECTION_TOOL_OUTPUT,
)
HISTORY_COMPACT_SECTION_LIMITS: dict[str, int | None] = {
    HISTORY_COMPACT_SECTION_ARCHITECTURE: None,
    HISTORY_COMPACT_SECTION_MODIFIED: 48,
    HISTORY_COMPACT_SECTION_VERIFICATION: 32,
    HISTORY_COMPACT_SECTION_TODO: 32,
    HISTORY_COMPACT_SECTION_TOOL_OUTPUT: 32,
}
HISTORY_ARCHITECTURE_KEYWORDS = (
    "architecture",
    "system design",
    "trade-off",
    "tradeoff",
    "api contract",
    "security decision",
    "performance decision",
    "design decision",
    "架构",
    "系统设计",
    "架构决策",
    "权衡",
    "取舍",
    "接口契约",
    "安全决策",
    "性能决策",
    "设计决策",
)
HISTORY_MODIFIED_KEYWORDS = (
    "modified",
    "changed",
    "updated",
    "added",
    "removed",
    "breaking change",
    "dependency impact",
    "改动",
    "修改",
    "新增",
    "删除",
    "变更",
    "影响",
    "破坏性",
    "依赖",
)
HISTORY_VERIFICATION_KEYWORDS = (
    "verify",
    "verification",
    "test",
    "tests",
    "check",
    "passed",
    "failed",
    "status",
    "验证",
    "测试",
    "检查",
    "通过",
    "失败",
    "状态",
)
HISTORY_TODO_KEYWORDS = (
    "todo",
    "fixme",
    "rollback",
    "follow-up",
    "next step",
    "open issue",
    "未完成",
    "待办",
    "回滚",
    "后续",
    "遗留",
    "风险",
    "应急",
)
HISTORY_TOOL_OUTPUT_KEYWORDS = (
    "command:",
    "stdout",
    "stderr",
    "exit code",
    "exit_code",
    "traceback",
    "error",
    "[failover]",
    "[store]",
    "[interrupt]",
)
HISTORY_STATUS_PASS_MARKERS = (
    " passed",
    " pass",
    " success",
    " succeeded",
    " ok",
    " exit code: 0",
    " exit_code: 0",
    "通过",
    "成功",
)
HISTORY_STATUS_FAIL_MARKERS = (
    " failed",
    " fail",
    " error",
    " exception",
    " traceback",
    " exit code: 1",
    " exit_code: 1",
    " timeout",
    "失败",
    "错误",
    "异常",
    "超时",
)
HISTORY_PATH_PATTERN = re.compile(
    r"(?:\.{1,2}/|/)?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+(?:\.[A-Za-z0-9_.-]+)?"
)
HISTORY_QUERY_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]{1,12}")
HISTORY_RETRIEVAL_MAX_ITEMS = 8
HISTORY_RETRIEVAL_MAX_TEXT_CHARS = 220
HISTORY_RETRIEVAL_MIN_SCORE = 1.0
HISTORY_RETRIEVAL_PINNED_ARCH_LIMIT = 2
HISTORY_RETRIEVAL_REMOTE_MAX_CANDIDATES = 24
HISTORY_RETRIEVAL_EMBEDDING_SCORE_WEIGHT = 2.0
HISTORY_RETRIEVAL_RERANK_SCORE_WEIGHT = 2.5
HISTORY_RETRIEVAL_REMOTE_TIMEOUT_SECS = 20
HANDOFF_DEFAULT_RECENT_TURNS = 6
HANDOFF_MAX_RECENT_TURNS = 20
HANDOFF_FILENAME = "HANDOFF.md"
HANDOFF_HEADER = "# HANDOFF"
HANDOFF_SENSITIVE_INLINE_PATTERN = re.compile(
    r"(?i)\b(api[_-]?key|token|secret|password)\b\s*([:=])\s*([^\s,;]+)"
)
HANDOFF_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-]+")
HANDOFF_SK_LIKE_PATTERN = re.compile(r"\b(?:sk|gsk|rk)-[A-Za-z0-9_-]{8,}\b")
HANDOFF_WORKED_HINTS = (
    "pass",
    "passed",
    "success",
    "succeeded",
    "ok",
    "通过",
    "成功",
)
HANDOFF_FAILED_HINTS = (
    "fail",
    "failed",
    "error",
    "exception",
    "timeout",
    "失败",
    "错误",
    "异常",
    "超时",
)
DEFAULT_RETRIEVAL_BASE_URL = "https://api.siliconflow.cn/v1"
DEFAULT_RETRIEVAL_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B"
DEFAULT_RETRIEVAL_RERANK_MODEL = "Qwen/Qwen3-Reranker-4B"
SKILL_DESCRIPTOR_MAX_SCAN_LINES = 180
SKILL_DESCRIPTOR_MAX_ITEMS = 64
SKILL_DESCRIPTOR_MAX_OUTPUT_LEN = 240
SKILL_ROUTER_SCORE_THRESHOLD = 2.0
SKILL_ROUTER_MIN_SCORE_GAP = 0.8
SKILL_ROUTER_MAX_BLOCK_CHARS = 14000
SKILL_ROUTER_OBSERVABILITY_ENABLED = True
SKILL_ROUTER_OBSERVABILITY_DEFAULT_FILE = "skills/router_events.jsonl"
SKILL_ROUTER_OBSERVABILITY_PROMPT_PREVIEW_CHARS = 220
SKILL_ROUTER_OBSERVABILITY_HIT_PREVIEW_ITEMS = 8
SKILL_ROUTER_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_./:-]{2,}|[\u4e00-\u9fff]{1,8}")
SKILL_SIDE_EFFECT_KEYWORDS = ("deploy", "release", "push", "publish", "write", "delete", "修改", "写入", "发布")
HISTORY_RETRIEVAL_SECTION_WEIGHTS = {
    HISTORY_COMPACT_SECTION_ARCHITECTURE: 5.0,
    HISTORY_COMPACT_SECTION_MODIFIED: 3.0,
    HISTORY_COMPACT_SECTION_VERIFICATION: 2.5,
    HISTORY_COMPACT_SECTION_TODO: 2.0,
    HISTORY_COMPACT_SECTION_TOOL_OUTPUT: 1.5,
}
DEFAULT_GROBOT_HOME_NAME = ".grobot"
DEFAULT_GLOBAL_CONFIG_FILENAME = "config.toml"
DEFAULT_PROJECT_CONFIG_DIRNAME = ".grobot"
DEFAULT_PROJECT_CONFIG_FILENAME = "project.toml"
DEFAULT_GLOBAL_MCP_REGISTRY = "servers.toml"
DEFAULT_PROJECT_MCP_FILENAME = "mcp.toml"
SKILL_METADATA_FILENAME = "skill.meta.toml"

FALLBACK_GLOBAL_CONFIG_TEMPLATE = textwrap.dedent(
    """
    language = "zh"
    quiet = false

    [[projects]]
    name = "default"

    [projects.agent]
    type = "claudecode"
    provider = "default"

    [projects.agent.options]
    mode = "default"

    [[projects.agent.providers]]
    name = "default"
    api_key = "replace-with-api-key"
    base_url = "https://api.openai.com/v1"
    model = "gpt-4o-mini"

    [[projects.platforms]]
    type = "feishu"

    [projects.platforms.options]
    app_id = "replace-with-feishu-app-id"
    app_secret = "replace-with-feishu-app-secret"
    allow_from = "*"
    """
).strip() + "\n"

FALLBACK_PROJECT_TEMPLATE = textwrap.dedent(
    """
    schema_version = 1
    mode = "mvp"

    [agent]
    id = "grobot"
    name = "Grobot"

    [gateway.management]
    enabled = true
    bind = "127.0.0.1:8080"

    [runtime]
    engine = "rust"

[tools]
allow = ["list", "glob", "search", "read", "write", "edit", "bash", "mcp_servers", "mcp_call"]

[hooks]
enabled = true
strict = false
timeout_secs = 5
      """
).strip() + "\n"

FALLBACK_PROJECT_MCP_TEMPLATE = textwrap.dedent(
    """
    # Project-level MCP overrides.
    # Example:
    # [[servers]]
    # name = "contextweaver"
    # enabled = true
    """
).strip() + "\n"

FALLBACK_GLOBAL_MCP_TEMPLATE = textwrap.dedent(
    """
    # Global MCP registry.
    # Example:
    # [[servers]]
    # name = "contextweaver"
    # command = "npx"
    # args = ["-y", "contextweaver-mcp@latest"]
    # enabled = true
    #
    # [servers.env]
    # CONTEXTWEAVER_API_KEY = "replace-with-api-key"
    """
).strip() + "\n"

FALLBACK_HOOKS_README_TEMPLATE = textwrap.dedent(
    """
    # Grobot Hooks

    Supported events:
    - `user-prompt-submit`
    - `before-tool-use`
    - `after-tool-use`

    Directory layout:
    - `hooks/user-prompt-submit/`
    - `hooks/before-tool-use/`
    - `hooks/after-tool-use/`

    Put executable scripts into event folders. Scripts receive JSON payload via STDIN.

    Environment variables:
    - `GROBOT_HOOK_EVENT`
    - `GROBOT_HOOK_WORK_DIR`
    - `GROBOT_HOOK_TIMEOUT_SECS`
    """
).strip() + "\n"

FALLBACK_RULES_README_TEMPLATE = textwrap.dedent(
    """
    # Grobot Rules

    Place reusable rule markdown files here.

    Priority suggestion:
    - global rules: shared baseline
    - project rules: business-specific constraints
    """
).strip() + "\n"

FALLBACK_SKILLS_README_TEMPLATE = textwrap.dedent(
    """
    # Grobot Skills

    Place reusable skill prompts and automation helpers here.

    Typical pattern:
    - one skill, one focused responsibility
    - keep input/output contract explicit
    """
).strip() + "\n"

FALLBACK_MEMORY_README_TEMPLATE = textwrap.dedent(
    """
    # Grobot Memory

    Project-level memory artifacts are stored here.

    Suggested files:
    - memory.jsonl: append-only compact memory log
    - snapshots/: optional structured snapshots
    """
).strip() + "\n"

HOOK_SAMPLE_USER_PROMPT_FILENAME = "10-log-user-prompt.sh"
HOOK_SAMPLE_BEFORE_TOOL_FILENAME = "10-log-before-tool.sh"
HOOK_SAMPLE_AFTER_TOOL_FILENAME = "10-log-after-tool.sh"

FALLBACK_HOOK_SAMPLE_USER_PROMPT_TEMPLATE = textwrap.dedent(
    """
    #!/bin/sh
    set -eu
    payload="$(cat | tr '\n' ' ')"
    log_file="${GROBOT_HOOK_LOG_FILE:-/tmp/grobot-hooks.log}"
    printf '%s user-prompt-submit %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$payload" >> "$log_file"
    """
).strip() + "\n"

FALLBACK_HOOK_SAMPLE_BEFORE_TOOL_TEMPLATE = textwrap.dedent(
    """
    #!/bin/sh
    set -eu
    payload="$(cat | tr '\n' ' ')"
    log_file="${GROBOT_HOOK_LOG_FILE:-/tmp/grobot-hooks.log}"
    printf '%s before-tool-use %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$payload" >> "$log_file"
    """
).strip() + "\n"

FALLBACK_HOOK_SAMPLE_AFTER_TOOL_TEMPLATE = textwrap.dedent(
    """
    #!/bin/sh
    set -eu
    payload="$(cat | tr '\n' ' ')"
    log_file="${GROBOT_HOOK_LOG_FILE:-/tmp/grobot-hooks.log}"
    printf '%s after-tool-use %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$payload" >> "$log_file"
    """
).strip() + "\n"


def fail(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_grobot_home(home_override: str | None = None) -> Path:
    if isinstance(home_override, str) and home_override.strip():
        return Path(home_override).expanduser().resolve()
    env_home = os.getenv("GROBOT_HOME", "").strip()
    if env_home:
        return Path(env_home).expanduser().resolve()
    return (Path.home() / DEFAULT_GROBOT_HOME_NAME).resolve()


def discover_project_root(start_path: Path) -> Path | None:
    current = start_path.resolve()
    while True:
        candidate = current / DEFAULT_PROJECT_CONFIG_DIRNAME / DEFAULT_PROJECT_CONFIG_FILENAME
        if candidate.exists():
            return current
        if current.parent == current:
            break
        current = current.parent
    return None


def resolve_runtime_paths(
    *,
    work_dir_override: str | None,
    config_override: str | None,
    home_override: str | None,
    project_root_override: str | None,
) -> RuntimePaths:
    repo = repo_root().resolve()
    home = default_grobot_home(home_override)
    work_anchor = (
        Path(work_dir_override).expanduser().resolve()
        if isinstance(work_dir_override, str) and work_dir_override.strip()
        else Path.cwd().resolve()
    )

    if isinstance(project_root_override, str) and project_root_override.strip():
        project_root = Path(project_root_override).expanduser().resolve()
    else:
        project_root = discover_project_root(work_anchor) or discover_project_root(repo)
        if project_root is None:
            fail(
                "project.toml not found. Use --project-root <dir> or run `grobot init --project` "
                "inside your project."
            )

    project_dir = project_root / DEFAULT_PROJECT_CONFIG_DIRNAME
    project_toml = project_dir / DEFAULT_PROJECT_CONFIG_FILENAME
    if not project_toml.exists():
        fail(f"Project TOML file not found: {project_toml}")

    if isinstance(config_override, str) and config_override.strip():
        config_toml = Path(config_override).expanduser().resolve()
    else:
        config_toml = home / DEFAULT_GLOBAL_CONFIG_FILENAME

    runtime_dir = home / "runtime"
    sessions_dir = runtime_dir / "sessions"
    global_rules_dir = home / "rules"
    project_rules_dir = project_dir / "rules"
    global_skills_dir = home / "skills"
    project_skills_dir = project_dir / "skills"
    global_hooks_dir = home / "hooks"
    project_hooks_dir = project_dir / "hooks"
    global_mcp_dir = home / "mcp"
    global_mcp_registry = global_mcp_dir / DEFAULT_GLOBAL_MCP_REGISTRY
    project_mcp_file = project_dir / DEFAULT_PROJECT_MCP_FILENAME
    global_memory_dir = home / "memory" / "global"
    project_memory_dir = project_dir / "memory"
    session_memory_dir = runtime_dir / "memory" / "session"

    return RuntimePaths(
        repo_root=repo,
        home=home,
        project_root=project_root,
        project_dir=project_dir,
        project_toml=project_toml,
        config_toml=config_toml,
        runtime_dir=runtime_dir,
        sessions_dir=sessions_dir,
        global_rules_dir=global_rules_dir,
        project_rules_dir=project_rules_dir,
        global_skills_dir=global_skills_dir,
        project_skills_dir=project_skills_dir,
        global_hooks_dir=global_hooks_dir,
        project_hooks_dir=project_hooks_dir,
        global_mcp_dir=global_mcp_dir,
        global_mcp_registry=global_mcp_registry,
        project_mcp_file=project_mcp_file,
        global_memory_dir=global_memory_dir,
        project_memory_dir=project_memory_dir,
        session_memory_dir=session_memory_dir,
    )


def ensure_runtime_layout(paths: RuntimePaths) -> None:
    required_dirs = (
        paths.home,
        paths.runtime_dir,
        paths.sessions_dir,
        paths.global_hooks_dir,
        paths.global_hooks_dir / LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
        paths.global_hooks_dir / LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
        paths.global_hooks_dir / LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
        paths.project_hooks_dir,
        paths.project_hooks_dir / LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
        paths.project_hooks_dir / LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
        paths.project_hooks_dir / LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
        paths.global_memory_dir,
        paths.project_memory_dir,
        paths.session_memory_dir,
    )
    for directory in required_dirs:
        directory.mkdir(parents=True, exist_ok=True)


def write_text_file_if_missing(
    target: Path,
    *,
    source: Path | None = None,
    fallback_content: str,
    force: bool = False,
) -> bool:
    if target.exists() and not force:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    if source is not None and source.exists():
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    else:
        target.write_text(fallback_content, encoding="utf-8")
    return True


def write_executable_file_if_missing(
    target: Path,
    *,
    content: str,
    force: bool = False,
) -> bool:
    wrote = write_text_file_if_missing(
        target,
        source=None,
        fallback_content=content,
        force=force,
    )
    if wrote:
        mode = target.stat().st_mode
        target.chmod(mode | 0o111)
    return wrote


def init_hook_sample_scripts(
    *,
    hooks_root: Path,
    force: bool,
    created: list[str],
    reused: list[str],
) -> None:
    sample_files: tuple[tuple[str, str, str], ...] = (
        (
            LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
            HOOK_SAMPLE_USER_PROMPT_FILENAME,
            FALLBACK_HOOK_SAMPLE_USER_PROMPT_TEMPLATE,
        ),
        (
            LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
            HOOK_SAMPLE_BEFORE_TOOL_FILENAME,
            FALLBACK_HOOK_SAMPLE_BEFORE_TOOL_TEMPLATE,
        ),
        (
            LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
            HOOK_SAMPLE_AFTER_TOOL_FILENAME,
            FALLBACK_HOOK_SAMPLE_AFTER_TOOL_TEMPLATE,
        ),
    )
    for event_name, filename, template in sample_files:
        target = hooks_root / event_name / filename
        wrote = write_executable_file_if_missing(
            target,
            content=template,
            force=force,
        )
        if wrote:
            created.append(str(target))
        else:
            reused.append(str(target))


def append_jsonl_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False))
        handle.write("\n")


def summarize_memory_sections(compact_memory: dict[str, Any] | None, max_items: int = 8) -> dict[str, list[str]]:
    if not isinstance(compact_memory, dict):
        return {}
    sections = compact_memory.get("sections")
    if not isinstance(sections, dict):
        return {}
    summary: dict[str, list[str]] = {}
    for section in HISTORY_COMPACT_SECTIONS:
        raw_items = sections.get(section)
        if not isinstance(raw_items, list):
            continue
        cleaned = [str(item).strip() for item in raw_items if isinstance(item, str) and item.strip()]
        if cleaned:
            summary[section] = cleaned[:max_items]
    return summary


def sanitize_handoff_text(raw_text: str) -> str:
    if not raw_text:
        return ""

    def _replace_inline(match: re.Match[str]) -> str:
        key = match.group(1)
        separator = match.group(2)
        return f"{key}{separator}<redacted>"

    sanitized = HANDOFF_SENSITIVE_INLINE_PATTERN.sub(_replace_inline, raw_text)
    sanitized = HANDOFF_BEARER_PATTERN.sub("Bearer <redacted>", sanitized)
    sanitized = HANDOFF_SK_LIKE_PATTERN.sub("<redacted>", sanitized)
    return sanitized


def compact_sections_for_handoff(compact_memory: dict[str, Any] | None) -> dict[str, list[str]]:
    summary = summarize_memory_sections(compact_memory, max_items=64)
    sanitized: dict[str, list[str]] = {}
    for section, items in summary.items():
        sanitized[section] = [sanitize_handoff_text(item) for item in items if isinstance(item, str)]
    return sanitized


def parse_status_lines(lines: list[str]) -> tuple[list[str], list[str]]:
    worked: list[str] = []
    failed: list[str] = []
    for line in lines:
        if not isinstance(line, str):
            continue
        text = sanitize_handoff_text(line.strip())
        if not text:
            continue
        lower = text.lower()
        if any(token in lower for token in HANDOFF_FAILED_HINTS):
            if text not in failed:
                failed.append(text)
            continue
        if any(token in lower for token in HANDOFF_WORKED_HINTS):
            if text not in worked:
                worked.append(text)
    return worked, failed


def should_auto_write_handoff(
    *,
    compacted: bool,
    failover: bool,
    todo_open: bool,
) -> bool:
    return bool(compacted or failover or todo_open)


def recent_turn_pairs(history_messages: list[dict[str, str]], recent_turns: int) -> list[tuple[str, str]]:
    if recent_turns <= 0:
        return []
    pairs: list[tuple[str, str]] = []
    pending_user: str | None = None
    for message in history_messages:
        role = message.get("role")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        content = sanitize_handoff_text(content.strip())
        if role == "user":
            pending_user = content
            continue
        if role == "assistant" and isinstance(pending_user, str):
            pairs.append((pending_user, content))
            pending_user = None
    if not pairs:
        return []
    return pairs[-recent_turns:]


def has_open_todo_items(compact_memory: dict[str, Any] | None) -> bool:
    sections = compact_sections_for_handoff(compact_memory)
    todo_items = sections.get(HISTORY_COMPACT_SECTION_TODO, [])
    return bool(todo_items)


def build_handoff_markdown(
    *,
    session_key: str,
    project_name: str,
    work_dir: Path,
    compact_memory: dict[str, Any] | None,
    history_messages: list[dict[str, str]],
    recent_turns: int,
    failover_errors: list[str],
    compaction_observed: bool,
) -> str:
    sections = compact_sections_for_handoff(compact_memory)
    architecture = sections.get(HISTORY_COMPACT_SECTION_ARCHITECTURE, [])
    modified = sections.get(HISTORY_COMPACT_SECTION_MODIFIED, [])
    verification = sections.get(HISTORY_COMPACT_SECTION_VERIFICATION, [])
    todo_items = sections.get(HISTORY_COMPACT_SECTION_TODO, [])
    tool_outputs = sections.get(HISTORY_COMPACT_SECTION_TOOL_OUTPUT, [])
    combined_status = [*verification, *tool_outputs]
    worked, failed = parse_status_lines(combined_status)
    recent_pairs = recent_turn_pairs(history_messages, recent_turns)
    latest_goal = recent_pairs[-1][0] if recent_pairs else "继续当前任务并保持现有架构决策不回退"

    failover_notes = [sanitize_handoff_text(item) for item in failover_errors if isinstance(item, str) and item.strip()]
    if failover_notes and not any(note in failed for note in failover_notes):
        failed.extend(failover_notes)

    lines: list[str] = [
        HANDOFF_HEADER,
        "",
        "## Current Goal",
        f"- {latest_goal}",
        f"- session: `{sanitize_handoff_text(session_key)}`",
        f"- project: `{sanitize_handoff_text(project_name)}`",
        f"- work_dir: `{sanitize_handoff_text(str(work_dir))}`",
        "",
        "## Architecture Decisions (verbatim)",
    ]
    if architecture:
        for item in architecture:
            lines.append(f"- {item}")
    else:
        lines.append("- none")

    lines.extend(
        [
            "",
            "## Modified Files and Key Changes",
        ]
    )
    if modified:
        for item in modified:
            lines.append(f"- {item}")
    else:
        lines.append("- none")

    lines.extend(
        [
            "",
            "## Verification Status (PASS/FAIL only)",
        ]
    )
    status_lines = [item for item in combined_status if isinstance(item, str)]
    if status_lines:
        for item in status_lines:
            normalized = item if item.startswith(("PASS:", "FAIL:")) else compact_format_tool_status(item) or item
            if isinstance(normalized, str):
                lines.append(f"- {sanitize_handoff_text(normalized)}")
    else:
        lines.append("- none")

    lines.extend(
        [
            "",
            "## What Was Tried",
            "### Worked",
        ]
    )
    if worked:
        for item in worked:
            lines.append(f"- {item}")
    else:
        lines.append("- none")

    lines.append("")
    lines.append("### Did Not Work")
    if failed:
        for item in failed:
            lines.append(f"- {item}")
    else:
        lines.append("- none")

    lines.extend(
        [
            "",
            "## Open TODOs and Rollback Notes",
        ]
    )
    if todo_items:
        for item in todo_items:
            lines.append(f"- {item}")
    else:
        lines.append("- none")

    lines.extend(
        [
            "",
            "## Next 3 Steps",
        ]
    )
    next_steps: list[str] = []
    if todo_items:
        next_steps.append(f"处理最高优先级 TODO：{todo_items[0]}")
    if failed:
        next_steps.append("优先复现并修复失败项，再更新验证状态")
    if not next_steps:
        next_steps.append("执行当前目标相关的最小闭环改动")
    next_steps.append("运行最相关验证并记录 PASS/FAIL 结果")
    next_steps.append("完成后刷新 HANDOFF.md，再进入新会话继续")
    for idx, step in enumerate(next_steps[:3], start=1):
        lines.append(f"{idx}. {step}")

    lines.extend(
        [
            "",
            "## Runtime Signals",
            f"- compaction_observed: {'true' if compaction_observed else 'false'}",
            f"- failover_observed: {'true' if bool(failover_errors) else 'false'}",
            f"- open_todo_count: {len(todo_items)}",
            "",
            "## Recent Turns",
        ]
    )
    if recent_pairs:
        for idx, (user_text, assistant_text) in enumerate(recent_pairs, start=1):
            lines.append(f"### Turn {idx}")
            lines.append(f"- user: {user_text}")
            lines.append(f"- assistant: {assistant_text}")
    else:
        lines.append("- none")

    return "\n".join(lines).strip() + "\n"


def write_handoff_file(
    *,
    path: Path,
    content: str,
) -> tuple[bool, str | None]:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return True, None
    except OSError as exc:
        return False, str(exc)


def build_memory_store_paths(paths: RuntimePaths, session_key: str) -> MemoryStorePaths:
    safe_name = sanitize_session_key(session_key)
    return MemoryStorePaths(
        session_snapshot=paths.session_memory_dir / f"{safe_name}.json",
        project_log=paths.project_memory_dir / "memory.jsonl",
        global_log=paths.global_memory_dir / "memory.jsonl",
    )


def persist_memory_layers(
    *,
    paths: RuntimePaths,
    selection: ProjectSelection,
    session_key: str,
    compact_memory: dict[str, Any] | None,
) -> list[str]:
    warnings: list[str] = []
    summary_sections = summarize_memory_sections(compact_memory)
    if not summary_sections:
        return warnings

    store_paths = build_memory_store_paths(paths, session_key)
    session_payload = {
        "version": 1,
        "updated_at": now_utc_iso(),
        "session_key": session_key,
        "project": selection.name,
        "work_dir": str(selection.work_dir),
        "sections": summary_sections,
    }
    try:
        write_json_file(store_paths.session_snapshot, session_payload)
    except OSError as exc:
        warnings.append(f"session memory snapshot write failed: {exc}")

    log_entry = {
        "timestamp": now_utc_iso(),
        "session_key": session_key,
        "project": selection.name,
        "work_dir": str(selection.work_dir),
        "sections": summary_sections,
    }
    try:
        append_jsonl_file(store_paths.project_log, log_entry)
    except OSError as exc:
        warnings.append(f"project memory append failed: {exc}")

    architecture = summary_sections.get(HISTORY_COMPACT_SECTION_ARCHITECTURE, [])
    verification = summary_sections.get(HISTORY_COMPACT_SECTION_VERIFICATION, [])
    if architecture or verification:
        global_entry = {
            "timestamp": now_utc_iso(),
            "session_key": session_key,
            "project": selection.name,
            "work_dir": str(selection.work_dir),
            "architecture": architecture,
            "verification": verification,
        }
        try:
            append_jsonl_file(store_paths.global_log, global_entry)
        except OSError as exc:
            warnings.append(f"global memory append failed: {exc}")
    return warnings


def load_toml(path: Path) -> dict[str, Any]:
    if not path.exists():
        fail(f"TOML file not found: {path}")
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        fail(f"Invalid TOML at {path}: {exc}")
    except OSError as exc:
        fail(f"Failed to read {path}: {exc}")


def load_toml_optional(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    if not path.exists():
        return None, None
    try:
        return tomllib.loads(path.read_text(encoding="utf-8")), None
    except tomllib.TOMLDecodeError as exc:
        return None, f"Invalid TOML at {path}: {exc}"
    except OSError as exc:
        return None, f"Failed to read {path}: {exc}"


def parse_mcp_server_item(item: dict[str, Any], *, source: str, index: int) -> tuple[MCPServerSpec | None, str | None]:
    name = item.get("name")
    if not isinstance(name, str) or not name.strip():
        return None, f"{source}: servers[{index}] missing non-empty string field `name`"

    command = item.get("command")
    if not isinstance(command, str) or not command.strip():
        return None, f"{source}: servers[{index}] ({name}) missing non-empty string field `command`"

    args_raw = item.get("args")
    args: tuple[str, ...] = ()
    if args_raw is not None:
        if not isinstance(args_raw, list) or not all(isinstance(arg, str) for arg in args_raw):
            return None, f"{source}: servers[{index}] ({name}) field `args` must be string array"
        args = tuple(arg for arg in args_raw if arg)

    env_raw = item.get("env")
    env: dict[str, str] = {}
    if env_raw is not None:
        if not isinstance(env_raw, dict):
            return None, f"{source}: servers[{index}] ({name}) field `env` must be table"
        for key, value in env_raw.items():
            if not isinstance(key, str) or not key.strip():
                return None, f"{source}: servers[{index}] ({name}) has invalid env key"
            if not isinstance(value, str):
                return None, f"{source}: servers[{index}] ({name}) env[{key}] must be string"
            env[key] = value

    cwd_raw = item.get("cwd")
    cwd: str | None = None
    if cwd_raw is not None:
        if not isinstance(cwd_raw, str) or not cwd_raw.strip():
            return None, f"{source}: servers[{index}] ({name}) field `cwd` must be non-empty string"
        cwd = cwd_raw

    enabled_raw = item.get("enabled")
    if enabled_raw is None:
        enabled = True
    elif isinstance(enabled_raw, bool):
        enabled = enabled_raw
    else:
        return None, f"{source}: servers[{index}] ({name}) field `enabled` must be bool"

    return (
        MCPServerSpec(
            name=name.strip(),
            command=command.strip(),
            args=args,
            env=env,
            cwd=cwd,
            enabled=enabled,
            source=source,
        ),
        None,
    )


def load_mcp_servers_from_file(path: Path, *, source_label: str) -> tuple[list[MCPServerSpec], list[str]]:
    payload, error = load_toml_optional(path)
    if error is not None:
        return [], [error]
    if payload is None:
        return [], []
    servers_raw = payload.get("servers")
    if servers_raw is None:
        return [], []
    if not isinstance(servers_raw, list):
        return [], [f"{source_label}: field `servers` must be array of tables"]
    servers: list[MCPServerSpec] = []
    warnings: list[str] = []
    for idx, item in enumerate(servers_raw):
        if not isinstance(item, dict):
            warnings.append(f"{source_label}: servers[{idx}] must be table")
            continue
        parsed, warning = parse_mcp_server_item(item, source=source_label, index=idx)
        if warning is not None:
            warnings.append(warning)
            continue
        if parsed is not None:
            servers.append(parsed)
    return servers, warnings


def merge_mcp_servers(global_servers: list[MCPServerSpec], project_servers: list[MCPServerSpec]) -> list[MCPServerSpec]:
    ordered: OrderedDict[str, MCPServerSpec] = OrderedDict()
    for server in global_servers:
        ordered[server.name.lower()] = server
    for server in project_servers:
        ordered[server.name.lower()] = server
    return list(ordered.values())


def infer_mcp_source_path(source: str) -> Path | None:
    if ":" not in source:
        return None
    _, value = source.split(":", 1)
    value = value.strip()
    if not value:
        return None
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        return None
    return candidate


def resolve_mcp_server_command(server: MCPServerSpec, *, default_root: Path) -> tuple[str | None, str | None]:
    command = server.command.strip()
    if not command:
        return None, "empty command"

    if "/" not in command:
        resolved = shutil.which(command)
        if resolved:
            return str(Path(resolved).resolve()), None
        return None, f"command not found in PATH: {command}"

    raw_path = Path(command).expanduser()
    if raw_path.is_absolute():
        candidate = raw_path
    else:
        base: Path | None = None
        if isinstance(server.cwd, str) and server.cwd.strip():
            base = Path(server.cwd).expanduser()
        else:
            source_path = infer_mcp_source_path(server.source)
            if source_path is not None:
                base = source_path.parent
        if base is None:
            base = default_root
        candidate = (base / raw_path).expanduser()
    candidate_resolved = candidate.resolve()
    if candidate_resolved.exists() and os.access(candidate_resolved, os.X_OK):
        return str(candidate_resolved), None
    return None, f"command path is not executable: {candidate_resolved}"


def summarize_mcp_servers(servers: list[MCPServerSpec], *, project_root: Path) -> tuple[dict[str, Any], list[str]]:
    enabled = [server for server in servers if server.enabled]
    disabled = [server for server in servers if not server.enabled]
    ready: list[str] = []
    unready: list[str] = []
    warnings: list[str] = []
    effective_rows: list[dict[str, Any]] = []

    for server in servers:
        resolved_command: str | None = None
        ready_state: bool | None = None
        ready_reason: str | None = None
        if server.enabled:
            resolved_command, command_error = resolve_mcp_server_command(server, default_root=project_root)
            if command_error is None:
                ready_state = True
                ready.append(server.name)
            else:
                ready_state = False
                ready_reason = command_error
                unready.append(server.name)
                warnings.append(f"MCP server `{server.name}` not ready: {command_error}")

        effective_rows.append(
            {
                "name": server.name,
                "enabled": server.enabled,
                "source": server.source,
                "command": server.command,
                "command_resolved": resolved_command,
                "args": list(server.args),
                "cwd": server.cwd,
                "env": mask_sensitive_object(server.env),
                "ready": ready_state,
                "ready_reason": ready_reason,
            }
        )

    return {
        "total": len(servers),
        "enabled_count": len(enabled),
        "disabled_count": len(disabled),
        "enabled": [server.name for server in enabled],
        "disabled": [server.name for server in disabled],
        "ready_count": len(ready),
        "unready_count": len(unready),
        "ready": ready,
        "unready": unready,
        "effective": effective_rows,
    }, warnings


def resolve_mcp_runtime(paths: RuntimePaths) -> tuple[dict[str, Any], list[str]]:
    global_servers, global_warnings = load_mcp_servers_from_file(
        paths.global_mcp_registry,
        source_label=f"global:{paths.global_mcp_registry}",
    )
    project_servers, project_warnings = load_mcp_servers_from_file(
        paths.project_mcp_file,
        source_label=f"project:{paths.project_mcp_file}",
    )
    merged = merge_mcp_servers(global_servers, project_servers)
    summary, runtime_warnings = summarize_mcp_servers(merged, project_root=paths.project_root)
    summary["paths"] = {
        "global_registry": str(paths.global_mcp_registry),
        "project_override": str(paths.project_mcp_file),
    }
    return summary, [*global_warnings, *project_warnings, *runtime_warnings]


def first_platform(project: dict[str, Any]) -> str:
    platforms = project.get("platforms")
    if isinstance(platforms, list):
        for item in platforms:
            if isinstance(item, dict):
                platform_type = item.get("type")
                if isinstance(platform_type, str) and platform_type:
                    return platform_type
    return "feishu"


def find_project(
    config: dict[str, Any],
    project_name: str | None,
    *,
    config_hint: str = "config.toml",
) -> dict[str, Any]:
    projects = config.get("projects")
    if not isinstance(projects, list) or not projects:
        fail(f"No [[projects]] found in {config_hint}")

    if project_name is None:
        first = projects[0]
        if not isinstance(first, dict):
            fail("First project entry is invalid")
        return first

    for item in projects:
        if not isinstance(item, dict):
            continue
        if item.get("name") == project_name:
            return item
    fail(f'Project "{project_name}" not found in {config_hint}')
    return {}


def pick_provider(
    project: dict[str, Any],
    override_provider: str | None,
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
) -> ProviderConfig:
    agent = project.get("agent")
    provider_name = override_provider
    providers: list[dict[str, Any]] = []

    if isinstance(agent, dict):
        if provider_name is None and isinstance(agent.get("provider"), str):
            provider_name = agent["provider"]

        maybe_providers = agent.get("providers")
        if isinstance(maybe_providers, list):
            providers = [p for p in maybe_providers if isinstance(p, dict)]

    provider = None
    if providers:
        if provider_name:
            for item in providers:
                if item.get("name") == provider_name:
                    provider = item
                    break
            if provider is None:
                fail(f'Provider "{provider_name}" not found in [projects.agent.providers]')
        else:
            provider = providers[0]
    else:
        provider = {}

    name = str(provider.get("name") or provider_name or "default")
    api_key = override_api_key or str(provider.get("api_key") or os.getenv("GROBOT_API_KEY", ""))
    if not api_key:
        fail(
            "No API key provided. Set [projects.agent.providers].api_key in config.toml "
            "or export GROBOT_API_KEY."
        )

    base_url = override_base_url or str(provider.get("base_url") or DEFAULT_BASE_URL)
    model = override_model or str(provider.get("model") or DEFAULT_MODEL)

    return ProviderConfig(name=name, api_key=api_key, base_url=base_url.rstrip("/"), model=model)


def resolve_project(
    config: dict[str, Any],
    project_name: str | None,
    work_dir_override: str | None,
    override_provider: str | None,
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
    *,
    config_hint: str = "config.toml",
) -> ProjectSelection:
    project = find_project(config, project_name, config_hint=config_hint)
    project_real_name = str(project.get("name") or "default")

    work_dir = None
    agent = project.get("agent")
    if isinstance(agent, dict):
        options = agent.get("options")
        if isinstance(options, dict):
            candidate = options.get("work_dir")
            if isinstance(candidate, str) and candidate:
                work_dir = Path(candidate).expanduser()

    if work_dir_override:
        work_dir = Path(work_dir_override).expanduser()
    if work_dir is None:
        work_dir = Path.cwd()

    platform = first_platform(project)
    provider = pick_provider(
        project=project,
        override_provider=override_provider,
        override_api_key=override_api_key,
        override_base_url=override_base_url,
        override_model=override_model,
    )

    return ProjectSelection(
        name=project_real_name,
        work_dir=work_dir,
        platform=platform,
        provider=provider,
    )


def parse_provider_item(
    item: dict[str, Any],
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
) -> ProviderConfig | None:
    name = item.get("name")
    if not isinstance(name, str) or not name:
        return None

    api_key = override_api_key or str(item.get("api_key") or os.getenv("GROBOT_API_KEY", ""))
    if not api_key:
        return None

    base_url = override_base_url or str(item.get("base_url") or DEFAULT_BASE_URL)
    model = override_model or str(item.get("model") or DEFAULT_MODEL)
    return ProviderConfig(name=name, api_key=api_key, base_url=base_url.rstrip("/"), model=model)


def dedupe_providers(providers: list[ProviderConfig]) -> list[ProviderConfig]:
    seen: set[tuple[str, str]] = set()
    unique: list[ProviderConfig] = []
    for provider in providers:
        key = (provider.name.lower(), provider.base_url.lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(provider)
    return unique


def resolve_provider_pool(
    project: dict[str, Any],
    selected: ProviderConfig,
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
) -> list[ProviderConfig]:
    providers = [selected]
    agent = project.get("agent")
    if isinstance(agent, dict):
        maybe_providers = agent.get("providers")
        if isinstance(maybe_providers, list):
            for item in maybe_providers:
                if not isinstance(item, dict):
                    continue
                parsed = parse_provider_item(
                    item=item,
                    override_api_key=override_api_key,
                    override_base_url=override_base_url,
                    override_model=override_model,
                )
                if parsed is not None:
                    providers.append(parsed)
    providers = dedupe_providers(providers)
    if not providers:
        fail("No valid provider available for failover routing")
    return providers


def provider_matches_token(provider: ProviderConfig, token: str) -> bool:
    normalized = token.strip().lower()
    if not normalized:
        return False
    return (
        normalized in provider.name.lower()
        or normalized in provider.model.lower()
        or normalized in provider.base_url.lower()
    )


def default_group_target_order(project_toml: dict[str, Any]) -> list[str]:
    routing = project_toml.get("provider_routing")
    if not isinstance(routing, dict):
        return []

    default_group = routing.get("default_group")
    groups = routing.get("groups")
    if not isinstance(groups, list):
        return []

    chosen_group: dict[str, Any] | None = None
    if isinstance(default_group, str) and default_group:
        for group in groups:
            if isinstance(group, dict) and group.get("name") == default_group:
                chosen_group = group
                break
    if chosen_group is None:
        for group in groups:
            if isinstance(group, dict):
                chosen_group = group
                break
    if chosen_group is None:
        return []

    targets = chosen_group.get("targets")
    if not isinstance(targets, list):
        return []

    weighted_targets: list[tuple[str, int]] = []
    for target in targets:
        if not isinstance(target, dict):
            continue
        provider = target.get("provider")
        if not isinstance(provider, str) or not provider:
            continue
        weight = target.get("weight")
        weighted_targets.append((provider, weight if isinstance(weight, int) else 0))

    weighted_targets.sort(key=lambda item: item[1], reverse=True)
    return [name for name, _ in weighted_targets]


def fallback_tokens(project_toml: dict[str, Any]) -> list[str]:
    routing = project_toml.get("provider_routing")
    if not isinstance(routing, dict):
        return []
    raw = routing.get("fallback_order")
    if not isinstance(raw, list):
        return []
    return [token for token in raw if isinstance(token, str) and token.strip()]


def build_provider_failover_chain(
    *,
    project_toml: dict[str, Any],
    provider_pool: list[ProviderConfig],
    selected_provider: ProviderConfig,
    provider_forced: bool,
) -> list[ProviderConfig]:
    primary = selected_provider
    if not provider_forced:
        for target in default_group_target_order(project_toml):
            matched = next(
                (provider for provider in provider_pool if provider.name.lower() == target.lower()),
                None,
            )
            if matched is not None:
                primary = matched
                break

    remaining = [
        provider
        for provider in provider_pool
        if not (
            provider.name.lower() == primary.name.lower()
            and provider.base_url.lower() == primary.base_url.lower()
        )
    ]
    target_rank = {name.lower(): idx for idx, name in enumerate(default_group_target_order(project_toml))}
    tokens = fallback_tokens(project_toml)

    def rank(provider: ProviderConfig) -> tuple[int, int]:
        token_index = len(tokens) + 1
        for idx, token in enumerate(tokens):
            if provider_matches_token(provider, token):
                token_index = idx
                break
        group_index = target_rank.get(provider.name.lower(), len(target_rank) + 1)
        return token_index, group_index

    remaining.sort(key=rank)
    return [primary, *remaining]


def infer_session_ttl_secs(project_toml: dict[str, Any], override_ttl_secs: int | None) -> int:
    if isinstance(override_ttl_secs, int) and override_ttl_secs > 0:
        return override_ttl_secs

    session_cfg = project_toml.get("session")
    if isinstance(session_cfg, dict):
        ttl = session_cfg.get("resume_ttl_secs")
        if isinstance(ttl, int) and ttl > 0:
            return ttl
    return 1800


def resolve_session_store_config(
    *,
    project_toml: dict[str, Any],
    root: Path,
    session_root: Path | None = None,
    session_backend_arg: str,
    redis_url_arg: str | None,
    ttl_secs_arg: int | None,
) -> SessionStoreConfig:
    backend = session_backend_arg
    if backend == "auto":
        runtime_cfg = project_toml.get("runtime")
        hot_cache = None
        if isinstance(runtime_cfg, dict):
            storage_cfg = runtime_cfg.get("storage")
            if isinstance(storage_cfg, dict):
                hot_cache = storage_cfg.get("hot_cache")
        if isinstance(hot_cache, str) and hot_cache.lower() == "redis":
            backend = "redis"
        else:
            backend = "file"

    redis_url = redis_url_arg or os.getenv("GROBOT_REDIS_URL") or DEFAULT_REDIS_URL
    ttl_secs = infer_session_ttl_secs(project_toml, ttl_secs_arg)
    resolved_session_root = session_root if isinstance(session_root, Path) else (root / ".grobot" / "sessions")
    return SessionStoreConfig(
        backend=backend,
        redis_url=redis_url if backend == "redis" else None,
        ttl_secs=ttl_secs,
        root=resolved_session_root,
    )


def session_storage_key(session_key: str) -> str:
    return f"grobot:session:{session_key}"


def sanitize_session_key(session_key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", session_key)


def session_file_path(store: SessionStoreConfig, session_key: str) -> Path:
    return store.root / f"{sanitize_session_key(session_key)}.json"


def normalize_history_messages(raw_messages: Any) -> list[dict[str, str]]:
    if not isinstance(raw_messages, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in raw_messages:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if isinstance(role, str) and isinstance(content, str) and role in {"user", "assistant"} and content:
            normalized.append({"role": role, "content": content})
    return normalized


def read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_json_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def redis_parse_url(redis_url: str) -> tuple[str, int, str | None, str | None, int]:
    parsed = urlparse(redis_url)
    if parsed.scheme not in {"redis", "rediss"}:
        raise RuntimeError(f"Unsupported redis URL scheme: {parsed.scheme}")
    if parsed.scheme == "rediss":
        raise RuntimeError("rediss is not supported by built-in client yet")

    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 6379
    username = parsed.username
    password = parsed.password
    db = 0
    if parsed.path and parsed.path != "/":
        try:
            db = int(parsed.path.lstrip("/"))
        except ValueError as exc:
            raise RuntimeError(f"Invalid redis db index in URL: {parsed.path}") from exc
    return host, port, username, password, db


def redis_encode_command(parts: list[str]) -> bytes:
    out = [f"*{len(parts)}\r\n".encode("utf-8")]
    for part in parts:
        raw = part.encode("utf-8")
        out.append(f"${len(raw)}\r\n".encode("utf-8"))
        out.append(raw)
        out.append(b"\r\n")
    return b"".join(out)


def redis_read_exact(sock: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("Redis connection closed unexpectedly")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def redis_read_line(sock: socket.socket) -> str:
    chunks: list[bytes] = []
    while True:
        ch = sock.recv(1)
        if not ch:
            raise RuntimeError("Redis connection closed unexpectedly")
        chunks.append(ch)
        if len(chunks) >= 2 and chunks[-2] == b"\r" and chunks[-1] == b"\n":
            break
    return b"".join(chunks[:-2]).decode("utf-8", errors="replace")


def redis_read_reply(sock: socket.socket) -> Any:
    prefix = sock.recv(1)
    if not prefix:
        raise RuntimeError("Redis connection closed unexpectedly")

    if prefix == b"+":
        return redis_read_line(sock)
    if prefix == b"-":
        error_line = redis_read_line(sock)
        raise RuntimeError(f"Redis error: {error_line}")
    if prefix == b":":
        return int(redis_read_line(sock))
    if prefix == b"$":
        size = int(redis_read_line(sock))
        if size == -1:
            return None
        payload = redis_read_exact(sock, size)
        _ = redis_read_exact(sock, 2)
        return payload.decode("utf-8", errors="replace")
    if prefix == b"*":
        count = int(redis_read_line(sock))
        if count == -1:
            return None
        return [redis_read_reply(sock) for _ in range(count)]
    raise RuntimeError(f"Unknown Redis reply prefix: {prefix!r}")


def redis_execute(redis_url: str, parts: list[str]) -> Any:
    host, port, username, password, db = redis_parse_url(redis_url)
    with socket.create_connection((host, port), timeout=REDIS_TIMEOUT_SECS) as sock:
        sock.settimeout(REDIS_TIMEOUT_SECS)
        if password:
            auth_parts = ["AUTH"]
            if username:
                auth_parts.extend([username, password])
            else:
                auth_parts.append(password)
            sock.sendall(redis_encode_command(auth_parts))
            _ = redis_read_reply(sock)
        if db > 0:
            sock.sendall(redis_encode_command(["SELECT", str(db)]))
            _ = redis_read_reply(sock)
        sock.sendall(redis_encode_command(parts))
        return redis_read_reply(sock)


def redis_get_json(redis_url: str, key: str) -> dict[str, Any] | None:
    value = redis_execute(redis_url, ["GET", key])
    if value is None:
        return None
    if not isinstance(value, str):
        raise RuntimeError("Redis GET returned non-string payload")
    return json.loads(value)


def redis_set_json(redis_url: str, key: str, payload: dict[str, Any], ttl_secs: int) -> None:
    content = json.dumps(payload, ensure_ascii=False)
    _ = redis_execute(redis_url, ["SET", key, content, "EX", str(ttl_secs)])


def load_history_from_store(
    store: SessionStoreConfig,
    session_key: str,
    max_turns: int,
) -> tuple[list[dict[str, str]], str, list[str]]:
    warnings: list[str] = []
    file_path = session_file_path(store, session_key)

    if store.backend == "redis" and store.redis_url:
        try:
            payload = redis_get_json(store.redis_url, session_storage_key(session_key))
            if payload is not None:
                messages = normalize_history_messages(payload.get("messages"))
                compact_memory = normalize_compact_memory_payload(payload.get("compact_memory"))
                trimmed, _ = trim_history_messages_with_memory(
                    messages,
                    max_turns,
                    existing_memory=compact_memory,
                )
                return trimmed, "redis", warnings
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis read failed, fallback to file: {exc}")

    payload = read_json_file(file_path)
    if payload is not None:
        messages = normalize_history_messages(payload.get("messages"))
        compact_memory = normalize_compact_memory_payload(payload.get("compact_memory"))
        trimmed, _ = trim_history_messages_with_memory(
            messages,
            max_turns,
            existing_memory=compact_memory,
        )
        return trimmed, "file", warnings
    return [], "empty", warnings


def save_history_to_store(
    store: SessionStoreConfig,
    session_key: str,
    messages: list[dict[str, str]],
    max_turns: int,
) -> list[str]:
    warnings: list[str] = []
    trimmed_messages, compact_memory = trim_history_messages_with_memory(messages, max_turns)
    payload = {
        "version": 1,
        "updated_at": now_utc_iso(),
        "session_key": session_key,
        "messages": trimmed_messages,
    }
    if compact_memory is not None:
        payload["compact_memory"] = compact_memory

    if store.backend == "redis" and store.redis_url:
        try:
            redis_set_json(store.redis_url, session_storage_key(session_key), payload, store.ttl_secs)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis write failed, fallback to file only: {exc}")

    file_path = session_file_path(store, session_key)
    try:
        write_json_file(file_path, payload)
    except OSError as exc:
        warnings.append(f"file write failed: {exc}")
    return warnings


def interrupt_file_path(store: SessionStoreConfig) -> Path:
    return store.root / "interrupts.json"


def read_interrupt_map(store: SessionStoreConfig) -> dict[str, Any]:
    path = interrupt_file_path(store)
    payload = read_json_file(path)
    if not isinstance(payload, dict):
        return {"items": {}}
    items = payload.get("items")
    if not isinstance(items, dict):
        payload["items"] = {}
    return payload


def write_interrupt_map(store: SessionStoreConfig, payload: dict[str, Any]) -> None:
    write_json_file(interrupt_file_path(store), payload)


def cleanup_interrupt_map(payload: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    items = payload.get("items")
    if not isinstance(items, dict):
        payload["items"] = {}
        return payload
    keys = list(items.keys())
    for key in keys:
        item = items.get(key)
        if not isinstance(item, dict):
            items.pop(key, None)
            continue
        expires_at = item.get("expires_at")
        if isinstance(expires_at, (int, float)) and expires_at > 0 and float(expires_at) < now:
            items.pop(key, None)
    return payload


def interrupt_storage_key(session_key: str) -> str:
    return f"grobot:interrupt:{session_key}"


def set_interrupt_flag(store: SessionStoreConfig, session_key: str, ttl_secs: int) -> list[str]:
    warnings: list[str] = []
    if store.backend == "redis" and store.redis_url:
        try:
            _ = redis_execute(store.redis_url, ["SET", interrupt_storage_key(session_key), "1", "EX", str(ttl_secs)])
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis interrupt write failed, fallback to file: {exc}")

    try:
        payload = cleanup_interrupt_map(read_interrupt_map(store))
        items = payload.get("items")
        if not isinstance(items, dict):
            items = {}
            payload["items"] = items
        items[session_key] = {
            "requested_at": now_utc_iso(),
            "expires_at": time.time() + float(ttl_secs),
        }
        write_interrupt_map(store, payload)
    except OSError as exc:
        warnings.append(f"interrupt file write failed: {exc}")
    return warnings


def interrupt_flag_exists(store: SessionStoreConfig, session_key: str) -> tuple[bool, list[str]]:
    warnings: list[str] = []
    if store.backend == "redis" and store.redis_url:
        try:
            value = redis_execute(store.redis_url, ["GET", interrupt_storage_key(session_key)])
            if isinstance(value, str) and value:
                return True, warnings
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis interrupt read failed, fallback to file: {exc}")

    try:
        payload = cleanup_interrupt_map(read_interrupt_map(store))
        items = payload.get("items")
        if not isinstance(items, dict):
            return False, warnings
        return session_key in items, warnings
    except OSError as exc:
        warnings.append(f"interrupt file read failed: {exc}")
    return False, warnings


def clear_interrupt_flag(store: SessionStoreConfig, session_key: str) -> list[str]:
    warnings: list[str] = []
    if store.backend == "redis" and store.redis_url:
        try:
            _ = redis_execute(store.redis_url, ["DEL", interrupt_storage_key(session_key)])
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis interrupt clear failed, fallback to file: {exc}")

    try:
        payload = cleanup_interrupt_map(read_interrupt_map(store))
        items = payload.get("items")
        if isinstance(items, dict):
            items.pop(session_key, None)
        write_interrupt_map(store, payload)
    except OSError as exc:
        warnings.append(f"interrupt file clear failed: {exc}")
    return warnings


def consume_interrupt_flag(store: SessionStoreConfig, session_key: str) -> tuple[bool, list[str]]:
    requested, warnings = interrupt_flag_exists(store, session_key)
    if not requested:
        return False, warnings
    warnings.extend(clear_interrupt_flag(store, session_key))
    return True, warnings


def mask_sensitive_object(payload: Any) -> Any:
    sensitive_tokens = ("api_key", "secret", "token", "password")
    if isinstance(payload, dict):
        masked: dict[str, Any] = {}
        for key, value in payload.items():
            lower_key = key.lower()
            if any(token in lower_key for token in sensitive_tokens):
                if isinstance(value, str):
                    masked[key] = mask_secret(value)
                else:
                    masked[key] = "<redacted>"
                continue
            masked[key] = mask_sensitive_object(value)
        return masked
    if isinstance(payload, list):
        return [mask_sensitive_object(item) for item in payload]
    return payload


def route_identity(route: ProviderRoute) -> str:
    return f"{route.provider.name}|{route.provider.base_url}|{route.model}"


def route_display_name(route: ProviderRoute) -> str:
    return f"{route.provider.name}/{route.model}"


def probe_provider_health(provider: ProviderConfig) -> tuple[bool, str]:
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Accept": "application/json",
    }
    try:
        _ = http_json_or_raise("GET", f"{provider.base_url}/models", headers, None)
        return True, "ok"
    except RuntimeError as exc:
        return False, str(exc)


def circuit_get(route: ProviderRoute) -> dict[str, float]:
    key = route_identity(route)
    current = CIRCUIT_STATE.get(key)
    if current is None:
        current = {"failures": 0.0, "open_until": 0.0}
        CIRCUIT_STATE[key] = current
    return current


def circuit_mark_success(route: ProviderRoute) -> None:
    state = circuit_get(route)
    state["failures"] = 0.0
    state["open_until"] = 0.0


def circuit_mark_failure(route: ProviderRoute, policy: CircuitPolicy) -> bool:
    state = circuit_get(route)
    failures = int(state.get("failures", 0)) + 1
    state["failures"] = float(failures)
    if failures >= policy.failure_threshold:
        state["open_until"] = time.time() + float(policy.cooldown_secs)
        state["failures"] = 0.0
        return True
    return False


def circuit_is_open(route: ProviderRoute) -> tuple[bool, float]:
    state = circuit_get(route)
    open_until = float(state.get("open_until", 0.0))
    return time.time() < open_until, open_until


def format_circuit_health(routes: list[ProviderRoute]) -> list[str]:
    lines: list[str] = []
    now = time.time()
    for route in routes:
        state = circuit_get(route)
        open_until = float(state.get("open_until", 0.0))
        failures = int(state.get("failures", 0.0))
        if open_until > now:
            lines.append(
                f"  {route_display_name(route)}: OPEN ({int(open_until - now)}s left)"
            )
        elif open_until > 0:
            lines.append(f"  {route_display_name(route)}: HALF_OPEN (ready for probe)")
        else:
            lines.append(f"  {route_display_name(route)}: CLOSED (failures={failures})")
    return lines


def safe_subject_from_path(path: Path) -> str:
    raw = path.name or "workspace"
    sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", raw)
    return sanitized[:80] or "workspace"


def build_session_key(project_name: str, platform: str, work_dir: Path) -> str:
    tenant = re.sub(r"[^a-zA-Z0-9._-]", "_", project_name)[:40] or "default"
    subject = safe_subject_from_path(work_dir)
    return f"{platform}:{tenant}:dm:{subject}"


def http_json_or_raise(
    method: str,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None,
    *,
    timeout_secs: int | None = None,
) -> dict[str, Any]:
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(url=url, data=data, method=method, headers=headers)
    timeout = RESPONSE_TIMEOUT_SECS
    if isinstance(timeout_secs, int) and timeout_secs > 0:
        timeout = timeout_secs
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from model API: {body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error when calling model API: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Model API returned invalid JSON: {exc}") from exc
    return {}


def http_json(method: str, url: str, headers: dict[str, str], payload: dict[str, Any] | None) -> dict[str, Any]:
    try:
        return http_json_or_raise(method, url, headers, payload)
    except RuntimeError as exc:
        fail(str(exc))
    return {}


def resolve_model_or_raise(provider: ProviderConfig) -> str:
    if provider.model and provider.model != "auto":
        return provider.model

    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Accept": "application/json",
    }
    result = http_json_or_raise("GET", f"{provider.base_url}/models", headers, None)
    data = result.get("data")
    if isinstance(data, list):
        model_ids: list[str] = []
        for item in data:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                model_ids.append(item["id"])

        preferred = [m for m in model_ids if "kimi" in m.lower() or "moonshot" in m.lower()]
        if preferred:
            return preferred[0]
        if model_ids:
            return model_ids[0]

    raise RuntimeError("Could not auto-resolve model from /models. Please set provider.model explicitly.")


def resolve_model(provider: ProviderConfig) -> str:
    try:
        return resolve_model_or_raise(provider)
    except RuntimeError as exc:
        fail(str(exc))
    return ""


def extract_text_from_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                chunks.append(item["text"])
        return "\n".join(chunks).strip()
    return ""


def tokenize_skill_text(raw_text: str) -> set[str]:
    if not isinstance(raw_text, str):
        return set()
    lowered = raw_text.lower()
    tokens = {item for item in SKILL_ROUTER_TOKEN_PATTERN.findall(lowered) if item}
    for chunk in re.findall(r"[\u4e00-\u9fff]{2,}", lowered):
        chunk_len = len(chunk)
        for width in (2, 3, 4):
            if chunk_len < width:
                continue
            for idx in range(0, chunk_len - width + 1):
                tokens.add(chunk[idx : idx + width])
    return tokens


def normalize_descriptor_items(raw_value: Any) -> tuple[str, ...]:
    if isinstance(raw_value, str):
        values: list[str] = []
        for chunk in re.split(r"[;\n；]", raw_value):
            for piece in re.split(r"[，,、]", chunk):
                item = piece.strip()
                if item:
                    values.append(item)
        return tuple(values)
    if isinstance(raw_value, list):
        values = []
        for item in raw_value:
            if isinstance(item, str):
                stripped = item.strip()
                if stripped:
                    values.append(stripped)
        return tuple(values)
    return ()


def parse_skill_markdown_descriptor(
    markdown_text: str,
    *,
    max_scan_lines: int = SKILL_DESCRIPTOR_MAX_SCAN_LINES,
) -> dict[str, Any]:
    lines = markdown_text.splitlines()
    max_lines = min(len(lines), max(1, max_scan_lines))
    description = ""
    use_when: list[str] = []
    dont_use_when: list[str] = []
    output = ""
    rate_limit = None
    side_effect: bool | None = None

    heading_map = {
        "use when": "use",
        "when to use": "use",
        "适用场景": "use",
        "何时使用": "use",
        "don't use when": "dont",
        "do not use when": "dont",
        "avoid when": "dont",
        "不适用": "dont",
        "何时不要使用": "dont",
        "output": "output",
        "产出物": "output",
        "输出": "output",
        "rate limit": "rate",
        "限流": "rate",
        "side effect": "side",
        "副作用": "side",
    }

    idx = 0
    while idx < max_lines:
        raw_line = lines[idx]
        line = raw_line.strip()
        if not line:
            idx += 1
            continue

        lowered = line.lower()
        if not description and not line.startswith("#") and not line.startswith(("-", "*", "+")):
            if not re.match(r"^\d+\.\s+", line):
                description = line

        inline_match = re.match(
            r"^\s*(use when|when to use|适用场景|何时使用|don't use when|do not use when|avoid when|不适用|何时不要使用|output|产出物|输出|rate limit|限流|side effect|副作用)\s*[:：]\s*(.+)\s*$",
            line,
            flags=re.IGNORECASE,
        )
        if inline_match:
            key = heading_map.get(inline_match.group(1).strip().lower())
            content = inline_match.group(2).strip()
            if key == "use":
                use_when.extend(normalize_descriptor_items(content))
            elif key == "dont":
                dont_use_when.extend(normalize_descriptor_items(content))
            elif key == "output":
                output = output or content[:SKILL_DESCRIPTOR_MAX_OUTPUT_LEN]
            elif key == "rate":
                rate_limit = content[:SKILL_DESCRIPTOR_MAX_OUTPUT_LEN]
            elif key == "side":
                lowered_side = content.lower()
                side_effect = lowered_side in {"true", "yes", "on", "1", "enabled"}
            idx += 1
            continue

        if line.startswith("#"):
            heading_name = line.lstrip("#").strip().lower()
            section_key = heading_map.get(heading_name)
            if section_key is None:
                idx += 1
                continue
            section_items: list[str] = []
            idx += 1
            while idx < max_lines:
                child = lines[idx].strip()
                if child.startswith("#"):
                    break
                if child.startswith(("-", "*", "+")):
                    child_value = child[1:].strip()
                    if child_value:
                        section_items.extend(normalize_descriptor_items(child_value))
                elif re.match(r"^\d+\.\s+", child):
                    child_value = re.sub(r"^\d+\.\s+", "", child).strip()
                    if child_value:
                        section_items.extend(normalize_descriptor_items(child_value))
                elif child and section_key in {"output", "rate"}:
                    section_items.append(child)
                idx += 1

            if section_key == "use":
                use_when.extend(section_items)
            elif section_key == "dont":
                dont_use_when.extend(section_items)
            elif section_key == "output" and section_items:
                output = output or section_items[0][:SKILL_DESCRIPTOR_MAX_OUTPUT_LEN]
            elif section_key == "rate" and section_items:
                rate_limit = section_items[0][:SKILL_DESCRIPTOR_MAX_OUTPUT_LEN]
            elif section_key == "side" and section_items:
                lowered_side = section_items[0].lower()
                side_effect = lowered_side in {"true", "yes", "on", "1", "enabled"}
            continue

        idx += 1

    return {
        "description": description,
        "use_when": tuple(use_when),
        "dont_use_when": tuple(dont_use_when),
        "output": output,
        "rate_limit": rate_limit,
        "side_effect": side_effect,
    }


def load_skill_metadata(skill_dir: Path) -> dict[str, Any]:
    metadata_file = skill_dir / SKILL_METADATA_FILENAME
    if not metadata_file.exists() or not metadata_file.is_file():
        return {}
    payload, _ = load_toml_optional(metadata_file)
    if isinstance(payload, dict):
        return payload
    return {}


def build_skill_keywords(
    *,
    name: str,
    description: str,
    use_when: tuple[str, ...],
    dont_use_when: tuple[str, ...],
    output: str,
) -> tuple[str, ...]:
    keywords: list[str] = []
    seen: set[str] = set()
    sources = [name, description, output, *use_when, *dont_use_when]
    for source in sources:
        for token in tokenize_skill_text(source):
            if token in seen:
                continue
            seen.add(token)
            keywords.append(token)
            if len(keywords) >= 80:
                return tuple(keywords)
    return tuple(keywords)


def infer_skill_side_effect(
    *,
    explicit_side_effect: bool | None,
    name: str,
    description: str,
    use_when: tuple[str, ...],
    output: str,
) -> bool:
    if isinstance(explicit_side_effect, bool):
        return explicit_side_effect
    text = " ".join([name, description, output, *use_when]).lower()
    return any(keyword in text for keyword in SKILL_SIDE_EFFECT_KEYWORDS)


def discover_skill_descriptors(
    global_skills_dir: Path,
    project_skills_dir: Path,
    *,
    max_descriptors: int = SKILL_DESCRIPTOR_MAX_ITEMS,
    descriptor_scan_lines: int = SKILL_DESCRIPTOR_MAX_SCAN_LINES,
) -> tuple[SkillDescriptor, ...]:
    descriptors: list[SkillDescriptor] = []
    scopes: tuple[tuple[str, Path], ...] = (
        ("global", global_skills_dir),
        ("project", project_skills_dir),
    )
    for scope, scope_root in scopes:
        if not scope_root.exists():
            continue
        skill_files = sorted(scope_root.rglob("SKILL.md"), key=lambda item: item.as_posix().lower())
        for skill_file in skill_files:
            if not skill_file.is_file():
                continue
            if len(descriptors) >= max(1, max_descriptors):
                return tuple(descriptors)
            try:
                markdown = skill_file.read_text(encoding="utf-8")
            except OSError:
                continue
            parsed = parse_skill_markdown_descriptor(markdown, max_scan_lines=descriptor_scan_lines)
            metadata = load_skill_metadata(skill_file.parent)
            name = skill_file.parent.name.strip() or skill_file.stem
            description = (
                str(metadata.get("description", "")).strip()
                if isinstance(metadata.get("description"), str)
                else str(parsed.get("description", "")).strip()
            )
            use_when = normalize_descriptor_items(metadata.get("use_when")) or tuple(parsed.get("use_when", ()))
            dont_use_when = normalize_descriptor_items(metadata.get("dont_use_when")) or tuple(parsed.get("dont_use_when", ()))
            output = (
                str(metadata.get("output", "")).strip()[:SKILL_DESCRIPTOR_MAX_OUTPUT_LEN]
                if isinstance(metadata.get("output"), str)
                else str(parsed.get("output", "")).strip()[:SKILL_DESCRIPTOR_MAX_OUTPUT_LEN]
            )
            rate_limit = None
            raw_rate_limit = metadata.get("rate_limit", parsed.get("rate_limit"))
            if isinstance(raw_rate_limit, str):
                stripped_rate_limit = raw_rate_limit.strip()
                if stripped_rate_limit:
                    rate_limit = stripped_rate_limit[:SKILL_DESCRIPTOR_MAX_OUTPUT_LEN]
            side_effect = infer_skill_side_effect(
                explicit_side_effect=metadata.get("side_effect", parsed.get("side_effect")),
                name=name,
                description=description,
                use_when=use_when,
                output=output,
            )
            keywords = build_skill_keywords(
                name=name,
                description=description,
                use_when=use_when,
                dont_use_when=dont_use_when,
                output=output,
            )
            specificity = float(len(use_when) + (len(dont_use_when) * 1.5) + (1 if output else 0))
            descriptors.append(
                SkillDescriptor(
                    name=name,
                    scope=scope,
                    source=f"{scope}:{skill_file}",
                    skill_file=skill_file,
                    description=description,
                    use_when=use_when,
                    dont_use_when=dont_use_when,
                    output=output,
                    side_effect=side_effect,
                    rate_limit=rate_limit,
                    keywords=keywords,
                    specificity=specificity,
                )
            )
    return tuple(descriptors)


def route_skill_for_prompt(
    user_prompt: str,
    descriptors: tuple[SkillDescriptor, ...],
    *,
    score_threshold: float = SKILL_ROUTER_SCORE_THRESHOLD,
    min_score_gap: float = SKILL_ROUTER_MIN_SCORE_GAP,
) -> SkillRoutingResult | None:
    if not descriptors or not isinstance(user_prompt, str) or not user_prompt.strip():
        return None
    prompt_text = user_prompt.strip()
    prompt_lower = prompt_text.lower()
    prompt_tokens = tokenize_skill_text(prompt_text)
    scored_items: list[SkillRoutingResult] = []
    for descriptor in descriptors:
        positive_hits: list[str] = []
        negative_hits: list[str] = []
        positive_score = 0.0
        negative_score = 0.0

        for phrase in descriptor.use_when:
            phrase_norm = phrase.strip().lower()
            if not phrase_norm:
                continue
            if phrase_norm in prompt_lower:
                positive_score += 4.0
                positive_hits.append(f"use:{phrase}")
                continue
            overlap = len(prompt_tokens.intersection(tokenize_skill_text(phrase_norm)))
            if overlap > 0:
                positive_score += min(2.4, overlap * 0.8)
                positive_hits.append(f"use~{phrase}")

        keyword_overlap = len(prompt_tokens.intersection(set(descriptor.keywords)))
        if keyword_overlap > 0:
            positive_score += min(3.0, keyword_overlap * 0.45)

        for phrase in descriptor.dont_use_when:
            phrase_norm = phrase.strip().lower()
            if not phrase_norm:
                continue
            if phrase_norm in prompt_lower:
                if phrase_in_negated_context(prompt_lower, phrase_norm):
                    positive_score += 0.6
                    positive_hits.append(f"avoid-negated:{phrase}")
                    continue
                negative_score += 8.0
                negative_hits.append(f"avoid:{phrase}")
                continue
            overlap = len(prompt_tokens.intersection(tokenize_skill_text(phrase_norm)))
            if overlap >= 2:
                negative_score += 4.5
                negative_hits.append(f"avoid~{phrase}")

        if descriptor.side_effect and any(token in prompt_lower for token in ("只读", "read-only", "不要修改", "不要执行")):
            negative_score += 3.0
            negative_hits.append("avoid:side_effect_for_readonly")

        score = positive_score - negative_score + (descriptor.specificity * 0.05)
        if score < score_threshold:
            continue
        reason_parts: list[str] = []
        if positive_hits:
            reason_parts.append(f"matched={','.join(positive_hits[:3])}")
        if negative_hits:
            reason_parts.append(f"penalty={','.join(negative_hits[:2])}")
        if not reason_parts:
            reason_parts.append("matched=keyword-overlap")
        scored_items.append(
            SkillRoutingResult(
                descriptor=descriptor,
                score=score,
                positive_hits=tuple(positive_hits),
                negative_hits=tuple(negative_hits),
                reason="; ".join(reason_parts),
            )
        )

    if not scored_items:
        return None
    scored_items.sort(
        key=lambda item: (
            item.score,
            item.descriptor.specificity,
            item.descriptor.scope == "project",
            item.descriptor.name.lower(),
        ),
        reverse=True,
    )
    top = scored_items[0]
    if len(scored_items) == 1:
        return top
    second = scored_items[1]
    if abs(top.score - second.score) > min_score_gap:
        return top

    close_candidates = [item for item in scored_items if abs(top.score - item.score) <= min_score_gap]
    close_candidates.sort(
        key=lambda item: (
            item.descriptor.specificity,
            item.score,
            item.descriptor.scope == "project",
        ),
        reverse=True,
    )
    return close_candidates[0]


def phrase_in_negated_context(prompt_lower: str, phrase_lower: str) -> bool:
    if not phrase_lower or phrase_lower not in prompt_lower:
        return False
    negated_markers = (
        f"不要{phrase_lower}",
        f"别{phrase_lower}",
        f"避免{phrase_lower}",
        f"not {phrase_lower}",
        f"don't {phrase_lower}",
        f"do not {phrase_lower}",
        f"avoid {phrase_lower}",
    )
    return any(marker in prompt_lower for marker in negated_markers)


def build_skill_prompt_block(
    routing: SkillRoutingResult,
    *,
    max_block_chars: int = SKILL_ROUTER_MAX_BLOCK_CHARS,
) -> tuple[str, bool]:
    descriptor = routing.descriptor
    try:
        raw_skill = descriptor.skill_file.read_text(encoding="utf-8")
    except OSError as exc:
        fallback = textwrap.dedent(
            f"""
            [Activated Skill]
            name: {descriptor.name}
            scope: {descriptor.scope}
            source: {descriptor.source}
            reason: {routing.reason}
            note: SKILL.md load failed ({exc}). Continue with descriptor only.
            """
        ).strip()
        return fallback, False

    was_truncated = False
    skill_content = raw_skill
    if len(skill_content) > max(500, max_block_chars):
        skill_content = skill_content[: max(500, max_block_chars)].rstrip() + "\n\n[truncated]"
        was_truncated = True

    lines = [
        "[Activated Skill]",
        f"name: {descriptor.name}",
        f"scope: {descriptor.scope}",
        f"source: {descriptor.source}",
        f"score: {routing.score:.2f}",
        f"reason: {routing.reason}",
        "policy: Runtime scanned all skill descriptors this turn and loaded only this one skill.",
    ]
    if descriptor.output:
        lines.append(f"expected_output: {descriptor.output}")
    if descriptor.side_effect:
        lines.append("side_effect: true")
        if descriptor.rate_limit:
            lines.append(f"rate_limit: {descriptor.rate_limit}")
        else:
            lines.append(
                "rate_limit: batch writes, avoid per-item loops, and backoff/retry on HTTP 429."
            )
    else:
        lines.append("side_effect: false")
    lines.extend(
        [
            "",
            "[Skill Content]",
            skill_content.strip(),
        ]
    )
    return "\n".join(lines).strip(), was_truncated


def resolve_skill_runtime(
    user_prompt: str,
    descriptors: tuple[SkillDescriptor, ...],
    router_config: SkillRouterConfig | None = None,
) -> SkillRuntimeResolution:
    cfg = router_config or SkillRouterConfig(
        enabled=True,
        descriptor_scan_lines=SKILL_DESCRIPTOR_MAX_SCAN_LINES,
        max_descriptors=SKILL_DESCRIPTOR_MAX_ITEMS,
        score_threshold=SKILL_ROUTER_SCORE_THRESHOLD,
        min_score_gap=SKILL_ROUTER_MIN_SCORE_GAP,
        max_skill_block_chars=SKILL_ROUTER_MAX_BLOCK_CHARS,
        observability_enabled=SKILL_ROUTER_OBSERVABILITY_ENABLED,
        observability_path=None,
    )
    if not cfg.enabled:
        return SkillRuntimeResolution(
            block="",
            status="[skills] selected=none (router disabled)",
            routing=None,
            truncated=False,
        )
    routing = route_skill_for_prompt(
        user_prompt,
        descriptors,
        score_threshold=cfg.score_threshold,
        min_score_gap=cfg.min_score_gap,
    )
    if routing is None:
        return SkillRuntimeResolution(
            block="",
            status="[skills] selected=none",
            routing=None,
            truncated=False,
        )
    block, truncated = build_skill_prompt_block(
        routing,
        max_block_chars=cfg.max_skill_block_chars,
    )
    suffix = " truncated=true" if truncated else ""
    status = (
        f"[skills] selected={routing.descriptor.name} scope={routing.descriptor.scope} "
        f"score={routing.score:.2f}{suffix}"
    )
    return SkillRuntimeResolution(
        block=block,
        status=status,
        routing=routing,
        truncated=truncated,
    )


def resolve_skill_runtime_block(
    user_prompt: str,
    descriptors: tuple[SkillDescriptor, ...],
    router_config: SkillRouterConfig | None = None,
) -> tuple[str, str]:
    resolved = resolve_skill_runtime(user_prompt, descriptors, router_config)
    return resolved.block, resolved.status


def summarize_skill_prompt_preview(prompt: str, limit: int = SKILL_ROUTER_OBSERVABILITY_PROMPT_PREVIEW_CHARS) -> str:
    if not isinstance(prompt, str):
        return ""
    compact = " ".join(prompt.split())
    if len(compact) <= max(1, limit):
        return compact
    return compact[: max(1, limit)].rstrip() + "…"


def resolve_skill_observability_path(
    raw_path: str | None,
    *,
    runtime_paths: RuntimePaths,
) -> Path:
    if isinstance(raw_path, str) and raw_path.strip():
        candidate = Path(raw_path.strip()).expanduser()
        if not candidate.is_absolute():
            candidate = runtime_paths.project_root / candidate
        return candidate.resolve()
    return (runtime_paths.runtime_dir / SKILL_ROUTER_OBSERVABILITY_DEFAULT_FILE).resolve()


def append_skill_router_event(
    *,
    runtime_paths: RuntimePaths,
    router_config: SkillRouterConfig,
    session_key: str,
    project_name: str,
    turn_mode: str,
    user_prompt: str,
    effective_prompt: str,
    descriptors: tuple[SkillDescriptor, ...],
    resolution: SkillRuntimeResolution,
    event_path: Path | None = None,
) -> str | None:
    if not router_config.observability_enabled:
        return None

    output_path = event_path or resolve_skill_observability_path(
        router_config.observability_path,
        runtime_paths=runtime_paths,
    )
    scope_counts = {
        "project": sum(1 for item in descriptors if item.scope == "project"),
        "global": sum(1 for item in descriptors if item.scope == "global"),
    }
    selection: dict[str, Any] | None = None
    if resolution.routing is not None:
        selection = {
            "name": resolution.routing.descriptor.name,
            "scope": resolution.routing.descriptor.scope,
            "score": round(resolution.routing.score, 4),
            "reason": resolution.routing.reason,
            "positive_hits": list(resolution.routing.positive_hits[:SKILL_ROUTER_OBSERVABILITY_HIT_PREVIEW_ITEMS]),
            "negative_hits": list(resolution.routing.negative_hits[:SKILL_ROUTER_OBSERVABILITY_HIT_PREVIEW_ITEMS]),
            "truncated": resolution.truncated,
        }

    payload: dict[str, Any] = {
        "timestamp": now_utc_iso(),
        "event": "skill_router_turn",
        "project": project_name,
        "session_key": session_key,
        "turn_mode": turn_mode,
        "status": resolution.status,
        "prompt_preview": summarize_skill_prompt_preview(user_prompt),
        "effective_prompt_preview": summarize_skill_prompt_preview(effective_prompt),
        "descriptor_count": len(descriptors),
        "descriptor_scope_counts": scope_counts,
        "router": {
            "enabled": router_config.enabled,
            "score_threshold": router_config.score_threshold,
            "min_score_gap": router_config.min_score_gap,
            "max_descriptors": router_config.max_descriptors,
            "descriptor_scan_lines": router_config.descriptor_scan_lines,
            "max_skill_block_chars": router_config.max_skill_block_chars,
            "observability_enabled": router_config.observability_enabled,
            "observability_path": str(output_path),
        },
        "selection": selection,
    }
    try:
        append_jsonl_file(output_path, payload)
        return None
    except OSError as exc:
        return str(exc)


def build_system_prompt(session_key: str, work_dir: Path) -> str:
    return textwrap.dedent(
        f"""
        You are Grobot, an engineering coding assistant.
        Session key: {session_key}
        Working directory: {work_dir}
        Available local tools: list, glob, search, read, write, edit, bash, mcp_servers, mcp_call.
        Skill policy: runtime scans available skill descriptors each turn and may inject at most one activated skill.
        Use tools when needed, then summarize concise actionable results.
        Keep replies concise and actionable.
        """
    ).strip()


def call_model_with_messages_or_raise(
    provider: ProviderConfig,
    model: str,
    messages: list[dict[str, str]],
    tool_context: LocalToolContext,
) -> str:
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    def request_once(message_list: list[dict[str, Any]], enable_tools: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": model,
            "messages": message_list,
            "temperature": 0.2,
        }
        if enable_tools:
            payload["tools"] = build_model_tools()
            payload["tool_choice"] = "auto"
        return http_json_or_raise("POST", f"{provider.base_url}/chat/completions", headers, payload)

    def parse_choice(result: dict[str, Any]) -> dict[str, Any]:
        choices = result.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("Model API returned no choices")
        first = choices[0]
        if not isinstance(first, dict):
            raise RuntimeError("Model API returned malformed choice")
        message = first.get("message")
        if not isinstance(message, dict):
            raise RuntimeError("Model API returned malformed message")
        return message

    conversation: list[dict[str, Any]] = [dict(item) for item in messages]
    max_tool_rounds = 8
    tools_enabled = True

    for _ in range(max_tool_rounds):
        try:
            result = request_once(conversation, tools_enabled)
        except RuntimeError as exc:
            if tools_enabled and model_likely_rejects_tools(str(exc)):
                tools_enabled = False
                continue
            raise

        message = parse_choice(result)
        content = extract_text_from_message_content(message.get("content"))
        tool_calls = message.get("tool_calls")

        if (
            tools_enabled
            and isinstance(tool_calls, list)
            and tool_calls
        ):
            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": content or "",
                "tool_calls": tool_calls,
            }
            conversation.append(assistant_message)
            for call in tool_calls:
                call_id = call.get("id") if isinstance(call, dict) else None
                fn = call.get("function") if isinstance(call, dict) else None
                tool_name = fn.get("name") if isinstance(fn, dict) else None
                raw_args = fn.get("arguments") if isinstance(fn, dict) else None
                if not isinstance(call_id, str) or not call_id:
                    continue
                if not isinstance(tool_name, str) or not tool_name:
                    tool_payload: dict[str, Any] = {
                        "ok": False,
                        "error": "missing tool function name",
                    }
                else:
                    parsed_args: dict[str, Any] | None = None
                    try:
                        parsed_args = parse_tool_arguments(raw_args)
                        run_hook_event(
                            LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
                            {
                                "event": LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
                                "tool": tool_name,
                                "tool_call_id": call_id,
                                "arguments": parsed_args,
                                "timestamp": now_utc_iso(),
                            },
                            tool_context,
                        )
                        tool_result = execute_local_tool(tool_name, parsed_args, tool_context)
                        run_hook_event(
                            LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
                            {
                                "event": LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
                                "tool": tool_name,
                                "tool_call_id": call_id,
                                "arguments": parsed_args,
                                "ok": True,
                                "result": tool_result,
                                "timestamp": now_utc_iso(),
                            },
                            tool_context,
                        )
                        tool_payload = {
                            "ok": True,
                            "tool": tool_name,
                            "result": tool_result,
                        }
                    except RuntimeError as exc:
                        run_hook_event(
                            LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
                            {
                                "event": LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
                                "tool": tool_name,
                                "tool_call_id": call_id,
                                "arguments": parsed_args if isinstance(parsed_args, dict) else {},
                                "ok": False,
                                "error": str(exc),
                                "timestamp": now_utc_iso(),
                            },
                            tool_context,
                        )
                        tool_payload = {
                            "ok": False,
                            "tool": tool_name,
                            "error": str(exc),
                        }
                conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": json.dumps(tool_payload, ensure_ascii=False),
                    }
                )
            continue

        if content:
            return content
        raise RuntimeError("Model API returned empty content")

    raise RuntimeError("Model API exceeded max tool rounds without final answer")


def compact_section_token(section: str) -> str:
    return f"[{section}]"


def compact_append_unique(
    sections: dict[str, list[str]],
    seen: dict[str, set[str]],
    section: str,
    value: str,
) -> None:
    item = value.strip()
    if not item:
        return
    if item in seen[section]:
        return
    seen[section].add(item)
    sections[section].append(item)


def normalize_compact_sections(raw_sections: Any) -> dict[str, list[str]] | None:
    if not isinstance(raw_sections, dict):
        return None
    sections = {section: [] for section in HISTORY_COMPACT_SECTIONS}
    seen = {section: set() for section in HISTORY_COMPACT_SECTIONS}
    for section in HISTORY_COMPACT_SECTIONS:
        values = raw_sections.get(section)
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str):
                compact_append_unique(sections, seen, section, value)
    return sections


def compact_apply_section_limits(sections: dict[str, list[str]]) -> dict[str, list[str]]:
    for section, limit in HISTORY_COMPACT_SECTION_LIMITS.items():
        if isinstance(limit, int) and limit > 0 and len(sections[section]) > limit:
            sections[section] = sections[section][:limit]
    return sections


def render_compact_snapshot_content_from_sections(sections: dict[str, list[str]]) -> str:
    lines = [HISTORY_COMPACT_HEADER]
    for section in HISTORY_COMPACT_SECTIONS:
        lines.append("")
        lines.append(compact_section_token(section))
        values = sections.get(section, [])
        if not values:
            lines.append("- none")
            continue
        for value in values:
            lines.append(f"- {value}")
    return "\n".join(lines)


def build_compact_memory_payload(
    sections: dict[str, list[str]],
    source_messages: int,
) -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": now_utc_iso(),
        "source_messages": max(0, source_messages),
        "sections": sections,
    }


def normalize_compact_memory_payload(raw_payload: Any) -> dict[str, Any] | None:
    if not isinstance(raw_payload, dict):
        return None
    sections = normalize_compact_sections(raw_payload.get("sections"))
    if sections is None:
        return None
    compact_apply_section_limits(sections)
    source_messages_raw = raw_payload.get("source_messages")
    source_messages = source_messages_raw if isinstance(source_messages_raw, int) else 0
    return build_compact_memory_payload(sections, source_messages)


def parse_compact_snapshot_sections(content: str) -> dict[str, list[str]] | None:
    if not content.startswith(HISTORY_COMPACT_HEADER):
        return None
    sections = {section: [] for section in HISTORY_COMPACT_SECTIONS}
    seen = {section: set() for section in HISTORY_COMPACT_SECTIONS}
    current_section: str | None = None
    section_lookup = {
        compact_section_token(section): section
        for section in HISTORY_COMPACT_SECTIONS
    }
    for raw_line in content.splitlines()[1:]:
        line = raw_line.strip()
        if not line:
            continue
        matched = section_lookup.get(line)
        if matched is not None:
            current_section = matched
            continue
        if current_section is None or not line.startswith("- "):
            continue
        item = line[2:].strip()
        if not item or item.lower() == "none":
            continue
        compact_append_unique(sections, seen, current_section, item)
    return sections


def compact_memory_sections_from_message(message: dict[str, str]) -> dict[str, list[str]] | None:
    content = message.get("content")
    if not isinstance(content, str) or not content:
        return None
    return parse_compact_snapshot_sections(content)


def line_contains_any_keyword(line_lower: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in line_lower for keyword in keywords)


def compact_status_from_line(line_lower: str) -> str | None:
    if line_contains_any_keyword(line_lower, HISTORY_STATUS_FAIL_MARKERS):
        return "FAIL"
    if line_contains_any_keyword(line_lower, HISTORY_STATUS_PASS_MARKERS):
        return "PASS"
    return None


def compact_format_tool_status(line: str) -> str | None:
    line_lower = line.lower()
    status = compact_status_from_line(line_lower)
    if status is None:
        return None
    cleaned = re.sub(r"^\$+\s*", "", line.strip())
    return f"{status}: {truncate_text(cleaned, limit=180)}"


def compact_merge_sections(
    sections: dict[str, list[str]],
    seen: dict[str, set[str]],
    incoming: dict[str, list[str]],
) -> None:
    for section in HISTORY_COMPACT_SECTIONS:
        values = incoming.get(section, [])
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str):
                compact_append_unique(sections, seen, section, value)


def compact_is_architecture_line(line_lower: str) -> bool:
    return line_contains_any_keyword(line_lower, HISTORY_ARCHITECTURE_KEYWORDS)


def compact_is_verification_line(line_lower: str) -> bool:
    return line_contains_any_keyword(line_lower, HISTORY_VERIFICATION_KEYWORDS)


def compact_is_todo_line(line_lower: str) -> bool:
    return line_contains_any_keyword(line_lower, HISTORY_TODO_KEYWORDS)


def compact_is_modified_line(line: str, line_lower: str) -> bool:
    if line_contains_any_keyword(line_lower, HISTORY_MODIFIED_KEYWORDS):
        return True
    return HISTORY_PATH_PATTERN.search(line) is not None


def compact_is_tool_output_line(line: str, line_lower: str) -> bool:
    if line.startswith("$ "):
        return True
    return line_contains_any_keyword(line_lower, HISTORY_TOOL_OUTPUT_KEYWORDS)


def build_compact_history_sections(history_messages: list[dict[str, str]]) -> dict[str, list[str]]:
    sections = {section: [] for section in HISTORY_COMPACT_SECTIONS}
    seen = {section: set() for section in HISTORY_COMPACT_SECTIONS}

    for message in history_messages:
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            continue

        previous_snapshot = parse_compact_snapshot_sections(content)
        if previous_snapshot is not None:
            compact_merge_sections(sections, seen, previous_snapshot)
            continue

        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            line_lower = line.lower()

            if compact_is_architecture_line(line_lower):
                # Keep architecture decisions verbatim for future context replay.
                compact_append_unique(
                    sections,
                    seen,
                    HISTORY_COMPACT_SECTION_ARCHITECTURE,
                    line,
                )
                continue

            if compact_is_tool_output_line(line, line_lower):
                tool_status = compact_format_tool_status(line)
                if tool_status is not None:
                    compact_append_unique(
                        sections,
                        seen,
                        HISTORY_COMPACT_SECTION_TOOL_OUTPUT,
                        tool_status,
                    )
                continue

            if compact_is_verification_line(line_lower):
                status = compact_status_from_line(line_lower)
                if status is not None and not line.startswith(("PASS:", "FAIL:")):
                    compact_append_unique(
                        sections,
                        seen,
                        HISTORY_COMPACT_SECTION_VERIFICATION,
                        f"{status}: {line}",
                    )
                else:
                    compact_append_unique(
                        sections,
                        seen,
                        HISTORY_COMPACT_SECTION_VERIFICATION,
                        line,
                    )
                continue

            if compact_is_todo_line(line_lower):
                compact_append_unique(
                    sections,
                    seen,
                    HISTORY_COMPACT_SECTION_TODO,
                    line,
                )
                continue

            if compact_is_modified_line(line, line_lower):
                compact_append_unique(
                    sections,
                    seen,
                    HISTORY_COMPACT_SECTION_MODIFIED,
                    line,
                )
                continue

    return compact_apply_section_limits(sections)


def build_compact_history_message(history_messages: list[dict[str, str]]) -> dict[str, str]:
    sections = build_compact_history_sections(history_messages)
    return {
        "role": "assistant",
        "content": render_compact_snapshot_content_from_sections(sections),
    }


def trim_history_messages_with_memory(
    history_messages: list[dict[str, str]],
    max_turns: int,
    *,
    existing_memory: dict[str, Any] | None = None,
) -> tuple[list[dict[str, str]], dict[str, Any] | None]:
    if max_turns <= 0:
        return [], None

    max_messages = max_turns * 2
    if max_messages <= 2:
        trimmed = history_messages[-max_messages:]
        return trimmed, normalize_compact_memory_payload(existing_memory)

    if len(history_messages) <= max_messages:
        return history_messages, normalize_compact_memory_payload(existing_memory)

    recent_keep = max_messages - 1
    older_messages = history_messages[:-recent_keep]
    recent_messages = history_messages[-recent_keep:]
    sections = build_compact_history_sections(older_messages)
    compact_message = {
        "role": "assistant",
        "content": render_compact_snapshot_content_from_sections(sections),
    }
    compact_memory = build_compact_memory_payload(sections, source_messages=len(history_messages))
    return [compact_message, *recent_messages], compact_memory


def trim_history_messages(history_messages: list[dict[str, str]], max_turns: int) -> list[dict[str, str]]:
    trimmed, _ = trim_history_messages_with_memory(history_messages, max_turns)
    return trimmed


def normalize_query_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for raw in HISTORY_QUERY_TOKEN_PATTERN.findall(text.lower()):
        token = raw.strip("._/-: ")
        if not token:
            continue
        if len(token) == 1 and token.isascii() and not token.isdigit():
            continue
        tokens.add(token)
    return tokens


def normalize_context_text(raw: str) -> str:
    collapsed = " ".join(raw.split())
    if len(collapsed) <= HISTORY_RETRIEVAL_MAX_TEXT_CHARS:
        return collapsed
    omitted = len(collapsed) - HISTORY_RETRIEVAL_MAX_TEXT_CHARS
    return collapsed[:HISTORY_RETRIEVAL_MAX_TEXT_CHARS] + f"...(+{omitted})"


def context_overlap_score(query_tokens: set[str], text: str) -> float:
    if not query_tokens:
        return 0.0
    text_tokens = normalize_query_tokens(text)
    if not text_tokens:
        return 0.0
    overlap_count = len(query_tokens & text_tokens)
    if overlap_count == 0:
        return 0.0
    coverage = overlap_count / max(1, len(query_tokens))
    density = overlap_count / max(1, len(text_tokens))
    return float(overlap_count) + coverage + density


def compact_section_tag(section: str) -> str:
    if section == HISTORY_COMPACT_SECTION_ARCHITECTURE:
        return "ARCH"
    if section == HISTORY_COMPACT_SECTION_MODIFIED:
        return "FILES"
    if section == HISTORY_COMPACT_SECTION_VERIFICATION:
        return "VERIFY"
    if section == HISTORY_COMPACT_SECTION_TODO:
        return "TODO"
    return "TOOL"


def append_retrieval_candidate(
    candidates: list[dict[str, Any]],
    *,
    rendered: str,
    text: str,
    section: str,
    weight: float,
    recency: float,
) -> None:
    candidates.append(
        {
            "id": len(candidates),
            "rendered": rendered,
            "text": text,
            "section": section,
            "weight": weight,
            "recency": recency,
        }
    )


def collect_history_retrieval_candidates(
    history_messages: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    candidates: list[dict[str, Any]] = []
    pinned_architecture: list[str] = []
    total = max(1, len(history_messages))

    for idx, message in enumerate(history_messages):
        role = message.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        recency = float(idx + 1) / float(total)

        compact_sections = compact_memory_sections_from_message(message)
        if compact_sections is not None:
            for section in HISTORY_COMPACT_SECTIONS:
                section_weight = HISTORY_RETRIEVAL_SECTION_WEIGHTS.get(section, 1.0)
                section_tag = compact_section_tag(section)
                for item in compact_sections.get(section, []):
                    normalized_item = normalize_context_text(item)
                    rendered = f"{section_tag}: {normalized_item}"
                    append_retrieval_candidate(
                        candidates,
                        rendered=rendered,
                        text=normalized_item,
                        section=section,
                        weight=section_weight,
                        recency=recency,
                    )
                    if section == HISTORY_COMPACT_SECTION_ARCHITECTURE:
                        pinned_architecture.append(rendered)
            continue

        message_weight = 1.1 if role == "user" else 1.0
        normalized_content = normalize_context_text(content)
        append_retrieval_candidate(
            candidates,
            rendered=f"{role.upper()}: {normalized_content}",
            text=normalized_content,
            section="message",
            weight=message_weight,
            recency=recency,
        )

    return candidates, pinned_architecture


def safe_float(raw_value: Any, default: float = 0.0) -> float:
    if isinstance(raw_value, (int, float)):
        return float(raw_value)
    return default


def normalize_embedding_vector(raw_vector: Any) -> list[float]:
    if not isinstance(raw_vector, list) or not raw_vector:
        raise RuntimeError("embedding vector is empty")
    vector: list[float] = []
    for item in raw_vector:
        if isinstance(item, (int, float)):
            vector.append(float(item))
        else:
            raise RuntimeError("embedding vector contains non-numeric value")
    return vector


def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if len(vec_a) != len(vec_b) or not vec_a:
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for idx in range(len(vec_a)):
        a = vec_a[idx]
        b = vec_b[idx]
        dot += a * b
        norm_a += a * a
        norm_b += b * b
    if norm_a <= 0 or norm_b <= 0:
        return 0.0
    return dot / ((norm_a ** 0.5) * (norm_b ** 0.5))


def request_remote_embeddings(
    remote: RetrievalRemoteConfig,
    inputs: list[str],
) -> list[list[float]]:
    if not inputs:
        return []
    payload = {
        "model": remote.model,
        "input": inputs,
    }
    headers = {
        "Authorization": f"Bearer {remote.api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    response = http_json_or_raise(
        "POST",
        f"{remote.base_url}/embeddings",
        headers,
        payload,
        timeout_secs=HISTORY_RETRIEVAL_REMOTE_TIMEOUT_SECS,
    )
    data = response.get("data")
    if not isinstance(data, list) or not data:
        raise RuntimeError("embedding API returned empty data")

    items_with_index: list[tuple[int, list[float]]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        embedding = normalize_embedding_vector(item.get("embedding"))
        index = item.get("index")
        if not isinstance(index, int):
            index = len(items_with_index)
        items_with_index.append((index, embedding))
    if not items_with_index:
        raise RuntimeError("embedding API returned no vectors")

    items_with_index.sort(key=lambda item: item[0])
    return [vector for _, vector in items_with_index]


def compute_embedding_similarity_scores(
    query: str,
    candidates: list[dict[str, Any]],
    remote: RetrievalRemoteConfig | None,
) -> dict[int, float]:
    if remote is None or not candidates:
        return {}
    texts = [str(candidate["text"]) for candidate in candidates]
    vectors = request_remote_embeddings(remote, [query, *texts])
    if len(vectors) < 2:
        return {}
    query_vector = vectors[0]
    doc_vectors = vectors[1:]
    scores: dict[int, float] = {}
    for idx, candidate in enumerate(candidates):
        if idx >= len(doc_vectors):
            break
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, int):
            continue
        scores[candidate_id] = cosine_similarity(query_vector, doc_vectors[idx])
    return scores


def normalize_rerank_results(raw_results: Any) -> list[tuple[int, float]]:
    if not isinstance(raw_results, list):
        return []
    normalized: list[tuple[int, float]] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        if not isinstance(index, int):
            continue
        score = item.get("relevance_score")
        if not isinstance(score, (int, float)):
            score = item.get("score")
        if not isinstance(score, (int, float)):
            continue
        normalized.append((index, float(score)))
    return normalized


def normalize_rerank_scores(items: list[tuple[int, float]]) -> dict[int, float]:
    if not items:
        return {}
    values = [score for _, score in items]
    min_score = min(values)
    max_score = max(values)
    if max_score <= min_score:
        return {index: 1.0 if score > 0 else 0.0 for index, score in items}
    return {index: (score - min_score) / (max_score - min_score) for index, score in items}


def compute_rerank_scores(
    query: str,
    candidates: list[dict[str, Any]],
    remote: RetrievalRemoteConfig | None,
) -> dict[int, float]:
    if remote is None or not candidates:
        return {}
    documents = [str(candidate["text"]) for candidate in candidates]
    payload = {
        "model": remote.model,
        "query": query,
        "documents": documents,
    }
    headers = {
        "Authorization": f"Bearer {remote.api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    response = http_json_or_raise(
        "POST",
        f"{remote.base_url}/rerank",
        headers,
        payload,
        timeout_secs=HISTORY_RETRIEVAL_REMOTE_TIMEOUT_SECS,
    )
    results = normalize_rerank_results(response.get("results"))
    if not results:
        results = normalize_rerank_results(response.get("data"))
    normalized = normalize_rerank_scores(results)
    scores: dict[int, float] = {}
    for local_index, candidate in enumerate(candidates):
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, int):
            continue
        if local_index in normalized:
            scores[candidate_id] = normalized[local_index]
    return scores


def shortlist_remote_candidates(
    candidates: list[dict[str, Any]],
    query_tokens: set[str],
    limit: int,
) -> list[dict[str, Any]]:
    ranked: list[tuple[float, dict[str, Any]]] = []
    for candidate in candidates:
        text = str(candidate.get("text", ""))
        overlap = context_overlap_score(query_tokens, text)
        weight = safe_float(candidate.get("weight"), 1.0)
        recency = safe_float(candidate.get("recency"), 0.0)
        section = candidate.get("section")
        seed = (overlap * weight) + recency + (0.2 * weight)
        if section == HISTORY_COMPACT_SECTION_ARCHITECTURE:
            seed += 0.2
        ranked.append((seed, candidate))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [candidate for _, candidate in ranked[:limit]]


def build_retrieved_context_block(
    history_messages: list[dict[str, str]],
    user_prompt: str,
    retrieval_config: ContextRetrievalConfig | None = None,
) -> str | None:
    if isinstance(retrieval_config, ContextRetrievalConfig) and not retrieval_config.enabled:
        return None
    query_tokens = normalize_query_tokens(user_prompt)
    if not query_tokens:
        return None

    weighted_candidates, pinned_architecture = collect_history_retrieval_candidates(history_messages)
    if not weighted_candidates:
        return None

    selected: list[str] = []
    seen: set[str] = set()
    selected_limit = HISTORY_RETRIEVAL_MAX_ITEMS
    candidate_limit = HISTORY_RETRIEVAL_REMOTE_MAX_CANDIDATES
    if isinstance(retrieval_config, ContextRetrievalConfig):
        selected_limit = max(1, retrieval_config.selected_limit)
        candidate_limit = max(selected_limit, retrieval_config.candidate_limit)

    for item in pinned_architecture[:HISTORY_RETRIEVAL_PINNED_ARCH_LIMIT]:
        if item in seen:
            continue
        selected.append(item)
        seen.add(item)

    remote_embedding_scores: dict[int, float] = {}
    remote_rerank_scores: dict[int, float] = {}
    remote_enabled = isinstance(retrieval_config, ContextRetrievalConfig) and (
        retrieval_config.embedding is not None or retrieval_config.rerank is not None
    )
    if remote_enabled and isinstance(retrieval_config, ContextRetrievalConfig):
        remote_candidates = shortlist_remote_candidates(weighted_candidates, query_tokens, candidate_limit)
        try:
            remote_embedding_scores = compute_embedding_similarity_scores(
                user_prompt,
                remote_candidates,
                retrieval_config.embedding,
            )
        except RuntimeError:
            remote_embedding_scores = {}
        try:
            remote_rerank_scores = compute_rerank_scores(
                user_prompt,
                remote_candidates,
                retrieval_config.rerank,
            )
        except RuntimeError:
            remote_rerank_scores = {}

    scored: list[tuple[float, str]] = []
    remote_signal_used = bool(remote_embedding_scores) or bool(remote_rerank_scores)
    min_score = 0.2 if remote_signal_used else HISTORY_RETRIEVAL_MIN_SCORE
    for candidate in weighted_candidates:
        item = str(candidate.get("rendered", ""))
        if not item or item in seen:
            continue
        text = str(candidate.get("text", item))
        overlap = context_overlap_score(query_tokens, text)
        weight = safe_float(candidate.get("weight"), 1.0)
        recency = safe_float(candidate.get("recency"), 0.0)
        candidate_id = candidate.get("id")
        candidate_numeric_id = candidate_id if isinstance(candidate_id, int) else -1

        score = (overlap * weight) + recency
        if candidate_numeric_id >= 0 and candidate_numeric_id in remote_embedding_scores:
            score += (
                remote_embedding_scores[candidate_numeric_id]
                * HISTORY_RETRIEVAL_EMBEDDING_SCORE_WEIGHT
                * weight
            )
        if candidate_numeric_id >= 0 and candidate_numeric_id in remote_rerank_scores:
            score += remote_rerank_scores[candidate_numeric_id] * HISTORY_RETRIEVAL_RERANK_SCORE_WEIGHT
        if not remote_signal_used and overlap <= 0:
            continue
        if score < min_score:
            continue
        scored.append((score, item))

    scored.sort(key=lambda entry: entry[0], reverse=True)
    for _, item in scored:
        if item in seen:
            continue
        selected.append(item)
        seen.add(item)
        if len(selected) >= selected_limit:
            break

    if not selected:
        return None

    lines = [
        "[Retrieved Context]",
        "Use only when relevant; explicit latest user instruction has highest priority.",
    ]
    for item in selected:
        lines.append(f"- {item}")
    return "\n".join(lines)


def build_chat_messages(
    *,
    system_prompt: str,
    history_messages: list[dict[str, str]],
    user_prompt: str,
    max_history_turns: int,
    retrieval_config: ContextRetrievalConfig | None = None,
    skill_prompt_block: str = "",
) -> list[dict[str, str]]:
    trimmed_history = trim_history_messages(history_messages, max_history_turns)
    retrieved_context = build_retrieved_context_block(trimmed_history, user_prompt, retrieval_config)
    effective_system_prompt = system_prompt
    if isinstance(skill_prompt_block, str) and skill_prompt_block.strip():
        effective_system_prompt = f"{effective_system_prompt}\n\n{skill_prompt_block.strip()}"
    if isinstance(retrieved_context, str) and retrieved_context:
        effective_system_prompt = f"{effective_system_prompt}\n\n{retrieved_context}"
    return [
        {"role": "system", "content": effective_system_prompt},
        *trimmed_history,
        {"role": "user", "content": user_prompt},
    ]


def normalize_file_mention_token(raw_token: str) -> str:
    token = raw_token.strip().strip("\"'`“”‘’")
    while token and token[-1] in FILE_MENTION_TRAILING_PUNCTUATION:
        token = token[:-1]
    return token.strip()


def extract_file_mentions(user_prompt: str) -> list[str]:
    mentions: list[str] = []
    for matched in FILE_MENTION_PATTERN.finditer(user_prompt):
        if matched.start() > 0 and user_prompt[matched.start() - 1] in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._%+-":
            continue
        token = normalize_file_mention_token(matched.group(1))
        if not token:
            continue
        if token not in mentions:
            mentions.append(token)
        if len(mentions) >= FILE_MENTION_MAX_TOKENS:
            break
    return mentions


def mention_path_ngrams(path_text: str) -> set[str]:
    normalized = path_text.lower()
    if len(normalized) < 3:
        return {normalized} if normalized else set()
    return {normalized[idx : idx + 3] for idx in range(0, len(normalized) - 2)}


def mention_query_cache_key(token_lower: str, limit: int) -> str:
    safe_limit = max(1, limit)
    return f"{token_lower}::{safe_limit}"


def mention_query_cache_get(index: MentionPathIndex, token_lower: str, limit: int) -> list[str] | None:
    if not isinstance(index.query_cache, OrderedDict):
        return None
    cached = index.query_cache.get(mention_query_cache_key(token_lower, limit))
    if cached is None:
        return None
    index.query_cache.move_to_end(mention_query_cache_key(token_lower, limit))
    return list(cached)


def mention_query_cache_put(
    index: MentionPathIndex,
    token_lower: str,
    limit: int,
    value: list[str],
) -> None:
    if not isinstance(index.query_cache, OrderedDict):
        return
    query_key = mention_query_cache_key(token_lower, limit)
    index.query_cache[query_key] = list(value)
    index.query_cache.move_to_end(query_key)
    while len(index.query_cache) > FILE_MENTION_QUERY_CACHE_MAX_ENTRIES:
        index.query_cache.popitem(last=False)


def mention_index_add_path(index: MentionPathIndex, rel_path: str) -> None:
    if rel_path in index.paths:
        return
    lower_path = rel_path.lower()
    basename = Path(rel_path).name.lower()
    index.paths.add(rel_path)
    index.exact_map.setdefault(lower_path, set()).add(rel_path)
    index.basename_map.setdefault(basename, set()).add(rel_path)
    for token in mention_path_ngrams(lower_path):
        index.trigram_map.setdefault(token, set()).add(rel_path)
    index.query_cache.clear()


def mention_index_remove_path(index: MentionPathIndex, rel_path: str) -> None:
    if rel_path not in index.paths:
        return
    index.paths.remove(rel_path)
    lower_path = rel_path.lower()
    basename = Path(rel_path).name.lower()

    exact_bucket = index.exact_map.get(lower_path)
    if isinstance(exact_bucket, set):
        exact_bucket.discard(rel_path)
        if not exact_bucket:
            index.exact_map.pop(lower_path, None)

    basename_bucket = index.basename_map.get(basename)
    if isinstance(basename_bucket, set):
        basename_bucket.discard(rel_path)
        if not basename_bucket:
            index.basename_map.pop(basename, None)

    for token in mention_path_ngrams(lower_path):
        trigram_bucket = index.trigram_map.get(token)
        if isinstance(trigram_bucket, set):
            trigram_bucket.discard(rel_path)
            if not trigram_bucket:
                index.trigram_map.pop(token, None)
    index.query_cache.clear()


def scan_all_file_paths_with_fd(work_dir: Path) -> tuple[set[str], str]:
    cmd = [
        "fd",
        "--color",
        "never",
        "--type",
        "f",
        "--base-directory",
        str(work_dir),
        ".",
        ".",
    ]
    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(work_dir),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise RuntimeError(f"fd file scan failed: {truncate_text(proc.stderr or proc.stdout or '')}")

    paths: set[str] = set()
    for line in (proc.stdout or "").splitlines():
        rel = line.strip().removeprefix("./")
        if not rel:
            continue
        paths.add(rel)
        if len(paths) >= FILE_MENTION_INDEX_MAX_SCAN_FILES:
            break
    return paths, "fd"


def scan_all_file_paths_with_python(work_dir: Path) -> tuple[set[str], str]:
    paths: set[str] = set()
    root = work_dir.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if dirname not in FILE_MENTION_PYTHON_EXCLUDE_DIRS and not dirname.startswith(".")
        ]
        current_dir = Path(dirpath)
        for filename in filenames:
            if filename.startswith("."):
                continue
            full_path = current_dir / filename
            if not full_path.is_file():
                continue
            rel = full_path.relative_to(root).as_posix()
            paths.add(rel)
            if len(paths) >= FILE_MENTION_INDEX_MAX_SCAN_FILES:
                return paths, "python"
    return paths, "python"


def scan_all_file_paths(work_dir: Path) -> tuple[set[str], str]:
    if shutil.which("fd"):
        try:
            return scan_all_file_paths_with_fd(work_dir)
        except RuntimeError:
            return scan_all_file_paths_with_python(work_dir)
    return scan_all_file_paths_with_python(work_dir)


def build_mention_path_index(work_dir: Path) -> MentionPathIndex:
    scanned_paths, engine = scan_all_file_paths(work_dir.resolve())
    index = MentionPathIndex(
        work_dir=work_dir.resolve(),
        paths=set(),
        exact_map={},
        basename_map={},
        trigram_map={},
        query_cache=OrderedDict(),
        engine=engine,
        last_scan_at=time.time(),
    )
    for rel_path in sorted(scanned_paths):
        mention_index_add_path(index, rel_path)
    return index


def refresh_mention_path_index(index: MentionPathIndex, *, force: bool = False) -> MentionPathIndex:
    now = time.time()
    if not force and (now - index.last_scan_at) < FILE_MENTION_INDEX_REFRESH_SECS:
        return index

    latest_paths, engine = scan_all_file_paths(index.work_dir)
    removed_paths = index.paths - latest_paths
    added_paths = latest_paths - index.paths
    for rel_path in removed_paths:
        mention_index_remove_path(index, rel_path)
    for rel_path in added_paths:
        mention_index_add_path(index, rel_path)

    index.last_scan_at = now
    index.engine = engine
    return index


def mention_token_candidate_pool(index: MentionPathIndex, token: str) -> set[str]:
    token_lower = token.lower()
    if len(token_lower) < 3:
        shortlist: set[str] = set()
        for basename, paths in index.basename_map.items():
            if token_lower in basename:
                shortlist.update(paths)
                if len(shortlist) >= (FILE_MENTION_MAX_CANDIDATES * 8):
                    break
        if shortlist:
            return shortlist
        return set(index.paths)

    grams = mention_path_ngrams(token_lower)
    posting_lists: list[set[str]] = []
    for gram in grams:
        posting = index.trigram_map.get(gram)
        if not posting:
            return set()
        posting_lists.append(posting)
    posting_lists.sort(key=len)
    merged = set(posting_lists[0])
    for posting in posting_lists[1:]:
        merged.intersection_update(posting)
        if not merged:
            break
        if len(merged) > FILE_MENTION_MAX_POOL_SIZE:
            merged = set(nsmallest(FILE_MENTION_MAX_POOL_SIZE, merged))
            break
    return merged


def mention_path_rank(rel_path: str, token: str) -> tuple[int, int, str]:
    lower = rel_path.lower()
    token_lower = token.lower()
    basename = Path(rel_path).name.lower()
    if lower == token_lower:
        score = 0
    elif basename == token_lower:
        score = 1
    elif lower.endswith("/" + token_lower):
        score = 2
    elif token_lower in basename:
        score = 3
    elif token_lower in lower:
        score = 4
    else:
        score = 9
    return score, len(lower), lower


def mention_index_age_secs(index: MentionPathIndex) -> float:
    return max(0.0, time.time() - index.last_scan_at)


def mention_state_adopt_pending_snapshot(state: MentionIndexState) -> bool:
    pending: MentionPathIndex | None = None
    with state.refresh_lock:
        if state.pending_active is None:
            return False
        pending = state.pending_active
        state.pending_active = None
    state.active = pending
    state.last_refresh_applied_at = time.time()
    state.last_refresh_status = "applied"
    return True


def mention_state_refresh_worker(state: MentionIndexState, work_dir: Path) -> None:
    try:
        refreshed = build_mention_path_index(work_dir)
        with state.refresh_lock:
            state.pending_active = refreshed
            state.last_refresh_error = None
    except Exception as exc:  # noqa: BLE001
        with state.refresh_lock:
            state.last_refresh_error = str(exc)
    finally:
        with state.refresh_lock:
            state.refresh_thread = None


def mention_state_schedule_async_refresh(state: MentionIndexState) -> bool:
    now = time.time()
    with state.refresh_lock:
        if state.pending_active is not None:
            state.last_refresh_status = "pending"
            return False
        if state.refresh_thread is not None and state.refresh_thread.is_alive():
            state.last_refresh_status = "inflight"
            return False
        if (
            isinstance(state.last_refresh_error, str)
            and state.last_refresh_error
            and (now - state.last_refresh_started_at) < FILE_MENTION_REFRESH_ERROR_BACKOFF_SECS
        ):
            state.last_refresh_status = "backoff"
            return False
        worker = threading.Thread(
            target=mention_state_refresh_worker,
            args=(state, state.active.work_dir),
            daemon=True,
            name="grobot-mention-refresh",
        )
        state.refresh_thread = worker
        state.last_refresh_started_at = now
        state.last_refresh_status = "scheduled"
        worker.start()
        return True


def mention_state_from_input(
    mention_index: MentionIndexState | MentionPathIndex | None,
    work_dir: Path,
) -> MentionIndexState:
    resolved_work_dir = work_dir.resolve()
    if isinstance(mention_index, MentionIndexState):
        _ = mention_state_adopt_pending_snapshot(mention_index)
        if mention_index.active.work_dir == resolved_work_dir:
            return mention_index
        return MentionIndexState(active=build_mention_path_index(resolved_work_dir))
    if isinstance(mention_index, MentionPathIndex) and mention_index.work_dir == resolved_work_dir:
        return MentionIndexState(active=mention_index)
    return MentionIndexState(active=build_mention_path_index(resolved_work_dir))


def filter_existing_mention_candidates(index: MentionPathIndex, candidates: list[str]) -> list[str]:
    existing: list[str] = []
    for rel_path in candidates:
        candidate_path = index.work_dir / rel_path
        if candidate_path.is_file():
            existing.append(rel_path)
    return existing


def mention_token_looks_explicit(token: str) -> bool:
    normalized = token.strip()
    if not normalized:
        return False
    if "/" in normalized or "\\" in normalized:
        return True
    return "." in Path(normalized).name


def find_mention_candidates(index: MentionPathIndex, token: str, limit: int) -> list[str]:
    token_lower = token.lower()
    cached = mention_query_cache_get(index, token_lower, limit)
    if isinstance(cached, list):
        return cached[:limit]

    exact_candidates: set[str] = set(index.exact_map.get(token_lower, set()))
    exact_candidates.update(index.basename_map.get(token_lower, set()))
    if exact_candidates and mention_token_looks_explicit(token):
        explicit_best = nsmallest(limit, exact_candidates, key=lambda item: mention_path_rank(item, token))
        mention_query_cache_put(index, token_lower, limit, explicit_best)
        return explicit_best

    candidates: set[str] = set(exact_candidates)
    if len(candidates) < limit:
        candidates.update(mention_token_candidate_pool(index, token))
    matched = [
        rel_path
        for rel_path in candidates
        if token_lower in rel_path.lower() or rel_path.lower() == token_lower
    ]
    best = nsmallest(limit, matched, key=lambda item: mention_path_rank(item, token))
    mention_query_cache_put(index, token_lower, limit, best)
    return best


def enrich_user_prompt_with_file_mentions(
    user_prompt: str,
    context: LocalToolContext,
    mention_index: MentionIndexState | MentionPathIndex | None,
) -> tuple[str, list[str], MentionIndexState | None]:
    mentions = extract_file_mentions(user_prompt)
    if not mentions:
        return user_prompt, [], mention_index

    state = mention_state_from_input(mention_index, context.work_dir)
    _ = mention_state_adopt_pending_snapshot(state)
    state.last_refresh_status = "idle"
    index = state.active
    age_secs = mention_index_age_secs(index)
    hard_stale = age_secs >= FILE_MENTION_INDEX_FORCE_REFRESH_SECS
    soft_stale = age_secs >= FILE_MENTION_INDEX_REFRESH_SECS

    token_candidates: dict[str, list[str]] = {}
    unresolved_tokens: list[str] = []
    for token in mentions:
        candidates = find_mention_candidates(
            index,
            token,
            FILE_MENTION_MAX_CANDIDATES,
        )
        if hard_stale and candidates:
            candidates = filter_existing_mention_candidates(index, candidates)
        token_candidates[token] = candidates
        if not candidates:
            unresolved_tokens.append(token)

    if unresolved_tokens and (soft_stale or hard_stale):
        _ = mention_state_schedule_async_refresh(state)

    lines: list[str] = []
    for token in mentions:
        candidates = token_candidates.get(token, [])
        if len(candidates) == 1:
            lines.append(f"@{token} => {candidates[0]}")
            continue
        if len(candidates) > 1:
            lines.append(
                f"@{token} => ambiguous: {', '.join(candidates[:FILE_MENTION_MAX_CANDIDATES])}"
            )
            continue
        lines.append(f"@{token} => not_found")

    if not lines:
        return user_prompt, [], state

    resolution_block = "\n".join(lines)
    enriched = (
        f"{user_prompt}\n\n"
        "[Resolved @file mentions]\n"
        f"{resolution_block}\n"
        "Prefer resolved paths above when calling tools."
    )
    return enriched, lines, state


def truncate_text(raw: str, limit: int = LOCAL_TOOL_OUTPUT_LIMIT) -> str:
    if len(raw) <= limit:
        return raw
    omitted = len(raw) - limit
    return raw[:limit] + f"\n...[truncated {omitted} chars]"


def normalize_tool_allow_tokens(raw_allow: Any) -> tuple[str, ...]:
    if not isinstance(raw_allow, list):
        return LOCAL_TOOL_ALL
    normalized: list[str] = []
    for item in raw_allow:
        if not isinstance(item, str):
            continue
        token = item.strip().lower()
        if not token:
            continue
        if token in {"*", "all"}:
            return ("all",)
        if token not in normalized:
            normalized.append(token)
    return tuple(normalized)


def normalize_mcp_allowed_tools(raw_value: Any) -> tuple[str, ...] | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, list):
        raise RuntimeError("[tools.mcp].allow_tools must be string array")
    normalized: list[str] = []
    for item in raw_value:
        if not isinstance(item, str):
            raise RuntimeError("[tools.mcp].allow_tools must contain only strings")
        token = item.strip().lower()
        if not token:
            continue
        if token in {"*", "all"}:
            return None
        if token not in normalized:
            normalized.append(token)
    return tuple(normalized)


def resolve_mcp_call_policy(project_toml: dict[str, Any]) -> MCPCallPolicy:
    tools_cfg = project_toml.get("tools")
    mcp_cfg: dict[str, Any] = {}
    if isinstance(tools_cfg, dict):
        raw_mcp = tools_cfg.get("mcp")
        if isinstance(raw_mcp, dict):
            mcp_cfg = raw_mcp

    max_concurrency = parse_positive_int_option(
        mcp_cfg.get("max_concurrency_per_server"),
        LOCAL_TOOL_MCP_MAX_CONCURRENCY_DEFAULT,
        1,
        LOCAL_TOOL_MCP_MAX_CONCURRENCY_MAX,
    )
    max_queue = parse_positive_int_option(
        mcp_cfg.get("max_queue_per_server"),
        LOCAL_TOOL_MCP_MAX_QUEUE_DEFAULT,
        1,
        LOCAL_TOOL_MCP_MAX_QUEUE_MAX,
    )
    failure_threshold = parse_positive_int_option(
        mcp_cfg.get("failure_threshold"),
        LOCAL_TOOL_MCP_CIRCUIT_FAILURE_THRESHOLD_DEFAULT,
        1,
        LOCAL_TOOL_MCP_CIRCUIT_FAILURE_THRESHOLD_MAX,
    )
    cooldown_secs = parse_positive_int_option(
        mcp_cfg.get("cooldown_secs"),
        LOCAL_TOOL_MCP_CIRCUIT_COOLDOWN_DEFAULT_SECS,
        1,
        LOCAL_TOOL_MCP_CIRCUIT_COOLDOWN_MAX_SECS,
    )
    allow_tools = normalize_mcp_allowed_tools(mcp_cfg.get("allow_tools"))
    latency_sample_limit = parse_positive_int_option(
        mcp_cfg.get("latency_sample_limit"),
        LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_DEFAULT,
        16,
        LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_MAX,
    )
    return MCPCallPolicy(
        max_concurrency_per_server=max_concurrency,
        max_queue_per_server=max_queue,
        failure_threshold=failure_threshold,
        cooldown_secs=cooldown_secs,
        allow_tools=allow_tools,
        latency_sample_limit=latency_sample_limit,
    )


def resolve_hook_policy(project_toml: dict[str, Any]) -> HookPolicy:
    raw_hooks = project_toml.get("hooks")
    hooks_cfg = raw_hooks if isinstance(raw_hooks, dict) else {}
    enabled = parse_bool_option(hooks_cfg.get("enabled"), True)
    strict = parse_bool_option(hooks_cfg.get("strict"), False)
    timeout_secs = parse_positive_int_option(
        hooks_cfg.get("timeout_secs"),
        LOCAL_TOOL_HOOK_TIMEOUT_DEFAULT_SECS,
        1,
        LOCAL_TOOL_HOOK_TIMEOUT_MAX_SECS,
    )
    return HookPolicy(
        enabled=enabled,
        strict=strict,
        timeout_secs=timeout_secs,
    )


def resolve_local_tool_context(
    project_toml: dict[str, Any],
    work_dir: Path,
    *,
    mcp_runtime: dict[str, Any] | None = None,
    runtime_paths: RuntimePaths | None = None,
) -> LocalToolContext:
    tools_cfg = project_toml.get("tools")
    allow_raw = None
    if isinstance(tools_cfg, dict):
        allow_raw = tools_cfg.get("allow")
    allow_tokens = normalize_tool_allow_tokens(allow_raw)
    mcp_policy = resolve_mcp_call_policy(project_toml)
    hook_policy = resolve_hook_policy(project_toml)
    return LocalToolContext(
        work_dir=work_dir,
        allow_tokens=allow_tokens,
        mcp_runtime=mcp_runtime,
        global_hooks_dir=runtime_paths.global_hooks_dir if isinstance(runtime_paths, RuntimePaths) else None,
        project_hooks_dir=runtime_paths.project_hooks_dir if isinstance(runtime_paths, RuntimePaths) else None,
        hook_policy=hook_policy,
        mcp_policy=mcp_policy,
    )


def parse_bool_option(raw_value: Any, default: bool) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, str):
        normalized = raw_value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default


def parse_positive_int_option(raw_value: Any, default: int, minimum: int, maximum: int) -> int:
    if isinstance(raw_value, int) and raw_value > 0:
        return max(minimum, min(maximum, raw_value))
    return max(minimum, min(maximum, default))


def parse_float_option(raw_value: Any, default: float, minimum: float, maximum: float) -> float:
    if isinstance(raw_value, (int, float)):
        candidate = float(raw_value)
        if math.isfinite(candidate):
            return max(minimum, min(maximum, candidate))
    return max(minimum, min(maximum, float(default)))


def discover_hook_scripts(event_name: str, context: LocalToolContext) -> list[Path]:
    if event_name not in LOCAL_TOOL_HOOK_EVENTS:
        raise RuntimeError(f"unsupported hook event: {event_name}")
    hook_roots: list[Path] = []
    if isinstance(context.global_hooks_dir, Path):
        hook_roots.append(context.global_hooks_dir)
    if isinstance(context.project_hooks_dir, Path):
        hook_roots.append(context.project_hooks_dir)

    scripts: list[Path] = []
    for root in hook_roots:
        event_dir = root / event_name
        if not event_dir.exists() or not event_dir.is_dir():
            continue
        try:
            entries = sorted(event_dir.iterdir(), key=lambda item: item.name.lower())
        except OSError as exc:
            print(f"[hook] failed to list {event_dir}: {exc}", file=sys.stderr)
            continue
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_file():
                scripts.append(entry.resolve())
    return scripts


def summarize_hooks_runtime(context: LocalToolContext) -> dict[str, Any]:
    global_root = context.global_hooks_dir.resolve() if isinstance(context.global_hooks_dir, Path) else None
    project_root = context.project_hooks_dir.resolve() if isinstance(context.project_hooks_dir, Path) else None
    events: dict[str, Any] = {}
    total_scripts = 0
    for event_name in LOCAL_TOOL_HOOK_EVENTS:
        scripts = discover_hook_scripts(event_name, context)
        script_entries: list[dict[str, str]] = []
        for script in scripts:
            scope = "unknown"
            relative = str(script)
            if isinstance(global_root, Path) and script.is_relative_to(global_root):
                scope = "global"
                relative = str(script.relative_to(global_root))
            elif isinstance(project_root, Path) and script.is_relative_to(project_root):
                scope = "project"
                relative = str(script.relative_to(project_root))
            script_entries.append(
                {
                    "scope": scope,
                    "path": relative,
                    "absolute_path": str(script),
                }
            )
        events[event_name] = {
            "count": len(script_entries),
            "scripts": script_entries,
        }
        total_scripts += len(script_entries)
    return {
        "policy": {
            "enabled": context.hook_policy.enabled,
            "strict": context.hook_policy.strict,
            "timeout_secs": context.hook_policy.timeout_secs,
        },
        "global_dir": str(context.global_hooks_dir) if isinstance(context.global_hooks_dir, Path) else None,
        "project_dir": str(context.project_hooks_dir) if isinstance(context.project_hooks_dir, Path) else None,
        "event_count": len(LOCAL_TOOL_HOOK_EVENTS),
        "total_scripts": total_scripts,
        "events": events,
    }


def run_hook_event(event_name: str, payload: dict[str, Any], context: LocalToolContext) -> None:
    policy = context.hook_policy
    if not policy.enabled:
        return

    scripts = discover_hook_scripts(event_name, context)
    if not scripts:
        return

    timeout_secs = max(1, min(LOCAL_TOOL_HOOK_TIMEOUT_MAX_SECS, policy.timeout_secs))
    payload_json = json.dumps(payload, ensure_ascii=False)
    failures: list[str] = []

    for script in scripts:
        if not os.access(script, os.X_OK):
            failures.append(f"{script} is not executable")
            continue
        env = os.environ.copy()
        env["GROBOT_HOOK_EVENT"] = event_name
        env["GROBOT_HOOK_WORK_DIR"] = str(context.work_dir)
        env["GROBOT_HOOK_TIMEOUT_SECS"] = str(timeout_secs)
        try:
            completed = subprocess.run(
                [str(script)],
                cwd=str(context.work_dir),
                input=payload_json,
                text=True,
                capture_output=True,
                timeout=timeout_secs,
                env=env,
                check=False,
            )
        except subprocess.TimeoutExpired:
            failures.append(f"{script} timed out after {timeout_secs}s")
            continue
        except OSError as exc:
            failures.append(f"{script} failed to start: {exc}")
            continue

        if completed.returncode != 0:
            stderr_preview = truncate_text(
                (completed.stderr or "").strip(),
                limit=LOCAL_TOOL_HOOK_OUTPUT_PREVIEW_LIMIT,
            )
            stdout_preview = truncate_text(
                (completed.stdout or "").strip(),
                limit=LOCAL_TOOL_HOOK_OUTPUT_PREVIEW_LIMIT,
            )
            detail = stderr_preview or stdout_preview or "no output"
            failures.append(f"{script} exited with code {completed.returncode}: {detail}")

    for failure in failures:
        print(f"[hook] {event_name}: {failure}", file=sys.stderr)
    if failures and policy.strict:
        raise RuntimeError(f'hook "{event_name}" failed: {failures[0]}')


def resolve_retrieval_remote(
    raw_cfg: Any,
    *,
    default_model: str,
    env_model: str,
    env_api_key: str,
    fallback_api_key: str | None,
    env_base_url: str,
    fallback_base_url: str,
) -> RetrievalRemoteConfig | None:
    cfg = raw_cfg if isinstance(raw_cfg, dict) else {}
    enabled = parse_bool_option(cfg.get("enabled"), True)
    if not enabled:
        return None

    model = os.getenv(env_model) or cfg.get("model") or default_model
    if not isinstance(model, str) or not model.strip():
        return None
    base_url = os.getenv(env_base_url) or cfg.get("base_url") or fallback_base_url
    if not isinstance(base_url, str) or not base_url.strip():
        return None
    api_key = os.getenv(env_api_key) or cfg.get("api_key") or fallback_api_key
    if not isinstance(api_key, str) or not api_key.strip():
        return None
    return RetrievalRemoteConfig(
        base_url=base_url.rstrip("/"),
        api_key=api_key.strip(),
        model=model.strip(),
    )


def resolve_context_retrieval_config(
    project_toml: dict[str, Any],
    fallback_api_key: str | None,
) -> ContextRetrievalConfig:
    retrieval_cfg = project_toml.get("context_retrieval")
    cfg = retrieval_cfg if isinstance(retrieval_cfg, dict) else {}
    enabled = parse_bool_option(os.getenv("GROBOT_CONTEXT_RETRIEVAL_ENABLED"), True)
    enabled = parse_bool_option(cfg.get("enabled"), enabled)

    selected_limit = parse_positive_int_option(
        cfg.get("selected_limit"),
        HISTORY_RETRIEVAL_MAX_ITEMS,
        1,
        32,
    )
    candidate_limit = parse_positive_int_option(
        cfg.get("candidate_limit"),
        HISTORY_RETRIEVAL_REMOTE_MAX_CANDIDATES,
        selected_limit,
        64,
    )
    base_url = str(cfg.get("base_url") or DEFAULT_RETRIEVAL_BASE_URL).rstrip("/")
    embedding_cfg = cfg.get("embedding")
    rerank_cfg = cfg.get("rerank")
    shared_api_key = os.getenv("GROBOT_RETRIEVAL_API_KEY")
    shared_base_url = os.getenv("GROBOT_RETRIEVAL_BASE_URL") or base_url

    embedding = resolve_retrieval_remote(
        embedding_cfg,
        default_model=DEFAULT_RETRIEVAL_EMBEDDING_MODEL,
        env_model="GROBOT_EMBEDDING_MODEL",
        env_api_key="GROBOT_EMBEDDING_API_KEY",
        fallback_api_key=shared_api_key or fallback_api_key,
        env_base_url="GROBOT_EMBEDDING_BASE_URL",
        fallback_base_url=shared_base_url,
    )
    rerank = resolve_retrieval_remote(
        rerank_cfg,
        default_model=DEFAULT_RETRIEVAL_RERANK_MODEL,
        env_model="GROBOT_RERANK_MODEL",
        env_api_key="GROBOT_RERANK_API_KEY",
        fallback_api_key=shared_api_key or fallback_api_key,
        env_base_url="GROBOT_RERANK_BASE_URL",
        fallback_base_url=shared_base_url,
    )

    return ContextRetrievalConfig(
        enabled=enabled,
        candidate_limit=candidate_limit,
        selected_limit=selected_limit,
        embedding=embedding,
        rerank=rerank,
    )


def resolve_skill_router_config(project_toml: dict[str, Any]) -> SkillRouterConfig:
    skills_cfg = project_toml.get("skills")
    skill_cfg = skills_cfg if isinstance(skills_cfg, dict) else {}
    router_cfg_raw = skill_cfg.get("router")
    router_cfg = router_cfg_raw if isinstance(router_cfg_raw, dict) else {}
    runtime_cfg_raw = skill_cfg.get("runtime")
    runtime_cfg = runtime_cfg_raw if isinstance(runtime_cfg_raw, dict) else {}
    observability_cfg_raw = skill_cfg.get("observability")
    observability_cfg = observability_cfg_raw if isinstance(observability_cfg_raw, dict) else {}
    observability_path = None
    raw_observability_path = observability_cfg.get("path")
    if isinstance(raw_observability_path, str):
        stripped = raw_observability_path.strip()
        if stripped:
            observability_path = stripped

    return SkillRouterConfig(
        enabled=parse_bool_option(router_cfg.get("enabled"), True),
        descriptor_scan_lines=parse_positive_int_option(
            runtime_cfg.get("descriptor_scan_lines"),
            SKILL_DESCRIPTOR_MAX_SCAN_LINES,
            40,
            500,
        ),
        max_descriptors=parse_positive_int_option(
            runtime_cfg.get("max_descriptors"),
            SKILL_DESCRIPTOR_MAX_ITEMS,
            1,
            256,
        ),
        score_threshold=parse_float_option(
            router_cfg.get("score_threshold"),
            SKILL_ROUTER_SCORE_THRESHOLD,
            0.0,
            10.0,
        ),
        min_score_gap=parse_float_option(
            router_cfg.get("min_score_gap"),
            SKILL_ROUTER_MIN_SCORE_GAP,
            0.0,
            5.0,
        ),
        max_skill_block_chars=parse_positive_int_option(
            runtime_cfg.get("max_skill_block_chars"),
            SKILL_ROUTER_MAX_BLOCK_CHARS,
            500,
            40000,
        ),
        observability_enabled=parse_bool_option(
            observability_cfg.get("enabled"),
            SKILL_ROUTER_OBSERVABILITY_ENABLED,
        ),
        observability_path=observability_path,
    )


def allow_all_tokens(allow_tokens: tuple[str, ...]) -> bool:
    return "all" in allow_tokens


def is_local_tool_allowed(tool_name: str, context: LocalToolContext) -> bool:
    if allow_all_tokens(context.allow_tokens):
        return True
    if tool_name in {
        LOCAL_TOOL_READ,
        LOCAL_TOOL_WRITE,
        LOCAL_TOOL_EDIT,
        LOCAL_TOOL_LIST,
        LOCAL_TOOL_GLOB,
        LOCAL_TOOL_SEARCH,
        LOCAL_TOOL_MCP_SERVERS,
        LOCAL_TOOL_MCP_CALL,
    }:
        return tool_name in context.allow_tokens
    if tool_name == LOCAL_TOOL_BASH:
        return (
            LOCAL_TOOL_BASH in context.allow_tokens
            or "shell" in context.allow_tokens
        )
    return False


def ensure_local_tool_allowed(tool_name: str, context: LocalToolContext) -> None:
    if not is_local_tool_allowed(tool_name, context):
        raise RuntimeError(
            f'Tool "{tool_name}" is not allowed by [tools].allow in .grobot/project.toml'
        )


def resolve_path_in_work_dir(work_dir: Path, raw_path: Any) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise RuntimeError("path is required")
    candidate = Path(raw_path.strip()).expanduser()
    if not candidate.is_absolute():
        candidate = work_dir / candidate
    resolved = candidate.resolve()
    root = work_dir.resolve()
    if resolved != root and root not in resolved.parents:
        raise RuntimeError(f"path out of work_dir boundary: {raw_path}")
    return resolved


def resolve_path_or_work_dir(work_dir: Path, raw_path: Any) -> Path:
    if raw_path is None:
        return work_dir.resolve()
    return resolve_path_in_work_dir(work_dir, raw_path)


def resolve_tool_limit(raw_limit: Any, default_limit: int, max_limit: int) -> int:
    if isinstance(raw_limit, int) and raw_limit > 0:
        return min(raw_limit, max_limit)
    return default_limit


def normalize_list_kind(raw_kind: Any) -> str:
    if not isinstance(raw_kind, str):
        return "all"
    kind = raw_kind.strip().lower()
    if kind in {"all", "file", "dir"}:
        return kind
    raise RuntimeError('kind must be "all", "file", or "dir"')


def is_hidden_relative_path(path: Path) -> bool:
    return any(part.startswith(".") for part in path.parts if part not in {"", "."})


def list_entries_with_fd(
    *,
    base_path: Path,
    pattern: str,
    kind: str,
    include_hidden: bool,
    limit: int,
) -> tuple[list[dict[str, Any]], str]:
    cmd = [
        "fd",
        "--color",
        "never",
        "--glob",
        "--base-directory",
        str(base_path),
        "--max-results",
        str(limit),
    ]
    if include_hidden:
        cmd.extend(["--hidden", "--no-ignore"])
    if kind == "file":
        cmd.extend(["--type", "f"])
    elif kind == "dir":
        cmd.extend(["--type", "d"])
    cmd.extend([pattern or "*", "."])

    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(base_path),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise RuntimeError(f"fd failed: {truncate_text(proc.stderr or proc.stdout or '')}")

    entries: list[dict[str, Any]] = []
    for line in (proc.stdout or "").splitlines():
        item = line.strip()
        if not item:
            continue
        rel = item.removeprefix("./")
        path = (base_path / rel).resolve()
        entry_kind = "dir" if path.is_dir() else "file"
        entries.append({"path": rel, "kind": entry_kind})
        if len(entries) >= limit:
            break
    return entries, "fd"


def list_entries_with_python(
    *,
    base_path: Path,
    pattern: str,
    kind: str,
    include_hidden: bool,
    limit: int,
) -> tuple[list[dict[str, Any]], str]:
    entries: list[dict[str, Any]] = []
    glob_pattern = pattern or "*"
    for node in sorted(base_path.rglob("*")):
        rel = node.relative_to(base_path)
        if not include_hidden and is_hidden_relative_path(rel):
            continue
        rel_text = rel.as_posix()
        if not fnmatch.fnmatch(rel_text, glob_pattern):
            continue
        node_kind = "dir" if node.is_dir() else "file"
        if kind == "file" and node_kind != "file":
            continue
        if kind == "dir" and node_kind != "dir":
            continue
        entries.append({"path": rel_text, "kind": node_kind})
        if len(entries) >= limit:
            break
    return entries, "python"


def tool_list_entries(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    base_path = resolve_path_or_work_dir(context.work_dir, arguments.get("path"))
    if not base_path.exists():
        raise RuntimeError(f"path does not exist: {base_path}")
    if not base_path.is_dir():
        raise RuntimeError("list path must be a directory")

    pattern_raw = arguments.get("pattern")
    pattern = pattern_raw if isinstance(pattern_raw, str) and pattern_raw.strip() else "*"
    kind = normalize_list_kind(arguments.get("kind"))
    include_hidden = bool(arguments.get("include_hidden", False))
    limit = resolve_tool_limit(
        arguments.get("limit"),
        LOCAL_TOOL_LIST_DEFAULT_LIMIT,
        LOCAL_TOOL_LIST_MAX_LIMIT,
    )

    if shutil.which("fd"):
        entries, engine = list_entries_with_fd(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )
    else:
        entries, engine = list_entries_with_python(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )

    return {
        "base_path": str(base_path),
        "pattern": pattern,
        "kind": kind,
        "include_hidden": include_hidden,
        "limit": limit,
        "engine": engine,
        "count": len(entries),
        "entries": entries,
    }


def tool_glob_entries(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    base_path = resolve_path_or_work_dir(context.work_dir, arguments.get("path"))
    if not base_path.exists():
        raise RuntimeError(f"path does not exist: {base_path}")
    if not base_path.is_dir():
        raise RuntimeError("glob path must be a directory")

    pattern_raw = arguments.get("pattern")
    if not isinstance(pattern_raw, str) or not pattern_raw.strip():
        raise RuntimeError("pattern must be non-empty string")
    pattern = pattern_raw.strip()
    kind = normalize_list_kind(arguments.get("kind"))
    include_hidden = bool(arguments.get("include_hidden", False))
    limit = resolve_tool_limit(
        arguments.get("limit"),
        LOCAL_TOOL_GLOB_DEFAULT_LIMIT,
        LOCAL_TOOL_GLOB_MAX_LIMIT,
    )

    if shutil.which("fd"):
        entries, engine = list_entries_with_fd(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )
    else:
        entries, engine = list_entries_with_python(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )

    return {
        "base_path": str(base_path),
        "pattern": pattern,
        "kind": kind,
        "include_hidden": include_hidden,
        "limit": limit,
        "engine": engine,
        "count": len(entries),
        "matches": [entry["path"] for entry in entries],
    }


def resolve_context_lines(raw_value: Any) -> int:
    if isinstance(raw_value, int) and raw_value >= 0:
        return min(raw_value, LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES)
    return 0


def search_with_rg(
    *,
    base_path: Path,
    work_dir: Path,
    query: str,
    glob_pattern: str,
    use_regex: bool,
    case_sensitive: bool,
    include_hidden: bool,
    limit: int,
    context_before: int,
    context_after: int,
) -> tuple[list[dict[str, Any]], str, int]:
    cmd = [
        "rg",
        "--json",
        "--color",
        "never",
        "--max-count",
        str(limit),
    ]
    if not case_sensitive:
        cmd.append("-i")
    if not use_regex:
        cmd.append("-F")
    if include_hidden:
        cmd.extend(["--hidden", "--no-ignore"])
    if context_before > 0:
        cmd.extend(["-B", str(context_before)])
    if context_after > 0:
        cmd.extend(["-A", str(context_after)])
    if glob_pattern:
        cmd.extend(["-g", glob_pattern])
    cmd.extend([query, str(base_path)])

    proc = subprocess.run(  # noqa: S603
        cmd,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise RuntimeError(f"rg failed: {truncate_text(proc.stderr or proc.stdout or '')}")

    matches: list[dict[str, Any]] = []
    match_count = 0
    for raw_event in (proc.stdout or "").splitlines():
        try:
            event = json.loads(raw_event)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        if event_type not in {"match", "context"}:
            continue
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        path_obj = data.get("path")
        if not isinstance(path_obj, dict):
            continue
        path_text = path_obj.get("text")
        if not isinstance(path_text, str) or not path_text:
            continue
        line_no = data.get("line_number")
        if not isinstance(line_no, int) or line_no <= 0:
            continue
        lines_obj = data.get("lines")
        content = lines_obj.get("text") if isinstance(lines_obj, dict) else ""
        if not isinstance(content, str):
            content = ""
        content = content.rstrip("\r\n")
        column = 0
        is_match = event_type == "match"
        if is_match:
            column = 1
            submatches = data.get("submatches")
            if isinstance(submatches, list) and submatches:
                first_submatch = submatches[0]
                if isinstance(first_submatch, dict):
                    start_col = first_submatch.get("start")
                    if isinstance(start_col, int) and start_col >= 0:
                        column = start_col + 1
            match_count += 1
        path = Path(path_text)
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()
        matches.append(
            {
                "path": relativize_to_work_dir(path, work_dir),
                "line": line_no,
                "column": column,
                "text": truncate_text(content, limit=300),
                "match": is_match,
            }
        )
    return matches, "rg", match_count


def relativize_to_work_dir(path: Path, work_dir: Path) -> str:
    try:
        return path.resolve().relative_to(work_dir.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def iter_search_files(base_path: Path, include_hidden: bool) -> list[Path]:
    if base_path.is_file():
        return [base_path]
    files: list[Path] = []
    for node in base_path.rglob("*"):
        if not node.is_file():
            continue
        rel = node.relative_to(base_path)
        if not include_hidden and is_hidden_relative_path(rel):
            continue
        files.append(node)
    return files


def search_with_python(
    *,
    base_path: Path,
    work_dir: Path,
    query: str,
    glob_pattern: str,
    use_regex: bool,
    case_sensitive: bool,
    include_hidden: bool,
    limit: int,
    context_before: int,
    context_after: int,
) -> tuple[list[dict[str, Any]], str, int]:
    files = iter_search_files(base_path, include_hidden)
    matches: list[dict[str, Any]] = []
    regex = None
    if use_regex:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(query, flags=flags)
        except re.error as exc:
            raise RuntimeError(f"invalid regex: {exc}") from exc
    needle = query if case_sensitive else query.lower()
    match_count = 0

    def append_record(path_value: Path, line_no: int, column: int, line_text: str, is_match: bool) -> None:
        matches.append(
            {
                "path": relativize_to_work_dir(path_value, work_dir),
                "line": line_no,
                "column": column,
                "text": truncate_text(line_text, limit=300),
                "match": is_match,
            }
        )

    for file_path in files:
        rel_to_scope = (
            file_path.relative_to(base_path).as_posix()
            if base_path.is_dir()
            else file_path.name
        )
        if glob_pattern and not fnmatch.fnmatch(rel_to_scope, glob_pattern):
            continue
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = content.splitlines()
        total_lines = len(lines)
        for idx, line in enumerate(lines, start=1):
            column = -1
            if regex is not None:
                found = regex.search(line)
                if found is not None:
                    column = found.start() + 1
            else:
                hay = line if case_sensitive else line.lower()
                pos = hay.find(needle)
                if pos >= 0:
                    column = pos + 1
            if column < 0:
                continue
            match_count += 1
            if context_before <= 0 and context_after <= 0:
                append_record(file_path, idx, column, line, True)
            else:
                start_line = max(1, idx - context_before)
                end_line = min(total_lines, idx + context_after)
                for context_line_no in range(start_line, end_line + 1):
                    context_line_text = lines[context_line_no - 1]
                    is_match_line = context_line_no == idx
                    append_record(
                        file_path,
                        context_line_no,
                        column if is_match_line else 0,
                        context_line_text,
                        is_match_line,
                    )
            if match_count >= limit:
                return matches, "python", match_count
    return matches, "python", match_count


def tool_search_text(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    query = arguments.get("query")
    if not isinstance(query, str) or not query.strip():
        raise RuntimeError("query must be non-empty string")
    base_path = resolve_path_or_work_dir(context.work_dir, arguments.get("path"))
    if not base_path.exists():
        raise RuntimeError(f"path does not exist: {base_path}")

    glob_pattern_raw = arguments.get("glob")
    glob_pattern = glob_pattern_raw.strip() if isinstance(glob_pattern_raw, str) else ""
    use_regex = bool(arguments.get("regex", False))
    case_sensitive = bool(arguments.get("case_sensitive", False))
    include_hidden = bool(arguments.get("include_hidden", False))
    context_before = resolve_context_lines(arguments.get("context_before"))
    context_after = resolve_context_lines(arguments.get("context_after"))
    limit = resolve_tool_limit(
        arguments.get("limit"),
        LOCAL_TOOL_SEARCH_DEFAULT_LIMIT,
        LOCAL_TOOL_SEARCH_MAX_LIMIT,
    )

    if shutil.which("rg"):
        try:
            matches, engine, match_count = search_with_rg(
                base_path=base_path,
                work_dir=context.work_dir,
                query=query,
                glob_pattern=glob_pattern,
                use_regex=use_regex,
                case_sensitive=case_sensitive,
                include_hidden=include_hidden,
                limit=limit,
                context_before=context_before,
                context_after=context_after,
            )
        except RuntimeError:
            matches, engine, match_count = search_with_python(
                base_path=base_path,
                work_dir=context.work_dir,
                query=query,
                glob_pattern=glob_pattern,
                use_regex=use_regex,
                case_sensitive=case_sensitive,
                include_hidden=include_hidden,
                limit=limit,
                context_before=context_before,
                context_after=context_after,
            )
    else:
        matches, engine, match_count = search_with_python(
            base_path=base_path,
            work_dir=context.work_dir,
            query=query,
            glob_pattern=glob_pattern,
            use_regex=use_regex,
            case_sensitive=case_sensitive,
            include_hidden=include_hidden,
            limit=limit,
            context_before=context_before,
            context_after=context_after,
        )

    return {
        "base_path": str(base_path),
        "query": query,
        "glob": glob_pattern or None,
        "regex": use_regex,
        "case_sensitive": case_sensitive,
        "include_hidden": include_hidden,
        "context_before": context_before,
        "context_after": context_after,
        "limit": limit,
        "engine": engine,
        "count": match_count,
        "records": len(matches),
        "matches": matches,
    }


def tool_read_file(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    path = resolve_path_in_work_dir(context.work_dir, arguments.get("path"))
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"read failed: {exc}") from exc

    offset_raw = arguments.get("offset", 1)
    limit_raw = arguments.get("limit", LOCAL_TOOL_READ_DEFAULT_LIMIT)
    offset = offset_raw if isinstance(offset_raw, int) and offset_raw > 0 else 1
    limit = (
        limit_raw
        if isinstance(limit_raw, int) and 1 <= limit_raw <= LOCAL_TOOL_READ_MAX_LIMIT
        else LOCAL_TOOL_READ_DEFAULT_LIMIT
    )

    lines = raw.splitlines()
    total = len(lines)
    start_idx = max(offset - 1, 0)
    if start_idx >= total:
        selected: list[str] = []
    else:
        selected = lines[start_idx : start_idx + limit]
    end_line = start_idx + len(selected)
    content = "\n".join(selected)

    return {
        "path": str(path),
        "offset": offset,
        "limit": limit,
        "line_start": start_idx + 1 if selected else offset,
        "line_end": end_line if selected else offset - 1,
        "total_lines": total,
        "content": truncate_text(content),
    }


def tool_write_file(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    path = resolve_path_in_work_dir(context.work_dir, arguments.get("path"))
    content = arguments.get("content")
    if not isinstance(content, str):
        raise RuntimeError("content must be string")

    existed = path.exists()
    previous_size = path.stat().st_size if existed else 0
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"write failed: {exc}") from exc

    return {
        "path": str(path),
        "replaced": existed,
        "previous_size": previous_size,
        "bytes_written": len(content.encode("utf-8")),
    }


def tool_edit_file(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    path = resolve_path_in_work_dir(context.work_dir, arguments.get("path"))
    old_text = arguments.get("old_text")
    new_text = arguments.get("new_text")
    replace_all = arguments.get("replace_all", False)
    if not isinstance(old_text, str) or old_text == "":
        raise RuntimeError("old_text must be non-empty string")
    if not isinstance(new_text, str):
        raise RuntimeError("new_text must be string")
    if not isinstance(replace_all, bool):
        replace_all = False

    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"edit read failed: {exc}") from exc

    occurrences = raw.count(old_text)
    if occurrences <= 0:
        raise RuntimeError("old_text not found")
    if replace_all:
        updated = raw.replace(old_text, new_text)
        replacements = occurrences
    else:
        updated = raw.replace(old_text, new_text, 1)
        replacements = 1

    try:
        path.write_text(updated, encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"edit write failed: {exc}") from exc

    return {
        "path": str(path),
        "replace_all": replace_all,
        "occurrences_found": occurrences,
        "replacements": replacements,
    }


def resolve_bash_timeout_secs(raw_timeout: Any) -> int:
    if isinstance(raw_timeout, int) and raw_timeout > 0:
        return min(raw_timeout, LOCAL_TOOL_BASH_MAX_TIMEOUT_SECS)
    return LOCAL_TOOL_BASH_DEFAULT_TIMEOUT_SECS


def first_command_token(command: str) -> str | None:
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    if not parts:
        return None
    return parts[0]


def ensure_bash_command_allowed(command: str, context: LocalToolContext) -> None:
    if allow_all_tokens(context.allow_tokens):
        return
    if "shell" in context.allow_tokens or LOCAL_TOOL_BASH in context.allow_tokens:
        return
    first = first_command_token(command)
    if first and first in context.allow_tokens:
        return
    raise RuntimeError(
        f'bash command not allowed by [tools].allow: "{first or "<empty>"}"'
    )


def tool_run_bash(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    command = arguments.get("command")
    if not isinstance(command, str) or not command.strip():
        raise RuntimeError("command must be non-empty string")
    timeout_secs = resolve_bash_timeout_secs(arguments.get("timeout_secs"))
    ensure_bash_command_allowed(command, context)

    try:
        proc = subprocess.run(  # noqa: S603
            ["/bin/zsh", "-lc", command],
            cwd=str(context.work_dir),
            text=True,
            capture_output=True,
            timeout=timeout_secs,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        stderr = exc.stderr if isinstance(exc.stderr, str) else ""
        raise RuntimeError(
            f"bash timeout after {timeout_secs}s; "
            f"stdout={truncate_text(stdout)!r}; stderr={truncate_text(stderr)!r}"
        ) from exc
    except OSError as exc:
        raise RuntimeError(f"bash failed: {exc}") from exc

    return {
        "command": command,
        "exit_code": proc.returncode,
        "stdout": truncate_text(proc.stdout or ""),
        "stderr": truncate_text(proc.stderr or ""),
    }


def tool_mcp_servers(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    runtime = context.mcp_runtime if isinstance(context.mcp_runtime, dict) else None
    if runtime is None:
        runtime_summary = aggregate_mcp_runtime_summary(context, None)
        return {
            "status": "ok",
            "total": 0,
            "enabled_count": 0,
            "disabled_count": 0,
            "ready_count": 0,
            "unready_count": 0,
            "policy": {
                "max_concurrency_per_server": context.mcp_policy.max_concurrency_per_server,
                "max_queue_per_server": context.mcp_policy.max_queue_per_server,
                "failure_threshold": context.mcp_policy.failure_threshold,
                "cooldown_secs": context.mcp_policy.cooldown_secs,
                "allow_tools": list(context.mcp_policy.allow_tools)
                if isinstance(context.mcp_policy.allow_tools, tuple)
                else ["*"],
                "latency_sample_limit": context.mcp_policy.latency_sample_limit,
            },
            "runtime_summary": runtime_summary,
            "servers": [],
        }

    include_disabled = parse_bool_option(arguments.get("include_disabled"), True)
    only_ready = parse_bool_option(arguments.get("only_ready"), False)
    include_runtime_state = parse_bool_option(arguments.get("include_runtime_state"), True)

    effective_raw = runtime.get("effective")
    effective = [item for item in effective_raw if isinstance(item, dict)] if isinstance(effective_raw, list) else []
    servers: list[dict[str, Any]] = []
    for item in effective:
        enabled = bool(item.get("enabled"))
        ready = item.get("ready")
        if not include_disabled and not enabled:
            continue
        if only_ready and ready is not True:
            continue
        if include_runtime_state and isinstance(item.get("name"), str):
            state = get_mcp_server_call_state(context, str(item["name"]))
            merged = dict(item)
            merged["runtime_state"] = mcp_server_state_snapshot(state)
            servers.append(merged)
        else:
            servers.append(item)

    server_names = [str(item["name"]) for item in servers if isinstance(item.get("name"), str)]
    runtime_summary = aggregate_mcp_runtime_summary(context, server_names)

    return {
        "status": "ok",
        "total": runtime.get("total", 0),
        "enabled_count": runtime.get("enabled_count", 0),
        "disabled_count": runtime.get("disabled_count", 0),
        "ready_count": runtime.get("ready_count", 0),
        "unready_count": runtime.get("unready_count", 0),
        "policy": {
            "max_concurrency_per_server": context.mcp_policy.max_concurrency_per_server,
            "max_queue_per_server": context.mcp_policy.max_queue_per_server,
            "failure_threshold": context.mcp_policy.failure_threshold,
            "cooldown_secs": context.mcp_policy.cooldown_secs,
            "allow_tools": list(context.mcp_policy.allow_tools) if isinstance(context.mcp_policy.allow_tools, tuple) else ["*"],
            "latency_sample_limit": context.mcp_policy.latency_sample_limit,
        },
        "runtime_summary": runtime_summary,
        "servers": servers,
    }


def resolve_mcp_call_timeout_secs(raw_timeout: Any) -> int:
    if isinstance(raw_timeout, int) and raw_timeout > 0:
        return min(raw_timeout, LOCAL_TOOL_MCP_CALL_MAX_TIMEOUT_SECS)
    return LOCAL_TOOL_MCP_CALL_DEFAULT_TIMEOUT_SECS


def normalize_mcp_call_server_name(raw_value: Any) -> str:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise RuntimeError("server must be non-empty string")
    return raw_value.strip()


def normalize_mcp_call_tool_name(raw_value: Any) -> str:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise RuntimeError("tool must be non-empty string")
    return raw_value.strip()


def normalize_mcp_call_arguments(raw_value: Any) -> dict[str, Any]:
    if raw_value is None:
        return {}
    if not isinstance(raw_value, dict):
        raise RuntimeError("arguments must be object")
    return raw_value


def find_mcp_server_entry(runtime: dict[str, Any], server_name: str) -> dict[str, Any]:
    effective_raw = runtime.get("effective")
    if not isinstance(effective_raw, list):
        raise RuntimeError("MCP runtime has no effective server list")
    normalized_name = server_name.lower()
    for item in effective_raw:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str):
            continue
        if name.lower() == normalized_name:
            return item
    raise RuntimeError(f'MCP server "{server_name}" not found')


def resolve_mcp_server_process_spec(
    server: dict[str, Any],
    context: LocalToolContext,
) -> tuple[list[str], str, dict[str, str], tuple[tuple[str, str], ...]]:
    command_raw = server.get("command_resolved")
    if not isinstance(command_raw, str) or not command_raw.strip():
        command_raw = server.get("command")
    if not isinstance(command_raw, str) or not command_raw.strip():
        raise RuntimeError("MCP server command missing")

    args_raw = server.get("args")
    args: list[str] = []
    if isinstance(args_raw, list):
        args = [arg for arg in args_raw if isinstance(arg, str) and arg]

    cwd_raw = server.get("cwd")
    cwd_path = context.work_dir.resolve()
    if isinstance(cwd_raw, str) and cwd_raw.strip():
        candidate = Path(cwd_raw).expanduser()
        if not candidate.is_absolute():
            candidate = (context.work_dir / candidate).resolve()
        cwd_path = candidate.resolve()

    env = os.environ.copy()
    env_raw = server.get("env")
    env_overrides: list[tuple[str, str]] = []
    if isinstance(env_raw, dict):
        for key, value in env_raw.items():
            if isinstance(key, str) and key.strip() and isinstance(value, str):
                env[key] = value
                env_overrides.append((key, value))

    env_overrides.sort(key=lambda item: item[0])
    return [command_raw.strip(), *args], str(cwd_path), env, tuple(env_overrides)


def mcp_session_signature(
    *,
    command: list[str],
    cwd: str,
    env_overrides: tuple[tuple[str, str], ...],
) -> str:
    payload = {
        "command": command,
        "cwd": cwd,
        "env_overrides": list(env_overrides),
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def mcp_stderr_reader(session: MCPClientSession) -> None:
    try:
        while True:
            chunk = session.stderr.read(4096)
            if not chunk:
                break
            text = chunk.decode("utf-8", errors="replace")
            if not text:
                continue
            with session.stderr_lock:
                session.stderr_chunks.append(text)
                combined = "".join(session.stderr_chunks)
                if len(combined) > LOCAL_TOOL_MCP_STDERR_PREVIEW_MAX_CHARS:
                    combined = combined[-LOCAL_TOOL_MCP_STDERR_PREVIEW_MAX_CHARS :]
                session.stderr_chunks = [combined]
    except OSError:
        return


def mcp_session_stderr_preview(session: MCPClientSession) -> str:
    with session.stderr_lock:
        if not session.stderr_chunks:
            return ""
        return truncate_text(session.stderr_chunks[-1], limit=2000)


def close_mcp_session(session: MCPClientSession) -> None:
    terminate_process(session.process)
    for stream in (session.stdin, session.stdout, session.stderr):
        try:
            stream.close()
        except OSError:
            continue
    if session.stderr_thread is not None:
        session.stderr_thread.join(timeout=0.5)


def close_mcp_sessions(context: LocalToolContext) -> None:
    sessions = list(context.mcp_sessions.values())
    context.mcp_sessions.clear()
    for session in sessions:
        close_mcp_session(session)


def close_single_mcp_session(context: LocalToolContext, server_name: str) -> bool:
    key = server_name.lower()
    session = context.mcp_sessions.pop(key, None)
    if session is None:
        return False
    close_mcp_session(session)
    return True


def reset_mcp_server_call_state(state: MCPServerCallState) -> None:
    with state.condition:
        state.in_flight = 0
        state.queued = 0
        state.consecutive_failures = 0
        state.circuit_open_until = 0.0
        state.last_error = None
        state.total_calls = 0
        state.success_calls = 0
        state.failure_calls = 0
        state.retry_calls = 0
        state.recovered_calls = 0
        state.policy_denied_calls = 0
        state.gate_rejected_calls = 0
        state.timeout_failures = 0
        state.transport_failures = 0
        state.tool_failures = 0
        state.unknown_failures = 0
        state.error_buckets.clear()
        state.total_latency_ms = 0.0
        state.max_latency_ms = 0.0
        state.last_latency_ms = 0.0
        state.last_finished_at = 0.0
        state.latency_ms_samples.clear()
        state.condition.notify_all()


def reset_mcp_server_states(context: LocalToolContext, server_name: str | None = None) -> int:
    with context.mcp_server_states_lock:
        if isinstance(server_name, str) and server_name.strip():
            state = context.mcp_server_states.get(server_name.strip().lower())
            states = [state] if state is not None else []
        else:
            states = list(context.mcp_server_states.values())
    for state in states:
        reset_mcp_server_call_state(state)
    return len(states)


def get_mcp_server_call_state(context: LocalToolContext, server_name: str) -> MCPServerCallState:
    key = server_name.lower()
    with context.mcp_server_states_lock:
        existing = context.mcp_server_states.get(key)
        if existing is not None:
            return existing
        created = MCPServerCallState()
        context.mcp_server_states[key] = created
        return created


def lookup_mcp_server_call_state(context: LocalToolContext, server_name: str) -> MCPServerCallState | None:
    key = server_name.lower()
    with context.mcp_server_states_lock:
        return context.mcp_server_states.get(key)


def aggregate_mcp_runtime_summary(
    context: LocalToolContext,
    server_names: list[str] | None = None,
) -> dict[str, Any]:
    keys = {item.strip().lower() for item in server_names or [] if isinstance(item, str) and item.strip()}
    with context.mcp_server_states_lock:
        state_items = list(context.mcp_server_states.items())

    total_calls = 0
    success_calls = 0
    failure_calls = 0
    retry_calls = 0
    recovered_calls = 0
    policy_denied_calls = 0
    gate_rejected_calls = 0
    timeout_failures = 0
    transport_failures = 0
    tool_failures = 0
    unknown_failures = 0
    total_latency_ms = 0.0
    max_latency_ms = 0.0
    servers_with_circuit_open = 0
    all_latency_samples: list[float] = []
    error_totals: dict[str, int] = {}
    servers_considered = 0

    for key, state in state_items:
        if keys and key not in keys:
            continue
        with state.condition:
            servers_considered += 1
            total_calls += state.total_calls
            success_calls += state.success_calls
            failure_calls += state.failure_calls
            retry_calls += state.retry_calls
            recovered_calls += state.recovered_calls
            policy_denied_calls += state.policy_denied_calls
            gate_rejected_calls += state.gate_rejected_calls
            timeout_failures += state.timeout_failures
            transport_failures += state.transport_failures
            tool_failures += state.tool_failures
            unknown_failures += state.unknown_failures
            total_latency_ms += state.total_latency_ms
            max_latency_ms = max(max_latency_ms, state.max_latency_ms)
            all_latency_samples.extend(state.latency_ms_samples)
            if state.circuit_open_until > time.time():
                servers_with_circuit_open += 1
            for error_key, count in state.error_buckets.items():
                error_totals[error_key] = error_totals.get(error_key, 0) + count

    avg_latency_ms = (total_latency_ms / float(total_calls)) if total_calls > 0 else 0.0
    top_errors = sorted(
        error_totals.items(),
        key=lambda item: (-item[1], item[0]),
    )[:5]
    return {
        "servers_considered": servers_considered,
        "servers_with_circuit_open": servers_with_circuit_open,
        "total_calls": total_calls,
        "success_calls": success_calls,
        "failure_calls": failure_calls,
        "retry_calls": retry_calls,
        "recovered_calls": recovered_calls,
        "policy_denied_calls": policy_denied_calls,
        "gate_rejected_calls": gate_rejected_calls,
        "timeout_failures": timeout_failures,
        "transport_failures": transport_failures,
        "tool_failures": tool_failures,
        "unknown_failures": unknown_failures,
        "success_rate": round((float(success_calls) / float(total_calls)), 4) if total_calls > 0 else 0.0,
        "avg_latency_ms": normalize_latency_ms(avg_latency_ms),
        "p50_latency_ms": latency_percentile(all_latency_samples, 50.0),
        "p95_latency_ms": latency_percentile(all_latency_samples, 95.0),
        "max_latency_ms": normalize_latency_ms(max_latency_ms),
        "latency_sample_count": len(all_latency_samples),
        "top_errors": [{"error": key, "count": count} for key, count in top_errors],
    }


def acquire_mcp_server_slot(
    *,
    context: LocalToolContext,
    server_name: str,
    timeout_secs: int,
) -> MCPServerCallState:
    state = get_mcp_server_call_state(context, server_name)
    policy = context.mcp_policy
    max_concurrency = max(1, policy.max_concurrency_per_server)
    max_queue = max(1, policy.max_queue_per_server)
    deadline = time.time() + float(timeout_secs)

    with state.condition:
        while True:
            now = time.time()
            if state.circuit_open_until > now:
                left = int(max(state.circuit_open_until - now, 0))
                error_text = (
                    f'MCP server "{server_name}" circuit open ({left}s left); '
                    f'last_error={state.last_error or "unknown"}'
                )
                state.gate_rejected_calls += 1
                state.last_error = truncate_text(error_text, limit=400)
                state.last_finished_at = time.time()
                record_mcp_error_bucket(state, error_text)
                raise RuntimeError(
                    error_text
                )
            if state.in_flight < max_concurrency:
                state.in_flight += 1
                return state

            if state.queued >= max_queue:
                error_text = (
                    f'MCP server "{server_name}" queue full (in_flight={state.in_flight}, queued={state.queued})'
                )
                state.gate_rejected_calls += 1
                state.last_error = truncate_text(error_text, limit=400)
                state.last_finished_at = time.time()
                record_mcp_error_bucket(state, error_text)
                raise RuntimeError(
                    error_text
                )

            state.queued += 1
            try:
                while True:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        error_text = f'MCP server "{server_name}" queue wait timeout ({timeout_secs}s)'
                        state.gate_rejected_calls += 1
                        state.last_error = truncate_text(error_text, limit=400)
                        state.last_finished_at = time.time()
                        record_mcp_error_bucket(state, error_text)
                        raise RuntimeError(
                            error_text
                        )
                    state.condition.wait(timeout=remaining)
                    now = time.time()
                    if state.circuit_open_until > now:
                        left = int(max(state.circuit_open_until - now, 0))
                        error_text = (
                            f'MCP server "{server_name}" circuit open ({left}s left); '
                            f'last_error={state.last_error or "unknown"}'
                        )
                        state.gate_rejected_calls += 1
                        state.last_error = truncate_text(error_text, limit=400)
                        state.last_finished_at = time.time()
                        record_mcp_error_bucket(state, error_text)
                        raise RuntimeError(
                            error_text
                        )
                    if state.in_flight < max_concurrency:
                        state.in_flight += 1
                        return state
            finally:
                state.queued = max(0, state.queued - 1)


def release_mcp_server_slot(state: MCPServerCallState) -> None:
    with state.condition:
        state.in_flight = max(0, state.in_flight - 1)
        state.condition.notify_all()


def normalize_latency_ms(value: float) -> float:
    if value < 0:
        return 0.0
    return round(value, 3)


def append_mcp_latency_sample(state: MCPServerCallState, elapsed_ms: float, limit: int) -> None:
    capped_limit = max(16, min(LOCAL_TOOL_MCP_LATENCY_SAMPLE_LIMIT_MAX, limit))
    state.latency_ms_samples.append(elapsed_ms)
    overflow = len(state.latency_ms_samples) - capped_limit
    if overflow > 0:
        del state.latency_ms_samples[:overflow]


def normalize_mcp_error_key(error_text: str) -> str:
    compact = " ".join(error_text.split())
    return truncate_text(compact, limit=LOCAL_TOOL_MCP_ERROR_KEY_MAX_CHARS)


def record_mcp_error_bucket(
    state: MCPServerCallState,
    error_text: str,
    *,
    limit: int = LOCAL_TOOL_MCP_ERROR_BUCKET_LIMIT_DEFAULT,
) -> None:
    key = normalize_mcp_error_key(error_text)
    if not key:
        return
    buckets = state.error_buckets
    if key in buckets:
        buckets[key] += 1
        return
    if len(buckets) >= max(8, limit):
        # Evict the least frequent key to keep memory bounded.
        victim = min(buckets.items(), key=lambda item: item[1])[0]
        del buckets[victim]
    buckets[key] = 1


def mark_mcp_policy_denied(
    *,
    state: MCPServerCallState,
    error_text: str,
) -> None:
    with state.condition:
        state.policy_denied_calls += 1
        state.last_error = truncate_text(error_text, limit=400)
        state.last_finished_at = time.time()
        record_mcp_error_bucket(state, error_text)
        state.condition.notify_all()


def classify_mcp_failure_kind(error_text: str) -> str:
    text = error_text.lower()
    if "timeout" in text:
        return "timeout"
    if "does not expose tool" in text:
        return "tool"
    if any(
        marker in text
        for marker in (
            "stdio closed",
            "broken pipe",
            "read timeout",
            "write failed",
            "json-rpc error",
            "json-rpc read timeout",
            "json-rpc write failed",
            "invalid json-rpc response",
        )
    ):
        return "transport"
    return "unknown"


def latency_percentile(samples: list[float], percentile: float) -> float:
    if not samples:
        return 0.0
    ordered = sorted(samples)
    if len(ordered) == 1:
        return normalize_latency_ms(ordered[0])
    rank = (max(0.0, min(100.0, percentile)) / 100.0) * float(len(ordered) - 1)
    low_idx = int(math.floor(rank))
    high_idx = int(math.ceil(rank))
    if low_idx == high_idx:
        return normalize_latency_ms(ordered[low_idx])
    weight = rank - float(low_idx)
    interpolated = ordered[low_idx] * (1.0 - weight) + ordered[high_idx] * weight
    return normalize_latency_ms(interpolated)


def mark_mcp_server_call_success(
    *,
    state: MCPServerCallState,
    elapsed_ms: float,
    policy: MCPCallPolicy,
    retried: bool = False,
    recovered: bool = False,
) -> None:
    elapsed = normalize_latency_ms(elapsed_ms)
    with state.condition:
        state.total_calls += 1
        state.success_calls += 1
        if retried:
            state.retry_calls += 1
        if recovered:
            state.recovered_calls += 1
        state.total_latency_ms += elapsed
        state.max_latency_ms = max(state.max_latency_ms, elapsed)
        state.last_latency_ms = elapsed
        state.last_finished_at = time.time()
        append_mcp_latency_sample(state, elapsed, policy.latency_sample_limit)
        state.consecutive_failures = 0
        state.circuit_open_until = 0.0
        state.last_error = None


def mark_mcp_server_call_failure(
    *,
    state: MCPServerCallState,
    error_text: str,
    policy: MCPCallPolicy,
    elapsed_ms: float,
    retried: bool = False,
    recovered: bool = False,
) -> bool:
    opened = False
    elapsed = normalize_latency_ms(elapsed_ms)
    with state.condition:
        state.total_calls += 1
        state.failure_calls += 1
        if retried:
            state.retry_calls += 1
        if recovered:
            state.recovered_calls += 1
        state.total_latency_ms += elapsed
        state.max_latency_ms = max(state.max_latency_ms, elapsed)
        state.last_latency_ms = elapsed
        state.last_finished_at = time.time()
        append_mcp_latency_sample(state, elapsed, policy.latency_sample_limit)
        failure_kind = classify_mcp_failure_kind(error_text)
        if failure_kind == "timeout":
            state.timeout_failures += 1
        elif failure_kind == "transport":
            state.transport_failures += 1
        elif failure_kind == "tool":
            state.tool_failures += 1
        else:
            state.unknown_failures += 1
        state.last_error = truncate_text(error_text, limit=400)
        record_mcp_error_bucket(state, error_text)
        state.consecutive_failures += 1
        if state.consecutive_failures >= max(1, policy.failure_threshold):
            state.circuit_open_until = time.time() + float(max(1, policy.cooldown_secs))
            state.consecutive_failures = 0
            opened = True
        state.condition.notify_all()
    return opened


def mcp_server_state_snapshot(state: MCPServerCallState) -> dict[str, Any]:
    with state.condition:
        now = time.time()
        open_until = state.circuit_open_until
        circuit_open = open_until > now
        total_calls = state.total_calls
        success_calls = state.success_calls
        avg_latency_ms = (state.total_latency_ms / float(total_calls)) if total_calls > 0 else 0.0
        samples = list(state.latency_ms_samples)
        top_errors = sorted(
            state.error_buckets.items(),
            key=lambda item: (-item[1], item[0]),
        )[:3]
        return {
            "in_flight": state.in_flight,
            "queued": state.queued,
            "consecutive_failures": state.consecutive_failures,
            "circuit_open": circuit_open,
            "circuit_open_for_secs": int(max(open_until - now, 0)) if circuit_open else 0,
            "last_error": state.last_error,
            "total_calls": total_calls,
            "success_calls": success_calls,
            "failure_calls": state.failure_calls,
            "retry_calls": state.retry_calls,
            "recovered_calls": state.recovered_calls,
            "policy_denied_calls": state.policy_denied_calls,
            "gate_rejected_calls": state.gate_rejected_calls,
            "timeout_failures": state.timeout_failures,
            "transport_failures": state.transport_failures,
            "tool_failures": state.tool_failures,
            "unknown_failures": state.unknown_failures,
            "success_rate": round((float(success_calls) / float(total_calls)), 4) if total_calls > 0 else 0.0,
            "avg_latency_ms": normalize_latency_ms(avg_latency_ms),
            "p50_latency_ms": latency_percentile(samples, 50.0),
            "p95_latency_ms": latency_percentile(samples, 95.0),
            "max_latency_ms": normalize_latency_ms(state.max_latency_ms),
            "last_latency_ms": normalize_latency_ms(state.last_latency_ms),
            "last_finished_at": round(state.last_finished_at, 3) if state.last_finished_at > 0 else 0.0,
            "latency_sample_count": len(samples),
            "error_bucket_count": len(state.error_buckets),
            "top_errors": [{"error": key, "count": count} for key, count in top_errors],
        }


def next_mcp_request_id(session: MCPClientSession) -> int:
    request_id = session.next_request_id
    session.next_request_id += 1
    return request_id


def list_mcp_tools_for_session(session: MCPClientSession, timeout_secs: int) -> list[str]:
    tools_result = request_mcp_jsonrpc(
        stdin=session.stdin,
        stdout_fd=session.stdout_fd,
        buffer=session.message_buffer,
        request_id=next_mcp_request_id(session),
        method="tools/list",
        params={},
        timeout_secs=timeout_secs,
    )
    tools_raw = tools_result.get("tools") if isinstance(tools_result, dict) else None
    tools = [item for item in tools_raw if isinstance(item, dict)] if isinstance(tools_raw, list) else []
    names = [
        item["name"]
        for item in tools
        if isinstance(item.get("name"), str) and item.get("name")
    ]
    session.available_tools = tuple(names)
    return names


def create_mcp_session(
    *,
    server_name: str,
    command: list[str],
    cwd: str,
    env: dict[str, str],
    signature: str,
    timeout_secs: int,
) -> MCPClientSession:
    try:
        process = subprocess.Popen(  # noqa: S603
            command,
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
    except OSError as exc:
        raise RuntimeError(f'MCP server "{server_name}" failed to start: {exc}') from exc

    if process.stdin is None or process.stdout is None or process.stderr is None:
        terminate_process(process)
        raise RuntimeError(f'MCP server "{server_name}" stdio unavailable')

    session = MCPClientSession(
        server_name=server_name,
        signature=signature,
        process=process,
        stdin=process.stdin,
        stdout=process.stdout,
        stdout_fd=process.stdout.fileno(),
        stderr=process.stderr,
    )
    session.stderr_thread = threading.Thread(
        target=mcp_stderr_reader,
        args=(session,),
        daemon=True,
        name=f"grobot-mcp-stderr-{server_name}",
    )
    session.stderr_thread.start()

    try:
        _ = request_mcp_jsonrpc(
            stdin=session.stdin,
            stdout_fd=session.stdout_fd,
            buffer=session.message_buffer,
            request_id=next_mcp_request_id(session),
            method="initialize",
            params={
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "grobot", "version": "0.1.0"},
                "capabilities": {},
            },
            timeout_secs=timeout_secs,
        )
        notify_mcp_jsonrpc(
            stdin=session.stdin,
            method="notifications/initialized",
            params={},
        )
        list_mcp_tools_for_session(session, timeout_secs)
        return session
    except RuntimeError as exc:
        stderr_preview = mcp_session_stderr_preview(session)
        close_mcp_session(session)
        detail = f"; stderr={stderr_preview}" if stderr_preview else ""
        raise RuntimeError(f'MCP server "{server_name}" initialize failed: {exc}{detail}') from exc


def get_or_create_mcp_session(
    *,
    server_name: str,
    command: list[str],
    cwd: str,
    env: dict[str, str],
    env_overrides: tuple[tuple[str, str], ...],
    context: LocalToolContext,
    timeout_secs: int,
) -> tuple[MCPClientSession, bool, bool]:
    signature = mcp_session_signature(command=command, cwd=cwd, env_overrides=env_overrides)
    existing = context.mcp_sessions.get(server_name.lower())
    recovered = False
    if existing is not None:
        if existing.signature != signature or existing.process.poll() is not None:
            close_mcp_session(existing)
            context.mcp_sessions.pop(server_name.lower(), None)
            recovered = True
        else:
            return existing, True, False

    session = create_mcp_session(
        server_name=server_name,
        command=command,
        cwd=cwd,
        env=env,
        signature=signature,
        timeout_secs=timeout_secs,
    )
    context.mcp_sessions[server_name.lower()] = session
    return session, False, recovered


def read_fd_with_deadline(fd: int, size: int, deadline: float) -> bytes:
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            raise RuntimeError("MCP read timeout")
        ready, _, _ = select.select([fd], [], [], remaining)
        if not ready:
            raise RuntimeError("MCP read timeout")
        chunk = os.read(fd, size)
        if not chunk:
            raise RuntimeError("MCP stdio closed")
        return chunk


def read_mcp_jsonrpc_message(fd: int, buffer: bytearray, timeout_secs: int) -> dict[str, Any]:
    deadline = time.time() + float(timeout_secs)
    while b"\r\n\r\n" not in buffer:
        if len(buffer) > LOCAL_TOOL_MCP_HEADER_LIMIT:
            raise RuntimeError("MCP header too large")
        buffer.extend(read_fd_with_deadline(fd, 4096, deadline))

    header_end = buffer.find(b"\r\n\r\n")
    header_bytes = bytes(buffer[:header_end])
    del buffer[: header_end + 4]
    header_lines = header_bytes.decode("ascii", errors="replace").split("\r\n")

    content_length = None
    for line in header_lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key.strip().lower() == "content-length":
            raw_length = value.strip()
            try:
                parsed = int(raw_length)
            except ValueError as exc:
                raise RuntimeError(f"Invalid MCP Content-Length: {raw_length}") from exc
            if parsed < 0 or parsed > LOCAL_TOOL_MCP_MESSAGE_LIMIT:
                raise RuntimeError(f"MCP message size out of range: {parsed}")
            content_length = parsed
            break
    if content_length is None:
        raise RuntimeError("MCP message missing Content-Length")

    while len(buffer) < content_length:
        buffer.extend(read_fd_with_deadline(fd, content_length - len(buffer), deadline))
    body = bytes(buffer[:content_length])
    del buffer[:content_length]
    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"MCP payload is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("MCP payload must be JSON object")
    return payload


def write_mcp_jsonrpc_message(stdin: Any, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    try:
        stdin.write(header)
        stdin.write(body)
        stdin.flush()
    except BrokenPipeError as exc:
        raise RuntimeError("MCP stdin broken pipe") from exc
    except OSError as exc:
        raise RuntimeError(f"MCP write failed: {exc}") from exc


def request_mcp_jsonrpc(
    *,
    stdin: Any,
    stdout_fd: int,
    buffer: bytearray,
    request_id: int,
    method: str,
    params: dict[str, Any],
    timeout_secs: int,
) -> Any:
    write_mcp_jsonrpc_message(
        stdin,
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        },
    )
    while True:
        message = read_mcp_jsonrpc_message(stdout_fd, buffer, timeout_secs)
        if message.get("id") != request_id:
            continue
        if "error" in message:
            error = message.get("error")
            if isinstance(error, dict):
                code = error.get("code")
                msg = error.get("message")
                detail = error.get("data")
                raise RuntimeError(
                    f"MCP request {method} failed: code={code}, message={msg}, data={truncate_text(json.dumps(mask_sensitive_object(detail), ensure_ascii=False), limit=400)}"
                )
            raise RuntimeError(f"MCP request {method} failed with unknown error payload")
        return message.get("result")


def notify_mcp_jsonrpc(
    *,
    stdin: Any,
    method: str,
    params: dict[str, Any],
) -> None:
    write_mcp_jsonrpc_message(
        stdin,
        {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        },
    )


def terminate_process(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            pass


def truncate_json_preview(payload: Any, *, limit: int = LOCAL_TOOL_OUTPUT_LIMIT) -> str:
    try:
        raw = json.dumps(mask_sensitive_object(payload), ensure_ascii=False)
    except (TypeError, ValueError):
        raw = str(payload)
    return truncate_text(raw, limit=limit)


def normalize_mcp_call_result(result: Any) -> dict[str, Any]:
    normalized: dict[str, Any] = {
        "raw_preview": truncate_json_preview(result),
    }
    if not isinstance(result, dict):
        return normalized
    normalized["is_error"] = bool(result.get("isError"))
    content_raw = result.get("content")
    if isinstance(content_raw, list):
        content_items: list[dict[str, Any]] = []
        for item in content_raw[:32]:
            if isinstance(item, dict):
                safe_item: dict[str, Any] = {}
                for key, value in item.items():
                    if isinstance(value, str):
                        safe_item[key] = truncate_text(value, limit=2000)
                    elif isinstance(value, (int, float, bool)) or value is None:
                        safe_item[key] = value
                    else:
                        safe_item[key] = truncate_json_preview(value, limit=1000)
                content_items.append(safe_item)
            elif isinstance(item, str):
                content_items.append({"type": "text", "text": truncate_text(item, limit=2000)})
            else:
                content_items.append({"type": "unknown", "value": truncate_json_preview(item, limit=1000)})
        normalized["content"] = content_items
    if "structuredContent" in result:
        normalized["structured_content_preview"] = truncate_json_preview(result.get("structuredContent"))
    return normalized


def should_retry_mcp_call_error(exc: RuntimeError, session: MCPClientSession) -> bool:
    if session.process.poll() is not None:
        return True
    text = str(exc).lower()
    markers = (
        "stdio closed",
        "broken pipe",
        "read timeout",
        "write failed",
    )
    return any(marker in text for marker in markers)


def tool_mcp_call(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    runtime = context.mcp_runtime if isinstance(context.mcp_runtime, dict) else None
    if runtime is None:
        raise RuntimeError("MCP runtime is unavailable")

    server_name = normalize_mcp_call_server_name(arguments.get("server"))
    tool_name = normalize_mcp_call_tool_name(arguments.get("tool"))
    tool_name_lower = tool_name.lower()
    tool_arguments = normalize_mcp_call_arguments(arguments.get("arguments"))
    timeout_secs = resolve_mcp_call_timeout_secs(arguments.get("timeout_secs"))
    server = find_mcp_server_entry(runtime, server_name)
    if not bool(server.get("enabled")):
        raise RuntimeError(f'MCP server "{server_name}" is disabled')
    if server.get("ready") is not True:
        reason = server.get("ready_reason")
        suffix = f": {reason}" if isinstance(reason, str) and reason else ""
        raise RuntimeError(f'MCP server "{server_name}" is not ready{suffix}')
    allowed_tools = context.mcp_policy.allow_tools
    if isinstance(allowed_tools, tuple) and tool_name_lower not in allowed_tools:
        allowed_label = ", ".join(allowed_tools)
        error_text = (
            f'MCP tool "{tool_name}" blocked by [tools.mcp].allow_tools '
            f"(allowed: {allowed_label})"
        )
        policy_state = get_mcp_server_call_state(context, server_name)
        mark_mcp_policy_denied(state=policy_state, error_text=error_text)
        raise RuntimeError(error_text)

    command, cwd, env, env_overrides = resolve_mcp_server_process_spec(server, context)
    call_state = acquire_mcp_server_slot(
        context=context,
        server_name=server_name,
        timeout_secs=timeout_secs,
    )
    failure_recorded = False
    started_at = time.perf_counter()
    retried = False
    recovered_call = False

    def invoke_call(session: MCPClientSession, reused_flag: bool, recovered: bool) -> dict[str, Any]:
        available_tools = list(session.available_tools)
        if tool_name not in available_tools:
            available_tools = list_mcp_tools_for_session(session, timeout_secs)
        if tool_name not in available_tools:
            raise RuntimeError(
                f'MCP server "{server_name}" does not expose tool "{tool_name}"'
            )

        call_result = request_mcp_jsonrpc(
            stdin=session.stdin,
            stdout_fd=session.stdout_fd,
            buffer=session.message_buffer,
            request_id=next_mcp_request_id(session),
            method="tools/call",
            params={
                "name": tool_name,
                "arguments": tool_arguments,
            },
            timeout_secs=timeout_secs,
        )
        normalized_result = normalize_mcp_call_result(call_result)
        return {
            "status": "ok",
            "server": server_name,
            "tool": tool_name,
            "available_tools": available_tools,
            "timeout_secs": timeout_secs,
            "session_reused": reused_flag,
            "session_recovered": recovered,
            "session_pid": session.process.pid,
            "result": normalized_result,
        }

    try:
        session, reused, recovered_before_call = get_or_create_mcp_session(
            server_name=server_name,
            command=command,
            cwd=cwd,
            env=env,
            env_overrides=env_overrides,
            context=context,
            timeout_secs=timeout_secs,
        )
        recovered_call = recovered_before_call
        server_key = server_name.lower()
        try:
            payload = invoke_call(session, reused, recovered_before_call)
            elapsed_ms = (time.perf_counter() - started_at) * 1000.0
            mark_mcp_server_call_success(
                state=call_state,
                elapsed_ms=elapsed_ms,
                policy=context.mcp_policy,
                retried=retried,
                recovered=recovered_call,
            )
            payload["runtime_state"] = mcp_server_state_snapshot(call_state)
            return payload
        except RuntimeError as exc:
            if should_retry_mcp_call_error(exc, session):
                retried = True
                close_mcp_session(session)
                context.mcp_sessions.pop(server_key, None)
                retry_session, retry_reused, _retry_recovered = get_or_create_mcp_session(
                    server_name=server_name,
                    command=command,
                    cwd=cwd,
                    env=env,
                    env_overrides=env_overrides,
                    context=context,
                    timeout_secs=timeout_secs,
                )
                recovered_call = True
                try:
                    retry_payload = invoke_call(retry_session, retry_reused, True)
                    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
                    mark_mcp_server_call_success(
                        state=call_state,
                        elapsed_ms=elapsed_ms,
                        policy=context.mcp_policy,
                        retried=retried,
                        recovered=recovered_call,
                    )
                    retry_payload["runtime_state"] = mcp_server_state_snapshot(call_state)
                    return retry_payload
                except RuntimeError as retry_exc:
                    retry_stderr_preview = mcp_session_stderr_preview(retry_session)
                    retry_detail = f"; stderr={retry_stderr_preview}" if retry_stderr_preview else ""
                    error_text = f"{retry_exc}{retry_detail}"
                    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
                    opened = mark_mcp_server_call_failure(
                        state=call_state,
                        error_text=error_text,
                        policy=context.mcp_policy,
                        elapsed_ms=elapsed_ms,
                        retried=retried,
                        recovered=recovered_call,
                    )
                    failure_recorded = True
                    suffix = " (circuit opened)" if opened else ""
                    raise RuntimeError(f"{error_text}{suffix}") from retry_exc
            stderr_preview = mcp_session_stderr_preview(session)
            detail = f"; stderr={stderr_preview}" if stderr_preview else ""
            error_text = f"{exc}{detail}"
            elapsed_ms = (time.perf_counter() - started_at) * 1000.0
            opened = mark_mcp_server_call_failure(
                state=call_state,
                error_text=error_text,
                policy=context.mcp_policy,
                elapsed_ms=elapsed_ms,
                retried=retried,
                recovered=recovered_call,
            )
            failure_recorded = True
            suffix = " (circuit opened)" if opened else ""
            raise RuntimeError(f"{error_text}{suffix}") from exc
    except RuntimeError as exc:
        if not failure_recorded:
            elapsed_ms = (time.perf_counter() - started_at) * 1000.0
            opened = mark_mcp_server_call_failure(
                state=call_state,
                error_text=str(exc),
                policy=context.mcp_policy,
                elapsed_ms=elapsed_ms,
                retried=retried,
                recovered=recovered_call,
            )
            if opened:
                raise RuntimeError(f"{exc} (circuit opened)") from exc
        raise
    finally:
        release_mcp_server_slot(call_state)


def execute_local_tool(
    tool_name: str,
    arguments: dict[str, Any],
    context: LocalToolContext,
) -> dict[str, Any]:
    if tool_name == LOCAL_TOOL_LIST:
        ensure_local_tool_allowed(tool_name, context)
        return tool_list_entries(arguments, context)
    if tool_name == LOCAL_TOOL_GLOB:
        ensure_local_tool_allowed(tool_name, context)
        return tool_glob_entries(arguments, context)
    if tool_name == LOCAL_TOOL_SEARCH:
        ensure_local_tool_allowed(tool_name, context)
        return tool_search_text(arguments, context)
    if tool_name == LOCAL_TOOL_READ:
        ensure_local_tool_allowed(tool_name, context)
        return tool_read_file(arguments, context)
    if tool_name == LOCAL_TOOL_WRITE:
        ensure_local_tool_allowed(tool_name, context)
        return tool_write_file(arguments, context)
    if tool_name == LOCAL_TOOL_EDIT:
        ensure_local_tool_allowed(tool_name, context)
        return tool_edit_file(arguments, context)
    if tool_name == LOCAL_TOOL_BASH:
        return tool_run_bash(arguments, context)
    if tool_name == LOCAL_TOOL_MCP_SERVERS:
        ensure_local_tool_allowed(tool_name, context)
        return tool_mcp_servers(arguments, context)
    if tool_name == LOCAL_TOOL_MCP_CALL:
        ensure_local_tool_allowed(tool_name, context)
        return tool_mcp_call(arguments, context)
    raise RuntimeError(f"unsupported tool: {tool_name}")


def build_model_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_LIST,
                "description": "List files/directories under work_dir (fd preferred, python fallback).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "pattern": {"type": "string"},
                        "kind": {"type": "string", "enum": ["all", "file", "dir"]},
                        "include_hidden": {"type": "boolean"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_LIST_MAX_LIMIT},
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_GLOB,
                "description": "Glob files/directories under work_dir by pattern (fd preferred, python fallback).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "pattern": {"type": "string"},
                        "kind": {"type": "string", "enum": ["all", "file", "dir"]},
                        "include_hidden": {"type": "boolean"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_GLOB_MAX_LIMIT},
                    },
                    "required": ["pattern"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_SEARCH,
                "description": "Search text in files (ripgrep preferred, python fallback).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "path": {"type": "string"},
                        "glob": {"type": "string"},
                        "regex": {"type": "boolean"},
                        "case_sensitive": {"type": "boolean"},
                        "include_hidden": {"type": "boolean"},
                        "context_before": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES,
                        },
                        "context_after": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES,
                        },
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_SEARCH_MAX_LIMIT},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_READ,
                "description": "Read a UTF-8 text file in work_dir with line offset and limit.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "offset": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_READ_MAX_LIMIT},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_WRITE,
                "description": "Write UTF-8 content to a file in work_dir.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_EDIT,
                "description": "Edit file text by replacing old_text with new_text.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "old_text": {"type": "string"},
                        "new_text": {"type": "string"},
                        "replace_all": {"type": "boolean"},
                    },
                    "required": ["path", "old_text", "new_text"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_BASH,
                "description": "Run a shell command in work_dir and return exit_code/stdout/stderr.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "timeout_secs": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_BASH_MAX_TIMEOUT_SECS},
                    },
                    "required": ["command"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_MCP_SERVERS,
                "description": "Return effective MCP servers merged from global/project config with readiness status.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "include_disabled": {"type": "boolean"},
                        "only_ready": {"type": "boolean"},
                        "include_runtime_state": {"type": "boolean"},
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_MCP_CALL,
                "description": "Call an MCP tool over stdio (initialize -> tools/list -> tools/call).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "server": {"type": "string"},
                        "tool": {"type": "string"},
                        "arguments": {"type": "object"},
                        "timeout_secs": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": LOCAL_TOOL_MCP_CALL_MAX_TIMEOUT_SECS,
                        },
                    },
                    "required": ["server", "tool"],
                    "additionalProperties": False,
                },
            },
        },
    ]


def parse_tool_arguments(raw_arguments: Any) -> dict[str, Any]:
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if isinstance(raw_arguments, str):
        try:
            parsed = json.loads(raw_arguments)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"invalid tool arguments JSON: {exc}") from exc
        if isinstance(parsed, dict):
            return parsed
    raise RuntimeError("tool arguments must be JSON object")


def model_likely_rejects_tools(error_message: str) -> bool:
    lower = error_message.lower()
    markers = (
        "tools",
        "tool_choice",
        "tool_calls",
        "function call",
        "unsupported",
        "unknown field",
        "invalid request",
    )
    return any(marker in lower for marker in markers)


def resolve_provider_routes(provider_chain: list[ProviderConfig]) -> tuple[list[ProviderRoute], list[str]]:
    routes: list[ProviderRoute] = []
    skipped: list[str] = []
    for provider in provider_chain:
        try:
            model = resolve_model_or_raise(provider)
        except RuntimeError as exc:
            skipped.append(f"{provider.name}: {exc}")
            continue
        routes.append(ProviderRoute(provider=provider, model=model))
    return routes, skipped


def call_with_failover(
    *,
    routes: list[ProviderRoute],
    messages: list[dict[str, str]],
    tool_context: LocalToolContext,
    policy: CircuitPolicy,
    enable_probe_recovery: bool,
) -> tuple[str, ProviderRoute, list[str]]:
    errors: list[str] = []
    for route in routes:
        is_open, open_until = circuit_is_open(route)
        if is_open:
            left_secs = int(max(open_until - time.time(), 0))
            errors.append(f"{route_display_name(route)}: circuit_open ({left_secs}s left)")
            continue

        if open_until > 0 and not is_open and enable_probe_recovery:
            ok, detail = probe_provider_health(route.provider)
            if not ok:
                state = circuit_get(route)
                state["open_until"] = time.time() + float(policy.cooldown_secs)
                errors.append(f"{route_display_name(route)}: recovery_probe_failed: {detail}")
                continue
            circuit_mark_success(route)

        try:
            reply = call_model_with_messages_or_raise(
                route.provider,
                route.model,
                messages,
                tool_context,
            )
            circuit_mark_success(route)
            return reply, route, errors
        except RuntimeError as exc:
            opened = circuit_mark_failure(route, policy)
            suffix = " (circuit_opened)" if opened else ""
            errors.append(f"{route_display_name(route)}: {exc}{suffix}")
            continue
    fail("All providers failed: " + " | ".join(errors[:3]))
    return "", routes[0], errors


def mask_secret(secret: str) -> str:
    if not secret:
        return "<empty>"
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}...{secret[-4:]}"


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_bind_address(bind: str) -> tuple[str, int]:
    host, sep, port_text = bind.rpartition(":")
    if sep == "" or not host or not port_text:
        fail(f'Invalid bind address "{bind}". Expected format: host:port')
    try:
        port = int(port_text)
    except ValueError:
        fail(f'Invalid port in bind address "{bind}"')
        return "", 0
    if port < 1 or port > 65535:
        fail(f'Port out of range in bind address "{bind}"')
    return host, port


def normalize_management_actions(raw_actions: Any) -> tuple[str, ...]:
    if not isinstance(raw_actions, (list, tuple)):
        return MANAGEMENT_ACTION_ALL

    normalized: list[str] = []
    for item in raw_actions:
        if not isinstance(item, str):
            continue
        token = item.strip().lower()
        if token in {"*", "all"}:
            return MANAGEMENT_ACTION_ALL
        if token in MANAGEMENT_ACTION_ALL and token not in normalized:
            normalized.append(token)
    return tuple(normalized)


def normalize_interrupt_prefixes(raw_prefixes: Any) -> tuple[str, ...]:
    if not isinstance(raw_prefixes, (list, tuple)):
        return ()
    normalized: list[str] = []
    for item in raw_prefixes:
        if not isinstance(item, str):
            continue
        prefix = item.strip()
        if prefix and prefix not in normalized:
            normalized.append(prefix)
    return tuple(normalized)


def normalize_config_sections(raw_sections: Any) -> tuple[str, ...] | None:
    if not isinstance(raw_sections, (list, tuple)):
        return None
    normalized: list[str] = []
    for item in raw_sections:
        if not isinstance(item, str):
            continue
        token = item.strip().lower()
        if token in {"*", "all"}:
            return None
        if token in CONFIG_SECTION_ALL and token not in normalized:
            normalized.append(token)
    return tuple(normalized)


def normalize_config_profile(raw_profile: Any) -> str | None:
    if not isinstance(raw_profile, str):
        return None
    normalized = raw_profile.strip().lower()
    return normalized if normalized else None


def normalize_policy_template(raw_template: Any) -> str | None:
    if not isinstance(raw_template, str):
        return None
    normalized = raw_template.strip().lower()
    return normalized if normalized else None


def resolve_management_policy_template(raw_template: Any, scope: str) -> dict[str, Any]:
    template = normalize_policy_template(raw_template)
    if template is None:
        return {}
    defaults = POLICY_TEMPLATE_DEFAULTS.get(template)
    if defaults is None:
        fail(
            f'Unknown policy template "{template}" for {scope}. '
            f"Supported: {', '.join(POLICY_TEMPLATE_ALL)}"
        )
    return defaults


def resolve_config_sections_by_profile(raw_profile: Any, scope: str) -> tuple[str, ...] | None:
    profile = normalize_config_profile(raw_profile)
    if profile is None:
        return None
    if profile not in CONFIG_PROFILE_SECTION_MAP:
        fail(
            f'Unknown config profile "{profile}" for {scope}. '
            f"Supported: {', '.join(CONFIG_PROFILE_ALL)}"
        )
    return CONFIG_PROFILE_SECTION_MAP[profile]


def build_management_credential(
    *,
    token: Any,
    source: str,
    name: str,
    raw_policy_template: Any = None,
    raw_actions: Any = None,
    raw_interrupt_prefixes: Any = None,
    raw_config_sections: Any = None,
    raw_config_profile: Any = None,
) -> ManagementCredential | None:
    if not isinstance(token, str) or not token.strip():
        return None
    template_defaults = resolve_management_policy_template(
        raw_policy_template,
        f'management credential "{name}"',
    )

    resolved_raw_actions = raw_actions
    if not isinstance(resolved_raw_actions, (list, tuple)):
        resolved_raw_actions = template_defaults.get("actions")

    resolved_raw_interrupt_prefixes = raw_interrupt_prefixes
    if not isinstance(resolved_raw_interrupt_prefixes, (list, tuple)):
        resolved_raw_interrupt_prefixes = template_defaults.get("interrupt_session_prefixes")

    resolved_raw_config_sections = raw_config_sections
    if not isinstance(resolved_raw_config_sections, (list, tuple)):
        resolved_raw_config_sections = template_defaults.get("config_sections")

    resolved_raw_config_profile = raw_config_profile
    if normalize_config_profile(resolved_raw_config_profile) is None:
        resolved_raw_config_profile = template_defaults.get("config_profile")

    actions = normalize_management_actions(resolved_raw_actions)
    config_sections = normalize_config_sections(resolved_raw_config_sections)
    # Explicit section list (including ["all"]) has higher priority than profile preset.
    if not isinstance(resolved_raw_config_sections, (list, tuple)):
        config_sections = resolve_config_sections_by_profile(
            resolved_raw_config_profile,
            f'management credential "{name}"',
        )

    return ManagementCredential(
        name=name,
        token=token.strip(),
        source=source,
        actions=actions,
        interrupt_session_prefixes=normalize_interrupt_prefixes(resolved_raw_interrupt_prefixes),
        config_sections=config_sections,
    )


def dedupe_management_credentials(credentials: list[ManagementCredential]) -> list[ManagementCredential]:
    deduped: list[ManagementCredential] = []
    for credential in credentials:
        if any(existing.token == credential.token for existing in deduped):
            continue
        deduped.append(credential)
    return deduped


def normalize_config_read_policy(raw_policy: Any) -> str | None:
    if not isinstance(raw_policy, str):
        return None
    normalized = raw_policy.strip().lower()
    if normalized in CONFIG_READ_POLICY_ALL:
        return normalized
    return None


def resolve_config_read_policy(
    config_toml: dict[str, Any],
    override_policy: str | None,
) -> tuple[str, str]:
    from_cli = normalize_config_read_policy(override_policy)
    if from_cli:
        return from_cli, "cli"

    from_env = normalize_config_read_policy(os.getenv("GROBOT_CONFIG_READ_POLICY"))
    if from_env:
        return from_env, "env"

    management_cfg = config_toml.get("management")
    if isinstance(management_cfg, dict):
        from_config = normalize_config_read_policy(management_cfg.get("config_read_policy"))
        if from_config:
            return from_config, "config"
    return CONFIG_READ_POLICY_AUTO, "default"


def resolve_public_config_sections(config_toml: dict[str, Any]) -> tuple[tuple[str, ...], str, str | None]:
    management_cfg = config_toml.get("management")
    if isinstance(management_cfg, dict):
        raw = management_cfg.get("public_config_sections")
        if isinstance(raw, list):
            parsed = normalize_config_sections(raw)
            if parsed is None:
                return CONFIG_SECTION_ALL, "config_sections_all", None
            return parsed, "config_sections", None

        profile_name = normalize_config_profile(management_cfg.get("public_config_profile"))
        if profile_name is not None:
            sections_from_profile = resolve_config_sections_by_profile(
                profile_name,
                "management.public_config_profile",
            )
            if sections_from_profile is None:
                return CONFIG_SECTION_ALL, "config_profile", profile_name
            return sections_from_profile, "config_profile", profile_name

    return DEFAULT_PUBLIC_CONFIG_SECTIONS, "default", CONFIG_PROFILE_OPERATOR


def is_loopback_host(host: str) -> bool:
    normalized = host.strip().lower()
    return normalized in {"127.0.0.1", "localhost", "::1"}


def resolve_effective_config_read_policy(configured_policy: str, bind_host: str) -> tuple[str, str]:
    if configured_policy == CONFIG_READ_POLICY_AUTO:
        if is_loopback_host(bind_host):
            return CONFIG_READ_POLICY_PUBLIC, "auto_loopback"
        return CONFIG_READ_POLICY_AUTH, "auto_non_loopback"
    return configured_policy, "explicit"


def apply_config_read_policy_state(state: dict[str, Any], bind_host: str) -> None:
    configured = state.get("config_read_policy_configured")
    if not isinstance(configured, str):
        configured = CONFIG_READ_POLICY_AUTO
    effective_policy, reason = resolve_effective_config_read_policy(configured, bind_host)
    state["config_read_policy"] = effective_policy
    state["config_read_policy_reason"] = reason


def mask_redis_url(redis_url: str | None) -> str | None:
    if not isinstance(redis_url, str) or not redis_url:
        return redis_url
    parsed = urlparse(redis_url)
    if parsed.scheme not in {"redis", "rediss"}:
        return redis_url
    if not parsed.password:
        return redis_url

    host = parsed.hostname or ""
    user = parsed.username or ""
    auth = f"{user}:{mask_secret(parsed.password)}@" if user else f":{mask_secret(parsed.password)}@"
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{auth}{host}{port}"
    return parsed._replace(netloc=netloc).geturl()


def resolve_management_credentials(
    config_toml: dict[str, Any],
    override_token: str | None,
) -> tuple[list[ManagementCredential], str]:
    if isinstance(override_token, str) and override_token.strip():
        credential = build_management_credential(
            token=override_token,
            source="cli",
            name="cli_override",
            raw_actions=list(MANAGEMENT_ACTION_ALL),
        )
        return ([credential] if credential else []), "cli"

    env_token = os.getenv("GROBOT_MANAGEMENT_TOKEN", "").strip()
    if env_token:
        credential = build_management_credential(
            token=env_token,
            source="env",
            name="env_token",
            raw_actions=list(MANAGEMENT_ACTION_ALL),
        )
        return ([credential] if credential else []), "env"

    management_cfg = config_toml.get("management")
    if not isinstance(management_cfg, dict):
        return [], "none"

    credentials: list[ManagementCredential] = []
    source_tokens: list[str] = []

    tokens_cfg = management_cfg.get("tokens")
    if isinstance(tokens_cfg, list):
        for index, item in enumerate(tokens_cfg):
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            credential = build_management_credential(
                token=item.get("token"),
                source="config_tokens",
                name=name if isinstance(name, str) and name.strip() else f"token_{index + 1}",
                raw_policy_template=item.get("policy_template"),
                raw_actions=item.get("actions"),
                raw_interrupt_prefixes=item.get("interrupt_session_prefixes"),
                raw_config_sections=item.get("config_sections"),
                raw_config_profile=item.get("config_profile"),
            )
            if credential is not None:
                credentials.append(credential)
        if credentials:
            source_tokens.append("config_tokens")

    single = build_management_credential(
        token=management_cfg.get("token"),
        source="config",
        name="management.token",
        raw_policy_template=management_cfg.get("policy_template"),
        raw_actions=management_cfg.get("actions"),
        raw_interrupt_prefixes=management_cfg.get("interrupt_session_prefixes"),
        raw_config_sections=management_cfg.get("config_sections"),
        raw_config_profile=management_cfg.get("config_profile"),
    )
    if single is not None:
        credentials.append(single)
        source_tokens.append("config")

    credentials = dedupe_management_credentials(credentials)
    if not credentials:
        return [], "none"
    return credentials, "+".join(source_tokens) if source_tokens else "config"


def get_management_bind(project_toml: dict[str, Any], bind_override: str | None) -> str:
    if bind_override:
        return bind_override

    gateway = project_toml.get("gateway")
    if isinstance(gateway, dict):
        management = gateway.get("management")
        if isinstance(management, dict):
            bind = management.get("bind")
            if isinstance(bind, str) and bind:
                return bind
    return "127.0.0.1:8080"


def summarize_provider_routing(project_toml: dict[str, Any]) -> dict[str, Any]:
    routing = project_toml.get("provider_routing")
    if not isinstance(routing, dict):
        return {
            "enabled": False,
            "reason": "provider_routing not configured in .grobot/project.toml",
        }

    groups_raw = routing.get("groups")
    groups_summary: list[dict[str, Any]] = []
    if isinstance(groups_raw, list):
        for group in groups_raw:
            if not isinstance(group, dict):
                continue
            targets_raw = group.get("targets")
            targets_summary: list[dict[str, Any]] = []
            if isinstance(targets_raw, list):
                for target in targets_raw:
                    if not isinstance(target, dict):
                        continue
                    provider = target.get("provider")
                    weight = target.get("weight")
                    if isinstance(provider, str) and provider:
                        targets_summary.append(
                            {
                                "provider": provider,
                                "weight": weight if isinstance(weight, int) else None,
                            }
                        )

            groups_summary.append(
                {
                    "name": group.get("name") if isinstance(group.get("name"), str) else None,
                    "model_class": group.get("model_class")
                    if isinstance(group.get("model_class"), str)
                    else None,
                    "targets": targets_summary,
                }
            )

    fallback_order = routing.get("fallback_order")
    fallback_summary = fallback_order if isinstance(fallback_order, list) else []
    default_group = routing.get("default_group") if isinstance(routing.get("default_group"), str) else None

    return {
        "enabled": True,
        "default_group": default_group,
        "fallback_order": fallback_summary,
        "groups": groups_summary,
    }


def build_management_status_payload(
    *,
    runtime_paths: RuntimePaths,
    project_toml: dict[str, Any],
    selection: ProjectSelection,
    session_key: str,
    bind: str,
) -> dict[str, Any]:
    session_cfg = project_toml.get("session")
    runtime_cfg = project_toml.get("runtime")
    gateway_cfg = project_toml.get("gateway")
    runtime_storage_cfg = runtime_cfg.get("storage") if isinstance(runtime_cfg, dict) else None
    hook_policy = resolve_hook_policy(project_toml)

    management_enabled = None
    if isinstance(gateway_cfg, dict):
        management = gateway_cfg.get("management")
        if isinstance(management, dict):
            enabled = management.get("enabled")
            if isinstance(enabled, bool):
                management_enabled = enabled

    return {
        "status": "ok",
        "service": "grobot-management",
        "timestamp": now_utc_iso(),
        "endpoints": {
            "status": "/api/v1/status",
        },
        "repo": str(runtime_paths.project_root),
        "project": {
            "name": selection.name,
            "schema_version": project_toml.get("schema_version"),
            "mode": project_toml.get("mode"),
        },
        "paths": {
            "home": str(runtime_paths.home),
            "project_root": str(runtime_paths.project_root),
            "project_toml": str(runtime_paths.project_toml),
            "config_toml": str(runtime_paths.config_toml),
            "sessions_root": str(runtime_paths.sessions_dir),
            "rules": {
                "global": str(runtime_paths.global_rules_dir),
                "project": str(runtime_paths.project_rules_dir),
            },
            "skills": {
                "global": str(runtime_paths.global_skills_dir),
                "project": str(runtime_paths.project_skills_dir),
            },
            "hooks": {
                "global": str(runtime_paths.global_hooks_dir),
                "project": str(runtime_paths.project_hooks_dir),
            },
            "mcp": {
                "global_registry": str(runtime_paths.global_mcp_registry),
                "project_override": str(runtime_paths.project_mcp_file),
            },
            "memory": {
                "session": str(runtime_paths.session_memory_dir),
                "project": str(runtime_paths.project_memory_dir),
                "global": str(runtime_paths.global_memory_dir),
            },
        },
        "session": {
            "platform": selection.platform,
            "work_dir": str(selection.work_dir),
            "session_preview": session_key,
            "key_format": session_cfg.get("key_format") if isinstance(session_cfg, dict) else None,
            "heartbeat_secs": session_cfg.get("heartbeat_secs") if isinstance(session_cfg, dict) else None,
        },
        "provider": {
            "name": selection.provider.name,
            "base_url": selection.provider.base_url,
            "model_config": selection.provider.model,
            "api_key_masked": mask_secret(selection.provider.api_key),
        },
        "management_api": {
            "bind": bind,
            "enabled_in_project_toml": management_enabled,
        },
        "runtime": {
            "engine": runtime_cfg.get("engine") if isinstance(runtime_cfg, dict) else None,
            "target_concurrency": runtime_cfg.get("target_concurrency")
            if isinstance(runtime_cfg, dict)
            else None,
            "workers_per_node": runtime_cfg.get("workers_per_node") if isinstance(runtime_cfg, dict) else None,
            "hot_cache": runtime_storage_cfg.get("hot_cache")
            if isinstance(runtime_storage_cfg, dict)
            else None,
            "durable_state": runtime_storage_cfg.get("durable_state")
            if isinstance(runtime_storage_cfg, dict)
            else None,
        },
        "provider_routing": summarize_provider_routing(project_toml),
        "hooks_policy": {
            "enabled": hook_policy.enabled,
            "strict": hook_policy.strict,
            "timeout_secs": hook_policy.timeout_secs,
        },
    }


def print_local_help() -> None:
    print("Local commands:")
    print("  /model    Show current provider/model/session info")
    print("  /health   Show provider circuit health")
    print("  /mcp      Show effective MCP servers")
    print("  /mcp reset <server|all>  Reset MCP gate metrics and close MCP session(s)")
    print("  /hooks    Show effective hooks and policy")
    print("  /handoff  Generate HANDOFF.md for cross-session continuation")
    print("  @file     Mention a file/path in prompt for fast resolution")
    print("  /help     Show local commands")
    print("  /exit     Quit")
    print("")


def print_model_info(provider: ProviderConfig, model: str, work_dir: Path, session_key: str) -> None:
    print("Current model context:")
    print(f"  provider:  {provider.name}")
    print(f"  model:     {model}")
    print(f"  base_url:  {provider.base_url}")
    print(f"  work_dir:  {work_dir}")
    print(f"  session:   {session_key}")
    print("")


def print_mcp_info(
    mcp_runtime: dict[str, Any],
    mcp_warnings: list[str],
    context: LocalToolContext | None = None,
) -> None:
    print("MCP runtime:")
    print(
        "  summary:   "
        f"enabled={mcp_runtime['enabled_count']}, disabled={mcp_runtime['disabled_count']}, total={mcp_runtime['total']}"
    )
    print(
        "  readiness: "
        f"ready={mcp_runtime.get('ready_count', 0)}, unready={mcp_runtime.get('unready_count', 0)}"
    )
    paths = mcp_runtime.get("paths") if isinstance(mcp_runtime, dict) else None
    if isinstance(paths, dict):
        global_registry = paths.get("global_registry")
        project_override = paths.get("project_override")
        if isinstance(global_registry, str) and isinstance(project_override, str):
            print(f"  paths:     global={global_registry} project={project_override}")
    if isinstance(context, LocalToolContext):
        policy = context.mcp_policy
        allow_tools = list(policy.allow_tools) if isinstance(policy.allow_tools, tuple) else ["*"]
        print(
            "  gate:      "
            f"concurrency={policy.max_concurrency_per_server}, "
            f"queue={policy.max_queue_per_server}, "
            f"failure_threshold={policy.failure_threshold}, "
            f"cooldown={policy.cooldown_secs}s, "
            f"allow_tools={','.join(allow_tools)}, "
            f"latency_sample_limit={policy.latency_sample_limit}"
        )
        effective_names = [
            str(item.get("name"))
            for item in (mcp_runtime.get("effective") if isinstance(mcp_runtime.get("effective"), list) else [])
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        ]
        runtime_summary = aggregate_mcp_runtime_summary(context, effective_names)
        print(
            "  totals:    "
            f"calls={runtime_summary['total_calls']} ok={runtime_summary['success_calls']} "
            f"fail={runtime_summary['failure_calls']} deny={runtime_summary['policy_denied_calls']} "
            f"gate={runtime_summary['gate_rejected_calls']} "
            f"p95={runtime_summary['p95_latency_ms']}ms"
        )
        if runtime_summary["top_errors"]:
            top_error = runtime_summary["top_errors"][0]
            print(f"  top_error: {top_error['error']} (x{top_error['count']})")
    enabled_servers = mcp_runtime.get("enabled")
    if isinstance(enabled_servers, list) and enabled_servers:
        print(f"  enabled:   {', '.join(str(item) for item in enabled_servers)}")
    unready_servers = mcp_runtime.get("unready")
    if isinstance(unready_servers, list) and unready_servers:
        print(f"  unready:   {', '.join(str(item) for item in unready_servers)}")
    effective_servers = mcp_runtime.get("effective")
    if isinstance(effective_servers, list) and effective_servers:
        print("  servers:")
        for server in effective_servers:
            if not isinstance(server, dict):
                continue
            name = server.get("name")
            source = server.get("source")
            command = server.get("command")
            command_resolved = server.get("command_resolved")
            args = server.get("args")
            enabled = server.get("enabled")
            ready = server.get("ready")
            ready_reason = server.get("ready_reason")
            if not isinstance(name, str):
                continue
            source_display = source if isinstance(source, str) and source else "unknown"
            command_display = command if isinstance(command, str) else ""
            args_display = " ".join(args) if isinstance(args, list) else ""
            resolved_display = command_resolved if isinstance(command_resolved, str) else "-"
            ready_display = (
                "ready"
                if ready is True
                else ("not-ready" if ready is False else "n/a")
            )
            reason_display = f" ({ready_reason})" if isinstance(ready_reason, str) and ready_reason else ""
            print(
                "    - "
                f"{name} ({'on' if enabled else 'off'}, {ready_display}, {source_display}) "
                f"{command_display} {args_display}".rstrip()
            )
            print(f"      resolved: {resolved_display}{reason_display}")
            if isinstance(context, LocalToolContext):
                state = lookup_mcp_server_call_state(context, name)
                if state is not None:
                    snapshot = mcp_server_state_snapshot(state)
                    print(
                        "      runtime: "
                        f"in_flight={snapshot['in_flight']} queued={snapshot['queued']} "
                        f"circuit_open={snapshot['circuit_open']} "
                        f"open_for={snapshot['circuit_open_for_secs']}s"
                    )
                    print(
                        "      metrics: "
                        f"calls={snapshot['total_calls']} ok={snapshot['success_calls']} "
                        f"fail={snapshot['failure_calls']} retry={snapshot['retry_calls']} "
                        f"recover={snapshot['recovered_calls']} "
                        f"policy_deny={snapshot['policy_denied_calls']} gate_reject={snapshot['gate_rejected_calls']} "
                        f"timeout={snapshot['timeout_failures']} transport={snapshot['transport_failures']} "
                        f"tool={snapshot['tool_failures']} unknown={snapshot['unknown_failures']} "
                        f"p50={snapshot['p50_latency_ms']}ms p95={snapshot['p95_latency_ms']}ms"
                    )
                    if isinstance(snapshot.get("last_error"), str) and snapshot["last_error"]:
                        print(f"      last_error: {snapshot['last_error']}")
    for warning in mcp_warnings:
        print(f"  warning:   {warning}")
    print("")


def print_hooks_info(context: LocalToolContext) -> None:
    runtime = summarize_hooks_runtime(context)
    policy = runtime["policy"]
    print("Hook runtime:")
    print(
        "  policy:    "
        f"enabled={policy['enabled']}, strict={policy['strict']}, timeout={policy['timeout_secs']}s"
    )
    print(
        "  paths:     "
        f"global={runtime['global_dir']} project={runtime['project_dir']}"
    )
    print(
        "  summary:   "
        f"events={runtime['event_count']} total_scripts={runtime['total_scripts']}"
    )
    events = runtime.get("events")
    if isinstance(events, dict):
        for event_name in LOCAL_TOOL_HOOK_EVENTS:
            event_payload = events.get(event_name)
            if not isinstance(event_payload, dict):
                continue
            count = event_payload.get("count")
            print(f"  {event_name}: count={count if isinstance(count, int) else 0}")
            scripts = event_payload.get("scripts")
            if isinstance(scripts, list) and scripts:
                for item in scripts:
                    if not isinstance(item, dict):
                        continue
                    scope = item.get("scope")
                    path = item.get("path")
                    if isinstance(scope, str) and isinstance(path, str):
                        print(f"    - [{scope}] {path}")
    print("")


def collect_hooks_doctor_issues(runtime: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    policy = runtime.get("policy")
    enabled = bool(policy.get("enabled")) if isinstance(policy, dict) else True

    events = runtime.get("events")
    if isinstance(events, dict):
        for event_name, event_payload in events.items():
            if not isinstance(event_name, str) or not isinstance(event_payload, dict):
                continue
            scripts = event_payload.get("scripts")
            if not isinstance(scripts, list):
                continue
            for item in scripts:
                if not isinstance(item, dict):
                    continue
                absolute_path = item.get("absolute_path")
                if not isinstance(absolute_path, str):
                    continue
                script_path = Path(absolute_path)
                if not script_path.exists():
                    issues.append(
                        {
                            "level": "error",
                            "code": "HOOK_SCRIPT_MISSING",
                            "event": event_name,
                            "path": absolute_path,
                            "message": "hook script path listed but file does not exist",
                        }
                    )
                    continue
                if not os.access(script_path, os.X_OK):
                    issues.append(
                        {
                            "level": "error",
                            "code": "HOOK_SCRIPT_NOT_EXECUTABLE",
                            "event": event_name,
                            "path": absolute_path,
                            "message": "hook script is not executable",
                        }
                    )

    total_scripts = runtime.get("total_scripts")
    if enabled and isinstance(total_scripts, int) and total_scripts == 0:
        issues.append(
            {
                "level": "warn",
                "code": "HOOKS_ENABLED_BUT_EMPTY",
                "event": None,
                "path": None,
                "message": "hooks are enabled but no scripts were found",
            }
        )
    return issues


def run_hooks_doctor(args: argparse.Namespace) -> int:
    paths = resolve_runtime_paths(
        work_dir_override=args.work_dir,
        config_override=args.config,
        home_override=args.home,
        project_root_override=args.project_root,
    )
    ensure_runtime_layout(paths)
    project_toml = load_toml(paths.project_toml)
    work_dir = (
        Path(args.work_dir).expanduser().resolve()
        if isinstance(args.work_dir, str) and args.work_dir.strip()
        else paths.project_root
    )
    configured_project_name = args.project if isinstance(args.project, str) and args.project.strip() else None
    if configured_project_name is None:
        agent_cfg = project_toml.get("agent")
        agent_id = agent_cfg.get("id") if isinstance(agent_cfg, dict) else None
        if isinstance(agent_id, str) and agent_id.strip():
            configured_project_name = agent_id.strip()
    project_name = configured_project_name or paths.project_root.name
    context = resolve_local_tool_context(
        project_toml,
        work_dir,
        runtime_paths=paths,
    )
    runtime = summarize_hooks_runtime(context)
    issues = collect_hooks_doctor_issues(runtime)
    has_error = any(item.get("level") == "error" for item in issues)
    has_warn = any(item.get("level") == "warn" for item in issues)
    status = "error" if has_error else ("warn" if has_warn else "ok")

    payload = {
        "status": status,
        "timestamp": now_utc_iso(),
        "project": project_name,
        "work_dir": str(work_dir),
        "hooks_runtime": runtime,
        "issues": issues,
    }

    if bool(getattr(args, "json_output", False)):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print("Grobot hooks doctor")
        print(f"  project:   {project_name}")
        print(f"  work_dir:  {work_dir}")
        print(
            "  policy:    "
            f"enabled={runtime['policy']['enabled']}, strict={runtime['policy']['strict']}, "
            f"timeout={runtime['policy']['timeout_secs']}s"
        )
        print(
            "  scripts:   "
            f"total={runtime['total_scripts']} events={runtime['event_count']}"
        )
        events = runtime.get("events")
        if isinstance(events, dict):
            for event_name in LOCAL_TOOL_HOOK_EVENTS:
                event_payload = events.get(event_name)
                if not isinstance(event_payload, dict):
                    continue
                count = event_payload.get("count")
                print(f"  {event_name}: {count if isinstance(count, int) else 0}")
        if not issues:
            print("  checks:    ok")
        else:
            print("  checks:")
            for issue in issues:
                level = str(issue.get("level") or "warn")
                code = str(issue.get("code") or "UNKNOWN")
                event_name = issue.get("event")
                message = str(issue.get("message") or "")
                path = issue.get("path")
                event_part = f" event={event_name}" if isinstance(event_name, str) else ""
                path_part = f" path={path}" if isinstance(path, str) else ""
                print(f"    - [{level}] {code}{event_part}{path_part}: {message}")
        print("")

    strict = bool(getattr(args, "strict", False))
    if has_error:
        return 1
    if strict and has_warn:
        return 1
    return 0


def run_hooks(args: argparse.Namespace) -> int:
    command = getattr(args, "hooks_command", "")
    if command == "doctor":
        return run_hooks_doctor(args)
    print("Usage: grobot hooks doctor [--project <name>] [--work-dir <path>] [--json]")
    return 1


def format_route_chain(routes: list[ProviderRoute]) -> str:
    return " -> ".join(f"{route.provider.name}/{route.model}" for route in routes)


def summarize_errors(errors: list[str], limit: int = 2) -> str:
    if not errors:
        return ""
    preview = errors[:limit]
    suffix = "" if len(errors) <= limit else f" ... (+{len(errors) - limit} more)"
    return " | ".join(preview) + suffix


def mention_refresh_status_message(mention_index: MentionIndexState | MentionPathIndex | None) -> str | None:
    if not isinstance(mention_index, MentionIndexState):
        return None
    status = mention_index.last_refresh_status
    if status == "scheduled":
        return "index_refresh=scheduled_async"
    if status == "inflight":
        return "index_refresh=inflight"
    if status == "pending":
        return "index_refresh=pending_snapshot"
    if status == "applied":
        return "index_refresh=applied_snapshot"
    if status == "backoff":
        return "index_refresh=backoff_after_error"
    return None


def run_status(args: argparse.Namespace) -> int:
    paths = resolve_runtime_paths(
        work_dir_override=args.work_dir,
        config_override=args.config,
        home_override=args.home,
        project_root_override=args.project_root,
    )
    ensure_runtime_layout(paths)
    project_toml = load_toml(paths.project_toml)
    config_toml = load_toml(paths.config_toml)
    selection = resolve_project(
        config=config_toml,
        project_name=args.project,
        work_dir_override=args.work_dir,
        override_provider=args.provider,
        override_api_key=args.api_key,
        override_base_url=args.base_url,
        override_model=args.model,
        config_hint=str(paths.config_toml),
    )
    session_key = build_session_key(selection.name, selection.platform, selection.work_dir)
    session_store = resolve_session_store_config(
        project_toml=project_toml,
        root=paths.project_root,
        session_root=paths.sessions_dir,
        session_backend_arg="auto",
        redis_url_arg=None,
        ttl_secs_arg=None,
    )
    mcp_policy = resolve_mcp_call_policy(project_toml)
    hook_policy = resolve_hook_policy(project_toml)
    mcp_runtime, mcp_warnings = resolve_mcp_runtime(paths)
    local_tool_context = resolve_local_tool_context(
        project_toml,
        selection.work_dir,
        mcp_runtime=mcp_runtime,
        runtime_paths=paths,
    )
    hooks_runtime = summarize_hooks_runtime(local_tool_context)

    print("Grobot status")
    print(f"  home:              {paths.home}")
    print(f"  project_root:      {paths.project_root}")
    print(f"  project_toml:      {paths.project_toml}")
    print(f"  config:            {paths.config_toml}")
    print(f"  project:           {selection.name}")
    print(f"  platform:          {selection.platform}")
    print(f"  work_dir:          {selection.work_dir}")
    print(f"  provider:          {selection.provider.name}")
    print(f"  base_url:          {selection.provider.base_url}")
    print(f"  model_config:      {selection.provider.model}")
    print(f"  api_key:           {mask_secret(selection.provider.api_key)}")
    print(f"  session_preview:   {session_key}")
    print(f"  session_store:     {session_store.backend} (ttl={session_store.ttl_secs}s)")
    print(f"  sessions_root:     {paths.sessions_dir}")
    print(f"  rules:             global={paths.global_rules_dir} project={paths.project_rules_dir}")
    print(f"  skills:            global={paths.global_skills_dir} project={paths.project_skills_dir}")
    print(f"  hooks:             global={paths.global_hooks_dir} project={paths.project_hooks_dir}")
    print(
        "  hooks_policy:      "
        f"enabled={hook_policy.enabled}, strict={hook_policy.strict}, timeout={hook_policy.timeout_secs}s"
    )
    print(
        "  hooks_runtime:     "
        f"events={hooks_runtime['event_count']} scripts={hooks_runtime['total_scripts']}"
    )
    print(
        "  mcp_gate:          "
        f"concurrency={mcp_policy.max_concurrency_per_server}, "
        f"queue={mcp_policy.max_queue_per_server}, "
        f"failures={mcp_policy.failure_threshold}, "
        f"cooldown={mcp_policy.cooldown_secs}s"
    )
    print(
        "  mcp_gate_tools:    "
        f"{','.join(mcp_policy.allow_tools) if isinstance(mcp_policy.allow_tools, tuple) else '*'}"
    )
    print(f"  mcp_latency:       sample_limit={mcp_policy.latency_sample_limit}")
    print(f"  mcp:               global={paths.global_mcp_registry} project={paths.project_mcp_file}")
    print(
        "  mcp_effective:     "
        f"enabled={mcp_runtime['enabled_count']}, disabled={mcp_runtime['disabled_count']}, "
        f"total={mcp_runtime['total']}"
    )
    print(
        "  mcp_readiness:     "
        f"ready={mcp_runtime.get('ready_count', 0)}, unready={mcp_runtime.get('unready_count', 0)}"
    )
    if isinstance(mcp_runtime.get("enabled"), list) and mcp_runtime["enabled"]:
        print(f"  mcp_enabled:       {', '.join(mcp_runtime['enabled'])}")
    if isinstance(mcp_runtime.get("unready"), list) and mcp_runtime["unready"]:
        print(f"  mcp_unready:       {', '.join(mcp_runtime['unready'])}")
    for warning in mcp_warnings:
        print(f"  mcp_warning:       {warning}")
    print(
        "  memory:            "
        f"session={paths.session_memory_dir} project={paths.project_memory_dir} global={paths.global_memory_dir}"
    )

    if not args.probe:
        print("  probe:             skipped (use --probe to verify /models)")
        return 0

    resolved_model = resolve_model(selection.provider)
    print(f"  probe:             ok")
    print(f"  model_resolved:    {resolved_model}")
    return 0


def run_serve(args: argparse.Namespace) -> int:
    def build_runtime_state() -> dict[str, Any]:
        paths = resolve_runtime_paths(
            work_dir_override=args.work_dir,
            config_override=args.config,
            home_override=args.home,
            project_root_override=args.project_root,
        )
        ensure_runtime_layout(paths)
        project_toml = load_toml(paths.project_toml)
        config_toml = load_toml(paths.config_toml)
        project_cfg = find_project(config_toml, args.project, config_hint=str(paths.config_toml))
        selection = resolve_project(
            config=config_toml,
            project_name=args.project,
            work_dir_override=args.work_dir,
            override_provider=args.provider,
            override_api_key=args.api_key,
            override_base_url=args.base_url,
            override_model=args.model,
            config_hint=str(paths.config_toml),
        )
        provider_pool = resolve_provider_pool(
            project=project_cfg,
            selected=selection.provider,
            override_api_key=args.api_key,
            override_base_url=args.base_url,
            override_model=args.model,
        )
        provider_chain = build_provider_failover_chain(
            project_toml=project_toml,
            provider_pool=provider_pool,
            selected_provider=selection.provider,
            provider_forced=bool(args.provider),
        )
        session_key = build_session_key(selection.name, selection.platform, selection.work_dir)
        session_store = resolve_session_store_config(
            project_toml=project_toml,
            root=paths.project_root,
            session_root=paths.sessions_dir,
            session_backend_arg=args.session_backend,
            redis_url_arg=args.redis_url,
            ttl_secs_arg=args.session_ttl_secs,
        )
        management_credentials, management_auth_source = resolve_management_credentials(
            config_toml, args.management_token
        )
        config_read_policy_configured, config_read_policy_source = resolve_config_read_policy(
            config_toml, args.config_read_policy
        )
        (
            public_config_sections,
            public_config_sections_source,
            public_config_sections_profile,
        ) = resolve_public_config_sections(config_toml)
        mcp_policy = resolve_mcp_call_policy(project_toml)
        mcp_runtime, mcp_warnings = resolve_mcp_runtime(paths)
        mcp_local_tool_context = resolve_local_tool_context(
            project_toml,
            selection.work_dir,
            mcp_runtime=mcp_runtime,
            runtime_paths=paths,
        )
        return {
            "paths": paths,
            "project_toml": project_toml,
            "config_toml": config_toml,
            "selection": selection,
            "session_key": session_key,
            "bind": get_management_bind(project_toml, args.bind),
            "provider_chain": provider_chain,
            "session_store": session_store,
            "management_credentials": management_credentials,
            "management_auth_source": management_auth_source,
            "config_read_policy_configured": config_read_policy_configured,
            "config_read_policy_source": config_read_policy_source,
            "public_config_sections": public_config_sections,
            "public_config_sections_source": public_config_sections_source,
            "public_config_sections_profile": public_config_sections_profile,
            "mcp_policy": mcp_policy,
            "mcp_runtime": mcp_runtime,
            "mcp_warnings": mcp_warnings,
            "mcp_local_tool_context": mcp_local_tool_context,
        }

    state = build_runtime_state()
    state["reload_count"] = 0
    state["reload_warning"] = None
    host, port = parse_bind_address(state["bind"])
    state["bind_runtime"] = f"{host}:{port}"
    apply_config_read_policy_state(state, host)

    def state_status_payload() -> dict[str, Any]:
        payload = build_management_status_payload(
            runtime_paths=state["paths"],
            project_toml=state["project_toml"],
            selection=state["selection"],
            session_key=state["session_key"],
            bind=state["bind_runtime"],
        )
        payload["mcp"] = state["mcp_runtime"]
        effective_names = [
            str(item.get("name"))
            for item in (
                state["mcp_runtime"].get("effective")
                if isinstance(state["mcp_runtime"].get("effective"), list)
                else []
            )
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        ]
        payload["mcp_runtime_summary"] = aggregate_mcp_runtime_summary(
            state["mcp_local_tool_context"],
            effective_names,
        )
        payload["hooks_runtime"] = summarize_hooks_runtime(state["mcp_local_tool_context"])
        if state["mcp_warnings"]:
            payload["mcp_warnings"] = state["mcp_warnings"]
        payload["endpoints"] = {
            "status": "/api/v1/status",
            "config": "/api/v1/config",
            "reload": "/api/v1/reload",
            "session_interrupt": "/api/v1/sessions/{id}/interrupt",
            "mcp_reset_all": "/api/v1/mcp/reset",
            "mcp_reset_server": "/api/v1/mcp/servers/{name}/reset",
            "healthz": "/healthz",
        }
        payload["reload_count"] = state["reload_count"]
        payload["session_store"] = {
            "backend": state["session_store"].backend,
            "ttl_secs": state["session_store"].ttl_secs,
        }
        payload["provider_failover"] = {
            "chain": [f"{provider.name}/{provider.model}" for provider in state["provider_chain"]],
        }
        payload["mcp_policy"] = {
            "max_concurrency_per_server": state["mcp_policy"].max_concurrency_per_server,
            "max_queue_per_server": state["mcp_policy"].max_queue_per_server,
            "failure_threshold": state["mcp_policy"].failure_threshold,
            "cooldown_secs": state["mcp_policy"].cooldown_secs,
            "allow_tools": list(state["mcp_policy"].allow_tools)
            if isinstance(state["mcp_policy"].allow_tools, tuple)
            else ["*"],
            "latency_sample_limit": state["mcp_policy"].latency_sample_limit,
        }
        management_credentials = state["management_credentials"]
        acl_enabled = any(
            (
                set(credential.actions) != set(MANAGEMENT_ACTION_ALL)
                or bool(credential.interrupt_session_prefixes)
                or (credential.config_sections is not None)
            )
            for credential in management_credentials
        )
        payload["management_auth"] = {
            "enabled": bool(management_credentials),
            "source": state["management_auth_source"],
            "credential_count": len(management_credentials),
            "acl_enabled": acl_enabled,
            "config_read_policy": state["config_read_policy"],
            "config_read_policy_configured": state["config_read_policy_configured"],
            "config_read_policy_source": state["config_read_policy_source"],
            "config_read_policy_reason": state["config_read_policy_reason"],
            "public_config_sections": list(state["public_config_sections"]),
            "public_config_sections_source": state["public_config_sections_source"],
            "public_config_sections_profile": state["public_config_sections_profile"],
            "config_endpoint_requires_auth": state["config_read_policy"] == CONFIG_READ_POLICY_AUTH,
            "config_endpoint_disabled": state["config_read_policy"] == CONFIG_READ_POLICY_DISABLED,
            "write_headers": ["Authorization: Bearer <token>", "X-Grobot-Token: <token>"],
            "protected_endpoints": [
                "POST /api/v1/reload",
                "POST /api/v1/sessions/{id}/interrupt",
                "POST /api/v1/mcp/reset",
                "POST /api/v1/mcp/servers/{name}/reset",
            ],
        }
        if isinstance(state.get("reload_warning"), str) and state["reload_warning"]:
            payload["reload_warning"] = state["reload_warning"]
        return payload

    def state_config_payload(visible_sections: tuple[str, ...] | None) -> dict[str, Any]:
        selection: ProjectSelection = state["selection"]
        runtime_paths: RuntimePaths = state["paths"]
        payload: dict[str, Any] = {
            "status": "ok",
            "timestamp": now_utc_iso(),
            "reload_count": state["reload_count"],
            "management_auth": {
                "credential_count": len(state["management_credentials"]),
                "config_read_policy": state["config_read_policy"],
                "config_read_policy_configured": state["config_read_policy_configured"],
                "config_read_policy_source": state["config_read_policy_source"],
                "config_read_policy_reason": state["config_read_policy_reason"],
                "public_config_sections": list(state["public_config_sections"]),
                "public_config_sections_source": state["public_config_sections_source"],
                "public_config_sections_profile": state["public_config_sections_profile"],
            },
        }

        sections: dict[str, Any] = {
            CONFIG_SECTION_PATHS: {
                "home": str(runtime_paths.home),
                "project_root": str(runtime_paths.project_root),
                "project_toml": str(runtime_paths.project_toml),
                "config_toml": str(runtime_paths.config_toml),
                "sessions_root": str(runtime_paths.sessions_dir),
                "rules": {
                    "global": str(runtime_paths.global_rules_dir),
                    "project": str(runtime_paths.project_rules_dir),
                },
                "skills": {
                    "global": str(runtime_paths.global_skills_dir),
                    "project": str(runtime_paths.project_skills_dir),
                },
                "hooks": {
                    "global": str(runtime_paths.global_hooks_dir),
                    "project": str(runtime_paths.project_hooks_dir),
                },
                "mcp": {
                    "global_registry": str(runtime_paths.global_mcp_registry),
                    "project_override": str(runtime_paths.project_mcp_file),
                },
                "memory": {
                    "session": str(runtime_paths.session_memory_dir),
                    "project": str(runtime_paths.project_memory_dir),
                    "global": str(runtime_paths.global_memory_dir),
                },
            },
            CONFIG_SECTION_SELECTION: {
                "project": selection.name,
                "platform": selection.platform,
                "work_dir": str(selection.work_dir),
                "session_preview": state["session_key"],
                "provider": selection.provider.name,
            },
            CONFIG_SECTION_SESSION_STORE: {
                "backend": state["session_store"].backend,
                "ttl_secs": state["session_store"].ttl_secs,
                "redis_url": mask_redis_url(state["session_store"].redis_url),
            },
            CONFIG_SECTION_PROJECT_TOML: mask_sensitive_object(state["project_toml"]),
            CONFIG_SECTION_CONFIG_TOML: mask_sensitive_object(state["config_toml"]),
        }
        payload["mcp_policy"] = {
            "max_concurrency_per_server": state["mcp_policy"].max_concurrency_per_server,
            "max_queue_per_server": state["mcp_policy"].max_queue_per_server,
            "failure_threshold": state["mcp_policy"].failure_threshold,
            "cooldown_secs": state["mcp_policy"].cooldown_secs,
            "allow_tools": list(state["mcp_policy"].allow_tools)
            if isinstance(state["mcp_policy"].allow_tools, tuple)
            else ["*"],
            "latency_sample_limit": state["mcp_policy"].latency_sample_limit,
        }
        payload["mcp"] = state["mcp_runtime"]
        effective_names = [
            str(item.get("name"))
            for item in (
                state["mcp_runtime"].get("effective")
                if isinstance(state["mcp_runtime"].get("effective"), list)
                else []
            )
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        ]
        payload["mcp_runtime_summary"] = aggregate_mcp_runtime_summary(
            state["mcp_local_tool_context"],
            effective_names,
        )
        payload["hooks_runtime"] = summarize_hooks_runtime(state["mcp_local_tool_context"])
        if state["mcp_warnings"]:
            payload["mcp_warnings"] = state["mcp_warnings"]

        allowed_sections = set(CONFIG_SECTION_ALL if visible_sections is None else visible_sections)
        for section_key in CONFIG_SECTION_ALL:
            if section_key in allowed_sections:
                payload[section_key] = sections[section_key]

        payload["visible_sections"] = sorted([section for section in CONFIG_SECTION_ALL if section in allowed_sections])
        return payload

    def apply_reload() -> dict[str, Any]:
        old_bind = state["bind_runtime"]
        old_host, _ = parse_bind_address(old_bind)
        old_mcp_context = state.get("mcp_local_tool_context")
        reloaded = build_runtime_state()
        reloaded["reload_count"] = int(state["reload_count"]) + 1
        reloaded["bind_runtime"] = old_bind
        reloaded["reload_warning"] = None
        if reloaded["bind"] != old_bind:
            reloaded["reload_warning"] = (
                f"configured bind changed to {reloaded['bind']}, "
                f"but runtime bind remains {old_bind}; restart required"
            )

        if isinstance(old_mcp_context, LocalToolContext):
            close_mcp_sessions(old_mcp_context)

        state.clear()
        state.update(reloaded)
        apply_config_read_policy_state(state, old_host)
        return {
            "status": "ok",
            "timestamp": now_utc_iso(),
            "reload_count": state["reload_count"],
            "runtime_bind": old_bind,
            "configured_bind": state["bind"],
            "warning": state["reload_warning"],
        }

    def apply_mcp_reset(target_server: str | None) -> dict[str, Any]:
        context = state.get("mcp_local_tool_context")
        if not isinstance(context, LocalToolContext):
            raise RuntimeError("mcp local tool context unavailable")

        if isinstance(target_server, str) and target_server.strip():
            normalized_target = target_server.strip()
            closed = close_single_mcp_session(context, normalized_target)
            reset_states = reset_mcp_server_states(context, normalized_target)
            scope = "server"
            target_value = normalized_target
            closed_sessions = 1 if closed else 0
        else:
            closed_sessions = len(context.mcp_sessions)
            close_mcp_sessions(context)
            reset_states = reset_mcp_server_states(context, None)
            scope = "all"
            target_value = "all"

        effective_names = [
            str(item.get("name"))
            for item in (
                state["mcp_runtime"].get("effective")
                if isinstance(state["mcp_runtime"].get("effective"), list)
                else []
            )
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        ]
        runtime_summary = aggregate_mcp_runtime_summary(context, effective_names)
        return {
            "status": "ok",
            "timestamp": now_utc_iso(),
            "scope": scope,
            "target": target_value,
            "closed_sessions": closed_sessions,
            "reset_states": reset_states,
            "runtime_summary": runtime_summary,
        }

    class ManagementHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *handler_args: Any) -> None:  # noqa: A003
            return

        def _request_management_token(self) -> str | None:
            authorization = self.headers.get("Authorization")
            if isinstance(authorization, str):
                parts = authorization.strip().split(None, 1)
                if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
                    return parts[1].strip()

            legacy = self.headers.get("X-Grobot-Token")
            if isinstance(legacy, str) and legacy.strip():
                return legacy.strip()
            return None

        def _match_management_credential(self, provided_token: str) -> ManagementCredential | None:
            credentials = state.get("management_credentials")
            if not isinstance(credentials, list):
                return None
            for credential in credentials:
                if not isinstance(credential, ManagementCredential):
                    continue
                if hmac.compare_digest(provided_token, credential.token):
                    return credential
            return None

        def _require_management_auth(
            self,
            action: str,
            session_id: str | None = None,
        ) -> ManagementCredential | None:
            credentials = state.get("management_credentials")
            if not isinstance(credentials, list) or not credentials:
                self._write_json(
                    503,
                    {
                        "error": "management_token_not_configured",
                        "detail": (
                            "Set [management].token or [[management.tokens]] in config, "
                            "or use GROBOT_MANAGEMENT_TOKEN / --management-token"
                        ),
                    },
                )
                return None

            provided = self._request_management_token()
            if not provided:
                self._write_json(
                    401,
                    {
                        "error": "management_auth_required",
                        "detail": "Missing Authorization: Bearer <token> or X-Grobot-Token header",
                    },
                )
                return None

            credential = self._match_management_credential(provided)
            if credential is None:
                self._write_json(403, {"error": "management_auth_invalid"})
                return None

            if action not in credential.actions:
                self._write_json(
                    403,
                    {
                        "error": "management_acl_denied",
                        "detail": f'credential "{credential.name}" does not allow action "{action}"',
                    },
                )
                return None

            if (
                action == MANAGEMENT_ACTION_INTERRUPT
                and isinstance(session_id, str)
                and credential.interrupt_session_prefixes
                and not any(session_id.startswith(prefix) for prefix in credential.interrupt_session_prefixes)
            ):
                self._write_json(
                    403,
                    {
                        "error": "management_acl_denied",
                        "detail": (
                            f'credential "{credential.name}" cannot interrupt session "{session_id}" '
                            "by interrupt_session_prefixes"
                        ),
                    },
                )
                return None
            return credential

        def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict[str, Any]:
            length_text = self.headers.get("Content-Length", "0")
            try:
                length = int(length_text)
            except ValueError:
                raise ValueError("Invalid Content-Length header")
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            if not raw:
                return {}
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON body: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError("JSON body must be an object")
            return parsed

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/api/v1/status":
                query = parse_qs(parsed.query)
                payload = state_status_payload()
                payload["timestamp"] = now_utc_iso()
                payload["request"] = {
                    "path": parsed.path,
                    "query": query,
                }
                self._write_json(200, payload)
                return
            if parsed.path == "/api/v1/config":
                policy = state.get("config_read_policy")
                if policy == CONFIG_READ_POLICY_DISABLED:
                    self._write_json(404, {"error": "not_found", "path": parsed.path})
                    return
                visible_sections: tuple[str, ...] | None = None
                if policy == CONFIG_READ_POLICY_AUTH:
                    credential = self._require_management_auth(MANAGEMENT_ACTION_CONFIG_READ)
                    if credential is None:
                        return
                    visible_sections = credential.config_sections
                elif policy == CONFIG_READ_POLICY_PUBLIC:
                    public_sections = state.get("public_config_sections")
                    if isinstance(public_sections, tuple):
                        visible_sections = public_sections
                payload = state_config_payload(visible_sections)
                payload["request"] = {"path": parsed.path}
                self._write_json(200, payload)
                return
            if parsed.path == "/healthz":
                self._write_json(200, {"status": "ok", "timestamp": now_utc_iso()})
                return
            self._write_json(404, {"error": "not_found", "path": parsed.path})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/api/v1/reload":
                credential = self._require_management_auth(MANAGEMENT_ACTION_RELOAD)
                if credential is None:
                    return
                try:
                    payload = apply_reload()
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": "reload_failed", "detail": str(exc)})
                    return
                self._write_json(200, payload)
                return

            if parsed.path == "/api/v1/mcp/reset":
                credential = self._require_management_auth(MANAGEMENT_ACTION_MCP_RESET)
                if credential is None:
                    return
                try:
                    payload = apply_mcp_reset(None)
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": "mcp_reset_failed", "detail": str(exc)})
                    return
                self._write_json(200, payload)
                return

            mcp_match = re.fullmatch(r"/api/v1/mcp/servers/(.+)/reset", parsed.path)
            if mcp_match:
                server_name = unquote(mcp_match.group(1)).strip()
                if not server_name:
                    self._write_json(400, {"error": "invalid_server_name"})
                    return
                credential = self._require_management_auth(MANAGEMENT_ACTION_MCP_RESET)
                if credential is None:
                    return
                try:
                    payload = apply_mcp_reset(server_name)
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": "mcp_reset_failed", "detail": str(exc)})
                    return
                self._write_json(200, payload)
                return

            match = re.fullmatch(r"/api/v1/sessions/(.+)/interrupt", parsed.path)
            if match:
                session_id = unquote(match.group(1)).strip()
                if not session_id:
                    self._write_json(400, {"error": "invalid_session_id"})
                    return
                credential = self._require_management_auth(MANAGEMENT_ACTION_INTERRUPT, session_id=session_id)
                if credential is None:
                    return

                ttl_secs = state["session_store"].ttl_secs
                try:
                    body = self._read_json()
                    ttl_from_body = body.get("ttl_secs")
                    if isinstance(ttl_from_body, int) and ttl_from_body > 0:
                        ttl_secs = ttl_from_body
                except ValueError as exc:
                    self._write_json(400, {"error": "invalid_json", "detail": str(exc)})
                    return

                warnings = set_interrupt_flag(state["session_store"], session_id, ttl_secs)
                self._write_json(
                    200,
                    {
                        "status": "ok",
                        "timestamp": now_utc_iso(),
                        "session_id": session_id,
                        "ttl_secs": ttl_secs,
                        "backend": state["session_store"].backend,
                        "warnings": warnings,
                    },
                )
                return

            self._write_json(404, {"error": "not_found", "path": parsed.path})

    server = ThreadingHTTPServer((host, port), ManagementHandler)
    print("Grobot management API started")
    print(f"  bind:      http://{host}:{port}")
    print("  endpoint:  GET /api/v1/status")
    print("  endpoint:  GET /api/v1/config")
    print("  endpoint:  POST /api/v1/reload")
    print("  endpoint:  POST /api/v1/sessions/{id}/interrupt")
    print("  endpoint:  POST /api/v1/mcp/reset")
    print("  endpoint:  POST /api/v1/mcp/servers/{name}/reset")
    print("  healthz:   GET /healthz")
    credential_count = len(state["management_credentials"]) if isinstance(state["management_credentials"], list) else 0
    print(
        f"  auth:      {'enabled' if credential_count > 0 else 'disabled'} "
        f"({state['management_auth_source']}, credentials={credential_count})"
    )
    print(
        "  cfg_read:  "
        f"{state['config_read_policy']} "
        f"(configured={state['config_read_policy_configured']}, reason={state['config_read_policy_reason']})"
    )
    print(
        "  cfg_view:  "
        f"public_sections={list(state['public_config_sections'])} "
        f"(source={state['public_config_sections_source']}, "
        f"profile={state['public_config_sections_profile'] or 'none'})"
    )
    print(
        "  mcp:       "
        f"enabled={state['mcp_runtime']['enabled_count']}, "
        f"disabled={state['mcp_runtime']['disabled_count']}, total={state['mcp_runtime']['total']}"
    )
    print(
        "  mcp_gate:  "
        f"concurrency={state['mcp_policy'].max_concurrency_per_server}, "
        f"queue={state['mcp_policy'].max_queue_per_server}, "
        f"failures={state['mcp_policy'].failure_threshold}, "
        f"cooldown={state['mcp_policy'].cooldown_secs}s"
    )
    print(
        "  mcp_tools: "
        f"{','.join(state['mcp_policy'].allow_tools) if isinstance(state['mcp_policy'].allow_tools, tuple) else '*'}"
    )
    print(f"  mcp_lat:   sample_limit={state['mcp_policy'].latency_sample_limit}")
    print(
        "  mcp_ready: "
        f"ready={state['mcp_runtime'].get('ready_count', 0)}, "
        f"unready={state['mcp_runtime'].get('unready_count', 0)}"
    )
    if state["mcp_runtime"]["enabled"]:
        print(f"  mcp_on:    {', '.join(state['mcp_runtime']['enabled'])}")
    if state["mcp_runtime"].get("unready"):
        print(f"  mcp_off:   {', '.join(state['mcp_runtime']['unready'])}")
    for warning in state["mcp_warnings"]:
        print(f"  mcp_warn:  {warning}")
    if credential_count > 0:
        print("  auth_hdr:  Authorization: Bearer <token> (or X-Grobot-Token)")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping management API...")
    finally:
        mcp_context = state.get("mcp_local_tool_context")
        if isinstance(mcp_context, LocalToolContext):
            close_mcp_sessions(mcp_context)
        server.server_close()
    return 0


def run_start(args: argparse.Namespace) -> int:
    paths = resolve_runtime_paths(
        work_dir_override=args.work_dir,
        config_override=args.config,
        home_override=args.home,
        project_root_override=args.project_root,
    )
    ensure_runtime_layout(paths)
    project_toml = load_toml(paths.project_toml)
    config_toml = load_toml(paths.config_toml)
    project_cfg = find_project(config_toml, args.project, config_hint=str(paths.config_toml))

    selection = resolve_project(
        config=config_toml,
        project_name=args.project,
        work_dir_override=args.work_dir,
        override_provider=args.provider,
        override_api_key=args.api_key,
        override_base_url=args.base_url,
        override_model=args.model,
        config_hint=str(paths.config_toml),
    )
    provider_pool = resolve_provider_pool(
        project=project_cfg,
        selected=selection.provider,
        override_api_key=args.api_key,
        override_base_url=args.base_url,
        override_model=args.model,
    )
    provider_chain = build_provider_failover_chain(
        project_toml=project_toml,
        provider_pool=provider_pool,
        selected_provider=selection.provider,
        provider_forced=bool(args.provider),
    )
    routes, route_skips = resolve_provider_routes(provider_chain)
    if not routes:
        fail("No available provider route. " + summarize_errors(route_skips, limit=3))
    active_route = routes[0]
    session_key = build_session_key(selection.name, selection.platform, selection.work_dir)
    session_store = resolve_session_store_config(
        project_toml=project_toml,
        root=paths.project_root,
        session_root=paths.sessions_dir,
        session_backend_arg=args.session_backend,
        redis_url_arg=args.redis_url,
        ttl_secs_arg=args.session_ttl_secs,
    )
    history_messages, restore_source, store_read_warnings = load_history_from_store(
        session_store,
        session_key,
        args.history_turns,
    )
    retrieval_config = resolve_context_retrieval_config(project_toml, selection.provider.api_key)
    skill_router_config = resolve_skill_router_config(project_toml)
    mcp_runtime, mcp_warnings = resolve_mcp_runtime(paths)
    local_tool_context = resolve_local_tool_context(
        project_toml,
        selection.work_dir,
        mcp_runtime=mcp_runtime,
        runtime_paths=paths,
    )
    mention_index: MentionIndexState | MentionPathIndex | None = None
    skill_descriptors = discover_skill_descriptors(
        paths.global_skills_dir,
        paths.project_skills_dir,
        max_descriptors=skill_router_config.max_descriptors,
        descriptor_scan_lines=skill_router_config.descriptor_scan_lines,
    )
    skill_observability_path = resolve_skill_observability_path(
        skill_router_config.observability_path,
        runtime_paths=paths,
    )
    system_prompt = build_system_prompt(session_key=session_key, work_dir=selection.work_dir)
    circuit_policy = CircuitPolicy(
        failure_threshold=max(1, args.circuit_failures),
        cooldown_secs=max(1, args.circuit_cooldown_secs),
    )
    handoff_recent_turns = parse_positive_int_option(
        args.handoff_recent_turns,
        HANDOFF_DEFAULT_RECENT_TURNS,
        1,
        HANDOFF_MAX_RECENT_TURNS,
    )
    handoff_auto_on_exit = bool(args.handoff_auto_on_exit)
    handoff_path = paths.project_root / HANDOFF_FILENAME
    compaction_observed = False
    failover_observed = False
    failover_errors_seen: list[str] = []

    def record_failover_errors(errors: list[str]) -> None:
        nonlocal failover_observed
        if not errors:
            return
        failover_observed = True
        for item in errors:
            if not isinstance(item, str):
                continue
            cleaned = sanitize_handoff_text(item.strip())
            if not cleaned:
                continue
            if cleaned not in failover_errors_seen:
                failover_errors_seen.append(cleaned)
            if len(failover_errors_seen) >= 16:
                break

    def render_and_write_handoff(
        *,
        reason: str,
        compact_memory: dict[str, Any] | None = None,
        to_stderr: bool = False,
    ) -> bool:
        if compact_memory is None:
            _, compact_memory = trim_history_messages_with_memory(history_messages, args.history_turns)
        content = build_handoff_markdown(
            session_key=session_key,
            project_name=selection.name,
            work_dir=selection.work_dir,
            compact_memory=compact_memory,
            history_messages=history_messages,
            recent_turns=handoff_recent_turns,
            failover_errors=failover_errors_seen,
            compaction_observed=compaction_observed,
        )
        wrote, error = write_handoff_file(path=handoff_path, content=content)
        output = sys.stderr if to_stderr else sys.stdout
        if wrote:
            print(f"[handoff] wrote {handoff_path} (reason={reason})", file=output)
            return True
        print(f"[handoff] write failed ({handoff_path}): {error}", file=output)
        return False

    def maybe_auto_handoff(*, to_stderr: bool = False) -> None:
        if not handoff_auto_on_exit:
            return
        _, compact_memory = trim_history_messages_with_memory(history_messages, args.history_turns)
        todo_open = has_open_todo_items(compact_memory)
        should_write = should_auto_write_handoff(
            compacted=compaction_observed,
            failover=failover_observed,
            todo_open=todo_open,
        )
        if not should_write:
            return
        _ = render_and_write_handoff(
            reason="auto-exit",
            compact_memory=compact_memory,
            to_stderr=to_stderr,
        )

    print("Grobot started")
    print(f"  home:      {paths.home}")
    print(f"  root:      {paths.project_root}")
    print(f"  project:   {selection.name}")
    print(f"  platform:  {selection.platform}")
    print(f"  work_dir:  {selection.work_dir}")
    print(f"  provider:  {active_route.provider.name}")
    print(f"  model:     {active_route.model}")
    print(f"  failover:  {format_route_chain(routes)}")
    print(f"  session:   {session_key}")
    print(f"  store:     {session_store.backend} (ttl={session_store.ttl_secs}s)")
    print(f"  sessions:  {paths.sessions_dir}")
    print(f"  memory:    session={paths.session_memory_dir} project={paths.project_memory_dir} global={paths.global_memory_dir}")
    print(f"  hooks:     global={paths.global_hooks_dir} project={paths.project_hooks_dir}")
    print(
        "  hooks_cfg: "
        f"enabled={local_tool_context.hook_policy.enabled}, "
        f"strict={local_tool_context.hook_policy.strict}, "
        f"timeout={local_tool_context.hook_policy.timeout_secs}s"
    )
    hooks_runtime = summarize_hooks_runtime(local_tool_context)
    print(
        "  hooks_rt:  "
        f"events={hooks_runtime['event_count']} scripts={hooks_runtime['total_scripts']}"
    )
    project_skill_count = sum(1 for item in skill_descriptors if item.scope == "project")
    global_skill_count = sum(1 for item in skill_descriptors if item.scope == "global")
    print(
        "  skills_rt: "
        f"enabled={skill_router_config.enabled} total={len(skill_descriptors)} "
        f"project={project_skill_count} global={global_skill_count} "
        f"threshold={skill_router_config.score_threshold:.2f} gap={skill_router_config.min_score_gap:.2f}"
    )
    print(
        "  skills_obs: "
        f"enabled={skill_router_config.observability_enabled} path={skill_observability_path}"
    )
    print(f"  tools:     {', '.join(local_tool_context.allow_tokens)}")
    print(
        "  mcp_gate:  "
        f"concurrency={local_tool_context.mcp_policy.max_concurrency_per_server}, "
        f"queue={local_tool_context.mcp_policy.max_queue_per_server}, "
        f"failures={local_tool_context.mcp_policy.failure_threshold}, "
        f"cooldown={local_tool_context.mcp_policy.cooldown_secs}s"
    )
    print(
        "  mcp_tools: "
        f"{','.join(local_tool_context.mcp_policy.allow_tools) if isinstance(local_tool_context.mcp_policy.allow_tools, tuple) else '*'}"
    )
    print(f"  mcp_lat:   sample_limit={local_tool_context.mcp_policy.latency_sample_limit}")
    print(
        "  mcp:       "
        f"enabled={mcp_runtime['enabled_count']}, disabled={mcp_runtime['disabled_count']}, total={mcp_runtime['total']}"
    )
    print(
        "  mcp_ready: "
        f"ready={mcp_runtime.get('ready_count', 0)}, unready={mcp_runtime.get('unready_count', 0)}"
    )
    if isinstance(mcp_runtime.get("enabled"), list) and mcp_runtime["enabled"]:
        print(f"  mcp_on:    {', '.join(mcp_runtime['enabled'])}")
    if isinstance(mcp_runtime.get("unready"), list) and mcp_runtime["unready"]:
        print(f"  mcp_off:   {', '.join(mcp_runtime['unready'])}")
    for warning in mcp_warnings:
        print(f"[mcp] {warning}", file=sys.stderr)
    retrieval_parts: list[str] = []
    if retrieval_config.enabled:
        retrieval_parts.append("enabled")
    else:
        retrieval_parts.append("disabled")
    retrieval_parts.append(f"select={retrieval_config.selected_limit}")
    retrieval_parts.append(f"candidates={retrieval_config.candidate_limit}")
    if retrieval_config.embedding is not None:
        retrieval_parts.append(f"embedding={retrieval_config.embedding.model}")
    else:
        retrieval_parts.append("embedding=off")
    if retrieval_config.rerank is not None:
        retrieval_parts.append(f"rerank={retrieval_config.rerank.model}")
    else:
        retrieval_parts.append("rerank=off")
    print(f"  retrieval: {'; '.join(retrieval_parts)}")
    print(
        f"  circuit:   threshold={circuit_policy.failure_threshold}, cooldown={circuit_policy.cooldown_secs}s, "
        f"probe_recovery={'on' if not args.no_probe_recovery else 'off'}"
    )
    print(
        f"  handoff:   auto={'on' if handoff_auto_on_exit else 'off'} "
        f"recent_turns={handoff_recent_turns} path={handoff_path}"
    )
    if history_messages:
        print(f"  restored:  {len(history_messages) // 2} turns from {restore_source}")
    if route_skips:
        print(f"  skipped:   {summarize_errors(route_skips)}")
    for warning in store_read_warnings:
        print(f"[store] {warning}", file=sys.stderr)
    print("")

    if args.message:
        interrupted, interrupt_warnings = consume_interrupt_flag(session_store, session_key)
        for warning in interrupt_warnings:
            print(f"[interrupt] {warning}", file=sys.stderr)
        if interrupted:
            print(
                "Session interrupted by management API. This request was skipped; send again if needed.",
                file=sys.stderr,
            )
            close_mcp_sessions(local_tool_context)
            return 0

        effective_prompt, mention_lines, mention_index = enrich_user_prompt_with_file_mentions(
            args.message,
            local_tool_context,
            mention_index,
        )
        for line in mention_lines:
            print(f"[mentions] {line}", file=sys.stderr)
        refresh_message = mention_refresh_status_message(mention_index)
        if refresh_message:
            print(f"[mentions] {refresh_message}", file=sys.stderr)
        skill_resolution = resolve_skill_runtime(
            effective_prompt,
            skill_descriptors,
            skill_router_config,
        )
        print(skill_resolution.status, file=sys.stderr)
        skill_obs_warning = append_skill_router_event(
            runtime_paths=paths,
            router_config=skill_router_config,
            session_key=session_key,
            project_name=selection.name,
            turn_mode="oneshot",
            user_prompt=args.message,
            effective_prompt=effective_prompt,
            descriptors=skill_descriptors,
            resolution=skill_resolution,
            event_path=skill_observability_path,
        )
        if isinstance(skill_obs_warning, str) and skill_obs_warning:
            print(f"[skills] observability append failed: {skill_obs_warning}", file=sys.stderr)
        try:
            run_hook_event(
                LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
                {
                    "event": LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
                    "session_key": session_key,
                    "platform": selection.platform,
                    "project": selection.name,
                    "user_prompt": args.message,
                    "effective_prompt": effective_prompt,
                    "timestamp": now_utc_iso(),
                },
                local_tool_context,
            )
        except RuntimeError as exc:
            print(f"[hook] {exc}", file=sys.stderr)
            close_mcp_sessions(local_tool_context)
            return 1

        messages = build_chat_messages(
            system_prompt=system_prompt,
            history_messages=history_messages,
            user_prompt=effective_prompt,
            max_history_turns=args.history_turns,
            retrieval_config=retrieval_config,
            skill_prompt_block=skill_resolution.block,
        )
        reply, used_route, errors = call_with_failover(
            routes=routes,
            messages=messages,
            tool_context=local_tool_context,
            policy=circuit_policy,
            enable_probe_recovery=not args.no_probe_recovery,
        )
        active_route = used_route
        if errors:
            print(f"[failover] {summarize_errors(errors)}", file=sys.stderr)
            record_failover_errors(errors)
        history_messages.extend(
            [
                {"role": "user", "content": args.message},
                {"role": "assistant", "content": reply},
            ]
        )
        max_messages = args.history_turns * 2
        if max_messages > 2 and len(history_messages) > max_messages:
            compaction_observed = True
        history_messages = trim_history_messages(history_messages, args.history_turns)
        save_warnings = save_history_to_store(session_store, session_key, history_messages, args.history_turns)
        for warning in save_warnings:
            print(f"[store] {warning}", file=sys.stderr)
        _, compact_memory = trim_history_messages_with_memory(history_messages, args.history_turns)
        memory_warnings = persist_memory_layers(
            paths=paths,
            selection=selection,
            session_key=session_key,
            compact_memory=compact_memory,
        )
        for warning in memory_warnings:
            print(f"[memory] {warning}", file=sys.stderr)
        print(reply)
        maybe_auto_handoff(to_stderr=True)
        close_mcp_sessions(local_tool_context)
        return 0

    print("Enter message (`/model`, `/health`, `/mcp`, `/hooks`, `/handoff`, `/mcp reset <server|all>`, `/help`, `/exit`):")
    while True:
        try:
            user_input = input("grobot> ").strip()
        except EOFError:
            print("")
            break
        except KeyboardInterrupt:
            print("\nInterrupted")
            break

        if not user_input:
            continue
        if user_input in {"/exit", "exit", "quit"}:
            break
        if user_input == "/help":
            print_local_help()
            continue
        if user_input == "/handoff":
            _ = render_and_write_handoff(reason="manual-command")
            print("")
            continue
        if user_input == "/model":
            print_model_info(active_route.provider, active_route.model, selection.work_dir, session_key)
            print(f"  failover:  {format_route_chain(routes)}")
            print(f"  store:     {session_store.backend} (ttl={session_store.ttl_secs}s)")
            print("")
            continue
        if user_input == "/health":
            print("Circuit health:")
            for line in format_circuit_health(routes):
                print(line)
            print("")
            continue
        if user_input.startswith("/mcp reset"):
            parts = user_input.split(maxsplit=2)
            if len(parts) < 3 or not parts[2].strip():
                print('Usage: /mcp reset <server|all>')
                print("")
                continue
            target = parts[2].strip()
            if target.lower() == "all":
                closed_count = len(local_tool_context.mcp_sessions)
                close_mcp_sessions(local_tool_context)
                reset_count = reset_mcp_server_states(local_tool_context, None)
                print(
                    f"Reset MCP state: target=all closed_sessions={closed_count} reset_states={reset_count}"
                )
                print("")
                continue
            closed = close_single_mcp_session(local_tool_context, target)
            reset_count = reset_mcp_server_states(local_tool_context, target)
            if reset_count == 0:
                print(f'No MCP runtime state found for "{target}" (session_closed={closed}).')
            else:
                print(
                    f'Reset MCP state: target={target} session_closed={closed} reset_states={reset_count}'
                )
            print("")
            continue
        if user_input == "/mcp":
            print_mcp_info(mcp_runtime, mcp_warnings, context=local_tool_context)
            continue
        if user_input == "/hooks":
            print_hooks_info(local_tool_context)
            continue

        interrupted, interrupt_warnings = consume_interrupt_flag(session_store, session_key)
        for warning in interrupt_warnings:
            print(f"[interrupt] {warning}")
        if interrupted:
            print("Session interrupted by management API. Current input skipped.")
            print("")
            continue

        effective_prompt, mention_lines, mention_index = enrich_user_prompt_with_file_mentions(
            user_input,
            local_tool_context,
            mention_index,
        )
        for line in mention_lines:
            print(f"[mentions] {line}")
        refresh_message = mention_refresh_status_message(mention_index)
        if refresh_message:
            print(f"[mentions] {refresh_message}")
        skill_resolution = resolve_skill_runtime(
            effective_prompt,
            skill_descriptors,
            skill_router_config,
        )
        print(skill_resolution.status)
        skill_obs_warning = append_skill_router_event(
            runtime_paths=paths,
            router_config=skill_router_config,
            session_key=session_key,
            project_name=selection.name,
            turn_mode="interactive",
            user_prompt=user_input,
            effective_prompt=effective_prompt,
            descriptors=skill_descriptors,
            resolution=skill_resolution,
            event_path=skill_observability_path,
        )
        if isinstance(skill_obs_warning, str) and skill_obs_warning:
            print(f"[skills] observability append failed: {skill_obs_warning}")
        try:
            run_hook_event(
                LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
                {
                    "event": LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
                    "session_key": session_key,
                    "platform": selection.platform,
                    "project": selection.name,
                    "user_prompt": user_input,
                    "effective_prompt": effective_prompt,
                    "timestamp": now_utc_iso(),
                },
                local_tool_context,
            )
        except RuntimeError as exc:
            print(f"[hook] {exc}")
            print("")
            continue

        messages = build_chat_messages(
            system_prompt=system_prompt,
            history_messages=history_messages,
            user_prompt=effective_prompt,
            max_history_turns=args.history_turns,
            retrieval_config=retrieval_config,
            skill_prompt_block=skill_resolution.block,
        )
        reply, used_route, errors = call_with_failover(
            routes=routes,
            messages=messages,
            tool_context=local_tool_context,
            policy=circuit_policy,
            enable_probe_recovery=not args.no_probe_recovery,
        )
        active_route = used_route
        if errors:
            print(f"[failover] {summarize_errors(errors)}")
            record_failover_errors(errors)
        history_messages.extend(
            [
                {"role": "user", "content": user_input},
                {"role": "assistant", "content": reply},
            ]
        )
        max_messages = args.history_turns * 2
        if max_messages > 2 and len(history_messages) > max_messages:
            compaction_observed = True
        history_messages = trim_history_messages(history_messages, args.history_turns)
        save_warnings = save_history_to_store(session_store, session_key, history_messages, args.history_turns)
        for warning in save_warnings:
            print(f"[store] {warning}")
        _, compact_memory = trim_history_messages_with_memory(history_messages, args.history_turns)
        memory_warnings = persist_memory_layers(
            paths=paths,
            selection=selection,
            session_key=session_key,
            compact_memory=compact_memory,
        )
        for warning in memory_warnings:
            print(f"[memory] {warning}")
        print(reply)
        print("")

    _ = project_toml.get("schema_version")
    maybe_auto_handoff()
    close_mcp_sessions(local_tool_context)
    return 0


def run_init(args: argparse.Namespace) -> int:
    init_global = bool(getattr(args, "init_global", False))
    init_project = bool(getattr(args, "init_project", False))
    hooks_samples = bool(getattr(args, "hooks_samples", False))
    if not init_global and not init_project:
        init_global = True

    repo = repo_root().resolve()
    home = default_grobot_home(getattr(args, "home", None))
    force = bool(getattr(args, "force", False))
    created: list[str] = []
    reused: list[str] = []

    if init_global:
        global_dirs = [
            home,
            home / "rules",
            home / "skills",
            home / "hooks",
            home / "hooks" / LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
            home / "hooks" / LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
            home / "hooks" / LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
            home / "mcp",
            home / "runtime" / "sessions",
            home / "runtime" / "memory" / "session",
            home / "memory" / "global",
        ]
        for path in global_dirs:
            existed = path.exists()
            path.mkdir(parents=True, exist_ok=True)
            if existed:
                reused.append(str(path))
            else:
                created.append(str(path))

        global_readmes: tuple[tuple[Path, str], ...] = (
            (home / "rules" / "README.md", FALLBACK_RULES_README_TEMPLATE),
            (home / "skills" / "README.md", FALLBACK_SKILLS_README_TEMPLATE),
            (home / "memory" / "global" / "README.md", FALLBACK_MEMORY_README_TEMPLATE),
        )
        for readme_path, template in global_readmes:
            wrote_readme = write_text_file_if_missing(
                readme_path,
                source=None,
                fallback_content=template,
                force=force,
            )
            if wrote_readme:
                created.append(str(readme_path))
            else:
                reused.append(str(readme_path))

        config_target = home / DEFAULT_GLOBAL_CONFIG_FILENAME
        config_source = repo / DEFAULT_PROJECT_CONFIG_DIRNAME / "config.toml.example"
        wrote = write_text_file_if_missing(
            config_target,
            source=config_source,
            fallback_content=FALLBACK_GLOBAL_CONFIG_TEMPLATE,
            force=force,
        )
        if wrote:
            created.append(str(config_target))
        else:
            reused.append(str(config_target))

        global_mcp_registry_target = home / "mcp" / DEFAULT_GLOBAL_MCP_REGISTRY
        wrote_global_mcp_registry = write_text_file_if_missing(
            global_mcp_registry_target,
            source=None,
            fallback_content=FALLBACK_GLOBAL_MCP_TEMPLATE,
            force=force,
        )
        if wrote_global_mcp_registry:
            created.append(str(global_mcp_registry_target))
        else:
            reused.append(str(global_mcp_registry_target))

        global_hooks_readme = home / "hooks" / "README.md"
        wrote_global_hooks_readme = write_text_file_if_missing(
            global_hooks_readme,
            source=None,
            fallback_content=FALLBACK_HOOKS_README_TEMPLATE,
            force=force,
        )
        if wrote_global_hooks_readme:
            created.append(str(global_hooks_readme))
        else:
            reused.append(str(global_hooks_readme))
        if hooks_samples:
            init_hook_sample_scripts(
                hooks_root=home / "hooks",
                force=force,
                created=created,
                reused=reused,
            )

    if init_project:
        project_root = (
            Path(getattr(args, "project_root", "")).expanduser().resolve()
            if isinstance(getattr(args, "project_root", None), str) and getattr(args, "project_root").strip()
            else Path.cwd().resolve()
        )
        project_dir = project_root / DEFAULT_PROJECT_CONFIG_DIRNAME
        project_dirs = [
            project_dir,
            project_dir / "rules",
            project_dir / "skills",
            project_dir / "hooks",
            project_dir / "hooks" / LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT,
            project_dir / "hooks" / LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE,
            project_dir / "hooks" / LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE,
            project_dir / "memory",
        ]
        for path in project_dirs:
            existed = path.exists()
            path.mkdir(parents=True, exist_ok=True)
            if existed:
                reused.append(str(path))
            else:
                created.append(str(path))

        project_readmes: tuple[tuple[Path, str], ...] = (
            (project_dir / "rules" / "README.md", FALLBACK_RULES_README_TEMPLATE),
            (project_dir / "skills" / "README.md", FALLBACK_SKILLS_README_TEMPLATE),
            (project_dir / "memory" / "README.md", FALLBACK_MEMORY_README_TEMPLATE),
        )
        for readme_path, template in project_readmes:
            wrote_readme = write_text_file_if_missing(
                readme_path,
                source=None,
                fallback_content=template,
                force=force,
            )
            if wrote_readme:
                created.append(str(readme_path))
            else:
                reused.append(str(readme_path))

        project_target = project_dir / DEFAULT_PROJECT_CONFIG_FILENAME
        project_source = repo / DEFAULT_PROJECT_CONFIG_DIRNAME / DEFAULT_PROJECT_CONFIG_FILENAME
        wrote_project = write_text_file_if_missing(
            project_target,
            source=project_source,
            fallback_content=FALLBACK_PROJECT_TEMPLATE,
            force=force,
        )
        if wrote_project:
            created.append(str(project_target))
        else:
            reused.append(str(project_target))

        project_mcp_target = project_dir / DEFAULT_PROJECT_MCP_FILENAME
        wrote_project_mcp = write_text_file_if_missing(
            project_mcp_target,
            source=None,
            fallback_content=FALLBACK_PROJECT_MCP_TEMPLATE,
            force=force,
        )
        if wrote_project_mcp:
            created.append(str(project_mcp_target))
        else:
            reused.append(str(project_mcp_target))

        project_hooks_readme = project_dir / "hooks" / "README.md"
        wrote_project_hooks_readme = write_text_file_if_missing(
            project_hooks_readme,
            source=None,
            fallback_content=FALLBACK_HOOKS_README_TEMPLATE,
            force=force,
        )
        if wrote_project_hooks_readme:
            created.append(str(project_hooks_readme))
        else:
            reused.append(str(project_hooks_readme))
        if hooks_samples:
            init_hook_sample_scripts(
                hooks_root=project_dir / "hooks",
                force=force,
                created=created,
                reused=reused,
            )

    print("Grobot init completed")
    print(f"  home:      {home}")
    if init_project:
        project_root_display = (
            Path(getattr(args, "project_root")).expanduser().resolve()
            if isinstance(getattr(args, "project_root", None), str) and getattr(args, "project_root").strip()
            else Path.cwd().resolve()
        )
        print(f"  project:   {project_root_display}")
    print(f"  created:   {len(created)}")
    print(f"  reused:    {len(reused)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Grobot local launcher")
    sub = parser.add_subparsers(dest="command")

    init = sub.add_parser("init", help="Initialize global home and/or project .grobot layout")
    init.add_argument("--global", dest="init_global", action="store_true", help="Initialize ~/.grobot home layout")
    init.add_argument(
        "--project",
        dest="init_project",
        action="store_true",
        help="Initialize .grobot layout in target project root (default: current directory)",
    )
    init.add_argument("--home", help="Override global home directory (default: ~/.grobot or GROBOT_HOME)")
    init.add_argument("--project-root", help="Target project root for --project")
    init.add_argument("--force", action="store_true", help="Overwrite existing template files")
    init.add_argument(
        "--hooks-samples",
        action="store_true",
        help="Create executable sample hook scripts under hooks/<event>/",
    )
    init.set_defaults(func=run_init)

    status = sub.add_parser("status", help="Show grobot runtime status")
    status.add_argument("--project", help="Project name in config.toml")
    status.add_argument("--work-dir", help="Override target work directory")
    status.add_argument("--config", help="Path to runtime config.toml")
    status.add_argument("--home", help="Path to global grobot home (default: ~/.grobot or GROBOT_HOME)")
    status.add_argument("--project-root", help="Project root containing .grobot/project.toml")
    status.add_argument("--provider", help="Provider name from [projects.agent.providers]")
    status.add_argument("--api-key", help="Override API key")
    status.add_argument("--base-url", help="Override OpenAI-compatible base URL")
    status.add_argument("--model", help="Override model id (or auto)")
    status.add_argument("--probe", action="store_true", help="Call provider /models to verify connectivity")
    status.set_defaults(func=run_status)

    hooks = sub.add_parser("hooks", help="Hooks utilities")
    hooks_sub = hooks.add_subparsers(dest="hooks_command")
    hooks_doctor = hooks_sub.add_parser("doctor", help="Diagnose hooks policy and script readiness")
    hooks_doctor.add_argument("--project", help="Project name in config.toml")
    hooks_doctor.add_argument("--work-dir", help="Override target work directory")
    hooks_doctor.add_argument("--config", help="Path to runtime config.toml")
    hooks_doctor.add_argument("--home", help="Path to global grobot home (default: ~/.grobot or GROBOT_HOME)")
    hooks_doctor.add_argument("--project-root", help="Project root containing .grobot/project.toml")
    hooks_doctor.add_argument("--json", dest="json_output", action="store_true", help="Output JSON")
    hooks_doctor.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero on warnings in addition to errors",
    )
    hooks.set_defaults(func=run_hooks)

    serve = sub.add_parser("serve", help="Run management API server")
    serve.add_argument("--project", help="Project name in config.toml")
    serve.add_argument("--work-dir", help="Override target work directory")
    serve.add_argument("--config", help="Path to runtime config.toml")
    serve.add_argument("--home", help="Path to global grobot home (default: ~/.grobot or GROBOT_HOME)")
    serve.add_argument("--project-root", help="Project root containing .grobot/project.toml")
    serve.add_argument("--provider", help="Provider name from [projects.agent.providers]")
    serve.add_argument("--api-key", help="Override API key")
    serve.add_argument("--base-url", help="Override OpenAI-compatible base URL")
    serve.add_argument("--model", help="Override model id (or auto)")
    serve.add_argument("--bind", help="Override management bind, e.g. 127.0.0.1:8080")
    serve.add_argument(
        "--management-token",
        help="Override management token for management endpoints (reload/interrupt/config_read)",
    )
    serve.add_argument(
        "--config-read-policy",
        choices=["auto", "public", "auth", "disabled"],
        help="Policy for GET /api/v1/config: auto/public/auth/disabled",
    )
    serve.add_argument(
        "--session-backend",
        choices=["auto", "redis", "file"],
        default="auto",
        help="Session persistence backend for management operations",
    )
    serve.add_argument("--redis-url", help="Redis URL for management operations")
    serve.add_argument("--session-ttl-secs", type=int, help="Session TTL seconds for management operations")
    serve.set_defaults(func=run_serve)

    start = sub.add_parser("start", help="Start grobot session")
    start.add_argument("--project", help="Project name in config.toml")
    start.add_argument("--work-dir", help="Override target work directory")
    start.add_argument("--message", help="Run one-shot message and exit")
    start.add_argument("--config", help="Path to runtime config.toml")
    start.add_argument("--home", help="Path to global grobot home (default: ~/.grobot or GROBOT_HOME)")
    start.add_argument("--project-root", help="Project root containing .grobot/project.toml")
    start.add_argument("--provider", help="Provider name from [projects.agent.providers]")
    start.add_argument("--api-key", help="Override API key")
    start.add_argument("--base-url", help="Override OpenAI-compatible base URL")
    start.add_argument("--model", help="Override model id (or auto)")
    start.add_argument("--history-turns", type=int, default=12, help="Max retained turns for context replay")
    start.add_argument(
        "--handoff-recent-turns",
        type=int,
        default=HANDOFF_DEFAULT_RECENT_TURNS,
        help="Recent turn pairs included in generated HANDOFF.md",
    )
    start.add_argument(
        "--handoff-auto-on-exit",
        dest="handoff_auto_on_exit",
        action="store_true",
        default=True,
        help="Auto-generate HANDOFF.md on session exit when trigger conditions are met",
    )
    start.add_argument(
        "--no-handoff-auto-on-exit",
        dest="handoff_auto_on_exit",
        action="store_false",
        help="Disable auto handoff generation on session exit",
    )
    start.add_argument(
        "--session-backend",
        choices=["auto", "redis", "file"],
        default="auto",
        help="Session persistence backend",
    )
    start.add_argument("--redis-url", help="Redis URL, e.g. redis://127.0.0.1:6379/0")
    start.add_argument("--session-ttl-secs", type=int, help="Session TTL seconds for persistence")
    start.add_argument("--circuit-failures", type=int, default=2, help="Failures before opening circuit")
    start.add_argument("--circuit-cooldown-secs", type=int, default=30, help="Circuit open cooldown seconds")
    start.add_argument(
        "--no-probe-recovery",
        action="store_true",
        help="Disable recovery probe (/models) before re-entering an open circuit",
    )
    start.set_defaults(func=run_start)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return 1
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
